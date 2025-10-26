// app/routes/auth.$.jsx
import { addDocumentResponseHeaders, callbackAuth } from "~/shopify.server";

// Apply Shopify’s CSP headers on this route too
export const headers = addDocumentResponseHeaders;

// This route handles GET/POST from Shopify after OAuth begins
export const loader = (args) => callbackAuth(args);
export const action = loader;
