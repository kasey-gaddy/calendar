import { createHmac, createHash } from "node:crypto";
import { siteUrl } from "./util.mjs";

export const emailReady = () =>
  ["GRAPH_TENANT_ID", "GRAPH_CLIENT_ID", "GRAPH_CLIENT_SECRET", "MAIL_SENDER"].every((k) => process.env[k]);
export const smsReady = () => !!(process.env.ACS_CONNECTION_STRING && process.env.ACS_FROM_NUMBER);

export const eventUrl = (id) => `${siteUrl()}/?event=${id}`;
export const manageUrl = (type, e, u, t) =>
  `${siteUrl()}/manage.html?type=${type}&e=${encodeURIComponent(e)}&u=${encodeURIComponent(u)}&t=${t}`;

// ── Email through Microsoft Graph (app registration with Mail.Send) ──────────
let cachedToken = null;
async function graphToken() {
  if (cachedToken && cachedToken.exp > Date.now() + 60e3) return cachedToken.value;
  const { GRAPH_TENANT_ID, GRAPH_CLIENT_ID, GRAPH_CLIENT_SECRET } = process.env;
  const res = await fetch(`https://login.microsoftonline.com/${GRAPH_TENANT_ID}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: GRAPH_CLIENT_ID,
      client_secret: GRAPH_CLIENT_SECRET,
      scope: "https://graph.microsoft.com/.default",
      grant_type: "client_credentials",
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Graph sign-in failed: ${data.error_description || res.status}`);
  cachedToken = { value: data.access_token, exp: Date.now() + data.expires_in * 1000 };
  return cachedToken.value;
}

export async function sendEmail(to, subject, html) {
  const token = await graphToken();
  const res = await fetch(
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(process.env.MAIL_SENDER)}/sendMail`,
    {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        message: {
          subject,
          body: { contentType: "HTML", content: html },
          toRecipients: [{ emailAddress: { address: to } }],
        },
        saveToSentItems: false,
      }),
    }
  );
  if (!res.ok) throw new Error(`Email to ${to} failed (${res.status}): ${await res.text()}`);
}

// ── Text messages through Azure Communication Services (HMAC-signed REST) ────
function acsConfig() {
  const pairs = process.env.ACS_CONNECTION_STRING.split(";").filter(Boolean).map((p) => {
    const i = p.indexOf("=");
    return [p.slice(0, i).trim().toLowerCase(), p.slice(i + 1).trim()];
  });
  const cfg = Object.fromEntries(pairs);
  return { endpoint: new URL(cfg.endpoint), key: cfg.accesskey };
}

export async function sendSms(to, message) {
  const { endpoint, key } = acsConfig();
  const pathAndQuery = "/sms?api-version=2021-03-07";
  const body = JSON.stringify({
    from: process.env.ACS_FROM_NUMBER,
    smsRecipients: [{ to }],
    message,
    smsSendOptions: { enableDeliveryReport: false },
  });
  const date = new Date().toUTCString();
  const contentHash = createHash("sha256").update(body).digest("base64");
  const stringToSign = `POST\n${pathAndQuery}\n${date};${endpoint.host};${contentHash}`;
  const signature = createHmac("sha256", Buffer.from(key, "base64")).update(stringToSign).digest("base64");
  const res = await fetch(new URL(pathAndQuery, endpoint), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-ms-date": date,
      "x-ms-content-sha256": contentHash,
      authorization: `HMAC-SHA256 SignedHeaders=x-ms-date;host;x-ms-content-sha256&Signature=${signature}`,
    },
    body,
  });
  if (!res.ok) throw new Error(`Text to ${to} failed (${res.status}): ${await res.text()}`);
}

// ── Email layout ─────────────────────────────────────────────────────────────
const h = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export function emailHtml({ greeting, heading, intro, items = [], note, ctaUrl, ctaLabel = "View event", footer }) {
  const list = items.length
    ? `<ul style="margin:0 0 20px;padding-left:20px">${items
        .map((i) => `<li style="margin:0 0 6px">${h(i.text)}${i.was ? `<br><span style="color:#8C93A8;text-decoration:line-through">${h(i.was)}</span>` : ""}</li>`)
        .join("")}</ul>`
    : "";
  return `<!doctype html><html><body style="margin:0;background:#F2F4F7;font-family:Arial,Helvetica,sans-serif;color:#152b5a">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F2F4F7;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:8px;overflow:hidden">
<tr><td style="background:#152b5a;border-bottom:5px solid #99b2d1;padding:16px 24px;color:#ffffff;font-size:20px;font-weight:bold">BDL Events</td></tr>
<tr><td style="padding:24px">
<h1 style="margin:0 0 12px;font-size:24px;line-height:1.2;color:#152b5a">${h(heading)}</h1>
${greeting ? `<p style="margin:0 0 12px;font-size:16px">${h(greeting)}</p>` : ""}
${intro ? `<p style="margin:0 0 16px;font-size:16px;line-height:1.5">${h(intro)}</p>` : ""}
${list}
${note ? `<p style="margin:0 0 20px;padding:12px 14px;background:#EEF3FA;border-left:4px solid #233e87;font-size:15px;line-height:1.5">${h(note)}</p>` : ""}
${ctaUrl ? `<a href="${ctaUrl}" style="display:inline-block;background:#233e87;color:#ffffff;text-decoration:none;font-weight:bold;padding:12px 20px;border-radius:6px">${h(ctaLabel)}</a>` : ""}
</td></tr>
${footer ? `<tr><td style="padding:16px 24px;border-top:1px solid #EEF0F4;font-size:12px;color:#5A6280;line-height:1.5">${footer}</td></tr>` : ""}
</table></td></tr></table></body></html>`;
}

// Sends to a recipient list a few at a time. Never throws; returns counts and failures.
export async function deliver({ emails = [], phones = [], subject, html, sms }) {
  const result = { email: 0, sms: 0, failed: [], skipped: [] };
  const jobs = [];
  if (emails.length && !emailReady()) result.skipped.push(`${emails.length} email(s): email is not set up`);
  else for (const s of emails) jobs.push(() => sendEmail(s.email, subject, html(s)).then(() => result.email++));
  if (phones.length && !smsReady()) result.skipped.push(`${phones.length} text(s): texting is not set up`);
  else for (const s of phones) jobs.push(() => sendSms(s.phone, sms(s)).then(() => result.sms++));

  let i = 0;
  const worker = async () => {
    while (i < jobs.length) {
      const job = jobs[i++];
      try {
        await job();
      } catch (e) {
        result.failed.push(String(e.message || e).slice(0, 300));
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(5, jobs.length) }, worker));
  return result;
}

export const siteUrlSafe = () => siteUrl() + "/";
