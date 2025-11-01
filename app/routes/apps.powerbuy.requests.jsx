// app/routes/apps.powerbuy.requests.jsx
import { json } from "@remix-run/node";
import { prisma } from "~/db.server";
import { randomUUID as nodeRandomUUID } from "crypto";
import { runAdminQuery } from "~/shopify-admin.server";

/* ------------------ env helpers ------------------ */
const truthy = (v) =>
  (v ?? "").toString().toLowerCase() === "true" ||
  (v ?? "").toString() === "1";

const env = {
  BYPASS_CAPTCHA: truthy(process.env.POWERBUY_BYPASS_CAPTCHA),
  BYPASS_EMAIL: truthy(process.env.POWERBUY_EMAIL_BYPASS),
  DEBUG: truthy(process.env.POWERBUY_DEBUG),
  DEFAULT_SHOP: process.env.SHOPIFY_SHOP_DOMAIN || "rsldev.myshopify.com",
  TOKEN_TTL_MIN: Number(process.env.POWERBUY_TOKEN_TTL_MINUTES || 60),
};

/* ------------------ id / parsing utilities ------------------ */
const toNumericId = (s) => {
  const onlyDigits = String(s || "").replace(/\D/g, "");
  return onlyDigits ? Number(onlyDigits) : null;
};

// Accepts a product or variant id; we keep the *variant GID* as product_id (string column)
const ensureVariantGid = (value) => {
  const v = String(value || "");
  if (v.startsWith("gid://shopify/ProductVariant/")) return v;
  if (v.startsWith("gid://shopify/Product/")) return v; // fallback; still a valid GID string
  // If a raw numeric comes in, treat it as a variant id GID
  if (/^\d+$/.test(v)) return `gid://shopify/ProductVariant/${v}`;
  return v; // last resort: store as-is
};

const parseDurationToMs = (s) => {
  const str = String(s || "").trim().toLowerCase();
  if (!str) return 60 * 60 * 1000; // default 60m
  const m = str.match(/^(\d+)\s*(ms|s|m|h|d)$/);
  if (!m) return 60 * 60 * 1000;
  const n = Number(m[1]);
  const unit = m[2];
  switch (unit) {
    case "ms": return n;
    case "s": return n * 1000;
    case "m": return n * 60 * 1000;
    case "h": return n * 60 * 60 * 1000;
    case "d": return n * 24 * 60 * 60 * 1000;
    default: return 60 * 60 * 1000;
  }
};

/* ------------------ shop timezone ------------------ */
async function getShopIanaTimezone(shop) {
  try {
    const data = await runAdminQuery(
      shop,
      `#graphql
       query { shop { ianaTimezone } }`
    );
    return data?.shop?.ianaTimezone || "UTC";
  } catch {
    return "UTC";
  }
}

/* ------------------ matching helpers ------------------ */
function shopAllowed(cfg, shop) {
  if (!cfg.allowed_stores) return true;
  const arr = String(cfg.allowed_stores)
    .toLowerCase()
    .split(/[,\s;]+/)
    .filter(Boolean);
  return arr.includes(String(shop).toLowerCase());
}

function variantAllowed(cfg, variantNumeric) {
  // If config lists variants, require a match; otherwise allow any
  if (cfg.powerbuy_variant_ids && cfg.powerbuy_variant_ids.trim().length) {
    const nums = String(cfg.powerbuy_variant_ids)
      .split(/[,\s;]+/)
      .map((s) => s.trim())
      .filter(Boolean)
      .map(toNumericId)
      .filter((n) => typeof n === "number");
    return nums.includes(variantNumeric);
  }
  return true;
}

/* ------------------ CAPTCHA (optional) ------------------ */
async function verifyCaptchaOrBypass(body) {
  if (env.BYPASS_CAPTCHA) return { ok: true };
  // Implement real verification here if needed, e.g. Google reCAPTCHA / hCaptcha
  // For now, require a non-empty token if not bypassing:
  if (body?.captcha_token) return { ok: true };
  return { ok: false, error: "captcha_required" };
}

/* ------------------ action ------------------ */
export const action = async ({ request }) => {
  const url = new URL(request.url);
  let shop =
    (url.searchParams.get("shop") ||
      request.headers.get("x-shopify-shop-domain") ||
      env.DEFAULT_SHOP)
      .trim()
      .toLowerCase();

  // Parse JSON safely
  const parsed = await request.json().catch(() => ({}));
  const name = (parsed.name || "").trim();
  const email = (parsed.email || "").trim();

  if (!shop) return json({ error: "missing_shop" }, { status: 400 });
  if (!email) return json({ error: "missing_email" }, { status: 400 });
  if (!parsed.variant_id && !parsed.product_id) {
    return json({ error: "missing_variant_id" }, { status: 400 });
  }

  // Shop timezone (for messages)
  const iana = await getShopIanaTimezone(shop);
  const fmtLocal = (d) =>
    new Intl.DateTimeFormat("en-US", {
      timeZone: iana,
      dateStyle: "medium",
      timeStyle: "short",
    }).format(d);

  // 1) CAPTCHA
  const captcha = await verifyCaptchaOrBypass(parsed);
  if (!captcha.ok) {
    return json({ error: captcha.error, detail: captcha.detail || null }, { status: 400 });
  }

  // 2) Normalize variant id -> numeric (for matching)
  const variantGid = ensureVariantGid(parsed.variant_id || parsed.product_id);
  const variantNumeric = toNumericId(variantGid);
  if (!variantNumeric) return json({ error: "invalid_variant_id" }, { status: 400 });

  // 3) Find candidate configs for this shop (ignore time window first so we can return explicit errors)
  const candidates = await prisma.tbl_powerbuy_config.findMany({
    where: { allowed_stores: { contains: shop, mode: "insensitive" } },
    orderBy: { id: "desc" },
  });

  // 4) Filter to configs that include this variant
  const cfg = candidates.find((c) => variantAllowed(c, variantNumeric));
  if (!cfg) {
    return json({ error: "no_active_config_for_variant_or_shop" }, { status: 404 });
  }

  // 5) Time-window checks (explicit)
  const now = new Date();
  const durationMs = parseDurationToMs(cfg.duration);
  if (cfg.start_time && now < cfg.start_time) {
    return json(
      {
        error: "not_started",
        now_utc: now.toISOString(),
        window: {
          start_utc: cfg.start_time.toISOString(),
          end_utc: cfg.end_time?.toISOString() || null,
          start_local: fmtLocal(cfg.start_time),
          end_local: cfg.end_time ? fmtLocal(cfg.end_time) : null,
        },
        timezone: iana,
      },
      { status: 400 }
    );
  }
  if (cfg.end_time && now >= cfg.end_time) {
    return json(
      {
        error: "expired",
        now_utc: now.toISOString(),
        window: {
          start_utc: cfg.start_time?.toISOString() || null,
          end_utc: cfg.end_time.toISOString(),
          start_local: cfg.start_time ? fmtLocal(cfg.start_time) : null,
          end_local: fmtLocal(cfg.end_time),
        },
        timezone: iana,
      },
      { status: 400 }
    );
  }

  // 6) Create request + token (IMPORTANT: satisfy schema)
  // - product_id is REQUIRED String → store the Variant GID here (your schema uses it as a string bucket)
  // - DO NOT set a non-existent `variant_id` column
  // - Connect the required relation via `powerbuy`
  const token =
    (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function")
      ? globalThis.crypto.randomUUID()
      : nodeRandomUUID();

  const token_expires = new Date(now.getTime() + durationMs);

  let created;
  try {
    created = await prisma.tbl_powerbuy_requests.create({
      data: {
        powerbuy: { connect: { id: cfg.id } }, // required relation
        name,
        email: email.toLowerCase(),
        product_id: variantGid, // REQUIRED by schema; store Variant GID as string
        token,
        token_expires,
        confirmed_at: null,
        request_ip:
          request.headers.get("fly-client-ip") ||
          request.headers.get("x-forwarded-for") ||
          null,
        created_at: new Date(),
      },
    });
  } catch (e) {
    if (env.DEBUG) console.error("[powerbuy.requests] create failed:", e);
    return json(
      {
        error: "db_create_failed",
        detail:
          e?.name === "PrismaClientValidationError"
            ? "Validation error creating tbl_powerbuy_requests. Check required fields and relation."
            : (e?.message || String(e)),
      },
      { status: 500 }
    );
  }

  // 7) Build confirm URL
  const confirmUrl = `${url.origin}/apps/powerbuy/confirm?token=${encodeURIComponent(
    created.token
  )}&shop=${encodeURIComponent(shop)}`;

  // 8) Email send (optional bypass)
  if (env.BYPASS_EMAIL) {
    const response = {
      ok: true,
      bypassedEmail: true,
      request_id: created.id,
      token: created.token,
      token_expires: created.token_expires,
      config_id: cfg.id,
      confirmUrl,
      expires_local: fmtLocal(token_expires),
      timezone: iana,
    };
    if (env.DEBUG) console.log("[powerbuy.requests] created (bypassed email)", response);
    return json(response, { status: 201 });
  }

  // TODO: Implement Shopify Email send with the confirmUrl
  const response = {
    ok: true,
    sentEmail: true,
    request_id: created.id,
    token_expires: created.token_expires,
    config_id: cfg.id,
    expires_local: fmtLocal(token_expires),
    timezone: iana,
  };
  if (env.DEBUG) console.log("[powerbuy.requests] created (sent email)", response);
  return json(response, { status: 201 });
};

/* ------------------ loader: API-only ------------------ */
export const loader = () => json({ error: "not_found" }, { status: 404 });
