// Records that an employee viewed an event or added it to a calendar.
import { store, json, err, readBody, ID_RE } from "../lib/util.mjs";
import { getViewer } from "../lib/people.mjs";

const CAL = ["outlook", "google", "ics"];

export default async (req) => {
  if (req.method !== "POST") return err("Method not allowed.", 405);
  const viewer = await getViewer(req);
  if (!viewer) return err("Sign in first.", 401);
  const b = await readBody(req);
  const id = String(b?.eventId || "");
  const action = String(b?.action || "");
  if (!ID_RE.test(id) || !(action === "view" || CAL.includes(action))) return err("Nothing to record.");

  const now = new Date().toISOString();
  const s = store(action === "view" ? "views" : "caladds");
  const key = `${id}/${viewer.key}`;
  const old = (await s.get(key, { type: "json" })) || { first: now };
  if (action === "view") old.count = (old.count || 0) + 1;
  else old[action] = (old[action] || 0) + 1;
  old.last = now;
  await s.setJSON(key, old);
  return json({ ok: true });
};

export const config = { path: "/api/track" };
