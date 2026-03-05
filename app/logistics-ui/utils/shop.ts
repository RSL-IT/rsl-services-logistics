// app/logistics-ui/utils/shop.ts

export type ToLike =
  | string
  | {
  pathname?: string;
  search?: string;
  hash?: string;
  href?: string; // e.g. window.location
};

/**
 * Get ?shop= from the current browser URL.
 */
export function getShopParam(): string | null {
  if (typeof window === "undefined") return null;
  const shop = new URLSearchParams(window.location.search).get("shop");
  return shop ? String(shop).trim() : null;
}

const ADMIN_STORE_HANDLE_SESSION_KEY = "logistics_admin_store_handle";

function readRememberedAdminStoreHandle(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const value = sessionStorage.getItem(ADMIN_STORE_HANDLE_SESSION_KEY);
    return value ? String(value).trim().toLowerCase() : null;
  } catch {
    return null;
  }
}

function rememberAdminStoreHandle(handle?: string | null) {
  const clean = String(handle || "").trim().toLowerCase();
  if (!clean || typeof window === "undefined") return;
  try {
    sessionStorage.setItem(ADMIN_STORE_HANDLE_SESSION_KEY, clean);
  } catch {
    // ignore storage failures
  }
}

function extractStoreHandleFromPathLike(value?: string | null): string | null {
  const raw = String(value || "").trim();
  if (!raw) return null;

  const direct = raw.match(/\/store\/([^/?#]+)/i);
  if (direct && direct[1]) return decodeURIComponent(direct[1]).trim().toLowerCase();

  const hostStyle = raw.match(/admin\.shopify\.com\/store\/([^/?#]+)/i);
  if (hostStyle && hostStyle[1]) return decodeURIComponent(hostStyle[1]).trim().toLowerCase();

  return null;
}

function decodeBase64UrlMaybe(value?: string | null): string | null {
  const raw = String(value || "").trim();
  if (!raw || typeof window === "undefined") return null;
  try {
    const normalized = raw.replace(/-/g, "+").replace(/_/g, "/");
    const pad = normalized.length % 4;
    const padded = pad ? normalized + "=".repeat(4 - pad) : normalized;
    return window.atob(padded);
  } catch {
    return null;
  }
}

/**
 * Convert a shop domain (e.g. "foo.myshopify.com") to Shopify Admin store handle ("foo").
 */
export function toAdminStoreHandle(shopLike?: string | null): string | null {
  const raw = String(shopLike || "").trim().toLowerCase();
  if (!raw) return null;

  const noScheme = raw.replace(/^https?:\/\//, "");
  const host = noScheme.split("/")[0] || "";
  if (!host) return null;

  if (host.endsWith(".myshopify.com")) {
    return host.slice(0, -".myshopify.com".length) || null;
  }
  return host;
}

/**
 * Resolve current Shopify Admin store handle from URL context.
 * Tries shop param first, then host param, pathname/referrer, then cached value.
 */
export function getCurrentAdminStoreHandle(): string | null {
  if (typeof window === "undefined") return null;

  const fromShopParam = toAdminStoreHandle(getShopParam());
  if (fromShopParam) {
    rememberAdminStoreHandle(fromShopParam);
    return fromShopParam;
  }

  const params = new URLSearchParams(window.location.search);
  const rawHostParam = params.get("host");
  const fromHostParam = extractStoreHandleFromPathLike(rawHostParam);
  if (fromHostParam) {
    rememberAdminStoreHandle(fromHostParam);
    return fromHostParam;
  }

  const decodedHost = decodeBase64UrlMaybe(rawHostParam);
  const fromDecodedHost = extractStoreHandleFromPathLike(decodedHost);
  if (fromDecodedHost) {
    rememberAdminStoreHandle(fromDecodedHost);
    return fromDecodedHost;
  }

  const fromPath = extractStoreHandleFromPathLike(window.location.pathname);
  if (fromPath) {
    rememberAdminStoreHandle(fromPath);
    return fromPath;
  }

  const referrer = typeof document !== "undefined" ? document.referrer : "";
  const fromReferrer = extractStoreHandleFromPathLike(referrer);
  if (fromReferrer) {
    rememberAdminStoreHandle(fromReferrer);
    return fromReferrer;
  }

  return readRememberedAdminStoreHandle();
}

/**
 * Normalize either plain numeric ID or gid://shopify/PurchaseOrder/<id> to <id>.
 */
export function normalizePurchaseOrderId(input: string): string {
  const clean = String(input || "").trim();
  return clean.replace(/^gid:\/\/shopify\/PurchaseOrder\//, "");
}

/**
 * Build Shopify Admin Purchase Order URL using the current URL's ?shop= parameter.
 */
export function adminPurchaseOrderUrlForCurrentShop(
  purchaseOrderId: string,
  fallbackStore = "rogersoundlabs",
): string {
  const poId = normalizePurchaseOrderId(purchaseOrderId);
  const store = getCurrentAdminStoreHandle() || fallbackStore;
  return `https://admin.shopify.com/store/${encodeURIComponent(store)}/purchase_orders/${encodeURIComponent(poId)}`;
}

export function getLogisticsToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return sessionStorage.getItem("logistics_token");
  } catch {
    return null;
  }
}

export function isProxyContext(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const url = new URL(window.location.href);
    const params = url.searchParams;
    if (params.has("signature") || params.has("path_prefix") || params.has("logged_in_customer_id")) {
      return true;
    }
    return url.pathname.startsWith("/apps/logistics") && url.hostname.endsWith("rslspeakers.com");
  } catch {
    return false;
  }
}

/**
 * Convert either a string path, a {pathname,search,hash} object, or window.location into a path string.
 * If something unexpected is passed (e.g. a click event), return "/" instead of "/[object Object]".
 */
function toPathString(to: unknown): string {
  if (typeof to === "string") return to;

  if (to && typeof to === "object") {
    // window.location has href, pathname, search, hash
    const any = to as any;

    if (typeof any.href === "string") return any.href;

    const pathname =
      typeof any.pathname === "string" && any.pathname.length ? any.pathname : "/";
    const search = typeof any.search === "string" ? any.search : "";
    const hash = typeof any.hash === "string" ? any.hash : "";

    // If it looks like a router "To" object, use it
    if (pathname !== "/" || search || hash) return `${pathname}${search}${hash}`;
    if (typeof any.pathname === "string") return `${pathname}${search}${hash}`;

    // Unknown object (often an event) — do NOT stringify to "[object Object]"
    if (typeof window !== "undefined") {
      // helpful when debugging in-browser
      // eslint-disable-next-line no-console
      console.warn("[withShopParam] Non-path object passed; defaulting to '/':", to);
    }
    return "/";
  }

  // null/undefined/number/etc
  return "/";
}

/**
 * Append ?shop= to a path (string or {pathname,search,hash}) using the current URL's shop param.
 * Returns a same-origin relative URL (pathname+search+hash) whenever possible.
 */
export function withShopParam(to: ToLike): string {
  const path = toPathString(to);
  const shop = getShopParam();
  const handle = toAdminStoreHandle(shop);
  if (handle) rememberAdminStoreHandle(handle);
  const token = isProxyContext() ? getLogisticsToken() : null;

  // No shop available: just return a safe relative path
  if (!shop) {
    // If someone passed an absolute URL string, keep it as-is.
    return path;
  }

  // Build URL relative to current origin (client-only)
  const origin = typeof window !== "undefined" ? window.location.origin : "https://example.invalid";
  const u = new URL(path, origin);

  // If shop already present on the provided URL, keep it
  if (!u.searchParams.get("shop")) {
    u.searchParams.set("shop", shop);
  }
  if (token && !u.searchParams.get("logistics_token")) {
    u.searchParams.set("logistics_token", token);
  }

  // Prefer returning a relative URL for same-origin navigation/fetch
  if (u.origin === origin) return `${u.pathname}${u.search}${u.hash}`;
  return u.toString();
}
