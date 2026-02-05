import { PrismaClient } from "@prisma/client";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function loadDotEnv(filePath) {
  if (!fs.existsSync(filePath)) return false;
  const content = fs.readFileSync(filePath, "utf8");
  const lines = content.split(/\r?\n/);

  for (const line of lines) {
    const raw = line.trim();
    if (!raw || raw.startsWith("#")) continue;

    const eqIdx = raw.indexOf("=");
    if (eqIdx === -1) continue;

    const key = raw.slice(0, eqIdx).trim();
    let value = raw.slice(eqIdx + 1).trim();

    // Strip inline comments for unquoted values
    if (!value.startsWith('"') && !value.startsWith("'")) {
      const hashIdx = value.indexOf(" #");
      if (hashIdx !== -1) value = value.slice(0, hashIdx).trim();
    }

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
  return true;
}

// Load .env from repo root so the script can run with no CLI params.
const dotenvPath = path.resolve(__dirname, "..", ".env");
const dotenvLoaded = loadDotEnv(dotenvPath);

function normalizeEnvValue(value) {
  if (value == null) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  const lowered = trimmed.toLowerCase();
  if (lowered === "undefined" || lowered === "null") return null;
  return trimmed;
}

function normalizeShop(value) {
  const raw = normalizeEnvValue(value);
  if (!raw) return null;

  // Allow passing full URL; extract hostname.
  if (raw.includes("://")) {
    try {
      return new URL(raw).hostname;
    } catch {
      // fall through to best-effort parsing
    }
  }

  // Strip any path/query fragments if present.
  return raw.split("/")[0];
}

const envShop =
  process.env.SHOPIFY_SHOP ||
  process.env.SHOPIFY_STORE_DOMAIN ||
  process.env.SHOP_CUSTOM_DOMAIN;
const envToken = normalizeEnvValue(process.env.SHOPIFY_ADMIN_TOKEN);

let shop = normalizeShop(envShop); // e.g. my-store.myshopify.com
let token = envToken; // Admin API access token
const version = process.env.SHOPIFY_API_VERSION || "2025-01";

const prisma = new PrismaClient();

function maskSecret(value) {
  if (!value) return null;
  const v = String(value);
  if (v.length <= 8) return "***";
  return `${v.slice(0, 4)}...${v.slice(-4)} (len:${v.length})`;
}

const diagnostics = {
  env: {
    SHOPIFY_SHOP: process.env.SHOPIFY_SHOP ?? null,
    SHOPIFY_STORE_DOMAIN: process.env.SHOPIFY_STORE_DOMAIN ?? null,
    SHOP_CUSTOM_DOMAIN: process.env.SHOP_CUSTOM_DOMAIN ?? null,
    SHOPIFY_ADMIN_TOKEN: maskSecret(process.env.SHOPIFY_ADMIN_TOKEN),
    SHOPIFY_API_VERSION: process.env.SHOPIFY_API_VERSION ?? null,
    DATABASE_URL: process.env.DATABASE_URL ? "set" : null,
    DIRECT_URL: process.env.DIRECT_URL ? "set" : null,
    DOTENV_PATH: dotenvPath,
    DOTENV_LOADED: dotenvLoaded,
  },
  normalized: {
    shop,
    tokenPresent: Boolean(token),
  },
  resolved: {
    shop: null,
    tokenMasked: null,
    tokenSource: null,
    shopSource: envShop ? "env" : null,
  },
  sessionLookup: {
    byShop: null,
    fallback: null,
  },
  request: {
    apiVersion: version,
    url: null,
  },
};

async function resolveShopAndToken() {
  if (token && shop) return { shop, token };

  // Try to pull an offline token from the Shopify app sessions table
  if (shop) {
    const session = await prisma.session.findFirst({
      where: { shop, isOnline: false },
      orderBy: [{ expires: "desc" }],
    });
    diagnostics.sessionLookup.byShop = {
      attempted: true,
      shop,
      found: Boolean(session),
      sessionId: session?.id ?? null,
      expires: session?.expires ?? null,
      isOnline: session?.isOnline ?? null,
    };
    if (session?.accessToken) {
      return { shop, token: session.accessToken };
    }
  } else {
    diagnostics.sessionLookup.byShop = { attempted: false };
  }

  // If no shop was provided, use the only offline session if it is unambiguous
  if (!shop) {
    const sessions = await prisma.session.findMany({
      where: { isOnline: false },
      orderBy: [{ expires: "desc" }],
      take: 2,
    });
    diagnostics.sessionLookup.fallback = {
      count: sessions.length,
      shops: sessions.map((s) => s?.shop).filter(Boolean),
      sessionIds: sessions.map((s) => s?.id).filter(Boolean),
    };
    if (sessions.length === 1 && sessions[0]?.accessToken && sessions[0]?.shop) {
      return { shop: normalizeShop(sessions[0].shop), token: sessions[0].accessToken };
    }
  }

  console.error(
    "Missing Shopify Admin token. Set SHOPIFY_SHOP and SHOPIFY_ADMIN_TOKEN, " +
    "or ensure an offline session exists for the shop in the Session table."
  );
  process.exit(1);
}

const gql = `#graphql
  query Variants($first: Int!, $after: String) {
    productVariants(first: $first, after: $after) {
      edges {
        cursor
        node {
          id
          sku
          title
          product { title }
          selectedOptions { name value }
          metafield(namespace: "custom", key: "surface_to_logistics") {
            value
            type
          }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

async function shopifyGraphql(query, variables) {
  const url = `https://${shop}/admin/api/${version}/graphql.json`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": token,
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Shopify API ${res.status}: ${text}`);
  }

  const json = await res.json();
  if (json?.errors?.length) {
    const msg = json.errors.map((e) => e.message).join("; ");
    throw new Error(msg || "Shopify GraphQL error");
  }

  return json.data;
}

function clean(v) {
  return String(v ?? "").trim();
}

function shortNameForVariant(node) {
  const productTitle = clean(node?.product?.title) || "Unknown";
  const firstOption = clean(node?.selectedOptions?.[0]?.value) || clean(node?.title);
  return `${productTitle}/${firstOption || "Default"}`;
}

function displayNameForVariant(node) {
  const productTitle = clean(node?.product?.title) || "Unknown";
  const variantTitle = clean(node?.title) || "Default";
  return `${productTitle} — ${variantTitle}`;
}

async function sync() {
  const resolved = await resolveShopAndToken();
  shop = normalizeShop(resolved.shop);
  token = normalizeEnvValue(resolved.token);

  diagnostics.resolved.shop = shop;
  diagnostics.resolved.tokenMasked = maskSecret(token);
  diagnostics.resolved.tokenSource = token ? (envToken ? "env" : "session") : null;
  diagnostics.request.url = shop
    ? `https://${shop}/admin/api/${version}/graphql.json`
    : null;

  if (!shop) {
    console.error(
      "Invalid shop domain. Set SHOPIFY_SHOP to something like 'my-store.myshopify.com' " +
      "or ensure the Session table has a valid shop domain."
    );
    process.exit(1);
  }
  if (!token) {
    console.error(
      "Missing Shopify Admin token. Set SHOPIFY_ADMIN_TOKEN or ensure an offline session exists for the shop."
    );
    process.exit(1);
  }

  const toDeleteShortNames = new Set();
  const toDeleteVariantGids = new Set();
  const missingSku = [];

  let created = 0;
  let updated = 0;
  let skipped = 0;

  let after = null;
  for (let page = 0; page < 1000; page += 1) {
    const data = await shopifyGraphql(gql, { first: 100, after });
    const edges = data?.productVariants?.edges || [];

    for (const edge of edges) {
      const node = edge?.node;
      if (!node) continue;

      const metaVal = clean(node?.metafield?.value).toLowerCase();
      const isSurface = metaVal === "true";

      const shortName = shortNameForVariant(node);
      const variantGID = clean(node?.id);

      if (!isSurface) {
        if (shortName) toDeleteShortNames.add(shortName);
        if (variantGID) toDeleteVariantGids.add(variantGID);
        continue;
      }

      const sku = clean(node?.sku);
      if (!sku) {
        missingSku.push({ id: variantGID, shortName, title: node?.title || "" });
        skipped += 1;
        continue;
      }

      const displayName = displayNameForVariant(node);

      try {
        const existing = await prisma.tlkp_rslProduct.findUnique({
          where: { shortName },
          select: { id: true, shortName: true },
        });

        if (existing) {
          await prisma.tlkp_rslProduct.update({
            where: { shortName },
            data: {
              displayName,
              SKU: sku,
              variantGID,
            },
          });
          updated += 1;
        } else {
          const existingBySku = await prisma.tlkp_rslProduct.findFirst({
            where: { SKU: sku },
            select: { id: true, shortName: true },
          });

          if (existingBySku) {
            const data = { displayName, variantGID };
            if (existingBySku.shortName !== shortName) {
              const shortNameTaken = await prisma.tlkp_rslProduct.findUnique({
                where: { shortName },
                select: { id: true },
              });
              if (!shortNameTaken) data.shortName = shortName;
            }
            await prisma.tlkp_rslProduct.update({
              where: { id: existingBySku.id },
              data,
            });
            updated += 1;
          } else {
            await prisma.tlkp_rslProduct.create({
              data: {
                shortName,
                displayName,
                SKU: sku,
                variantGID,
              },
            });
            created += 1;
          }
        }
      } catch (e) {
        console.error(`Failed upsert for ${shortName}:`, e?.message || e);
        skipped += 1;
      }
    }

    const pageInfo = data?.productVariants?.pageInfo;
    if (!pageInfo?.hasNextPage) break;
    after = pageInfo.endCursor;
  }

  // Remove variants where metafield is false
  const deleteShorts = Array.from(toDeleteShortNames).filter(Boolean);
  const deleteVariantGids = Array.from(toDeleteVariantGids).filter(Boolean);

  let deleted = 0;
  if (deleteShorts.length || deleteVariantGids.length) {
    const res = await prisma.tlkp_rslProduct.deleteMany({
      where: {
        OR: [
          deleteShorts.length ? { shortName: { in: deleteShorts } } : undefined,
          deleteVariantGids.length ? { variantGID: { in: deleteVariantGids } } : undefined,
        ].filter(Boolean),
      },
    });
    deleted = res.count || 0;
  }

  console.log(`Sync complete: created ${created}, updated ${updated}, deleted ${deleted}, skipped ${skipped}`);

  if (missingSku.length) {
    console.warn("Variants missing SKU (skipped):");
    for (const v of missingSku) {
      console.warn(`- ${v.id || "(no gid)"} :: ${v.shortName} :: ${v.title}`);
    }
  }
}

try {
  await sync();
} catch (err) {
  console.error("[sync-rsl-products] error:", err?.message || err);
  console.error("[sync-rsl-products] diagnostics:\n" + JSON.stringify(diagnostics, null, 2));
  throw err;
} finally {
  await prisma.$disconnect();
}
