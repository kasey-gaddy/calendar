window.KEG = (() => {
  const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const MONL = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

  const esc = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const parts = (date) => {
    const [y, m, d] = date.split("-").map(Number);
    return { y, m, d, dow: new Date(Date.UTC(y, m - 1, d)).getUTCDay() };
  };
  const iso = (y, m, d) => new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10);
  const addDays = (date, n) => {
    const p = parts(date);
    return iso(p.y, p.m, p.d + n);
  };
  // Arizona is UTC-7 all year.
  const azDate = (ms) => new Date(ms - 7 * 3600e3).toISOString().slice(0, 10);
  const todayAZ = () => azDate(Date.now());

  const fmtDate = (date, withYear = true) => {
    const p = parts(date);
    return `${DOW[p.dow]}, ${MON[p.m - 1]} ${p.d}${withYear ? `, ${p.y}` : ""}`;
  };
  const fmtTime = (t) => {
    if (!t) return "";
    let [h, mi] = t.split(":").map(Number);
    const ap = h >= 12 ? "PM" : "AM";
    h = h % 12 || 12;
    return `${h}:${String(mi).padStart(2, "0")} ${ap}`;
  };
  const shortTime = (t) => fmtTime(t).replace(":00", "");

  function whenText(ev) {
    const multiDay = ev.endDate && ev.endDate !== ev.startDate;
    let s = fmtDate(ev.startDate);
    if (ev.startTime) {
      s += `, ${fmtTime(ev.startTime)}`;
      if (ev.endTime) s += multiDay ? ` to ${fmtDate(ev.endDate)}, ${fmtTime(ev.endTime)}` : ` to ${fmtTime(ev.endTime)}`;
    } else if (multiDay) {
      s += ` to ${fmtDate(ev.endDate)}`;
    }
    return s;
  }

  // Short line for list rows, where the date is already shown.
  function timeText(ev) {
    const multiDay = ev.endDate && ev.endDate !== ev.startDate;
    if (!ev.startTime) return multiDay ? `All day, through ${fmtDate(ev.endDate, false)}` : "All day";
    let s = fmtTime(ev.startTime);
    if (ev.endTime) s += multiDay ? ` to ${fmtDate(ev.endDate, false)}, ${fmtTime(ev.endTime)}` : ` to ${fmtTime(ev.endTime)}`;
    return s;
  }

  const money = (n) =>
    "$" + Number(n).toLocaleString("en-US", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });
  const costText = (ev) => (ev.fee ? money(ev.fee) + (ev.feeNote ? ` (${ev.feeNote})` : "") : ev.feeNote || "Free");

  const PALETTE = ["#103F91", "#E8621A", "#1A7A4A", "#6B3FA0", "#0F7C8C", "#B7791F", "#B03A48", "#4B5270"];
  // Categories currently on the calendar get distinct colors in alphabetical order.
  // Anything unknown falls back to a stable hash.
  let catIndex = new Map();
  const setCategories = (list) => {
    catIndex = new Map([...new Set(list)].sort((a, b) => a.localeCompare(b)).map((c, i) => [c, i]));
  };
  const catColor = (name) => {
    if (catIndex.has(name)) return PALETTE[catIndex.get(name) % PALETTE.length];
    let h = 0;
    for (const c of String(name).toLowerCase()) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    return PALETTE[h % PALETTE.length];
  };

  const linkify = (text) =>
    esc(text)
      .replace(/(https?:\/\/[^\s<]+[^\s<.,;:!?)])/g, '<a href="$1" target="_blank" rel="noopener">$1</a>')
      .replace(/\n/g, "<br>");

  function endOf(ev) {
    if (ev.endTime) return { date: ev.endDate || ev.startDate, time: ev.endTime };
    const p = parts(ev.startDate);
    const [h, mi] = ev.startTime.split(":").map(Number);
    const d = new Date(Date.UTC(p.y, p.m - 1, p.d, h, mi + 60)).toISOString();
    return { date: d.slice(0, 10), time: d.slice(11, 16) };
  }

  const qs = (o) => Object.entries(o).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");

  function calLinks(ev, code) {
    const loc = [ev.locationName, ev.address].filter(Boolean).join(", ");
    const page = `${location.origin}/?event=${ev.id}`;
    const details = [ev.fee || ev.feeNote ? `Cost: ${costText(ev)}` : "", ev.description || "", `Details and updates: ${page}`]
      .filter(Boolean)
      .join("\n\n");
    let gDates, o;
    if (!ev.startTime) {
      const excl = addDays(ev.endDate || ev.startDate, 1);
      gDates = `${ev.startDate.replace(/-/g, "")}/${excl.replace(/-/g, "")}`;
      o = { startdt: ev.startDate, enddt: excl, allday: "true" };
    } else {
      const e = endOf(ev);
      const c = (d, t) => `${d.replace(/-/g, "")}T${t.replace(":", "")}00`;
      gDates = `${c(ev.startDate, ev.startTime)}/${c(e.date, e.time)}`;
      o = { startdt: `${ev.startDate}T${ev.startTime}:00-07:00`, enddt: `${e.date}T${e.time}:00-07:00`, allday: "false" };
    }
    return {
      google:
        "https://calendar.google.com/calendar/render?" +
        qs({ action: "TEMPLATE", text: ev.title, dates: gDates, details, location: loc, ctz: "America/Phoenix" }),
      outlook:
        "https://outlook.office.com/calendar/0/deeplink/compose?" +
        qs({ path: "/calendar/action/compose", rru: "addevent", subject: ev.title, body: details, location: loc, ...o }),
      ics: "/api/event.ics?" + qs({ id: ev.id, k: code || "" }),
    };
  }

  const local = {
    get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch {} },
    del: (k) => { try { localStorage.removeItem(k); } catch {} },
  };
  const session = {
    get: (k) => { try { return sessionStorage.getItem(k); } catch { return null; } },
    set: (k, v) => { try { sessionStorage.setItem(k, v); } catch {} },
    del: (k) => { try { sessionStorage.removeItem(k); } catch {} },
  };

  async function api(path, opts = {}) {
    const headers = { "content-type": "application/json", ...(opts.headers || {}) };
    const code = local.get("kegEventsCode");
    if (code) headers["x-access-code"] = code;
    const adminKey = session.get("kegEventsAdmin");
    if (adminKey) headers["x-admin-key"] = adminKey;
    let res;
    try {
      res = await fetch(path, {
        ...opts,
        headers,
        body: opts.body && typeof opts.body !== "string" ? JSON.stringify(opts.body) : opts.body,
      });
    } catch {
      const e = new Error("Couldn't reach the server. Check your connection and try again.");
      e.status = 0;
      throw e;
    }
    let data = {};
    try { data = await res.json(); } catch {}
    if (!res.ok) {
      const e = new Error(data.error || `The server returned an error (${res.status}). Try again.`);
      e.status = res.status;
      throw e;
    }
    return data;
  }

  function toast(msg) {
    const t = document.getElementById("toast");
    if (!t) return;
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => t.classList.remove("show"), 3600);
  }

  return {
    DOW, MON, MONL, esc, parts, iso, addDays, azDate, todayAZ, fmtDate, fmtTime, shortTime,
    whenText, timeText, money, costText, catColor, setCategories, linkify, calLinks, api, local, session, toast,
  };
})();
