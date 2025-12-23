import { redirect, json } from "@remix-run/node";
import { createCookieSessionStorage } from "@remix-run/node";
import bcrypt from "bcryptjs";
import { logisticsDb } from "~/logistics-db.server";

const LOGISTICS_SESSION_KEY = "logisticsUserId";

const isProd = process.env.NODE_ENV === "production";

const logisticsSessionStorage = createCookieSessionStorage({
  cookie: {
    name: "__rsl_logistics",
    httpOnly: true,
    // In Shopify embedded contexts the portal is often loaded in an iframe.
    // Third-party cookies generally require SameSite=None; Secure.
    sameSite: isProd ? "none" : "lax",
    path: "/",
    secure: isProd, // REQUIRED when sameSite: 'none'
    secrets: [process.env.SESSION_SECRET || "dev-secret"],
  },
});

export async function getLogisticsSession(request) {
  return logisticsSessionStorage.getSession(request.headers.get("Cookie"));
}

export async function getLogisticsUser(request) {
  const session = await getLogisticsSession(request);
  const userId = session.get(LOGISTICS_SESSION_KEY);

  if (!userId) return null;

  return logisticsDb.tbl_logisticsUser.findUnique({
    where: { id: Number(userId) },
  });
}

export async function requireLogisticsUser(request) {
  const user = await getLogisticsUser(request);
  if (!user) throw redirect("/apps/logistics/portal");
  return user;
}

export async function verifyLogisticsLogin(email, password) {
  const user = await logisticsDb.tbl_logisticsUser.findFirst({
    where: { email, isActive: true },
  });

  if (!user || !user.password) return null;

  const isValid = await bcrypt.compare(password, user.password);
  if (!isValid) return null;

  return user;
}

// For redirect flows (kept for compatibility)
export async function createLogisticsSession(userId) {
  const session = await logisticsSessionStorage.getSession();
  session.set(LOGISTICS_SESSION_KEY, userId);

  return redirect("/apps/logistics/portal", {
    headers: {
      "Set-Cookie": await logisticsSessionStorage.commitSession(session),
    },
  });
}

// For JSON endpoints (login action)
export async function commitLogisticsUserSession(request, userId) {
  const session = await logisticsSessionStorage.getSession(
    request.headers.get("Cookie"),
  );
  session.set(LOGISTICS_SESSION_KEY, userId);

  return logisticsSessionStorage.commitSession(session);
}

// For JSON endpoints (logout action)
export async function destroyLogisticsUserSession(request) {
  const session = await logisticsSessionStorage.getSession(
    request.headers.get("Cookie"),
  );
  return logisticsSessionStorage.destroySession(session);
}

export async function logoutLogisticsUser(request) {
  const session = await getLogisticsSession(request);
  return redirect("/apps/logistics/portal", {
    headers: {
      "Set-Cookie": await logisticsSessionStorage.destroySession(session),
    },
  });
}

export async function ensureLogisticsUserOrJson(request) {
  const user = await getLogisticsUser(request);
  if (!user) return json({ ok: false, error: "Unauthorized" }, { status: 401 });
  return user;
}
