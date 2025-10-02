// /app/routes/apps.returns.save.jsx
import { json } from "@remix-run/node";
import { prisma } from "../db.server";
import { authenticate } from "../shopify.server";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Expose-Headers": "X-Shopify-API-Request-Failure-Reauthorize-Url",
};

export async function loader({ request }) {
  // Allow preflight to succeed
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  return json({ error: "method_not_allowed" }, { status: 405, headers: corsHeaders });
}

export async function action({ request }) {
  // CORS preflight
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (request.method !== "POST") {
    return json({ error: "method_not_allowed" }, { status: 405, headers: corsHeaders });
  }

  // In dev you can bypass auth by setting ALLOW_INSECURE_SAVE=true
  const allowInsecure = process.env.ALLOW_INSECURE_SAVE === "true";
  if (!allowInsecure) {
    try {
      await authenticate.admin(request);
    } catch {
      return json(
        { error: "missing_bearer", detail: "POST requires Authorization: Bearer <token>." },
        { status: 401, headers: corsHeaders }
      );
    }
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "bad_json" }, { status: 400, headers: corsHeaders });
  }

  // Helper casts
  const toIntOrNull = (v) => {
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? n : null;
  };
  const nul = (v) => (v === undefined || v === "" ? null : v);

  // Expected payload from the extension
  const payload = {
    // FK ints
    item_id: toIntOrNull(body.item_id),
    return_type_id: toIntOrNull(body.return_type_id),
    primary_customer_reason_id: toIntOrNull(body.primary_customer_reason_id),

    // Shopify GIDs
    original_order_gid: nul(body.original_order_gid),
    customer_gid: nul(body.customer_gid),
    rsl_csr_gid: nul(body.rsl_csr_gid),

    // Business fields
    original_order: nul(body.original_order),
    customer_name: nul(body.customer_name),
    rsl_csr: nul(body.rsl_csr),
    serial_number: nul(body.serial_number),
  };

  try {
    // Use SQL so we don't depend on Prisma model naming; returns the created id
    const [created] = await prisma.$queryRaw`
      INSERT INTO return_entry (
        date_requested,
        original_order,
        original_order_gid,
        customer_name,
        customer_gid,
        item_id,
        return_type_id,
        primary_customer_reason_id,
        rsl_csr,
        rsl_csr_gid,
        serial_number
      )
      VALUES (
        CURRENT_DATE,
        ${payload.original_order},
        ${payload.original_order_gid},
        ${payload.customer_name},
        ${payload.customer_gid},
        ${payload.item_id},
        ${payload.return_type_id},
        ${payload.primary_customer_reason_id},
        ${payload.rsl_csr},
        ${payload.rsl_csr_gid},
        ${payload.serial_number}
      )
      RETURNING id
    `;

    return json({ ok: true, id: created?.id ?? null }, { headers: corsHeaders });
  } catch (e) {
    // Surface constraint/foreign key issues clearly
    return json(
      { ok: false, error: "insert_failed", detail: String(e?.message || e) },
      { status: 500, headers: corsHeaders }
    );
  }
}
