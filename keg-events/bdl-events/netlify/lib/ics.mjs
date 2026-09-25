import { span, utcStamp, compactDate, costText } from "./time.mjs";

const esc = (s) =>
  String(s || "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

// RFC 5545 line folding at 75 characters.
function fold(line) {
  const out = [];
  let rest = line;
  while (rest.length > 74) {
    out.push(rest.slice(0, 74));
    rest = " " + rest.slice(74);
  }
  out.push(rest);
  return out.join("\r\n");
}

function description(ev, url) {
  const parts = [];
  if (ev.fee || ev.feeNote) parts.push(`Cost: ${costText(ev)}`);
  if (ev.description) parts.push(ev.description);
  if (url) parts.push(`Details and updates: ${url}`);
  return parts.join("\n\n");
}

function vevent(ev, url) {
  const sp = span(ev);
  const cancelled = ev.status === "cancelled";
  const lines = [
    "BEGIN:VEVENT",
    `UID:${ev.id}@bdl-events`,
    `DTSTAMP:${utcStamp(Date.parse(ev.updatedAt || ev.createdAt) || Date.now())}`,
    `SEQUENCE:${ev.sequence || 0}`,
  ];
  if (sp.allDay) {
    lines.push(`DTSTART;VALUE=DATE:${compactDate(sp.startDate)}`, `DTEND;VALUE=DATE:${compactDate(sp.endDateExcl)}`);
  } else {
    lines.push(`DTSTART:${utcStamp(sp.startMs)}`, `DTEND:${utcStamp(sp.endMs)}`);
  }
  lines.push(`SUMMARY:${esc((cancelled ? "CANCELLED: " : "") + ev.title)}`);
  const loc = [ev.locationName, ev.address].filter(Boolean).join(", ");
  if (loc) lines.push(`LOCATION:${esc(loc)}`);
  lines.push(`DESCRIPTION:${esc(description(ev, url))}`);
  if (url) lines.push(`URL:${url}`);
  if (ev.categories?.length) lines.push(`CATEGORIES:${ev.categories.map(esc).join(",")}`);
  lines.push(`STATUS:${cancelled ? "CANCELLED" : "CONFIRMED"}`, "END:VEVENT");
  return lines;
}

export function buildCalendar(items, name = "BDL Events") {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Blue Diamond Legacy//Events//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${esc(name)}`,
    "X-WR-TIMEZONE:America/Phoenix",
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
    "X-PUBLISHED-TTL:PT1H",
  ];
  for (const { ev, url } of items) lines.push(...vevent(ev, url));
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}
