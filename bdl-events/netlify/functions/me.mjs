// Who's signed in, plus settings the page needs.
import { store, json, err, isAdmin } from "../lib/util.mjs";
import { getViewer } from "../lib/people.mjs";
import { emailReady, smsReady } from "../lib/notify.mjs";

export default async (req) => {
  const admin = isAdmin(req);
  const v = admin ? null : await getViewer(req);
  if (!admin && !v) return err("Sign in to see events.", 401);
  let viewer = null;
  if (v) {
    const prefs = (await store("prefs").get(v.key, { type: "json" })) || {};
    const followingAll = !!(await store("subs").get(`_all/${v.key}`));
    viewer = {
      id: v.id,
      first: v.preferred || v.first,
      last: v.last,
      company: v.company,
      email: prefs.email || v.email || "",
      phone: prefs.phone || v.phone || "",
      method: prefs.method || (v.email ? "email" : v.phone ? "sms" : "email"),
      feedToken: v.feedToken,
      followingAll,
    };
  }
  return json({ admin, emailReady: emailReady(), smsReady: smsReady(), viewer });
};

export const config = { path: "/api/me" };
