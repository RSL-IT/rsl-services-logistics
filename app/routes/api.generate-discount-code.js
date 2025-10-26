// app/routes/api.generate-discount-code.js
import { json } from "@remix-run/node";
import { prisma } from "../db.server.js";
import crypto from "node:crypto";

/* --------------------------------- Helpers -------------------------------- */

function resolveShop(request) {
  const url = new URL(request.url);

  const fromParam =
    url.searchParams.get("shop") ||
    url.searchParams.get("shopDomain");

  const fromHeader =
    request.headers.get("x-shopify-shop-domain") ||
    request.headers.get("x-shop-domain") ||
    request.headers.get("x-shopify-shop");

  const fromEnv =
    process.env.SHOP_CUSTOM_DOMAIN ||
    process.env.SHOPIFY_STORE_DOMAIN ||
    "";

  const shop = (fromParam || fromHeader || fromEnv || "").trim();
  return shop.replace(/^https?:\/\//, ""); // keep as "rsldev.myshopify.com"
}

/** Admin REST via private/admin token (no OAuth session needed) */
function adminFetch(shop, path, { method = "GET", body } = {}) {
  const token = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN || "";
  if (!token) throw new Error("Missing SHOPIFY_ADMIN_ACCESS_TOKEN");
  const url = `https://${shop}/admin/api/2024-10${path}`;
  return fetch(url, {
    method,
    headers: {
      "X-Shopify-Access-Token": token,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

const ALPHA = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // omit I/O
const NUM   = "23456789";                 // omit 0/1

function alphabetFor(codeType) {
  switch (String(codeType || "mixed").toLowerCase()) {
    case "alpha":   return ALPHA;
    case "numeric": return NUM;
    case "mixed":
    default:        return ALPHA + NUM;
  }
}

/** Build the code: prefix + random(length) with chosen alphabet */
function makeCode({ prefix = "", length = 10, alphabet }) {
  const pool = (alphabet && alphabet.length ? alphabet : ALPHA + NUM);
  let out = "";
  for (let i = 0; i < Number(length || 0); i++) {
    out += pool[crypto.randomInt(0, pool.length)];
  }
  return String(prefix || "") + out;
}

/** Extract numeric id from a GID like gid://shopify/Product/1234567890 */
function numericIdFromGid(gid) {
  if (!gid) return null;
  const parts = String(gid).split("/");
  const last = parts[parts.length - 1];
  return /^\d+$/.test(last) ? Number(last) : null;
}

/** Create a base Price Rule when none exists */
async function ensurePriceRule({ shop, productGid, title, valueType, value, startsAt }) {
  const productId = numericIdFromGid(productGid);
  if (!productId) throw new Error("invalid_product_gid");

  const body = {
    price_rule: {
      title: title || "Powerbuy Base Rule",
      target_type: "line_item",
      target_selection: "entitled",
      allocation_method: "across",
      value_type: valueType,            // "percentage" | "fixed_amount"
      value,                            // negative string, e.g. "-10.0"
      customer_selection: "all",
      once_per_customer: false,
      entitled_product_ids: [productId],
      starts_at: (startsAt || new Date()).toISOString(),
    },
  };

  const res = await adminFetch(shop, "/price_rules.json", { method: "POST", body });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`create_price_rule_failed: ${res.status} ${t}`);
  }
  const data = await res.json();
  return data?.price_rule?.id || null;
}

/** Update rule-level fields (ends_at, usage_limit) */
async function updatePriceRule({ shop, priceRuleId, endsAtISO, usageLimit }) {
  const prBody = {
    price_rule: {
      id: Number(priceRuleId),
      ...(endsAtISO ? { ends_at: endsAtISO } : {}),
      ...(Number.isInteger(usageLimit) ? { usage_limit: usageLimit } : {}),
    },
  };
  const res = await adminFetch(shop, `/price_rules/${priceRuleId}.json`, {
    method: "PUT",
    body: prBody,
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`update_price_rule_failed: ${res.status} ${t}`);
  }
}

/** Create a discount code under an existing rule */
async function createDiscountCode({ shop, priceRuleId, code }) {
  const res = await adminFetch(
    shop,
    `/price_rules/${priceRuleId}/discount_codes.json`,
    { method: "POST", body: { discount_code: { code } } }
  );
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`create_discount_code_failed: ${res.status} ${t}`);
  }
  const data = await res.json();
  return { id: data?.discount_code?.id, code: data?.discount_code?.code };
}

/* ---------------------------------- Route --------------------------------- */

/**
 * POST /api/generate-discount-code
 *
 * Inputs:
 *   - powerbuyId (preferred): id of tbl_powerbuy_config row
 *   - productGid/product_id: gid://shopify/Product/###
 *
 * Behavior driven by config row (takes precedence over body/env):
 *   - discount_prefix -> prefix for code
 *   - code_length     -> random part length (prefix not counted)
 *   - code_type       -> "alpha" | "numeric" | "mixed"
 *   - number_of_uses  -> total rule usage_limit for this Powerbuy
 *
 * Fallback envs:
 *   - POWERBUY_CODE_PREFIX
 *   - POWERBUY_CODE_LENGTH (default 8)
 *   - POWERBUY_DEFAULT_CODE_TYPE ("mixed")
 *   - POWERBUY_DEFAULT_VALUE_TYPE ("percentage" | "fixed_amount"; default "percentage")
 *   - POWERBUY_DEFAULT_VALUE (negative string, e.g. "-10.0"; default "-10.0")
 *   - POWERBUY_DEFAULT_PRICE_RULE_ID (optional existing rule)
 *   - POWERBUY_DEFAULT_EXPIRES_AT (ISO)
 *   - POWERBUY_DEFAULT_USAGE_LIMIT (number; default 500)
 *   - SHOPIFY_ADMIN_ACCESS_TOKEN (required)
 */
export async function action({ request }) {
  if (request.method === "OPTIONS") return new Response(null, { status: 204 });
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, { status: 405 });

  const shop = resolveShop(request);
  if (!shop) return json({ error: "shop_missing" }, { status: 400 });

  // Parse body (JSON or form)
  const ct = request.headers.get("content-type") || "";
  let body = {};
  if (ct.includes("application/json")) {
    body = await request.json();
  } else {
    const fd = await request.formData();
    for (const [k, v] of fd.entries()) body[k] = v;
  }

  // Inputs
  const powerbuyId = Number(body.powerbuyId ?? body.configId ?? body.id);

  // Load config if provided
  let config = null;
  if (Number.isInteger(powerbuyId) && powerbuyId > 0) {
    config = await prisma.tbl_powerbuy_config.findUnique({ where: { id: powerbuyId } });
    if (!config) return json({ error: "config_not_found" }, { status: 404 });
  }

  // Product GID: config first, then body
  const bodyProductGid =
    (body.product_gid ?? body.productGid ?? body.product_id ?? body.productId) ?? null;
  const productGid =
    (config && config.powerbuy_product_id != null ? config.powerbuy_product_id : null) ??
    bodyProductGid;
  if (!productGid) return json({ error: "product_gid_missing" }, { status: 400 });

  // Timing & limits
  const defaultEndsAtMaybe =
    (body.expiresAt ?? body.endsAt ?? process.env.POWERBUY_DEFAULT_EXPIRES_AT);
  const defaultEndsAtISO = defaultEndsAtMaybe
    ? new Date(defaultEndsAtMaybe).toISOString()
    : new Date(Date.now() + 1000 * 60 * 60 * 24 * 30).toISOString(); // +30d

  const endsAtISO = new Date(
    (config && config.end_time != null ? config.end_time : null) || defaultEndsAtISO
  ).toISOString();

  const defaultUsageLimit = Number(
    (body.usageLimit != null ? body.usageLimit : process.env.POWERBUY_DEFAULT_USAGE_LIMIT) ?? 500
  );

  // If config.number_of_uses is present and > 0, it wins.
  let usageLimit = defaultUsageLimit;
  if (config) {
    const confNU = (config.number_of_uses != null) ? Number(config.number_of_uses) : null;
    const confUL = (config.usage_limit != null) ? Number(config.usage_limit) : null;
    if (Number.isFinite(confNU) && confNU > 0) {
      usageLimit = confNU;
    } else if (Number.isFinite(confUL) && confUL > 0) {
      usageLimit = confUL;
    }
  }

  // Code prefix
  const envPrefix = process.env.POWERBUY_CODE_PREFIX ?? "";
  const bodyPrefix = (body.prefix != null) ? String(body.prefix) : null;
  const prefix =
    (config && config.discount_prefix != null ? String(config.discount_prefix) : null) ||
    (config && config.discount_code_prefix != null ? String(config.discount_code_prefix) : null) ||
    (bodyPrefix != null ? bodyPrefix : null) ||
    envPrefix ||
    "";

  // Code length (random portion only)
  const envLen = Number(process.env.POWERBUY_CODE_LENGTH ?? 8);
  const bodyLen = (body.length != null) ? Number(body.length) : null;
  let length = Number.isFinite(envLen) && envLen > 0 ? envLen : 8;
  if (Number.isFinite(bodyLen) && bodyLen > 0) length = bodyLen;
  if (config) {
    const confLenPrimary = (config.code_length != null) ? Number(config.code_length) : null;
    const confLenLegacy  = (config.discount_code_length != null) ? Number(config.discount_code_length) : null;
    if (Number.isFinite(confLenPrimary) && confLenPrimary > 0) {
      length = confLenPrimary;
    } else if (Number.isFinite(confLenLegacy) && confLenLegacy > 0) {
      length = confLenLegacy;
    }
  }

  // Code type -> alphabet
  const envCodeType = process.env.POWERBUY_DEFAULT_CODE_TYPE ?? "mixed";
  const bodyCodeType = (body.code_type ?? body.codeType) ?? null;
  const codeType =
    (config && config.code_type != null ? String(config.code_type) : null) ||
    (bodyCodeType != null ? String(bodyCodeType) : null) ||
    envCodeType;
  const alphabet = alphabetFor(codeType);

  // Price rule defaults
  const defaultValueType = String(
    (process.env.POWERBUY_DEFAULT_VALUE_TYPE ?? "percentage").toLowerCase()
  ); // "percentage" | "fixed_amount"
  const defaultValue = String(process.env.POWERBUY_DEFAULT_VALUE ?? "-10.0");

  // Determine or create the Price Rule
  let priceRuleId =
    (config && config.discount_price_rule_id != null
      ? Number(config.discount_price_rule_id)
      : null) ||
    ((process.env.POWERBUY_DEFAULT_PRICE_RULE_ID != null)
      ? Number(process.env.POWERBUY_DEFAULT_PRICE_RULE_ID)
      : null);

  try {
    if (!priceRuleId) {
      // Create a new base rule tied to the product
      priceRuleId = await ensurePriceRule({
        shop,
        productGid,
        title: (config && config.title) ? config.title : "Powerbuy",
        valueType: defaultValueType,
        value: defaultValue, // negative string per Shopify API
        startsAt: (config && config.start_time) ? config.start_time : new Date(),
      });

      // Best-effort: persist to config for reuse
      if (config && config.id) {
        try {
          await prisma.tbl_powerbuy_config.update({
            where: { id: config.id },
            data: { discount_price_rule_id: priceRuleId },
          });
        } catch {
          // ignore if column missing / update fails
        }
      }
    }

    // Update rule settings for this campaign window
    await updatePriceRule({
      shop,
      priceRuleId,
      endsAtISO,
      usageLimit: (Number.isInteger(usageLimit) && usageLimit > 0) ? usageLimit : undefined,
    });

    // Create the code (retry a few times on collision)
    let lastErr;
    for (let attempt = 0; attempt < 6; attempt++) {
      const code = makeCode({ prefix, length, alphabet });
      try {
        const created = await createDiscountCode({ shop, priceRuleId, code });
        return json(
          {
            code: created.code,
            discountCodeId: created.id,
            priceRuleId,
            expiresAt: endsAtISO,
            usageLimit,
            codeType,
            prefix,
            length,
          },
          { status: 201 }
        );
      } catch (e) {
        const msg = String(e?.message || "");
        if (/must be unique/i.test(msg)) {
          lastErr = e; // collision -> try again
          continue;
        }
        lastErr = e;
        break;
      }
    }
    throw new Error("Failed to create discount code after retries");
  } catch (e) {
    const wantsJson =
      (request.headers.get("accept") || "").includes("application/json") ||
      ct.includes("application/json");
    const detail = String(e?.message || e);

    if (wantsJson) {
      return json({ error: "generate_failed", detail }, { status: 500 });
    }

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charSet="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Powerbuy — Error creating discount</title>
<link rel="stylesheet" href="/assets/styles-C7YjYK5e.css" />
<style>
  body { font-family: -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; padding: 2rem; }
  .card { max-width: 720px; margin: 0 auto; border: 1px solid #eee; border-radius: 12px; padding: 24px; }
  h1 { margin: 0 0 12px; font-size: 22px; }
  p { line-height: 1.45; }
  code { background: #f6f7f8; padding: 2px 6px; border-radius: 6px; }
  .muted { color: #65737e; font-size: 14px; margin-top: 16px; }
</style>
</head>
<body>
  <div class="card">
    <h1>Couldn’t create the discount</h1>
    <p>${detail.replace(/</g, "&lt;")}</p>
    <p class="muted">Check your price rule defaults & admin token in the app env.</p>
  </div>
</body>
</html>`;
    return new Response(html, { status: 502, headers: { "Content-Type": "text/html; charset=utf-8" } });
  }
}

export const loader = () => new Response("Method Not Allowed", { status: 405 });
