import { store, listJSON, newToken, normPhone, validEmail } from "./util.mjs";
import { canSee, displayName } from "./people.mjs";

export function parseContact(b) {
  const method = ["email", "sms", "both"].includes(b.method) ? b.method : "email";
  const out = { method, email: "", phone: "" };
  if (method !== "sms") {
    const e = String(b.email || "").trim().toLowerCase();
    if (!validEmail(e)) return { error: "Add a valid email address." };
    out.email = e;
  }
  if (method !== "email") {
    const p = normPhone(b.phone);
    if (!p) return { error: "Add a 10-digit mobile number." };
    out.phone = p;
  }
  return out;
}

// Remembers how someone likes to be reached, so forms fill in next time.
export async function savePrefs(emp, { method, email, phone }) {
  const s = store("prefs");
  const old = (await s.get(emp.key, { type: "json" })) || {};
  await s.setJSON(emp.key, { method, email: email || old.email || "", phone: phone || old.phone || "" });
}

// eventId is an event id, or "_all" for people following every event they can see.
export async function upsertSub({ eventId, emp, method, email, phone }) {
  const s = store("subs");
  const key = `${eventId}/${emp.key}`;
  const old = await s.get(key, { type: "json" });
  const now = new Date().toISOString();
  const rec = {
    eventId,
    employeeId: emp.key,
    name: displayName(emp),
    method,
    email,
    phone,
    token: old?.token || newToken(),
    createdAt: old?.createdAt || now,
    updatedAt: now,
  };
  await s.setJSON(key, rec);
  return { token: rec.token, isNew: !old };
}

// Everyone who should hear about an event: its followers plus people following
// all events, limited to employees who can still see it. Deduplicated by address.
export async function recipientsFor(ev, roster, { allOnly = false } = {}) {
  const subs = [...(allOnly ? [] : await listJSON("subs", ev.id + "/")), ...(await listJSON("subs", "_all/"))];
  const emails = new Map();
  const phones = new Map();
  for (const s of subs) {
    const emp = roster[s.employeeId];
    if (!emp || emp.active === false || !canSee(ev, emp)) continue;
    const who = { ...s, first: emp.preferred || emp.first };
    if (s.method !== "sms" && s.email && !emails.has(s.email)) emails.set(s.email, who);
    if (s.method !== "email" && s.phone && !phones.has(s.phone)) phones.set(s.phone, who);
  }
  return { emails: [...emails.values()], phones: [...phones.values()] };
}
