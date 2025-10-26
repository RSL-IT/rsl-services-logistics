// app/routes/auth.login/route.jsx
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";
import { beginAuth, addDocumentResponseHeaders } from "~/shopify.server";

// Apply Shopify’s CSP headers on this route too
export const headers = addDocumentResponseHeaders;

// Keep your Polaris stylesheet link (harmless even though this route just redirects)
export const links = () => [{ rel: "stylesheet", href: polarisStyles }];

/**
 * Start OAuth for an embedded admin app.
 * Supports both modern (`shopify.authenticate.admin`) and older (`shopify.auth.admin`) shapes.
 */
export async function loader(args) {
  return beginAuth(args);
}
