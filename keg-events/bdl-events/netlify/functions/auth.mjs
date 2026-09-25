// Sign in with employee ID plus first and last name. Returns a session token.
import { store, json, err, empKey, newToken, readBody } from "../lib/util.mjs";
import { getRoster, saveRoster, nameMatches, ensureFeedToken } from "../lib/people.mjs";

const MAX_TRIES = 8;
const WINDOW_MS = 15 * 60e3;

export default async (req) => {
  const sessions = store("sessions");
  if (req.method === "DELETE") {
    const t = req.headers.get("x-session") || "";
    if (t) await sessions.delete(t);
    return json({ ok: true });
  }
  if (req.method !== "POST") return err("Method not allowed.", 405);
  const b = await readBody(req);
  if (!b) return err("The request was empty or malformed.");
  const key = empKey(b.employeeId);
  if (!key) return err("Enter your employee ID.");
  if (!String(b.first || "").trim() || !String(b.last || "").trim()) return err("Enter your first and last name.");

  const fails = store("authfail");
  const f = await fails.get(key, { type: "json" });
  const inWindow = f && Date.now() - f.since < WINDOW_MS;
  if (inWindow && f.count >= MAX_TRIES) return err("Too many tries. Wait 15 minutes, then try again.", 429);

  const roster = await getRoster();
  const emp = roster[key];
  if (!emp || emp.active === false || !nameMatches(emp, b.first, b.last)) {
    await fails.setJSON(key, inWindow ? { count: f.count + 1, since: f.since } : { count: 1, since: Date.now() });
    return err("That name and employee ID don't match our records. Use your name the way HR has it, or check with HR.", 401);
  }
  await fails.delete(key);
  if (!emp.feedToken) {
    ensureFeedToken(emp);
    await saveRoster(roster);
  }
  const token = newToken();
  await sessions.setJSON(token, { employeeId: key, createdAt: new Date().toISOString() });
  return json({ token });
};

export const config = { path: "/api/auth" };
