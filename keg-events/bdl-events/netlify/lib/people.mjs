import { store, TOKEN_RE, newToken } from "./util.mjs";

const SESSION_DAYS = 180;

// The whole roster lives in one record. A few hundred employees is well under
// the size limit, and one read is much faster than hundreds of small ones.
export async function getRoster() {
  return (await store("roster").get("employees", { type: "json" })) || {};
}
export async function saveRoster(roster) {
  await store("roster").setJSON("employees", roster);
}

export const normName = (s) =>
  String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z]/g, "");

export function normCompany(s) {
  const raw = String(s || "").trim();
  const n = raw.toLowerCase().replace(/[^a-z]/g, "");
  if (!n) return "";
  if (n.startsWith("keg")) return "KE&G";
  if (n.startsWith("maddux")) return "Maddux";
  if (n === "bdl" || n.startsWith("bluediamond")) return "BDL";
  return raw.slice(0, 40);
}

export const displayName = (e) => [e.preferred || e.first, e.last].filter(Boolean).join(" ");
export const legalName = (e) => [e.first, e.last].filter(Boolean).join(" ");

export function canSee(ev, emp) {
  const a = ev.audience || { mode: "all" };
  if (a.mode === "companies") return (a.companies || []).includes(emp.company);
  if (a.mode === "invite") return (a.ids || []).includes(emp.key);
  return true;
}

export const eligible = (ev, roster) => Object.values(roster).filter((e) => e.active !== false && canSee(ev, e));

// First name matches the legal first name, its first word ("Mary" for "Mary Ann"),
// or a preferred name if the roster has one. Last name must match exactly,
// ignoring case, accents, spaces, hyphens, and apostrophes.
export function nameMatches(emp, first, last) {
  const f = normName(first);
  const l = normName(last);
  if (!f || !l) return false;
  const firsts = [emp.first, String(emp.first || "").trim().split(/\s+/)[0], emp.preferred].map(normName).filter(Boolean);
  return firsts.includes(f) && normName(emp.last) === l;
}

export async function getViewer(req, bodyToken) {
  const token = bodyToken || req.headers.get("x-session") || "";
  if (!TOKEN_RE.test(token)) return null;
  const s = await store("sessions").get(token, { type: "json" });
  if (!s) return null;
  if (Date.now() - Date.parse(s.createdAt) > SESSION_DAYS * 864e5) {
    await store("sessions").delete(token);
    return null;
  }
  const roster = await getRoster();
  const emp = roster[s.employeeId];
  if (!emp || emp.active === false) return null;
  return emp;
}

export function ensureFeedToken(emp) {
  if (!emp.feedToken) emp.feedToken = newToken();
  return emp;
}

export async function employeeByFeedToken(t) {
  if (!TOKEN_RE.test(t || "")) return null;
  const roster = await getRoster();
  const emp = Object.values(roster).find((e) => e.feedToken === t);
  return emp && emp.active !== false ? emp : null;
}
