(() => {
  const K = window.KEG;
  const $ = (s, r = document) => r.querySelector(s);
  const S = { events: [], sel: null, tab: "up", cfg: null, bound: false };

  // ── Sign in ───────────────────────────────────────────────────────────────
  async function boot() {
    if (!K.session.get("kegEventsAdmin")) return showLogin();
    try {
      S.cfg = await K.api("/api/config");
      if (!S.cfg.admin) throw Object.assign(new Error("That password didn't work."), { status: 401 });
    } catch (e) {
      K.session.del("kegEventsAdmin");
      return showLogin(e.message);
    }
    $("#login").hidden = true;
    $("#app").hidden = false;
    $("#signOut").hidden = false;
    renderWarnings();
    bind();
    await load();
    edit(null);
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
    K.session.set("kegEventsAdmin", $("#pw").value);
    boot();
  });
  $("#signOut").addEventListener("click", () => {
    K.session.del("kegEventsAdmin");
    location.reload();
  });

  function renderWarnings() {
    const w = [];
    if (!S.cfg.emailReady) w.push("Email isn't set up yet, so no emails will go out. Add the Microsoft Graph settings in Netlify to turn it on.");
    if (!S.cfg.smsReady) w.push("Texting isn't set up yet, so no texts will go out. Add the Azure Communication Services settings in Netlify to turn it on.");
    $("#warnings").innerHTML = w.map((t) => `<div class="warn">${K.esc(t)}</div>`).join("");
  }

  async function load() {
    S.events = (await K.api("/api/events")).events || [];
    renderList();
  }

  const lastDay = (ev) => ev.endDate || ev.startDate;

  // ── Event list ────────────────────────────────────────────────────────────
  function renderList() {
    const today = K.todayAZ();
    let list = S.events.filter((e) => (S.tab === "up" ? lastDay(e) >= today : lastDay(e) < today));
    if (S.tab === "past") list = list.reverse();
    $("#tabUp").setAttribute("aria-pressed", S.tab === "up");
    $("#tabPast").setAttribute("aria-pressed", S.tab === "past");
    $("#elist").innerHTML = list.length
      ? list
          .map(
            (e) => `<li><button type="button" data-id="${e.id}" aria-current="${S.sel?.id === e.id}">
            <span class="t">${e.status === "cancelled" ? "Cancelled: " : ""}${K.esc(e.title)}</span>
            <span class="s">${K.esc(K.fmtDate(e.startDate))}${e.startTime ? `, ${K.fmtTime(e.startTime)}` : ""}${e.rsvpEnabled ? `, ${e.rsvpCount || 0} going` : ""}</span>
          </button></li>`
          )
          .join("")
      : `<li style="padding:16px;color:var(--muted)">${S.tab === "up" ? "No upcoming events. Choose New event to post one." : "No past events yet."}</li>`;
  }

  // ── Editor ────────────────────────────────────────────────────────────────
  const v = (ev, k) => K.esc(ev?.[k] ?? "");

  function edit(ev) {
    S.sel = ev;
    renderList();
    const isNew = !ev;
    const cancelled = ev?.status === "cancelled";
    const cats = [...new Set(S.events.flatMap((e) => e.categories || []))].sort();
    const field = (id, label, input, hint = "") =>
      `<div class="field"><label for="${id}">${label}</label>${input}${hint ? `<span class="hint">${hint}</span>` : ""}</div>`;

    $("#editor").innerHTML = `
      <div class="panel-head"><h2>${isNew ? "New event" : "Edit event"}</h2>${cancelled ? `<span class="flag flag-cancelled">Cancelled</span>` : ""}</div>
      <form class="panel-body form" id="evForm" novalidate>
        ${field("title", "Title", `<input id="title" name="title" required maxlength="140" value="${v(ev, "title")}">`)}
        <div class="field">
          <label for="categories">Categories</label>
          <input id="categories" name="categories" value="${K.esc((ev?.categories || []).join(", "))}" placeholder="Safety, ESOP, Family">
          <span class="hint">Separate with commas. People can filter the calendar by these.</span>
          ${cats.length ? `<div class="suggest" id="catSuggest">${cats.map((c) => `<button type="button" data-cat="${K.esc(c)}">${K.esc(c)}</button>`).join("")}</div>` : ""}
        </div>
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
            ${field("feeNote", "Cost note", `<input id="feeNote" name="feeNote" value="${v(ev, "feeNote")}" placeholder="Free for employee-owners, $10 per guest">`, "Optional.")}
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
              ? `<label class="check"><input type="checkbox" name="announce"><span>Announce this event to everyone following all events</span></label>`
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

  async function save(overrides = {}) {
    const form = $("#evForm");
    const errEl = $("#formError");
    errEl.hidden = true;
    const btn = form.querySelector("[type=submit]");
    btn.disabled = true;
    const el = form.elements;
    const body = {
      ...Object.fromEntries(new FormData(form)),
      id: S.sel?.id,
      status: S.sel?.status || "scheduled",
      rsvpEnabled: el.rsvpEnabled.checked,
      allowGuests: el.allowGuests.checked,
      notify: el.notify ? el.notify.checked : false,
      announce: el.announce ? el.announce.checked : false,
      ...overrides,
    };
    try {
      const r = await K.api("/api/events", { method: "POST", body });
      const n = r.notify?.recipients || 0;
      let msg = S.sel ? "Changes saved." : "Event posted.";
      if (r.notify?.queued) msg += ` Sending ${n} ${n === 1 ? "message" : "messages"}.`;
      else if (r.notify?.recipients && !r.notify.queued) msg += " The update couldn't be queued. Check the Netlify function logs.";
      else if (S.sel && body.notify && !r.changes.length && !body.message) msg += " Nothing people need to hear about changed, so no update went out.";
      else if (S.sel && body.notify && (r.changes.length || body.message) && !n) msg += " Nobody is following this event yet.";
      K.toast(msg);
      await load();
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
    if (!confirm(`Delete "${ev.title}"? This removes it from the calendar along with its RSVPs, and nobody is notified. To let people know, cancel it instead.`)) return;
    try {
      await K.api(`/api/events?id=${ev.id}`, { method: "DELETE" });
      K.toast("Event deleted.");
      await load();
      edit(null);
    } catch (e) {
      K.toast(e.message);
    }
  }

  // ── RSVPs and followers ───────────────────────────────────────────────────
  const showPhone = (p) => (p && p.startsWith("+1") && p.length === 12 ? `${p.slice(2, 5)}-${p.slice(5, 8)}-${p.slice(8)}` : p || "");

  async function loadPeople(ev) {
    const box = $("#people");
    box.hidden = false;
    box.innerHTML = `<div class="panel-head"><h2>People</h2></div><div class="panel-body">Loading…</div>`;
    let d;
    try {
      d = await K.api(`/api/admin?id=${ev.id}`);
    } catch (e) {
      box.innerHTML = `<div class="panel-head"><h2>People</h2></div><div class="panel-body error">${K.esc(e.message)}</div>`;
      return;
    }
    if (S.sel?.id !== ev.id) return;
    const head = d.rsvps.reduce((n, r) => n + 1 + (r.guests || 0), 0);
    const emails = d.subs.filter((s) => s.method !== "sms").length;
    const texts = d.subs.filter((s) => s.method !== "email").length;
    const log = d.log;
    const logLine = log
      ? `Last update sent ${K.fmtDate(K.azDate(Date.parse(log.at)), false)}: ${log.email} ${log.email === 1 ? "email" : "emails"}, ${log.sms} ${log.sms === 1 ? "text" : "texts"}${
          log.failed?.length ? `, ${log.failed.length} failed` : ""
        }${log.skipped?.length ? `. Not sent: ${log.skipped.join("; ")}` : ""}.`
      : "No updates sent yet.";

    box.innerHTML = `<div class="panel-head"><h2>People</h2>${d.rsvps.length ? `<button class="btn btn-secondary" type="button" id="csv">Download RSVPs (CSV)</button>` : ""}</div>
      <div class="panel-body">
        <div class="stat">
          ${ev.rsvpEnabled ? `<div><b>${head}${ev.rsvpCapacity ? ` / ${ev.rsvpCapacity}` : ""}</b><span>Going, with guests</span></div>` : ""}
          <div><b>${d.subs.length}</b><span>Following this event (${emails} by email, ${texts} by text)</span></div>
          <div><b>${d.followingAll}</b><span>Following all events</span></div>
        </div>
        <p class="hint" style="margin:0 0 14px">${K.esc(logLine)}</p>
        ${log?.failed?.length ? `<details style="margin:0 0 14px"><summary>See failures</summary><pre style="white-space:pre-wrap;font-size:12px">${K.esc(log.failed.join("\n"))}</pre></details>` : ""}
        ${
          ev.rsvpEnabled
            ? d.rsvps.length
              ? `<div class="table-wrap"><table><thead><tr><th>Name</th><th>Email</th><th>Mobile</th><th>Guests</th><th>RSVP'd</th></tr></thead><tbody>${d.rsvps
                  .map(
                    (r) =>
                      `<tr><td>${K.esc(r.name)}</td><td>${K.esc(r.email)}</td><td>${K.esc(showPhone(r.phone))}</td><td>${r.guests || 0}</td><td>${K.esc(
                        K.fmtDate(K.azDate(Date.parse(r.createdAt)), false)
                      )}</td></tr>`
                  )
                  .join("")}</tbody></table></div>`
              : `<p class="hint" style="margin:0">No RSVPs yet.</p>`
            : ""
        }
      </div>`;

    $("#csv")?.addEventListener("click", () => {
      const q = (s) => `"${String(s ?? "").replace(/"/g, '""')}"`;
      const rows = [["Name", "Email", "Mobile", "Guests", "RSVP date"], ...d.rsvps.map((r) => [r.name, r.email, showPhone(r.phone), r.guests || 0, r.createdAt.slice(0, 10)])];
      const blob = new Blob([rows.map((r) => r.map(q).join(",")).join("\r\n")], { type: "text/csv" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${ev.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-rsvps.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
    });
  }

  function bind() {
    if (S.bound) return;
    S.bound = true;
    $("#newBtn").addEventListener("click", () => edit(null));
    $("#tabUp").addEventListener("click", () => { S.tab = "up"; renderList(); });
    $("#tabPast").addEventListener("click", () => { S.tab = "past"; renderList(); });
    $("#elist").addEventListener("click", (e) => {
      const b = e.target.closest("[data-id]");
      if (b) {
        edit(S.events.find((x) => x.id === b.dataset.id));
        if (matchMedia("(max-width: 860px)").matches) $("#editor").scrollIntoView({ behavior: "smooth" });
      }
    });
  }

  boot();
})();
