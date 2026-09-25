import { getStore } from "@netlify/blobs";
import { randomUUID } from "node:crypto";

export const store = (name) => getStore({ name, consistency: "strong" });

export const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...headers },
  });

export const err = (message, status = 400) => json({ error: message }, status);

export const newId = () => randomUUID().replace(/-/g, "").slice(0, 12);
export const newToken = () => randomUUID().replace(/-/g, "");

export const ID_RE = /^[a-f0-9]{12}$/;
export const TOKEN_RE = /^[a-f0-9]{32}$/;
export const KEY_RE = /^[A-Z0-9_-]{1,40}$/;

// Employee IDs are matched loosely: case and spaces ignored, and leading zeros
// dropped, because Excel often strips them (00123 becomes 123).
export function empKey(v) {
  let s = String(v ?? "").trim().toUpperCase().replace(/\s+/g, "");
  s = s.replace(/\.0+$/, "").replace(/^0+(?=.)/, "");
  return KEY_RE.test(s) ? s : "";
}

export function isAdmin(req) {
  const pw = process.env.ADMIN_PASSWORD;
  return !!pw && req.headers.get("x-admin-key") === pw;
}

export const siteUrl = () => (process.env.SITE_URL || process.env.URL || "").replace(/\/$/, "");

export async function listJSON(storeName, prefix) {
  const s = store(storeName);
  const { blobs } = await s.list(prefix ? { prefix } : {});
  const items = await Promise.all(blobs.map((b) => s.get(b.key, { type: "json" })));
  return items.filter(Boolean);
}

export async function countPrefix(storeName, prefix) {
  const { blobs } = await store(storeName).list({ prefix });
  return blobs.length;
}

export async function deletePrefix(storeName, prefix) {
  const s = store(storeName);
  const { blobs } = await s.list({ prefix });
  await Promise.all(blobs.map((b) => s.delete(b.key)));
}

export function normPhone(p) {
  const d = String(p || "").replace(/\D/g, "");
  if (d.length === 10) return "+1" + d;
  if (d.length === 11 && d[0] === "1") return "+" + d;
  return null;
}

export const validEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e || "").trim());

export async function readBody(req) {
  try {
    return await req.json();
  } catch {
    return null;
  }
}
