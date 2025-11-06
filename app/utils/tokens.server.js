// app/utils/tokens.server.js
// Bracketed token engine for titles like: [short_description], [customer_email]
// Extend by adding entries to TOKEN_REGISTRY (or pass a custom list to replaceTokens).

/** Default token resolvers */
export const TOKEN_REGISTRY = [
  {
    name: "short_description",
    resolve: ({ pb }) => pb?.short_description ?? "",
  },
  {
    name: "customer_email",
    resolve: ({ customerEmail }) => customerEmail ?? "",
  },
];

/**
 * Replace [token] occurrences in `template` using provided `tokens`.
 * - Case-insensitive token names
 * - Unknown/missing tokens resolve to empty string
 */
export function replaceTokens(template, ctx, tokens = TOKEN_REGISTRY) {
  const src = String(template ?? "");
  if (!src) return src;

  return src.replace(/\[([^\]]+)\]/g, (_m, raw) => {
    const key = String(raw || "").trim().toLowerCase();
    const t = tokens.find((x) => x.name === key);
    try {
      const v = t ? t.resolve(ctx) : "";
      return v == null ? "" : String(v);
    } catch {
      return "";
    }
  });
}
