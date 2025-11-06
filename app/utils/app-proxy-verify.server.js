// app/utils/app-proxy-verify.server.js
import { authenticate } from "~/shopify.server";

/**
 * If Shopify App Proxy signature is present (?signature=...), verify it.
 * If not present and REQUIRE_PROXY_SIGNATURE==="true", reject.
 * Returns true if verification was performed, false otherwise.
 */
export async function verifyProxyIfPresent(request) {
  const url = new URL(request.url);

  const hasSignature = url.searchParams.has("signature");
  if (hasSignature) {
    // Throws if invalid; returns context if valid (unused here)
    await authenticate.public.appProxy(request);
    return true;
  }

  // Optional hard-enforcement toggle (prod)
  if ((process.env.REQUIRE_PROXY_SIGNATURE || "").toLowerCase() === "true") {
    throw new Response("Proxy signature required", { status: 401 });
  }

  return false;
}
