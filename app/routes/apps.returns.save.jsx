// /app/routes/apps.returns.save.jsx
import { json } from "@remix-run/node";
import { prisma } from "../db.server";
import { authenticate } from "../shopify.server";

// ---- helpers ----
const ALLOWED_ORIGINS = new Set([
  "https://admin.shopify.com",
  "https://ui-extensions.shopifyapps.com",
  "https://extensions.shopifycdn.com",
]);

const isTrue = (v) => /^(true|1|yes|y|on)$/i.test(String(v || "").trim());

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

export async function loader({ request }) {
  const CORS = cors(request.headers.get("origin") || "");
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  return new Response(null, { status: 405, headers: CORS });
}

export async function action({ request }) {
  const origin = request.headers.get("origin") || "";
  const CORS = cors(origin);

  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (request.method !== "POST") return new Response(null, { status: 405, headers: CORS });

  // ---- auth mode detection ----
  const authz = request.headers.get("authorization") || "";
  const hasBearer = authz.toLowerCase().startsWith("bearer ");
  const ALLOW_INSECURE_RETURNS_SAVE = isTrue(process.env.ALLOW_INSECURE_RETURNS_SAVE);

  // Optional debug: shows up in logs
  console.log("RETURNS_SAVE auth:", {
    hasBearer,
    ALLOW_INSECURE_RETURNS_SAVE,
    origin,
  });

  // If no bearer and bypass is not enabled -> 401
  if (!hasBearer && !ALLOW_INSECURE_RETURNS_SAVE) {
    return json(
      {
        error: "missing_bearer",
        detail: "POST requires Authorization: Bearer <token>.",
        hint: "Enable ALLOW_INSECURE_RETURNS_SAVE=true for dev, or open in real Admin.",
        saw: { hasBearer, ALLOW_INSECURE_RETURNS_SAVE },
      },
      { status: 401, headers: CORS }
    );
  }

  // Try to hydrate Admin context if a bearer was provided
  let admin = null;
  if (hasBearer) {
    try {
      const auth = await authenticate.admin(request);
      admin = auth?.admin || null;
    } catch (e) {
      return json(
        { error: "unauthorized", detail: String(e?.message || e) },
        { status: 401, headers: CORS }
      );
    }
  }

  // ---- parse body ----
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid_json" }, { status: 400, headers: CORS });
  }

  const toIntOrNull = (v) => {
    if (v === null || v === undefined || v === "") return null;
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? n : null;
  };
  const toStrOrNull = (v) => (v === null || v === undefined || v === "" ? null : String(v));

  // ---- build record ----
  const data = {
    // FKs
    return_type_id: toIntOrNull(body.return_type_id ?? body.returnType),
    primary_customer_reason_id: toIntOrNull(
      body.primary_customer_reason_id ?? body.reason_category_id ?? body.primaryReason
    ),

    // Shopify identifiers (GIDs)
    original_order_gid: toStrOrNull(body.original_order_gid ?? body.order_gid ?? body.orderGid),
    customer_gid: toStrOrNull(body.customer_gid),
    rsl_csr_gid: toStrOrNull(body.rsl_csr_gid ?? body.user_gid ?? body.userGid),

    // Business fields
    date_requested: new Date(), // server time
    original_order: toStrOrNull(body.original_order ?? body.order_name ?? body.orderId),
    customer_name: toStrOrNull(body.customer_name),
    rsl_csr: toStrOrNull(body.rsl_csr ?? body.csrUsername),
    serial_number: toStrOrNull(body.serial_number ?? body.associatedSerialNumber),
  };

  // ---- server-side CSR fallback if we do have Admin but CSR fields missing ----
  if (admin && (!data.rsl_csr || !data.rsl_csr_gid)) {
    try {
      const resp = await admin.graphql(`
        query CurrentUserForServer {
          currentUser {
            id
            displayName
            firstName
            lastName
            email
          }
        }
      `);
      const j = await resp.json();
      const u = j?.data?.currentUser;
      if (u) {
        data.rsl_csr_gid = data.rsl_csr_gid ?? u.id ?? null;
        data.rsl_csr =
          data.rsl_csr ??
          (u.displayName ||
            [u.firstName, u.lastName].filter(Boolean).join(" ") ||
            u.email ||
            null);
      }
    } catch {
      // ignore; keep whatever we have
    }
  }

  try {
    const created = await prisma.returnEntry.create({ data });
    return json(
      {
        ok: true,
        id: created.id,
        debug: DEBUG_RESPONSE(), // remove later if you prefer
      },
      { headers: CORS }
    );
  } catch (e) {
    return json({ error: "db_error", detail: String(e?.message || e) }, { status: 500, headers: CORS });
  }

  function DEBUG_RESPONSE() {
    // minimal, non-sensitive echo to help you confirm behavior
    return {
      hadBearer: hasBearer,
      bypass: ALLOW_INSECURE_RETURNS_SAVE,
      csrIncludedFromClient: Boolean(body.rsl_csr || body.userGid || body.rsl_csr_gid),
    };
  }
}
