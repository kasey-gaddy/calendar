(() => {
  const K = window.KEG;
  const $ = (s, r = document) => r.querySelector(s);
  const state = {
    events: [],
    y: 0,
    m: 0,
    view: matchMedia("(min-width: 760px)").matches ? "month" : "list",
    cat: "",
    bound: false,
    me: null,
  };
  const dlg = $("#dlg");
  const dlgBody = $("#dlgBody");

  // ── Boot and sign-in ──────────────────────────────────────────────────────
  async function boot() {
    const [y, m] = K.todayAZ().split("-").map(Number);
    state.y = y;
    state.m = m;
    if (!K.local.get("bdlSession")) return showGate();
    try {
      const cfg = await K.api("/api/me");
      state.me = cfg.viewer;
    } catch (e) {
      if (e.status === 401) {
        K.local.del("bdlSession");
        return showGate("Your sign-in expired. Sign in again.");
      }
      return showGate(e.message);
    }
    $("#gate").hidden = true;
    try {
      await load();
    } catch (e) {
      return showGate(e.message);
    }
    $("#who").textContent = `${state.me.first} ${state.me.last}`;
    $("#app").hidden = false;
    $("#barActions").hidden = false;
    bind();

    const id = new URLSearchParams(location.search).get("event");
    if (id) {
      const ev = find(id);
      if (ev) {
        const p = K.parts(ev.startDate);
        state.y = p.y;
        state.m = p.m;
        render();
        openEvent(ev);
      } else {
        K.toast("That event isn't on your calendar.");
      }
    }
  }

  function showGate(message) {
    $("#gate").hidden = false;
    $("#app").hidden = true;
    $("#barActions").hidden = true;
    const e = $("#gateError");
    e.textContent = message || "";
    e.hidden = !message;
    $("#gateId").focus();
  }

  $("#gateForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector("[type=submit]");
    btn.disabled = true;
    try {
      const r = await K.api("/api/auth", {
        method: "POST",
        body: { employeeId: $("#gateId").value, first: $("#gateFirst").value, last: $("#gateLast").value },
      });
      K.local.set("bdlSession", r.token);
      await boot();
    } catch (err) {
      showGate(err.message);
    }
    btn.disabled = false;
  });

  // Any expired session sends people back to sign in.
  async function call(path, opts) {
    try {
      return await K.api(path, opts);
    } catch (e) {
      if (e.status === 401) {
        K.local.del("bdlSession");
        if (dlg.open) dlg.close();
        showGate("Your sign-in expired. Sign in again.");
      }
      throw e;
    }
  }

  async function load() {
    const data = await call("/api/events");
    state.events = data.events || [];
    K.setCategories(state.events.flatMap((e) => e.categories || []));
    render();
  }

  const find = (id) => state.events.find((e) => e.id === id);
  const lastDay = (ev) => (ev.endDate && ev.endDate > ev.startDate ? ev.endDate : ev.startDate);
  const visible = () => state.events.filter((e) => !state.cat || (e.categories || []).includes(state.cat));
  const onDay = (list, date) => list.filter((e) => date >= e.startDate && date <= lastDay(e));
  const color = (ev) => (ev.categories?.length ? K.catColor(ev.categories[0]) : "#103F91");
  const recent = (ev) => ev.lastChanges && ev.status !== "cancelled" && Date.now() - Date.parse(ev.lastChanges.at) < 10 * 864e5;
  const rsvpOpen = (ev) => {
    if (!ev.rsvpEnabled || ev.status === "cancelled") return false;
    if (ev.rsvpDeadline && ev.rsvpDeadline < K.todayAZ()) return false;
    if (ev.rsvpCapacity && (ev.rsvpCount || 0) >= ev.rsvpCapacity) return false;
    return true;
  };

  function monthRange() {
    const first = K.iso(state.y, state.m, 1);
    const last = K.addDays(K.iso(state.y, state.m + 1, 1), -1);
    return { first, last };
  }

  function shiftMonth(n) {
    const d = new Date(Date.UTC(state.y, state.m - 1 + n, 1));
    state.y = d.getUTCFullYear();
    state.m = d.getUTCMonth() + 1;
    render();
  }

  // ── Rendering ─────────────────────────────────────────────────────────────
  function render() {
    $("#monthName").textContent = K.MONL[state.m - 1];
    $("#yearName").textContent = state.y;
    $("#vList").setAttribute("aria-pressed", state.view === "list");
    $("#vMonth").setAttribute("aria-pressed", state.view === "month");
    renderChips();
    if (state.view === "list") renderList();
    else renderMonth();
  }

  function renderChips() {
    const cats = [...new Set(state.events.flatMap((e) => e.categories || []))].sort((a, b) => a.localeCompare(b));
    const box = $("#chips");
    if (!cats.length) {
      box.innerHTML = "";
      return;
    }
    if (state.cat && !cats.includes(state.cat)) state.cat = "";
    box.innerHTML =
      `<button class="chip" type="button" data-cat="" aria-pressed="${!state.cat}">All events</button>` +
      cats
        .map((c) => `<button class="chip" type="button" data-cat="${K.esc(c)}" aria-pressed="${state.cat === c}" style="--c:${K.catColor(c)}"><i></i>${K.esc(c)}</button>`)
        .join("");
  }

  function catTags(ev) {
    return (ev.categories || []).map((c) => `<span class="tag" style="--c:${K.catColor(c)}"><i></i>${K.esc(c)}</span>`).join("");
  }

  function flags(ev) {
    const f = [];
    if (ev.status === "cancelled") f.push(`<span class="flag flag-cancelled">Cancelled</span>`);
    else if (recent(ev)) f.push(`<span class="flag flag-updated">Updated</span>`);
    if (ev.rsvpEnabled && ev.status !== "cancelled") f.push(`<span class="flag flag-rsvp">${ev.me?.rsvp ? "You're going" : "RSVP"}</span>`);
    const aud = audienceText(ev);
    if (aud) f.push(`<span class="flag flag-audience">${K.esc(aud)}</span>`);
    if (ev.fee) f.push(`<span class="flag flag-cost">${K.money(ev.fee)}</span>`);
    const all = f.join("") + catTags(ev);
    return all ? `<span class="tags">${all}</span>` : "";
  }

  function audienceText(ev) {
    const a = ev.audience || {};
    if (a.mode === "invite") return "Invite only";
    if (a.mode === "companies" && a.companies?.length) return `${a.companies.join(" and ")} only`;
    return "";
  }

  function rowHTML(ev) {
    const p = K.parts(ev.startDate);
    const otherMonth = p.m !== state.m || p.y !== state.y;
    const cls = ["row"];
    if (ev.status === "cancelled") cls.push("cancelled");
    if (lastDay(ev) < K.todayAZ()) cls.push("past");
    const where = ev.locationName || ev.address;
    return `<button class="${cls.join(" ")}" type="button" data-id="${ev.id}">
      <span class="dateblock"><span class="d">${p.d}</span><span class="w">${otherMonth ? K.MON[p.m - 1] : K.DOW[p.dow]}</span></span>
      <span class="row-info">
        <span class="row-title">${K.esc(ev.title)}</span>
        <span class="meta">${K.esc(K.timeText(ev))}</span>
        ${where ? `<span class="meta">${K.esc(where)}</span>` : ""}
        ${flags(ev)}
      </span>
    </button>`;
  }

  function renderList() {
    const { first, last } = monthRange();
    const evs = visible().filter((e) => e.startDate <= last && lastDay(e) >= first);
    if (!evs.length) {
      const filtered = state.cat ? ` in ${K.esc(state.cat)}` : "";
      $("#view").innerHTML = `<div class="empty"><p>Nothing on the calendar${filtered} for ${K.MONL[state.m - 1]}.</p><button class="btn btn-secondary" type="button" data-act="next-month">Check ${K.MONL[state.m % 12]}</button></div>`;
      return;
    }
    $("#view").innerHTML = `<div class="list">${evs.map(rowHTML).join("")}</div>`;
  }

  function renderMonth() {
    const { first, last } = monthRange();
    const lead = K.parts(first).dow;
    const weeks = Math.ceil((lead + K.parts(last).d) / 7);
    const today = K.todayAZ();
    const vis = visible();
    let h = `<div class="grid">` + K.DOW.map((d) => `<div class="dow">${d}</div>`).join("");
    for (let i = 0; i < weeks * 7; i++) {
      const date = K.addDays(first, i - lead);
      const evs = onDay(vis, date);
      const cls = ["cell"];
      if (date < first || date > last) cls.push("out");
      if (date === today) cls.push("today");
      if (evs.length) cls.push("has");
      const pills = evs
        .slice(0, 3)
        .map(
          (e) =>
            `<button class="pill${e.status === "cancelled" ? " cancelled" : ""}" type="button" style="--c:${color(e)}" data-id="${e.id}" aria-label="${K.esc(e.title)}">${
              e.startTime && e.startDate === date ? `<span class="pt">${K.shortTime(e.startTime)}</span> ` : ""
            }${K.esc(e.title)}</button>`
        )
        .join("");
      h += `<div class="${cls.join(" ")}" data-date="${date}"><span class="num">${K.parts(date).d}</span><div class="pills">${pills}</div>${
        evs.length > 3 ? `<span class="more">${evs.length - 3} more</span>` : ""
      }</div>`;
    }
    $("#view").innerHTML = h + "</div>";
  }

  // ── Dialog plumbing ───────────────────────────────────────────────────────
  function showDialog(html) {
    dlgBody.innerHTML = html;
    if (!dlg.open) dlg.showModal();
    dlg.scrollTop = 0;
  }
  dlg.addEventListener("click", (e) => {
    if (e.target === dlg || e.target.closest("[data-close]")) dlg.close();
  });
  dlg.addEventListener("close", () => {
    if (new URLSearchParams(location.search).has("event")) history.replaceState(null, "", location.pathname);
  });

  const head = (title, extra = "") =>
    `<div class="dlg-head">${extra}<h2 id="dlgTitle">${K.esc(title)}</h2><button class="x" type="button" data-close aria-label="Close">×</button></div>`;

  function openDay(date) {
    const evs = onDay(visible(), date);
    showDialog(head(K.fmtDate(date)) + `<div class="dlg-main"><div class="list">${evs.map(rowHTML).join("")}</div></div>`);
  }

  // ── Contact fields shared by RSVP and updates forms ───────────────────────
  const me = () => state.me || {};

  function contactFields(p) {
    const m = me();
    const method = m.method || "email";
    const r = (v, label) => `<label><input type="radio" name="method" value="${v}"${method === v ? " checked" : ""}> ${label}</label>`;
    return `<div class="field"><span class="lbl" id="${p}-m">How should we reach you?</span>
        <div class="radios" role="radiogroup" aria-labelledby="${p}-m">${r("email", "Email")}${r("sms", "Text")}${r("both", "Both")}</div></div>
      <div class="form-2">
        <div class="field" data-for="email"><label for="${p}-email">Email</label><input id="${p}-email" name="email" type="email" autocomplete="email" inputmode="email" value="${K.esc(m.email || "")}"></div>
        <div class="field" data-for="sms"><label for="${p}-phone">Mobile number</label><input id="${p}-phone" name="phone" type="tel" autocomplete="tel" inputmode="tel" placeholder="520-555-0123" value="${K.esc(m.phone || "")}"></div>
      </div>
      <p class="fine" data-for="sms">By choosing text, you agree to get texts from KE&amp;G about events. Message and data rates may apply. Reply STOP to opt out.</p>`;
  }

  function wireContact(form) {
    const update = () => {
      const m = form.elements.method.value;
      form.querySelectorAll('[data-for="email"]').forEach((el) => (el.hidden = m === "sms"));
      form.querySelectorAll('[data-for="sms"]').forEach((el) => (el.hidden = m === "email"));
      form.elements.email.required = m !== "sms";
      form.elements.phone.required = m !== "email";
    };
    form.addEventListener("change", (e) => e.target.name === "method" && update());
    update();
  }

  async function submitForm(form, path, extra) {
    const errEl = form.querySelector(".error");
    const btn = form.querySelector("[type=submit]");
    errEl.hidden = true;
    btn.disabled = true;
    const data = Object.fromEntries(new FormData(form));
    if (form.elements.notify) data.notify = form.elements.notify.checked;
    try {
      const r = await call(path, { method: "POST", body: { ...data, ...extra } });
      Object.assign(state.me, { email: data.email || state.me.email, phone: data.phone || state.me.phone, method: data.method });
      return r;
    } catch (e) {
      errEl.textContent = e.message;
      errEl.hidden = false;
      btn.disabled = false;
      return null;
    }
  }


  // ── Event detail ──────────────────────────────────────────────────────────
  function rsvpBlock(ev) {
    if (!ev.rsvpEnabled || ev.status === "cancelled") return "";
    const mine = ev.me?.rsvp;
    const cap = ev.rsvpCapacity;
    const count = ev.rsvpCount || 0;
    const left = cap ? Math.max(cap - count, 0) : null;
    const closed = ev.rsvpDeadline && ev.rsvpDeadline < K.todayAZ();
    const info = [];
    if (cap) info.push(left ? `${left} of ${cap} spots left.` : "This event is full.");
    if (ev.rsvpDeadline) info.push(closed ? `RSVPs closed ${K.fmtDate(ev.rsvpDeadline, false)}.` : `RSVP by ${K.fmtDate(ev.rsvpDeadline, false)}.`);
    let h = `<section class="block"><h3>RSVP</h3>${info.length ? `<p>${info.join(" ")}</p>` : ""}`;
    if (mine) {
      return h + `<div class="done">You're on the list${mine.guests ? `, plus ${mine.guests} ${mine.guests === 1 ? "guest" : "guests"}` : ""}.</div><div class="btnrow" style="margin-top:10px"><button class="btn btn-secondary" type="button" data-act="cancel-rsvp">Cancel my RSVP</button></div></section>`;
    }
    if (!rsvpOpen(ev)) return h + "</section>";
    const guestMax = Math.min(6, left === null ? 6 : left - 1);
    const who = `${me().first || ""} ${me().last || ""}`.trim();
    return (
      h +
      `<form class="form" data-form="rsvp">
        <p class="fine" style="margin:0">RSVPing as ${K.esc(who)}</p>
        ${contactFields("r")}
        ${ev.allowGuests && guestMax > 0 ? `<div class="field"><label for="r-guests">Guests coming with you</label><select id="r-guests" name="guests">${Array.from({ length: guestMax + 1 }, (_, n) => `<option>${n}</option>`).join("")}</select></div>` : ""}
        <label class="check"><input type="checkbox" name="notify" checked><span>Tell me if anything about this event changes</span></label>
        <p class="error" hidden></p>
        <div><button class="btn btn-primary" type="submit">RSVP</button></div>
      </form></section>`
    );
  }

  function followBlock(ev) {
    if (ev.status === "cancelled") return "";
    if (ev.me?.following) {
      return `<section class="block"><h3>Updates</h3><div class="done">You'll hear from us if this event changes.</div><div class="btnrow" style="margin-top:10px"><button class="btn btn-secondary" type="button" data-act="stop-sub">Stop updates</button></div></section>`;
    }
    const form = `<form class="form" data-form="follow">${contactFields("f")}<p class="error" hidden></p><div><button class="btn btn-primary" type="submit">Get updates</button></div></form>`;
    const why = "We'll text or email you if the time, place, or cost changes, or if it's cancelled.";
    if (rsvpOpen(ev) && !ev.me?.rsvp) {
      return `<details class="block"><summary>Not coming? You can still get updates</summary><p class="fine" style="margin-bottom:12px">${why}</p>${form}</details>`;
    }
    return `<section class="block"><h3>Get updates</h3><p>${why}</p>${form}</section>`;
  }

  function openEvent(ev) {
    if (history.state?.event !== ev.id) K.track(ev.id, "view");
    history.replaceState({ event: ev.id }, "", `?event=${ev.id}`);
    const L = K.calLinks(ev, me().feedToken);
    const cancelled = ev.status === "cancelled";
    const locQuery = [ev.locationName, ev.address].filter(Boolean).join(", ");
    const maps = locQuery ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(locQuery)}` : "";

    let h = head(ev.title, (ev.categories || []).length ? `<div class="tags">${catTags(ev)}</div>` : "") + `<div class="dlg-main">`;
    if (cancelled) {
      h += `<div class="notice bad"><strong>This event has been cancelled.</strong></div>`;
    } else if (recent(ev)) {
      h += `<div class="notice"><strong>Changed ${K.fmtDate(K.azDate(Date.parse(ev.lastChanges.at)), false)}</strong><ul>${ev.lastChanges.items.map((i) => `<li>${K.esc(i)}</li>`).join("")}</ul></div>`;
    }
    h += `<dl class="facts"><dt>When</dt><dd>${K.esc(K.whenText(ev))}<br><small>Arizona time</small></dd>`;
    if (locQuery) {
      h += `<dt>Where</dt><dd>${ev.locationName ? K.esc(ev.locationName) + "<br>" : ""}<a href="${maps}" target="_blank" rel="noopener">${K.esc(ev.address || "Get directions")}</a></dd>`;
    }
    h += `<dt>Cost</dt><dd>${K.esc(K.costText(ev))}</dd></dl>`;
    if (ev.description) h += `<div class="desc">${K.linkify(ev.description)}</div>`;
    if (!cancelled) {
      h += `<section class="block"><h3>Add to your calendar</h3><p>This saves a copy to your calendar. To hear about changes, turn on updates below.</p>
        <div class="btnrow">
          <a class="btn btn-secondary" href="${L.outlook}" target="_blank" rel="noopener" data-track="outlook">Outlook</a>
          <a class="btn btn-secondary" href="${L.google}" target="_blank" rel="noopener" data-track="google">Google</a>
          <a class="btn btn-secondary" href="${L.ics}" data-track="ics">iPhone or other</a>
        </div></section>`;
    }
    h += rsvpBlock(ev) + followBlock(ev) + `</div>`;
    showDialog(h);
    wireEvent(ev);
  }

  async function refreshAndReopen(id) {
    try { await load(); } catch {}
    const fresh = find(id);
    if (fresh && dlg.open) openEvent(fresh);
  }

  function wireEvent(ev) {
    const rsvpForm = dlgBody.querySelector('[data-form="rsvp"]');
    if (rsvpForm) {
      wireContact(rsvpForm);
      rsvpForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const r = await submitForm(rsvpForm, "/api/rsvp", { eventId: ev.id });
        if (!r) return;
        K.toast("You're on the list.");
        refreshAndReopen(ev.id);
      });
    }
    const followForm = dlgBody.querySelector('[data-form="follow"]');
    if (followForm) {
      wireContact(followForm);
      followForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const r = await submitForm(followForm, "/api/subscribe", { eventId: ev.id });
        if (!r) return;
        K.toast("Updates are on.");
        refreshAndReopen(ev.id);
      });
    }
  }

  async function undo(path) {
    try {
      await call(path, { method: "DELETE" });
      return true;
    } catch (e) {
      if (e.status !== 401) K.toast(e.message);
      return false;
    }
  }

  // ── Whole-calendar dialogs ────────────────────────────────────────────────
  function openFeed() {
    const https = `${location.origin}/api/feed.ics?t=${encodeURIComponent(me().feedToken || "")}`;
    const webcal = https.replace(/^https?:/, "webcal:");
    showDialog(
      head("Add all events to your calendar") +
        `<div class="dlg-main">
        <p style="margin-top:0">Subscribe once and new events show up in your calendar on their own. Changes sync too, but some calendar apps take hours to refresh. If you need to know about a change right away, turn on updates.</p>
        <section class="block"><h3>iPhone or Mac</h3><p>Opens your Calendar app and asks you to confirm.</p><div class="btnrow"><a class="btn btn-primary" href="${webcal}">Subscribe</a></div></section>
        <section class="block"><h3>Outlook</h3><p>In Outlook, choose Add calendar, then Subscribe from web, and paste this link.</p>
          <div class="copy"><input readonly value="${K.esc(https)}" aria-label="Calendar link"><button class="btn btn-secondary" type="button" data-act="copy">Copy link</button></div></section>
        <section class="block"><h3>Google Calendar</h3><p>On a computer, open Google Calendar. Next to Other calendars, choose the plus sign, then From URL, and paste the same link. Google can take up to a day to show changes.</p></section>
        <p class="fine" style="margin-top:18px">This link is personal to you and only shows events you're invited to. Please don't share it.</p>
      </div>`
    );
  }

  function openFollowAll() {
    const on = me().followingAll;
    const body = on
      ? `<div class="done">You'll hear from us when events are added, changed, or cancelled.</div><div class="btnrow" style="margin-top:12px"><button class="btn btn-secondary" type="button" data-act="stop-all">Stop updates</button></div>`
      : `<p style="margin-top:0">Get a text or email whenever a new event is posted for you, or when any of your events change or are cancelled.</p>
        <form class="form" data-form="follow-all">${contactFields("a")}<p class="error" hidden></p><div><button class="btn btn-primary" type="submit">Get updates</button></div></form>`;
    showDialog(head("Updates for all events") + `<div class="dlg-main">${body}</div>`);
    const form = dlgBody.querySelector('[data-form="follow-all"]');
    if (form) {
      wireContact(form);
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const r = await submitForm(form, "/api/subscribe", { eventId: "_all" });
        if (!r) return;
        state.me.followingAll = true;
        K.toast("Updates are on.");
        openFollowAll();
      });
    }
  }

  // ── Events ────────────────────────────────────────────────────────────────
  function bind() {
    if (state.bound) return;
    state.bound = true;
    $("#prev").addEventListener("click", () => shiftMonth(-1));
    $("#next").addEventListener("click", () => shiftMonth(1));
    $("#today").addEventListener("click", () => {
      const [y, m] = K.todayAZ().split("-").map(Number);
      state.y = y;
      state.m = m;
      render();
    });
    $("#vList").addEventListener("click", () => { state.view = "list"; render(); });
    $("#vMonth").addEventListener("click", () => { state.view = "month"; render(); });
    $("#chips").addEventListener("click", (e) => {
      const c = e.target.closest(".chip");
      if (!c) return;
      state.cat = c.dataset.cat;
      render();
    });
    $("#btnFeed").addEventListener("click", openFeed);
    $("#btnFollow").addEventListener("click", openFollowAll);
    $("#btnSignOut").addEventListener("click", async () => {
      try { await K.api("/api/auth", { method: "DELETE" }); } catch {}
      K.local.del("bdlSession");
      location.href = "/";
    });

    $("#view").addEventListener("click", (e) => {
      if (e.target.closest('[data-act="next-month"]')) return shiftMonth(1);
      const item = e.target.closest(".pill, .row");
      if (item) return openEvent(find(item.dataset.id));
      const cell = e.target.closest(".cell.has");
      if (cell) {
        const evs = onDay(visible(), cell.dataset.date);
        evs.length === 1 ? openEvent(evs[0]) : openDay(cell.dataset.date);
      }
    });

    dlgBody.addEventListener("click", async (e) => {
      const tr = e.target.closest("[data-track]");
      if (tr) {
        const id = new URLSearchParams(location.search).get("event");
        if (id) K.track(id, tr.dataset.track);
        return;
      }
      const row = e.target.closest(".row");
      if (row) return openEvent(find(row.dataset.id));
      const act = e.target.closest("[data-act]")?.dataset.act;
      if (!act) return;
      const id = new URLSearchParams(location.search).get("event");
      if (act === "copy") {
        const input = dlgBody.querySelector(".copy input");
        try {
          await navigator.clipboard.writeText(input.value);
          K.toast("Link copied.");
        } catch {
          input.select();
        }
      } else if (act === "cancel-rsvp") {
        if (!confirm("Cancel your RSVP for this event?")) return;
        if (await undo(`/api/rsvp?eventId=${id}`)) {
          K.toast("Your RSVP is cancelled.");
          refreshAndReopen(id);
        }
      } else if (act === "stop-sub") {
        if (await undo(`/api/subscribe?eventId=${id}`)) {
          K.toast("Updates are off.");
          refreshAndReopen(id);
        }
      } else if (act === "stop-all") {
        if (await undo("/api/subscribe?eventId=_all")) {
          state.me.followingAll = false;
          K.toast("Updates are off.");
          openFollowAll();
        }
      }
    });
  }

  boot();
})();
