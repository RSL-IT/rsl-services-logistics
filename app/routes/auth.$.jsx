// app/routes/auth.$.jsx
import { useRouteError } from "@remix-run/react";
import { boundary } from "@shopify/shopify-app-remix/server";
import { authenticate } from "~/shopify.server";

// This handles BOTH the OAuth begin (when you hit /auth?shop=...)
// and the OAuth callback (when Shopify redirects back).
export async function loader({ request }) {
  return authenticate.admin(request);
}

// Optional: keep an action that does the same thing for POST callbacks.
export const action = loader;

// Recommended error boundary for embedded apps
export const headers = (args) => boundary.headers(args);
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}
