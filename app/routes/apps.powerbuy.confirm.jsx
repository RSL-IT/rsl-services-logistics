// app/routes/apps.powerbuy.confirm.jsx
import { prisma } from "../db.server.js";
import { json } from "@remix-run/node";
import { queuePowerbuyAcceptanceEmail } from "../services/shopify-email.server.js";

/** Helpers */
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

function ensureGid(type, idOrGid) {
  if (!idOrGid) return null;
  const s = String(idOrGid);
  if (s.startsWith("gid://shopify/")) return s;
  const n = (s.match(/(\d+)/) || [])[1];
  if (!n) return null;
  return `gid://shopify/${type}/${n}`;
}

export async function loader({ request }) {
  const url = new URL(request.url);
  const shop =
    url.searchParams.get("shop") ||
    request.headers.get("x-shopify-shop-domain") ||
    process.env.SHOPIFY_STORE_DOMAIN;
  const token = url.searchParams.get("token");

  if (!shop || !token) {
    return html(
      `<h1>Couldn’t confirm</h1><p>Missing <code>shop</code> or <code>token</code>.</p>`
    );
  }

  // Find the request + config
  const req = await prisma.tbl_powerbuy_requests.findUnique({
    where: { token },
    include: { powerbuy: true },
  });

  if (!req || !req.powerbuy) {
    return html(
      `<h1>Invalid or expired link</h1><p>We couldn’t find a pending request for that token.</p>`
    );
  }

  if (new Date(req.token_expires).getTime() < Date.now()) {
    return html(
      `<h1>Link expired</h1><p>Please submit the form again to receive a new confirmation link.</p>`
    );
  }

  // Idempotency: if already confirmed, do NOT mint another code
  if (req.confirmed_at) {
    return html(
      `<h1>Already confirmed</h1><p>You’ve already confirmed this request. Please check your email for your discount code.</p>`
    );
  }

  // Mark confirmed now (so re-clicks don’t double-issue codes)
  await prisma.tbl_powerbuy_requests.update({
    where: { token },
    data: { confirmed_at: new Date() },
  });

  // Call the generator (same host)
  let genJson;
  try {
    const genRes = await fetch(
      new URL(
        `/api/generate-discount-code?shop=${encodeURIComponent(shop)}`,
        url.origin
      ),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ powerbuyId: req.powerbuy_id }),
      }
    );

    const bodyText = await genRes.text();
    try {
      genJson = JSON.parse(bodyText);
    } catch {
      throw new Error(`Unexpected response: ${bodyText.slice(0, 500)}`);
    }

    if (!genRes.ok) {
      const detail =
        (genJson && (genJson.detail || genJson.error)) || genRes.statusText;
      throw new Error(String(detail));
    }
  } catch (e) {
    return html(
      `<h1>Couldn’t create your code</h1><p>Details: ${
        e?.message || String(e)
      }</p><p class="muted">Contact support if this keeps happening.</p>`
    );
  }

  // Compose acceptance email payload for Flow
  const cfg = req.powerbuy;
  const uses =
    typeof genJson?.rule?.usageLimit === "number"
      ? genJson.rule.usageLimit
      : null;

  // Prefer variant entitlement if present
  const variantId =
    genJson?.entitlements?.variantIds?.[0] != null
      ? ensureGid("ProductVariant", genJson.entitlements.variantIds[0])
      : null;
  const productId =
    !variantId && genJson?.entitlements?.productIds?.[0] != null
      ? ensureGid("Product", genJson.entitlements.productIds[0])
      : null;

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
    // Non-fatal: the code exists; tell user to contact support if the email doesn’t arrive
    return html(
      `<h1>You’re in!</h1>
       <p>Your discount code is <code>${genJson.code}</code>.</p>
       <p>We had trouble queuing your email (<em>${e?.message || e}</em>), but the code is valid right now.</p>
       <p class="muted">If the email doesn’t arrive, you can still use the code at checkout.</p>`
    );
  }

  return html(
    `<h1>You’re in!</h1>
     <p>We’ve queued your discount code and sent it to <strong>${req.email}</strong>.</p>
     <p class="muted">If it doesn’t arrive within a few minutes, check your spam folder or contact us.</p>`
  );
}

// Explicit 405 for POST/other methods; this route is confirmed via GET link
export function action() {
  return json({ error: "method_not_allowed" }, { status: 405 });
}
