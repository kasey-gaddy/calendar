import { store, json, err, isAdmin, listJSON, ID_RE } from "../lib/util.mjs";

export default async (req) => {
  if (!isAdmin(req)) return err("Sign in as an admin.", 401);
  const id = new URL(req.url).searchParams.get("id") || "";
  if (!ID_RE.test(id)) return err("That event id isn't valid.");
  const [rsvps, subs, log, all] = await Promise.all([
    listJSON("rsvps", id + "/"),
    listJSON("subs", id + "/"),
    store("notifylog").get(id, { type: "json" }),
    listJSON("subs", "_all/"),
  ]);
  rsvps.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const strip = ({ token, ...rest }) => rest;
  return json({ rsvps: rsvps.map(strip), subs: subs.map(strip), followingAll: all.length, log });
};

export const config = { path: "/api/admin" };
