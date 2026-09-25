// All event times are Arizona local time. Arizona stays on MST (UTC-7) all year,
// so converting to UTC is a fixed 7-hour shift with no daylight saving math.
const OFFSET_HOURS = 7;
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const parts = (date) => {
  const [y, m, d] = date.split("-").map(Number);
  return { y, m, d, dow: new Date(Date.UTC(y, m - 1, d)).getUTCDay() };
};

export function addDays(date, n) {
  const p = parts(date);
  return new Date(Date.UTC(p.y, p.m - 1, p.d + n)).toISOString().slice(0, 10);
}

export const azToday = () => new Date(Date.now() - OFFSET_HOURS * 3600e3).toISOString().slice(0, 10);

function toMs(date, time) {
  const p = parts(date);
  const [hh, mm] = time.split(":").map(Number);
  return Date.UTC(p.y, p.m - 1, p.d, hh + OFFSET_HOURS, mm);
}

// Returns either an all-day span (dates) or a timed span (UTC milliseconds).
// A timed event with no end time is treated as one hour long.
export function span(ev) {
  if (!ev.startTime) {
    const last = ev.endDate && ev.endDate > ev.startDate ? ev.endDate : ev.startDate;
    return { allDay: true, startDate: ev.startDate, endDateExcl: addDays(last, 1) };
  }
  const start = toMs(ev.startDate, ev.startTime);
  let end = ev.endTime ? toMs(ev.endDate || ev.startDate, ev.endTime) : start + 3600e3;
  if (end <= start) end = start + 3600e3;
  return { allDay: false, startMs: start, endMs: end };
}

export const utcStamp = (ms) => new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
export const compactDate = (date) => date.replace(/-/g, "");

export function fmtDate(date, withYear = true) {
  const p = parts(date);
  return `${DOW[p.dow]}, ${MON[p.m - 1]} ${p.d}${withYear ? `, ${p.y}` : ""}`;
}

export function fmtTime(t) {
  if (!t) return "";
  let [h, mi] = t.split(":").map(Number);
  const ap = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${h}:${String(mi).padStart(2, "0")} ${ap}`;
}

export function whenText(ev) {
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

export const money = (n) =>
  "$" + Number(n).toLocaleString("en-US", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });

export const costText = (ev) => (ev.fee ? money(ev.fee) + (ev.feeNote ? ` (${ev.feeNote})` : "") : ev.feeNote || "Free");

export const locationText = (ev) => [ev.locationName, ev.address].filter(Boolean).join(", ");
