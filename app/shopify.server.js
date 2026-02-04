// app/shopify.server.js
import { shopifyApp } from "@shopify/shopify-app-remix/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import prisma from "./db.server.js";

// ─────────────────────────────────────────────
// Validate environment
// ─────────────────────────────────────────────

const APP_URL = process.env.SHOPIFY_APP_URL;
const API_KEY = process.env.SHOPIFY_API_KEY;
const API_SECRET = process.env.SHOPIFY_API_SECRET;

if (!API_KEY) {
  throw new Error("SHOPIFY_API_KEY must be set");
}
if (!API_SECRET) {
  throw new Error("SHOPIFY_API_SECRET must be set");
}
if (!APP_URL) {
  throw new Error("SHOPIFY_APP_URL must be set (e.g. https://rsl-services-app.fly.dev)");
}

// Must be a full URL with protocol so sanitizeRedirectUrl doesn’t explode
try {
  const parsed = new URL(APP_URL);
  if (!/^https:?$/.test(parsed.protocol)) {
    throw new Error();
  }
} catch {
  throw new Error(
    `SHOPIFY_APP_URL is invalid. It must be a full https URL, e.g. "https://rsl-services-app.fly.dev". ` +
    `Current value: "${APP_URL}"`
  );
}

console.log("[boot] SHOPIFY_APP_URL:", APP_URL);
console.log("[boot] OAuth callback:", `${APP_URL}/auth/callback`);

// ─────────────────────────────────────────────
// Shopify app configuration
// ─────────────────────────────────────────────

const shopify = shopifyApp({
  apiKey: API_KEY,
  apiSecretKey: API_SECRET,
  appUrl: APP_URL,              // must match the value in Partners > App setup
  authPathPrefix: "/auth",      // so /auth, /auth/login, /auth/callback, /auth/exit-iframe all work
  scopes: (process.env.SCOPES || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),

  sessionStorage: new PrismaSessionStorage(prisma),

  future: {
    // leave this as false for now – not related to your current error
    unstable_newEmbeddedAuthStrategy: false,
  },
});

// Stable, shared exports used across your app
export { shopify };
export const auth = shopify.auth;
export const authenticate = shopify.authenticate;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;

// Compatibility helper for any legacy imports
export const getShopify = () => shopify;

// Default export for convenience
export default shopify;
