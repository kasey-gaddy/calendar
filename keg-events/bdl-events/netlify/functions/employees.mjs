// Admin roster management: bulk upload, edit one, remove one, list all.
import { json, err, isAdmin, empKey, readBody, normPhone, validEmail } from "../lib/util.mjs";
import { getRoster, saveRoster, normCompany, ensureFeedToken } from "../lib/people.mjs";

const FIELDS = ["first", "last", "preferred", "company", "email", "phone", "division", "office"];

function cleanRow(r) {
  const out = {};
  for (const f of FIELDS) out[f] = String(r[f] ?? "").trim().slice(0, 80);
  out.company = normCompany(out.company);
  out.email = validEmail(out.email) ? out.email.toLowerCase() : "";
  out.phone = normPhone(out.phone) || "";
  return out;
}

export default async (req) => {
  if (!isAdmin(req)) return err("Sign in as an admin.", 401);
  const roster = await getRoster();
  const now = new Date().toISOString();

  if (req.method === "GET") {
    const list = Object.values(roster).map(({ feedToken, ...e }) => e);
    list.sort((a, b) => (a.last + a.first).localeCompare(b.last + b.first));
    return json({ employees: list });
  }

  const b = await readBody(req);

  // Bulk upload. Adds new people and updates existing ones. Blank cells never
  // erase what's already on file, and nobody missing from the file is changed.
  if (req.method === "POST") {
    if (!Array.isArray(b?.rows)) return err("No rows to import.");
    if (b.rows.length > 5000) return err("That's more than 5,000 rows. Split the file and upload it in parts.");
    const result = { added: 0, updated: 0, unchanged: 0, skipped: [] };
    const seen = new Set();
    b.rows.forEach((raw, i) => {
      const rowNum = raw.rowNumber || i + 2;
      const key = empKey(raw.id);
      if (!key) return result.skipped.push({ row: rowNum, reason: "Missing or invalid employee ID" });
      if (seen.has(key)) return result.skipped.push({ row: rowNum, reason: `Employee ID ${raw.id} appears more than once in the file` });
      seen.add(key);
      const row = cleanRow(raw);
      if (b.defaultCompany && !row.company) row.company = normCompany(b.defaultCompany);
      const old = roster[key];
      if (!old) {
        if (!row.first || !row.last) return result.skipped.push({ row: rowNum, reason: "Missing first or last name" });
        roster[key] = ensureFeedToken({ key, id: String(raw.id).trim(), ...row, active: true, createdAt: now, updatedAt: now });
        result.added++;
        return;
      }
      let changed = false;
      for (const f of FIELDS) {
        if (row[f] && row[f] !== old[f]) {
          old[f] = row[f];
          changed = true;
        }
      }
      if (changed) {
        old.updatedAt = now;
        result.updated++;
      } else result.unchanged++;
    });
    await saveRoster(roster);
    return json(result);
  }

  // Add or edit one person.
  if (req.method === "PUT") {
    const key = empKey(b?.id);
    if (!key) return err("Enter an employee ID.");
    const row = cleanRow(b);
    if (!row.first || !row.last) return err("Enter a first and last name.");
    if (b.email && !row.email) return err("That email address isn't valid.");
    if (b.phone && !row.phone) return err("Enter the mobile number as 10 digits.");
    const old = roster[key];
    if (b.isNew && old) return err(`Employee ID ${b.id} is already on the roster as ${old.first} ${old.last}.`);
    roster[key] = ensureFeedToken({
      ...(old || { key, id: String(b.id).trim(), createdAt: now }),
      ...row,
      active: b.active !== false,
      updatedAt: now,
    });
    await saveRoster(roster);
    const { feedToken, ...emp } = roster[key];
    return json({ employee: emp });
  }

  // Remove one person. Their past RSVPs and activity stay in event reports.
  if (req.method === "DELETE") {
    const key = empKey(new URL(req.url).searchParams.get("id"));
    if (!key || !roster[key]) return err("That employee isn't on the roster.", 404);
    delete roster[key];
    await saveRoster(roster);
    return json({ ok: true });
  }

  return err("Method not allowed.", 405);
};

export const config = { path: "/api/employees" };
