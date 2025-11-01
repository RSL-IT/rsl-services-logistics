// app/routes/debug.oauth.jsx
import { json } from "@remix-run/node";

export const loader = ({ request }) => {
  const base = (process.env.SHOPIFY_APP_URL || "").replace(/\/$/, "");
  const callback = `${base}/auth/callback`;
  const shop = new URL(request.url).searchParams.get("shop") || "rsldev.myshopify.com";
  const installUrl = `https://${shop}/admin/oauth/authorize?client_id=${process.env.SHOPIFY_API_KEY}&scope=${encodeURIComponent(process.env.SHOPIFY_SCOPES || "")}&redirect_uri=${encodeURIComponent(callback)}`;
  return json({
    ok: true,
    base,
    callback,
    installUrl,
  });
};
