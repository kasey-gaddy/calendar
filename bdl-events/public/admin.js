(() => {
  const K = window.KEG;
  const $ = (s, r = document) => r.querySelector(s);
  const A = (path, opts = {}) => K.api(path, { ...opts, asAdmin: true });
  const S = {
    events: [],
    sel: null,
    list: "up",
    cfg: null,
    bound: false,
    roster: [],
    rosterMap: new Map(),
    invite: new Set(),
    people: null,
    upload: null,
  };
  let companyList = ["KE&G", "Maddux", "BDL"];
  const dlg = $("#dlg");
  const dlgBody = $("#dlgBody");

  // Same matching rule as the server: case and spaces ignored, leading zeros dropped.
  const empKey = (v) => {
    const s = String(v ?? "").trim().toUpperCase().replace(/\s+/g, "").replace(/\.0+$/, "").replace(/^0+(?=.)/, "");
    return /^[A-Z0-9_-]{1,40}$/.test(s) ? s : "";
  };
  const nameOf = (e) => [e.preferred || e.first, e.last].filter(Boolean).join(" ");
  // The managed list first, then any company that only shows up on the roster.
  const companies = () => [...new Set([...companyList, ...S.roster.map((e) => e.company).filter(Boolean)])];
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  const dateOnly = (iso) => (iso ? K.fmtDate(K.azDate(Date.parse(iso)), false) : "");
  const showPhone = (p) => (p && p.startsWith("+1") && p.length === 12 ? `${p.slice(2, 5)}-${p.slice(5, 8)}-${p.slice(8)}` : p || "");

  // On phones, wide tables turn into stacked cards. Each cell gets its column
  // heading as a label so the card still reads clearly.
  function labelTable(box) {
    const t = box.querySelector("table");
    if (!t) return;
    t.classList.add("cards");
    const heads = [...t.querySelectorAll("thead th")].map((th) => th.textContent.trim());
    t.querySelectorAll("tbody tr").forEach((tr) =>
      [...tr.children].forEach((td, i) => {
        td.setAttribute("data-label", heads[i] || "");
        // Keep each cell's content together so it stays on one side of the card.
        if (!td.querySelector(":scope > .v")) td.innerHTML = `<span class="v">${td.innerHTML}</span>`;
      })
    );
  }

  // ── Sign in ───────────────────────────────────────────────────────────────
  async function boot() {
    if (!K.session.get("bdlAdmin")) return showLogin();
    try {
      S.cfg = await A("/api/me");
      if (!S.cfg.admin) throw Object.assign(new Error("That password didn't work."), { status: 401 });
    } catch (e) {
      K.session.del("bdlAdmin");
      return showLogin(e.status === 401 ? "That password didn't work." : e.message);
    }
    $("#login").hidden = true;
    $("#app").hidden = false;
    $("#signOut").hidden = false;
    renderWarnings();
    bind();
    await loadCompanies();
    await Promise.all([loadEvents(), loadRoster()]);
    edit(null);
    renderUpload();
    renderCompanies();
  }

  function showLogin(msg) {
    $("#login").hidden = false;
    $("#app").hidden = true;
    const e = $("#loginError");
    e.textContent = msg || "";
    e.hidden = !msg;
    $("#pw").focus();
  }

  $("#loginForm").addEventListener("submit", (e) => {
    e.preventDefault();
    K.session.set("bdlAdmin", $("#pw").value);
    boot();
  });
  $("#signOut").addEventListener("click", () => {
    K.session.del("bdlAdmin");
    location.reload();
  });

  function renderWarnings() {
    const w = [];
    if (!S.cfg.emailReady) w.push("Email isn't set up yet, so no emails will go out. Add the Microsoft Graph settings in Netlify to turn it on.");
    if (!S.cfg.smsReady) w.push("Texting isn't set up yet, so no texts will go out. Add the Azure Communication Services settings in Netlify to turn it on.");
    if (!window.XLSX) w.push("The spreadsheet tool didn't load, so uploads and Excel downloads won't work. Reload the page to try again.");
    $("#warnings").innerHTML = w.length
      ? `<details class="warn"><summary>${w.length === 1 ? "1 thing needs setting up" : `${w.length} things need setting up`}</summary><ul>${w.map((t) => `<li>${K.esc(t)}</li>`).join("")}</ul></details>`
      : "";
  }

  function switchTab(name) {
    document.querySelectorAll("[data-tab]").forEach((b) => b.setAttribute("aria-selected", b.dataset.tab === name));
    for (const t of ["events", "employees", "reports"]) $(`#tab-${t}`).hidden = t !== name;
    if (name === "employees") {
      renderRoster();
      renderCompanies();
    }
    if (name === "reports") loadSummary();
  }

  // ── Spreadsheet export ────────────────────────────────────────────────────
  function download(filename, sheets, type = "xlsx") {
    if (!window.XLSX) return K.toast("The spreadsheet tool didn't load. Reload the page and try again.");
    const wb = XLSX.utils.book_new();
    for (const { name, rows } of sheets) {
      const ws = XLSX.utils.json_to_sheet(rows.length ? rows : [{ Note: "Nothing to show yet" }]);
      const cols = Object.keys(rows[0] || { Note: "" });
      ws["!cols"] = cols.map((c) => ({ wch: Math.min(40, Math.max(c.length, ...rows.map((r) => String(r[c] ?? "").length)) + 2) }));
      XLSX.utils.book_append_sheet(wb, ws, name.slice(0, 31));
    }
    const safe = filename.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase();
    XLSX.writeFile(wb, `${safe}.${type}`, { bookType: type });
  }

  // ── Events list ───────────────────────────────────────────────────────────
  async function loadEvents() {
    S.events = (await A("/api/events")).events || [];
    renderList();
  }

  const lastDay = (ev) => ev.endDate || ev.startDate;
  const audienceLabel = (a = {}) =>
    a.mode === "invite" ? `Invite only (${a.ids?.length || 0})` : a.mode === "companies" ? `${(a.companies || []).join(", ")} only` : "Everyone";

  function renderList() {
    const today = K.todayAZ();
    let list = S.events.filter((e) => (S.list === "up" ? lastDay(e) >= today : lastDay(e) < today));
    if (S.list === "past") list = list.reverse();
    $("#tabUp").setAttribute("aria-pressed", S.list === "up");
    $("#tabPast").setAttribute("aria-pressed", S.list === "past");
    $("#elist").innerHTML = list.length
      ? list
          .map(
            (e) => `<li><button type="button" data-id="${e.id}" aria-current="${S.sel?.id === e.id}">
            <span class="t">${e.status === "cancelled" ? "Cancelled: " : ""}${K.esc(e.title)}</span>
            <span class="s">${K.esc(K.fmtDate(e.startDate))}${e.startTime ? `, ${K.fmtTime(e.startTime)}` : ""}</span>
            <span class="s">${K.esc(audienceLabel(e.audience))}${e.rsvpEnabled ? `, ${e.rsvpCount || 0} going` : ""}</span>
          </button></li>`
          )
          .join("")
      : `<li style="padding:16px;color:var(--muted)">${S.list === "up" ? "No upcoming events. Choose New event to post one." : "No past events yet."}</li>`;
  }

  // ── Event editor ──────────────────────────────────────────────────────────
  const v = (ev, k) => K.esc(ev?.[k] ?? "");
  const field = (id, label, input, hint = "") =>
    `<div class="field"><label for="${id}">${label}</label>${input}${hint ? `<span class="hint">${hint}</span>` : ""}</div>`;

  function edit(ev) {
    S.sel = ev;
    S.invite = new Set(ev?.audience?.ids || []);
    renderList();
    const isNew = !ev;
    const cancelled = ev?.status === "cancelled";
    const cats = [...new Set(S.events.flatMap((e) => e.categories || []))].sort();
    const aud = ev?.audience || { mode: "all" };
    const radio = (val, label) =>
      `<label><input type="radio" name="audMode" value="${val}"${aud.mode === val ? " checked" : ""}> ${label}</label>`;

    $("#editor").innerHTML = `
      <div class="panel-head"><h2>${isNew ? "New event" : "Edit event"}</h2>${cancelled ? `<span class="flag flag-cancelled">Cancelled</span>` : ""}</div>
      <form class="panel-body form" id="evForm" novalidate>
        ${field("title", "Title", `<input id="title" name="title" required maxlength="140" value="${v(ev, "title")}">`)}
        <div class="field">
          <label for="categories">Categories</label>
          <input id="categories" name="categories" value="${K.esc((ev?.categories || []).join(", "))}" placeholder="Safety, ESOP, Family">
          <span class="hint">Separate with commas. People can filter the calendar by these.</span>
          ${cats.length ? `<div class="suggest">${cats.map((c) => `<button type="button" data-cat="${K.esc(c)}">${K.esc(c)}</button>`).join("")}</div>` : ""}
        </div>
        <fieldset><legend>Who can see it</legend>
          <div class="radios" role="radiogroup" aria-label="Who can see it">
            ${radio("all", "Everyone")}${radio("companies", "Certain companies")}${radio("invite", "Invited people only")}
          </div>
          <div data-aud="companies" class="radios">
            ${companies().map((c) => `<label><input type="checkbox" name="audCompany" value="${K.esc(c)}"${(aud.companies || []).includes(c) ? " checked" : ""}> ${K.esc(c)}</label>`).join("")}
          </div>
          <div data-aud="invite" id="picker"></div>
          <span class="hint">Only the people who can see an event get its updates, and it only shows up in their calendar feed.</span>
        </fieldset>
        <fieldset><legend>When</legend>
          <div class="form-2">
            ${field("startDate", "Start date", `<input id="startDate" name="startDate" type="date" required value="${v(ev, "startDate")}">`)}
            ${field("startTime", "Start time", `<input id="startTime" name="startTime" type="time" value="${v(ev, "startTime")}">`, "Leave blank for an all-day event.")}
            ${field("endDate", "End date", `<input id="endDate" name="endDate" type="date" value="${v(ev, "endDate")}">`, "Only if it runs more than one day.")}
            ${field("endTime", "End time", `<input id="endTime" name="endTime" type="time" value="${v(ev, "endTime")}">`, "Optional.")}
          </div>
          <span class="hint">All times are Arizona time.</span>
        </fieldset>
        <fieldset><legend>Where</legend>
          <div class="form-2">
            ${field("locationName", "Place", `<input id="locationName" name="locationName" value="${v(ev, "locationName")}" placeholder="Tucson yard">`)}
            ${field("address", "Address", `<input id="address" name="address" value="${v(ev, "address")}" placeholder="Street, city">`)}
          </div>
        </fieldset>
        <fieldset><legend>Cost</legend>
          <div class="form-2">
            ${field("fee", "Cost per person ($)", `<input id="fee" name="fee" type="number" min="0" step="0.01" inputmode="decimal" value="${ev?.fee || ""}">`, "Leave blank if it's free.")}
            ${field("feeNote", "Cost note", `<input id="feeNote" name="feeNote" value="${v(ev, "feeNote")}" placeholder="Free for employees, $10 per guest">`, "Optional.")}
          </div>
        </fieldset>
        ${field("description", "Description", `<textarea id="description" name="description" rows="6">${v(ev, "description")}</textarea>`, "Links you paste become clickable.")}
        <fieldset><legend>RSVP</legend>
          <label class="check"><input type="checkbox" name="rsvpEnabled" ${ev?.rsvpEnabled ? "checked" : ""}><span>Take RSVPs for this event</span></label>
          <div class="form-2">
            ${field("rsvpCapacity", "Spots available", `<input id="rsvpCapacity" name="rsvpCapacity" type="number" min="0" step="1" value="${ev?.rsvpCapacity || ""}">`, "Leave blank for no limit. Guests count toward this.")}
            ${field("rsvpDeadline", "RSVP by", `<input id="rsvpDeadline" name="rsvpDeadline" type="date" value="${v(ev, "rsvpDeadline")}">`, "Optional. RSVPs close after this day.")}
          </div>
          <label class="check"><input type="checkbox" name="allowGuests" ${ev?.allowGuests ? "checked" : ""}><span>Let people bring guests</span></label>
        </fieldset>
        <fieldset><legend>Tell people</legend>
          ${
            isNew
              ? `<label class="check"><input type="checkbox" name="announce"><span>Announce this event to people who follow all events and can see it</span></label>`
              : `<label class="check"><input type="checkbox" name="notify" checked><span>Send an update to people following this event if the time, place, cost, or name changes</span></label>
                 ${field("message", "Note to include (optional)", `<textarea id="message" name="message" rows="3" maxlength="500" placeholder="Parking moved to the north lot."></textarea>`, "If you add a note, an update goes out even when nothing else changed.")}`
          }
        </fieldset>
        <p class="error" id="formError" hidden></p>
        <div class="actions">
          <button class="btn btn-primary" type="submit">${isNew ? "Post event" : "Save changes"}</button>
          ${
            isNew
              ? ""
              : `<div class="btnrow">
                  ${cancelled ? `<button class="btn btn-secondary" type="button" data-act="reinstate">Put back on</button>` : `<button class="btn btn-danger" type="button" data-act="cancel">Cancel event</button>`}
                  <button class="btn btn-danger" type="button" data-act="delete">Delete</button>
                </div>`
          }
        </div>
      </form>`;

    const form = $("#evForm");
    const syncAudience = () => {
      const mode = form.elements.audMode.value;
      form.querySelector('[data-aud="companies"]').hidden = mode !== "companies";
      form.querySelector('[data-aud="invite"]').hidden = mode !== "invite";
    };
    form.addEventListener("change", (e) => {
      if (e.target.name === "audMode") syncAudience();
    });
    syncAudience();
    renderPicker();

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      save();
    });
    form.addEventListener("click", (e) => {
      const cat = e.target.closest("[data-cat]")?.dataset.cat;
      if (cat) {
        const input = form.elements.categories;
        const list = input.value.split(",").map((s) => s.trim()).filter(Boolean);
        if (!list.includes(cat)) list.push(cat);
        input.value = list.join(", ");
      }
      const act = e.target.closest("[data-act]")?.dataset.act;
      if (act === "cancel" && confirm("Cancel this event? It stays on the calendar marked as cancelled, and everyone following it gets a notice.")) {
        save({ status: "cancelled", notify: true });
      } else if (act === "reinstate" && confirm("Put this event back on? Everyone following it gets a notice.")) {
        save({ status: "scheduled", notify: true });
      } else if (act === "delete") {
        remove();
      }
    });

    if (ev) loadPeople(ev);
    else $("#people").hidden = true;
  }

  // ── Invite picker ─────────────────────────────────────────────────────────
  const pickerState = { q: "", company: "", division: "", only: false };

  function renderPicker() {
    const box = $("#picker");
    if (!box) return;
    const divisions = [...new Set(S.roster.map((e) => e.division).filter(Boolean))].sort();
    const opt = (val, label, cur) => `<option value="${K.esc(val)}"${cur === val ? " selected" : ""}>${K.esc(label)}</option>`;
    box.innerHTML = `
      <div class="picker">
        <div class="toolbar">
          <input type="search" id="pkQ" placeholder="Search name or ID" value="${K.esc(pickerState.q)}" aria-label="Search people">
          <select id="pkCo" aria-label="Company">${opt("", "All companies", pickerState.company)}${companies().map((c) => opt(c, c, pickerState.company)).join("")}</select>
          ${divisions.length ? `<select id="pkDiv" aria-label="Division">${opt("", "All divisions", pickerState.division)}${divisions.map((d) => opt(d, d, pickerState.division)).join("")}</select>` : ""}
          <label class="check" style="font-size:14px"><input type="checkbox" id="pkOnly"${pickerState.only ? " checked" : ""}><span>Invited only</span></label>
        </div>
        <div class="picker-list" id="pkList"></div>
        <div class="picker-foot">
          <span id="pkCount"></span>
          <span class="btnrow">
            <button class="btn btn-secondary" type="button" id="pkAll">Invite everyone shown</button>
            <button class="btn btn-secondary" type="button" id="pkNone">Remove everyone shown</button>
          </span>
        </div>
      </div>
      <details style="margin-top:10px">
        <summary style="cursor:pointer;font-weight:600;color:var(--blue)">Paste a list of employee IDs</summary>
        <div class="form" style="margin-top:10px">
          <textarea id="pkPaste" rows="3" placeholder="1042, 1107, 1233" style="border:1px solid var(--line);border-radius:6px;padding:10px"></textarea>
          <div><button class="btn btn-secondary" type="button" id="pkAdd">Invite these IDs</button></div>
          <p class="fine" id="pkMsg"></p>
        </div>
      </details>`;
    const draw = () => {
      const q = pickerState.q.toLowerCase();
      const match = S.roster.filter(
        (e) =>
          e.active !== false &&
          (!pickerState.company || e.company === pickerState.company) &&
          (!pickerState.division || e.division === pickerState.division) &&
          (!pickerState.only || S.invite.has(e.key)) &&
          (!q || `${e.first} ${e.last} ${e.preferred || ""} ${e.id}`.toLowerCase().includes(q))
      );
      const shown = match.slice(0, 300);
      box.shown = match;
      $("#pkList").innerHTML = shown.length
        ? shown
            .map(
              (e) => `<label><input type="checkbox" data-key="${K.esc(e.key)}"${S.invite.has(e.key) ? " checked" : ""}>
                <span>${K.esc(nameOf(e))} <span class="muted">#${K.esc(e.id)}</span></span>
                <span class="muted">${K.esc([e.company, e.division].filter(Boolean).join(", "))}</span></label>`
            )
            .join("") + (match.length > shown.length ? `<p class="fine" style="padding:8px 12px">Showing 300 of ${match.length}. Search to narrow the list.</p>` : "")
        : `<p class="fine" style="padding:12px">${S.roster.length ? "No one matches." : "Upload employees first, on the Employees tab."}</p>`;
      $("#pkCount").textContent = `${plural(S.invite.size, "person", "people")} invited`;
    };
    box.oninput = (e) => {
      if (e.target.id === "pkQ") { pickerState.q = e.target.value; draw(); }
    };
    box.onchange = (e) => {
      const t = e.target;
      if (t.dataset.key) { t.checked ? S.invite.add(t.dataset.key) : S.invite.delete(t.dataset.key); draw(); }
      else if (t.id === "pkCo") { pickerState.company = t.value; draw(); }
      else if (t.id === "pkDiv") { pickerState.division = t.value; draw(); }
      else if (t.id === "pkOnly") { pickerState.only = t.checked; draw(); }
    };
    box.onclick = (e) => {
      const id = e.target.id;
      if (id === "pkAll") { box.shown.forEach((p) => S.invite.add(p.key)); draw(); }
      else if (id === "pkNone") { box.shown.forEach((p) => S.invite.delete(p.key)); draw(); }
      else if (id === "pkAdd") {
        const ids = $("#pkPaste").value.split(/[\s,;]+/).filter(Boolean);
        const unknown = [];
        let added = 0;
        for (const raw of ids) {
          const k = empKey(raw);
          if (k && S.rosterMap.has(k)) { if (!S.invite.has(k)) added++; S.invite.add(k); }
          else unknown.push(raw);
        }
        $("#pkMsg").textContent = `Invited ${plural(added, "more person", "more people")}.` + (unknown.length ? ` Not on the roster: ${unknown.slice(0, 20).join(", ")}${unknown.length > 20 ? "..." : ""}.` : "");
        draw();
      }
    };
    draw();
  }

  async function save(overrides = {}) {
    const form = $("#evForm");
    const errEl = $("#formError");
    errEl.hidden = true;
    const btn = form.querySelector("[type=submit]");
    btn.disabled = true;
    const el = form.elements;
    const { audMode, audCompany, ...rest } = Object.fromEntries(new FormData(form));
    const body = {
      ...rest,
      id: S.sel?.id,
      status: S.sel?.status || "scheduled",
      rsvpEnabled: el.rsvpEnabled.checked,
      allowGuests: el.allowGuests.checked,
      notify: el.notify ? el.notify.checked : false,
      announce: el.announce ? el.announce.checked : false,
      audience: {
        mode: el.audMode.value,
        companies: [...form.querySelectorAll('[name="audCompany"]:checked')].map((c) => c.value),
        ids: [...S.invite],
      },
      ...overrides,
    };
    try {
      const r = await A("/api/events", { method: "POST", body });
      const n = r.notify?.recipients || 0;
      let msg = S.sel ? "Changes saved." : "Event posted.";
      if (r.notify?.queued) msg += ` Sending ${plural(n, "message", "messages")}.`;
      else if (n && !r.notify.queued) msg += " The update couldn't be queued. Check the Netlify function logs.";
      else if (S.sel && body.notify && !r.changes.length && !body.message) msg += " Nothing people need to hear about changed, so no update went out.";
      else if (S.sel && body.notify && !n) msg += " Nobody is following this event yet.";
      K.toast(msg);
      await loadEvents();
      edit(S.events.find((e) => e.id === r.event.id) || r.event);
    } catch (e) {
      errEl.textContent = e.message;
      errEl.hidden = false;
      btn.disabled = false;
      if (e.status === 401) setTimeout(() => location.reload(), 1500);
    }
  }

  async function remove() {
    const ev = S.sel;
    if (!confirm(`Delete "${ev.title}"? This removes it from the calendar along with its RSVPs and activity, and nobody is notified. To let people know, cancel it instead.`)) return;
    try {
      await A(`/api/events?id=${ev.id}`, { method: "DELETE" });
      K.toast("Event deleted.");
      await loadEvents();
      edit(null);
    } catch (e) {
      K.toast(e.message);
    }
  }

  // ── Event report ──────────────────────────────────────────────────────────
  const peopleState = { show: "invited", q: "" };

  async function loadPeople(ev) {
    const box = $("#people");
    box.hidden = false;
    box.innerHTML = `<div class="panel-head"><h2>People</h2></div><div class="panel-body">Loading…</div>`;
    let d;
    try {
      d = await A(`/api/admin?id=${ev.id}`);
    } catch (e) {
      box.innerHTML = `<div class="panel-head"><h2>People</h2></div><div class="panel-body error">${K.esc(e.message)}</div>`;
      return;
    }
    if (S.sel?.id !== ev.id) return;
    S.people = { ev, ...d };
    const st = d.stats;
    const pct = (n) => (st.invited ? ` (${Math.round((n / st.invited) * 100)}%)` : "");
    const log = d.log;
    const logLine = log
      ? `Last update sent ${dateOnly(log.at)}: ${plural(log.email, "email", "emails")}, ${plural(log.sms, "text", "texts")}${log.failed?.length ? `, ${log.failed.length} failed` : ""}${log.skipped?.length ? `. Not sent: ${log.skipped.join("; ")}` : ""}.`
      : "No updates sent yet.";
    box.innerHTML = `
      <div class="panel-head"><h2>People</h2>
        <div class="btnrow">
          <button class="btn btn-secondary" type="button" id="pCsv">Download RSVPs as CSV</button>
          <button class="btn btn-secondary" type="button" id="pXlsx">Download Excel</button>
        </div>
      </div>
      <div class="panel-body">
        <div class="stat">
          <div><b>${st.invited}</b><span>Can see it</span></div>
          <div><b>${st.viewed}</b><span>Viewed${pct(st.viewed)}</span></div>
          ${ev.rsvpEnabled ? `<div><b>${st.rsvps}</b><span>RSVP'd${pct(st.rsvps)}, ${st.headcount}${ev.rsvpCapacity ? ` of ${ev.rsvpCapacity}` : ""} with guests</span></div>` : ""}
          <div><b>${st.calendar}</b><span>Added to calendar (${st.calendarBy.outlook} Outlook, ${st.calendarBy.google} Google, ${st.calendarBy.ics} phone)</span></div>
          <div><b>${st.following}</b><span>Following this event, plus ${st.followingAll} following all</span></div>
        </div>
        <p class="hint" style="margin:0 0 14px">${K.esc(logLine)}</p>
        ${log?.failed?.length ? `<details style="margin:0 0 14px"><summary>See failures</summary><pre style="white-space:pre-wrap;font-size:12px">${K.esc(log.failed.join("\n"))}</pre></details>` : ""}
        <div class="toolbar">
          <input type="search" id="pQ" placeholder="Search name or ID" value="${K.esc(peopleState.q)}" aria-label="Search people">
          <select id="pShow" aria-label="Show">
            ${[["invited", "Everyone who can see it"], ["viewed", "Viewed"], ["notviewed", "Haven't viewed"], ...(ev.rsvpEnabled ? [["rsvp", "RSVP'd"], ["norsvp", "Haven't RSVP'd"]] : []), ["calendar", "Added to calendar"], ["following", "Following"]]
              .map(([val, label]) => `<option value="${val}"${peopleState.show === val ? " selected" : ""}>${label}</option>`)
              .join("")}
          </select>
        </div>
        <div class="scroll table-wrap" id="pTable"></div>
      </div>`;
    drawPeople();
    $("#pQ").addEventListener("input", (e) => { peopleState.q = e.target.value; drawPeople(); });
    $("#pShow").addEventListener("change", (e) => { peopleState.show = e.target.value; drawPeople(); });
    $("#pCsv").addEventListener("click", () => download(`${ev.title} RSVPs`, [{ name: "RSVPs", rows: rsvpRows() }], "csv"));
    $("#pXlsx").addEventListener("click", () =>
      download(`${ev.title} report`, [
        ...(ev.rsvpEnabled ? [{ name: "RSVPs", rows: rsvpRows() }] : []),
        { name: "Everyone", rows: activityRows(S.people.people) },
      ])
    );
  }

  function filteredPeople() {
    const { show, q } = peopleState;
    const f = {
      invited: (p) => p.invited,
      viewed: (p) => p.views > 0,
      notviewed: (p) => p.invited && !p.views,
      rsvp: (p) => p.rsvp,
      norsvp: (p) => p.invited && !p.rsvp,
      calendar: (p) => !!p.calendar,
      following: (p) => !!p.following,
    }[show] || (() => true);
    const ql = q.toLowerCase();
    return S.people.people.filter((p) => f(p) && (!ql || `${p.name} ${p.id}`.toLowerCase().includes(ql)));
  }

  function drawPeople() {
    const rows = filteredPeople();
    const ev = S.people.ev;
    $("#pTable").innerHTML = rows.length
      ? `<table><thead><tr><th>Name</th><th>ID</th><th>Company</th><th>Viewed</th><th>Calendar</th><th>Updates</th>${ev.rsvpEnabled ? "<th>RSVP</th><th>Guests</th>" : ""}</tr></thead><tbody>${rows
          .map(
            (p) => `<tr${p.invited ? "" : ' class="off"'}><td>${K.esc(p.name)}</td><td>${K.esc(p.id)}</td><td>${K.esc(p.company)}</td>
              <td>${p.views ? `${plural(p.views, "time", "times")}, last ${K.esc(dateOnly(p.lastViewed))}` : "No"}</td>
              <td>${K.esc(p.calendar || "No")}</td><td>${K.esc(p.following || "No")}</td>
              ${ev.rsvpEnabled ? `<td>${p.rsvp ? `Yes, ${K.esc(dateOnly(p.rsvpAt))}` : "No"}</td><td>${p.rsvp ? p.guests : ""}</td>` : ""}</tr>`
          )
          .join("")}</tbody></table>`
      : `<p class="fine" style="padding:14px">No one in this view yet.</p>`;
    labelTable($("#pTable"));
  }

  const rsvpRows = () =>
    S.people.people
      .filter((p) => p.rsvp)
      .map((p) => ({
        Name: p.name,
        "Employee ID": p.id,
        Company: p.company,
        Division: p.division,
        Office: p.office,
        Email: p.email,
        Mobile: showPhone(p.phone),
        Guests: p.guests,
        "Total headcount": 1 + p.guests,
        "RSVP date": p.rsvpAt ? K.azDate(Date.parse(p.rsvpAt)) : "",
      }));

  const activityRows = (people) =>
    people.map((p) => ({
      Name: p.name,
      "Employee ID": p.id,
      Company: p.company,
      Division: p.division,
      Office: p.office,
      "Can see event": p.invited ? "Yes" : "No",
      Views: p.views,
      "Last viewed": p.lastViewed ? K.azDate(Date.parse(p.lastViewed)) : "",
      "Added to calendar": p.calendar,
      "Following updates": p.following,
      "RSVP'd": p.rsvp ? "Yes" : "No",
      Guests: p.rsvp ? p.guests : "",
    }));

  // ── Roster ────────────────────────────────────────────────────────────────
  async function loadRoster() {
    S.roster = (await A("/api/employees")).employees || [];
    S.rosterMap = new Map(S.roster.map((e) => [e.key, e]));
    const sel = $("#rCompany");
    const cur = sel.value;
    sel.innerHTML = `<option value="">All companies</option>` + companies().map((c) => `<option${c === cur ? " selected" : ""}>${K.esc(c)}</option>`).join("");
  }

  function rosterFiltered() {
    const q = $("#rSearch").value.toLowerCase();
    const co = $("#rCompany").value;
    const st = $("#rStatus").value;
    return S.roster.filter(
      (e) =>
        (!co || e.company === co) &&
        (!st || (st === "active" ? e.active !== false : e.active === false)) &&
        (!q || `${e.first} ${e.last} ${e.preferred || ""} ${e.id}`.toLowerCase().includes(q))
    );
  }

  function renderRoster() {
    const rows = rosterFiltered();
    const active = S.roster.filter((e) => e.active !== false).length;
    $("#rosterTitle").textContent = `Employees (${active} can sign in)`;
    $("#rosterTable").innerHTML = rows.length
      ? `<table><thead><tr><th>Name</th><th>ID</th><th>Company</th><th>Division</th><th>Office</th><th>Email</th><th>Mobile</th><th>Access</th><th></th></tr></thead><tbody>${rows
          .map(
            (e) => `<tr${e.active === false ? ' class="off"' : ""}>
              <td>${K.esc(nameOf(e))}${e.preferred ? ` <span class="muted">(${K.esc(e.first)})</span>` : ""}</td><td>${K.esc(e.id)}</td>
              <td>${K.esc(e.company)}</td><td>${K.esc(e.division)}</td><td>${K.esc(e.office)}</td>
              <td>${K.esc(e.email)}</td><td>${K.esc(showPhone(e.phone))}</td><td>${e.active === false ? "Turned off" : "Can sign in"}</td>
              <td><span class="btnrow"><button class="btn btn-secondary" type="button" data-edit="${K.esc(e.key)}">Edit</button><button class="btn btn-danger" type="button" data-remove="${K.esc(e.key)}">Remove</button></span></td></tr>`
          )
          .join("")}</tbody></table>`
      : `<p class="fine" style="padding:14px">${S.roster.length ? "No one matches." : "No employees yet. Upload a spreadsheet above, or choose Add employee."}</p>`;
    labelTable($("#rosterTable"));
  }

  function editEmployee(emp) {
    const isNew = !emp;
    const e = emp || { active: true };
    const f = (id, label, val, extra = "") => field(`e-${id}`, label, `<input id="e-${id}" name="${id}" value="${K.esc(val || "")}" ${extra}>`);
    dlgBody.innerHTML = `
      <div class="dlg-head"><h2 id="dlgTitle">${isNew ? "Add employee" : `Edit ${K.esc(nameOf(e))}`}</h2><button class="x" type="button" data-close aria-label="Close">×</button></div>
      <form class="dlg-main form" id="empForm" novalidate>
        <div class="form-2">${f("first", "First name", e.first, "required")}${f("last", "Last name", e.last, "required")}</div>
        ${field("e-preferred", "Preferred name", `<input id="e-preferred" name="preferred" value="${K.esc(e.preferred || "")}">`, "Optional. They can sign in with this or their first name.")}
        ${f("id", "Employee ID", e.id, isNew ? "required" : "readonly")}
        ${isNew ? "" : `<span class="hint" style="margin-top:-8px">To change an ID, remove this person and add them again.</span>`}
        ${field("e-company", "Company", `<select id="e-company" name="company"><option value="">Choose a company</option>${companies().map((c) => `<option${c === e.company ? " selected" : ""}>${K.esc(c)}</option>`).join("")}</select>`, "Add companies in the Companies section on the Employees tab.")}
        <div class="form-2">${f("division", "Division", e.division)}${f("office", "Office", e.office)}</div>
        <div class="form-2">${f("email", "Email", e.email, 'type="email"')}${f("phone", "Mobile", showPhone(e.phone), 'type="tel"')}</div>
        <label class="check"><input type="checkbox" name="active"${e.active !== false ? " checked" : ""}><span>Can sign in and see events</span></label>
        <p class="error" hidden></p>
        <div class="btnrow"><button class="btn btn-primary" type="submit">${isNew ? "Add employee" : "Save changes"}</button><button class="btn btn-secondary" type="button" data-close>Cancel</button></div>
      </form>`;
    dlg.showModal();
    $("#empForm").addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const form = ev.target;
      const errEl = form.querySelector(".error");
      const data = Object.fromEntries(new FormData(form));
      try {
        await A("/api/employees", { method: "PUT", body: { ...data, active: form.elements.active.checked, isNew } });
        dlg.close();
        K.toast(isNew ? "Employee added." : "Changes saved.");
        await loadRoster();
        renderRoster();
        renderCompanies();
      } catch (e2) {
        errEl.textContent = e2.message;
        errEl.hidden = false;
      }
    });
  }

  async function removeEmployee(key) {
    const e = S.rosterMap.get(key);
    if (!confirm(`Remove ${nameOf(e)} (#${e.id})? They won't be able to sign in. Their past RSVPs stay in event reports. To keep them on the list but block sign-in, edit them and turn off access instead.`)) return;
    try {
      await A(`/api/employees?id=${encodeURIComponent(e.id)}`, { method: "DELETE" });
      K.toast("Employee removed.");
      await loadRoster();
      renderRoster();
      renderCompanies();
    } catch (err) {
      K.toast(err.message);
    }
  }

  // ── Companies ─────────────────────────────────────────────────────────────
  async function loadCompanies() {
    try {
      const list = (await A("/api/companies")).companies;
      if (list?.length) companyList = list;
    } catch {}
  }

  function renderCompanies() {
    const box = $("#companies");
    const count = (c) => S.roster.filter((e) => e.company === c).length;
    const extra = [...new Set(S.roster.map((e) => e.company).filter((c) => c && !companyList.includes(c)))];
    box.innerHTML = `
      <p class="fine" style="margin:0 0 12px">These appear in every company dropdown, in uploads, and in "Who can see it" on events.</p>
      <div class="table-wrap"><table><thead><tr><th>Company</th><th>Employees</th><th></th></tr></thead><tbody>
        ${companyList.map((c) => `<tr><td>${K.esc(c)}</td><td>${count(c)}</td><td><button class="btn btn-danger" type="button" data-co-remove="${K.esc(c)}">Remove</button></td></tr>`).join("")}
      </tbody></table></div>
      ${extra.length ? `<p class="warn" style="margin:12px 0 0">Some employees have a company that isn't on this list: ${extra.map((c) => `${K.esc(c)} (${count(c)})`).join(", ")}. Add it here, or edit those employees.</p>` : ""}
      <form class="toolbar" id="coForm" style="margin:14px 0 0">
        <input id="coName" placeholder="Company name" maxlength="40" aria-label="New company name" style="flex:1;min-width:200px">
        <button class="btn btn-primary" type="submit">Add company</button>
      </form>
      <p class="error" id="coError" hidden></p>`;
    $("#coForm").addEventListener("submit", (e) => {
      e.preventDefault();
      const name = $("#coName").value.trim();
      if (!name) return;
      const key = (c) => c.toLowerCase().replace(/[^a-z0-9]/g, "");
      const dup = companyList.find((c) => key(c) === key(name));
      if (dup) {
        const el = $("#coError");
        el.textContent = `${dup} is already on the list.`;
        el.hidden = false;
        return;
      }
      saveCompanyList([...companyList, name], `${name} added.`);
    });
    box.querySelectorAll("[data-co-remove]").forEach((b) =>
      b.addEventListener("click", () => {
        const c = b.dataset.coRemove;
        if (confirm(`Remove ${c} from the company list?`)) saveCompanyList(companyList.filter((x) => x !== c), `${c} removed.`);
      })
    );
  }

  async function saveCompanyList(next, msg) {
    try {
      companyList = (await A("/api/companies", { method: "PUT", body: { companies: next } })).companies;
      K.toast(msg);
      await loadRoster();
      renderCompanies();
      renderRoster();
      if (!S.upload?.result) renderUpload();
    } catch (e) {
      const el = $("#coError");
      el.textContent = e.message;
      el.hidden = false;
    }
  }

  // ── Bulk upload ───────────────────────────────────────────────────────────
  const UPLOAD_FIELDS = [
    { k: "id", label: "Employee ID", syn: ["employee id", "employeeid", "emp id", "empid", "employee #", "employee no", "employee number", "emp #", "emp no", "id", "badge", "badge #", "employee code"] },
    { k: "first", label: "First name", syn: ["first name", "firstname", "first", "given name", "fname", "legal first name"] },
    { k: "last", label: "Last name", syn: ["last name", "lastname", "last", "surname", "family name", "lname", "legal last name"] },
    { k: "name", label: "Full name (only if no first and last columns)", syn: ["name", "full name", "employee name", "fullname"] },
    { k: "preferred", label: "Preferred name", syn: ["preferred name", "preferred", "nickname", "goes by", "known as", "preferred first name"] },
    { k: "company", label: "Company", syn: ["company", "company name", "entity", "employer", "co", "company code"] },
    { k: "email", label: "Email", syn: ["email", "e mail", "email address", "work email", "personal email"] },
    { k: "phone", label: "Mobile", syn: ["mobile", "cell", "cell phone", "mobile phone", "phone", "phone number", "mobile number", "cell number"] },
    { k: "division", label: "Division", syn: ["division", "department", "dept", "group"] },
    { k: "office", label: "Office or location", syn: ["office", "location", "branch", "site", "work location"] },
  ];
  const normHead = (h) => String(h).toLowerCase().replace(/[^a-z0-9#]+/g, " ").trim();

  function renderUpload() {
    const u = S.upload;
    const box = $("#upload");
    if (!u) {
      box.innerHTML = `
        <div class="drop" id="drop">
          <p style="margin:0 0 12px">Drop an Excel or CSV file here, or choose one.</p>
          <label class="btn btn-primary" style="display:inline-flex">Choose file<input type="file" id="file" accept=".xlsx,.xls,.csv" hidden></label>
          <p class="fine" style="margin-top:12px">Needs name and employee ID columns. Company, preferred name, email, mobile, division, and office are optional. People already on the roster get updated. Nobody missing from the file is changed.</p>
        </div>`;
      const drop = $("#drop");
      $("#file").addEventListener("change", (e) => e.target.files[0] && readUpload(e.target.files[0]));
      drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("over"); });
      drop.addEventListener("dragleave", () => drop.classList.remove("over"));
      drop.addEventListener("drop", (e) => {
        e.preventDefault();
        drop.classList.remove("over");
        if (e.dataTransfer.files[0]) readUpload(e.dataTransfer.files[0]);
      });
      return;
    }
    if (u.result) {
      const r = u.result;
      box.innerHTML = `<div class="result">Upload finished: ${r.added} added, ${r.updated} updated, ${r.unchanged} unchanged${r.skipped.length ? `, ${r.skipped.length} skipped` : ""}.
        ${r.skipped.length ? `<ul>${r.skipped.slice(0, 50).map((s) => `<li>Row ${s.row}: ${K.esc(s.reason)}</li>`).join("")}${r.skipped.length > 50 ? `<li>And ${r.skipped.length - 50} more</li>` : ""}</ul>` : ""}</div>
        <div style="margin-top:14px"><button class="btn btn-secondary" type="button" id="upAgain">Upload another file</button></div>`;
      $("#upAgain").addEventListener("click", () => { S.upload = null; renderUpload(); });
      return;
    }
    const opts = (cur) => `<option value="">Not in this file</option>` + u.headers.map((h, i) => `<option value="${i}"${cur === i ? " selected" : ""}>${K.esc(h || `Column ${i + 1}`)}</option>`).join("");
    const mapped = mapRows();
    const ready = mapped.filter((r) => empKey(r.id) && r.first && r.last).length;
    box.innerHTML = `
      <p style="margin-top:0"><strong>${K.esc(u.fileName)}</strong>: ${plural(u.data.length, "row", "rows")}. Check that each field points to the right column.</p>
      <div class="map-grid">
        ${UPLOAD_FIELDS.map((f) => `<div class="field"><label for="map-${f.k}">${f.label}</label><select id="map-${f.k}" data-map="${f.k}">${opts(u.map[f.k])}</select></div>`).join("")}
        <div class="field"><label for="map-default">Company for rows without one</label><select id="map-default"><option value="">Leave blank</option>${companies().map((c) => `<option${u.defaultCompany === c ? " selected" : ""}>${K.esc(c)}</option>`).join("")}</select></div>
      </div>
      <h3 style="margin:20px 0 8px;font-size:16px">Preview</h3>
      <div class="table-wrap"><table><thead><tr><th>Row</th><th>ID</th><th>First</th><th>Last</th><th>Preferred</th><th>Company</th><th>Email</th><th>Mobile</th><th>Division</th><th>Office</th></tr></thead><tbody>
        ${mapped.slice(0, 5).map((r) => `<tr><td>${r.rowNumber}</td>${["id", "first", "last", "preferred", "company", "email", "phone", "division", "office"].map((k) => `<td>${K.esc(r[k] || (k === "company" ? u.defaultCompany : ""))}</td>`).join("")}</tr>`).join("")}
      </tbody></table></div>
      <p class="${ready ? "fine" : "error"}" style="margin:12px 0">${ready ? `${plural(ready, "row is", "rows are")} ready.${mapped.length - ready ? ` ${mapped.length - ready} missing a name or ID will be skipped.` : ""}` : "No rows have a name and an employee ID yet. Check the column choices above."}</p>
      <div class="btnrow"><button class="btn btn-primary" type="button" id="upGo"${ready ? "" : " disabled"}>Import ${plural(ready, "employee", "employees")}</button><button class="btn btn-secondary" type="button" id="upCancel">Choose a different file</button></div>`;
    box.querySelectorAll("[data-map]").forEach((s) =>
      s.addEventListener("change", () => { u.map[s.dataset.map] = s.value === "" ? undefined : +s.value; renderUpload(); })
    );
    $("#map-default").addEventListener("change", (e) => { u.defaultCompany = e.target.value; renderUpload(); });
    $("#upCancel").addEventListener("click", () => { S.upload = null; renderUpload(); });
    $("#upGo").addEventListener("click", importUpload);
  }

  async function readUpload(file) {
    if (!window.XLSX) return K.toast("The spreadsheet tool didn't load. Reload the page and try again.");
    try {
      const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: false, defval: "" });
      const h = rows.findIndex((r) => r.filter((c) => String(c).trim()).length >= 2);
      if (h < 0) throw new Error("Couldn't find a header row in the first sheet.");
      const headers = rows[h].map((c) => String(c).trim());
      const data = rows
        .slice(h + 1)
        .map((r, i) => ({ r, rowNumber: h + i + 2 }))
        .filter(({ r }) => r.some((c) => String(c).trim()));
      const map = {};
      const used = new Set();
      for (const f of UPLOAD_FIELDS) {
        const i = headers.findIndex((hd, idx) => !used.has(idx) && f.syn.includes(normHead(hd)));
        if (i >= 0) { map[f.k] = i; used.add(i); }
      }
      if (map.first !== undefined && map.last !== undefined) delete map.name;
      S.upload = { fileName: file.name, headers, data, map, defaultCompany: "" };
      renderUpload();
    } catch (e) {
      K.toast(`Couldn't read that file. ${e.message}`);
    }
  }

  function mapRows() {
    const u = S.upload;
    const get = (r, k) => (u.map[k] === undefined ? "" : String(r[u.map[k]] ?? "").trim());
    return u.data.map(({ r, rowNumber }) => {
      const o = { rowNumber };
      for (const f of UPLOAD_FIELDS) o[f.k] = get(r, f.k);
      if ((!o.first || !o.last) && o.name) {
        if (o.name.includes(",")) {
          const [last, rest] = o.name.split(/,(.+)/);
          o.last = o.last || last.trim();
          o.first = o.first || String(rest || "").trim().split(/\s+/)[0];
        } else {
          const parts = o.name.split(/\s+/);
          o.first = o.first || parts[0];
          o.last = o.last || (parts.length > 1 ? parts[parts.length - 1] : "");
        }
      }
      delete o.name;
      return o;
    });
  }

  async function importUpload() {
    const btn = $("#upGo");
    btn.disabled = true;
    btn.textContent = "Importing…";
    try {
      const result = await A("/api/employees", { method: "POST", body: { rows: mapRows(), defaultCompany: S.upload.defaultCompany } });
      S.upload.result = result;
      await Promise.all([loadRoster(), loadCompanies()]);
      renderUpload();
      renderRoster();
      renderCompanies();
    } catch (e) {
      K.toast(e.message);
      btn.disabled = false;
      btn.textContent = "Try again";
    }
  }

  // ── Reports ───────────────────────────────────────────────────────────────
  let summary = [];
  async function loadSummary() {
    const box = $("#summary");
    box.innerHTML = "Loading…";
    try {
      const d = await A("/api/admin?summary=1");
      summary = d.rows;
    } catch (e) {
      box.innerHTML = `<p class="error">${K.esc(e.message)}</p>`;
      return;
    }
    const pct = (n, of) => (of ? `${n} <span class="muted">(${Math.round((n / of) * 100)}%)</span>` : String(n));
    box.innerHTML = summary.length
      ? `<div class="table-wrap"><table><thead><tr><th>Event</th><th>Date</th><th>Who</th><th>Can see</th><th>Viewed</th><th>RSVP'd</th><th>Headcount</th><th>Added to calendar</th><th>Following</th></tr></thead><tbody>${summary
          .map(
            (r) => `<tr style="cursor:pointer" data-open="${r.id}"><td><strong>${r.status === "cancelled" ? "Cancelled: " : ""}${K.esc(r.title)}</strong></td><td>${K.esc(K.fmtDate(r.startDate))}</td>
              <td>${K.esc(audienceLabel(r.audience))}</td><td>${r.invited}</td><td>${pct(r.viewed, r.invited)}</td>
              <td>${r.rsvpEnabled ? pct(r.rsvps, r.invited) : "No RSVP"}</td><td>${r.rsvpEnabled ? `${r.headcount}${r.rsvpCapacity ? ` of ${r.rsvpCapacity}` : ""}` : ""}</td>
              <td>${pct(r.calendar, r.invited)}</td><td>${r.following}</td></tr>`
          )
          .join("")}</tbody></table></div><p class="fine" style="margin-top:10px">Choose an event to see who viewed, RSVP'd, and added it.</p>`
      : `<p class="fine">No events yet.</p>`;
    labelTable($("#summary"));
  }
  const summaryRows = () =>
    summary.map((r) => ({
      Event: r.title,
      Date: r.startDate,
      Status: r.status === "cancelled" ? "Cancelled" : "Scheduled",
      "Who can see it": audienceLabel(r.audience),
      "Can see it": r.invited,
      Viewed: r.viewed,
      "RSVP'd": r.rsvpEnabled ? r.rsvps : "",
      Headcount: r.rsvpEnabled ? r.headcount : "",
      Capacity: r.rsvpCapacity || "",
      "Added to calendar": r.calendar,
      "Following updates": r.following,
    }));

  // ── Wiring ────────────────────────────────────────────────────────────────
  function bind() {
    if (S.bound) return;
    S.bound = true;
    document.querySelectorAll("[data-tab]").forEach((b) => b.addEventListener("click", () => switchTab(b.dataset.tab)));
    $("#newBtn").addEventListener("click", () => edit(null));
    $("#tabUp").addEventListener("click", () => { S.list = "up"; renderList(); });
    $("#tabPast").addEventListener("click", () => { S.list = "past"; renderList(); });
    $("#elist").addEventListener("click", (e) => {
      const b = e.target.closest("[data-id]");
      if (b) {
        edit(S.events.find((x) => x.id === b.dataset.id));
        if (matchMedia("(max-width: 860px)").matches) $("#editor").scrollIntoView({ behavior: "smooth" });
      }
    });
    ["rSearch", "rCompany", "rStatus"].forEach((id) => $(`#${id}`).addEventListener("input", renderRoster));
    $("#addEmp").addEventListener("click", () => editEmployee(null));
    $("#rosterTable").addEventListener("click", (e) => {
      const ed = e.target.closest("[data-edit]")?.dataset.edit;
      const rm = e.target.closest("[data-remove]")?.dataset.remove;
      if (ed) editEmployee(S.rosterMap.get(ed));
      if (rm) removeEmployee(rm);
    });
    $("#rosterExport").addEventListener("click", () =>
      download("BDL employees", [
        {
          name: "Employees",
          rows: S.roster.map((e) => ({
            "First name": e.first, "Last name": e.last, "Preferred name": e.preferred || "", "Employee ID": e.id,
            Company: e.company, Division: e.division, Office: e.office, Email: e.email, Mobile: showPhone(e.phone),
            Access: e.active === false ? "Turned off" : "Can sign in",
          })),
        },
      ])
    );
    $("#summary").addEventListener("click", (e) => {
      const id = e.target.closest("[data-open]")?.dataset.open;
      if (!id) return;
      switchTab("events");
      edit(S.events.find((x) => x.id === id));
      setTimeout(() => $("#people").scrollIntoView({ behavior: "smooth" }), 300);
    });
    $("#sumCsv").addEventListener("click", () => download("BDL events summary", [{ name: "Events", rows: summaryRows() }], "csv"));
    $("#sumXlsx").addEventListener("click", () => download("BDL events summary", [{ name: "Events", rows: summaryRows() }]));
    dlg.addEventListener("click", (e) => {
      if (e.target === dlg || e.target.closest("[data-close]")) dlg.close();
    });
  }

  boot();
})();
