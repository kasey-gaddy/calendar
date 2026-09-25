import { store, json, err, readBody, siteUrl, ID_RE } from "../lib/util.mjs";
import { parseContact, upsertSub, savePrefs } from "../lib/subs.mjs";
import { getViewer, canSee } from "../lib/people.mjs";
import { deliver, emailHtml, eventUrl, manageUrl } from "../lib/notify.mjs";

export default async (req) => {
  const viewer = await getViewer(req);
  if (!viewer) return err("Sign in to get updates.", 401);

  if (req.method === "DELETE") {
    const eventId = new URL(req.url).searchParams.get("eventId") || "";
    if (eventId !== "_all" && !ID_RE.test(eventId)) return err("That event id isn't valid.");
    await store("subs").delete(`${eventId}/${viewer.key}`);
    return json({ ok: true });
  }
  if (req.method !== "POST") return err("Method not allowed.", 405);

  const b = await readBody(req);
  if (!b) return err("The request was empty or malformed.");
  const eventId = String(b.eventId || "");
  let ev = null;
  if (eventId !== "_all") {
    if (!ID_RE.test(eventId)) return err("That event id isn't valid.");
    ev = await store("events").get(eventId, { type: "json" });
    if (!ev || !canSee(ev, viewer)) return err("That event is no longer on the calendar.", 404);
  }
  const contact = parseContact(b);
  if (contact.error) return err(contact.error);

  const { token, isNew } = await upsertSub({ eventId, emp: viewer, ...contact });
  await savePrefs(viewer, contact);

  if (isNew) {
    const what = ev ? ev.title : "BDL events";
    const stop = manageUrl("sub", eventId, viewer.key, token);
    const r = await deliver({
      emails: contact.method !== "sms" ? [{ email: contact.email }] : [],
      phones: contact.method !== "email" ? [{ phone: contact.phone }] : [],
      subject: `Updates are on: ${what}`,
      html: () =>
        emailHtml({
          greeting: `Hi ${viewer.preferred || viewer.first},`,
          heading: "Updates are on",
          intro: ev
            ? `We'll email you if the time, place, or cost of ${ev.title} changes, or if it's cancelled.`
            : "We'll email you when new events are posted for you, and when any of your events change or are cancelled.",
          ctaUrl: ev ? eventUrl(ev.id) : siteUrl() + "/",
          ctaLabel: ev ? "View event" : "Open the calendar",
          footer: `Changed your mind? <a href="${stop}" style="color:#5A6280">Stop these updates</a>.`,
        }),
      sms: () => `BDL Events: You'll get texts about ${what}. Msg & data rates may apply. Reply STOP to opt out.`,
    });
    if (r.failed.length) console.warn("Subscribe confirmation failed", r.failed);
  }
  return json({ ok: true });
};

export const config = { path: "/api/subscribe" };
