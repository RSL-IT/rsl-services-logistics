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

  // Prefer returning a relative URL for same-origin navigation/fetch
  if (u.origin === origin) return `${u.pathname}${u.search}${u.hash}`;
  return u.toString();
}
