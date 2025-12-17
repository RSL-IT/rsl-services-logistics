// app/logistics-auth.server.js
import { redirect, json } from "@remix-run/node";
import { createCookieSessionStorage } from "@remix-run/node";
import bcrypt from "bcryptjs";
import logisticsPrisma from "./logistics-db.server";

const sessionSecret = process.env.LOGISTICS_SESSION_SECRET;
if (!sessionSecret) {
  throw new Error("LOGISTICS_SESSION_SECRET must be set");
}

const LOGISTICS_SESSION_KEY = "logisticsUserId";

// Scope logistics cookie to logistics paths only so it doesn't bleed into other areas
const logisticsSessionStorage = createCookieSessionStorage({
  cookie: {
    name: "__rsl_logistics",
    httpOnly: true,
    sameSite: "lax",
    path: "/apps/logistics",
    secure: process.env.NODE_ENV === "production",
    secrets: [sessionSecret],
  },
});

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

/**
 * Ensure redirect targets are safe string paths.
 * - Must be a string
 * - Must start with "/"
 * - Fallback to "/apps/logistics" otherwise
 */
function sanitizeRedirectTo(redirectTo) {
  if (typeof redirectTo !== "string") {
    return "/apps/logistics";
  }
  const trimmed = redirectTo.trim();
  if (!trimmed.startsWith("/")) {
    return "/apps/logistics";
  }
  return trimmed;
}

// ─────────────────────────────────────────────
// User lookup & password verification
// ─────────────────────────────────────────────

export async function getLogisticsUserByEmail(email) {
  return logisticsPrisma.tbl_logisticsUser.findFirst({
    where: {
      email,
      isActive: true,
    },
  });
}

export async function verifyLogisticsLogin(email, password) {
  const user = await getLogisticsUserByEmail(email);
  if (!user || !user.password) return null;

  const isValid = await bcrypt.compare(password, user.password);
  if (!isValid) return null;

  return user;
}

// ─────────────────────────────────────────────
// Session helpers
// ─────────────────────────────────────────────

export async function getLogisticsUser(request) {
  const session = await logisticsSessionStorage.getSession(
    request.headers.get("Cookie")
  );
  const userId = session.get(LOGISTICS_SESSION_KEY);
  if (!userId) return null;

  return logisticsPrisma.tbl_logisticsUser.findUnique({
    where: { id: userId },
  });
}

/**
 * Require a logged-in logistics user.
 * If not present, redirect to the logistics login page,
 * preserving the original path + query as ?redirectTo=...
 */
export async function requireLogisticsUser(request) {
  const user = await getLogisticsUser(request);
  if (!user) {
    const url = new URL(request.url);
    const redirectTo = url.pathname + url.search;
    const safeRedirectTo = encodeURIComponent(
      sanitizeRedirectTo(redirectTo)
    );

    throw redirect(
      `/apps/logistics/login?redirectTo=${safeRedirectTo}`
    );
  }
  return user;
}

/**
 * Create a logistics session and redirect.
 * Any non-string / bad redirectTo will safely fall back to "/apps/logistics".
 */
export async function createLogisticsSession(userId, redirectTo) {
  const session = await logisticsSessionStorage.getSession();
  session.set(LOGISTICS_SESSION_KEY, userId);

  const safeRedirectTo = sanitizeRedirectTo(redirectTo);

  return redirect(safeRedirectTo, {
    headers: {
      "Set-Cookie": await logisticsSessionStorage.commitSession(session),
    },
  });
}

/**
 * Destroy logistics session and send user back to the logistics login page.
 */
export async function logoutLogisticsUser(request) {
  const session = await logisticsSessionStorage.getSession(
    request.headers.get("Cookie")
  );

  return redirect("/apps/logistics/login", {
    headers: {
      "Set-Cookie": await logisticsSessionStorage.destroySession(session),
    },
  });
}
