// Admin reporting: one event in detail, or a summary across all events.
import { store, json, err, isAdmin, listJSON, countPrefix, ID_RE } from "../lib/util.mjs";
import { getRoster, eligible, canSee, displayName } from "../lib/people.mjs";

const headcount = (rsvps) => rsvps.reduce((n, r) => n + 1 + (r.guests || 0), 0);

export default async (req) => {
  if (!isAdmin(req)) return err("Sign in as an admin.", 401);
  const q = new URL(req.url).searchParams;
  const roster = await getRoster();

  if (q.get("summary")) {
    const events = await listJSON("events");
    const rows = await Promise.all(
      events.map(async (ev) => {
        const [views, caladds, subs, rsvps] = await Promise.all([
          countPrefix("views", ev.id + "/"),
          countPrefix("caladds", ev.id + "/"),
          countPrefix("subs", ev.id + "/"),
          ev.rsvpEnabled ? listJSON("rsvps", ev.id + "/") : [],
        ]);
        return {
          id: ev.id, title: ev.title, startDate: ev.startDate, startTime: ev.startTime, status: ev.status,
          audience: ev.audience || { mode: "all" }, rsvpEnabled: ev.rsvpEnabled, rsvpCapacity: ev.rsvpCapacity,
          invited: eligible(ev, roster).length, viewed: views, calendar: caladds, following: subs,
          rsvps: rsvps.length, headcount: headcount(rsvps),
        };
      })
    );
    rows.sort((a, b) => b.startDate.localeCompare(a.startDate));
    return json({ rows, rosterSize: Object.values(roster).filter((e) => e.active !== false).length });
  }

  const id = q.get("id") || "";
  if (!ID_RE.test(id)) return err("That event id isn't valid.");
  const ev = await store("events").get(id, { type: "json" });
  if (!ev) return err("That event no longer exists.", 404);

  const [rsvps, subs, allSubs, log] = await Promise.all([
    listJSON("rsvps", id + "/"),
    listJSON("subs", id + "/"),
    listJSON("subs", "_all/"),
    store("notifylog").get(id, { type: "json" }),
  ]);
  // Views and calendar adds are keyed by employee, so read them with their keys.
  const keyed = async (name) => {
    const { blobs } = await store(name).list({ prefix: id + "/" });
    const vals = await Promise.all(blobs.map((b) => store(name).get(b.key, { type: "json" })));
    return new Map(blobs.map((b, i) => [b.key.slice(id.length + 1), vals[i]]));
  };
  const [viewMap, calMap] = await Promise.all([keyed("views"), keyed("caladds")]);
  const rsvpMap = new Map(rsvps.map((r) => [r.employeeId, r]));
  const subMap = new Map(subs.map((s) => [s.employeeId, s]));

  // Everyone who can see the event, plus anyone with activity who no longer can.
  const keys = new Set(eligible(ev, roster).map((e) => e.key));
  for (const k of [...rsvpMap.keys(), ...subMap.keys(), ...viewMap.keys(), ...calMap.keys()]) keys.add(k);

  const people = [...keys].map((k) => {
    const e = roster[k];
    const r = rsvpMap.get(k);
    const v = viewMap.get(k);
    const c = calMap.get(k);
    const s = subMap.get(k);
    return {
      key: k,
      id: e?.id || r?.id || k,
      name: e ? displayName(e) : r?.name || s?.name || "(removed from roster)",
      company: e?.company || r?.company || "",
      division: e?.division || "",
      office: e?.office || "",
      invited: e ? e.active !== false && canSee(ev, e) : false,
      views: v?.count || 0,
      lastViewed: v?.last || "",
      calendar: c ? ["outlook", "google", "ics"].filter((t) => c[t]).map((t) => ({ outlook: "Outlook", google: "Google", ics: "Phone/other" }[t])).join(", ") : "",
      following: s ? { email: "Email", sms: "Text", both: "Email and text" }[s.method] : "",
      rsvp: !!r,
      guests: r?.guests || 0,
      rsvpAt: r?.createdAt || "",
      email: r?.email || e?.email || "",
      phone: r?.phone || e?.phone || "",
    };
  });
  people.sort((a, b) => a.name.localeCompare(b.name));

  const eligibleKeys = new Set(eligible(ev, roster).map((e) => e.key));
  return json({
    stats: {
      invited: eligibleKeys.size,
      viewed: viewMap.size,
      calendar: calMap.size,
      calendarBy: ["outlook", "google", "ics"].reduce((o, t) => ({ ...o, [t]: [...calMap.values()].filter((c) => c?.[t]).length }), {}),
      following: subs.length,
      followingAll: allSubs.filter((s) => eligibleKeys.has(s.employeeId)).length,
      rsvps: rsvps.length,
      headcount: headcount(rsvps),
    },
    people,
    log,
  });
};

export const config = { path: "/api/admin" };
