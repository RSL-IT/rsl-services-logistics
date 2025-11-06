// app/routes/apps.powerbuy.requests.jsx
import { json } from "@remix-run/node";
import { prisma } from "~/db.server";
import { sendRequestEmail } from "~/services/mailer.server";
import { verifyProxyIfPresent } from "~/utils/app-proxy-verify.server";

// ---------- small helpers ----------

function headerOrNull(req, name) {
  const v = req.headers.get(name);
  return v ? v.trim() : null;
}

async function readBody(request) {
  // Accept JSON or x-www-form-urlencoded (browser forms / curl --data-urlencode)
  const ct = (request.headers.get("content-type") || "").toLowerCase();
  if (ct.includes("application/json")) {
    return await request.json();
  }
  // form-encoded or multipart -> convert to a simple object
  const fd = await request.formData();
  const obj = {};
  for (const [k, v] of fd.entries()) {
    obj[k] = typeof v === "string" ? v : String(v);
  }

  return obj;
}

// Use X-Forwarded-Proto / Host if present (Fly/Proxies)
function requestOrigin(req) {
  const proto = headerOrNull(req, "x-forwarded-proto") || "https";
  const host = headerOrNull(req, "x-forwarded-host") || headerOrNull(req, "host");
  if (host) return `${proto}://${host}`;
  try {
    // fallback to the request URL’s origin
    return new URL(req.url).origin;
  } catch {
    return "https://localhost";
  }
}

function makeToken(len = 48) {
  const chars =
    "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_";
  let out = "";
  for (let i = 0; i < len; i++) out += chars[(Math.random() * chars.length) | 0];
  return out;
}

function parseCsv(s) {
  if (!s) return [];
  return String(s)
    .split(/[,\s]+/)
    .map((x) => x.trim())
    .filter(Boolean);
}

// Accepts "15m", "2h", "7d". Defaults to 24h.
function parseDurationMs(s) {
  const str = (s || "").trim();
  const m = /^(\d+)\s*([mhd])$/i.exec(str);
  if (!m) return 24 * 60 * 60 * 1000;
  const n = Number(m[1]);
  const u = m[2].toLowerCase();
  if (u === "m") return n * 60 * 1000;
  if (u === "h") return n * 60 * 60 * 1000;
  if (u === "d") return n * 24 * 60 * 60 * 1000;
  return 24 * 60 * 60 * 1000;
}

// Normalize Shopify IDs so "gid://shopify/Product/123456789" and "123456789" compare equal.
function normalizeNumericId(id) {
  if (!id) return "";
  const s = String(id).trim();
  if (s.startsWith("gid://")) {
    const last = s.split("/").pop();
    return last || s;
  }
  return s.replace(/[^\d]/g, "") || s;
}

// ---------- shared replies ----------

const replyUsePost = json({ ok: false, error: "Use POST" }, { status: 405 });

function fail(status, msg, extra = {}) {
  return json({ ok: false, error: msg, ...extra }, { status });
}

// ---------- loader (GET) ----------
// Keep GET simple & JSON so curl/jq never sees HTML.
export const loader = async () => replyUsePost;

// ---------- action (POST) ----------
export const action = async ({ request }) => {
  await verifyProxyIfPresent(request);
  const started = Date.now();
  const url = new URL(request.url);

  // Accept shop from query string OR header (Shopify sends x-shopify-shop-domain)
  const shop =
    url.searchParams.get("shop")?.trim() ||
    headerOrNull(request, "x-shopify-shop-domain");

  // PowerBuy ID is required (query string)
  const pbIdStr = url.searchParams.get("powerbuyId");
  const powerbuyId = pbIdStr ? Number(pbIdStr) : NaN;

  try {
    if (!shop) return fail(400, "Missing required field: shop");
    if (!powerbuyId || !Number.isFinite(powerbuyId)) {
      return fail(400, "Missing or invalid powerbuyId");
    }

    // Read body (JSON or form)
    const body = await readBody(request);
    const name = (body.name || "").trim();
    const email = (body.email || "").trim();
    const product_id = (body.product_id || "").trim();

    if (!name || !email) {
      const missing = [
        !name && "name",
        !email && "email"
      ]
        .filter(Boolean)
        .join(", ");
      return fail(400, `Missing required fields: ${missing}`);
    }

    // Load config row
    const pb = await prisma.tbl_powerbuy_config.findFirst({
      where: { id: powerbuyId },
    });
    if (!pb) return fail(404, `PowerBuy config ${powerbuyId} not found`);

    // Optional: restrict to certain stores (comma-separated domains)
    if (pb.allowed_stores) {
      const allowed = new Set(parseCsv(pb.allowed_stores).map((s) => s.toLowerCase()));
      if (allowed.size && !allowed.has(shop.toLowerCase())) {
        return fail(403, "Shop is not allowed for this PowerBuy", {
          shop,
          allowed: Array.from(allowed),
        });
      }
    }

    // Optional: ensure this product is eligible for this PowerBuy
    if (pb.powerbuy_product_id) {
      const configured = normalizeNumericId(pb.powerbuy_product_id);
      const incoming = normalizeNumericId(product_id);
      if (configured && incoming && configured !== incoming) {
        return fail(400, "This product is not eligible for this PowerBuy", {
          expected_product_id: configured,
          got_product_id: incoming,
        });
      }
    }

    // Reject duplicate ACTIVE (unexpired) or already CONFIRMED request
    const dup = await prisma.tbl_powerbuy_requests.findFirst({
      where: {
        powerbuy_id: powerbuyId,
        product_id: product_id,
        email: { equals: email, mode: "insensitive" },
        OR: [
          { confirmed_at: { not: null } },
          { AND: [{ confirmed_at: null }, { token_expires: { gt: new Date() } }] },
        ],
      },
      orderBy: [{ id: "desc" }],
    });
    if (dup) {
      return fail(409, "A request for this product/email already exists", {
        existing_id: dup.id,
        confirmed: !!dup.confirmed_at,
        token_expires: dup.token_expires,
      });
    }

    // Create a fresh request
    const token = makeToken(48);
    const ttlMs = parseDurationMs(pb.duration); // defaults to 24h
    const tokenExpires = new Date(Date.now() + ttlMs);

    const ip =
      headerOrNull(request, "x-forwarded-for") ||
      headerOrNull(request, "cf-connecting-ip") ||
      headerOrNull(request, "x-real-ip") ||
      "";

    const created = await prisma.tbl_powerbuy_requests.create({
      data: {
        name,
        email,
        product_id, // we operate on product IDs now (confirm route will also use product)
        powerbuy_id: powerbuyId,
        token,
        token_expires: tokenExpires,
        request_ip: ip,
      },
    });

    // Confirm URL (always include ?shop=...)
    const origin = requestOrigin(request);
    const confirmUrl = `${origin}/apps/powerbuy/confirm?token=${encodeURIComponent(
      token
    )}&shop=${encodeURIComponent(shop)}`;

    // Send the "confirm" link email (mailer honors override flags from config)
    let mailed = false;
    let mailError = null;
    try {
      await sendRequestEmail({
        powerbuyId,
        to: email,
        name,
        confirmUrl,
      });
      mailed = true;
    } catch (err) {
      mailError = err?.message || String(err);
    }

    return json({
      ok: true,
      id: created.id,
      mailed,
      mailError,
      confirmUrl,
      took_ms: Date.now() - started,
    });
  } catch (err) {
    console.error("[PowerBuy][request] 500:", err);
    return json(
      { ok: false, error: err?.message || "Unexpected Server Error" },
      { status: 500 }
    );
  }
};
