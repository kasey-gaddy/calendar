import { store, json, err, isEmployee, newToken, listJSON, readBody, ID_RE } from "../lib/util.mjs";
import { parseContact, upsertSub } from "../lib/subs.mjs";
import { azToday, fmtDate, whenText, locationText } from "../lib/time.mjs";
import { deliver, emailHtml, eventUrl, manageUrl } from "../lib/notify.mjs";

export default async (req) => {
  if (!isEmployee(req)) return err("Enter the employee access code.", 401);
  if (req.method !== "POST") return err("Method not allowed.", 405);
  const b = await readBody(req);
  if (!b) return err("The request was empty or malformed.");

  const id = String(b.eventId || "");
  if (!ID_RE.test(id)) return err("That event id isn't valid.");
  const ev = await store("events").get(id, { type: "json" });
  if (!ev) return err("That event is no longer on the calendar.", 404);
  if (!ev.rsvpEnabled) return err("This event doesn't take RSVPs.");
  if (ev.status === "cancelled") return err("This event has been cancelled.");
  if (ev.rsvpDeadline && ev.rsvpDeadline < azToday()) return err(`RSVPs closed on ${fmtDate(ev.rsvpDeadline, false)}.`);

  const name = String(b.name || "").trim().slice(0, 100);
  if (!name) return err("Add your name.");
  const contact = parseContact(b);
  if (contact.error) return err(contact.error);
  const guests = ev.allowGuests ? Math.min(Math.max(parseInt(b.guests, 10) || 0, 0), 10) : 0;

  const existing = await listJSON("rsvps", ev.id + "/");
  if (existing.some((r) => (contact.email && r.email === contact.email) || (contact.phone && r.phone === contact.phone))) {
    return err("You're already on the list for this event.");
  }
  const count = existing.reduce((n, r) => n + 1 + (r.guests || 0), 0);
  if (ev.rsvpCapacity && count + 1 + guests > ev.rsvpCapacity) {
    const left = ev.rsvpCapacity - count;
    return err(left <= 0 ? "This event is full." : `Only ${left} ${left === 1 ? "spot is" : "spots are"} left. Try fewer guests.`);
  }

  const token = newToken();
  await store("rsvps").setJSON(`${ev.id}/${token}`, {
    eventId: ev.id, token, name, ...contact, guests, createdAt: new Date().toISOString(),
  });

  let subToken = null;
  if (b.notify !== false) subToken = (await upsertSub({ eventId: ev.id, name, ...contact })).token;

  const cancelLink = manageUrl("rsvp", ev.id, token);
  const when = whenText(ev);
  const where = locationText(ev);
  const r = await deliver({
    emails: contact.method !== "sms" ? [{ email: contact.email }] : [],
    phones: contact.method !== "email" ? [{ phone: contact.phone }] : [],
    subject: `You're on the list: ${ev.title}`,
    html: () =>
      emailHtml({
        heading: `You're on the list for ${ev.title}`,
        intro: guests ? `We have you down plus ${guests} ${guests === 1 ? "guest" : "guests"}.` : "",
        items: [{ text: `When: ${when} (Arizona time)` }, ...(where ? [{ text: `Where: ${where}` }] : [])],
        note: subToken ? "We'll let you know if anything about this event changes." : "",
        ctaUrl: eventUrl(ev.id),
        footer: `Can't make it? <a href="${cancelLink}" style="color:#5A6280">Cancel your RSVP</a>.`,
      }),
    sms: () =>
      `KE&G: You're on the list for ${ev.title}, ${when}.${subToken ? " We'll text you if anything changes." : ""} Cancel: ${cancelLink} Reply STOP to opt out.`,
  });
  if (r.failed.length) console.warn("RSVP confirmation failed", r.failed);

  return json({ ok: true, token, subToken });
};

export const config = { path: "/api/rsvp" };
