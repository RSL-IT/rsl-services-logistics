// app/shopify-admin.server.js
// Robust helpers for Shopify Admin API from public/unauthenticated routes.
//
// Key features:
// - Accepts EITHER a shop string or a Request object in all helpers.
// - Uses your app's exported "auth"/"shopify" object if present.
// - Falls back to Prisma Session table (offline token) if app session storage isn't available.
// - GraphQL runs via Shopify client when available, else via fetch + X-Shopify-Access-Token.
// - Keeps legacy aliases used elsewhere in your app.

import * as shopifyModule from "~/shopify.server";
import { prisma } from "~/db.server";

const app =
  shopifyModule?.auth ??
  shopifyModule?.shopify ??
  shopifyModule?.default ??
  null;

const ADMIN_API_VERSION = process.env.SHOPIFY_API_VERSION || "2024-10";

/** Get `shop` from ?shop=… or x-shopify-shop-domain header (Request only). */
export function requireShopParam(request) {
  const url = new URL(request.url);
  const shop =
    url.searchParams.get("shop") ||
    request.headers.get("x-shopify-shop-domain") ||
    undefined;

  if (!shop) {
    throw new Response("Missing shop parameter", { status: 400 });
  }
  return shop;
}

/** Type guard for a Request-like object (Remix/undici/node-fetch). */
function isRequestLike(v) {
  return (
    v &&
    typeof v === "object" &&
    typeof v.url === "string" &&
    v.headers &&
    typeof v.headers.get === "function"
  );
}

/** Normalize input to a shop domain string. Accepts shop string OR Request. */
function resolveShop(shopOrRequest) {
  if (typeof shopOrRequest === "string") return shopOrRequest;
  if (isRequestLike(shopOrRequest)) return requireShopParam(shopOrRequest);
  // Also accept objects like { shop: "example.myshopify.com" }
  if (
    shopOrRequest &&
    typeof shopOrRequest === "object" &&
    typeof shopOrRequest.shop === "string"
  ) {
    return shopOrRequest.shop;
  }
  throw new Error(
    "Invalid shop identifier. Pass a shop string, a Request, or an object with { shop }."
  );
}

/** Load an offline session/token for the shop (with fallbacks). */
export async function getOfflineSession(shopOrRequest) {
  const shop = resolveShop(shopOrRequest);

  // 1) Preferred: app's session storage (if available)
  if (app?.sessionStorage) {
    // Try direct offline id (newer APIs)
    let session = null;
    if (app?.api?.session?.getOfflineId) {
      try {
        const offlineId = app.api.session.getOfflineId(shop);
        session = await app.sessionStorage.loadSession(offlineId);
      } catch {
        // ignore and fall through
      }
    }
    // Fallback: enumerate sessions by shop and pick an offline one
    if (!session && app.sessionStorage.findSessionsByShop) {
      try {
        const list = await app.sessionStorage.findSessionsByShop(shop);
        session = (list || []).find((s) => !s.isOnline) || null;
      } catch {
        // ignore and fall through
      }
    }
    if (session?.accessToken) {
      return { shop, accessToken: session.accessToken, raw: session };
    }
  }

  // 2) Prisma Session table fallback (your schema defines model Session)
  const prismaSession = await prisma.session.findFirst({
    where: { shop, isOnline: false },
    orderBy: [{ expires: "desc" }],
  });

  if (prismaSession?.accessToken) {
    return { shop, accessToken: prismaSession.accessToken, raw: prismaSession };
  }

  throw new Error(
    `No offline session found for ${shop}. Install/authorize the app for this shop first.`
  );
}

/** Return Admin clients when available via app API (optional). */
export async function getAdminClients(shopOrRequest) {
  const session = await getOfflineSession(shopOrRequest);

  // If Shopify clients exist, construct them from the session we found.
  if (app?.api?.clients?.Graphql && app?.api?.clients?.Rest) {
    const baseSession = session.raw ?? { shop: session.shop, accessToken: session.accessToken };
    const adminGraphql = new app.api.clients.Graphql({ session: baseSession });
    const adminRest = new app.api.clients.Rest({ session: baseSession });
    return { session, adminGraphql, adminRest };
  }

  // Otherwise return a minimal object; runAdminQuery will use fetch fallback.
  return { session, adminGraphql: null, adminRest: null };
}

/**
 * Run an Admin GraphQL operation.
 * Accepts shop string OR Request; returns { data, errors }.
 */
export async function runAdminQuery(shopOrRequest, query, variables = {}) {
  const { session, adminGraphql } = await getAdminClients(shopOrRequest);

  // Prefer Shopify GraphQL client if present
  if (adminGraphql) {
    if (typeof adminGraphql.request === "function") {
      const resp = await adminGraphql.request(query, { variables });
      return {
        data: resp?.data ?? resp?.body?.data ?? null,
        errors: resp?.errors ?? resp?.body?.errors ?? null,
      };
    } else {
      // Older API shape
      const legacy = await adminGraphql.query({ data: { query, variables } });
      return {
        data: legacy?.data ?? legacy?.body?.data ?? null,
        errors: legacy?.errors ?? legacy?.body?.errors ?? null,
      };
    }
  }

  // Fallback: direct fetch with offline token
  const endpoint = `https://${session.shop}/admin/api/${ADMIN_API_VERSION}/graphql.json`;
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "X-Shopify-Access-Token": session.accessToken,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });

  const json = await res.json().catch(() => ({}));
  return { data: json?.data ?? null, errors: json?.errors ?? null };
}

/** ---- Legacy aliases kept for other routes ---- */
export async function adminGraphQLClientForShop(shopOrRequest) {
  const { adminGraphql } = await getAdminClients(shopOrRequest);
  if (!adminGraphql) {
    throw new Error(
      "GraphQL client not available in this environment; use runAdminQuery(shopOrRequest, query, variables) instead."
    );
  }
  return adminGraphql;
}

export async function adminRestClientForShop(shopOrRequest) {
  const { adminRest } = await getAdminClients(shopOrRequest);
  if (!adminRest) {
    throw new Error(
      "REST client not available in this environment; use fetch with X-Shopify-Access-Token instead."
    );
  }
  return adminRest;
}
