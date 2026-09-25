import { store, json, err, isEmployee, readBody, ID_RE } from "../lib/util.mjs";
import { parseContact, upsertSub } from "../lib/subs.mjs";
import { deliver, emailHtml, eventUrl, manageUrl, siteUrlSafe } from "../lib/notify.mjs";

export default async (req) => {
  if (!isEmployee(req)) return err("Enter the employee access code.", 401);
  if (req.method !== "POST") return err("Method not allowed.", 405);
  const b = await readBody(req);
  if (!b) return err("The request was empty or malformed.");

  const eventId = String(b.eventId || "");
  let ev = null;
  if (eventId !== "_all") {
    if (!ID_RE.test(eventId)) return err("That event id isn't valid.");
    ev = await store("events").get(eventId, { type: "json" });
    if (!ev) return err("That event is no longer on the calendar.", 404);
  }
  const name = String(b.name || "").trim().slice(0, 100);
  if (!name) return err("Add your name.");
  const contact = parseContact(b);
  if (contact.error) return err(contact.error);

  const { token, isNew } = await upsertSub({ eventId, name, ...contact });

  if (isNew) {
    const what = ev ? ev.title : "all KE&G events";
    const stop = manageUrl("sub", eventId, token);
    const r = await deliver({
      emails: contact.method !== "sms" ? [{ email: contact.email }] : [],
      phones: contact.method !== "email" ? [{ phone: contact.phone }] : [],
      subject: `Updates are on: ${what}`,
      html: () =>
        emailHtml({
          heading: "Updates are on",
          intro: ev
            ? `We'll email you if the time, place, or cost of ${ev.title} changes, or if it's cancelled.`
            : "We'll email you when events are added to the KE&G calendar, and when any event changes or is cancelled.",
          ctaUrl: ev ? eventUrl(ev.id) : siteUrlSafe(),
          ctaLabel: ev ? "View event" : "Open the calendar",
          footer: `Changed your mind? <a href="${stop}" style="color:#5A6280">Stop these updates</a>.`,
        }),
      sms: () => `KE&G: You'll get texts about ${what}. Msg & data rates may apply. Reply STOP to opt out.`,
    });
    if (r.failed.length) console.warn("Subscribe confirmation failed", r.failed);
  }
  return json({ ok: true, token });
};

export const config = { path: "/api/subscribe" };
