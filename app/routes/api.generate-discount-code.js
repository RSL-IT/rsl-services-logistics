// app/routes/api.generate-discount-code.js
import { json } from "@remix-run/node";
import { prisma } from "~/db.server";

// Use your project-wide version or default:
const API_VERSION = process.env.SHOPIFY_API_VERSION || "2025-01";

/**
 * Look up the DiscountCodeNode GID for a given code.
 * Uses the same offline Admin token you already use to create the code.
 */
async function fetchDiscountCodeGID({ shop, accessToken, code }) {
  const res = await fetch(`https://${shop}/admin/api/${API_VERSION}/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": accessToken,
    },
    body: JSON.stringify({
      query: `
        query ($code: String!) {
          codeDiscountNodeByCode(code: $code) { id }
        }
      `,
      variables: { code },
    }),
  });

  if (!res.ok) {
    throw new Error(`GraphQL lookup failed (${res.status})`);
  }
  const body = await res.json();
  return body?.data?.codeDiscountNodeByCode?.id || null;
}

/**
 * Helper to POST to a REST Admin endpoint with the offline token you already have.
 */
async function shopifyRest({ shop, accessToken, path, method = "GET", data }) {
  const url = `https://${shop}/admin/api/${API_VERSION}${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": accessToken,
    },
    body: data ? JSON.stringify(data) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Admin REST error ${res.status}: ${text}`);
  }
  return res.json();
}

/**
 * IMPORTANT: This route expects you already have an offline Admin session for the shop.
 * Keep your existing logic that retrieves the offline access token.
 * Here we accept it from the caller or derive it from session storage if you expose it.
 */
async function getOfflineAccessToken(shop) {
  // If you already pass the token from your confirm page, prefer that.
  // Otherwise, try session storage (if your shopify.server exports it).
  // Fallback to an env token if you’ve set SHOPIFY_ADMIN_TOKEN for dev.
  try {
    const mod = await import("~/shopify.server");
    if (mod?.shopify?.sessionStorage?.findSessionsByShop) {
      const sessions = await mod.shopify.sessionStorage.findSessionsByShop(shop);
      const offline = sessions?.find((s) => !s.isOnline) || sessions?.[0];
      if (offline?.accessToken) return offline.accessToken;
    }
  } catch {
    // ignore — not exported in your setup
  }
  if (process.env.SHOPIFY_ADMIN_TOKEN) return process.env.SHOPIFY_ADMIN_TOKEN;
  throw new Response(`No offline Admin session found for ${shop}. Re-install or re-authorize the app.`, { status: 401 });
}

export async function loader() {
  return json({ ok: false, error: "Use POST" }, { status: 405 });
}

export async function action({ request }) {
  try {
    if (request.method !== "POST") {
      return json({ ok: false, error: "Use POST" }, { status: 405 });
    }

    // Accept either JSON body or form-encoded
    let payload;
    const ctype = request.headers.get("content-type") || "";
    if (ctype.includes("application/json")) {
      payload = await request.json();
    } else {
      const fd = await request.formData();
      payload = Object.fromEntries(fd);
    }

    const shop = (payload.shop || new URL(request.url).searchParams.get("shop") || "").trim();
    const powerbuyId = Number(payload.powerbuyId || payload.powerbuy_id);
    const codePrefix = (payload.codePrefix || payload.discountPrefix || "").trim();
    const email = (payload.email || "").trim();

    if (!shop) return json({ ok: false, error: "Missing shop" }, { status: 400 });
    if (!powerbuyId) return json({ ok: false, error: "Missing powerbuyId" }, { status: 400 });
    if (!codePrefix) return json({ ok: false, error: "Missing codePrefix" }, { status: 400 });
    if (!email) return json({ ok: false, error: "Missing email" }, { status: 400 });

    // 1) Find the active config you already validated earlier (keep your existing logic if different)
    const config = await prisma.tbl_powerbuy_config.findUnique({ where: { id: powerbuyId } });
    if (!config) return json({ ok: false, error: "No matching PowerBuy config" }, { status: 404 });

    // 2) Get offline Admin token
    const accessToken = await getOfflineAccessToken(shop);

    // 3) Ensure a price rule exists (reuse yours if you already create one elsewhere)
    // If your code already has a price rule id, use it instead of (re)creating.
    let priceRuleId = config.price_rule_id ? BigInt(config.price_rule_id) : null;
    if (!priceRuleId) {
      const prRes = await shopifyRest({
        shop,
        accessToken,
        path: `/price_rules.json`,
        method: "POST",
        data: {
          price_rule: {
            title: `PowerBuy ${new Date().getFullYear()} - ${email}`,
            target_type: "line_item",
            target_selection: "entitled",
            allocation_method: "across",
            value_type: "percentage",
            value: `-${Number(config.discount_value || 10)}`,
            customer_selection: "all",
            usage_limit: Number(config.number_of_uses || 1),
            once_per_customer: false,
            starts_at: new Date().toISOString(),
            // add any entitlements you use in your app (products/variants/etc.)
          },
        },
      });
      priceRuleId = BigInt(prRes?.price_rule?.id);
      // optionally persist this back to config if your design wants to reuse it
    }

    // 4) Create a unique discount code under that price rule
    const code = `${codePrefix}${Date.now()}${Math.floor(Math.random() * 1e6)}`;
    const dcRes = await shopifyRest({
      shop,
      accessToken,
      path: `/price_rules/${priceRuleId.toString()}/discount_codes.json`,
      method: "POST",
      data: { discount_code: { code } },
    });

    const dc = dcRes?.discount_code;
    if (!dc?.id || !dc?.code) {
      return json({ ok: false, error: "Failed to create discount code" }, { status: 500 });
    }

    // 5) 🔎 Get the canonical DiscountCodeNode GID for this code
    let discountCodeGID = await fetchDiscountCodeGID({ shop, accessToken, code: dc.code });

    // Fallback (keeps Prisma happy even if lookup fails)
    if (!discountCodeGID) discountCodeGID = `gid://shopify/DiscountCode/${dc.id}`;

    // 6) Save the code record (➡ includes discount_code_gid now)
    const row = await prisma.tbl_powerbuy_codes.create({
      data: {
        email,
        shop,
        price_rule_id: typeof priceRuleId === "bigint" ? priceRuleId : BigInt(priceRuleId),
        discount_id: BigInt(dc.id),
        discount_code: dc.code,
        discount_code_gid: discountCodeGID,
        powerbuy_id: powerbuyId,
        created_at: new Date(),
      },
    });

    return json({
      ok: true,
      price_rule_id: row.price_rule_id.toString(),
      discount_id: row.discount_id.toString(),
      discount_code: row.discount_code,
      discount_code_gid: row.discount_code_gid,
    });
  } catch (err) {
    const message = err instanceof Response ? await err.text() : (err?.message || String(err));
    return json({ ok: false, error: message }, { status: 500 });
  }
}
