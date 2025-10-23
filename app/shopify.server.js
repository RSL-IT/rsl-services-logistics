// app/shopify.server.js
// ESM, works with Remix + @shopify/shopify-app-remix
// Uses Prisma for session storage and reads both SHOPIFY_* and VITE_* env names.

import { shopifyApp } from "@shopify/shopify-app-remix/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import { PrismaClient } from "@prisma/client";

// ---------- Prisma (avoid re-instantiating in dev) ----------
let prisma;
if (process.env.NODE_ENV === "production") {
  prisma = new PrismaClient();
} else {
  // @ts-ignore
  global.__PRISMA__ = global.__PRISMA__ || new PrismaClient();
  // @ts-ignore
  prisma = global.__PRISMA__;
}
export { prisma };

// ---------- Env resolution (accept multiple var names) ----------
const apiKey =
  process.env.SHOPIFY_API_KEY || process.env.VITE_SHOPIFY_API_KEY || "";
const apiSecretKey =
  process.env.SHOPIFY_API_SECRET ||
  process.env.SHOPIFY_API_SECRET_KEY ||
  "";

const scopesRaw =
  process.env.SCOPES || process.env.SHOPIFY_API_SCOPES || "";
const scopes = scopesRaw
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const appUrl = process.env.SHOPIFY_APP_URL || "";
const defaultStore =
  process.env.SHOPIFY_STORE_DOMAIN || process.env.SHOP_CUSTOM_DOMAIN || "";

// Safe debug (no secrets printed)
if (!apiKey || !apiSecretKey) {
  console.error("Shopify env check failed", {
    hasApiKey: !!apiKey,
    hasApiSecretKey: !!apiSecretKey,
    scopesCount: scopes.length,
    appUrl,
    defaultStore,
  });
}

// ---------- Session storage via Prisma ----------
export const sessionStorage = new PrismaSessionStorage(prisma, {
  // Prisma model name for sessions (matches your schema)
  sessionModel: "Session",
});

// ---------- Shopify App instance ----------
export const shopify = shopifyApp({
  api: {
    apiKey,
    apiSecretKey,
    apiVersion: process.env.SHOPIFY_API_VERSION || "2025-01",
    scopes,
    // If you end up using REST, you can add restResources here.
  },
  sessionStorage,
  appUrl, // e.g. https://rsl-services-app.fly.dev
  auth: {
    path: "/auth",
    callbackPath: "/auth/callback",
  },
  webhooks: {
    path: "/webhooks",
  },
});

// Export the helpers Remix routes expect
export const { authenticate, unauthenticated, addDocumentResponseHeaders } =
  shopify;

// ---------- Convenience helpers ----------

/**
 * Resolve a shop domain to use when one isn’t explicitly provided.
 * Prefer the querystring ?shop=…, then fallback to env default.
 */
export function resolveShopParam(request) {
  try {
    const url = new URL(request.url);
    const qsShop = (url.searchParams.get("shop") || "").trim();
    return qsShop || defaultStore || null;
  } catch {
    return defaultStore || null;
  }
}

/**
 * Load the offline Admin session for a shop (used by server jobs/endpoints).
 */
export async function loadOfflineAdminSession(shop) {
  if (!shop) throw new Error("loadOfflineAdminSession: missing shop");
  const id = shopify.api.session.getOfflineId(shop);
  return sessionStorage.loadSession(id);
}

/**
 * Get a pre-authenticated Admin GraphQL client for the given shop.
 * Throws with a helpful message if there’s no offline session.
 */
export async function getAdminGraphqlClient(shop) {
  const session = await loadOfflineAdminSession(shop);
  if (!session) {
    throw new Error(
      `No offline Admin session for ${shop}. Re-install or re-authorize the app.`
    );
  }
  return new shopify.api.clients.Graphql({ session });
}

/**
 * Utility: return the configured scopes as an array (useful for logs/health).
 */
export function getConfiguredScopes() {
  return scopes.slice();
}
