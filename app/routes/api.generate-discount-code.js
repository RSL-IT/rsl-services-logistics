// app/routes/api.generate-discount-code.js
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import crypto from "node:crypto";

// Uppercase, checkout-friendly code (no 0/O or 1/I)
function makeCode({ prefix = "", length = 10 } = {}) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < length; i++) {
    out += alphabet[crypto.randomInt(0, alphabet.length)];
  }
  return (prefix + out).toUpperCase();
}

export const action = async ({ request }) => {
  if (request.method !== "POST") return json({ error: "Use POST" }, { status: 405 });

  // Must be a logged-in Shopify Admin user of *your* shop (staff-only)
  const { admin, session } = await authenticate.admin(request);

  // Extra belt-and-suspenders: restrict to your shop
  const allowedShop = /(^|\.)(rslspeakers)\.(myshopify\.com|com)$/i;
  if (!allowedShop.test(session.shop)) {
    return json({ error: "Forbidden: wrong shop" }, { status: 403 });
  }

  // Parse inputs (JSON or form-data)
  const ct = request.headers.get("content-type") || "";
  let priceRuleId, expiresAt, usageLimit, prefix, length;
  if (ct.includes("application/json")) {
    const b = await request.json();
    priceRuleId = Number(b.priceRuleId ?? b.price_rule_id);
    expiresAt   = b.expiresAt ?? b.endsAt ?? b.expiry ?? b.expires_at ?? b.ends_at;
    usageLimit  = Number(b.usageLimit ?? b.usage_limit);
    prefix      = b.prefix;
    length      = b.length ? Number(b.length) : undefined;
  } else {
    const fd = await request.formData();
    priceRuleId = Number(fd.get("priceRuleId") ?? fd.get("price_rule_id"));
    expiresAt   = fd.get("expiresAt") ?? fd.get("endsAt") ?? fd.get("expiry") ?? fd.get("expires_at") ?? fd.get("ends_at");
    usageLimit  = Number(fd.get("usageLimit") ?? fd.get("usage_limit"));
    prefix      = fd.get("prefix") ?? undefined;
    length      = fd.get("length") ? Number(fd.get("length")) : undefined;
  }

  // Validate required fields
  if (!priceRuleId) return json({ error: "priceRuleId is required" }, { status: 400 });
  if (!expiresAt)  return json({ error: "expiresAt (ISO8601) is required" }, { status: 400 });
  if (!Number.isInteger(usageLimit) || usageLimit < 1) {
    return json({ error: "usageLimit must be a positive integer" }, { status: 400 });
  }
  const dt = new Date(expiresAt);
  if (isNaN(dt.getTime())) {
    return json({ error: "expiresAt must be a valid ISO8601 datetime" }, { status: 400 });
  }

  // 1) Update the Price Rule's expiry & usage limit (rule-level settings)
  try {
    const pr = new admin.rest.resources.PriceRule({ session });
    pr.id = priceRuleId;
    pr.ends_at = dt.toISOString();
    pr.usage_limit = usageLimit;
    await pr.save({ update: true });
  } catch (e) {
    return json(
      {
        error:
          e?.response?.body?.errors ??
          e?.message ??
          "Failed to update price rule (ends_at / usage_limit)",
      },
      { status: 422 }
    );
  }

  // 2) Create a random code under the Price Rule, retry on collisions
  let lastErr;
  for (let attempt = 0; attempt < 6; attempt++) {
    const code = makeCode({ prefix, length });
    try {
      const dc = new admin.rest.resources.DiscountCode({ session });
      dc.price_rule_id = priceRuleId;
      dc.code = code;
      await dc.save(); // create

      return json(
        {
          code: dc.code,
          discountCodeId: dc.id,
          priceRuleId,
          expiresAt: dt.toISOString(),
          usageLimit,
        },
        { status: 201 }
      );
    } catch (e) {
      const body = e?.response?.body ?? {};
      const text = typeof body === "string" ? body : JSON.stringify(body);
      if (e?.response?.status === 422 && /must be unique/i.test(text)) {
        lastErr = e; // collision -> try again
        continue;
      }
      lastErr = e;
      break;
    }
  }

  return json(
    {
      error:
        lastErr?.response?.body?.errors ??
        lastErr?.message ??
        "Failed to create discount code",
    },
    { status: 500 }
  );
};

export const loader = () => new Response("Method Not Allowed", { status: 405 });
