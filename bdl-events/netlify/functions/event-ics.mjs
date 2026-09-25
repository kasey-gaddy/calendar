import { store, err, ID_RE } from "../lib/util.mjs";
import { canSee, employeeByFeedToken } from "../lib/people.mjs";
import { buildCalendar } from "../lib/ics.mjs";
import { eventUrl } from "../lib/notify.mjs";

export default async (req) => {
  const q = new URL(req.url).searchParams;
  const emp = await employeeByFeedToken(q.get("t"));
  if (!emp) return err("Sign in to BDL Events again, then try this link.", 401);
  const id = q.get("id") || "";
  if (!ID_RE.test(id)) return err("That event id isn't valid.");
  const ev = await store("events").get(id, { type: "json" });
  if (!ev || !canSee(ev, emp)) return err("That event is no longer on the calendar.", 404);
  const slug = ev.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "event";
  return new Response(buildCalendar([{ ev, url: eventUrl(ev.id) }], ev.title), {
    headers: {
      "content-type": "text/calendar; charset=utf-8",
      "content-disposition": `attachment; filename="${slug}.ics"`,
      "cache-control": "no-store",
    },
  });
};

export const config = { path: "/api/event.ics" };
