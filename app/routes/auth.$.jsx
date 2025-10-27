// app/routes/auth.$.jsx
import { useRouteError } from "@remix-run/react";
import { boundary } from "@shopify/shopify-app-remix/server";
import { authenticate } from "~/shopify.server";

// This single route handles both starting OAuth and the callback.
export async function loader({ request }) {
  await authenticate.admin(request);
  return null;
}

// Recommended: Shopify’s boundary helpers for headers/redirects
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}
export const headers = (args) => boundary.headers(args);
