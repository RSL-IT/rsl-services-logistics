// app/routes/apps.powerbuy.confirm.jsx
import { json } from "@remix-run/node";
import { prisma } from "../db.server.js";
import { queuePowerbuyAcceptanceEmail } from "../services/shopify-email.server.js";
import { getOfflineSession } from "../shopify-admin.server.js";

const API_VERSION = process.env.SHOPIFY_API_VERSION || "2025-01";
const SHOP_FALLBACK =
  process.env.SHOP_CUSTOM_DOMAIN ||
  process.env.SHOPIFY_STORE_DOMAIN ||
  "rsldev.myshopify.com";

/** Keep "rsldev.myshopify.com" (no scheme, no trailing slash) */
function normalizeShop(shop) {
  return String(shop || "")
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/+$/i, "");
}

function resolveShop(request) {
  const url = new URL(request.url);
  const fromParam =
    url.searchParams.get("shop") || url.searchParams.get("shopDomain");
  const fromHeader =
    request.headers.get("x-shopify-shop-domain") ||
    request.headers.get("x-shop-domain") ||
    request.headers.get("x-shopify-shop");
  return normalizeShop(fromParam || fromHeader || SHOP_FALLBACK);
}

/** Minimal REST helper using the stored offline token */
async function adminREST(shop, path, method, payload) {
  const domain = normalizeShop(shop);
  const session = await getOfflineSession(domain);
  if (!session?.accessToken) {
    throw new Error(
      `No offline Admin session for ${domain}. Re-install or re-authorize the app.`
    );
  }

  const endpoint = `https://${domain}/admin/api/${API_VERSION}${path}`;
  const res = await fetch(endpoint, {
    method,
    headers: {
      "X-Shopify-Access-Token": session.accessToken,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: payload ? JSON.stringify(payload) : undefined,
  });

  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text };
  }
  if (!res.ok) {
    const msg =
      (body && (body.errors || body.error || text)) ||
      `${res.status} ${res.statusText}`;
    throw new Error(`REST ${method} ${path} failed: ${msg}`);
  }
  return body;
}

/** Build a human-ish discount code like "RSLPB-3F9K8C" */
function generateCode(prefix = "RSLPB") {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let r = "";
  for (let i = 0; i < 6; i++) {
    r += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return `${(prefix || "RSLPB").replace(/[^A-Z0-9]/gi, "").toUpperCase()}-${r}`;
}

/** From product GID → numeric id for REST price rule entitlement */
function productNumericId(productGid) {
  const m = String(productGid || "").match(/Product\/(\d+)/);
  return m ? Number(m[1]) : null;
}

/** HTML helpers */
function htmlPage(title, body) {
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charSet="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>${escapeHtml(title)}</title>
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
      ${body}
    </div>
  </body>
</html>`;
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

/** Map enum + decimal from config → Shopify price_rule fields */
function discountParamsFromConfig(cfg) {
  // cfg.discount_type: "percentage" | "fixed" | null
  // cfg.discount_value: Prisma Decimal | number | string | null
  const typeEnum = String(cfg.discount_type || "").toLowerCase();
  const isPct = typeEnum === "percentage";
  const isFixed = typeEnum === "fixed";

  let vRaw = cfg.discount_value;
  let v = vRaw == null ? NaN : Number(vRaw); // handles Prisma.Decimal too
  if (!Number.isFinite(v) || v <= 0) {
    // Sensible fallback if missing/invalid
    v = isFixed ? 50 : 20;
  }
  if (isPct && v > 100) v = 100;

  const value_type = isFixed ? "fixed_amount" : "percentage";
  const value = -Math.abs(v); // Shopify expects NEGATIVE numbers
  const display = isFixed ? `${Math.abs(v)}` : `${Math.abs(v)}%`;

  return { value_type, value, display };
}

/**
 * GET /apps/powerbuy/confirm?token=...
 * Confirms the request, creates price rule + discount code, logs it, queues acceptance email.
 * Returns HTML or JSON (if Accept: application/json).
 */
export async function loader({ request }) {
  const url = new URL(request.url);
  const wantsJSON = (request.headers.get("accept") || "").includes(
    "application/json"
  );

  const token = url.searchParams.get("token");
  if (!token) {
    const payload = { error: "missing_token" };
    return wantsJSON
      ? json(payload, { status: 400 })
      : new Response(
        htmlPage(
          "Powerbuy — Missing token",
          `<h1>Missing confirmation token</h1><p>Sorry, this link is missing a token.</p>`
        ),
        { status: 400, headers: { "Content-Type": "text/html; charset=utf-8" } }
      );
  }

  const shop = resolveShop(request);
  if (!shop) {
    const payload = { error: "shop_missing" };
    return wantsJSON
      ? json(payload, { status: 400 })
      : new Response(
        htmlPage(
          "Powerbuy — Missing shop",
          `<h1>Shop not specified</h1><p>Please contact support. (Missing shop domain)</p>`
        ),
        { status: 400, headers: { "Content-Type": "text/html; charset=utf-8" } }
      );
  }

  // 1) Fetch the pending request
  const req = await prisma.tbl_powerbuy_requests.findUnique({
    where: { token },
  });

  if (!req) {
    const payload = { error: "invalid_token" };
    return wantsJSON
      ? json(payload, { status: 404 })
      : new Response(
        htmlPage(
          "Powerbuy — Link not found",
          `<h1>That link isn’t valid</h1><p>The confirmation link may be incorrect or already used.</p>`
        ),
        { status: 404, headers: { "Content-Type": "text/html; charset=utf-8" } }
      );
  }

  // 2) Validate window and single-use
  const now = new Date();
  if (req.token_expires && now > req.token_expires) {
    const payload = { error: "token_expired" };
    return wantsJSON
      ? json(payload, { status: 410 })
      : new Response(
        htmlPage(
          "Powerbuy — Link expired",
          `<h1>Link expired</h1><p>Please start again from the Powerbuy signup page.</p>`
        ),
        { status: 410, headers: { "Content-Type": "text/html; charset=utf-8" } }
      );
  }

  if (req.confirmed_at) {
    const payload = { error: "already_confirmed" };
    return wantsJSON
      ? json(payload, { status: 409 })
      : new Response(
        htmlPage(
          "Powerbuy — Already confirmed",
          `<h1>Already confirmed</h1><p>This link has already been used.</p>`
        ),
        { status: 409, headers: { "Content-Type": "text/html; charset=utf-8" } }
      );
  }

  // 3) Get the active config
  const cfg = await prisma.tbl_powerbuy_config.findUnique({
    where: { id: req.powerbuy_id },
  });

  if (!cfg) {
    const payload = { error: "config_not_found" };
    return wantsJSON
      ? json(payload, { status: 500 })
      : new Response(
        htmlPage(
          "Powerbuy — Error",
          `<h1>Configuration missing</h1><p>Please contact support.</p>`
        ),
        { status: 500, headers: { "Content-Type": "text/html; charset=utf-8" } }
      );
  }

  // Ensure in window
  if (
    (cfg.start_time && now < cfg.start_time) ||
    (cfg.end_time && now > cfg.end_time)
  ) {
    const payload = { error: "offer_window_closed" };
    return wantsJSON
      ? json(payload, { status: 403 })
      : new Response(
        htmlPage(
          "Powerbuy — Closed",
          `<h1>This Powerbuy has closed</h1><p>We’re sorry, the promotion window is not active.</p>`
        ),
        { status: 403, headers: { "Content-Type": "text/html; charset=utf-8" } }
      );
  }

  // 4) Create a Shopify Price Rule + Discount Code (scoped to configured product)
  const uses = cfg.number_of_uses ?? 12;
  const { value_type, value, display } = discountParamsFromConfig(cfg);

  const code = generateCode(cfg.discount_prefix || "RSLPB");
  const productIdNum = productNumericId(cfg.powerbuy_product_id);
  if (!productIdNum) {
    const payload = { error: "invalid_product_id" };
    return wantsJSON
      ? json(payload, { status: 500 })
      : new Response(
        htmlPage(
          "Powerbuy — Error",
          `<h1>Product not configured</h1><p>Please contact support. (Bad product id)</p>`
        ),
        { status: 500, headers: { "Content-Type": "text/html; charset=utf-8" } }
      );
  }

  const startsAtISO = (cfg.start_time || now).toISOString();
  const endsAtISO = (cfg.end_time || new Date(now.getTime() + 86400e3)).toISOString();

  let priceRule;
  try {
    priceRule = await adminREST(
      shop,
      `/price_rules.json`,
      "POST",
      {
        price_rule: {
          title: `${cfg.title || "RSL Powerbuy"} — ${code}`,
          target_type: "line_item",
          target_selection: "entitled",
          allocation_method: "across",
          value_type,          // "percentage" | "fixed_amount"
          value,               // negative
          customer_selection: "all",
          entitled_product_ids: [productIdNum],
          starts_at: startsAtISO,
          ends_at: endsAtISO,
          usage_limit: uses,
          once_per_customer: false,
        },
      }
    );
  } catch (e) {
    const payload = { error: "price_rule_create_failed", detail: String(e?.message || e) };
    return wantsJSON
      ? json(payload, { status: 502 })
      : new Response(
        htmlPage(
          "Powerbuy — Error creating discount",
          `<h1>Couldn’t create the discount</h1><p>${escapeHtml(
            String(e?.message || e)
          )}</p>`
        ),
        { status: 502, headers: { "Content-Type": "text/html; charset=utf-8" } }
      );
  }

  const priceRuleId = priceRule?.price_rule?.id;
  if (!priceRuleId) {
    const payload = { error: "price_rule_missing_id" };
    return wantsJSON
      ? json(payload, { status: 502 })
      : new Response(
        htmlPage(
          "Powerbuy — Error",
          `<h1>Discount creation failed</h1><p>Missing price rule id.</p>`
        ),
        { status: 502, headers: { "Content-Type": "text/html; charset=utf-8" } }
      );
  }

  let codeCreate;
  try {
    codeCreate = await adminREST(
      shop,
      `/price_rules/${priceRuleId}/discount_codes.json`,
      "POST",
      { discount_code: { code } }
    );
  } catch (e) {
    const payload = { error: "discount_code_create_failed", detail: String(e?.message || e) };
    return wantsJSON
      ? json(payload, { status: 502 })
      : new Response(
        htmlPage(
          "Powerbuy — Error creating code",
          `<h1>Couldn’t create the discount code</h1><p>${escapeHtml(
            String(e?.message || e)
          )}</p>`
        ),
        { status: 502, headers: { "Content-Type": "text/html; charset=utf-8" } }
      );
  }

  const shopifyDiscountCodeId = codeCreate?.discount_code?.id
    ? String(codeCreate.discount_code.id)
    : "";

  // 5) Mark confirmed + log the code
  await prisma.$transaction([
    prisma.tbl_powerbuy_requests.update({
      where: { id: req.id },
      data: { confirmed_at: now },
    }),
    prisma.tbl_powerbuy_codes.create({
      data: {
        powerbuy_id: cfg.id,
        discount_code: code,
        discount_code_gid: shopifyDiscountCodeId,
        short_description: cfg.short_description || null,
        long_description: cfg.long_description || "",
        confirmation_email_content: cfg.confirmation_email_content || null,
        acceptance_email_content: cfg.acceptance_email_content || null,
        rsl_contact_email_address: cfg.rsl_contact_email_address || null,
        start_time: cfg.start_time || now,
        end_time: cfg.end_time || null,
        number_of_uses: uses,
        powerbuy_product_id: cfg.powerbuy_product_id || null,
      },
    }),
  ]);

  // 6) Queue the acceptance email via Shopify (Flow tag + metafield, etc.)
  const [firstName, ...restName] = String(req.name || "").trim().split(/\s+/);
  try {
    await queuePowerbuyAcceptanceEmail({
      shop,
      email: req.email,
      firstName: firstName || "",
      lastName: restName.join(" ") || "",
      discountCode: code,
      startsAtISO,
      endsAtISO,
      uses,
      productId: cfg.powerbuy_product_id,
      shortDescription: cfg.short_description || "",
      longDescription: cfg.long_description || "",
      contactEmail: cfg.rsl_contact_email_address || "",
    });
  } catch (e) {
    // Don’t fail the confirmation if the email queue hiccups.
    if (wantsJSON) {
      return json(
        {
          status: "ok",
          code,
          priceRuleId,
          discount_code_id: shopifyDiscountCodeId,
          warning: "email_queue_failed",
          detail: String(e?.message || e),
        },
        { status: 200 }
      );
    }
    console.warn("Powerbuy acceptance email queue failed:", e?.message || e);
  }

  // 7) Done
  if (wantsJSON) {
    return json(
      {
        status: "ok",
        code,
        priceRuleId,
        discount_code_id: shopifyDiscountCodeId,
        value_type,
        value_display: display, // e.g., "20%" or "50"
      },
      { status: 200 }
    );
  }

  return new Response(
    htmlPage(
      "Powerbuy — Confirmed",
      `<h1>You're all set!</h1>
       <p>Thanks, <strong>${escapeHtml(req.name || "there")}</strong>. Your discount code is:</p>
       <p><code>${escapeHtml(code)}</code></p>
       <p class="muted">It can be used up to ${uses} time(s) on the selected product during the offer window.</p>`
    ),
    { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } }
  );
}

// IMPORTANT: No `action` export — this route is GET-only via `loader`.
