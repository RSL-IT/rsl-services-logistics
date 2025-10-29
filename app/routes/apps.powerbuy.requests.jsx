// app/routes/apps.powerbuy.requests.jsx
import { json } from "@remix-run/node";
import { prisma } from "~/db.server";

/** ------------------ environment helpers ------------------ */
const truthy = (v) =>
  (v ?? "").toString().toLowerCase() === "true" ||
  (v ?? "").toString() === "1";

const env = {
  BYPASS_CAPTCHA: truthy(process.env.POWERBUY_BYPASS_CAPTCHA),
  BYPASS_EMAIL: truthy(process.env.POWERBUY_EMAIL_BYPASS),
  DEBUG: truthy(process.env.POWERBUY_DEBUG),
};

/** ------------------ request helpers ------------------ */
function getClientIp(request) {
  const h = request.headers;
  return (
    h.get("Fly-Client-IP") ||
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    h.get("x-real-ip") ||
    ""
  );
}

function toNumericId(input) {
  if (!input) return null;
  const s = String(input);
  if (/^\d+$/.test(s)) return Number(s);
  const m = s.match(/(\d+)$/);
  return m ? Number(m[1]) : null;
}

function ensureVariantGid(idOrGid) {
  if (!idOrGid) return null;
  const s = String(idOrGid);
  if (s.startsWith("gid://")) return s;
  const num = toNumericId(s);
  return num ? `gid://shopify/ProductVariant/${num}` : null;
}

function parseAllowedStores(allowed) {
  if (!allowed) return [];
  return allowed
    .split(/[\s,;]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

function inWindow(cfg, now = new Date()) {
  if (cfg.start_time && now < cfg.start_time) return false;
  if (cfg.end_time && now > cfg.end_time) return false;
  return true;
}

function variantAllowed(cfg, variantNumeric) {
  // If config lists variants, require a match; otherwise allow any
  if (cfg.powerbuy_variant_ids && cfg.powerbuy_variant_ids.trim().length) {
    const nums = cfg.powerbuy_variant_ids
      .split(/[\s,;]+/)
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => toNumericId(s))
      .filter((n) => typeof n === "number");
    return nums.includes(variantNumeric);
  }
  return true;
}

async function findMatchingConfig({ shop, variantNumeric }) {
  const configs = await prisma.tbl_powerbuy_config.findMany({
    orderBy: [{ start_time: "desc" }, { id: "desc" }],
  });

  const shopLc = (shop || "").toLowerCase();

  const match = configs.find((cfg) => {
    if (!inWindow(cfg)) return false;
    const stores = parseAllowedStores(cfg.allowed_stores);
    if (stores.length > 0 && !stores.includes(shopLc)) return false;
    if (!variantAllowed(cfg, variantNumeric)) return false;
    return true;
  });

  return match || null;
}

function parseDurationToMs(s) {
  // default 14 days
  if (!s) return 14 * 24 * 60 * 60 * 1000;

  const m = String(s).trim().toLowerCase().match(/^(\d+)\s*(d|day|days|h|hr|hrs|hour|hours)$/);
  if (m) {
    const n = Number(m[1]);
    const unit = m[2][0]; // 'd' or 'h'
    return unit === "d" ? n * 24 * 60 * 60 * 1000 : n * 60 * 60 * 1000;
  }

  // ISO-ish: P14D or PT24H
  const iso = String(s).trim().toUpperCase();
  if (/^P\d+D$/.test(iso)) return Number(iso.slice(1, -1)) * 24 * 60 * 60 * 1000;
  if (/^PT\d+H$/.test(iso)) return Number(iso.slice(2, -1)) * 60 * 60 * 1000;

  return 14 * 24 * 60 * 60 * 1000;
}

async function maybeVerifyRecaptcha(token, ip) {
  if (env.BYPASS_CAPTCHA) return { ok: true, reason: "bypass" };
  if (!token) return { ok: false, error: "captcha_required" };

  const secret = process.env.CAPTCHA_SECRET || process.env.RECAPTCHA_SECRET_KEY;
  const endpoint =
    process.env.CAPTCHA_VERIFY_URL ||
    "https://www.google.com/recaptcha/api/siteverify";

  try {
    const params = new URLSearchParams({ secret: secret || "", response: token });
    if (ip) params.set("remoteip", ip);

    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });

    const data = await res.json();
    if (!data?.success) return { ok: false, error: "captcha_failed", detail: data };
    if (typeof data.score === "number" && data.score < 0.5)
      return { ok: false, error: "captcha_low_score", detail: data };

    return { ok: true, detail: data };
  } catch (e) {
    return { ok: false, error: "captcha_verify_error", detail: String(e) };
  }
}

function validateBody(b) {
  const errors = {};
  const name = (b?.name || "").toString().trim();
  const email = (b?.email || "").toString().trim();
  const variant_id = b?.variant_id || b?.variant || null;
  const product_id = b?.product_id || null;
  const captcha_token = b?.captcha_token || b?.captcha || b?.recaptchaToken || null;

  if (!name) errors.name = "Name is required";
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) errors.email = "Valid email is required";
  if (!variant_id && !product_id) errors.variant_id = "variant_id (or product_id) is required";

  return { errors, parsed: { name, email, variant_id, product_id, captcha_token } };
}

/** ------------------ Remix action ------------------ */
export async function action({ request }) {
  if (request.method.toUpperCase() !== "POST") {
    return json({ error: "method_not_allowed" }, { status: 405 });
  }

  const url = new URL(request.url);
  const shop =
    url.searchParams.get("shop") ||
    request.headers.get("x-shopify-shop-domain") ||
    request.headers.get("shopify-shop-domain") ||
    "";

  if (!shop) return json({ error: "missing_shop" }, { status: 400 });

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid_json" }, { status: 400 });
  }

  const { errors, parsed } = validateBody(body);
  if (Object.keys(errors).length) {
    return json({ error: "validation_failed", errors }, { status: 400 });
  }

  const clientIp = getClientIp(request);

  // 1) CAPTCHA (unless bypass)
  const captcha = await maybeVerifyRecaptcha(parsed.captcha_token, clientIp);
  if (!captcha.ok) {
    if (env.DEBUG) console.warn("[powerbuy.requests] captcha_fail", captcha);
    return json({ error: captcha.error, detail: captcha.detail || null }, { status: 400 });
  }

  // 2) Normalize variant id -> numeric
  const variantGid = ensureVariantGid(parsed.variant_id || parsed.product_id);
  const variantNumeric = toNumericId(variantGid);
  if (!variantNumeric) return json({ error: "invalid_variant_id" }, { status: 400 });

  // 3) Find matching campaign config
  const cfg = await findMatchingConfig({ shop, variantNumeric });
  if (!cfg) {
    return json({ error: "no_active_config_for_variant_or_shop" }, { status: 404 });
  }

  // 4) Create request record
  const durationMs = parseDurationToMs(cfg.duration);
  const now = new Date();
  const token =
    (globalThis.crypto && "randomUUID" in globalThis.crypto)
      ? globalThis.crypto.randomUUID()
      : Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);

  const created = await prisma.tbl_powerbuy_requests.create({
    data: {
      powerbuy_id: cfg.id,
      name: parsed.name,
      email: parsed.email.toLowerCase(),
      product_id: variantGid, // store Variant GID (string column)
      token,
      token_expires: new Date(now.getTime() + durationMs),
      confirmed_at: null,
      request_ip: clientIp || null,
    },
    select: { id: true, token: true, token_expires: true },
  });

  const response = {
    ok: true,
    request_id: created.id,
    token: created.token,
    token_expires: created.token_expires,
    config_id: cfg.id,
  };

  if (env.DEBUG) console.log("[powerbuy.requests] created", response);

  return json(response, { status: 201 });
}

// No page here; this route is API-only
export const loader = () => json({ error: "not_found" }, { status: 404 });
