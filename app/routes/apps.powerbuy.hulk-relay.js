// app/routes/apps.powerbuy.hulk-relay.js
import { authenticate } from "~/shopify.server";

export async function action({ request }) {
  // Validate the App Proxy signature
  try {
    await authenticate.public.appProxy(request);
  } catch {
    return new Response("Invalid app proxy signature", { status: 401 });
  }

  // Forward Hulk's x-www-form-urlencoded body as-is
  const rawBody = await request.text();

  const base = process.env.BASE;                // e.g. https://api.yourdomain.com
  const shop = process.env.SHOP;                // e.g. rsldev.myshopify.com
  const powerbuyId = process.env.POWERBUY_ID;   // your ID

  const target = `${base}/apps/powerbuy/requests?shop=${encodeURIComponent(
    shop
  )}&powerbuyId=${encodeURIComponent(powerbuyId)}`;

  const upstream = await fetch(target, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "X-Remix-Data": "yes",
      "x-shopify-shop-domain": shop,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: rawBody,
  });

  return new Response(await upstream.text(), {
    status: upstream.status,
    headers: { "Content-Type": upstream.headers.get("Content-Type") ?? "text/plain" },
  });
}

export async function loader() {
  return new Response("Method Not Allowed", { status: 405 });
}
