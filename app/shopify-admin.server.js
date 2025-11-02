// app/shopify-admin.server.js
// Helpers to use Shopify Admin API (offline) from server routes.
// Works with @shopify/shopify-app-remix "auth" export in your app.

import { auth } from "~/shopify.server";

/** Pull shop from ?shop=… or x-shopify-shop-domain */
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

/** Load an offline session for a given shop (error if missing). */
export async function getOfflineSession(shop) {
  // Correct API shape: use auth.api.session.getOfflineId(shop)
  const offlineId = auth.api.session.getOfflineId(shop);
  const session = await auth.sessionStorage.loadSession(offlineId);

  if (!session) {
    // This usually means the app hasn't been installed/authorized offline for this shop yet.
    throw new Error(
      `No offline session found for ${shop}. Install/authorize the app for this shop first.`
    );
  }
  return session;
}

/** Get ready-to-use Admin API clients (GraphQL + REST) for a shop (offline). */
export async function getAdminClients(shop) {
  const session = await getOfflineSession(shop);

  // Clients come from the same "auth.api.clients" namespace
  const adminGraphql = new auth.api.clients.Graphql({ session });
  const adminRest = new auth.api.clients.Rest({ session });

  return { session, adminGraphql, adminRest };
}

/** Convenience: run a GraphQL query with variables; throws on GraphQL errors. */
export async function runAdminQuery(shop, query, variables = {}) {
  const { adminGraphql } = await getAdminClients(shop);

  // GraphQL client in @shopify/shopify-api v11 exposes .request(query, { variables })
  let result;
  if (typeof adminGraphql.request === "function") {
    result = await adminGraphql.request(query, { variables });
  } else {
    // Older shape fallback
    result = await adminGraphql.query({ data: { query, variables } });
  }

  // Normalize error handling
  const errors = result?.errors || result?.body?.errors;
  if (errors) {
    throw new Error(
      `Admin GraphQL error: ${JSON.stringify(errors, null, 2)}`
    );
  }
  return result?.data || result?.body?.data || result;
}

/** ---- Aliases kept for older imports elsewhere in your app ---- */

/** Alias requested earlier by other routes */
export async function adminGraphQLClientForShop(shop) {
  const { adminGraphql } = await getAdminClients(shop);
  return adminGraphql;
}

/** If you need the REST client directly */
export async function adminRestClientForShop(shop) {
  const { adminRest } = await getAdminClients(shop);
  return adminRest;
}
