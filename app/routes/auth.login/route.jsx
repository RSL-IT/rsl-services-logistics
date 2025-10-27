// app/routes/auth.login/route.jsx
import { shopify } from "~/shopify.server";

export async function loader({ request }) {
  const url = new URL(request.url);
  const shop = url.searchParams.get("shop");
  if (!shop) return new Response("Missing ?shop", { status: 400 });

  // Do NOT pass appUrl here; the SDK can infer it
  return shopify.auth.login({
    shop,
    isOnline: false,
    request,
    callbackPath: process.env.SHOPIFY_AUTH_CALLBACK_PATH || "/auth/callback",
  });
}
