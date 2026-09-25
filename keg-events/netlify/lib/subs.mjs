import { store, listJSON, newToken, normPhone, validEmail } from "./util.mjs";

// Reads the "how should we reach you" choice and validates the matching fields.
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

const sameContact = (a, b) => (a.email && a.email === b.email) || (a.phone && a.phone === b.phone);

// eventId is an event id, or "_all" for people following every event.
export async function upsertSub({ eventId, name, method, email, phone }) {
  const existing = await listJSON("subs", eventId + "/");
  const match = existing.find((x) => sameContact(x, { email, phone }));
  const token = match?.token || newToken();
  const rec = {
    eventId,
    token,
    name,
    method,
    email: email || match?.email || "",
    phone: phone || match?.phone || "",
    createdAt: match?.createdAt || new Date().toISOString(),
  };
  await store("subs").setJSON(`${eventId}/${token}`, rec);
  return { token, isNew: !match };
}

export async function removeSubMatching(eventId, contact) {
  const existing = await listJSON("subs", eventId + "/");
  const matches = existing.filter((x) => sameContact(x, contact));
  await Promise.all(matches.map((m) => store("subs").delete(`${eventId}/${m.token}`)));
  return matches.length;
}

// Everyone who should hear about an event, deduplicated by address.
export async function recipientsFor(eventId, { allOnly = false } = {}) {
  const subs = [...(allOnly ? [] : await listJSON("subs", eventId + "/")), ...(await listJSON("subs", "_all/"))];
  const emails = new Map();
  const phones = new Map();
  for (const s of subs) {
    if (s.method !== "sms" && s.email && !emails.has(s.email)) emails.set(s.email, s);
    if (s.method !== "email" && s.phone && !phones.has(s.phone)) phones.set(s.phone, s);
  }
  return { emails: [...emails.values()], phones: [...phones.values()] };
}
