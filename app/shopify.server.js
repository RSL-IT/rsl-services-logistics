// app/shopify.server.js
import { shopifyApp } from "@shopify/shopify-app-remix/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import { prisma } from "./db.server";

// ---------------- Env helpers ----------------
const scopesFromEnv =
  process.env.SHOPIFY_API_SCOPES || process.env.SCOPES || "";

function assertEnv() {
  const present = {
    SHOPIFY_API_KEY: !!process.env.SHOPIFY_API_KEY,
    SHOPIFY_API_SECRET: !!process.env.SHOPIFY_API_SECRET,
    SHOPIFY_APP_URL: !!process.env.SHOPIFY_APP_URL,
    SHOPIFY_API_SCOPES: !!process.env.SHOPIFY_API_SCOPES || !!process.env.SCOPES,
  };
  // Safe debug (values not printed)
  console.log("Shopify env presence check", present);

  if (!present.SHOPIFY_API_KEY || !present.SHOPIFY_API_SECRET) {
    throw new Error("Missing SHOPIFY_API_KEY and/or SHOPIFY_API_SECRET.");
  }
  if (!present.SHOPIFY_APP_URL) {
    throw new Error("Missing SHOPIFY_APP_URL.");
  }
  if (!present.SHOPIFY_API_SCOPES) {
    throw new Error("Missing SHOPIFY_API_SCOPES (or SCOPES).");
  }
}

// --------------- Lazy singleton --------------
let _shopify;

/**
 * Return the single initialized Shopify app instance.
 * We return the FULL app object so callers can access:
 *   - login()
 *   - authenticate.admin / authenticate.public
 *   - addDocumentResponseHeaders()
 */
export function getShopify() {
  if (!_shopify) {
    assertEnv();

    _shopify = shopifyApp({
      apiKey: process.env.SHOPIFY_API_KEY,
      apiSecretKey: process.env.SHOPIFY_API_SECRET,
      appUrl: process.env.SHOPIFY_APP_URL,
      scopes: scopesFromEnv, // comma-separated string is fine
      sessionStorage: new PrismaSessionStorage(prisma),
      // hooks: { ... } // add any webhooks if/when you need them
      // restResources: ... // if you use typed REST resources
    });
  }
  return _shopify;
}

// --------------- Headers helper --------------
/**
 * Remix expects:
 *   export const headers = addDocumentResponseHeaders;
 * This wrapper works across library versions (old/new).
 */
export const addDocumentResponseHeaders = (args) => {
  const s = getShopify();
  if (!s?.addDocumentResponseHeaders) {
    // Fallback: return empty headers if the helper doesn't exist
    return new Headers();
  }

  // Newer versions return headers from a single-arg function
  try {
    const out = s.addDocumentResponseHeaders(args);
    if (out) return out;
  } catch {
    // ignore and try legacy below
  }

  // Legacy: (args, headers) mutates the provided Headers
  try {
    const headers = new Headers();
    s.addDocumentResponseHeaders(args, headers);
    return headers;
  } catch {
    return new Headers();
  }
};

// --------------- Auth convenience ------------
/**
 * Some routes in your app import { authenticate } from "~/shopify.server".
 * Keep a thin delegator that accepts either a Remix loader/action 'args'
 * object or a plain Request, and forwards appropriately.
 */
export const authenticate = {
  admin: (args) => {
    const s = getShopify();
    const req = args?.request ?? args;
    if (!s?.authenticate?.admin) {
      throw new Error("shopify.authenticate.admin is not available");
    }
    return s.authenticate.admin(req);
  },
  public: (args) => {
    const s = getShopify();
    const req = args?.request ?? args;
    if (!s?.authenticate?.public) {
      throw new Error("shopify.authenticate.public is not available");
    }
    return s.authenticate.public(req);
  },
  webhook: (args) => {
    const s = getShopify();
    const req = args?.request ?? args;
    return s.authenticate?.webhook?.(req);
  },
  flow: (args) => {
    const s = getShopify();
    const req = args?.request ?? args;
    return s.authenticate?.flow?.(req);
  },
};

/**
 * beginAuth used by your /auth/login route.
 * - If the new adapter is present, call s.login(args) (required by Shopify).
 * - Otherwise fall back through older shapes for compatibility.
 */
export async function beginAuth(args) {
  const s = getShopify();

  // NEW: preferred path on the configured login route
  if (typeof s.login === "function") {
    return s.login(args);
  }

  // Fallbacks for older versions/shapes
  const req = args?.request ?? args;

  // New-ish: authenticate.admin(Request)
  if (typeof s.authenticate?.admin === "function") {
    try {
      const result = await s.authenticate.admin(req);
      // Library may return a Response (redirect); just return it
      if (result instanceof Response) return result;
      // Some versions return nothing and throw on redirect; normalize:
      return new Response(null, { status: 204 });
    } catch (e) {
      if (e instanceof Response) return e;
      throw e;
    }
  }

  // Older: authenticate.admin.begin(args) or auth.begin(args)
  if (s.authenticate?.admin?.begin) return s.authenticate.admin.begin(args);
  if (s.auth?.begin) return s.auth.begin(args);

  throw new Response("Shopify admin auth 'begin' handler not available", {
    status: 500,
  });
}

export async function callbackAuth(args) {
  const s = getShopify();

  // NEW adapter (required when using shopify.login on /auth/login)
  if (typeof s.callback === "function") {
    return s.callback(args);
  }

  // Fallbacks for older versions
  if (s.authenticate?.admin?.callback) {
    return s.authenticate.admin.callback(args);
  }
  if (s.auth?.callback) {
    return s.auth.callback(args);
  }

  throw new Response("Shopify admin auth 'callback' handler not available", {
    status: 500,
  });
}
