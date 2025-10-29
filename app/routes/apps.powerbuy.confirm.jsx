// app/routes/apps.powerbuy.confirm.jsx
import { prisma } from "../db.server.js";
import { json } from "@remix-run/node";
import { queuePowerbuyAcceptanceEmail } from "../services/shopify-email.server.js";

/** ---------- small helpers ---------- */
function html(body) {
  return new Response(
    `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charSet="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>Powerbuy</title>
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
  <body><div class="card">${body}</div></body>
</html>`,
    { headers: { "Content-Type": "text/html; charset=utf-8" } }
  );
}

function wantsJSON(request) {
  const url = new URL(request.url);
  const fmt = (url.searchParams.get("format") || "").toLowerCase();
  if (fmt === "json") return true;
  const accept = request.headers.get("accept") || "";
  return accept.includes("application/json");
}

function ensureGid(type, idOrGid) {
  if (!idOrGid) return null;
  const s = String(idOrGid);
  if (s.startsWith("gid://shopify/")) return s;
  const n = (s.match(/(\d+)/) || [])[1];
  if (!n) return null;
  return `gid://shopify/${type}/${n}`;
}

/** ---------- GET /apps/powerbuy/confirm ---------- */
export async function loader({ request }) {
  const url = new URL(request.url);
  const shop =
    url.searchParams.get("shop") ||
    request.headers.get("x-shopify-shop-domain") ||
    process.env.SHOPIFY_STORE_DOMAIN;
  const token = url.searchParams.get("token");
  const asJSON = wantsJSON(request);

  const send = (title, details, status = 200, extra = {}) =>
    asJSON
      ? json({ title, details, ...extra }, { status })
      : html(
        `<h1>${title}</h1>${
          details ? `<p>${details}</p>` : ``
        }${extra.note ? `<p class="muted">${extra.note}</p>` : ""}`
      );

  if (!shop || !token) {
    return send(
      "Couldn’t confirm",
      `Missing <code>shop</code> or <code>token</code>.`,
      400
    );
  }

  // Find the request + related config
  const req = await prisma.tbl_powerbuy_requests.findUnique({
    where: { token }, // assumes token is UNIQUE in schema
    include: { powerbuy: true },
  });

  if (!req || !req.powerbuy) {
    return send(
      "Invalid or expired link",
      "We couldn’t find a pending request for that token.",
      404
    );
  }

  if (req.token_expires && new Date(req.token_expires).getTime() < Date.now()) {
    return send(
      "Link expired",
      "Please submit the form again to receive a new confirmation link.",
      410
    );
  }

  // Idempotency: if already confirmed, do NOT mint another code
  if (req.confirmed_at) {
    return send(
      "Already confirmed",
      "You’ve already confirmed this request. Please check your email for your discount code."
    );
  }

  // Mark confirmed now (so re-clicks don’t double-issue codes)
  await prisma.tbl_powerbuy_requests.update({
    where: { token },
    data: { confirmed_at: new Date() },
  });

  // Call the internal generator via POST; also forward shop by header + query
  let genJson;
  try {
    const genRes = await fetch(
      new URL(
        `/api/generate-discount-code?shop=${encodeURIComponent(shop)}`,
        url.origin
      ),
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // Some handlers rely on this header to locate the offline session:
          "x-shopify-shop-domain": shop,
          "Accept": "application/json",
        },
        body: JSON.stringify({ powerbuyId: req.powerbuy_id }),
      }
    );

    const bodyText = await genRes.text();
    let parsed = null;
    try {
      parsed = JSON.parse(bodyText);
    } catch {
      // Fall back to status text / raw body
    }

    if (!genRes.ok) {
      const detail =
        (parsed && (parsed.detail || parsed.error)) ||
        genRes.statusText ||
        `Unexpected response: ${bodyText.slice(0, 500)}`;
      throw new Error(String(detail));
    }

    genJson = parsed ?? { raw: bodyText };
  } catch (e) {
    return send(
      "Couldn’t create your code",
      `Details: ${e?.message || String(e)}`,
      502,
      { note: "Contact support if this keeps happening." }
    );
  }

  // Compose acceptance email payload
  const cfg = req.powerbuy;
  const uses =
    typeof genJson?.rule?.usageLimit === "number" ? genJson.rule.usageLimit : null;

  // Prefer variant entitlement if present; else product
  const variantId =
    genJson?.entitlements?.variantIds?.[0] != null
      ? ensureGid("ProductVariant", genJson.entitlements.variantIds[0])
      : null;
  const productId =
    !variantId && genJson?.entitlements?.productIds?.[0] != null
      ? ensureGid("Product", genJson.entitlements.productIds[0])
      : null;

  // Queue the acceptance email (non-fatal if this step fails)
  try {
    await queuePowerbuyAcceptanceEmail({
      shop,
      email: req.email,
      firstName: req.name,
      lastName: "",
      discountCode: genJson.code,
      startsAtISO: genJson.startsAt,
      endsAtISO: genJson.endsAt,
      uses,
      productId: variantId || productId || null,
      shortDescription: cfg.short_description || cfg.title || "Powerbuy",
      longDescription: cfg.long_description || "",
      contactEmail: cfg.rsl_contact_email_address || "",
    });
  } catch (e) {
    return send(
      "You’re in!",
      `Your discount code is <code>${genJson.code}</code>.<br/>` +
      `We had trouble queuing your email (<em>${e?.message || e}</em>), ` +
      `but the code is valid right now.`,
      200,
      { note: "If the email doesn’t arrive, you can still use the code at checkout." }
    );
  }

  return send(
    "You’re in!",
    `We’ve queued your discount code and sent it to <strong>${req.email}</strong>.`,
    200,
    { note: "If it doesn’t arrive within a few minutes, check your spam folder or contact us." }
  );
}

/** Explicit 405 for POST/other methods; this route is confirmed via GET link */
export function action() {
  return json({ error: "method_not_allowed" }, { status: 405 });
}
