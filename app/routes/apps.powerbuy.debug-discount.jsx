// app/routes/apps.powerbuy.debug-discount.js
import { json } from "@remix-run/node";

/**
 * GET /apps/powerbuy/debug-discount?shop=rsldev.myshopify.com&code=MYCODE
 * - 404 when the code doesn't exist
 * - 502 only for Shopify server/permission problems, with details
 */
export async function loader({ request }) {
  const url = new URL(request.url);
  const shop = url.searchParams.get("shop")?.trim();
  const code = url.searchParams.get("code")?.trim();

  if (!shop || !code) {
    return json({ error: "missing_params", hint: "Provide shop and code" }, { status: 400 });
  }

  const token = process.env.ADMIN_API_TOKEN;
  if (!token) {
    return json({ error: "Missing ADMIN_API_TOKEN env" }, { status: 500 });
  }

  const endpoint = `https://${shop}/admin/api/2024-07/discount_codes/lookup.json?code=${encodeURIComponent(code)}`;

  let res;
  try {
    res = await fetch(endpoint, {
      headers: {
        "X-Shopify-Access-Token": token,
        "Accept": "application/json",
      },
    });
  } catch (e) {
    return json({ error: "network_error", detail: String(e) }, { status: 502 });
  }

  const bodyText = await res.text();
  let body;
  try {
    body = bodyText ? JSON.parse(bodyText) : null;
  } catch {
    body = { raw: bodyText };
  }

  // Pass through expected "not found" cleanly
  if (res.status === 404) {
    return json({ found: false, shopify_status: 404, shop, code, data: body }, { status: 404 });
  }

  // Any other non-OK becomes a diagnostic 502 with details from Shopify
  if (!res.ok) {
    return json(
      {
        error: "shopify_error",
        shopify_status: res.status,
        shop,
        code,
        data: body,
      },
      { status: 502 }
    );
  }

  const dc = body?.discount_code;
  if (!dc) {
    return json({ error: "unexpected_shape", shop, code, data: body }, { status: 502 });
  }

  return json({
    found: true,
    shop,
    code: dc.code,
    discount_code_id: dc.id,
    price_rule_id: dc.price_rule_id,
    usage_count: dc.usage_count,
    data: body,
  });
}
