// app/routes/auth.$.jsx
import { shopify } from "../shopify.server.js";

// Handles GET/POST callback from Shopify and writes the offline session
export const loader = (args) => shopify.auth.callback(args);
export const action = loader;

