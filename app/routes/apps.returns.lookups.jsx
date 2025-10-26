// /app/routes/apps.returns.lookups.jsx
import { json } from "@remix-run/node";
import { prisma } from "../db.server";
import { authenticate } from "~/shopify.server";

// CORS helpers
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  // expose for client-side error handling in extensions sandbox
  "Access-Control-Expose-Headers": "X-Shopify-API-Request-Failure-Reauthorize-Url",
};

export async function loader({ request }) {
  // CORS preflight
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const url = new URL(request.url);
  const setsParam = (url.searchParams.get("sets") || "").trim();
  const requested = setsParam
    ? setsParam.split(",").map((s) => s.trim()).filter(Boolean)
    : ["items", "returnTypes", "troubleshootingCategories", "primaryReasons"];

  const allowInsecure = process.env.ALLOW_INSECURE_LOOKUPS === "true";

  // Require Admin token unless bypass enabled
  if (!allowInsecure) {
    try {
      await authenticate.admin(request);
    } catch (err) {
      return json(
        {
          error: "missing_bearer",
          detail:
            "Provide Authorization: Bearer <token> from the Admin UI extension, or enable ALLOW_INSECURE_LOOKUPS=true for dev.",
          version: "v6",
        },
        { status: 401, headers: corsHeaders }
      );
    }
  }

  // Build the response object piecemeal based on requested sets
  const out = {};

  // Items from csd_item
  if (requested.includes("items")) {
    const rows = await prisma.$queryRaw`
      SELECT id, value AS label
      FROM csd_item
      ORDER BY value ASC, id ASC
    `;
    out.items = rows;
  }

  // Return types from csd_return_type
  if (requested.includes("returnTypes")) {
    const rows = await prisma.$queryRaw`
      SELECT id, value AS label
      FROM csd_return_type
      ORDER BY value ASC, id ASC
    `;
    out.returnTypes = rows;
  }

  // Troubleshooting categories from csd_troubleshooting_notes
  if (requested.includes("troubleshootingCategories")) {
    const rows = await prisma.$queryRaw`
      SELECT id, value AS label
      FROM csd_troubleshooting_notes
      ORDER BY value ASC, id ASC
    `;
    out.troubleshootingCategories = rows;
  }

  // Primary reasons from csd_primary_customer_reported_reason_for_return_warranty
  if (requested.includes("primaryReasons")) {
    const rows = await prisma.$queryRaw`
      SELECT id, value AS label
      FROM csd_primary_customer_reported_reason_for_return_warranty
      ORDER BY value ASC, id ASC
    `;
    out.primaryReasons = rows;
  }

  return json(out, { headers: corsHeaders });
}

// Also respond to OPTIONS explicitly (for some proxies)
export async function action({ request }) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  return json({ error: "method_not_allowed" }, { status: 405, headers: corsHeaders });
}
