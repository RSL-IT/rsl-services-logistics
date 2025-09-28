// app/routes/apps.returns.save.jsx
import { json } from "@remix-run/node";
import { prisma } from "../db.server";
import { authenticate } from "../shopify.server";

// Allow requests from Shopify Admin/Extensions
const ALLOWED_ORIGINS = new Set([
  "https://admin.shopify.com",
  "https://ui-extensions.shopifyapps.com",
  "https://extensions.shopifycdn.com",
]);

function cors(origin = "") {
  const allowOrigin = ALLOWED_ORIGINS.has(origin) ? origin : "https://admin.shopify.com";
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Headers": "authorization,content-type",
    "Access-Control-Allow-Methods": "POST,OPTIONS",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  };
}

// Optional: dev bypass (like your lookups route)
const ALLOW_INSECURE_RETURNS_SAVE =
  process.env.ALLOW_INSECURE_RETURNS_SAVE === "true";

export async function loader({ request }) {
  const CORS = cors(request.headers.get("origin") || "");
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  return new Response(null, { status: 405, headers: CORS });
}

export async function action({ request }) {
  const origin = request.headers.get("origin") || "";
  const CORS = cors(origin);

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }
  if (request.method !== "POST") {
    return new Response(null, { status: 405, headers: CORS });
  }

  // --- Auth: Admin UI extension session token (with optional dev bypass) ---
  try {
    const hasBearer = request.headers.get("authorization")?.toLowerCase().startsWith("bearer ");
    if (!hasBearer && !ALLOW_INSECURE_RETURNS_SAVE) {
      return json(
        {
          error: "missing_bearer",
          detail:
            "Provide Authorization: Bearer <token> from the Admin UI extension, or enable ALLOW_INSECURE_RETURNS_SAVE=true for dev.",
          version: "v1",
        },
        { status: 401, headers: CORS }
      );
    }
    if (hasBearer) {
      await authenticate.admin(request); // validates the Admin token (shop scope)
    }
  } catch (e) {
    return json({ error: "unauthorized", detail: String(e?.message || e) }, { status: 401, headers: CORS });
  }

  // --- Parse body ---
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid_json" }, { status: 400, headers: CORS });
  }

  // --- Helpers ---
  const toIntOrNull = (v) => {
    if (v === null || v === undefined || v === "") return null;
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? n : null;
  };
  const toStrOrNull = (v) => (v === null || v === undefined || v === "" ? null : String(v));

  // --- Accept both new + legacy client keys (compat shim) ---
  const data = {
    // FKs from dropdowns → existing columns in return_entry
    return_type_id: toIntOrNull(body.return_type_id ?? body.returnType),
    primary_customer_reason_id: toIntOrNull(
      body.primary_customer_reason_id ?? body.reason_category_id ?? body.primaryReason
    ),

    // Shopify identifiers & user → exact column names
    original_order_gid: toStrOrNull(body.original_order_gid ?? body.order_gid ?? body.orderGid),
    customer_gid: toStrOrNull(body.customer_gid),
    rsl_csr_gid: toStrOrNull(body.rsl_csr_gid ?? body.user_gid ?? body.userGid),

    // Business fields
    date_requested: new Date(), // store server time per your rule
    original_order: toStrOrNull(body.original_order ?? body.order_name ?? body.orderId),
    customer_name: toStrOrNull(body.customer_name),
    rsl_csr: toStrOrNull(body.rsl_csr ?? body.csrUsername),
    serial_number: toStrOrNull(body.serial_number ?? body.associatedSerialNumber),
  };

  // Optional: minimal validation (example)
  // if (!data.return_type_id && !data.primary_customer_reason_id) {
  //   return json({ error: "bad_request", detail: "Pick a Return Type or a Reason Category." }, { status: 400, headers: CORS });
  // }

  try {
    const created = await prisma.returnEntry.create({ data });
    return json({ ok: true, id: created.id }, { headers: CORS });
  } catch (e) {
    return json({ error: "db_error", detail: String(e?.message || e) }, { status: 500, headers: CORS });
  }
}
