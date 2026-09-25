// Personal subscribable calendar feed. Each employee's link only includes events
// they're invited to, and calendar apps pick up changes on their own.
import { err, listJSON } from "../lib/util.mjs";
import { canSee, employeeByFeedToken } from "../lib/people.mjs";
import { buildCalendar } from "../lib/ics.mjs";
import { addDays, azToday } from "../lib/time.mjs";
import { eventUrl } from "../lib/notify.mjs";

export default async (req) => {
  const emp = await employeeByFeedToken(new URL(req.url).searchParams.get("t"));
  if (!emp) return err("This calendar link is no longer valid. Get a new one from the BDL Events page.", 401);
  const cutoff = addDays(azToday(), -180);
  const events = (await listJSON("events")).filter((ev) => (ev.endDate || ev.startDate) >= cutoff && canSee(ev, emp));
  return new Response(buildCalendar(events.map((ev) => ({ ev, url: eventUrl(ev.id) }))), {
    headers: {
      "content-type": "text/calendar; charset=utf-8",
      "content-disposition": 'inline; filename="bdl-events.ics"',
      "cache-control": "private, max-age=900",
    },
  });
};

export const config = { path: "/api/feed.ics" };
