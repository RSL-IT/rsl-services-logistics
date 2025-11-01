// app/shopify-admin.server.js
import { prisma } from "./db.server.js";

const API_VERSION = process.env.SHOPIFY_API_VERSION || "2025-01";

/** Keep domains like "rslspeakers.myshopify.com" (no scheme, no trailing slash) */
function normalizeShopDomain(shop) {
  return String(shop || "")
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/+$/, "");
}

/** Get the offline session (preferred) or any usable session for this shop */
export async function getOfflineSession(shop) {
  const domain = normalizeShopDomain(shop);
  const offlineId = `offline_${domain}`;

  // Exact offline id first
  let sess = await prisma.session.findUnique({ where: { id: offlineId } });

  // Fallbacks: any non-online session for the shop, then any session
  if (!sess) {
    sess = await prisma.session.findFirst({
      where: { shop: domain, isOnline: false },
      orderBy: { expires: "desc" },
    });
  }
  if (!sess) {
    sess = await prisma.session.findFirst({
      where: { shop: domain },
      orderBy: { expires: "desc" },
    });
  }

  return sess || null;
}

/**
 * Direct Admin GraphQL call using stored offline token.
 * Returns { status, body } (body is parsed JSON).
 */
export async function runAdminQuery(shop, query, variables = {}) {
  const domain = normalizeShopDomain(shop);
  const session = await getOfflineSession(domain);

  if (!session || !session.accessToken) {
    throw new Error(
      `No offline Admin session found for ${domain}. Re-install or re-authorize the app.`
    );
  }

  const endpoint = `https://${domain}/admin/api/${API_VERSION}/graphql.json`;

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "X-Shopify-Access-Token": session.accessToken,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });

  const body = await res.json().catch(() => ({}));

  if (!res.ok) {
    const msg =
      (body && body.errors && JSON.stringify(body.errors)) ||
      `${res.status} ${res.statusText}`;
    throw new Error(`Admin GraphQL HTTP error: ${msg}`);
  }
  if (body.errors) {
    throw new Error(`Admin GraphQL errors: ${JSON.stringify(body.errors)}`);
  }

  // Mutations often return userErrors instead of top-level errors
  const userErrors =
    body?.data &&
    Object.values(body.data)
      .filter(Boolean)
      .flatMap((node) => node.userErrors || node.userError || []);
  if (userErrors && userErrors.length) {
    throw new Error(
      `Admin GraphQL userErrors: ${JSON.stringify(userErrors)}`
    );
  }

  return { status: res.status, body };
}

/**
 * Compatibility shim for existing code:
 * Some files import `adminGraphQLClientForShop()` and call:
 *   const admin = await adminGraphQLClientForShop(shop);
 *   await admin.query({ data: { query, variables }});
 *
 * We emulate that minimal interface by delegating to runAdminQuery().
 */

export async function adminGraphQLClientForShop(shop) {
  const domain = normalizeShopDomain(shop);
  const session = await getOfflineSession(domain);
  if (!session || !session.accessToken) {
    throw new Error(
      `No offline Admin session found for ${domain}. Re-install or re-authorize the app.`
    );
  }

  const endpoint = `https://${domain}/admin/api/${API_VERSION}/graphql.json`;

  async function doGraphQL({ data }) {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "X-Shopify-Access-Token": session.accessToken,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        query: data?.query,
        variables: data?.variables || {},
      }),
    });

    const body = await res.json().catch(() => ({}));

    if (!res.ok) {
      const msg =
        (body && body.errors && JSON.stringify(body.errors)) ||
        `${res.status} ${res.statusText}`;
      throw new Error(`Admin GraphQL HTTP error: ${msg}`);
    }
    if (body.errors) {
      throw new Error(`Admin GraphQL errors: ${JSON.stringify(body.errors)}`);
    }
    return { status: res.status, body };
  }

  // Shopify’s GraphQL client exposes .query() (and often .mutate() calls the same path).
  return {
    query: doGraphQL,
    mutate: doGraphQL,
  };
}

