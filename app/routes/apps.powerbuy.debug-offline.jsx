// app/routes/apps.powerbuy.debug-offline.jsx
import { json } from "@remix-run/node";
import { runAdminQuery } from "~/shopify-admin.server";

export const loader = async ({ request }) => {
  const url = new URL(request.url);
  const shop =
    (url.searchParams.get("shop") ||
      request.headers.get("x-shopify-shop-domain") ||
      process.env.SHOPIFY_SHOP_DOMAIN ||
      "rsldev.myshopify.com"
    ).trim().toLowerCase();

  try {
    const data = await runAdminQuery(
      shop,
      `#graphql
       query { shop { name myshopifyDomain ianaTimezone } }`
    );
    return json({ ok: true, shop: data.shop });
  } catch (e) {
    return json(
      {
        ok: false,
        error: String(e?.message || e),
        hint: `${url.origin}/auth?shop=${encodeURIComponent(shop)}`
      },
      { status: 401 }
    );
  }
};
