// Admin-managed list of companies used in dropdowns, uploads, and event audiences.
import { json, err, isAdmin, readBody, listJSON } from "../lib/util.mjs";
import { getRoster, getCompanies, saveCompanies } from "../lib/people.mjs";

export default async (req) => {
  if (!isAdmin(req)) return err("Sign in as an admin.", 401);
  if (req.method === "GET") return json({ companies: await getCompanies() });
  if (req.method !== "PUT") return err("Method not allowed.", 405);

  const b = await readBody(req);
  if (!Array.isArray(b?.companies)) return err("No company list was sent.");
  const next = [];
  for (const c of b.companies) {
    const name = String(c || "").trim().slice(0, 40);
    if (name && !next.some((x) => x.toLowerCase() === name.toLowerCase())) next.push(name);
  }
  if (!next.length) return err("Keep at least one company on the list.");

  // Don't let a company disappear while people or events still use it.
  const removed = (await getCompanies()).filter((c) => !next.includes(c));
  if (removed.length) {
    const [roster, events] = await Promise.all([getRoster(), listJSON("events")]);
    for (const c of removed) {
      const people = Object.values(roster).filter((e) => e.company === c).length;
      if (people) return err(`${people} ${people === 1 ? "employee is" : "employees are"} assigned to ${c}. Move them to another company first.`);
      const ev = events.find((e) => e.audience?.mode === "companies" && e.audience.companies?.includes(c));
      if (ev) return err(`"${ev.title}" is set to show only to ${c}. Change that event first.`);
    }
  }
  await saveCompanies(next);
  return json({ companies: next });
};

export const config = { path: "/api/companies" };
