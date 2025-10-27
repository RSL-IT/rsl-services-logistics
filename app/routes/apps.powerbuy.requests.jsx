// app/routes/apps.powerbuy.requests.jsx
import { json } from "@remix-run/node";
import prisma from "../db.server.js";
import { runAdminQuery } from "../shopify-admin.server.js";
import {
  ensureVariantGid,
  toNumericId,
  listToNumericIds,
} from "../utils/shopify-gid.js";
import { queuePowerbuyConfirmationEmail } from "../services/shopify-email.server.js";

// --- helpers ---------------------------------------------------------------

function getClientIp(request) {
  const xf = request.headers.get("x-forwarded-for");
  if (xf) return xf.split(",")[0].trim();
  const fly = request.headers.get("fly-client-ip");
  if (fly) return fly;
  return undefined;
}

function nowPlusHours(h) {
  const d = new Date();
  d.setHours(d.getHours() + h);
  return d;
}

/**
 * Find most recent "active" config for this shop:
 * - allowed_stores contains the shop (or is null)
 * - within time window (start <= now <= end, with nulls allowed)
 */
async function findActiveConfig(shop) {
  const now = new Date();
  return prisma.tbl_powerbuy_config.findFirst({
    where: {
      AND: [
        {
          OR: [
            { allowed_stores: null },
            { allowed_stores: { contains: shop } },
          ],
        },
        {
          OR: [{ start_time: null }, { start_time: { lte: now } }],
        },
        {
          OR: [{ end_time: null }, { end_time: { gte: now } }],
        },
      ],
    },
    orderBy: { id: "desc" },
  });
}

/** Throw a JSON error with status */
function boom(detail, status = 400, error = "bad_request") {
  throw json({ error, detail }, { status });
}

// --- Remix loader/action ---------------------------------------------------

export async function loader() {
  // Method not allowed for GET on this API route
  return json({ error: "method_not_allowed" }, { status: 405 });
}

export async function action({ request }) {
  if (request.method.toUpperCase() !== "POST") {
    return json({ error: "method_not_allowed" }, { status: 405 });
  }

  // shop is required to use the Admin API and select config
  const url = new URL(request.url);
  const shop = url.searchParams.get("shop");
  if (!shop) boom("Missing shop param.", 400, "missing_shop");

  let body;
  try {
    body = await request.json();
  } catch {
    boom("Invalid JSON body.", 400, "invalid_json");
  }

  const name = String(body?.name ?? "").trim();
  const email = String(body?.email ?? "").trim().toLowerCase();
  const rawVariant = body?.variant_id ?? null; // may be numeric or gid
  const rawProduct = body?.product_id ?? null; // may be numeric or gid
  const captchaToken = body?.captcha_token ?? null;
  const marketingOptIn = !!body?.marketing_opt_in;

  if (!name || !email) boom("Missing name or email.", 422, "missing_fields");
  if (!rawVariant && !rawProduct) {
    boom("Provide variant_id or product_id.", 422, "missing_fields");
  }

  // Simple dev bypass for captcha
  if (process.env.NODE_ENV === "production") {
    // TODO: add real verification here when you’re ready
    if (!captchaToken) boom("Captcha is required.", 422, "captcha_required");
  }

  // Locate an active config for this shop
  const config = await findActiveConfig(shop);
  if (!config) boom("No active Powerbuy config for this shop.", 404, "no_active_config");

  // If config restricts to specific variants, enforce that.
  const allowedVariantNums = listToNumericIds(config.powerbuy_variant_ids ?? "");
  const hasVariantRestriction = allowedVariantNums.length > 0;

  // Determine numeric product id to store in DB.
  // If a variant was provided, resolve its parent product via Admin GraphQL.
  let numericProductId = null;
  let numericVariantId = null;

  if (rawVariant) {
    const variantGid = ensureVariantGid(rawVariant);
    if (!variantGid) boom("variant_id must be a number or a valid Shopify GID.", 422, "invalid_variant_id");

    // Enforce restriction if present
    numericVariantId = toNumericId(rawVariant);
    if (hasVariantRestriction && !allowedVariantNums.includes(numericVariantId)) {
      boom("This variant is not offered in the current Powerbuy.", 422, "variant_not_offered");
    }

    // Resolve parent product
    const query = `#graphql
      query ($id: ID!) {
        productVariant(id: $id) {
          id
          product { id title }
        }
      }`;
    const res = await runAdminQuery(shop, query, { id: variantGid });
    const productGid = res?.body?.data?.productVariant?.product?.id;
    if (!productGid) boom("Unable to resolve product for variant.", 422, "variant_lookup_failed");
    numericProductId = toNumericId(productGid);
  } else {
    // Only product provided
    numericProductId = toNumericId(rawProduct);
    if (!numericProductId) boom("product_id must be a number or a valid Shopify GID.", 422, "invalid_product_id");

    // If config is variant-scoped, require a variant on request (keeps intent explicit)
    if (hasVariantRestriction) {
      boom("This Powerbuy targets specific variants. Please submit variant_id.", 422, "variant_required");
    }

    // If config specifies a single product, optionally enforce it
    const configuredProductNum = toNumericId(config.powerbuy_product_id ?? "");
    if (configuredProductNum && configuredProductNum !== numericProductId) {
      boom("This product is not offered in the current Powerbuy.", 422, "product_not_offered");
    }
  }

  // Issue token & expiration (24h, clamped to config end_time if sooner)
  const token = crypto.randomUUID();
  let tokenExpires = nowPlusHours(24);
  if (config.end_time && tokenExpires > config.end_time) tokenExpires = new Date(config.end_time);

  // Upsert request by (email + powerbuy_id)
  const requestIp = getClientIp(request);
  const existing = await prisma.tbl_powerbuy_requests.findFirst({
    where: { email, powerbuy_id: config.id },
  });

  const dataPatch = {
    name,
    email,
    product_id: String(numericProductId), // store numeric only
    powerbuy_id: config.id,
    token,
    token_expires: tokenExpires,
    request_ip: requestIp ?? null,
  };

  let row;
  if (existing) {
    row = await prisma.tbl_powerbuy_requests.update({
      where: { id: existing.id },
      data: dataPatch,
    });
  } else {
    row = await prisma.tbl_powerbuy_requests.create({ data: dataPatch });
  }

  // Build confirm URL
  const confirmUrl = new URL("/apps/powerbuy/confirm", request.url);
  confirmUrl.searchParams.set("token", token);
  confirmUrl.searchParams.set("shop", shop);

  // Prepare an offer title for the email (fallback to config title or product id)
  const offerTitle =
    config.title ||
    (numericVariantId ? `Variant #${numericVariantId}` : `Product #${numericProductId}`);

  // Queue the Shopify Flow-based confirmation email
  await queuePowerbuyConfirmationEmail({
    shop,
    email,
    firstName: name.split(" ")[0] ?? "",
    lastName: name.split(" ").slice(1).join(" ") ?? "",
    confirmUrl: confirmUrl.toString(),
    powerbuyId: config.id,
    offerTitle,
    marketingOptIn,
  });

  return json({
    status: "ok",
    request_id: row.id,
    powerbuy_id: config.id,
    // include for debugging in dev
    ...(process.env.NODE_ENV !== "production"
      ? { token, confirm_url: confirmUrl.toString() }
      : {}),
  });
}
