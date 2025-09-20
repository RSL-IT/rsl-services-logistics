// /app/routes/apps.returns.lookups.jsx (v8)
import { json } from "@remix-run/node";
import { prisma } from "../db.server";
import { authenticate } from "../shopify.server";
import etag from "etag";

const VERSION = "v8";

// ---- CORS (strict in prod; expanded in dev via env) ----
const BASE_ALLOWED = [
  "https://extensions.shopifycdn.com", // Admin UI extensions runtime
];
const DEV_ALLOWED = [
  "https://admin.shopify.com",
  "https://ui-extensions.shopifyapps.com",
  "https://athletes-latino-expenses-dental.trycloudflare.com",
  ...(process.env.CORS_EXTRA_ORIGINS?.split(",").map((s) => s.trim()).filter(Boolean) ?? []),
];
const ALLOWED_ORIGINS = new Set(
  process.env.NODE_ENV === "production" ? BASE_ALLOWED : [...BASE_ALLOWED, ...DEV_ALLOWED]
);

function corsHeadersFor(origin) {
  const allowOrigin = ALLOWED_ORIGINS.has(origin)
    ? origin
    : BASE_ALLOWED[0];
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Headers": "authorization,content-type",
    "Access-Control-Allow-Methods": "GET,OPTIONS",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
    "X-Lookups-Version": VERSION,
  };
}

const ALLOW_INSECURE_LOOKUPS = process.env.ALLOW_INSECURE_LOOKUPS === "true" || false;

export async function loader({ request }) {
  const origin = request.headers.get("origin") || "";
  const CORS = corsHeadersFor(origin);
  const url = new URL(request.url);

  // Debug helpers available only in non-prod
  if (process.env.NODE_ENV !== "production" && url.searchParams.get("ping") === "1") {
    return json({ ok: true, version: VERSION }, { headers: CORS });
  }
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }
  if (process.env.NODE_ENV !== "production" && url.searchParams.get("schema") === "1") {
    const rows = await prisma.$queryRaw`
      SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name
    `;
    return json({ version: VERSION, tables: rows.map((r) => r.table_name) }, { headers: CORS });
  }
  if (process.env.NODE_ENV !== "production" && url.searchParams.get("counts") === "1") {
    const targets = [
      `"tblkp_CsdReturnType"`,
      `"tblkp_CsdTroubleshootingNotes"`,
      `"tblkp_CsdPrimaryCustomerReportedReasonForReturnWarranty"`,
    ];
    const counts = {}; const errors = {};
    for (const t of targets) {
      try {
        const [{ count }] = await prisma.$queryRawUnsafe(`SELECT COUNT(*)::int AS count FROM ${t};`);
        counts[t] = count;
      } catch (e) { errors[t] = String(e?.message || e); }
    }
    return json({ version: VERSION, counts, errors }, { headers: CORS });
  }

  // Auth: allow trusted-origin GETs without token; else require bearer (or dev bypass)
  const authz = request.headers.get("authorization") || "";
  const hasBearer = authz.toLowerCase().startsWith("bearer ");
  const isGet = request.method === "GET";
  const isTrustedOrigin = ALLOWED_ORIGINS.has(origin);

  if (!hasBearer) {
    if (isGet && isTrustedOrigin) {
      // read-only allow for trusted Admin/Preview origin
    } else if (ALLOW_INSECURE_LOOKUPS) {
      // dev bypass
    } else {
      return json(
        { error: "missing_bearer", detail: "Provide Authorization: Bearer <token> from the Admin UI extension.", version: VERSION },
        { status: 401, headers: CORS }
      );
    }
  } else {
    try { await authenticate.admin(request); }
    catch (e) {
      return json({ error: "unauthorized", detail: String(e?.stack || e?.message || e), version: VERSION }, { status: 401, headers: CORS });
    }
  }

  // Parse requested sets
  const sets = (url.searchParams.get("sets") || "").split(",").map((s) => s.trim()).filter(Boolean);
  const wantAll = sets.length === 0;

  // Fetch data (per-set error isolation)
  const result = {}; const perErrors = {};
  async function returnTypes() {
    try { const rows = await prisma.tblkp_CsdReturnType.findMany(); return rows.map((r) => ({ id: r.id, label: r.value })); }
    catch (e) { perErrors.returnTypes = String(e?.message || e); return []; }
  }
  async function troubleshootingCategories() {
    try { const rows = await prisma.tblkp_CsdTroubleshootingNotes.findMany(); return rows.map((r) => ({ id: r.id, label: r.value })); }
    catch (e) { perErrors.troubleshootingCategories = String(e?.message || e); return []; }
  }
  async function primaryReasons() {
    try { const rows = await prisma.tblkp_CsdPrimaryCustomerReportedReasonForReturnWarranty.findMany(); return rows.map((r) => ({ id: r.id, label: r.value })); }
    catch (e) { perErrors.primaryReasons = String(e?.message || e); return []; }
  }

  if (wantAll || sets.includes("returnTypes")) result.returnTypes = await returnTypes();
  if (wantAll || sets.includes("troubleshootingCategories")) result.troubleshootingCategories = await troubleshootingCategories();
  if (wantAll || sets.includes("primaryReasons")) result.primaryReasons = await primaryReasons();
  if (Object.keys(perErrors).length) result._errors = perErrors;

  // Conditional GET via ETag
  const body = result;
  const serverETag = etag(JSON.stringify(body));
  const clientETag = request.headers.get("if-none-match");
  if (clientETag && clientETag === serverETag) {
    return new Response(null, { status: 304, headers: { ...CORS, ETag: serverETag } });
  }

  return json(body, { headers: { "Cache-Control": "private, max-age=0, must-revalidate", ETag: serverETag, ...CORS } });
}

export async function action({ request }) {
  const origin = request.headers.get("origin") || "";
  const CORS = corsHeadersFor(origin);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  return new Response(null, { status: 405, headers: CORS });
}
