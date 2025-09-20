// /app/routes/apps.returns.lookups.jsx
// Returns lookup lists for the Admin UI extension dropdowns.
// GET /apps/returns/lookups?sets=returnTypes,troubleshootingCategories,primaryReasons
// Debug helpers:
//   • ?ping=1   -> 200 {ok:true} with CORS, no DB/auth
//   • ?schema=1 -> 200 {tables:[...]} listing public tables
//   • ?counts=1 -> 200 {counts:{...}, errors:{...}} per-table COUNT(*)
// Notes:
//   • Global auth bypass should be in app/root.jsx for this route path.
//   • This route never redirects to /auth/login; it returns CORS-safe 401 JSON instead.
//   • Read-only allowance: GETs from trusted Admin/Preview origins are permitted
//     even without a Bearer token.

import { json } from "@remix-run/node";
import { prisma } from "../db.server";
import { authenticate } from "../shopify.server";
import etag from "etag";

const VERSION = "v7";

// ---- CORS (Admin runtime, Preview, + your tunnel) ----
const ALLOWED_ORIGINS = new Set([
  "https://admin.shopify.com",
  "https://extensions.shopifycdn.com",                 // Admin UI extensions runtime
  "https://ui-extensions.shopifyapps.com",             // Preview
  "https://athletes-latino-expenses-dental.trycloudflare.com", // your CLI tunnel
]);

function corsHeadersFor(origin) {
  const allowOrigin = ALLOWED_ORIGINS.has(origin)
    ? origin
    : "https://admin.shopify.com";
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Headers": "authorization,content-type",
    "Access-Control-Allow-Methods": "GET,OPTIONS",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
    "X-Lookups-Version": VERSION,
  };
}

const ALLOW_INSECURE_LOOKUPS =
  process.env.ALLOW_INSECURE_LOOKUPS === "true" || false;

export async function loader({ request }) {
  const origin = request.headers.get("origin") || "";
  const CORS = corsHeadersFor(origin);
  const url = new URL(request.url);

  // 0) Debug: ping (proves deploy + CORS + routing)
  if (url.searchParams.get("ping") === "1") {
    return json({ ok: true, version: VERSION }, { headers: CORS });
  }

  // 1) Preflight
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }

  // 2) Debug: schema (list tables in public)
  if (url.searchParams.get("schema") === "1") {
    const rows = await prisma.$queryRaw`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      ORDER BY table_name
    `;
    return json(
      { version: VERSION, tables: rows.map((r) => r.table_name) },
      { headers: CORS }
    );
  }

  // 3) Debug: counts (try to count expected tables; report errors)
  if (url.searchParams.get("counts") === "1") {
    const targets = [
      `"tblkp_CsdReturnType"`,
      `"tblkp_CsdTroubleshootingNotes"`,
      `"tblkp_CsdPrimaryCustomerReportedReasonForReturnWarranty"`,
    ];
    const counts = {};
    const errors = {};
    for (const t of targets) {
      try {
        const [{ count }] = await prisma.$queryRawUnsafe(
          `SELECT COUNT(*)::int AS count FROM ${t};`
        );
        counts[t] = count;
      } catch (e) {
        errors[t] = String(e?.message || e);
      }
    }
    return json({ version: VERSION, counts, errors }, { headers: CORS });
  }

  // 4) Auth: only authenticate if a Bearer token is present.
  //    If no Bearer and request is a GET from a trusted extension origin,
  //    allow read-only access (lookups are non-sensitive).
  const authz = request.headers.get("authorization") || "";
  const hasBearer = authz.toLowerCase().startsWith("bearer ");
  const isGet = request.method === "GET";
  const isTrustedOrigin = ALLOWED_ORIGINS.has(origin);

  if (!hasBearer) {
    if (isGet && isTrustedOrigin) {
      // ✅ read-only allow for trusted Admin/Preview origin
    } else if (ALLOW_INSECURE_LOOKUPS) {
      // dev bypass (off in prod)
    } else {
      return json(
        {
          error: "missing_bearer",
          detail:
            "Provide Authorization: Bearer <token> from the Admin UI extension.",
          version: VERSION,
        },
        { status: 401, headers: CORS }
      );
    }
  } else {
    try {
      await authenticate.admin(request);
    } catch (e) {
      return json(
        {
          error: "unauthorized",
          detail: String(e?.stack || e?.message || e),
          version: VERSION,
        },
        { status: 401, headers: CORS }
      );
    }
  }

  // 5) Parse requested sets
  const sets = (url.searchParams.get("sets") || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const wantAll = sets.length === 0;

  // 6) Fetch data (catch per-set so one failure doesn't 500)
  const result = {};
  const perErrors = {};

  async function returnTypes() {
    try {
      const rows = await prisma.tblkp_CsdReturnType.findMany();
      return rows.map((r) => ({ id: r.id, label: r.value }));
    } catch (e) {
      perErrors.returnTypes = String(e?.message || e);
      return [];
    }
  }

  async function troubleshootingCategories() {
    try {
      const rows = await prisma.tblkp_CsdTroubleshootingNotes.findMany();
      return rows.map((r) => ({ id: r.id, label: r.value }));
    } catch (e) {
      perErrors.troubleshootingCategories = String(e?.message || e);
      return [];
    }
  }

  async function primaryReasons() {
    try {
      const rows =
        await prisma.tblkp_CsdPrimaryCustomerReportedReasonForReturnWarranty.findMany();
      return rows.map((r) => ({ id: r.id, label: r.value }));
    } catch (e) {
      perErrors.primaryReasons = String(e?.message || e);
      return [];
    }
  }

  if (wantAll || sets.includes("returnTypes"))
    result.returnTypes = await returnTypes();
  if (wantAll || sets.includes("troubleshootingCategories"))
    result.troubleshootingCategories = await troubleshootingCategories();
  if (wantAll || sets.includes("primaryReasons"))
    result.primaryReasons = await primaryReasons();

  if (Object.keys(perErrors).length) result._errors = perErrors;

  const body = result;
  return json(body, {
    headers: {
      "Cache-Control": "private, max-age=0, must-revalidate",
      ETag: etag(JSON.stringify(body)),
      ...CORS,
    },
  });
}

export async function action({ request }) {
  const origin = request.headers.get("origin") || "";
  const CORS = corsHeadersFor(origin);
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }
  return new Response(null, { status: 405, headers: CORS });
}
