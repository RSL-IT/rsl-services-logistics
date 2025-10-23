// app/routes/apps.powerbuy.requests.jsx
import { json } from "@remix-run/node";
import { prisma } from "../db.server.js";
import crypto from "node:crypto";
import { queuePowerbuyConfirmationEmail } from "../services/shopify-email.server.js";

/** Resolve the shop domain from query/header/env */
function resolveShop(request) {
  const url = new URL(request.url);

  // Prefer explicit query param
  const fromParam =
    url.searchParams.get("shop") ||
    url.searchParams.get("shopDomain");

  // Shopify may send one of these headers
  const fromHeader =
    request.headers.get("x-shopify-shop-domain") ||
    request.headers.get("x-shop-domain") ||
    request.headers.get("x-shopify-shop");

  // Fallback to env
  const fromEnv =
    process.env.SHOP_CUSTOM_DOMAIN ||
    process.env.SHOPIFY_STORE_DOMAIN ||
    "";

  const shop = (fromParam || fromHeader || fromEnv || "").trim();
  return shop.replace(/^https?:\/\//, ""); // keep as "rslspeakers.myshopify.com"
}

/** reCAPTCHA v3 verification (bypassable in dev) */
async function verifyRecaptcha(token) {
  if (process.env.BYPASS_RECAPTCHA === "1") return; // DEV ONLY
  const secret = process.env.RECAPTCHA_SECRET || "";
  if (!secret) throw new Error("captcha_failed");

  const params = new URLSearchParams({ secret, response: token || "" });
  const res = await fetch("https://www.google.com/recaptcha/api/siteverify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params,
  });
  const data = await res.json();
  if (!data.success || (typeof data.score === "number" && data.score < 0.5)) {
    throw new Error("captcha_failed");
  }
}

export async function loader({ request }) {
  // Preflight / OPTIONS
  if (request.method === "OPTIONS") return new Response(null, { status: 204 });
  // Resource route: only POST is supported
  return json({ error: "method_not_allowed" }, { status: 405 });
}

export async function action({ request }) {
  // Preflight / OPTIONS
  if (request.method === "OPTIONS") return new Response(null, { status: 204 });
  if (request.method !== "POST") {
    return json({ error: "method_not_allowed" }, { status: 405 });
  }

  // Resolve shop (required for Shopify Admin API calls)
  const shop = resolveShop(request);
  if (!shop) {
    return json(
      {
        error: "shop_missing",
        hint:
          "Pass ?shop=rslspeakers.myshopify.com or set SHOPIFY_STORE_DOMAIN in env.",
      },
      { status: 400 }
    );
  }

  // Parse body (accept JSON or form)
  const ct = request.headers.get("content-type") || "";
  let name, email, product_id, captcha_token, marketing_opt_in;

  if (ct.includes("application/json")) {
    const b = await request.json();
    name = b.name;
    email = b.email;
    // Accept snake_case and camelCase
    product_id = b.product_id || b.productId;
    captcha_token = b.captcha_token || b.captchaToken;
    marketing_opt_in = !!(b.marketing_opt_in ?? b.marketingOptIn);
  } else {
    const fd = await request.formData();
    name = fd.get("name");
    email = fd.get("email");
    product_id = fd.get("product_id") || fd.get("productId");
    captcha_token = fd.get("captcha_token") || fd.get("captchaToken");
    const m = fd.get("marketing_opt_in") ?? fd.get("marketingOptIn");
    marketing_opt_in = m === "on" || m === "true" || m === true;
  }

  // Basic validation
  if (!name || !email || !product_id || !captcha_token) {
    return json({ error: "missing_fields" }, { status: 400 });
  }

  // Optional: early reject placeholder/invalid GIDs
  if (!/^gid:\/\/shopify\/Product\/\d+$/.test(product_id)) {
    return json({ error: "invalid_product_gid" }, { status: 400 });
  }

  // Verify captcha
  try {
    await verifyRecaptcha(captcha_token);
  } catch {
    return json({ error: "captcha_failed" }, { status: 400 });
  }

  // Find active Powerbuy config for this product
  const now = new Date();
  const config = await prisma.tbl_powerbuy_config.findFirst({
    where: {
      powerbuy_product_id: product_id,
      start_time: { lte: now },
      end_time: { gte: now },
    },
  });
  if (!config) {
    return json({ error: "no_active_offer_for_product" }, { status: 404 });
  }

  // Prevent duplicates while pending
  const existing = await prisma.tbl_powerbuy_requests.findFirst({
    where: { email, powerbuy_id: config.id, confirmed_at: null },
  });
  if (existing) {
    return json({ error: "pending_confirmation_exists" }, { status: 409 });
  }

  // Create a pending request
  const token = crypto.randomUUID();
  const expires = new Date(Date.now() + 1000 * 60 * 60 * 24); // 24h

  await prisma.tbl_powerbuy_requests.create({
    data: {
      name,
      email,
      product_id,
      powerbuy_id: config.id,
      token,
      token_expires: expires,
      request_ip:
        (request.headers.get("x-forwarded-for") || "").split(",")[0] || null,
    },
  });

  // Build confirm URL
  const origin = new URL(request.url).origin;
  const confirmUrl = `${origin}/apps/powerbuy/confirm?token=${encodeURIComponent(
    token
  )}`;

  // Queue confirmation email via Shopify (Flow trigger)
  try {
    await queuePowerbuyConfirmationEmail({
      shop,
      email,
      firstName: name.split(" ")[0] || "",
      lastName: name.split(" ").slice(1).join(" ") || "",
      confirmUrl,
      powerbuyId: config.id,
      offerTitle: config.title || "RSL Powerbuy Confirmation",
      marketingOptIn: !!marketing_opt_in,
    });
  } catch (e) {
    console.error("Powerbuy queue email failed:", e?.message || e);
    // Don't leak internal details; return a helpful, testable error
    return json(
      { error: "email_queue_failed", detail: String(e?.message || e) },
      { status: 502 }
    );
  }

  return json({ status: "ok" });
}

// NOTE: No default export — this stays a pure resource route.
