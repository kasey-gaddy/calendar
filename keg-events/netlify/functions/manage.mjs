// Cancels an RSVP or stops updates, using the private token from an email or text link.
// GET only reads (so link scanners like Safe Links can't cancel anything); POST acts.
import { store, json, err, readBody, ID_RE, TOKEN_RE } from "../lib/util.mjs";
import { removeSubMatching } from "../lib/subs.mjs";

export default async (req) => {
  let type, e, t;
  if (req.method === "POST") {
    const b = (await readBody(req)) || {};
    ({ type, e, t } = b);
  } else if (req.method === "GET") {
    const q = new URL(req.url).searchParams;
    type = q.get("type"); e = q.get("e"); t = q.get("t");
  } else return err("Method not allowed.", 405);

  if (!["rsvp", "sub"].includes(type) || !(ID_RE.test(e || "") || e === "_all") || !TOKEN_RE.test(t || "")) {
    return err("This link isn't valid. Open the event on the calendar instead.");
  }
  const s = store(type === "rsvp" ? "rsvps" : "subs");
  const key = `${e}/${t}`;
  const rec = await s.get(key, { type: "json" });
  const ev = e === "_all" ? null : await store("events").get(e, { type: "json" });
  const title = e === "_all" ? "all KE&G events" : ev?.title || "this event";
  if (!rec) return err(type === "rsvp" ? "This RSVP was already cancelled." : "These updates are already off.", 404);

  if (req.method === "GET") return json({ type, title });

  await s.delete(key);
  let subRemoved = false;
  if (type === "rsvp") subRemoved = (await removeSubMatching(e, rec)) > 0;
  return json({ ok: true, title, subRemoved });
};

export const config = { path: "/api/manage" };
