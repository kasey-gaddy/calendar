// Background function: Netlify returns 202 right away and lets this run up to
// 15 minutes, so a large list never times out the admin's save.
import { store } from "../lib/util.mjs";
import { recipientsFor } from "../lib/subs.mjs";
import { getRoster } from "../lib/people.mjs";
import { deliver, emailHtml, eventUrl, manageUrl } from "../lib/notify.mjs";
import { whenText, costText, locationText } from "../lib/time.mjs";

export default async (req) => {
  if (!process.env.ADMIN_PASSWORD || req.headers.get("x-internal-key") !== process.env.ADMIN_PASSWORD) {
    return new Response("Unauthorized", { status: 401 });
  }
  const { eventId, kind = "update", changes = [], message = "" } = await req.json();
  const ev = await store("events").get(eventId, { type: "json" });
  if (!ev) return;

  const isNew = kind === "new";
  const cancelled = ev.status === "cancelled";
  const link = eventUrl(ev.id);
  const roster = await getRoster();
  const { emails, phones } = await recipientsFor(ev, roster, { allOnly: isNew });

  let subject, heading, intro, items;
  if (isNew) {
    subject = `New event: ${ev.title}`;
    heading = ev.title;
    intro = "A new event was added to the BDL Events calendar.";
    items = [{ text: `When: ${whenText(ev)} (Arizona time)` }];
    if (locationText(ev)) items.push({ text: `Where: ${locationText(ev)}` });
    items.push({ text: `Cost: ${costText(ev)}` });
  } else if (cancelled) {
    subject = `Cancelled: ${ev.title}`;
    heading = `${ev.title} is cancelled`;
    intro = `This event was scheduled for ${whenText(ev)}.`;
    items = [];
  } else {
    subject = `Update: ${ev.title}`;
    heading = `${ev.title} has changed`;
    intro = changes.length ? "Here's what's different:" : "";
    items = changes;
  }

  const stopLink = (s) => manageUrl("sub", s.eventId, s.employeeId, s.token);
  const footerFor = (s) =>
    `You're getting this because you asked for updates on ${s.eventId === "_all" ? "BDL events" : "this event"}. <a href="${stopLink(s)}" style="color:#5A6280">Stop these updates</a>.`;

  const smsLead = isNew ? "New BDL event" : cancelled ? "BDL event cancelled" : "BDL event update";
  const smsDetail = isNew
    ? `${whenText(ev)}${locationText(ev) ? `, ${locationText(ev)}` : ""}.`
    : cancelled
      ? ""
      : changes.map((c) => (/[.!?]$/.test(c.text) ? c.text : c.text + ".")).join(" ");

  const result = await deliver({
    emails,
    phones,
    subject,
    html: (s) =>
      emailHtml({
        greeting: s.first ? `Hi ${s.first},` : "",
        heading,
        intro,
        items,
        note: message,
        ctaUrl: link,
        ctaLabel: cancelled ? "See details" : "View event",
        footer: footerFor(s),
      }),
    sms: () => [`${smsLead}: ${ev.title}.`, smsDetail, message, `Details: ${link}`, "Reply STOP to opt out."].filter(Boolean).join(" "),
  });

  await store("notifylog").setJSON(ev.id, { at: new Date().toISOString(), kind, subject, ...result });
};
