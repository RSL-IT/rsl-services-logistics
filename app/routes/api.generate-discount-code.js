// app/routes/api/generate-discount-code.js
import { json } from "@remix-run/node";
import { prisma } from "../db.server.js"; // ← fixed path
import crypto from "node:crypto";

/* ================================
   Small REST helper using admin token
   ================================ */
function getAdminToken() {
  const t = process.env.ADMIN_API_TOKEN || process.env.SHOPIFY_ADMIN_API_TOKEN;
  if (!t) throw new Error("Missing ADMIN_API_TOKEN env");
  return t;
}

const API_VERSION = "2024-10"; // keep in sync with your app
function shopRest(shop, path, init = {}) {
  const token = getAdminToken();
  const url = `https://${shop}/admin/api/${API_VERSION}/${path}`;
  const headers = {
    "X-Shopify-Access-Token": token,
    "Content-Type": "application/json",
    Accept: "application/json",
    ...(init.headers || {}),
  };
  return fetch(url, { ...init, headers });
}

/* ================================
   Utilities
   ================================ */
function normalizeNumericId(maybeGidOrNum) {
  if (!maybeGidOrNum) return null;
  const s = String(maybeGidOrNum).trim();
  const m = s.match(/(\d+)/);
  return m ? Number(m[1]) : null;
}

function parseCsvNumericIds(csv) {
  if (!csv) return [];
  return String(csv)
    .split(",")
    .map((x) => normalizeNumericId(x))
    .filter((n) => Number.isFinite(n));
}

function makeCode({ prefix = "", length = 10, type = "mixed" }) {
  const alph = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // no I/O
  const nums = "23456789"; // no 0/1
  let alphabet;
  switch ((type || "mixed").toLowerCase()) {
    case "alpha":
      alphabet = alph;
      break;
    case "numeric":
      alphabet = nums;
      break;
    default:
      alphabet = alph + nums;
  }
  let out = "";
  for (let i = 0; i < length; i++) {
    out += alphabet[crypto.randomInt(0, alphabet.length)];
  }
  return (prefix || "") + out;
}

function resolveShop(request) {
  const url = new URL(request.url);
  const qp =
    url.searchParams.get("shop") ||
    url.searchParams.get("shopDomain") ||
    request.headers.get("x-shopify-shop-domain") ||
    request.headers.get("x-shop-domain") ||
    request.headers.get("x-shopify-shop") ||
    process.env.SHOP_CUSTOM_DOMAIN ||
    process.env.SHOPIFY_STORE_DOMAIN ||
    "";
  return qp.trim().replace(/^https?:\/\//, "");
}

function iso(dt) {
  return new Date(dt).toISOString();
}

/* ================================
   Core: find or create PriceRule
   ================================ */
async function findExistingPriceRuleIdForConfig({ shop, powerbuyId }) {
  // Look up any previously created code for this powerbuy.
  const prior = await prisma.tbl_powerbuy_codes.findFirst({
    where: { powerbuy_id: powerbuyId },
    orderBy: { id: "desc" },
  });
  if (!prior) return null;

  // Use Shopify's discount code lookup endpoint by code text.
  // GET /admin/api/{version}/discount_codes/lookup.json?code=ABC
  const res = await shopRest(
    shop,
    `discount_codes/lookup.json?code=${encodeURIComponent(prior.discount_code)}`,
    { method: "GET" }
  );

  if (res.status === 404) return null;
  if (!res.ok) {
    const t = await res.text();
    throw new Error(
      `lookup_failed ${res.status} ${res.statusText} :: ${t.slice(0, 500)}`
    );
  }
  const data = await res.json();
  const prId = data?.discount_code?.price_rule_id
    ? Number(data.discount_code.price_rule_id)
    : null;
  return Number.isFinite(prId) ? prId : null;
}

async function createPriceRule({
                                 shop,
                                 title,
                                 startsAtISO,
                                 endsAtISO,
                                 discountType, // "percentage" | "fixed"
                                 discountValue, // number
                                 numberOfUses, // (optional) total uses across all codes
                                 entitledProductIds, // number[]
                                 entitledVariantIds, // number[]
                               }) {
  const value_type = discountType === "percentage" ? "percentage" : "fixed_amount";
  const value =
    discountType === "percentage"
      ? -Number(discountValue || 0)
      : -Number(discountValue || 0);

  const body = {
    price_rule: {
      title,
      starts_at: startsAtISO,
      ends_at: endsAtISO,
      target_type: "line_item",
      target_selection: "entitled",
      allocation_method: "each",
      value_type,
      value,
      customer_selection: "all", // ✅ required by Shopify
      usage_limit:
        typeof numberOfUses === "number" && numberOfUses > 0
          ? numberOfUses
          : undefined,
      entitled_product_ids: entitledProductIds?.length ? entitledProductIds : undefined,
      entitled_variant_ids: entitledVariantIds?.length ? entitledVariantIds : undefined,
    },
  };

  const res = await shopRest(shop, "price_rules.json", {
    method: "POST",
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    let detail;
    try {
      detail = JSON.parse(text);
    } catch {
      detail = text;
    }
    const err = new Error("price_rule_create_failed");
    err.detail = detail;
    throw err;
  }
  const data = JSON.parse(text);
  const id = data?.price_rule?.id ? Number(data.price_rule.id) : null;
  if (!id) {
    const err = new Error("price_rule_create_no_id");
    err.detail = data;
    throw err;
  }
  return id;
}

async function createDiscountCode({ shop, priceRuleId, code }) {
  const res = await shopRest(
    shop,
    `price_rules/${priceRuleId}/discount_codes.json`,
    {
      method: "POST",
      body: JSON.stringify({ discount_code: { code } }),
    }
  );
  const text = await res.text();
  if (!res.ok) {
    let detail;
    try {
      detail = JSON.parse(text);
    } catch {
      detail = text;
    }
    const err = new Error("discount_code_create_failed");
    err.detail = detail;
    err.status = res.status;
    throw err;
  }
  const data = JSON.parse(text);
  const dc = data?.discount_code;
  return {
    id: dc?.id ? Number(dc.id) : null,
    code: dc?.code || code,
    usage_count: dc?.usage_count || 0,
    created_at: dc?.created_at || null,
    updated_at: dc?.updated_at || null,
  };
}

/* ================================
   Remix route
   ================================ */
export async function action({ request }) {
  if (request.method === "OPTIONS") return new Response(null, { status: 204 });
  if (request.method !== "POST")
    return json({ error: "method_not_allowed" }, { status: 405 });

  // Resolve shop
  const shop = resolveShop(request);
  if (!shop) return json({ error: "shop_missing" }, { status: 400 });

  // Parse body (JSON or FormData)
  const ct = request.headers.get("content-type") || "";
  let powerbuyId;
  if (ct.includes("application/json")) {
    const b = await request.json();
    powerbuyId = Number(b.powerbuyId ?? b.powerbuy_id);
  } else if (ct.includes("application/x-www-form-urlencoded") || ct.includes("multipart/form-data")) {
    const fd = await request.formData();
    powerbuyId = Number(fd.get("powerbuyId") ?? fd.get("powerbuy_id"));
  } else {
    // Allow empty body if powerbuyId is in query
    const url = new URL(request.url);
    powerbuyId = Number(url.searchParams.get("powerbuyId") || url.searchParams.get("powerbuy_id"));
  }

  if (!Number.isInteger(powerbuyId) || powerbuyId <= 0) {
    return json({ error: "powerbuy_id_required" }, { status: 400 });
  }

  // Load config
  const config = await prisma.tbl_powerbuy_config.findUnique({
    where: { id: powerbuyId },
  });
  if (!config) return json({ error: "powerbuy_config_not_found" }, { status: 404 });

  // Time window
  const now = new Date();
  const startsAtISO = iso(config.start_time || now);
  const endsAtISO = iso(
    config.end_time || new Date(now.getTime() + 1000 * 60 * 60 * 24 * 7) // default +7d
  );

  // Entitlements (prefer variants; else product)
  const entitledVariantIds = parseCsvNumericIds(config.powerbuy_variant_ids);
  const entitledProductIds = entitledVariantIds.length
    ? []
    : [normalizeNumericId(config.powerbuy_product_id)].filter(Boolean);

  if (!entitledVariantIds.length && !entitledProductIds.length) {
    return json({ error: "no_entitled_product_or_variant_ids" }, { status: 422 });
  }

  // Discount amount
  const discountType =
    (config.discount_type === "percentage" || config.discount_type === "fixed")
      ? config.discount_type
      : "percentage";
  const discountValue = Number(config.discount_value || 0);
  if (!(discountValue > 0)) {
    return json({ error: "invalid_discount_value" }, { status: 422 });
  }

  // Code generation params
  const prefix = (config.discount_prefix || "").toUpperCase();
  const codeLength =
    Number.isInteger(config.code_length) && config.code_length > 0
      ? config.code_length
      : 12;
  const codeType = (config.code_type || "mixed").toLowerCase();
  const numberOfUses =
    Number.isInteger(config.number_of_uses) && config.number_of_uses > 0
      ? config.number_of_uses
      : undefined;

  // Reuse an existing price rule if we already created one for this powerbuy
  let priceRuleId = await findExistingPriceRuleIdForConfig({
    shop,
    powerbuyId: config.id,
  });

  // Otherwise create a new rule now
  if (!priceRuleId) {
    try {
      priceRuleId = await createPriceRule({
        shop,
        title: `Powerbuy #${config.id}`,
        startsAtISO,
        endsAtISO,
        discountType,
        discountValue,
        numberOfUses, // shared cap across all codes for this powerbuy
        entitledProductIds,
        entitledVariantIds,
      });
    } catch (e) {
      return json(
        { error: "price_rule_create_failed", detail: e?.detail || e?.message || String(e) },
        { status: 422 }
      );
    }
  }

  // Create a discount code (retry on uniqueness collisions)
  let created;
  let lastErr;
  for (let attempt = 0; attempt < 6; attempt++) {
    const code = makeCode({ prefix, length: codeLength, type: codeType });
    try {
      created = await createDiscountCode({ shop, priceRuleId, code });
      break;
    } catch (e) {
      lastErr = e;
      const asText = JSON.stringify(e?.detail || {});
      if (e?.status === 422 && /unique/i.test(asText)) {
        continue; // try a new random code
      }
      break; // other error
    }
  }
  if (!created?.id) {
    return json(
      { error: "generate_failed", detail: lastErr?.detail || lastErr?.message || "unknown" },
      { status: 500 }
    );
  }

  // Persist to tbl_powerbuy_codes
  const longDesc = config.long_description || "";
  const shortDesc = config.short_description || config.title || "Powerbuy Discount";

  await prisma.tbl_powerbuy_codes.create({
    data: {
      powerbuy_id: config.id,
      discount_code: created.code,
      discount_code_gid: String(created.id), // storing numeric id text
      short_description: shortDesc,
      long_description: longDesc,
      confirmation_email_content: config.confirmation_email_content || null,
      acceptance_email_content: config.acceptance_email_content || null,
      rsl_contact_email_address: config.rsl_contact_email_address || null,
      start_time: new Date(startsAtISO),
      end_time: new Date(endsAtISO),
      number_of_uses: numberOfUses || null,
      powerbuy_product_id: entitledProductIds[0]
        ? `gid://shopify/Product/${entitledProductIds[0]}`
        : entitledVariantIds[0]
          ? `gid://shopify/ProductVariant/${entitledVariantIds[0]}`
          : null,
    },
  });

  return json(
    {
      status: "created",
      shop,
      powerbuyId: config.id,
      priceRuleId,
      code: created.code,
      discountCodeId: created.id,
      usageCount: created.usage_count,
      startsAt: startsAtISO,
      endsAt: endsAtISO,
      entitlements: {
        productIds: entitledProductIds,
        variantIds: entitledVariantIds,
      },
      rule: {
        valueType: discountType === "percentage" ? "percentage" : "fixed_amount",
        value: discountType === "percentage" ? -discountValue : -discountValue,
        usageLimit: numberOfUses || null,
      },
    },
    { status: 201 }
  );
}

export function loader() {
  return new Response("Method Not Allowed", { status: 405 });
}
