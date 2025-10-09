// app/shopify-admin.server.js

// Use the configured app instance your project already exports by default
import shopify from "./shopify.server";

/**
 * Get an Admin GraphQL client for a shop.
 * - Finds an offline session (preferred), or falls back to the first session found.
 * - Works across minor SDK differences by checking both client locations.
 */
export async function adminGraphQLClientForShop(shop) {
  // Pull all sessions for this shop from your Prisma-backed session storage
  const sessions = await shopify.sessionStorage.findSessionsByShop(shop);

  const offline =
    (Array.isArray(sessions) && sessions.find(s => s.isOnline === false)) ||
    (Array.isArray(sessions) && sessions[0]);

  if (!offline) {
    throw new Error(`No admin session found for ${shop}. Reinstall the app to create an offline session.`);
  }

  // Handle both shapes: shopify.clients.Graphql vs shopify.api.clients.Graphql
  const Graphql = shopify.clients?.Graphql ?? shopify.api?.clients?.Graphql;
  if (!Graphql) {
    throw new Error("Shopify GraphQL client class not found on the app instance.");
  }

  return new Graphql({ session: offline });
}

/**
 * Convenience helper to run a query in one call.
 * Usage:
 *   const data = await runAdminQuery(shop, MY_QUERY, { id: "gid://..." });
 *   const body = data.body; // same shape as @shopify/shopify-api GraphQL response
 */
export async function runAdminQuery(shop, query, variables = {}) {
  const client = await adminGraphQLClientForShop(shop);
  return client.query({ data: { query, variables } });
}
