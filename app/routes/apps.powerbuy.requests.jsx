// app/routes/api.powerbuy.requests.js
import { prisma } from "~/db.server";
import { sendRequestEmail } from "~/services/mailer.server";

// ---------- tiny helpers ----------
function wantsJSON(request) {
  const acc = (request.headers.get("accept") || "").toLowerCase();
  const remixData = (request.headers.get("x-remix-data") || "").toLowerCase();
  return acc.includes("application/json") || remixData === "yes";
}
function jsonRes(request, body, status = 200) {
  // Always JSON for this API route.
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}
function getShop(request, url) {
  const shop =
    request.headers.get("x-shopify-shop-domain") || url.searchParams.get("shop");
  if (!shop) throw new Error("Missing shop");
  return shop.trim();
}
async function readBody(request) {
  const ct = (request.headers.get("content-type") || "").toLowerCase();
  if (ct.includes("application/json")) {
    try {
      return await request.json();
    } catch {
      // Let caller decide status; or:
      throw new Error("Invalid JSON body"); // your action maps this to a JSON error
    }
  }
  const fd = await request.formData();
  const out = {};
  for (const [k, v] of fd.entries()) out[k] = typeof v === "string" ? v : String(v);
  return out;
}
function token(len = 48) {
  const a = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_";
  let s = "";
  for (let i = 0; i < len; i++) s += a[Math.floor(Math.random() * a.length)];
  return s;
}
function clientIP(request) {
  return (
    request.headers.get("Fly-Client-IP") ||
    request.headers.get("x-forwarded-for") ||
    request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-real-ip") ||
    ""
  );
}
const TTL_MS = 24 * 60 * 60 * 1000; // 24h

// ---------- loader/action ----------
export const loader = async ({ request }) => {
  return jsonRes(request, { ok: false, error: "Use POST" }, 405);
};

export const action = async ({ request }) => {
  try {
    const url = new URL(request.url);
    const shop = getShop(request, url);

    const powerbuyId = Number(url.searchParams.get("powerbuyId") || "");
    if (!powerbuyId) {
      return jsonRes(request, { ok: false, error: "Missing powerbuyId" }, 400);
    }

    const body = await readBody(request);
    const name = (body.name || "").trim();
    const email = (body.email || "").trim();
    const variant_id = (body.variant_id || body.variantId || "").trim();

    if (!name || !email || !variant_id) {
      return jsonRes(
        request,
        { ok: false, error: "Missing required fields: name, email, variant_id" },
        400
      );
    }

    // Reject duplicates: same email+variant+powerbuy if active (unexpired) or confirmed.
    const now = new Date();
    const existing = await prisma.tbl_powerbuy_requests.findFirst({
      where: {
        powerbuy_id: powerbuyId,
        email,
        product_id: variant_id,
        OR: [{ confirmed_at: { not: null } }, { token_expires: { gte: now } }],
      },
    });
    if (existing) {
      return jsonRes(request, {
        ok: false,
        error:
          "A PowerBuy request for this email and variant is already active or has been confirmed.",
      }, 409);
    }

    // Create request row
    const tok = token();
    const token_expires = new Date(Date.now() + TTL_MS);
    const reqIP = clientIP(request);

    const rec = await prisma.tbl_powerbuy_requests.create({
      data: {
        name,
        email,
        product_id: variant_id, // storing variant_id in product_id
        powerbuy_id: powerbuyId,
        token: tok,
        token_expires,
        request_ip: reqIP,
      },
    });

    // Confirm URL (include shop)
    const confirmUrl = new URL("/apps/powerbuy/confirm", url.origin);
    confirmUrl.searchParams.set("token", tok);
    confirmUrl.searchParams.set("shop", shop);

    // Send request email; don't fail the request if mail errors.
    let mailed = false;
    let mailError = null;
    try {
      await sendRequestEmail({
        powerbuyId,
        to: email,
        name,
        confirmUrl: confirmUrl.toString(),
      });
      mailed = true;
    } catch (err) {
      mailError = String(err?.message || err);
      console.error("[PowerBuy][request] sendRequestEmail failed:", mailError);
    }

    return jsonRes(request, {
      ok: true,
      id: rec.id,
      mailed,
      mailError,
      confirmUrl: confirmUrl.toString(),
      name,
      email,
      variant_id,
      shop,
      token_expires: token_expires.toISOString(),
    });
  } catch (err) {
    console.error("[PowerBuy][request] 500:", err);
    return jsonRes(request, { ok: false, error: String(err?.message || err) }, 500);
  }
};

export const handle = { isApi: true };
