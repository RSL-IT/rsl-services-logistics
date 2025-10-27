// app/utils/shopify-gid.js

const PREFIX = "gid://shopify";

/**
 * Return the trailing numeric portion of an ID/GID.
 * @param {string|number|null|undefined} value
 * @returns {string|null} numeric id or null
 */
export function toNumericId(value) {
  if (value == null) return null;
  const m = String(value).match(/(\d+)\s*$/);
  return m ? m[1] : null;
}

/**
 * True if value is a Shopify GID, and (optionally) of the given type.
 * @param {string|number|null|undefined} value
 * @param {string=} type e.g. "Product", "ProductVariant"
 */
export function isGid(value, type) {
  if (!value) return false;
  const s = String(value);
  if (!s.startsWith(`${PREFIX}/`)) return false;
  if (!type) return true;
  return s.startsWith(`${PREFIX}/${type}/`);
}

/**
 * Coerce a value into a Shopify GID of the given type.
 * Accepts either a GID or a numeric/string ID.
 * @param {"Product"|"ProductVariant"|"Collection"|"Customer"|"Order"|string} type
 * @param {string|number|null|undefined} value
 * @returns {string|null}
 */
export function toGid(type, value) {
  if (value == null) return null;
  const s = String(value);
  if (s.startsWith(`${PREFIX}/`)) return s; // already a gid
  const id = toNumericId(s);
  return id ? `${PREFIX}/${type}/${id}` : null;
}

/**
 * Parse a GID into { type, id, raw } or null if not a GID.
 * @param {string} gid
 */
export function parseGid(gid) {
  if (!isGid(gid)) return null;
  const parts = String(gid).split("/");
  // gid://shopify/<Type>/<id>
  const type = parts[3];
  const id = parts[4];
  return { type, id, raw: gid };
}

/** Convenience wrappers */
export const ensureProductGid  = (v) => toGid("Product", v);
export const ensureVariantGid  = (v) => toGid("ProductVariant", v);
export const ensureCollectionGid = (v) => toGid("Collection", v);

/**
 * Given a CSV (or array) of ids/gids, return an array of numeric ids (strings).
 * @param {string|string[]} input
 * @returns {string[]} numeric ids
 */
export function listToNumericIds(input) {
  const arr = Array.isArray(input)
    ? input
    : String(input ?? "")
      .split(/[,\s]+/)
      .filter(Boolean);

  return arr
    .map(toNumericId)
    .filter(Boolean);
}

/**
 * Given a CSV (or array) of ids/gids, return an array of GIDs of the given type.
 * @param {"Product"|"ProductVariant"|"Collection"|string} type
 * @param {string|string[]} input
 * @returns {string[]} gids
 */
export function listToGids(type, input) {
  const arr = Array.isArray(input)
    ? input
    : String(input ?? "")
      .split(/[,\s]+/)
      .filter(Boolean);

  return arr
    .map((v) => toGid(type, v))
    .filter(Boolean);
}

/**
 * Normalize a single input to either "id" (numeric string) or "gid".
 * @param {{ type: string, value: string|number|null|undefined, returnKind?: "id"|"gid" }} opts
 * @returns {string|null}
 */
export function normalizeIdOrGid({ type, value, returnKind = "gid" }) {
  if (returnKind === "id") return toNumericId(value);
  return toGid(type, value);
}
