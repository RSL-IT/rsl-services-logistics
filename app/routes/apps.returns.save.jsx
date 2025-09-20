// /app/routes/apps.returns.save.jsx
// Token-required save endpoint used by the Admin UI extension.
// POST only. Responds to CORS preflight. No read-only bypass here.

import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";

// Reuse CORS policy (strict in prod; expanded in dev via env)
const BASE_ALLOWED = ["https://extensions.shopifycdn.com"]; // Admin runtime
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
  const allowOrigin = ALLOWED_ORIGINS.has(origin) ? origin : BASE_ALLOWED[0];
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Headers": "authorization,content-type",
    "Access-Control-Allow-Methods": "POST,OPTIONS",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  };
}

export async function loader({ request }) {
  const origin = request.headers.get("origin") || "";
  const CORS = corsHeadersFor(origin);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  return new Response(null, { status: 405, headers: CORS });
}

export async function action({ request, context, params }) {
  const origin = request.headers.get("origin") || "";
  const CORS = corsHeadersFor(origin);

  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (request.method !== "POST") return new Response(null, { status: 405, headers: CORS });

  // Require Bearer token (no trusted-origin bypass for writes)
  const authz = request.headers.get("authorization") || "";
  if (!authz.toLowerCase().startsWith("bearer ")) {
    return json({ error: "missing_bearer", detail: "POST requires Authorization: Bearer <token>." }, { status: 401, headers: CORS });
  }

  // Validate the Admin session
  try {
    await authenticate.admin(request);
  } catch (e) {
    return json({ error: "unauthorized", detail: String(e?.message || e) }, { status: 401, headers: CORS });
  }

  // Delegate to legacy save logic if present (apps.csd-entry.save.jsx)
  try {
    const Save = await import("./apps.csd-entry.save.jsx");
    if (typeof Save.action === "function") {
      const res = await Save.action({ request, context, params });
      const buf = await res.arrayBuffer();
      const headers = new Headers(res.headers);
      // Ensure CORS on outgoing response
      headers.set("Access-Control-Allow-Origin", corsHeadersFor(origin)["Access-Control-Allow-Origin"]);
      headers.set("Access-Control-Allow-Headers", "authorization,content-type");
      headers.set("Access-Control-Allow-Methods", "POST,OPTIONS");
      headers.set("Vary", "Origin");
      return new Response(buf, { status: res.status, headers });
    }
  } catch (e) {
    // If the legacy route isn't present, fall through to 501
  }

  return json(
    { error: "not_implemented", detail: "Add your save logic here or provide apps.csd-entry.save.jsx with an action export." },
    { status: 501, headers: CORS }
  );
}
