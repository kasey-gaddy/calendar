// Subscribable calendar feed. Calendar apps poll this URL, so edits flow through
// to anyone who subscribed without them doing anything.
import { store, err, isEmployee, listJSON } from "../lib/util.mjs";
import { buildCalendar } from "../lib/ics.mjs";
import { addDays, azToday } from "../lib/time.mjs";
import { eventUrl } from "../lib/notify.mjs";

export default async (req) => {
  if (!isEmployee(req)) return err("This calendar link is missing a valid access code.", 401);
  const cat = new URL(req.url).searchParams.get("cat");
  const cutoff = addDays(azToday(), -180);
  const events = (await listJSON("events"))
    .filter((ev) => (ev.endDate || ev.startDate) >= cutoff)
    .filter((ev) => !cat || (ev.categories || []).includes(cat));
  const body = buildCalendar(events.map((ev) => ({ ev, url: eventUrl(ev.id) })), cat ? `KE&G Events: ${cat}` : "KE&G Events");
  return new Response(body, {
    headers: {
      "content-type": "text/calendar; charset=utf-8",
      "content-disposition": 'inline; filename="keg-events.ics"',
      "cache-control": "public, max-age=900",
    },
  });
};

export const config = { path: "/api/feed.ics" };
