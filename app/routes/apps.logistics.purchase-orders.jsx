// app/routes/apps.logistics.purchase-orders.jsx
import { json } from "@remix-run/node";
import { Prisma } from "@prisma/client";
import { logisticsDb } from "~/logistics-db.server";
import { prisma } from "~/db.server";
import { runAdminQuery } from "~/shopify-admin.server";
import { ensureLogisticsUserOrJson } from "~/logistics-auth.server";
import {
  extractPurchaseOrderHeaderMetaFromPdfBuffer,
  extractPurchaseOrderProductsFromPdfBuffer,
  extractPurchaseOrderShipToFromPdfBuffer,
  extractPurchaseOrderSupplierFromPdfBuffer,
  validatePurchaseOrderPdfFormatFromPdfBuffer,
} from "~/utils/purchase-order-pdf.server";

function cleanStrOrNull(v) {
  const s = String(v ?? "").trim();
  return s ? s : null;
}

function cleanStr(v) {
  return String(v ?? "").trim();
}

const SHOPIFY_FOOTER_NOISE_RE = /\bPowered by Shopify\b/ig;

function sanitizeProductTitleText(v) {
  const s = cleanStr(v).replace(SHOPIFY_FOOTER_NOISE_RE, " ");
  const normalized = s.replace(/\s+/g, " ").trim();
  return normalized || null;
}

function isPlaceholderProductId(v) {
  return /^line[_\s-]?\d+$/i.test(cleanStr(v));
}

function normalizeSkuForMatch(v) {
  const raw = cleanStr(v).toUpperCase().replace(/\s+/g, "");
  if (!raw) return "";
  // User rule: ignore the 7th character (1-based) when matching SKUs.
  if (raw.length < 7) return raw;
  return `${raw.slice(0, 6)}${raw.slice(7)}`;
}

function normalizeTitleForMatch(v) {
  const title = sanitizeProductTitleText(v);
  if (!title) return "";
  return title
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function titleMatchKeys(v) {
  const title = sanitizeProductTitleText(v);
  if (!title) return [];

  const variants = [title];
  const slashIdx = title.indexOf("/");
  if (slashIdx > 0) variants.push(title.slice(0, slashIdx));
  const dashIdx = title.indexOf(" - ");
  if (dashIdx > 0) variants.push(title.slice(0, dashIdx));

  const keys = [];
  for (const candidate of variants) {
    const normalized = normalizeTitleForMatch(candidate);
    if (!normalized) continue;
    keys.push(normalized);
    const compact = normalized.replace(/\s+/g, "");
    if (compact) keys.push(compact);
  }
  return uniqStrings(keys);
}

function buildSkuLookup(rslProducts) {
  const bySku = new Map();
  const skuCounts = new Map();
  for (const p of rslProducts || []) {
    const rawSku = cleanStr(p?.SKU).toUpperCase().replace(/\s+/g, "");
    const skuKey = normalizeSkuForMatch(rawSku);
    if (!skuKey) continue;
    skuCounts.set(skuKey, (skuCounts.get(skuKey) || 0) + 1);
    if (!bySku.has(skuKey)) bySku.set(skuKey, []);
    bySku.get(skuKey).push({ product: p, rawSku });
  }
  return { bySku, skuCounts };
}

function findSkuMatch(sku, bySku) {
  const normalizedInputSku = cleanStr(sku).toUpperCase().replace(/\s+/g, "");
  const skuKey = normalizeSkuForMatch(normalizedInputSku);
  if (!skuKey) {
    return { skuKey: "", normalizedInputSku: "", matchedEntry: null, matched: null };
  }
  const skuMatches = bySku.get(skuKey) || [];
  const matchedEntry = skuMatches.find((m) => m.rawSku === normalizedInputSku) || skuMatches[0] || null;
  return {
    skuKey,
    normalizedInputSku,
    matchedEntry,
    matched: matchedEntry?.product || null,
  };
}

function buildTitleLookup(rslProducts) {
  const byTitle = new Map();
  for (const p of rslProducts || []) {
    const keys = uniqStrings([
      ...titleMatchKeys(p?.displayName),
      ...titleMatchKeys(p?.shortName),
    ]);
    for (const key of keys) {
      if (!byTitle.has(key)) byTitle.set(key, []);
      byTitle.get(key).push(p);
    }
  }
  return byTitle;
}

function findTitleMatch(title, byTitle) {
  const keys = titleMatchKeys(title);
  for (const key of keys) {
    const matches = byTitle.get(key) || [];
    if (!matches.length) continue;
    return {
      key,
      matched: matches[0],
      duplicate: matches.length > 1,
    };
  }
  return null;
}

const INVALID_PO_FORMAT_MESSAGE =
  "That PDF does not seem to be a RSL Purchase Order.  Check it and try with a different document.  If you're sure it's correct, contact the IT administrator.";
const PO_LINE_ITEMS_SNAPSHOT_EVENT = "PO_LINE_ITEMS_SNAPSHOT";
const PRO_FORMA_INVOICE_UPDATE_EVENT = "PRO_FORMA_INVOICE_UPDATE";

function normalizePoLineItemSnapshotRow(row, idx = 0) {
  const mappedId = cleanStrOrNull(
    row?.rslProductID ??
    row?.rslModelID ??
    row?.shortName ??
    null
  );
  const normalizedMappedId = mappedId && !isPlaceholderProductId(mappedId) ? mappedId : null;

  const title = sanitizeProductTitleText(row?.title ?? row?.displayName ?? null);
  const sku = cleanStrOrNull(row?.SKU ?? row?.sku ?? null);
  const qtyRaw = Number(row?.quantity);
  const quantity = Number.isFinite(qtyRaw) ? Math.max(0, Math.trunc(qtyRaw)) : 0;

  return {
    lineNumber: idx + 1,
    title: title || `Line ${idx + 1}`,
    sku,
    quantity,
    rslProductID: normalizedMappedId,
  };
}

function normalizePoLineItemsSnapshot(rows) {
  const raw = Array.isArray(rows) ? rows : [];
  return raw
    .map((row, idx) => normalizePoLineItemSnapshotRow(row, idx))
    .filter((row) => row.title || row.sku || row.quantity > 0 || row.rslProductID);
}

function parsePoLineItemsSnapshot(content) {
  const s = cleanStr(content);
  if (!s) return [];
  try {
    const parsed = JSON.parse(s);
    const rows = Array.isArray(parsed?.lineItems) ? parsed.lineItems : [];
    return normalizePoLineItemsSnapshot(rows);
  } catch {
    return [];
  }
}

function normalizePoNumberForCompare(v) {
  return cleanStr(v)
    .replace(/^#+/, "")
    .replace(/\s+/g, "")
    .toUpperCase();
}

function normalizeCompanyMatchKey(v) {
  return cleanStr(v)
    .toUpperCase()
    .replace(/&/g, " AND ")
    .replace(/[^A-Z0-9]+/g, " ")
    .replace(/\b(CO|COMPANY|INC|INCORPORATED|LLC|LTD|LIMITED|CORP|CORPORATION)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeDeliveryAddressMatchKey(v) {
  return cleanStr(v)
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function pickCompanyMatch(companies, supplierName) {
  const supplierKey = normalizeCompanyMatchKey(supplierName);
  if (!supplierKey) return null;

  const candidates = Array.isArray(companies) ? companies : [];

  const exact = candidates.find((c) => {
    const displayKey = normalizeCompanyMatchKey(c?.displayName);
    const shortKey = normalizeCompanyMatchKey(c?.shortName);
    return displayKey === supplierKey || shortKey === supplierKey;
  });
  if (exact) return exact;

  if (supplierKey.length < 5) return null;
  return (
    candidates.find((c) => {
      const displayKey = normalizeCompanyMatchKey(c?.displayName);
      if (!displayKey) return false;
      return displayKey.includes(supplierKey) || supplierKey.includes(displayKey);
    }) || null
  );
}

function pickDeliveryAddressMatch(deliveryAddresses, shipToDisplayName) {
  const shipToKey = normalizeDeliveryAddressMatchKey(shipToDisplayName);
  if (!shipToKey) return null;

  const candidates = Array.isArray(deliveryAddresses) ? deliveryAddresses : [];

  const exact = candidates.find((d) => {
    const displayKey = normalizeDeliveryAddressMatchKey(d?.displayName);
    const shortKey = normalizeDeliveryAddressMatchKey(d?.shortName);
    return displayKey === shipToKey || shortKey === shipToKey;
  });
  if (exact) return exact;

  if (shipToKey.length < 8) return null;
  return (
    candidates.find((d) => {
      const displayKey = normalizeDeliveryAddressMatchKey(d?.displayName);
      if (!displayKey) return false;
      return displayKey.includes(shipToKey) || shipToKey.includes(displayKey);
    }) || null
  );
}

function normalizeSupplierCandidate(raw) {
  if (!raw || typeof raw !== "object") return null;

  const rawLines = Array.isArray(raw.rawLines)
    ? raw.rawLines.map((x) => cleanStr(x)).filter(Boolean)
    : [];

  return {
    name: cleanStrOrNull(raw.name ?? raw.displayName ?? raw.supplierName ?? null),
    rawLines,
    address1: cleanStrOrNull(raw.address1),
    address2: cleanStrOrNull(raw.address2),
    city: cleanStrOrNull(raw.city),
    province: cleanStrOrNull(raw.province),
    postalCode: cleanStrOrNull(raw.postalCode),
    country: cleanStrOrNull(raw.country),
    email: cleanStrOrNull(raw.email),
    phone: cleanStrOrNull(raw.phone),
    supplierCurrency: cleanStrOrNull(raw.supplierCurrency),
  };
}

function normalizeShipToCandidate(raw) {
  if (!raw || typeof raw !== "object") return null;

  const rawLines = Array.isArray(raw.rawLines)
    ? raw.rawLines.map((x) => cleanStr(x)).filter(Boolean)
    : [];
  const displayName = cleanStrOrNull(raw.displayName || (rawLines.length ? rawLines.join(", ") : null));

  return {
    rawLines,
    displayName,
  };
}

function purchaseOrderGidCandidateFromFilename(filename) {
  const s = cleanStr(filename);
  if (!s) return null;

  const m = s.match(/purchase[_\s-]*order[_\s-]*(\d+)/i);
  if (m?.[1]) return cleanStrOrNull(m[1]);

  return null;
}

function companyShortNameBaseFromName(name) {
  const firstWord = cleanStr(name).split(/\s+/).filter(Boolean)[0] || "";
  const base = firstWord
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 24);
  return base || "SUPPLIER";
}

function deliveryAddressShortNameBaseFromDisplayName(displayName) {
  const firstWord = cleanStr(displayName).split(/\s+/).filter(Boolean)[0] || "";
  const base = firstWord
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 24);
  return base || "DELIVERY";
}

async function nextUniqueCompanyShortName(tx, base) {
  let attempt = 0;
  while (attempt < 200) {
    const suffix = attempt === 0 ? "" : `_${attempt + 1}`;
    const candidate = `${base}${suffix}`.slice(0, 30);
    const exists = await tx.tlkp_company.findUnique({
      where: { shortName: candidate },
      select: { shortName: true },
    });
    if (!exists) return candidate;
    attempt += 1;
  }
  return `${base.slice(0, 20)}_${Date.now()}`.slice(0, 30);
}

async function nextUniqueDeliveryAddressShortName(tx, base) {
  let attempt = 0;
  while (attempt < 200) {
    const suffix = attempt === 0 ? "" : `_${attempt + 1}`;
    const candidate = `${base}${suffix}`.slice(0, 30);
    const exists = await tx.tlkp_deliveryAddress.findUnique({
      where: { shortName: candidate },
      select: { shortName: true },
    });
    if (!exists) return candidate;
    attempt += 1;
  }
  return `${base.slice(0, 20)}_${Date.now()}`.slice(0, 30);
}

async function insertSupplierRecordBestEffort(tx, supplier, company) {
  const tableName = "tlkp_supplier";
  const tableRows = await tx.$queryRaw`
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = ${tableName}
    ) AS "exists"
  `;
  const tableExists = Boolean(tableRows?.[0]?.exists);
  if (!tableExists) {
    return { attempted: false, created: false, reason: "table-missing" };
  }

  const cols = await tx.$queryRaw`
    SELECT column_name, is_nullable, data_type, column_default
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = ${tableName}
  `;
  const available = new Set((cols || []).map((r) => cleanStr(r.column_name)));
  if (!available.size) {
    return { attempted: false, created: false, reason: "no-columns" };
  }

  if (available.has("shortName")) {
    const existing = await tx.$queryRaw(
      Prisma.sql`SELECT 1 FROM "tlkp_supplier" WHERE "shortName" = ${company.shortName} LIMIT 1`
    );
    if (Array.isArray(existing) && existing.length) {
      return { attempted: true, created: false, reason: "already-exists" };
    }
  }

  const now = new Date();
  const candidateData = {
    shortName: company.shortName,
    displayName: supplier?.name || company.displayName || company.shortName,
    name: supplier?.name || company.displayName || company.shortName,
    companyID: company.shortName,
    companyId: company.shortName,
    address1: supplier?.address1,
    address2: supplier?.address2,
    city: supplier?.city,
    province: supplier?.province,
    postalCode: supplier?.postalCode,
    country: supplier?.country,
    primaryEmail: supplier?.email,
    email: supplier?.email,
    primaryPhone: supplier?.phone,
    phone: supplier?.phone,
    supplierCurrency: supplier?.supplierCurrency,
    createdAt: now,
    updatedAt: now,
  };

  const insertCols = [];
  const insertVals = [];
  const used = new Set();
  for (const [key, val] of Object.entries(candidateData)) {
    if (!available.has(key)) continue;
    if (val == null || val === "") continue;
    insertCols.push(key);
    insertVals.push(val);
    used.add(key);
  }

  const requiredWithoutDefault = (cols || []).filter((c) => {
    const name = cleanStr(c?.column_name);
    if (!name || used.has(name)) return false;
    const nullable = cleanStr(c?.is_nullable).toUpperCase() === "YES";
    const hasDefault = c?.column_default != null;
    return !nullable && !hasDefault;
  });

  for (const c of requiredWithoutDefault) {
    const colName = cleanStr(c?.column_name);
    const lowerName = colName.toLowerCase();
    const dataType = cleanStr(c?.data_type).toLowerCase();

    if (lowerName === "id") continue;

    let fallbackValue;
    if (dataType.includes("timestamp") || dataType.includes("date") || dataType.includes("time")) {
      fallbackValue = now;
    } else if (dataType.includes("bool")) {
      fallbackValue = false;
    } else if (
      dataType.includes("int") ||
      dataType.includes("numeric") ||
      dataType.includes("decimal") ||
      dataType.includes("double") ||
      dataType.includes("real")
    ) {
      fallbackValue = 0;
    } else if (dataType.includes("char") || dataType.includes("text")) {
      if (lowerName.includes("email")) fallbackValue = supplier?.email || "unknown@example.com";
      else if (lowerName.includes("phone")) fallbackValue = supplier?.phone || "";
      else if (lowerName.includes("currency")) fallbackValue = supplier?.supplierCurrency || "";
      else if (lowerName.includes("address1")) fallbackValue = supplier?.address1 || "";
      else if (lowerName.includes("address2")) fallbackValue = supplier?.address2 || "";
      else if (lowerName.includes("city")) fallbackValue = supplier?.city || "";
      else if (lowerName.includes("province")) fallbackValue = supplier?.province || "";
      else if (lowerName.includes("postal")) fallbackValue = supplier?.postalCode || "";
      else if (lowerName.includes("country")) fallbackValue = supplier?.country || "";
      else if (lowerName.includes("company")) fallbackValue = company.shortName;
      else if (lowerName.includes("display")) fallbackValue = company.displayName || company.shortName;
      else if (lowerName.includes("name")) fallbackValue = supplier?.name || company.displayName || company.shortName;
      else fallbackValue = "";
    }

    if (fallbackValue == null) continue;
    insertCols.push(colName);
    insertVals.push(fallbackValue);
    used.add(colName);
  }

  if (!insertCols.length) {
    return { attempted: false, created: false, reason: "no-compatible-columns" };
  }

  const colsSql = Prisma.join(insertCols.map((c) => Prisma.raw(`"${c}"`)));
  const valsSql = Prisma.join(insertVals.map((v) => Prisma.sql`${v}`));

  try {
    await tx.$executeRaw(
      Prisma.sql`INSERT INTO "tlkp_supplier" (${colsSql}) VALUES (${valsSql})`
    );
    return { attempted: true, created: true };
  } catch (err) {
    return {
      attempted: true,
      created: false,
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}

function shortNameForVariant(node) {
  const productTitle = cleanStr(node?.product?.title) || "Unknown";
  const firstOption = cleanStr(node?.selectedOptions?.[0]?.value) || cleanStr(node?.title);
  return `${productTitle}/${firstOption || "Default"}`;
}

function displayNameForVariant(node) {
  const productTitle = cleanStr(node?.product?.title) || "Unknown";
  const options = Array.isArray(node?.selectedOptions) ? node.selectedOptions : [];
  const colorOption = options.find((opt) => cleanStr(opt?.name).toLowerCase() === "color");
  const colorValue = cleanStr(colorOption?.value);

  if (!colorValue || colorValue.toLowerCase() === "default title" || colorValue.toLowerCase() === "default") {
    return productTitle;
  }

  return `${productTitle} — ${colorValue}`;
}

function normalizeTags(rawTags) {
  if (Array.isArray(rawTags)) {
    return rawTags.map((tag) => cleanStr(tag).toLowerCase()).filter(Boolean);
  }
  const s = cleanStr(rawTags);
  if (!s) return [];
  return s
    .split(",")
    .map((tag) => cleanStr(tag).toLowerCase())
    .filter(Boolean);
}

function isFactoryNewVariant(node) {
  const options = Array.isArray(node?.selectedOptions) ? node.selectedOptions : [];
  const option1 = cleanStr(options?.[0]?.value).toLowerCase();
  const option2 = cleanStr(options?.[1]?.value).toLowerCase();
  return option1 === "factory new" || option2 === "factory new";
}

function isDefaultOnlyVariant(node) {
  const title = cleanStr(node?.title).toLowerCase();
  const options = Array.isArray(node?.selectedOptions) ? node.selectedOptions : [];
  const optionValues = options.map((opt) => cleanStr(opt?.value).toLowerCase()).filter(Boolean);

  if (title !== "default title" && title !== "default") return false;
  if (!optionValues.length) return true;
  return optionValues.every((v) => v === "default title" || v === "default");
}

function shouldExcludeProductFromRefresh(productNode) {
  const title = cleanStr(productNode?.title);
  const productType = cleanStr(productNode?.productType);
  const normalizedProductType = productType.toLowerCase().replace(/\s+/g, " ").trim();
  const tags = normalizeTags(productNode?.tags);
  const isGiftCard = Boolean(productNode?.isGiftCard);

  if (title.toLowerCase().includes("testing")) return true;
  if (isGiftCard) return true;
  if (normalizedProductType === "shipping insurance") return true;
  if (normalizedProductType.includes("gift card")) return true;
  if (tags.includes("bundler")) return true;

  return false;
}

function selectVariantsForRefresh(productNode, variants) {
  const list = Array.isArray(variants) ? variants.filter(Boolean) : [];
  if (!list.length) return [];

  // Rule 1: no real variants -> use primary product/default variant.
  if (list.length <= 1 && isDefaultOnlyVariant(list[0])) {
    return [list[0]];
  }

  // Primary rule: keep only Factory New variants (option1 or option2).
  const factoryNew = list.filter((node) => isFactoryNewVariant(node));
  if (factoryNew.length) return factoryNew;

  // Rule 2: no Factory New variant -> first available variant.
  return [list[0]];
}

function extractShopifyErrorMessages(rawErrors) {
  if (!rawErrors) return [];
  const list = Array.isArray(rawErrors) ? rawErrors : [rawErrors];
  const messages = [];

  for (const e of list) {
    if (!e) continue;
    if (typeof e === "string") {
      if (e.trim()) messages.push(e.trim());
      continue;
    }
    if (typeof e?.message === "string" && e.message.trim()) {
      messages.push(e.message.trim());
      continue;
    }
    if (typeof e?.error === "string" && e.error.trim()) {
      messages.push(e.error.trim());
      continue;
    }
    try {
      const s = JSON.stringify(e);
      if (s && s !== "{}") messages.push(s);
    } catch {
      // ignore
    }
  }

  return messages;
}

async function syncRslProductsFromShopify(shop) {
  const gql = `#graphql
    query Variants($first: Int!, $after: String) {
      productVariants(first: $first, after: $after) {
        edges {
          cursor
          node {
            id
            sku
            title
            product {
              id
              title
              productType
              tags
              isGiftCard
            }
            selectedOptions { name value }
          }
        }
        pageInfo { hasNextPage endCursor }
      }
    }
  `;

  const missingSku = [];

  let created = 0;
  let updated = 0;
  let skipped = 0;
  let deleted = 0;
  const productBuckets = new Map();
  const keepShortNames = new Set();
  const keepVariantGIDs = new Set();

  let after = null;
  for (let page = 0; page < 1000; page += 1) {
    const resp = await runAdminQuery(shop, gql, { first: 100, after });
    const errorMessages = extractShopifyErrorMessages(resp?.errors);
    if (errorMessages.length) {
      throw new Error(`Shopify error: ${errorMessages.join("; ")}`);
    }

    const variantsBlock = resp?.data?.productVariants;
    if (!variantsBlock) {
      throw new Error("Shopify error: productVariants missing in response.");
    }

    const edges = variantsBlock.edges || [];
    for (const edge of edges) {
      const node = edge?.node;
      if (!node) continue;
      const productNode = node?.product || {};
      const productID = cleanStr(productNode?.id) || cleanStr(node?.id) || cleanStr(edge?.cursor);
      if (!productID) continue;

      const existingBucket = productBuckets.get(productID);
      if (!existingBucket) {
        productBuckets.set(productID, { product: productNode, variants: [node] });
        continue;
      }

      if (!cleanStr(existingBucket?.product?.title) && cleanStr(productNode?.title)) {
        existingBucket.product = productNode;
      }
      existingBucket.variants.push(node);
    }

    const pageInfo = variantsBlock.pageInfo;
    if (!pageInfo?.hasNextPage) break;
    after = pageInfo.endCursor;
  }

  for (const bucket of productBuckets.values()) {
    const productNode = bucket?.product || {};
    const variants = Array.isArray(bucket?.variants) ? bucket.variants : [];
    if (!variants.length) continue;

    if (shouldExcludeProductFromRefresh(productNode)) {
      skipped += variants.length;
      continue;
    }

    const selectedVariants = selectVariantsForRefresh(productNode, variants);
    const seenVariantKeys = new Set();

    for (const node of selectedVariants) {
      const baseShortName = shortNameForVariant(node);
      let shortName = baseShortName;
      const variantGID = cleanStr(node?.id);
      const variantKey = variantGID || `${baseShortName}::${cleanStr(node?.sku)}::${cleanStr(node?.title)}`;
      if (seenVariantKeys.has(variantKey)) continue;
      seenVariantKeys.add(variantKey);

      const skuValue = cleanStr(node?.sku);
      const sku = skuValue || null;
      if (!sku) missingSku.push({ id: variantGID, shortName: baseShortName, title: node?.title || "" });
      if (variantGID) keepVariantGIDs.add(variantGID);

      const displayName = displayNameForVariant(node);

      const existingByShortName = await logisticsDb.tlkp_rslProduct.findUnique({
        where: { shortName },
        select: { id: true, shortName: true, SKU: true, variantGID: true },
      });

      const existingBySku = sku
        ? await logisticsDb.tlkp_rslProduct.findFirst({
          where: { SKU: sku },
          select: { id: true, shortName: true, SKU: true, variantGID: true },
        })
        : null;

      const existingByVariant = variantGID
        ? await logisticsDb.tlkp_rslProduct.findFirst({
          where: { variantGID },
          select: { id: true, shortName: true, SKU: true, variantGID: true },
        })
        : null;

      const rowVariant = (row) => cleanStr(row?.variantGID);
      const hasSameVariant = (row) => Boolean(variantGID) && rowVariant(row) === variantGID;
      const isLegacyVariantless = (row) => Boolean(row) && !rowVariant(row);

      const canonical =
        existingByVariant ||
        (hasSameVariant(existingByShortName) ? existingByShortName : null) ||
        (hasSameVariant(existingBySku) ? existingBySku : null) ||
        (isLegacyVariantless(existingByShortName) ? existingByShortName : null) ||
        (isLegacyVariantless(existingBySku) ? existingBySku : null) ||
        null;

      let canonicalRow = canonical;
      if (!canonicalRow) {
        // Keep shortName unique even when different variants produce the same text label.
        let candidate = baseShortName;
        const suffixSeed = cleanStr(variantGID).split("/").pop() || cleanStr(node?.title) || "variant";
        const suffix = suffixSeed.slice(-8) || suffixSeed;
        let attempt = 0;

        for (; attempt < 50; attempt += 1) {
          const taken = await logisticsDb.tlkp_rslProduct.findUnique({
            where: { shortName: candidate },
            select: { id: true, shortName: true, SKU: true, variantGID: true },
          });
          if (!taken) {
            shortName = candidate;
            break;
          }
          if (hasSameVariant(taken) || isLegacyVariantless(taken)) {
            canonicalRow = taken;
            shortName = candidate;
            break;
          }
          const suffixPart = attempt === 0 ? suffix : `${suffix}-${attempt + 1}`;
          candidate = `${baseShortName} (${suffixPart})`;
        }

        if (!shortName) shortName = candidate;
      } else {
        shortName = canonicalRow.shortName || baseShortName;
      }

      if (!canonicalRow) {
        const createdRow = await logisticsDb.tlkp_rslProduct.create({
          data: {
            shortName,
            displayName,
            SKU: sku,
            variantGID,
          },
          select: { shortName: true },
        });
        keepShortNames.add(cleanStr(createdRow?.shortName) || shortName);
        created += 1;
        continue;
      }

      // If another row currently owns this SKU/variantGID, move that value away first so
      // canonical update can succeed without unique-key collisions.
      const conflicts = new Map();
      if (sku && existingBySku && existingBySku.id !== canonicalRow.id) conflicts.set(existingBySku.id, existingBySku);
      if (existingByVariant && existingByVariant.id !== canonicalRow.id) conflicts.set(existingByVariant.id, existingByVariant);

      for (const conflict of conflicts.values()) {
        const conflictData = {};

        if (sku && existingBySku && conflict.id === existingBySku.id) {
          conflictData.SKU = `${existingBySku.SKU}__conflict__${conflict.id}__${Date.now()}`;
        }
        if (existingByVariant && conflict.id === existingByVariant.id) {
          conflictData.variantGID = null;
        }

        if (Object.keys(conflictData).length) {
          await logisticsDb.tlkp_rslProduct.update({
            where: { id: conflict.id },
            data: conflictData,
          });
        }
      }

      const canonicalData = {
        displayName,
        SKU: sku,
        variantGID,
      };

      if (canonicalRow.shortName !== shortName) {
        const shortNameTaken = await logisticsDb.tlkp_rslProduct.findUnique({
          where: { shortName },
          select: { id: true },
        });
        if (!shortNameTaken || shortNameTaken.id === canonicalRow.id) {
          canonicalData.shortName = shortName;
        }
      }

      const updatedRow = await logisticsDb.tlkp_rslProduct.update({
        where: { id: canonicalRow.id },
        data: canonicalData,
        select: { shortName: true },
      });
      keepShortNames.add(cleanStr(updatedRow?.shortName) || cleanStr(canonicalData.shortName) || canonicalRow.shortName);
      updated += 1;
    }
  }

  // Remove rows that no longer match refresh criteria/selection rules.
  const existingRows = await logisticsDb.tlkp_rslProduct.findMany({
    select: { id: true, shortName: true, variantGID: true },
  });
  const [poRefs, containerRefs] = await Promise.all([
    logisticsDb.tbljn_purchaseOrder_rslProduct.findMany({
      select: { rslProductID: true },
    }),
    logisticsDb.tbljn_container_purchaseOrder_rslProduct.findMany({
      select: { rslProductID: true },
    }),
  ]);
  const protectedShortNames = new Set(
    uniqStrings([
      ...(poRefs || []).map((row) => cleanStr(row?.rslProductID)),
      ...(containerRefs || []).map((row) => cleanStr(row?.rslProductID)),
    ])
  );

  const staleIds = existingRows
    .filter((row) => {
      const rowVariant = cleanStr(row.variantGID);
      const rowShortName = cleanStr(row.shortName);
      if (protectedShortNames.has(rowShortName)) return false;
      if (rowVariant && keepVariantGIDs.has(rowVariant)) return false;
      if (keepShortNames.has(rowShortName)) return false;
      return true;
    })
    .map((row) => row.id);

  if (staleIds.length) {
    const deleteResult = await logisticsDb.tlkp_rslProduct.deleteMany({
      where: { id: { in: staleIds } },
    });
    deleted = Number(deleteResult?.count || 0);
  }

  return {
    created,
    updated,
    deleted,
    skipped,
    missingSkuCount: missingSku.length,
  };
}

function shopFromUrlString(urlStr) {
  try {
    const u = new URL(urlStr);
    const shop = u.searchParams.get("shop");
    return shop ? String(shop).trim() : null;
  } catch {
    return null;
  }
}

async function resolveShopForAdmin(request) {
  const shopFromQuery = shopFromUrlString(request.url);
  const shopFromHeader = request.headers.get("x-shopify-shop-domain");

  if (shopFromQuery) return shopFromQuery;
  if (shopFromHeader) return shopFromHeader;

  // Fallback: most recent offline session in the Session table
  const sess = await prisma.session.findFirst({
    where: { isOnline: false },
    orderBy: [{ expires: "desc" }],
  });

  return sess?.shop || null;
}

function resolveCompanyIDFromAny(payloadOrPo, fallback) {
  return cleanStrOrNull(
    payloadOrPo?.companyID ??
    payloadOrPo?.companyId ??
    payloadOrPo?.companyShortName ??
    payloadOrPo?.company ??
    fallback ??
    null,
  );
}

async function getCompanySummaryByShortName(tx, shortName) {
  if (!shortName) return null;
  return tx.tlkp_company.findUnique({
    where: { shortName },
    select: { shortName: true, displayName: true },
  });
}

async function getDeliveryAddressSummaryByShortName(tx, shortName) {
  if (!shortName) return null;
  return tx.tlkp_deliveryAddress.findUnique({
    where: { shortName },
    select: { shortName: true, displayName: true },
  });
}

function uniqStrings(arr) {
  const seen = new Set();
  const out = [];
  for (const v of arr || []) {
    const s = String(v ?? "").trim();
    if (!s) continue;
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

function extractSelectedProductIDs(purchaseOrder) {
  const raw = Array.isArray(purchaseOrder?.products) ? purchaseOrder.products : [];
  const ids = raw
    .map((p) =>
      cleanStrOrNull(
        p?.rslProductID ??
        p?.rslModelID ??
        p?.shortName ??
        p?.id ??
        null,
      ),
    )
    .filter((id) => !isPlaceholderProductId(id))
    .filter(Boolean);

  return uniqStrings(ids);
}

function extractSelectedProductQuantityById(purchaseOrder) {
  const out = new Map();
  const raw = Array.isArray(purchaseOrder?.products) ? purchaseOrder.products : [];
  for (const p of raw) {
    const id = cleanStrOrNull(
      p?.rslProductID ??
      p?.rslModelID ??
      p?.shortName ??
      p?.id ??
      null,
    );
    if (id && isPlaceholderProductId(id)) continue;
    if (!id) continue;

    const qtyRaw = Number(p?.quantity);
    const qty = Number.isFinite(qtyRaw) ? Math.max(0, Math.trunc(qtyRaw)) : 0;
    out.set(id, (out.get(id) || 0) + qty);
  }
  return out;
}

function extractUnresolvedProductsForSkuFallback(purchaseOrder) {
  const out = [];
  const raw = Array.isArray(purchaseOrder?.products) ? purchaseOrder.products : [];

  for (const p of raw) {
    const id = cleanStrOrNull(
      p?.rslProductID ??
      p?.rslModelID ??
      p?.shortName ??
      p?.id ??
      null,
    );
    if (id && !isPlaceholderProductId(id)) continue;

    const sku = cleanStrOrNull(p?.SKU ?? p?.sku ?? null);
    if (!sku) continue;

    const qtyRaw = Number(p?.quantity);
    const quantity = Number.isFinite(qtyRaw) ? Math.max(0, Math.trunc(qtyRaw)) : 0;
    out.push({ sku, quantity });
  }

  return out;
}

function extractUnresolvedProductsForTitleFallback(purchaseOrder) {
  const out = [];
  const raw = Array.isArray(purchaseOrder?.products) ? purchaseOrder.products : [];

  for (const p of raw) {
    const id = cleanStrOrNull(
      p?.rslProductID ??
      p?.rslModelID ??
      p?.shortName ??
      p?.id ??
      null,
    );
    if (id && !isPlaceholderProductId(id)) continue;

    // SKU fallback handles rows with SKU. Title fallback is primarily for no-SKU rows.
    const sku = cleanStrOrNull(p?.SKU ?? p?.sku ?? null);
    if (sku) continue;

    const title = sanitizeProductTitleText(p?.title ?? p?.displayName ?? null);
    if (!title) continue;

    const qtyRaw = Number(p?.quantity);
    const quantity = Number.isFinite(qtyRaw) ? Math.max(0, Math.trunc(qtyRaw)) : 0;
    out.push({ title, quantity });
  }

  return out;
}

async function addSkuFallbackMatchesIntoSelection(selectedProductQtyById, unresolvedRows) {
  if (!(selectedProductQtyById instanceof Map) || !Array.isArray(unresolvedRows) || unresolvedRows.length === 0) {
    return;
  }

  const rslProducts = await logisticsDb.tlkp_rslProduct.findMany({
    select: { shortName: true, SKU: true },
  });

  const bySku = new Map();
  for (const p of rslProducts || []) {
    const rawSku = cleanStr(p?.SKU).toUpperCase().replace(/\s+/g, "");
    const skuKey = normalizeSkuForMatch(rawSku);
    if (!skuKey) continue;
    if (!bySku.has(skuKey)) bySku.set(skuKey, []);
    bySku.get(skuKey).push({ shortName: p.shortName, rawSku });
  }

  for (const row of unresolvedRows) {
    const inputRawSku = cleanStr(row?.sku).toUpperCase().replace(/\s+/g, "");
    const skuKey = normalizeSkuForMatch(inputRawSku);
    if (!skuKey) continue;

    const candidates = bySku.get(skuKey) || [];
    const matched = candidates.find((c) => c.rawSku === inputRawSku) || candidates[0] || null;
    if (!matched?.shortName) continue;

    const qtyRaw = Number(row?.quantity);
    const quantity = Number.isFinite(qtyRaw) ? Math.max(0, Math.trunc(qtyRaw)) : 0;
    selectedProductQtyById.set(
      matched.shortName,
      (selectedProductQtyById.get(matched.shortName) || 0) + quantity
    );
  }
}

async function addTitleFallbackMatchesIntoSelection(selectedProductQtyById, unresolvedRows) {
  if (!(selectedProductQtyById instanceof Map) || !Array.isArray(unresolvedRows) || unresolvedRows.length === 0) {
    return;
  }

  const rslProducts = await logisticsDb.tlkp_rslProduct.findMany({
    select: { shortName: true, displayName: true, SKU: true },
  });
  const byTitle = buildTitleLookup(rslProducts);

  for (const row of unresolvedRows) {
    const titleMatch = findTitleMatch(row?.title, byTitle);
    const matchedId = cleanStrOrNull(titleMatch?.matched?.shortName);
    if (!matchedId) continue;

    const qtyRaw = Number(row?.quantity);
    const quantity = Number.isFinite(qtyRaw) ? Math.max(0, Math.trunc(qtyRaw)) : 0;
    selectedProductQtyById.set(
      matchedId,
      (selectedProductQtyById.get(matchedId) || 0) + quantity
    );
  }
}

async function buildPdfRefillDataFromBuffer(pdfBuffer) {
  const headerMeta = (() => {
    try {
      return extractPurchaseOrderHeaderMetaFromPdfBuffer(pdfBuffer) || {
        purchaseOrderNumber: null,
        originalPoDate: null,
        originalPoDateText: null,
      };
    } catch {
      return {
        purchaseOrderNumber: null,
        originalPoDate: null,
        originalPoDateText: null,
      };
    }
  })();

  let extractedProducts = [];
  try {
    extractedProducts = extractPurchaseOrderProductsFromPdfBuffer(pdfBuffer);
  } catch {
    extractedProducts = [];
  }

  const rslProducts = await logisticsDb.tlkp_rslProduct.findMany({
    select: { shortName: true, displayName: true, SKU: true },
  });
  const { bySku } = buildSkuLookup(rslProducts);
  const byTitle = buildTitleLookup(rslProducts);

  const lineItems = [];
  const matchedProductQtyById = new Map();
  for (const item of extractedProducts || []) {
    const skuMatch = findSkuMatch(item?.sku, bySku);
    let matched = skuMatch.matched;
    let titleMatched = false;
    if (!matched) {
      const titleMatch = findTitleMatch(item?.title, byTitle);
      if (titleMatch?.matched) {
        matched = titleMatch.matched;
        titleMatched = true;
      }
    }
    const matchedId = cleanStrOrNull(matched?.shortName);

    const qtyRaw = Number(item?.quantity);
    const quantity = Number.isFinite(qtyRaw) ? Math.max(0, Math.trunc(qtyRaw)) : 0;
    if (matchedId) {
      matchedProductQtyById.set(
        matchedId,
        (matchedProductQtyById.get(matchedId) || 0) + quantity
      );
    }

    lineItems.push({
      title: cleanStrOrNull(item?.title) || null,
      sku: cleanStrOrNull(item?.sku),
      quantity,
      rslProductID: matchedId,
      matchReason: titleMatched ? "title" : (skuMatch.skuKey ? "sku" : null),
    });
  }

  let matchedCompanyID = null;
  try {
    const supplier = normalizeSupplierCandidate(extractPurchaseOrderSupplierFromPdfBuffer(pdfBuffer));
    if (supplier?.name) {
      const companies = await logisticsDb.tlkp_company.findMany({
        select: { shortName: true, displayName: true },
      });
      const matchedCompany = pickCompanyMatch(companies, supplier.name);
      matchedCompanyID = cleanStrOrNull(matchedCompany?.shortName);
    }
  } catch {
    matchedCompanyID = null;
  }

  let matchedDeliveryAddressID = null;
  try {
    const shipTo = normalizeShipToCandidate(extractPurchaseOrderShipToFromPdfBuffer(pdfBuffer));
    if (shipTo?.displayName) {
      const deliveryAddresses = await logisticsDb.tlkp_deliveryAddress.findMany({
        select: { shortName: true, displayName: true },
      });
      const matchedDeliveryAddress = pickDeliveryAddressMatch(deliveryAddresses, shipTo.displayName);
      matchedDeliveryAddressID = cleanStrOrNull(matchedDeliveryAddress?.shortName);
    }
  } catch {
    matchedDeliveryAddressID = null;
  }

  return {
    headerMeta,
    matchedProductQtyById,
    matchedProductIDs: uniqStrings(Array.from(matchedProductQtyById.keys())),
    lineItems: normalizePoLineItemsSnapshot(lineItems),
    matchedCompanyID,
    matchedDeliveryAddressID,
  };
}

function toUiNote(n) {
  const timestampIso = n.createdAt
    ? new Date(n.createdAt).toISOString()
    : new Date().toISOString();

  return {
    id: String(n.id),
    timestamp: timestampIso,
    content: n.content || "",
    eventType: n.eventType || null,
    pdfUrl: n.pdfUrl || null,
    pdfFileName: n.pdfFileName || null,
    user: n.tbl_logisticsUser?.displayName || null,
  };
}

function poProductKey(purchaseOrderGID, rslProductID) {
  return `${String(purchaseOrderGID || "").trim()}::${String(rslProductID || "").trim()}`;
}

function toUiPO(po, company, deliveryAddress = null, committedByPoProduct = null, productLookup = null) {
  const rawNotes = Array.isArray(po.tbl_purchaseOrderNotes) ? po.tbl_purchaseOrderNotes : [];
  const snapshotNote = rawNotes.find((n) => cleanStr(n?.eventType) === PO_LINE_ITEMS_SNAPSHOT_EVENT) || null;
  const snapshotLineItems = parsePoLineItemsSnapshot(snapshotNote?.content);

  const notes = rawNotes
    .filter((n) => cleanStr(n?.eventType) !== PO_LINE_ITEMS_SNAPSHOT_EVENT)
    .map(toUiNote);

  const joinedProducts = Array.isArray(po.tbljn_purchaseOrder_rslProduct)
    ? po.tbljn_purchaseOrder_rslProduct
    : [];
  const joinMetaById = new Map(
    joinedProducts.map((l) => [
      cleanStr(l?.rslProductID),
      {
        shortName: l?.tlkp_rslProduct?.shortName || l?.rslProductID || null,
        displayName: l?.tlkp_rslProduct?.displayName || l?.rslProductID || null,
        sku: l?.tlkp_rslProduct?.SKU || null,
        initialQuantity: Number.isFinite(Number(l?.initialQuantity)) ? Math.max(0, Math.trunc(Number(l.initialQuantity))) : 0,
        committedQuantity: Number.isFinite(
          Number(committedByPoProduct?.get(poProductKey(po?.purchaseOrderGID, l?.rslProductID)))
        )
          ? Math.max(
            0,
            Math.trunc(Number(committedByPoProduct?.get(poProductKey(po?.purchaseOrderGID, l?.rslProductID))) || 0)
          )
          : Number.isFinite(Number(l?.committedQuantity))
            ? Math.max(0, Math.trunc(Number(l.committedQuantity)))
            : 0,
      },
    ])
  );

  const products = snapshotLineItems.length
    ? snapshotLineItems.map((row, idx) => {
      const snapshotMappedId = cleanStrOrNull(row?.rslProductID);
      let mappedId = snapshotMappedId;
      let fallbackMatchedProduct = null;
      const byShortName = productLookup?.byShortName instanceof Set ? productLookup.byShortName : null;
      const snapshotMappedIdLooksUsable = Boolean(
        mappedId && (joinMetaById.has(mappedId) || (byShortName ? byShortName.has(mappedId) : false))
      );
      if (!snapshotMappedIdLooksUsable) {
        mappedId = null;
      }
      if (!mappedId && productLookup) {
        const skuMatch = findSkuMatch(row?.sku, productLookup.bySku);
        fallbackMatchedProduct = skuMatch.matched;
        if (!fallbackMatchedProduct) {
          fallbackMatchedProduct = findTitleMatch(row?.title, productLookup.byTitle)?.matched || null;
        }
        mappedId = cleanStrOrNull(fallbackMatchedProduct?.shortName);
      }

      const joinMeta = mappedId ? joinMetaById.get(mappedId) : null;
      const canonicalTitle = sanitizeProductTitleText(joinMeta?.displayName);
      const fallbackTitle = sanitizeProductTitleText(row?.title) || `Line ${idx + 1}`;
      const title =
        canonicalTitle ||
        sanitizeProductTitleText(fallbackMatchedProduct?.displayName) ||
        (mappedId ? mappedId : fallbackTitle);
      const qtyRaw = Number(row?.quantity);
      const quantity = Number.isFinite(qtyRaw) ? Math.max(0, Math.trunc(qtyRaw)) : 0;
      const committedQuantity = Number.isFinite(Number(joinMeta?.committedQuantity))
        ? Math.max(0, Math.trunc(Number(joinMeta?.committedQuantity)))
        : 0;
      return {
        rslModelID: mappedId || "",
        rslProductID: mappedId || null,
        shortName: mappedId || "",
        displayName: title,
        title,
        SKU: cleanStrOrNull(row?.sku) || joinMeta?.sku || cleanStrOrNull(fallbackMatchedProduct?.SKU) || null,
        initialQuantity: quantity,
        committedQuantity,
        // keep legacy quantity for existing UI consumers
        quantity,
      };
    })
    : joinedProducts.map((l) => ({
      rslModelID: l.rslProductID,
      rslProductID: l.rslProductID,
      shortName: l.tlkp_rslProduct?.shortName || l.rslProductID,
      displayName: sanitizeProductTitleText(l.tlkp_rslProduct?.displayName) || l.rslProductID,
      title: sanitizeProductTitleText(l.tlkp_rslProduct?.displayName) || l.rslProductID,
      SKU: l.tlkp_rslProduct?.SKU || null,
      initialQuantity: typeof l.initialQuantity === "number" ? l.initialQuantity : 0,
      committedQuantity: Number.isFinite(
        Number(committedByPoProduct?.get(poProductKey(po?.purchaseOrderGID, l?.rslProductID)))
      )
        ? Math.max(
          0,
          Math.trunc(Number(committedByPoProduct?.get(poProductKey(po?.purchaseOrderGID, l?.rslProductID))) || 0)
        )
        : (typeof l.committedQuantity === "number" ? l.committedQuantity : 0),
      // keep legacy quantity for existing UI consumers
      quantity: typeof l.initialQuantity === "number" ? l.initialQuantity : 0,
    }));

  const lastUpdatedBy = notes.length > 0 && notes[0].user ? notes[0].user : null;

  return {
    id: po.id,
    shortName: po.shortName,
    purchaseOrderGID: po.purchaseOrderGID,
    purchaseOrderPdfUrl: po.purchaseOrderPdfUrl || null,
    proFormaInvoiceUrl: po.proFormaInvoiceUrl || null,
    originalPoDate: po.originalPoDate ? po.originalPoDate.toISOString() : null,
    createdAt: po.createdAt ? po.createdAt.toISOString() : null,
    updatedAt: po.updatedAt ? po.updatedAt.toISOString() : null,

    products,

    companyID: company?.shortName || null,
    companyName: company?.displayName || company?.shortName || null,
    deliveryAddressID: deliveryAddress?.shortName || po.deliveryAddress || null,
    deliveryAddressName:
      deliveryAddress?.displayName ||
      deliveryAddress?.shortName ||
      null,

    lastUpdatedBy,
    notes,
  };
}

async function selectFullPO(tx, purchaseOrderGID) {
  return tx.tbl_purchaseOrder.findUnique({
    where: { purchaseOrderGID },
    select: {
      id: true,
      shortName: true,
      purchaseOrderGID: true,
      purchaseOrderPdfUrl: true,
      proFormaInvoiceUrl: true,
      originalPoDate: true,
      deliveryAddress: true,
      createdAt: true,
      updatedAt: true,
      tbljn_purchaseOrder_rslProduct: {
        select: {
          rslProductID: true,
          initialQuantity: true,
          committedQuantity: true,
          tlkp_rslProduct: { select: { shortName: true, displayName: true, SKU: true } },
        },
      },
      tbljn_purchaseOrder_company: {
        take: 1,
        select: { tlkp_company: { select: { shortName: true, displayName: true } } },
      },
      tlkp_deliveryAddress: {
        select: { shortName: true, displayName: true },
      },
      tbl_purchaseOrderNotes: {
        orderBy: [{ createdAt: "desc" }],
        select: {
          id: true,
          createdAt: true,
          content: true,
          pdfUrl: true,
          pdfFileName: true,
          eventType: true,
          tbl_logisticsUser: { select: { displayName: true } },
        },
      },
    },
  });
}

/**
 * Shopify staged upload + fileCreate
 *
 * Shopify returns GCS v4 signed URLs. The `parameters` array contains metadata
 * like content_type and acl that were used to generate the signature, but these
 * are NOT form fields to POST. Instead, we must PUT the raw file body directly.
 *
 * The signature only covers the `host` header (X-Goog-SignedHeaders=host),
 * so we must NOT add any other headers like Content-Type.
 */
async function uploadPdfToShopifyFiles({ shop, file }) {
  const filename = file.name || "purchase-order.pdf";
  const mimeType = file.type || "application/pdf";
  const fileSize = typeof file.size === "number" ? String(file.size) : undefined;

  const STAGED_UPLOAD = `
    mutation stagedUploadsCreate($input: [StagedUploadInput!]!) {
      stagedUploadsCreate(input: $input) {
        stagedTargets {
          url
          resourceUrl
          parameters { name value }
        }
        userErrors { field message }
      }
    }
  `;

  const stagedResp = await runAdminQuery(shop, STAGED_UPLOAD, {
    input: [
      {
        filename,
        mimeType,
        resource: "FILE",
        ...(fileSize ? { fileSize } : {}),
      },
    ],
  });

  const stagedApiErrors = Array.isArray(stagedResp?.errors)
    ? stagedResp.errors
    : stagedResp?.errors
      ? [stagedResp.errors]
      : [];
  if (stagedApiErrors.length) {
    const msg = stagedApiErrors.map((e) => e?.message || "Shopify error").join("; ");
    throw new Error(msg || "stagedUploadsCreate failed.");
  }

  const stagedErrs = stagedResp?.data?.stagedUploadsCreate?.userErrors || [];
  if (stagedErrs.length) throw new Error(stagedErrs[0]?.message || "stagedUploadsCreate failed.");

  const target = stagedResp?.data?.stagedUploadsCreate?.stagedTargets?.[0];
  if (!target?.url || !target?.resourceUrl) throw new Error("Missing staged upload target.");

  // --- Upload to staged target ---
  const buf = Buffer.from(await file.arrayBuffer());
  const uploadRes = await fetch(String(target.url), {
    method: "PUT",
    body: buf,
    // NO headers - signature only covers 'host' header which is added automatically
  });

  if (!uploadRes.ok) {
    const text = await uploadRes.text().catch(() => "");
    throw new Error(`Staged upload failed: ${uploadRes.status} ${text}`.trim());
  }

  // --- Create Shopify file record pointing at staged resourceUrl ---
  const FILE_CREATE = `
    mutation fileCreate($files: [FileCreateInput!]!) {
      fileCreate(files: $files) {
        files {
          ... on GenericFile { id url }
        }
        userErrors { field message }
      }
    }
  `;

  const createResp = await runAdminQuery(shop, FILE_CREATE, {
    files: [{ originalSource: target.resourceUrl, contentType: "FILE" }],
  });

  const createErrs = createResp?.data?.fileCreate?.userErrors || [];
  if (createErrs.length) throw new Error(createErrs[0]?.message || "fileCreate failed.");

  const created = createResp?.data?.fileCreate?.files?.[0];
  const fileId = created?.id || null;
  let url = created?.url || null;

  // Sometimes url can lag briefly; do a short poll if needed
  if (fileId && !url) {
    const NODE_QUERY = `
      query node($id: ID!) {
        node(id: $id) {
          ... on GenericFile { url }
        }
      }
    `;

    for (let i = 0; i < 6; i++) {
      await new Promise((r) => setTimeout(r, 450));
      const n = await runAdminQuery(shop, NODE_QUERY, { id: fileId });
      url = n?.data?.node?.url || null;
      if (url) break;
    }
  }

  if (!url) throw new Error("Upload completed but no CDN URL available yet.");
  return url;
}

// -------------------- LOADER --------------------
export async function loader({ request }) {
  const userOrRes = await ensureLogisticsUserOrJson(request);
  if (userOrRes instanceof Response) return userOrRes;
  const user = userOrRes;

  const url = new URL(request.url);
  const intent = String(url.searchParams.get("intent") || "").trim();
  const rawUserType = String(user?.userType || "").trim().toLowerCase();
  const isSupplier = rawUserType.includes("supplier");
  const supplierCompanyID = cleanStrOrNull(user?.companyID);

  // default to list
  if (!intent || intent === "list") {
    const allocationRows = await logisticsDb.tbljn_container_purchaseOrder_rslProduct.findMany({
      select: { purchaseOrderGID: true, rslProductID: true, quantity: true },
    });
    const committedByPoProduct = new Map();
    for (const row of allocationRows || []) {
      const key = poProductKey(row?.purchaseOrderGID, row?.rslProductID);
      if (!key || key === "::") continue;
      const qty = Number(row?.quantity) || 0;
      if (qty <= 0) continue;
      committedByPoProduct.set(key, (committedByPoProduct.get(key) || 0) + qty);
    }

    const rows = await logisticsDb.tbl_purchaseOrder.findMany({
      where:
        isSupplier
          ? {
              tbljn_purchaseOrder_company: {
                some: { companyID: supplierCompanyID || "__NO_SUPPLIER_COMPANY__" },
              },
            }
          : undefined,
      orderBy: [{ createdAt: "desc" }],
      select: {
        id: true,
        shortName: true,
        purchaseOrderGID: true,
        purchaseOrderPdfUrl: true,
        proFormaInvoiceUrl: true,
        originalPoDate: true,
        deliveryAddress: true,
        createdAt: true,
        updatedAt: true,
        tbljn_purchaseOrder_rslProduct: {
          select: {
            rslProductID: true,
            initialQuantity: true,
            committedQuantity: true,
            tlkp_rslProduct: { select: { shortName: true, displayName: true, SKU: true } },
          },
        },
        tbljn_purchaseOrder_company: {
          take: 1,
          select: { tlkp_company: { select: { shortName: true, displayName: true } } },
        },
        tlkp_deliveryAddress: {
          select: { shortName: true, displayName: true },
        },
        tbl_purchaseOrderNotes: {
          orderBy: [{ createdAt: "desc" }],
          select: {
            id: true,
            createdAt: true,
            content: true,
            pdfUrl: true,
            pdfFileName: true,
            eventType: true,
            tbl_logisticsUser: { select: { displayName: true } },
          },
        },
      },
    });

    const rslProductsForFallback = await logisticsDb.tlkp_rslProduct.findMany({
      select: { shortName: true, displayName: true, SKU: true },
    });
    const productLookup = {
      bySku: buildSkuLookup(rslProductsForFallback).bySku,
      byTitle: buildTitleLookup(rslProductsForFallback),
      byShortName: new Set(
        (rslProductsForFallback || [])
          .map((row) => cleanStr(row?.shortName))
          .filter(Boolean)
      ),
    };

    const purchaseOrders = rows.map((po) => {
      const company = po.tbljn_purchaseOrder_company?.[0]?.tlkp_company || null;
      const deliveryAddress = po.tlkp_deliveryAddress || null;
      return toUiPO(po, company, deliveryAddress, committedByPoProduct, productLookup);
    });

    return json({ ok: true, purchaseOrders });
  }

  return json({ ok: false, error: `Unknown loader intent: ${intent}` }, { status: 400 });
}

// -------------------- ACTION --------------------
export async function action({ request }) {
  const userOrRes = await ensureLogisticsUserOrJson(request);
  if (userOrRes instanceof Response) return userOrRes;
  const user = userOrRes;
  const rawUserType = String(user?.userType || "").trim().toLowerCase();
  const isSupplier = rawUserType.includes("supplier");
  const supplierCompanyID = cleanStrOrNull(user?.companyID);

  try {
    const contentType = request.headers.get("content-type") || "";

    // ----- MULTIPART: create / update with optional pdf + note -----
    if (contentType.includes("multipart/form-data")) {
      const formData = await request.formData();
      const intent = cleanStrOrNull(formData.get("intent"));

      if (isSupplier) {
        if (intent !== "supplier-update-proforma") {
          return json({ ok: false, error: "Not authorized." }, { status: 403 });
        }
        if (!supplierCompanyID) {
          return json({ ok: false, error: "Supplier account is not linked to a company." }, { status: 403 });
        }

        const allowedSupplierKeys = new Set(["intent", "purchaseOrderGID", "note", "proFormaPdf"]);
        for (const [rawKey] of formData.entries()) {
          const key = cleanStr(rawKey);
          if (!allowedSupplierKeys.has(key)) {
            return json({ ok: false, error: "Not authorized." }, { status: 403 });
          }
        }

        const purchaseOrderGID = cleanStrOrNull(formData.get("purchaseOrderGID"));
        const note = cleanStrOrNull(formData.get("note"));
        const proFormaPdf = formData.get("proFormaPdf");
        const hasProFormaPdf =
          proFormaPdf &&
          typeof proFormaPdf === "object" &&
          typeof proFormaPdf.arrayBuffer === "function";
        const proFormaFile = hasProFormaPdf ? proFormaPdf : null;

        if (!purchaseOrderGID) {
          return json({ ok: false, error: "purchaseOrderGID is required for update." }, { status: 400 });
        }
        if (!proFormaFile) {
          return json({ ok: false, error: "Pro Forma Invoice PDF is required." }, { status: 400 });
        }
        if (!note) {
          return json(
            { ok: false, error: "A note is required when uploading a new Pro Forma Invoice." },
            { status: 400 },
          );
        }

        const name = String(proFormaFile.name || "");
        const type = String(proFormaFile.type || "");
        const looksPdf = type === "application/pdf" || name.toLowerCase().endsWith(".pdf");
        if (!looksPdf) {
          return json({ ok: false, error: "Only PDF uploads are supported." }, { status: 400 });
        }
        const maxBytes = 20 * 1024 * 1024;
        if (typeof proFormaFile.size === "number" && proFormaFile.size > maxBytes) {
          return json({ ok: false, error: "PDF is too large (max 20MB)." }, { status: 400 });
        }

        const shop = await resolveShopForAdmin(request);
        if (!shop) {
          return json(
            {
              ok: false,
              error:
                "Missing shop context for Shopify Admin API. Include ?shop=... on the request (or ensure an offline session exists).",
            },
            { status: 400 },
          );
        }

        const proFormaUrl = await uploadPdfToShopifyFiles({ shop, file: proFormaFile });

        const updated = await logisticsDb.$transaction(async (tx) => {
          const existing = await tx.tbl_purchaseOrder.findFirst({
            where: {
              purchaseOrderGID,
              tbljn_purchaseOrder_company: {
                some: { companyID: supplierCompanyID },
              },
            },
            select: {
              purchaseOrderGID: true,
            },
          });
          if (!existing) {
            throw new Error("SUPPLIER_PO_FORBIDDEN");
          }

          await tx.tbl_purchaseOrder.update({
            where: { purchaseOrderGID },
            data: {
              updatedAt: new Date(),
              proFormaInvoiceUrl: proFormaUrl,
            },
            select: { purchaseOrderGID: true },
          });

          await tx.tbl_purchaseOrderNotes.create({
            data: {
              purchaseOrderGID,
              userId: Number(user.id),
              content: `Pro Forma Invoice updated. ${note}`,
              pdfUrl: proFormaUrl,
              pdfFileName: String(proFormaFile?.name || "pro-forma-invoice.pdf"),
              eventType: PRO_FORMA_INVOICE_UPDATE_EVENT,
            },
          });

          const full = await selectFullPO(tx, purchaseOrderGID);
          if (!full) throw new Error("Purchase order not found.");
          const company = full?.tbljn_purchaseOrder_company?.[0]?.tlkp_company || null;
          const deliveryAddress = full?.tlkp_deliveryAddress || null;
          return toUiPO(full, company, deliveryAddress);
        });

        return json({ ok: true, purchaseOrder: updated });
      }

      if (intent !== "create" && intent !== "update" && intent !== "analyze-pdf") {
        return json({ ok: false, error: "Unknown multipart intent." }, { status: 400 });
      }

      const purchaseOrderRaw = cleanStrOrNull(formData.get("purchaseOrder"));
      let purchaseOrder = {};
      try {
        purchaseOrder = purchaseOrderRaw ? JSON.parse(purchaseOrderRaw) : {};
      } catch {
        return json({ ok: false, error: "Invalid purchaseOrder payload." }, { status: 400 });
      }

      const fdCompanyID = cleanStrOrNull(formData.get("companyID"));
      const companyID = resolveCompanyIDFromAny(purchaseOrder, fdCompanyID);
      const fdDeliveryAddressID = cleanStrOrNull(formData.get("deliveryAddressID"));

      const note = cleanStrOrNull(formData.get("note"));
      const pdf = formData.get("pdf");
      const proFormaPdf = formData.get("proFormaPdf");
      let uploadedPdfHeaderMeta = null;
      let uploadedPdfBuffer = null;

      const hasPdf = pdf && typeof pdf === "object" && typeof pdf.arrayBuffer === "function";
      const pdfFile = hasPdf ? pdf : null;
      const hasProFormaPdf =
        proFormaPdf &&
        typeof proFormaPdf === "object" &&
        typeof proFormaPdf.arrayBuffer === "function";
      const proFormaFile = hasProFormaPdf ? proFormaPdf : null;

      // PDF validation if present
      if (pdfFile) {
        const name = String(pdfFile.name || "");
        const type = String(pdfFile.type || "");
        const looksPdf = type === "application/pdf" || name.toLowerCase().endsWith(".pdf");
        if (!looksPdf) return json({ ok: false, error: "Only PDF uploads are supported." }, { status: 400 });

        const maxBytes = 20 * 1024 * 1024;
        if (typeof pdfFile.size === "number" && pdfFile.size > maxBytes) {
          return json({ ok: false, error: "PDF is too large (max 20MB)." }, { status: 400 });
        }

        // For create/update saves, enforce the same validation flow used by analyze-pdf.
        if (intent !== "analyze-pdf") {
          const pdfBuffer = Buffer.from(await pdfFile.arrayBuffer());
          uploadedPdfBuffer = pdfBuffer;
          const validation = await validatePurchaseOrderPdfFormatFromPdfBuffer(pdfBuffer);
          if (!validation?.ok) {
            console.warn("[purchase-orders multipart] invalid format", {
              stage: intent,
              fileName: name,
              fileSize: typeof pdfFile.size === "number" ? pdfFile.size : null,
              message: validation?.message || null,
              issues: Array.isArray(validation?.issues) ? validation.issues.slice(0, 10) : [],
            });

            return json(
              {
                ok: false,
                errorCode: "INVALID_PO_FORMAT",
                error: validation?.message || INVALID_PO_FORMAT_MESSAGE,
                validation,
              },
              { status: 400 },
            );
          }

          // Keep table structure check consistent with analyze-pdf flow.
          try {
            extractPurchaseOrderProductsFromPdfBuffer(pdfBuffer);
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return json({ ok: false, error: `Unable to analyze PDF: ${message}` }, { status: 400 });
          }

          uploadedPdfHeaderMeta = extractPurchaseOrderHeaderMetaFromPdfBuffer(pdfBuffer) || null;
          const uploadedPoNumber = cleanStrOrNull(uploadedPdfHeaderMeta?.purchaseOrderNumber);
          const uploadedPoDate = cleanStrOrNull(uploadedPdfHeaderMeta?.originalPoDate);
          if (!uploadedPoNumber || !uploadedPoDate) {
            return json(
              {
                ok: false,
                errorCode: "INVALID_PO_FORMAT",
                error: INVALID_PO_FORMAT_MESSAGE,
                validation: {
                  ok: false,
                  issues: [
                    {
                      type: "header-missing",
                      label: "PO header",
                      detail: "Purchase Order number and date are required in the upper-right header.",
                    },
                  ],
                  message: INVALID_PO_FORMAT_MESSAGE,
                },
              },
              { status: 400 },
            );
          }
        }
      }

      // Pro Forma Invoice validation (file type/size only; no PO template check).
      if (proFormaFile) {
        const name = String(proFormaFile.name || "");
        const type = String(proFormaFile.type || "");
        const looksPdf = type === "application/pdf" || name.toLowerCase().endsWith(".pdf");
        if (!looksPdf) return json({ ok: false, error: "Only PDF uploads are supported." }, { status: 400 });

        const maxBytes = 20 * 1024 * 1024;
        if (typeof proFormaFile.size === "number" && proFormaFile.size > maxBytes) {
          return json({ ok: false, error: "PDF is too large (max 20MB)." }, { status: 400 });
        }
      }

      if (intent === "analyze-pdf") {
        if (!pdfFile) {
          return json({ ok: false, error: "PDF file is required for analysis." }, { status: 400 });
        }

        const pdfFileName = String(pdfFile.name || "");
        const pdfBuffer = Buffer.from(await pdfFile.arrayBuffer());
        const validation = await validatePurchaseOrderPdfFormatFromPdfBuffer(pdfBuffer);
        if (!validation?.ok) {
          console.warn("[purchase-orders analyze-pdf] invalid format", {
            fileName: pdfFileName,
            fileSize: typeof pdfFile.size === "number" ? pdfFile.size : null,
            message: validation?.message || null,
            issues: Array.isArray(validation?.issues) ? validation.issues.slice(0, 10) : [],
          });

          return json(
            {
              ok: false,
              errorCode: "INVALID_PO_FORMAT",
              error:
                validation?.message ||
                INVALID_PO_FORMAT_MESSAGE,
              validation,
            },
            { status: 400 },
          );
        }

        let extractedProducts = [];
        try {
          extractedProducts = extractPurchaseOrderProductsFromPdfBuffer(pdfBuffer);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return json({ ok: false, error: `Unable to analyze PDF: ${message}` }, { status: 400 });
        }

        let supplierCandidate = null;
        try {
          supplierCandidate = normalizeSupplierCandidate(
            extractPurchaseOrderSupplierFromPdfBuffer(pdfBuffer)
          );
        } catch {
          supplierCandidate = null;
        }

        let shipToCandidate = null;
        try {
          shipToCandidate = normalizeShipToCandidate(
            extractPurchaseOrderShipToFromPdfBuffer(pdfBuffer)
          );
        } catch {
          shipToCandidate = null;
        }

        let headerMeta = {
          purchaseOrderNumber: null,
          originalPoDate: null,
          originalPoDateText: null,
        };
        try {
          headerMeta = extractPurchaseOrderHeaderMetaFromPdfBuffer(pdfBuffer) || headerMeta;
        } catch {
          // keep null defaults
        }

        const rslProducts = await logisticsDb.tlkp_rslProduct.findMany({
          select: { shortName: true, displayName: true, SKU: true },
        });
        const { bySku, skuCounts } = buildSkuLookup(rslProducts);
        const byTitle = buildTitleLookup(rslProducts);

        const analyzedProducts = extractedProducts.map((item) => {
          const sku = cleanStr(item?.sku);
          const skuMatch = findSkuMatch(sku, bySku);
          const skuKey = skuMatch.skuKey;
          const normalizedInputSku = skuMatch.normalizedInputSku;
          const matchedEntry = skuMatch.matchedEntry;
          let matched = skuMatch.matched;
          let matchedByTitle = false;
          let matchedByTitleDuplicate = false;
          if (!matched) {
            const titleMatch = findTitleMatch(item?.title, byTitle);
            if (titleMatch?.matched) {
              matched = titleMatch.matched;
              matchedByTitle = true;
              matchedByTitleDuplicate = Boolean(titleMatch.duplicate);
            }
          }
          let matchReasonCode = null;
          let matchReason = null;
          if (matchedByTitle) {
            matchReasonCode = matchedByTitleDuplicate ? "matched-title-duplicate" : "matched-title";
            matchReason = matchedByTitleDuplicate
              ? `Matched by title "${cleanStr(item?.title)}" (multiple title matches; first match was used).`
              : `Matched by title "${cleanStr(item?.title)}".`;
          } else if (!matched) {
            if (!skuKey) {
              matchReasonCode = "no-sku-skip";
              matchReason = `No SKU was found and title "${cleanStr(item?.title)}" did not match tlkp_rslProduct.`;
            } else {
              matchReasonCode = "sku-not-found";
              matchReason = `SKU "${sku}" was not found in tlkp_rslProduct and title "${cleanStr(item?.title)}" did not match.`;
            }
          } else if (matchedEntry?.rawSku !== normalizedInputSku) {
            matchReasonCode = "matched-ignore-7th";
            matchReason = `Matched by SKU "${sku}" with the 7th character ignored.`;
          } else if ((skuCounts.get(skuKey) || 0) > 1) {
            matchReasonCode = "sku-duplicate";
            matchReason = `SKU "${sku}" appears multiple times in tlkp_rslProduct; first match was used.`;
          } else {
            matchReasonCode = "matched";
            matchReason = `Matched by SKU "${sku}".`;
          }

          return {
            title: cleanStr(item?.title),
            sku,
            quantity: typeof item?.quantity === "number" ? item.quantity : null,
            cost: typeof item?.cost === "number" ? item.cost : null,
            rslProductID: matched?.shortName || null,
            rslProductName: matched?.displayName || matched?.shortName || null,
            matchReasonCode,
            matchReason,
          };
        });

        const selectedProductIDs = uniqStrings(
          analyzedProducts.map((p) => cleanStrOrNull(p.rslProductID)).filter(Boolean)
        );
        const unmatchedDiagnostics = analyzedProducts
          .map((p, idx) => {
            const rid = cleanStrOrNull(p?.rslProductID);
            if (rid) return null;
            const reasonCode = cleanStrOrNull(p?.matchReasonCode);
            if (reasonCode === "no-sku-skip") return null;
            return {
              lineNumber: idx + 1,
              title: cleanStrOrNull(p?.title),
              sku: cleanStrOrNull(p?.sku),
              reasonCode,
              reason: cleanStrOrNull(p?.matchReason),
            };
          })
          .filter(Boolean);

        const unmatchedSummary = unmatchedDiagnostics.reduce((acc, row) => {
          const key = cleanStr(row?.reasonCode || "unknown");
          if (!key) return acc;
          acc[key] = (acc[key] || 0) + 1;
          return acc;
        }, {});

        let matchedCompany = null;
        if (supplierCandidate?.name) {
          const companies = await logisticsDb.tlkp_company.findMany({
            select: { shortName: true, displayName: true },
          });
          matchedCompany = pickCompanyMatch(companies, supplierCandidate.name);
        }

        let matchedDeliveryAddress = null;
        if (shipToCandidate?.displayName) {
          const deliveryAddresses = await logisticsDb.tlkp_deliveryAddress.findMany({
            select: { shortName: true, displayName: true },
          });
          matchedDeliveryAddress = pickDeliveryAddressMatch(
            deliveryAddresses,
            shipToCandidate.displayName
          );
        }

        const purchaseOrderGIDCandidate = purchaseOrderGidCandidateFromFilename(pdfFileName);

        return json({
          ok: true,
          analysis: {
            products: analyzedProducts,
            selectedProductIDs,
            extractedCount: extractedProducts.length,
            matchedCount: selectedProductIDs.length,
            validation,
            supplier: supplierCandidate,
            shipTo: shipToCandidate,
            matchedCompany: matchedCompany
              ? {
                shortName: matchedCompany.shortName,
                displayName: matchedCompany.displayName || matchedCompany.shortName,
              }
              : null,
            matchedDeliveryAddress: matchedDeliveryAddress
              ? {
                shortName: matchedDeliveryAddress.shortName,
                displayName:
                  matchedDeliveryAddress.displayName || matchedDeliveryAddress.shortName,
              }
              : null,
            purchaseOrderNumberCandidate: cleanStrOrNull(headerMeta?.purchaseOrderNumber),
            originalPoDateCandidate: cleanStrOrNull(headerMeta?.originalPoDate),
            originalPoDateTextCandidate: cleanStrOrNull(headerMeta?.originalPoDateText),
            purchaseOrderGIDCandidate,
            unmatchedDiagnostics,
            unmatchedSummary,
          },
        });
      }

      const shortName = cleanStrOrNull(purchaseOrder?.shortName);
      const purchaseOrderGID = cleanStrOrNull(purchaseOrder?.purchaseOrderGID);
      const selectedProductQtyById = extractSelectedProductQuantityById(purchaseOrder);
      const unresolvedSkuRows = extractUnresolvedProductsForSkuFallback(purchaseOrder);
      if (unresolvedSkuRows.length) {
        await addSkuFallbackMatchesIntoSelection(selectedProductQtyById, unresolvedSkuRows);
      }
      const unresolvedTitleRows = extractUnresolvedProductsForTitleFallback(purchaseOrder);
      if (unresolvedTitleRows.length) {
        await addTitleFallbackMatchesIntoSelection(selectedProductQtyById, unresolvedTitleRows);
      }
      const selectedProductIDs = uniqStrings([
        ...extractSelectedProductIDs(purchaseOrder),
        ...Array.from(selectedProductQtyById.keys()),
      ]);
      let updatePoLineItems = normalizePoLineItemsSnapshot(purchaseOrder?.products);
      const originalPoDateRaw = cleanStrOrNull(purchaseOrder?.originalPoDate);
      const originalPoDate = originalPoDateRaw ? new Date(originalPoDateRaw) : null;
      const deliveryAddressID = cleanStrOrNull(
        purchaseOrder?.deliveryAddressID ??
        purchaseOrder?.deliveryAddress ??
        fdDeliveryAddressID ??
        null
      );

      if (originalPoDateRaw && (!originalPoDate || Number.isNaN(originalPoDate.getTime()))) {
        return json({ ok: false, error: "originalPoDate is invalid." }, { status: 400 });
      }

      let updateShortName = shortName;
      let updatePurchaseOrderGID = purchaseOrderGID;
      let updateOriginalPoDate = originalPoDate;
      let updateCompanyID = companyID;
      let updateDeliveryAddressID = deliveryAddressID;
      let updateSelectedProductIDs = selectedProductIDs.slice();
      let updateSelectedProductQtyById = new Map(selectedProductQtyById);

      if ((intent === "create" || intent === "update") && uploadedPdfBuffer) {
        const refill = await buildPdfRefillDataFromBuffer(uploadedPdfBuffer);

        const refillPoNumber = cleanStrOrNull(refill?.headerMeta?.purchaseOrderNumber);
        if (refillPoNumber && !cleanStr(updateShortName)) {
          updateShortName = refillPoNumber;
        }

        if (intent === "create" && pdfFile) {
          const refillPoGid = purchaseOrderGidCandidateFromFilename(String(pdfFile.name || ""));
          if (refillPoGid) {
            updatePurchaseOrderGID = refillPoGid;
          }
        }

        const refillOriginalPoDateRaw = cleanStrOrNull(refill?.headerMeta?.originalPoDate);
        if (refillOriginalPoDateRaw) {
          const refillDate = new Date(refillOriginalPoDateRaw);
          if (!Number.isNaN(refillDate.getTime())) {
            updateOriginalPoDate = refillDate;
          }
        }

        const matchedCompanyID = cleanStrOrNull(refill?.matchedCompanyID);
        if (matchedCompanyID) {
          updateCompanyID = matchedCompanyID;
        }

        const matchedDeliveryAddressID = cleanStrOrNull(refill?.matchedDeliveryAddressID);
        if (matchedDeliveryAddressID) {
          updateDeliveryAddressID = matchedDeliveryAddressID;
        }

        if (Array.isArray(refill?.matchedProductIDs)) {
          updateSelectedProductIDs = refill.matchedProductIDs;
          updateSelectedProductQtyById = refill.matchedProductQtyById;
        }
        if (Array.isArray(refill?.lineItems)) {
          updatePoLineItems = normalizePoLineItemsSnapshot(refill.lineItems);
        }
      }

      // PO GID field is hidden in UI; when filename parsing cannot provide it,
      // use the PO number as a deterministic fallback.
      if (intent === "create" && !updatePurchaseOrderGID && updateShortName) {
        updatePurchaseOrderGID = updateShortName;
      }

      if (intent === "create") {
        if (!updateShortName) {
          return json({ ok: false, error: "shortName is required." }, { status: 400 });
        }
        if (!updateCompanyID) {
          return json({ ok: false, error: "companyID is required." }, { status: 400 });
        }
        if (!updateDeliveryAddressID) {
          return json({ ok: false, error: "deliveryAddressID is required." }, { status: 400 });
        }

        const needsShopAdmin = Boolean(pdfFile || proFormaFile);
        const shop = needsShopAdmin ? await resolveShopForAdmin(request) : null;
        if (needsShopAdmin && !shop) {
          return json(
            {
              ok: false,
              error:
                "Missing shop context for Shopify Admin API. Include ?shop=... on the request (or ensure an offline session exists).",
            },
            { status: 400 },
          );
        }

        const created = await logisticsDb.$transaction(async (tx) => {
          const company = await getCompanySummaryByShortName(tx, updateCompanyID);
          if (!company) throw new Error(`Unknown companyID: ${updateCompanyID}`);
          const deliveryAddress = updateDeliveryAddressID
            ? await getDeliveryAddressSummaryByShortName(tx, updateDeliveryAddressID)
            : null;
          if (updateDeliveryAddressID && !deliveryAddress) {
            throw new Error(`Unknown deliveryAddress: ${updateDeliveryAddressID}`);
          }

          // Validate products exist (avoid FK errors and give a clean message)
          const existingProducts = await tx.tlkp_rslProduct.findMany({
            where: { shortName: { in: updateSelectedProductIDs } },
            select: { shortName: true },
          });
          const existingSet = new Set(existingProducts.map((x) => x.shortName));
          const missing = updateSelectedProductIDs.filter((id) => !existingSet.has(id));
          if (missing.length) throw new Error(`Unknown product shortName: ${missing.join(", ")}`);

          let pdfUrl = null;
          if (pdfFile) pdfUrl = await uploadPdfToShopifyFiles({ shop, file: pdfFile });
          let proFormaUrl = null;
          if (proFormaFile) proFormaUrl = await uploadPdfToShopifyFiles({ shop, file: proFormaFile });

          const po = await tx.tbl_purchaseOrder.create({
            data: {
              shortName: updateShortName,
              purchaseOrderGID: updatePurchaseOrderGID,
              purchaseOrderPdfUrl: pdfUrl,
              proFormaInvoiceUrl: proFormaUrl,
              ...(updateOriginalPoDate ? { originalPoDate: updateOriginalPoDate } : {}),
              ...(deliveryAddress ? { deliveryAddress: deliveryAddress.shortName } : {}),
              updatedAt: new Date(),
            },
            select: {
              id: true,
              shortName: true,
              purchaseOrderGID: true,
              purchaseOrderPdfUrl: true,
              proFormaInvoiceUrl: true,
              originalPoDate: true,
              deliveryAddress: true,
              createdAt: true,
              updatedAt: true,
            },
          });

          await tx.tbljn_purchaseOrder_company.create({
            data: { purchaseOrderGID: po.purchaseOrderGID, companyID: company.shortName },
          });

          if (updateSelectedProductIDs.length) {
            await tx.tbljn_purchaseOrder_rslProduct.createMany({
              data: updateSelectedProductIDs.map((rslProductID) => ({
                purchaseOrderGID: po.purchaseOrderGID,
                rslProductID,
                initialQuantity: updateSelectedProductQtyById.get(rslProductID) ?? 0,
                committedQuantity: 0,
              })),
            });
          }

          // Always create a "PO Created" note
          const parts = [];
          if (pdfUrl) parts.push("PDF uploaded");
          if (proFormaUrl) parts.push("Pro Forma Invoice uploaded");
          if (note) parts.push(note);
          const content = parts.join(" - ");

          await tx.tbl_purchaseOrderNotes.create({
            data: {
              purchaseOrderGID: po.purchaseOrderGID,
              userId: Number(user.id),
              content,
              pdfUrl: pdfUrl || null,
              pdfFileName: pdfUrl ? String(pdfFile.name || "purchase-order.pdf") : null,
              eventType: "PO Created",
            },
          });

          if (proFormaUrl) {
            await tx.tbl_purchaseOrderNotes.create({
              data: {
                purchaseOrderGID: po.purchaseOrderGID,
                userId: Number(user.id),
                content: "Pro Forma Invoice uploaded.",
                pdfUrl: proFormaUrl,
                pdfFileName: String(proFormaFile?.name || "pro-forma-invoice.pdf"),
                eventType: PRO_FORMA_INVOICE_UPDATE_EVENT,
              },
            });
          }

          await tx.tbl_purchaseOrderNotes.deleteMany({
            where: { purchaseOrderGID: po.purchaseOrderGID, eventType: PO_LINE_ITEMS_SNAPSHOT_EVENT },
          });
          await tx.tbl_purchaseOrderNotes.create({
            data: {
              purchaseOrderGID: po.purchaseOrderGID,
              userId: Number(user.id),
              content: JSON.stringify({ version: 1, lineItems: updatePoLineItems }),
              eventType: PO_LINE_ITEMS_SNAPSHOT_EVENT,
            },
          });

          const full = await selectFullPO(tx, po.purchaseOrderGID);
          const co = full?.tbljn_purchaseOrder_company?.[0]?.tlkp_company || company;
          const da = full?.tlkp_deliveryAddress || deliveryAddress || null;
          return toUiPO(full, co, da);
        });

        return json({ ok: true, purchaseOrder: created });
      }

      // intent === "update"
      if (!purchaseOrderGID) {
        return json({ ok: false, error: "purchaseOrderGID is required for update." }, { status: 400 });
      }

      if (pdfFile && !note) {
        return json(
          { ok: false, error: "A note is required when uploading a new Purchase Order PDF." },
          { status: 400 },
        );
      }

      if (proFormaFile && !note) {
        return json(
          { ok: false, error: "A note is required when uploading a new Pro Forma Invoice." },
          { status: 400 },
        );
      }

      const needsShopAdmin = Boolean(pdfFile || proFormaFile);
      const shop = needsShopAdmin ? await resolveShopForAdmin(request) : null;
      if (needsShopAdmin && !shop) {
        return json(
          {
            ok: false,
            error:
              "Missing shop context for Shopify Admin API. Include ?shop=... on the request (or ensure an offline session exists).",
          },
          { status: 400 },
        );
      }

      const updated = await logisticsDb.$transaction(async (tx) => {
        const existing = await tx.tbl_purchaseOrder.findUnique({
          where: { purchaseOrderGID },
          select: {
            id: true,
            shortName: true,
            purchaseOrderGID: true,
            purchaseOrderPdfUrl: true,
            proFormaInvoiceUrl: true,
            originalPoDate: true,
            deliveryAddress: true,
            createdAt: true,
            updatedAt: true,
            tbljn_purchaseOrder_company: {
              take: 1,
              select: { tlkp_company: { select: { shortName: true, displayName: true } } },
            },
            tlkp_deliveryAddress: {
              select: { shortName: true, displayName: true },
            },
            tbljn_purchaseOrder_rslProduct: {
              select: { rslProductID: true, initialQuantity: true, committedQuantity: true },
            },
          },
        });
        if (!existing) throw new Error("Purchase order not found.");

        const linkedCompany = existing.tbljn_purchaseOrder_company?.[0]?.tlkp_company || null;

        const beforeQtyById = new Map(
          (existing.tbljn_purchaseOrder_rslProduct || []).map((x) => [x.rslProductID, Number(x.initialQuantity) || 0])
        );
        const beforeSet = new Set((existing.tbljn_purchaseOrder_rslProduct || []).map((x) => x.rslProductID));
        const afterSet = new Set(updateSelectedProductIDs);

        const toRemove = [];
        for (const id of beforeSet) if (!afterSet.has(id)) toRemove.push(id);

        const toAdd = [];
        for (const id of afterSet) if (!beforeSet.has(id)) toAdd.push(id);

        const quantityUpdates = [];
        for (const id of afterSet) {
          if (!beforeSet.has(id)) continue;
          const prevQty = Number(beforeQtyById.get(id) || 0);
          const nextQty = Number(updateSelectedProductQtyById.get(id) || 0);
          if (prevQty !== nextQty) {
            quantityUpdates.push({ rslProductID: id, initialQuantity: nextQty });
          }
        }

        // Validate new products exist before attempting insert
        if (toAdd.length) {
          const existingProducts = await tx.tlkp_rslProduct.findMany({
            where: { shortName: { in: toAdd } },
            select: { shortName: true },
          });
          const okSet = new Set(existingProducts.map((x) => x.shortName));
          const missing = toAdd.filter((id) => !okSet.has(id));
          if (missing.length) throw new Error(`Unknown product shortName: ${missing.join(", ")}`);
        }

        const productsChanged = toAdd.length > 0 || toRemove.length > 0 || quantityUpdates.length > 0;

        let newPdfUrl = null;
        if (pdfFile) newPdfUrl = await uploadPdfToShopifyFiles({ shop, file: pdfFile });
        let newProFormaUrl = null;
        if (proFormaFile) newProFormaUrl = await uploadPdfToShopifyFiles({ shop, file: proFormaFile });
        let nextDeliveryAddress = existing.tlkp_deliveryAddress || null;
        if (updateDeliveryAddressID) {
          nextDeliveryAddress = await getDeliveryAddressSummaryByShortName(tx, updateDeliveryAddressID);
          if (!nextDeliveryAddress) throw new Error(`Unknown deliveryAddress: ${updateDeliveryAddressID}`);
        }

        const po = await tx.tbl_purchaseOrder.update({
          where: { purchaseOrderGID },
          data: {
            updatedAt: new Date(),
            ...(updateShortName ? { shortName: updateShortName } : {}),
            ...(newPdfUrl ? { purchaseOrderPdfUrl: newPdfUrl } : {}),
            ...(newProFormaUrl ? { proFormaInvoiceUrl: newProFormaUrl } : {}),
            ...(updateOriginalPoDate ? { originalPoDate: updateOriginalPoDate } : {}),
            ...(updateDeliveryAddressID ? { deliveryAddress: updateDeliveryAddressID } : {}),
          },
          select: {
            id: true,
            shortName: true,
            purchaseOrderGID: true,
            purchaseOrderPdfUrl: true,
            proFormaInvoiceUrl: true,
            originalPoDate: true,
            deliveryAddress: true,
            createdAt: true,
            updatedAt: true,
          },
        });

        // Backfill / reset company link if missing
        if (
          (!linkedCompany && updateCompanyID) ||
          (linkedCompany && updateCompanyID && linkedCompany.shortName !== updateCompanyID)
        ) {
          const company = await getCompanySummaryByShortName(tx, updateCompanyID);
          if (company) {
            await tx.tbljn_purchaseOrder_company.deleteMany({ where: { purchaseOrderGID } });
            await tx.tbljn_purchaseOrder_company.create({
              data: { purchaseOrderGID, companyID: company.shortName },
            });
          }
        }

        // Sync join table for products
        if (toRemove.length) {
          await tx.tbljn_purchaseOrder_rslProduct.deleteMany({
            where: { purchaseOrderGID, rslProductID: { in: toRemove } },
          });
        }
        if (toAdd.length) {
          await tx.tbljn_purchaseOrder_rslProduct.createMany({
            data: toAdd.map((rslProductID) => ({
              purchaseOrderGID,
              rslProductID,
              initialQuantity: updateSelectedProductQtyById.get(rslProductID) ?? 0,
              committedQuantity: 0,
            })),
            skipDuplicates: true,
          });
        }
        if (quantityUpdates.length) {
          for (const row of quantityUpdates) {
            await tx.tbljn_purchaseOrder_rslProduct.updateMany({
              where: { purchaseOrderGID, rslProductID: row.rslProductID },
              data: { initialQuantity: row.initialQuantity },
            });
          }
        }
        if (updateSelectedProductIDs.length === 0 && beforeSet.size > 0) {
          await tx.tbljn_purchaseOrder_rslProduct.deleteMany({ where: { purchaseOrderGID } });
        }

        // Decide if we need to create a note entry
        const didAnyUpdate = Boolean(note) || Boolean(newPdfUrl) || Boolean(newProFormaUrl) || productsChanged;
        if (!didAnyUpdate) {
          throw new Error("Nothing to update.");
        }

        const baseNoteText = note || (productsChanged ? "Products updated." : "");
        if (newPdfUrl) {
          await tx.tbl_purchaseOrderNotes.create({
            data: {
              purchaseOrderGID,
              userId: Number(user.id),
              content: note ? `Purchase Order PDF updated. ${note}` : "Purchase Order PDF uploaded.",
              pdfUrl: newPdfUrl,
              pdfFileName: String(pdfFile?.name || "purchase-order.pdf"),
              eventType: "PDF_UPDATE",
            },
          });
        }

        if (newProFormaUrl) {
          await tx.tbl_purchaseOrderNotes.create({
            data: {
              purchaseOrderGID,
              userId: Number(user.id),
              content: note ? `Pro Forma Invoice updated. ${note}` : "Pro Forma Invoice uploaded.",
              pdfUrl: newProFormaUrl,
              pdfFileName: String(proFormaFile?.name || "pro-forma-invoice.pdf"),
              eventType: PRO_FORMA_INVOICE_UPDATE_EVENT,
            },
          });
        }

        if (!newPdfUrl && !newProFormaUrl && baseNoteText) {
          await tx.tbl_purchaseOrderNotes.create({
            data: {
              purchaseOrderGID,
              userId: Number(user.id),
              content: baseNoteText,
              pdfUrl: null,
              pdfFileName: null,
              eventType: "NOTE",
            },
          });
        }

        await tx.tbl_purchaseOrderNotes.deleteMany({
          where: { purchaseOrderGID, eventType: PO_LINE_ITEMS_SNAPSHOT_EVENT },
        });
        await tx.tbl_purchaseOrderNotes.create({
          data: {
            purchaseOrderGID,
            userId: Number(user.id),
            content: JSON.stringify({ version: 1, lineItems: updatePoLineItems }),
            eventType: PO_LINE_ITEMS_SNAPSHOT_EVENT,
          },
        });

        const full = await selectFullPO(tx, purchaseOrderGID);
        const co = full?.tbljn_purchaseOrder_company?.[0]?.tlkp_company || linkedCompany;
        const da = full?.tlkp_deliveryAddress || nextDeliveryAddress || null;
        return toUiPO(full, co, da);
      });

      return json({ ok: true, purchaseOrder: updated });
    }

    if (isSupplier) {
      return json({ ok: false, error: "Not authorized." }, { status: 403 });
    }

    // ----- JSON: delete -----
  const payload = await request.json().catch(() => null);
  const intent = cleanStrOrNull(payload?.intent);

  if (!intent) return json({ ok: false, error: "Missing intent." }, { status: 400 });

  if (intent === "refresh-products") {
    const shop = await resolveShopForAdmin(request);
    if (!shop) {
      return json(
        { ok: false, error: "Missing shop context for Shopify Admin API." },
        { status: 400 },
      );
    }

    const result = await syncRslProductsFromShopify(shop);
    return json({ ok: true, ...result });
  }

  if (intent === "create-company-from-pdf-supplier") {
    const supplier = normalizeSupplierCandidate(payload?.supplier);
    if (!supplier?.name) {
      return json(
        { ok: false, error: "Supplier name is required to create a new supplier/company." },
        { status: 400 },
      );
    }

    const result = await logisticsDb.$transaction(async (tx) => {
      const companies = await tx.tlkp_company.findMany({
        select: { shortName: true, displayName: true },
      });

      const existing = pickCompanyMatch(companies, supplier.name);
      if (existing) {
        return {
          company: {
            shortName: existing.shortName,
            displayName: existing.displayName || existing.shortName,
          },
          created: false,
          supplierInsert: { attempted: false, created: false, reason: "matched-existing-company" },
        };
      }

      const baseShortName = companyShortNameBaseFromName(supplier.name);
      const shortName = await nextUniqueCompanyShortName(tx, baseShortName);

      const company = await tx.tlkp_company.create({
        data: {
          shortName,
          displayName: supplier.name,
          ...(supplier.address1 ? { address1: supplier.address1 } : {}),
          ...(supplier.address2 ? { address2: supplier.address2 } : {}),
          ...(supplier.city ? { city: supplier.city } : {}),
          ...(supplier.province ? { province: supplier.province } : {}),
          ...(supplier.postalCode ? { postalCode: supplier.postalCode } : {}),
          ...(supplier.country ? { country: supplier.country } : {}),
          ...(supplier.email ? { primaryEmail: supplier.email } : {}),
          ...(supplier.phone ? { primaryPhone: supplier.phone } : {}),
          ...(supplier.supplierCurrency ? { supplierCurrency: supplier.supplierCurrency } : {}),
        },
        select: { shortName: true, displayName: true },
      });

      const supplierInsert = await insertSupplierRecordBestEffort(tx, supplier, company);
      return {
        company: {
          shortName: company.shortName,
          displayName: company.displayName || company.shortName,
        },
        created: true,
        supplierInsert,
      };
    });

    return json({ ok: true, ...result });
  }

  if (intent === "update-company-from-pdf-supplier") {
    const companyID = cleanStrOrNull(payload?.companyID);
    const supplier = normalizeSupplierCandidate(payload?.supplier);
    if (!companyID) {
      return json({ ok: false, error: "companyID is required." }, { status: 400 });
    }
    if (!supplier?.name) {
      return json({ ok: false, error: "Supplier details are required." }, { status: 400 });
    }

    const updated = await logisticsDb.$transaction(async (tx) => {
      const existing = await tx.tlkp_company.findUnique({
        where: { shortName: companyID },
        select: { shortName: true, displayName: true },
      });
      if (!existing) {
        throw new Error(`Unknown companyID: ${companyID}`);
      }

      const company = await tx.tlkp_company.update({
        where: { shortName: companyID },
        data: {
          // Keep shortName stable; update all non-key fields from detected supplier values.
          displayName: cleanStrOrNull(supplier.name),
          address1: cleanStrOrNull(supplier.address1),
          address2: cleanStrOrNull(supplier.address2),
          city: cleanStrOrNull(supplier.city),
          province: cleanStrOrNull(supplier.province),
          postalCode: cleanStrOrNull(supplier.postalCode),
          country: cleanStrOrNull(supplier.country),
          primaryEmail: cleanStrOrNull(supplier.email),
          primaryPhone: cleanStrOrNull(supplier.phone),
          supplierCurrency: cleanStrOrNull(supplier.supplierCurrency),
        },
        select: { shortName: true, displayName: true },
      });

      return {
        shortName: companyID,
        displayName: company.displayName || company.shortName,
      };
    });

    return json({ ok: true, company: updated });
  }

  if (intent === "create-delivery-address-from-ship-to") {
    const shipTo = normalizeShipToCandidate(payload?.shipTo);
    const displayName = cleanStrOrNull(shipTo?.displayName);
    if (!displayName) {
      return json(
        { ok: false, error: "Ship To address is required to create a delivery address." },
        { status: 400 },
      );
    }

    const result = await logisticsDb.$transaction(async (tx) => {
      const existingRows = await tx.tlkp_deliveryAddress.findMany({
        select: { shortName: true, displayName: true },
      });
      const existing = pickDeliveryAddressMatch(existingRows, displayName);
      if (existing) {
        return {
          deliveryAddress: {
            shortName: existing.shortName,
            displayName: existing.displayName || existing.shortName,
          },
          created: false,
        };
      }

      const baseShortName = deliveryAddressShortNameBaseFromDisplayName(displayName);
      const shortName = await nextUniqueDeliveryAddressShortName(tx, baseShortName);
      const created = await tx.tlkp_deliveryAddress.create({
        data: { shortName, displayName },
        select: { shortName: true, displayName: true },
      });

      return {
        deliveryAddress: {
          shortName: created.shortName,
          displayName: created.displayName || created.shortName,
        },
        created: true,
      };
    });

    return json({ ok: true, ...result });
  }

  if (intent === "update-delivery-address-from-ship-to") {
    const deliveryAddressID = cleanStrOrNull(payload?.deliveryAddressID);
    const shipTo = normalizeShipToCandidate(payload?.shipTo);
    const displayName = cleanStrOrNull(shipTo?.displayName);
    if (!deliveryAddressID) {
      return json({ ok: false, error: "deliveryAddressID is required." }, { status: 400 });
    }
    if (!displayName) {
      return json({ ok: false, error: "Ship To details are required." }, { status: 400 });
    }

    const updated = await logisticsDb.$transaction(async (tx) => {
      const existing = await tx.tlkp_deliveryAddress.findUnique({
        where: { shortName: deliveryAddressID },
        select: { shortName: true, displayName: true },
      });
      if (!existing) {
        throw new Error(`Unknown deliveryAddress: ${deliveryAddressID}`);
      }

      const deliveryAddress = await tx.tlkp_deliveryAddress.update({
        where: { shortName: deliveryAddressID },
        // Keep shortName stable; update non-key fields only.
        data: { displayName: cleanStrOrNull(displayName) },
        select: { shortName: true, displayName: true },
      });

      return {
        shortName: deliveryAddressID,
        displayName: deliveryAddress.displayName || deliveryAddress.shortName,
      };
    });

    return json({ ok: true, deliveryAddress: updated });
  }

  if (intent === "delete") {
    const purchaseOrderGID =
      cleanStrOrNull(payload?.purchaseOrderGID) || cleanStrOrNull(payload?.purchaseOrder?.purchaseOrderGID);

      if (!purchaseOrderGID) {
        return json({ ok: false, error: "purchaseOrderGID is required for delete." }, { status: 400 });
      }

      await logisticsDb.$transaction(async (tx) => {
        await tx.tbljn_container_purchaseOrder.deleteMany({ where: { purchaseOrderGID } });
        await tx.tbljn_container_purchaseOrder_rslProduct.deleteMany({ where: { purchaseOrderGID } });
        await tx.tbljn_purchaseOrder_company.deleteMany({ where: { purchaseOrderGID } });
        await tx.tbljn_purchaseOrder_rslProduct.deleteMany({ where: { purchaseOrderGID } });
        await tx.tbl_purchaseOrderNotes.deleteMany({ where: { purchaseOrderGID } });
        await tx.tbl_purchaseOrder.delete({ where: { purchaseOrderGID } });
      });

      return json({ ok: true, deletedPurchaseOrderGID: purchaseOrderGID });
    }

    return json({ ok: false, error: `Unknown intent: ${intent}` }, { status: 400 });
  } catch (e) {
    console.error("[purchase-orders action] error:", e);

    const errorMessage = e?.message || "";

    if (errorMessage.includes("Unique constraint") && errorMessage.includes("purchaseOrderGID")) {
      return json(
        {
          ok: false,
          error:
            "Whoops. Looks like you are trying to use a duplicate Purchase Order ID. Check your PO details and try again.",
        },
        { status: 400 },
      );
    }

    if (errorMessage.includes("SUPPLIER_PO_FORBIDDEN")) {
      return json({ ok: false, error: "Not authorized." }, { status: 403 });
    }

    if (
      errorMessage.includes("Unknown companyID") ||
      errorMessage.includes("Unknown deliveryAddress")
    ) {
      return json({ ok: false, error: errorMessage }, { status: 400 });
    }

    return json({ ok: false, error: errorMessage || "Server error." }, { status: 500 });
  }
}
