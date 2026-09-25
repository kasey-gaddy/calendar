import { store, json, err, newToken, listJSON, readBody, ID_RE } from "../lib/util.mjs";
import { parseContact, upsertSub, savePrefs } from "../lib/subs.mjs";
import { getViewer, canSee, displayName } from "../lib/people.mjs";
import { azToday, fmtDate, whenText, locationText } from "../lib/time.mjs";
import { deliver, emailHtml, eventUrl, manageUrl } from "../lib/notify.mjs";

export default async (req) => {
  const viewer = await getViewer(req);
  if (!viewer) return err("Sign in to RSVP.", 401);
  const rsvps = store("rsvps");

  if (req.method === "DELETE") {
    const id = new URL(req.url).searchParams.get("eventId") || "";
    if (!ID_RE.test(id)) return err("That event id isn't valid.");
    await rsvps.delete(`${id}/${viewer.key}`);
    await store("subs").delete(`${id}/${viewer.key}`);
    return json({ ok: true });
  }
  if (req.method !== "POST") return err("Method not allowed.", 405);

  const b = await readBody(req);
  if (!b) return err("The request was empty or malformed.");
  const id = String(b.eventId || "");
  if (!ID_RE.test(id)) return err("That event id isn't valid.");
  const ev = await store("events").get(id, { type: "json" });
  if (!ev || !canSee(ev, viewer)) return err("That event is no longer on the calendar.", 404);
  if (!ev.rsvpEnabled) return err("This event doesn't take RSVPs.");
  if (ev.status === "cancelled") return err("This event has been cancelled.");
  if (ev.rsvpDeadline && ev.rsvpDeadline < azToday()) return err(`RSVPs closed on ${fmtDate(ev.rsvpDeadline, false)}.`);

  const contact = parseContact(b);
  if (contact.error) return err(contact.error);
  const guests = ev.allowGuests ? Math.min(Math.max(parseInt(b.guests, 10) || 0, 0), 10) : 0;

  const key = `${ev.id}/${viewer.key}`;
  const all = await listJSON("rsvps", ev.id + "/");
  const mine = all.find((r) => r.employeeId === viewer.key);
  const others = all.filter((r) => r.employeeId !== viewer.key).reduce((n, r) => n + 1 + (r.guests || 0), 0);
  if (ev.rsvpCapacity && others + 1 + guests > ev.rsvpCapacity) {
    const left = ev.rsvpCapacity - others;
    return err(left <= 0 ? "This event is full." : `Only ${left} ${left === 1 ? "spot is" : "spots are"} left. Try fewer guests.`);
  }

  const now = new Date().toISOString();
  const rec = {
    eventId: ev.id,
    employeeId: viewer.key,
    id: viewer.id,
    name: displayName(viewer),
    company: viewer.company || "",
    division: viewer.division || "",
    ...contact,
    guests,
    token: mine?.token || newToken(),
    createdAt: mine?.createdAt || now,
    updatedAt: now,
  };
  await rsvps.setJSON(key, rec);
  await savePrefs(viewer, contact);
  if (b.notify !== false) await upsertSub({ eventId: ev.id, emp: viewer, ...contact });

  if (!mine) {
    const cancelLink = manageUrl("rsvp", ev.id, viewer.key, rec.token);
    const when = whenText(ev);
    const where = locationText(ev);
    const r = await deliver({
      emails: contact.method !== "sms" ? [{ email: contact.email }] : [],
      phones: contact.method !== "email" ? [{ phone: contact.phone }] : [],
      subject: `You're on the list: ${ev.title}`,
      html: () =>
        emailHtml({
          greeting: `Hi ${viewer.preferred || viewer.first},`,
          heading: `You're on the list for ${ev.title}`,
          intro: guests ? `We have you down plus ${guests} ${guests === 1 ? "guest" : "guests"}.` : "",
          items: [{ text: `When: ${when} (Arizona time)` }, ...(where ? [{ text: `Where: ${where}` }] : [])],
          note: b.notify !== false ? "We'll let you know if anything about this event changes." : "",
          ctaUrl: eventUrl(ev.id),
          footer: `Can't make it? <a href="${cancelLink}" style="color:#5A6280">Cancel your RSVP</a>.`,
        }),
      sms: () =>
        `BDL Events: You're on the list for ${ev.title}, ${when}.${b.notify !== false ? " We'll text you if anything changes." : ""} Cancel: ${cancelLink} Reply STOP to opt out.`,
    });
    if (r.failed.length) console.warn("RSVP confirmation failed", r.failed);
  }
  return json({ ok: true, updated: !!mine });
};

export const config = { path: "/api/rsvp" };
