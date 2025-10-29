// app/shopify.server.js
import { shopifyApp } from "@shopify/shopify-app-remix/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import prisma from "./db.server.js";

// Basic env validation (kept minimal so it doesn't crash during typegen)
const required = ["SHOPIFY_API_KEY", "SHOPIFY_API_SECRET", "SHOPIFY_APP_URL"];
for (const k of required) {
  if (!process.env[k]) {
    // Don't throw during import in dev; the library will throw when used.
    console.warn(`[shopify.server] Missing ${k} in environment`);
  }
}

const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET,
  appUrl: process.env.SHOPIFY_APP_URL,
  // Comma-separated list in .env (e.g. read_products,write_products)
  scopes: (process.env.SCOPES || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),

  // Persist sessions in your Prisma DB
  sessionStorage: new PrismaSessionStorage(prisma),

  // Keep defaults; routes assume /auth/… for OAuth
  authPathPrefix: "/auth",

  // Mirror the log line you’re seeing; leave disabled unless you switch to managed install
  future: {
    unstable_newEmbeddedAuthStrategy: false,
  },
});

// Stable, shared exports used across your app
export { shopify };
export const auth = shopify.auth; // has .begin/.callback
export const authenticate = shopify.authenticate; // e.g. authenticate.admin
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;

// Compatibility helper for any legacy imports you still have around
export const getShopify = () => shopify;
