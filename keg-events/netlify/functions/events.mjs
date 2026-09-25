import { store, json, err, isEmployee, isAdmin, newId, listJSON, deletePrefix, readBody, siteUrl, ID_RE } from "../lib/util.mjs";
import { whenText, costText, locationText } from "../lib/time.mjs";
import { recipientsFor } from "../lib/subs.mjs";

const TEXT_FIELDS = ["title", "startDate", "startTime", "endDate", "endTime", "locationName", "address", "description", "feeNote", "rsvpDeadline"];
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

function clean(b) {
  const ev = {};
  for (const f of TEXT_FIELDS) ev[f] = String(b[f] ?? "").trim();
  ev.title = ev.title.slice(0, 140);
  ev.description = ev.description.slice(0, 5000);
  const cats = Array.isArray(b.categories) ? b.categories : String(b.categories || "").split(",");
  ev.categories = [...new Set(cats.map((s) => String(s).trim().slice(0, 30)).filter(Boolean))].slice(0, 8);
  const fee = parseFloat(b.fee);
  ev.fee = Number.isFinite(fee) && fee > 0 ? Math.round(fee * 100) / 100 : 0;
  ev.rsvpEnabled = !!b.rsvpEnabled;
  const cap = parseInt(b.rsvpCapacity, 10);
  ev.rsvpCapacity = Number.isFinite(cap) && cap > 0 ? cap : 0;
  ev.allowGuests = !!b.allowGuests;
  ev.status = b.status === "cancelled" ? "cancelled" : "scheduled";
  if (ev.endDate === ev.startDate) ev.endDate = "";
  return ev;
}

function validate(ev) {
  if (!ev.title) return "Add a title.";
  if (!DATE.test(ev.startDate)) return "Add a start date.";
  if (ev.endDate && !DATE.test(ev.endDate)) return "The end date isn't a valid date.";
  if (ev.endDate && ev.endDate < ev.startDate) return "The end date is before the start date.";
  if (ev.startTime && !TIME.test(ev.startTime)) return "The start time isn't a valid time.";
  if (ev.endTime && !TIME.test(ev.endTime)) return "The end time isn't a valid time.";
  if (ev.endTime && !ev.startTime) return "Add a start time, or clear the end time to make it an all-day event.";
  if (ev.startTime && ev.endTime && !ev.endDate && ev.endTime <= ev.startTime) return "The end time is before the start time.";
  if (ev.rsvpDeadline && !DATE.test(ev.rsvpDeadline)) return "The RSVP deadline isn't a valid date.";
  return null;
}

// What changed that people following the event need to hear about.
function diff(a, b) {
  const out = [];
  if (a.status !== b.status) {
    out.push({ field: "status", text: b.status === "cancelled" ? "This event has been cancelled." : "This event is back on." });
  }
  if (whenText(a) !== whenText(b)) out.push({ field: "time", text: `When: ${whenText(b)}`, was: whenText(a) });
  const la = locationText(a) || "To be announced";
  const lb = locationText(b) || "To be announced";
  if (la !== lb) out.push({ field: "location", text: `Where: ${lb}`, was: la });
  if (costText(a) !== costText(b)) out.push({ field: "cost", text: `Cost: ${costText(b)}`, was: costText(a) });
  if (a.title !== b.title) out.push({ field: "title", text: `Now called: ${b.title}`, was: a.title });
  return out;
}

async function queueNotify(payload) {
  const { emails, phones } = await recipientsFor(payload.eventId, { allOnly: payload.kind === "new" });
  const recipients = emails.length + phones.length;
  if (!recipients) return { queued: false, recipients: 0 };
  try {
    const res = await fetch(`${siteUrl()}/.netlify/functions/notify-background`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-internal-key": process.env.ADMIN_PASSWORD },
      body: JSON.stringify(payload),
    });
    return { queued: res.status === 202 || res.ok, recipients, status: res.status };
  } catch (e) {
    return { queued: false, recipients, error: String(e.message || e) };
  }
}

export default async (req) => {
  const events = store("events");
  const url = new URL(req.url);

  if (req.method === "GET") {
    if (!isEmployee(req)) return err("Enter the employee access code.", 401);
    const list = await listJSON("events");
    const withCounts = await Promise.all(
      list.map(async (ev) => {
        if (!ev.rsvpEnabled) return ev;
        const rsvps = await listJSON("rsvps", ev.id + "/");
        return { ...ev, rsvpCount: rsvps.reduce((n, r) => n + 1 + (r.guests || 0), 0) };
      })
    );
    withCounts.sort((a, b) => (a.startDate + (a.startTime || "")).localeCompare(b.startDate + (b.startTime || "")));
    return json({ events: withCounts });
  }

  if (!isAdmin(req)) return err("Sign in as an admin to make changes.", 401);

  if (req.method === "POST") {
    const body = await readBody(req);
    if (!body) return err("The request was empty or malformed.");
    const ev = clean(body);
    const problem = validate(ev);
    if (problem) return err(problem);

    const now = new Date().toISOString();
    let old = null;
    if (body.id) {
      if (!ID_RE.test(body.id)) return err("That event id isn't valid.");
      old = await events.get(body.id, { type: "json" });
      if (!old) return err("That event no longer exists.", 404);
    }

    let changes = [];
    if (old) {
      changes = diff(old, ev);
      Object.assign(ev, {
        id: old.id,
        createdAt: old.createdAt,
        sequence: (old.sequence || 0) + 1,
        lastChanges: changes.length ? { at: now, items: changes.map((c) => c.text) } : old.lastChanges || null,
      });
    } else {
      Object.assign(ev, { id: newId(), createdAt: now, sequence: 0, lastChanges: null });
    }
    ev.updatedAt = now;
    await events.setJSON(ev.id, ev);

    const message = String(body.message || "").trim().slice(0, 500);
    let notify = { queued: false, recipients: 0 };
    if (old && body.notify && (changes.length || message)) {
      notify = await queueNotify({ eventId: ev.id, kind: "update", changes, message });
    } else if (!old && body.announce) {
      notify = await queueNotify({ eventId: ev.id, kind: "new", changes: [], message });
    }
    return json({ event: ev, changes, notify });
  }

  if (req.method === "DELETE") {
    const id = url.searchParams.get("id") || "";
    if (!ID_RE.test(id)) return err("That event id isn't valid.");
    await events.delete(id);
    await Promise.all([deletePrefix("rsvps", id + "/"), deletePrefix("subs", id + "/"), store("notifylog").delete(id)]);
    return json({ ok: true });
  }

  return err("Method not allowed.", 405);
};

export const config = { path: "/api/events" };
