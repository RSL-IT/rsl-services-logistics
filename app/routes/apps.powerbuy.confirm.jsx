// app/routes/apps.powerbuy.confirm.jsx
import { json } from "@remix-run/node";
import { prisma } from "../db.server.js"; // relative to /app/routes

/* --- Config ---------------------------------------------------------------- */

const API_VERSION = process.env.SHOPIFY_API_VERSION || "2024-10";
const DEV_SHOP =
  process.env.SHOPIFY_STORE_DOMAIN || process.env.SHOPIFY_SHOP_DOMAIN || "";
const ADMIN_TOKEN = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN || "";
const FALLBACK_PRICE_RULE_ID =
  Number(process.env.POWERBUY_DEFAULT_PRICE_RULE_ID || 0);

/* --- Helpers ---------------------------------------------------------------- */

// Uppercase, checkout-friendly code (no 0/O or 1/I)
function makeCode({ prefix = "", length = 8 } = {}) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < length; i++) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return (prefix + out).toUpperCase();
}

function resolveShop(request) {
  const url = new URL(request.url);
  const q = url.searchParams.get("shop");
  const h =
    request.headers.get("x-shopify-shop-domain") ||
    request.headers.get("x-shop-domain") ||
    request.headers.get("x-shopify-shop");
  const env = DEV_SHOP;
  const shop = (q || h || env || "").trim();
  return shop.replace(/^https?:\/\//, "");
}

async function adminFetch({ shop, token, method, path, body }) {
  const url = `https://${shop}/admin/api/${API_VERSION}${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      "X-Shopify-Access-Token": token,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }

  if (!res.ok) {
    const err = new Error(
      data?.errors
        ? typeof data.errors === "string"
          ? data.errors
          : JSON.stringify(data.errors)
        : res.statusText
    );
    err.status = res.status;
    err.data = data;
    throw err;
  }

  return data;
}

/* --- Route ------------------------------------------------------------------ */

export async function loader({ request }) {
  // Confirm via GET ?token=...
  const url = new URL(request.url);
  const tokenParam = url.searchParams.get("token");

  if (!ADMIN_TOKEN) {
    return htmlError(
      502,
      "Missing Admin token",
      "Set SHOPIFY_ADMIN_ACCESS_TOKEN in your environment."
    );
  }
  const shop = resolveShop(request);
  if (!shop) {
    return htmlError(
      400,
      "Missing shop",
      "Pass ?shop=rsldev.myshopify.com or set SHOPIFY_STORE_DOMAIN."
    );
  }
  if (!tokenParam) {
    return htmlError(400, "Missing token", "The confirmation link is invalid.");
  }

  // Look up the pending request & offering
  const req = await prisma.tbl_powerbuy_requests.findFirst({
    where: { token: tokenParam },
  });

  if (!req) {
    return htmlError(404, "Invalid token", "We couldn't find that request.");
  }
  if (req.confirmed_at) {
    // Already confirmed — respond idempotently
    return htmlOk({
      status: "already_confirmed",
    });
  }
  if (req.token_expires && new Date(req.token_expires).getTime() < Date.now()) {
    return htmlError(410, "Token expired", "Please start a new request.");
  }

  // Active offering (by id on the request)
  const now = new Date();
  const config = await prisma.tbl_powerbuy_config.findFirst({
    where: {
      id: req.powerbuy_id,
      start_time: { lte: now },
      end_time: { gte: now },
    },
  });

  if (!config) {
    return htmlError(
      404,
      "Offer not active",
      "This Powerbuy offering is not currently active."
    );
  }

  // Determine price rule, expiry & limits from config (with safe fallbacks)
  const priceRuleId =
    Number(config.discount_price_rule_id) || FALLBACK_PRICE_RULE_ID;
  if (!priceRuleId) {
    return htmlError(
      500,
      "No price rule configured",
      "Set config.discount_price_rule_id or POWERBUY_DEFAULT_PRICE_RULE_ID."
    );
  }

  const expiresAt = new Date(config.end_time || Date.now() + 7 * 864e5);
  const usageLimit =
    Number(config.usage_limit_default || config.usage_limit) || 500;

  const prefix = (config.code_prefix || "RSL-").toUpperCase();
  const length = Number(config.code_length || 8);

  // 1) Update the price rule (ends_at / usage_limit)
  try {
    await adminFetch({
      shop,
      token: ADMIN_TOKEN,
      method: "PUT",
      path: `/price_rules/${priceRuleId}.json`,
      body: {
        price_rule: {
          id: priceRuleId,
          ends_at: expiresAt.toISOString(),
          usage_limit: usageLimit,
        },
      },
    });
  } catch (e) {
    return htmlError(
      e.status || 502,
      "Failed to update price rule",
      e.message || "Unknown Shopify error."
    );
  }

  // 2) Create the discount code with retries for uniqueness
  let lastErr;
  for (let attempt = 0; attempt < 6; attempt++) {
    const code = makeCode({ prefix, length });
    try {
      const created = await adminFetch({
        shop,
        token: ADMIN_TOKEN,
        method: "POST",
        path: `/price_rules/${priceRuleId}/discount_codes.json`,
        body: { discount_code: { code } },
      });

      const dc = created?.discount_code || {};
      // Mark request as confirmed (don’t assume columns beyond confirmed_at)
      await prisma.tbl_powerbuy_requests.update({
        where: { id: req.id },
        data: { confirmed_at: new Date() },
      });

      return htmlOk({
        status: "ok",
        code: dc.code,
        discountCodeId: dc.id,
        priceRuleId,
        expiresAt: expiresAt.toISOString(),
        usageLimit,
      });
    } catch (e) {
      // Retry when duplicate code
      const msg = e?.message || "";
      const isDup =
        (e.status === 422 &&
          /must be unique|already been taken|already exists/i.test(msg)) ||
        /already.*taken/i.test(JSON.stringify(e?.data || {}));
      if (isDup) {
        lastErr = e;
        continue;
      }
      lastErr = e;
      break;
    }
  }

  return htmlError(
    lastErr?.status || 500,
    "Couldn’t create the discount",
    lastErr?.message || "Unknown Shopify error."
  );
}

/* --- Small HTML helpers (curl still sees status codes) --------------------- */

function htmlOk(obj) {
  return json(obj, { status: 200 });
}

function htmlError(status, title, message) {
  const body = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charSet="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Powerbuy — ${escapeHtml(title)}</title>
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
    <h1>${escapeHtml(title)}</h1>
    <p>${escapeHtml(message)}</p>
  </div>
</body>
</html>`;
  return new Response(body, {
    status,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function escapeHtml(s = "") {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

// No action — confirmation is GET-only
export const action = () =>
  json({ error: "method_not_allowed" }, { status: 405 });
