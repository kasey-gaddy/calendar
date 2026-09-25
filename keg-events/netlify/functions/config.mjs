import { json, err, isEmployee, isAdmin } from "../lib/util.mjs";
import { emailReady, smsReady } from "../lib/notify.mjs";

export default async (req) => {
  if (!isEmployee(req)) return err("Enter the employee access code.", 401);
  return json({ admin: isAdmin(req), emailReady: emailReady(), smsReady: smsReady() });
};

export const config = { path: "/api/config" };
