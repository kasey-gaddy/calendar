// Cancels an RSVP or stops updates from a link in an email or text, no sign-in needed.
// GET only reads (so link scanners like Safe Links can't cancel anything); POST acts.
import { store, json, err, readBody, ID_RE, TOKEN_RE, KEY_RE } from "../lib/util.mjs";

export default async (req) => {
  let type, e, u, t;
  if (req.method === "POST") ({ type, e, u, t } = (await readBody(req)) || {});
  else if (req.method === "GET") {
    const q = new URL(req.url).searchParams;
    type = q.get("type"); e = q.get("e"); u = q.get("u"); t = q.get("t");
  } else return err("Method not allowed.", 405);

  if (!["rsvp", "sub"].includes(type) || !(ID_RE.test(e || "") || e === "_all") || !KEY_RE.test(u || "") || !TOKEN_RE.test(t || "")) {
    return err("This link isn't valid. Open the event on the calendar instead.");
  }
  const s = store(type === "rsvp" ? "rsvps" : "subs");
  const key = `${e}/${u}`;
  const rec = await s.get(key, { type: "json" });
  const ev = e === "_all" ? null : await store("events").get(e, { type: "json" });
  const title = e === "_all" ? "BDL events" : ev?.title || "this event";
  if (!rec || rec.token !== t) return err(type === "rsvp" ? "This RSVP was already cancelled." : "These updates are already off.", 404);
  if (req.method === "GET") return json({ type, title });

  await s.delete(key);
  if (type === "rsvp") await store("subs").delete(key);
  return json({ ok: true, title });
};

export const config = { path: "/api/manage" };
