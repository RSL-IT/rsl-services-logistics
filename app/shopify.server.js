// app/shopify.server.js
import { shopifyApp } from "@shopify/shopify-app-remix/server";
import { PrismaClient } from "@prisma/client";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";

const appUrl =
  process.env.SHOPIFY_APP_URL ||
  (process.env.FLY_APP_NAME ? `https://${process.env.FLY_APP_NAME}.fly.dev` : undefined);

const callbackPath = process.env.SHOPIFY_AUTH_CALLBACK_PATH || "/auth/callback";

// Scopes can live in SHOPIFY_SCOPES or SCOPES (comma-separated)
const scopes = (process.env.SHOPIFY_SCOPES || process.env.SCOPES || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const prisma = new PrismaClient();

export const shopify = shopifyApp({
  appUrl,
  auth: {
    path: "/auth/login",
    callbackPath,
  },
  api: {
    apiKey: process.env.SHOPIFY_API_KEY,
    apiSecretKey: process.env.SHOPIFY_API_SECRET,
    scopes,
    // apiVersion: "2024-10",
  },
  webhooks: { path: "/webhooks" },
  sessionStorage: new PrismaSessionStorage(prisma),
});

export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
export const authenticate = shopify.authenticate;
// expose the constructed instance for places that import getShopify
export const getShopify = () => shopify;
// your auth.$ route imports `callbackAuth`
export const callbackAuth = (args) => shopify.auth.callback(args);
