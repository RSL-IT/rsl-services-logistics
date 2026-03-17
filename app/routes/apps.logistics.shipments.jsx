// app/routes/apps.logistics.shipments.jsx
import crypto from "node:crypto";
import { json } from "@remix-run/node";
import { verifyProxyIfPresent } from "~/utils/app-proxy-verify.server";
import { logisticsDb } from "~/logistics-db.server";
import { prisma } from "~/db.server";
import { runAdminQuery } from "~/shopify-admin.server";
import { getLogisticsUserFromRequest } from "~/logistics-auth.server";

// Field labels for human-readable change descriptions
const FIELD_LABELS = {
  companyId: "Supplier",
  companyName: "Supplier Name",
  containerNumber: "Container #",
  containerSize: "Container Size",
  portOfOrigin: "Port of Origin",
  destinationPort: "Destination Port",
  etaDate: "ETA",
  cargoReadyDate: "Cargo Ready Date",
  estimatedDeliveryToOrigin: "Est. Delivery to Origin",
  supplierPi: "Supplier PI",
  packingListFileName: "Packing List",
  commercialInvoiceFileName: "Commercial Invoice",
  quantity: "Quantity",
  bookingNumber: "Booking #",
  bookingAgent: "Booking Agent",
  vesselName: "Vessel Name",
  deliveryAddress: "Delivery Address",
  status: "Status",
};

const FILE_CHANGE_FIELD_CONFIG = {
  packingListFileName: { urlField: "packingListUrl" },
  commercialInvoiceFileName: { urlField: "commercialInvoiceUrl" },
};

const PENDING_CONTAINER_PREFIX = "PENDING-";
const RSL_LOGISTICS_ID_PREFIX = "RSL-";
const RSL_LOGISTICS_ID_LENGTH = 6;
const PO_LINE_ITEMS_SNAPSHOT_EVENT = "PO_LINE_ITEMS_SNAPSHOT";

function isPendingContainerPlaceholder(value) {
  const s = String(value || "").trim().toUpperCase();
  return s.startsWith(PENDING_CONTAINER_PREFIX);
}

function normalizeRslLogisticsID(value) {
  const raw = String(value || "").trim().toUpperCase();
  if (!raw) return "";
  return raw.startsWith(RSL_LOGISTICS_ID_PREFIX) ? raw : `${RSL_LOGISTICS_ID_PREFIX}${raw}`;
}

function generateRslLogisticsID() {
  const raw = crypto.randomUUID().replace(/-/g, "").toUpperCase();
  return `${RSL_LOGISTICS_ID_PREFIX}${raw.slice(0, RSL_LOGISTICS_ID_LENGTH)}`;
}

function isRslLogisticsIDConflict(err) {
  if (!err || String(err?.code || "") !== "P2002") return false;
  const target = Array.isArray(err?.meta?.target)
    ? err.meta.target.join(",")
    : String(err?.meta?.target || "");
  return target.includes("rslLogisticsID");
}

function formatDateForDisplay(d) {
  if (!d) return "(empty)";
  try {
    return new Date(d).toISOString().slice(0, 10);
  } catch {
    return String(d);
  }
}

function formatValueForDisplay(key, value) {
  if (value === null || value === undefined || value === "") return "(empty)";
  if (key.toLowerCase().includes("date") || key === "etaDate") {
    return formatDateForDisplay(value);
  }
  if (typeof value === "bigint") return String(value);
  return String(value);
}

function detectChanges(existing, newData) {
  const changes = [];
  const fieldsToTrack = Object.keys(FIELD_LABELS);

  for (const field of fieldsToTrack) {
    if (!(field in newData)) continue;

    const oldVal = existing[field];
    const newVal = newData[field];

    // Normalize for comparison
    const oldNorm = oldVal === null || oldVal === undefined ? "" : String(oldVal);
    const newNorm = newVal === null || newVal === undefined ? "" : String(newVal);

    // For dates, compare ISO strings
    let oldCompare = oldNorm;
    let newCompare = newNorm;
    if (field.toLowerCase().includes("date") || field === "etaDate") {
      oldCompare = oldVal ? formatDateForDisplay(oldVal) : "";
      newCompare = newVal ? formatDateForDisplay(newVal) : "";
    }

    if (oldCompare !== newCompare) {
      const fileChangeConfig = FILE_CHANGE_FIELD_CONFIG[field];
      if (fileChangeConfig) {
        const oldUrl = existing[fileChangeConfig.urlField] || null;
        const newUrl = newData[fileChangeConfig.urlField] || null;
        changes.push({
          field: FIELD_LABELS[field] || field,
          from: oldVal ? JSON.stringify({ name: oldVal, url: oldUrl }) : "(none)",
          to: newVal ? JSON.stringify({ name: newVal, url: newUrl }) : "(none)",
        });
      } else {
        changes.push({
          field: FIELD_LABELS[field] || field,
          from: formatValueForDisplay(field, oldVal),
          to: formatValueForDisplay(field, newVal),
        });
      }
    }
  }

  return changes;
}

function parseDateLike(value) {
  const v = String(value ?? "").trim();
  if (!v) return null;

  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) {
    const d = new Date(`${v}T00:00:00.000Z`);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function toYyyyMmDd(d) {
  if (!d) return "";
  try {
    return new Date(d).toISOString().slice(0, 10);
  } catch {
    return "";
  }
}

function cleanStrOrNull(v) {
  const s = String(v ?? "").trim();
  return s ? s : null;
}

function cleanStr(v) {
  return String(v ?? "").trim();
}

function isPlaceholderProductId(v) {
  return /^line[_\s-]?\d+$/i.test(cleanStr(v));
}

function normalizeSkuForMatch(v) {
  const raw = cleanStr(v).toUpperCase().replace(/\s+/g, "");
  if (!raw) return "";
  if (raw.length < 7) return raw;
  // Ignore the 7th character (1-based) when matching SKUs.
  return `${raw.slice(0, 6)}${raw.slice(7)}`;
}

function normalizeTitleForMatch(v) {
  return cleanStr(v)
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function titleMatchKeys(v) {
  const title = cleanStr(v);
  if (!title) return [];
  const variants = [title];
  const slashIdx = title.indexOf("/");
  if (slashIdx > 0) variants.push(title.slice(0, slashIdx));
  const dashIdx = title.indexOf(" - ");
  if (dashIdx > 0) variants.push(title.slice(0, dashIdx));

  const out = [];
  for (const candidate of variants) {
    const key = normalizeTitleForMatch(candidate);
    if (!key) continue;
    out.push(key);
    const compact = key.replace(/\s+/g, "");
    if (compact) out.push(compact);
  }
  return uniqStrings(out);
}

function parsePoLineItemsSnapshot(content) {
  const raw = cleanStr(content);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed?.lineItems) ? parsed.lineItems : [];
  } catch {
    return [];
  }
}

function buildProductLookupForSnapshotMatch(rslProducts) {
  const bySku = new Map();
  const byTitle = new Map();
  const byShortName = new Set();

  for (const p of rslProducts || []) {
    const shortName = cleanStr(p?.shortName);
    if (!shortName) continue;
    byShortName.add(shortName);

    const rawSku = cleanStr(p?.SKU).toUpperCase().replace(/\s+/g, "");
    const skuKey = normalizeSkuForMatch(rawSku);
    if (skuKey) {
      if (!bySku.has(skuKey)) bySku.set(skuKey, []);
      bySku.get(skuKey).push({ shortName, rawSku });
    }

    const keys = uniqStrings([
      ...titleMatchKeys(p?.displayName),
      ...titleMatchKeys(shortName),
    ]);
    for (const key of keys) {
      if (!byTitle.has(key)) byTitle.set(key, []);
      byTitle.get(key).push({ shortName });
    }
  }

  return { bySku, byTitle, byShortName };
}

function resolveSnapshotLineProductId(row, lookup) {
  const directId = cleanStrOrNull(
    row?.rslProductID ??
    row?.rslModelID ??
    row?.shortName ??
    null
  );
  if (directId && !isPlaceholderProductId(directId) && lookup.byShortName?.has(directId)) return directId;

  const sku = cleanStr(row?.sku ?? row?.SKU).toUpperCase().replace(/\s+/g, "");
  const skuKey = normalizeSkuForMatch(sku);
  if (skuKey) {
    const candidates = lookup.bySku.get(skuKey) || [];
    const matched = candidates.find((c) => c.rawSku === sku) || candidates[0] || null;
    const skuMatchedId = cleanStrOrNull(matched?.shortName);
    if (skuMatchedId) return skuMatchedId;
  }

  const keys = titleMatchKeys(row?.title ?? row?.displayName ?? "");
  for (const key of keys) {
    const matches = lookup.byTitle.get(key) || [];
    const titleMatchedId = cleanStrOrNull(matches?.[0]?.shortName);
    if (titleMatchedId) return titleMatchedId;
  }

  return null;
}

async function backfillMissingPoProductJoinRows(tx, missingPairs) {
  const pairs = Array.isArray(missingPairs)
    ? missingPairs
        .map((row) => ({
          purchaseOrderGID: cleanStr(row?.purchaseOrderGID),
          rslProductID: cleanStr(row?.rslProductID),
        }))
        .filter((row) => row.purchaseOrderGID && row.rslProductID)
    : [];
  if (!pairs.length) return { remappedPairs: new Map() };

  const requestedKeySet = new Set(
    pairs.map((row) => `${row.purchaseOrderGID}::${row.rslProductID}`)
  );
  const poGids = uniqStrings(pairs.map((row) => row.purchaseOrderGID));
  if (!poGids.length) return { remappedPairs: new Map() };

  const [snapshotNotes, rslProducts] = await Promise.all([
    tx.tbl_purchaseOrderNotes.findMany({
      where: {
        purchaseOrderGID: { in: poGids },
        eventType: PO_LINE_ITEMS_SNAPSHOT_EVENT,
      },
      orderBy: [{ createdAt: "desc" }],
      select: {
        purchaseOrderGID: true,
        content: true,
        createdAt: true,
      },
    }),
    tx.tlkp_rslProduct.findMany({
      select: { shortName: true, displayName: true, SKU: true },
    }),
  ]);

  const latestSnapshotByPo = new Map();
  for (const note of snapshotNotes || []) {
    const gid = cleanStr(note?.purchaseOrderGID);
    if (!gid || latestSnapshotByPo.has(gid)) continue;
    latestSnapshotByPo.set(gid, note);
  }

  const lookup = buildProductLookupForSnapshotMatch(rslProducts);
  const qtyByPoProductKey = new Map();
  const remappedPairs = new Map();

  for (const gid of poGids) {
    const note = latestSnapshotByPo.get(gid);
    const lineItems = parsePoLineItemsSnapshot(note?.content);
    for (const row of lineItems) {
      const rawId = cleanStrOrNull(
        row?.rslProductID ??
        row?.rslModelID ??
        row?.shortName ??
        null
      );
      const normalizedRawId = rawId && !isPlaceholderProductId(rawId) ? rawId : null;
      const productId = resolveSnapshotLineProductId(row, lookup);
      if (!productId) continue;
      const canonicalKey = `${gid}::${productId}`;
      const rawKey = normalizedRawId ? `${gid}::${normalizedRawId}` : null;
      const isRequestedCanonical = requestedKeySet.has(canonicalKey);
      const isRequestedRaw = Boolean(rawKey && requestedKeySet.has(rawKey));
      if (!isRequestedCanonical && !isRequestedRaw) continue;

      if (rawKey && rawKey !== canonicalKey && isRequestedRaw) {
        remappedPairs.set(rawKey, canonicalKey);
      }

      const qtyRaw = Number(row?.quantity);
      const qty = Number.isFinite(qtyRaw) ? Math.max(0, Math.trunc(qtyRaw)) : 0;
      qtyByPoProductKey.set(canonicalKey, (qtyByPoProductKey.get(canonicalKey) || 0) + qty);
    }
  }

  const rowsToCreate = [];
  for (const [key, qtyValue] of qtyByPoProductKey.entries()) {
    const [purchaseOrderGID, rslProductID] = String(key || "").split("::");
    if (!purchaseOrderGID || !rslProductID) continue;
    const initialQuantity = Number(qtyValue);
    if (!Number.isFinite(initialQuantity) || initialQuantity <= 0) continue;

    rowsToCreate.push({
      purchaseOrderGID,
      rslProductID,
      initialQuantity,
      committedQuantity: 0,
    });
  }

  if (!rowsToCreate.length) return { remappedPairs };

  await tx.tbljn_purchaseOrder_rslProduct.createMany({
    data: rowsToCreate,
    skipDuplicates: true,
  });

  return { remappedPairs };
}

const PDF_ACTIVE_CONTENT_PATTERNS = [
  { pattern: /\/javascript\b/i, label: "JavaScript" },
  { pattern: /\/js\b/i, label: "JavaScript" },
  { pattern: /\/openaction\b/i, label: "OpenAction" },
  { pattern: /\/aa\b/i, label: "Additional Actions" },
  { pattern: /\/launch\b/i, label: "Launch Action" },
  { pattern: /\/richmedia\b/i, label: "Rich Media" },
  { pattern: /\/embeddedfile\b/i, label: "Embedded File" },
  { pattern: /\/submitform\b/i, label: "Submit Form Action" },
  { pattern: /\/importdata\b/i, label: "Import Data Action" },
  { pattern: /\/gotoe\b/i, label: "Embedded GoTo Action" },
  { pattern: /\/xfa\b/i, label: "XFA Form" },
];

function detectSuspiciousPdfFeatures(buffer) {
  if (!buffer || buffer.length === 0) return [];

  // Keep ASCII-ish tokens and collapse binary noise to reduce false positives.
  const searchable = buffer.toString("latin1").replace(/[^\x20-\x7E]+/g, " ");
  const hits = new Set();
  for (const row of PDF_ACTIVE_CONTENT_PATTERNS) {
    if (row.pattern.test(searchable)) {
      hits.add(row.label);
    }
  }
  return [...hits];
}

async function validateUploadedPdf(file, label) {
  if (!file) return null;

  const name = String(file.name || "");
  const type = String(file.type || "");
  const looksPdf = type === "application/pdf" || name.toLowerCase().endsWith(".pdf");
  if (!looksPdf) return `Only PDF uploads are supported for ${label}.`;

  const maxBytes = 20 * 1024 * 1024;
  if (typeof file.size === "number" && file.size > maxBytes) {
    return `${label} PDF is too large (max 20MB).`;
  }

  let buffer;
  try {
    buffer = Buffer.from(await file.arrayBuffer());
  } catch {
    return `Unable to read ${label} PDF. Please try a different file.`;
  }

  // Basic signature/structure checks.
  const header = buffer.subarray(0, 5).toString("latin1");
  if (header !== "%PDF-") {
    return `${label} is not a valid PDF file.`;
  }
  const tail = buffer.subarray(Math.max(0, buffer.length - 2048)).toString("latin1");
  if (!tail.includes("%%EOF")) {
    return `${label} appears to be malformed. Please upload a standard exported PDF.`;
  }

  const suspicious = detectSuspiciousPdfFeatures(buffer);
  if (suspicious.length > 0) {
    return (
      `${label} contains blocked active content (${suspicious.join(", ")}). ` +
      `Upload a flattened/static PDF without scripts, actions, or embedded payloads.`
    );
  }

  return null;
}

function uniqStrings(arr) {
  const seen = new Set();
  const out = [];
  for (const v of arr || []) {
    const s = String(v || "").trim();
    if (!s) continue;
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

function parseBigIntLike(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;

  const normalized = raw.replace(/[, ]+/g, "");
  if (!/^\d+$/.test(normalized)) return { error: "Quantity must be a whole number." };

  try {
    return BigInt(normalized);
  } catch {
    return { error: "Quantity is too large or invalid." };
  }
}

function pickPurchaseOrdersInfo(s) {
  const links = Array.isArray(s?.tbljn_container_purchaseOrder) ? s.tbljn_container_purchaseOrder : [];
  const gids = links
    .map((l) => l?.tbl_purchaseOrder?.purchaseOrderGID)
    .filter(Boolean)
    .map((x) => String(x));
  const names = links
    .map((l) => l?.tbl_purchaseOrder?.shortName)
    .filter(Boolean)
    .map((x) => String(x));

  return {
    purchaseOrderGIDs: uniqStrings(gids),
    purchaseOrderShortNames: uniqStrings(names),
  };
}

function aggregateContainerProducts(containerRow) {
  const allocations = Array.isArray(containerRow?.tbljn_container_purchaseOrder_rslProduct)
    ? containerRow.tbljn_container_purchaseOrder_rslProduct
    : [];
  const byProduct = new Map();
  for (const row of allocations) {
    const rslProductID = String(row?.rslProductID || "").trim();
    if (!rslProductID) continue;
    const quantity = Number(row?.quantity) || 0;
    const existing = byProduct.get(rslProductID) || {
      rslProductID,
      shortName: row?.tlkp_rslProduct?.shortName || rslProductID,
      displayName: row?.tlkp_rslProduct?.displayName || rslProductID,
      SKU: row?.tlkp_rslProduct?.SKU || null,
      quantity: 0,
    };
    existing.quantity += quantity;
    byProduct.set(rslProductID, existing);
  }
  return [...byProduct.values()];
}

function buildContainerPoAllocationMap(containerRow) {
  const allocations = Array.isArray(containerRow?.tbljn_container_purchaseOrder_rslProduct)
    ? containerRow.tbljn_container_purchaseOrder_rslProduct
    : [];
  const out = {};
  for (const row of allocations) {
    const productId = String(row?.rslProductID || "").trim();
    const poGid = String(row?.purchaseOrderGID || "").trim();
    const qty = Number(row?.quantity) || 0;
    if (!productId || !poGid || qty <= 0) continue;
    if (!out[productId]) out[productId] = {};
    out[productId][poGid] = (Number(out[productId][poGid]) || 0) + qty;
  }
  return out;
}

function mapDbContainerToUi(s) {
  const po = pickPurchaseOrdersInfo(s);
  const resolvedRslLogisticsID = normalizeRslLogisticsID(s.rslLogisticsID || "");
  const rawContainerNumber = String(s.containerNumber ?? "").trim();
  const statusLower = String(s.status ?? "").trim().toLowerCase();
  const hidePendingPlaceholder = isPendingContainerPlaceholder(rawContainerNumber) && statusLower === "pending";

  // Map container notes/history
  const history = Array.isArray(s.tbl_containerNotes)
    ? s.tbl_containerNotes.map((n) => ({
        id: String(n.id),
        timestamp: n.createdAt ? new Date(n.createdAt).toISOString() : new Date().toISOString(),
        content: n.content || "",
        changes: n.changes || null,
        user: n.tbl_logisticsUser?.displayName || null,
      }))
    : [];

  // Map container product quantities from per-container PO allocations.
  const products = aggregateContainerProducts(s);

  // Build productQuantities map for easy access
  const productQuantities = {};
  for (const p of products) {
    productQuantities[p.rslProductID] = p.quantity;
  }
  const poAllocations = buildContainerPoAllocationMap(s);

  return {
    id: resolvedRslLogisticsID || String(s.id),
    dbId: String(s.id),
    rslLogisticsID: resolvedRslLogisticsID || String(s.id),
    supplierId: s.companyId,
    supplierName: s.companyName,
    products,
    productQuantities,
    poAllocations,

    containerNumber: hidePendingPlaceholder ? "" : rawContainerNumber,
    containerSize: s.containerSize ?? "",
    portOfOrigin: s.portOfOrigin ?? "",
    destinationPort: s.destinationPort ?? "",

    cargoReadyDate: toYyyyMmDd(s.cargoReadyDate),
    etd: toYyyyMmDd(s.estimatedDeliveryToOrigin),
    estimatedDeliveryToOrigin: toYyyyMmDd(s.estimatedDeliveryToOrigin),
    supplierPi: s.supplierPi ?? "",
    packingListUrl: s.packingListUrl ?? "",
    packingListFileName: s.packingListFileName ?? "",
    commercialInvoiceUrl: s.commercialInvoiceUrl ?? "",
    commercialInvoiceFileName: s.commercialInvoiceFileName ?? "",
    quantity: s.quantity != null ? String(s.quantity) : "",
    bookingNumber: s.bookingNumber ?? "",
    bookingAgent: s.bookingAgent ?? "",
    vesselName: s.vesselName ?? "",
    deliveryAddress: s.deliveryAddress ?? "",
    notes: s.notes ?? "",

    purchaseOrderGIDs: po.purchaseOrderGIDs,
    purchaseOrderShortNames: po.purchaseOrderShortNames,

    // backward-compatible first item
    purchaseOrderGID: po.purchaseOrderGIDs[0] || "",
    purchaseOrderShortName: po.purchaseOrderShortNames[0] || "",

    actualDepartureDate: "",
    eta: toYyyyMmDd(s.etaDate),
    sealNumber: "",
    hblNumber: "",
    estimatedDeliveryDate: "",
    status: s.status ?? "",

    history,
  };
}

async function loadContainerWithPoByDbId(id) {
  return logisticsDb.tbl_container.findUnique({
    where: { id },
    include: {
      tbljn_container_purchaseOrder: {
        include: {
          tbl_purchaseOrder: { select: { purchaseOrderGID: true, shortName: true } },
        },
      },
      tbljn_container_purchaseOrder_rslProduct: {
        include: {
          tlkp_rslProduct: { select: { shortName: true, displayName: true, SKU: true } },
        },
      },
      tbl_containerNotes: {
        orderBy: { createdAt: "desc" },
        include: {
          tbl_logisticsUser: { select: { displayName: true } },
        },
      },
    },
  });
}

async function resolveContainerByExternalId(externalId) {
  const normalized = String(externalId || "").trim();
  if (!normalized) return null;

  const asRsl = normalizeRslLogisticsID(normalized);
  if (asRsl) {
    const byRsl = await logisticsDb.tbl_container.findUnique({
      where: { rslLogisticsID: asRsl },
    });
    if (byRsl) return byRsl;
  }

  const numericId = Number(normalized);
  if (!Number.isNaN(numericId) && Number.isFinite(numericId) && numericId > 0) {
    return logisticsDb.tbl_container.findUnique({
      where: { id: numericId },
    });
  }

  return null;
}

async function resolveContainerFromPayload(shipment) {
  const externalContainerId = cleanStrOrNull(shipment?.id) || cleanStrOrNull(shipment?.rslLogisticsID);
  if (externalContainerId) {
    const byExternal = await resolveContainerByExternalId(externalContainerId);
    if (byExternal) return byExternal;
  }

  const dbId = Number(shipment?.dbId);
  if (!Number.isNaN(dbId) && Number.isFinite(dbId) && dbId > 0) {
    const byDbId = await logisticsDb.tbl_container.findUnique({ where: { id: dbId } });
    if (byDbId) return byDbId;
  }

  // Fallback for stale client IDs after ID-format migration.
  const supplierId = cleanStrOrNull(shipment?.supplierId);
  const containerNumber = cleanStrOrNull(String(shipment?.containerNumber || "").trim().toUpperCase());
  if (!supplierId || !containerNumber) return null;

  const candidates = await logisticsDb.tbl_container.findMany({
    where: { companyId: supplierId, containerNumber },
    orderBy: { id: "desc" },
    take: 10,
  });
  if (!candidates.length) return null;
  if (candidates.length === 1) return candidates[0];

  const etaYmd = toYyyyMmDd(parseDateLike(shipment?.eta));
  if (etaYmd) {
    const etaMatches = candidates.filter((row) => toYyyyMmDd(row?.etaDate) === etaYmd);
    if (etaMatches.length === 1) return etaMatches[0];
  }

  return null;
}

async function validatePurchaseOrdersExist(tx, purchaseOrderGIDs) {
  if (!purchaseOrderGIDs.length) return;

  const found = await tx.tbl_purchaseOrder.findMany({
    where: { purchaseOrderGID: { in: purchaseOrderGIDs } },
    select: { purchaseOrderGID: true },
  });

  const foundSet = new Set(found.map((x) => String(x.purchaseOrderGID)));
  const missing = purchaseOrderGIDs.filter((gid) => !foundSet.has(gid));
  if (missing.length) {
    const err = new Error("PO_NOT_FOUND");
    err.missing = missing;
    throw err;
  }
}

async function validatePurchaseOrdersHaveProForma(tx, purchaseOrderGIDs) {
  if (!purchaseOrderGIDs.length) return;

  const found = await tx.tbl_purchaseOrder.findMany({
    where: { purchaseOrderGID: { in: purchaseOrderGIDs } },
    select: { purchaseOrderGID: true, proFormaInvoiceUrl: true },
  });

  const missingProForma = found
    .filter((x) => !String(x.proFormaInvoiceUrl || "").trim())
    .map((x) => String(x.purchaseOrderGID));

  if (missingProForma.length) {
    const err = new Error("PO_MISSING_PRO_FORMA");
    err.missing = missingProForma;
    throw err;
  }
}

function normalizePurchaseOrderGIDsFromPayload(shipment) {
  // Preferred: purchaseOrderGIDs: string[]
  if (shipment && Array.isArray(shipment.purchaseOrderGIDs)) {
    return uniqStrings(shipment.purchaseOrderGIDs);
  }
  // Back-compat: purchaseOrderGID: string
  const single = cleanStrOrNull(shipment?.purchaseOrderGID);
  return single ? [single] : [];
}

function normalizeProductQuantitiesFromPayload(shipment) {
  // productQuantities: { "rslProductShortName": "100", ... }
  const raw = shipment?.productQuantities;
  if (!raw || typeof raw !== "object") return [];

  const result = [];
  for (const [rslProductID, qtyStr] of Object.entries(raw)) {
    const qty = parseInt(String(qtyStr || "0"), 10);
    if (rslProductID && !Number.isNaN(qty) && qty > 0) {
      result.push({ rslProductID: String(rslProductID).trim(), quantity: qty });
    }
  }
  return result;
}

function normalizePoQuantitiesFromPayload(shipment) {
  const raw = shipment?.poQuantities;
  if (!raw || typeof raw !== "object") return {};

  const out = {};
  for (const [productIdRaw, rowRaw] of Object.entries(raw)) {
    const productId = String(productIdRaw || "").trim();
    if (!productId || !rowRaw || typeof rowRaw !== "object") continue;

    const rowOut = {};
    for (const [gidRaw, remainingRaw] of Object.entries(rowRaw)) {
      const purchaseOrderGID = String(gidRaw || "").trim();
      if (!purchaseOrderGID) continue;
      const remainingText = String(remainingRaw ?? "").trim();
      if (!/^\d+$/.test(remainingText)) continue;
      const parsed = parseInt(remainingText, 10);
      if (Number.isNaN(parsed) || parsed < 0) continue;
      rowOut[purchaseOrderGID] = parsed;
    }

    if (Object.keys(rowOut).length) out[productId] = rowOut;
  }
  return out;
}

function poProductKey(purchaseOrderGID, rslProductID) {
  return `${String(purchaseOrderGID || "").trim()}::${String(rslProductID || "").trim()}`;
}

async function getLiveCommittedByPoProductKey(tx, pairs) {
  const uniquePairs = uniqStrings(
    (pairs || []).map((row) => poProductKey(row?.purchaseOrderGID, row?.rslProductID))
  )
    .map((key) => {
      const [purchaseOrderGID, rslProductID] = String(key || "").split("::");
      return {
        purchaseOrderGID: String(purchaseOrderGID || "").trim(),
        rslProductID: String(rslProductID || "").trim(),
      };
    })
    .filter((row) => row.purchaseOrderGID && row.rslProductID);

  if (!uniquePairs.length) return new Map();

  const grouped = await tx.tbljn_container_purchaseOrder_rslProduct.groupBy({
    by: ["purchaseOrderGID", "rslProductID"],
    where: {
      OR: uniquePairs.map((row) => ({
        purchaseOrderGID: row.purchaseOrderGID,
        rslProductID: row.rslProductID,
      })),
    },
    _sum: { quantity: true },
  });

  const out = new Map();
  for (const row of grouped || []) {
    const key = poProductKey(row?.purchaseOrderGID, row?.rslProductID);
    const qty = Number(row?._sum?.quantity) || 0;
    out.set(key, Math.max(0, qty));
  }
  return out;
}

function buildProductQuantitiesFromAllocationRows(rows) {
  const byProduct = new Map();
  for (const row of rows || []) {
    const rslProductID = String(row?.rslProductID || "").trim();
    if (!rslProductID) continue;
    const quantity = Number(row?.quantity) || 0;
    if (quantity <= 0) continue;
    byProduct.set(rslProductID, (byProduct.get(rslProductID) || 0) + quantity);
  }
  return [...byProduct.entries()].map(([rslProductID, quantity]) => ({ rslProductID, quantity }));
}

async function prepareContainerAllocationChanges(tx, {
  containerId = null,
  purchaseOrderGIDs,
  poQuantities,
  productQuantities,
}) {
  const gids = uniqStrings(purchaseOrderGIDs || []);
  const keyFor = (gid, productId) => `${gid}::${productId}`;

  const existingAllocations = containerId
    ? await tx.tbljn_container_purchaseOrder_rslProduct.findMany({
      where: { containerID: containerId },
      select: { purchaseOrderGID: true, rslProductID: true, quantity: true },
    })
    : [];

  const existingByKey = new Map(
    existingAllocations.map((x) => [keyFor(x.purchaseOrderGID, x.rslProductID), Number(x.quantity) || 0])
  );

  const requestedByKey = new Map();
  if (poQuantities && typeof poQuantities === "object") {
    for (const [productIdRaw, rowRaw] of Object.entries(poQuantities)) {
      const productId = String(productIdRaw || "").trim();
      if (!productId || !rowRaw || typeof rowRaw !== "object") continue;
      for (const [gidRaw, remainingRaw] of Object.entries(rowRaw)) {
        const gid = String(gidRaw || "").trim();
        if (!gid || (gids.length && !gids.includes(gid))) continue;
        const remaining = parseInt(String(remainingRaw ?? ""), 10);
        if (Number.isNaN(remaining) || remaining < 0) continue;
        requestedByKey.set(keyFor(gid, productId), {
          purchaseOrderGID: gid,
          rslProductID: productId,
          remaining,
        });
      }
    }
  }

  let keysToProcess = new Set([
    ...requestedByKey.keys(),
    ...existingByKey.keys(),
  ]);
  if (!keysToProcess.size) {
    return { committedDeltas: [], allocationRows: [] };
  }

  let pairs = [...keysToProcess].map((k) => {
    const [purchaseOrderGID, rslProductID] = k.split("::");
    return { purchaseOrderGID, rslProductID };
  });

  const dbRows = await tx.tbljn_purchaseOrder_rslProduct.findMany({
    where: {
      OR: pairs.map((x) => ({
        purchaseOrderGID: x.purchaseOrderGID,
        rslProductID: x.rslProductID,
      })),
    },
    select: {
      purchaseOrderGID: true,
      rslProductID: true,
      initialQuantity: true,
      committedQuantity: true,
    },
  });

  const dbByKey = new Map(dbRows.map((r) => [keyFor(r.purchaseOrderGID, r.rslProductID), r]));
  const missingRequestedPairs = [...requestedByKey.values()].filter(
    (row) => !dbByKey.has(keyFor(row.purchaseOrderGID, row.rslProductID))
  );
  let remappedPairs = new Map();
  if (missingRequestedPairs.length) {
    // Auto-heal PO join rows when product refresh changed product identities but
    // PO snapshot data still contains the original line items.
    const backfill = await backfillMissingPoProductJoinRows(tx, missingRequestedPairs);
    remappedPairs = backfill?.remappedPairs instanceof Map ? backfill.remappedPairs : new Map();
  }

  if (remappedPairs.size) {
    for (const [oldKey, newKey] of remappedPairs.entries()) {
      const oldRequested = requestedByKey.get(oldKey);
      if (!oldRequested) continue;

      const [mappedPoGid, mappedProductId] = String(newKey || "").split("::");
      if (!mappedPoGid || !mappedProductId) continue;

      const existingMapped = requestedByKey.get(newKey);
      if (!existingMapped) {
        requestedByKey.set(newKey, {
          purchaseOrderGID: mappedPoGid,
          rslProductID: mappedProductId,
          remaining: oldRequested.remaining,
        });
      } else {
        existingMapped.remaining = Math.min(
          Number(existingMapped.remaining) || 0,
          Number(oldRequested.remaining) || 0
        );
        requestedByKey.set(newKey, existingMapped);
      }

      requestedByKey.delete(oldKey);
    }
  }

  keysToProcess = new Set([
    ...requestedByKey.keys(),
    ...existingByKey.keys(),
  ]);
  if (!keysToProcess.size) {
    return { committedDeltas: [], allocationRows: [] };
  }

  pairs = [...keysToProcess].map((k) => {
    const [purchaseOrderGID, rslProductID] = k.split("::");
    return { purchaseOrderGID, rslProductID };
  });

  const missingDbPairs = pairs.filter((row) => !dbByKey.has(keyFor(row.purchaseOrderGID, row.rslProductID)));
  if (missingDbPairs.length) {
    const repairedRows = await tx.tbljn_purchaseOrder_rslProduct.findMany({
      where: {
        OR: missingDbPairs.map((row) => ({
          purchaseOrderGID: row.purchaseOrderGID,
          rslProductID: row.rslProductID,
        })),
      },
      select: {
        purchaseOrderGID: true,
        rslProductID: true,
        initialQuantity: true,
        committedQuantity: true,
      },
    });
    for (const row of repairedRows || []) {
      dbByKey.set(keyFor(row.purchaseOrderGID, row.rslProductID), row);
    }
  }

  const liveCommittedByKey = await getLiveCommittedByPoProductKey(tx, pairs);

  const conflicts = [];
  const committedDeltaByKey = new Map();
  const desiredByProduct = new Map();
  const allocationRows = [];

  for (const k of keysToProcess) {
    const db = dbByKey.get(k);
    const [purchaseOrderGID, rslProductID] = k.split("::");
    const previousQty = existingByKey.get(k) || 0;
    const requested = requestedByKey.get(k);
    if (!db) {
      if (requested) {
        conflicts.push(`${purchaseOrderGID}/${rslProductID} is not a valid PO product line.`);
      }
      continue;
    }

    const initial = Number(db.initialQuantity) || 0;
    // Use live container allocation totals as the source of truth for committed quantity.
    // tbljn_purchaseOrder_rslProduct.committedQuantity can be stale during data transitions.
    const currentCommitted = Number(liveCommittedByKey.get(k)) || 0;
    // UI PO-field values are "remaining from currently available", not from initial PO quantity.
    // Base availability for this container = initial - liveCommitted + thisContainerPreviousAllocation.
    const availableToContainer = Math.max(0, initial - currentCommitted + previousQty);
    const remaining = requested
      ? Math.min(Math.max(requested.remaining, 0), availableToContainer)
      : availableToContainer;
    const desiredQty = Math.max(0, availableToContainer - remaining);
    const delta = desiredQty - previousQty;
    const nextCommitted = currentCommitted + delta;
    if (nextCommitted < 0 || nextCommitted > initial) {
      conflicts.push(
        `${purchaseOrderGID}/${rslProductID} requested ${desiredQty}, previous ${previousQty}, available ${availableToContainer}`
      );
      continue;
    }

    committedDeltaByKey.set(k, delta);
    if (desiredQty > 0) {
      allocationRows.push({ purchaseOrderGID, rslProductID, quantity: desiredQty });
      desiredByProduct.set(rslProductID, (desiredByProduct.get(rslProductID) || 0) + desiredQty);
    }
  }

  const productIdRemap = new Map();
  for (const [oldKey, newKey] of remappedPairs.entries()) {
    const [, oldProductId] = String(oldKey || "").split("::");
    const [, newProductId] = String(newKey || "").split("::");
    if (!oldProductId || !newProductId || oldProductId === newProductId) continue;
    if (!productIdRemap.has(oldProductId)) productIdRemap.set(oldProductId, new Set());
    productIdRemap.get(oldProductId).add(newProductId);
  }

  const expectedByProduct = new Map();
  for (const pq of productQuantities || []) {
    const rawProductId = String(pq?.rslProductID || "").trim();
    if (!rawProductId) continue;
    const qty = Number(pq?.quantity) || 0;
    const remapTargets = productIdRemap.get(rawProductId);
    const productId =
      remapTargets && remapTargets.size === 1
        ? [...remapTargets][0]
        : rawProductId;
    expectedByProduct.set(productId, (expectedByProduct.get(productId) || 0) + qty);
  }
  const allProductIds = new Set([...expectedByProduct.keys(), ...desiredByProduct.keys()]);
  for (const productId of allProductIds) {
    const expected = expectedByProduct.get(productId) || 0;
    const desired = desiredByProduct.get(productId) || 0;
    if (expected !== desired) {
      conflicts.push(
        `${productId} container quantity mismatch (PO fields total ${desired}, This Container ${expected})`
      );
    }
  }

  if (conflicts.length) {
    const err = new Error("PO_COMMITTED_CONFLICT");
    err.details = conflicts;
    throw err;
  }

  const committedDeltas = [];
  for (const [k, delta] of committedDeltaByKey.entries()) {
    if (!delta) continue;
    const [purchaseOrderGID, rslProductID] = k.split("::");
    committedDeltas.push({ purchaseOrderGID, rslProductID, delta });
  }

  return { committedDeltas, allocationRows };
}

async function applyCommittedQuantityDeltas(tx, deltas) {
  for (const row of deltas || []) {
    if (!row?.delta) continue;
    await tx.tbljn_purchaseOrder_rslProduct.updateMany({
      where: {
        purchaseOrderGID: row.purchaseOrderGID,
        rslProductID: row.rslProductID,
      },
      data: row.delta > 0
        ? { committedQuantity: { increment: row.delta } }
        : { committedQuantity: { decrement: Math.abs(row.delta) } },
    });
  }
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

/**
 * Upload shipment documentation PDF to Shopify Files.
 */
async function uploadShipmentDocumentToShopifyFiles({ shop, file }) {
  const filename = file.name || "shipment-document.pdf";
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

export async function action({ request }) {
  const debug = { stage: "start", proxyVerified: false };
  const actor = await getLogisticsUserFromRequest(request);

  if (!actor || actor.isActive === false) {
    return json({ success: false, error: "Unauthorized." }, { status: 401 });
  }

  const actorIsSupplier = String(actor.userType || "").toLowerCase().includes("supplier");
  const actorCompanyId = String(actor.companyID || "").trim();

  try {
    await verifyProxyIfPresent(request);
    debug.proxyVerified = true;
  } catch (err) {
    if (err instanceof Response && err.status === 401) {
      debug.proxyVerified = false;
      debug.proxySkipReason = "no_proxy_signature";
      console.warn("[logistics shipments] proxy verification skipped:", { status: err.status });
    } else {
      console.error("[logistics shipments] proxy verification error:", err);
    }
  }

  try {
    debug.stage = "parse-body";
    const contentType = request.headers.get("content-type") || "";
    let payload;
    let packingListFile = null;
    let commercialInvoiceFile = null;

    if (contentType.includes("application/json")) {
      payload = await request.json();
    } else if (contentType.includes("multipart/form-data")) {
      const formData = await request.formData();
      const intent = cleanStrOrNull(formData.get("intent"));
      const containerRaw = cleanStrOrNull(formData.get("container")) || cleanStrOrNull(formData.get("shipment"));
      let containerData = {};
      try {
        containerData = containerRaw ? JSON.parse(containerRaw) : {};
      } catch {
        // ignore
      }

      // Get documentation files if present
      const packingList = formData.get("packingList");
      const commercialInvoice = formData.get("commercialInvoice");
      const hasPackingList =
        packingList && typeof packingList === "object" && typeof packingList.arrayBuffer === "function";
      const hasCommercialInvoice =
        commercialInvoice &&
        typeof commercialInvoice === "object" &&
        typeof commercialInvoice.arrayBuffer === "function";

      packingListFile = hasPackingList ? packingList : null;
      commercialInvoiceFile = hasCommercialInvoice ? commercialInvoice : null;

      const packingListValidationError = await validateUploadedPdf(packingListFile, "Packing List");
      if (packingListValidationError) {
        console.warn("[logistics shipments] blocked upload:", {
          fileName: packingListFile?.name || null,
          label: "Packing List",
          reason: packingListValidationError,
        });
        return json({ success: false, error: packingListValidationError }, { status: 200 });
      }

      const commercialInvoiceValidationError = await validateUploadedPdf(commercialInvoiceFile, "Commercial Invoice");
      if (commercialInvoiceValidationError) {
        console.warn("[logistics shipments] blocked upload:", {
          fileName: commercialInvoiceFile?.name || null,
          label: "Commercial Invoice",
          reason: commercialInvoiceValidationError,
        });
        return json({ success: false, error: commercialInvoiceValidationError }, { status: 200 });
      }

      payload = { intent, container: containerData, shipment: containerData };
    } else {
      const formData = await request.formData();
      payload = Object.fromEntries(formData);
      if (typeof payload.container === "string") {
        try {
          payload.container = JSON.parse(payload.container);
        } catch {
          // ignore
        }
      }
      if (!payload.container && typeof payload.shipment === "string") {
        try {
          payload.container = JSON.parse(payload.shipment);
        } catch {
          // ignore
        }
      }
    }

    const intent = payload.intent;
    const shipment = payload.container || payload.shipment || {};
    debug.intent = intent;

    if (!intent) {
      return json({ success: false, error: "Missing intent.", debug }, { status: 200 });
    }

    // CREATE
    if (intent === "create") {
      debug.stage = "create";

      const supplierId = actorIsSupplier ? actorCompanyId : String(shipment.supplierId || "").trim();
      const containerNumber = cleanStrOrNull(String(shipment.containerNumber || "").trim().toUpperCase());

      const containerSize = cleanStrOrNull(shipment.containerSize);
      const portOfOrigin = cleanStrOrNull(shipment.portOfOrigin);
      const destinationPort = cleanStrOrNull(shipment.destinationPort);
      const status = cleanStrOrNull(shipment.status) || "Pending";

      const etaDate = parseDateLike(shipment.eta);
      const cargoReadyDate = parseDateLike(shipment.cargoReadyDate);
      // ETD maps to estimatedDeliveryToOrigin - use etd if provided, otherwise estimatedDeliveryToOrigin
      const estimatedDeliveryToOrigin = parseDateLike(shipment.etd) || parseDateLike(shipment.estimatedDeliveryToOrigin);

      const supplierPi = cleanStrOrNull(shipment.supplierPi);
      const bookingNumber = cleanStrOrNull(shipment.bookingNumber);
      const bookingAgent = cleanStrOrNull(shipment.bookingAgent);
      const vesselName = cleanStrOrNull(shipment.vesselName);
      const deliveryAddress = cleanStrOrNull(shipment.deliveryAddress);
      const notes = cleanStrOrNull(shipment.notes);

      const qtyParsed = parseBigIntLike(shipment.quantity);
      if (qtyParsed && typeof qtyParsed === "object" && qtyParsed.error) {
        return json({ success: false, error: qtyParsed.error, debug }, { status: 200 });
      }
      const quantity = qtyParsed;

      const purchaseOrderGIDs = normalizePurchaseOrderGIDsFromPayload(shipment);
      const productQuantities = normalizeProductQuantitiesFromPayload(shipment);
      const poQuantities = normalizePoQuantitiesFromPayload(shipment);

      if (actorIsSupplier && !supplierId) {
        return json({ success: false, error: "Supplier account has no company mapping." }, { status: 403 });
      }

      if (!supplierId) {
        return json({ success: false, error: "Supplier is required.", debug }, { status: 200 });
      }

      if (!destinationPort || !etaDate) {
        return json(
          { success: false, error: "Destination Port and ETA are required.", debug },
          { status: 200 }
        );
      }

      const company = await logisticsDb.tlkp_company.findUnique({
        where: { shortName: supplierId },
        select: { shortName: true, displayName: true },
      });

      const companyName =
        (company?.displayName && String(company.displayName).trim()) || supplierId;

      // Upload documentation files if present
      let packingListUrl = null;
      let packingListFileName = null;
      let commercialInvoiceUrl = null;
      let commercialInvoiceFileName = null;
      if (packingListFile || commercialInvoiceFile) {
        const shop = await resolveShopForAdmin(request);
        if (!shop) {
          return json({ success: false, error: "Could not resolve shop for file upload.", debug }, { status: 200 });
        }
        if (packingListFile) {
          try {
            packingListUrl = await uploadShipmentDocumentToShopifyFiles({ shop, file: packingListFile });
            packingListFileName = String(packingListFile.name || "packing-list.pdf");
          } catch (uploadErr) {
            console.error("[logistics shipments] packing list upload error:", uploadErr);
            return json(
              { success: false, error: `Packing List upload failed: ${uploadErr.message}`, debug },
              { status: 200 }
            );
          }
        }

        if (commercialInvoiceFile) {
          try {
            commercialInvoiceUrl = await uploadShipmentDocumentToShopifyFiles({
              shop,
              file: commercialInvoiceFile,
            });
            commercialInvoiceFileName = String(commercialInvoiceFile.name || "commercial-invoice.pdf");
          } catch (uploadErr) {
            console.error("[logistics shipments] commercial invoice upload error:", uploadErr);
            return json(
              { success: false, error: `Commercial Invoice upload failed: ${uploadErr.message}`, debug },
              { status: 200 }
            );
          }
        }
      }

      let createdId;

      try {
        for (let attempt = 0; attempt < 5; attempt += 1) {
          const generatedRslLogisticsID = generateRslLogisticsID();
          try {
            createdId = await logisticsDb.$transaction(async (tx) => {
              await validatePurchaseOrdersExist(tx, purchaseOrderGIDs);
              await validatePurchaseOrdersHaveProForma(tx, purchaseOrderGIDs);
              const allocationPlan = await prepareContainerAllocationChanges(tx, {
                containerId: null,
                purchaseOrderGIDs,
                poQuantities,
                productQuantities,
              });

              const created = await tx.tbl_container.create({
                data: {
                  rslLogisticsID: generatedRslLogisticsID,
                  companyId: supplierId,
                  companyName,
                  containerNumber,
                  containerSize,
                  portOfOrigin,
                  destinationPort,
                  etaDate,

                  cargoReadyDate,
                  estimatedDeliveryToOrigin,
                  supplierPi,
                  packingListUrl,
                  packingListFileName,
                  commercialInvoiceUrl,
                  commercialInvoiceFileName,
                  quantity,
                  bookingNumber,
                  bookingAgent,
                  vesselName,
                  deliveryAddress,
                  notes,

                  status,
                  updatedAt: new Date(),
                },
              });

              if (purchaseOrderGIDs.length) {
                await tx.tbljn_container_purchaseOrder.createMany({
                  data: purchaseOrderGIDs.map((purchaseOrderGID) => ({
                    containerID: created.id,
                    purchaseOrderGID,
                  })),
                });
              }

              if (allocationPlan.allocationRows.length) {
                await tx.tbljn_container_purchaseOrder_rslProduct.createMany({
                  data: allocationPlan.allocationRows.map((row) => ({
                    containerID: created.id,
                    purchaseOrderGID: row.purchaseOrderGID,
                    rslProductID: row.rslProductID,
                    quantity: row.quantity,
                  })),
                });
              }
              await applyCommittedQuantityDeltas(tx, allocationPlan.committedDeltas);

              // Always add a history entry so create events are visible in the modal timeline.
              await tx.tbl_containerNotes.create({
                data: {
                  containerId: created.id,
                  userId: actor?.id ? Number(actor.id) : null,
                  content: "Container created.",
                  changes: null,
                },
              });

              return created.id;
            });
            break;
          } catch (innerErr) {
            if (isRslLogisticsIDConflict(innerErr) && attempt < 4) continue;
            throw innerErr;
          }
        }

        if (!createdId) {
          throw new Error("RSL_LOGISTICS_ID_GENERATION_FAILED");
        }
      } catch (err) {
        console.error("[logistics shipments] create error:", err);

        if (String(err?.message || "") === "PO_NOT_FOUND") {
          const missing = Array.isArray(err.missing) ? err.missing.join(", ") : "";
          return json(
            { success: false, error: `Purchase Order not found: ${missing || "unknown"}.`, debug },
            { status: 200 }
          );
        }

        if (String(err?.message || "") === "PO_MISSING_PRO_FORMA") {
          const missing = Array.isArray(err.missing) ? err.missing.join(", ") : "";
          return json(
            {
              success: false,
              error: `A Pro-forma invoice is required before using Purchase Order(s): ${missing || "unknown"}.`,
              debug,
            },
            { status: 200 }
          );
        }

        if (String(err?.message || "") === "PO_COMMITTED_CONFLICT") {
          const details = Array.isArray(err.details) ? err.details.join("; ") : "";
          return json(
            {
              success: false,
              error:
                `Unable to save container because PO committed quantities changed in the database. ` +
                `Refresh and try again.${details ? ` (${details})` : ""}`,
              debug,
            },
            { status: 200 }
          );
        }

        return json({ success: false, error: "Server error while creating container.", debug }, { status: 200 });
      }

      const full = await loadContainerWithPoByDbId(createdId);
      const mapped = mapDbContainerToUi(full || {});
      return json({ success: true, container: mapped, shipment: mapped, debug }, { status: 200 });
    }

    // UPDATE
    if (intent === "update") {
      debug.stage = "update";

      // Track who made the update
      const userId = actor?.id ? Number(actor.id) : null;

      const existing = await resolveContainerFromPayload(shipment);
      if (!existing) {
        return json({ success: false, error: "Container not found. Refresh and try again.", debug }, { status: 200 });
      }
      const id = existing.id;

      if (actorIsSupplier && String(existing.companyId || "").trim() !== actorCompanyId) {
        return json({ success: false, error: "Not authorized." }, { status: 403 });
      }

      const supplierId = actorIsSupplier
        ? String(existing.companyId || "").trim()
        : String(shipment.supplierId || "").trim() || existing.companyId;

      const company = await logisticsDb.tlkp_company.findUnique({
        where: { shortName: supplierId },
        select: { shortName: true, displayName: true },
      });

      const companyName =
        (company?.displayName && String(company.displayName).trim()) || supplierId;

      // Container number is optional and can be cleared.
      const containerNumberProvided =
        shipment && Object.prototype.hasOwnProperty.call(shipment, "containerNumber");
      const containerNumberRaw = String(shipment.containerNumber || "").trim().toUpperCase();
      const containerNumber = containerNumberProvided
        ? cleanStrOrNull(containerNumberRaw)
        : existing.containerNumber;

      const containerSize = cleanStrOrNull(shipment.containerSize);
      const portOfOrigin = cleanStrOrNull(shipment.portOfOrigin);
      const destinationPort = cleanStrOrNull(shipment.destinationPort);
      const status = cleanStrOrNull(shipment.status);

      const etaDate = parseDateLike(shipment.eta);
      const cargoReadyDate = parseDateLike(shipment.cargoReadyDate);
      // ETD maps to estimatedDeliveryToOrigin - use etd if provided, otherwise estimatedDeliveryToOrigin
      const estimatedDeliveryToOrigin = parseDateLike(shipment.etd) || parseDateLike(shipment.estimatedDeliveryToOrigin);

      const supplierPi = cleanStrOrNull(shipment.supplierPi);
      const bookingNumber = cleanStrOrNull(shipment.bookingNumber);
      const bookingAgent = cleanStrOrNull(shipment.bookingAgent);
      const vesselName = cleanStrOrNull(shipment.vesselName);
      const deliveryAddress = cleanStrOrNull(shipment.deliveryAddress);

      // Upload documentation files if present
      let packingListUrl = undefined; // undefined = don't update
      let packingListFileName = undefined;
      let commercialInvoiceUrl = undefined;
      let commercialInvoiceFileName = undefined;
      if (packingListFile || commercialInvoiceFile) {
        const shop = await resolveShopForAdmin(request);
        if (!shop) {
          return json({ success: false, error: "Could not resolve shop for file upload.", debug }, { status: 200 });
        }
        if (packingListFile) {
          try {
            packingListUrl = await uploadShipmentDocumentToShopifyFiles({ shop, file: packingListFile });
            packingListFileName = String(packingListFile.name || "packing-list.pdf");
          } catch (uploadErr) {
            console.error("[logistics shipments] packing list upload error:", uploadErr);
            return json(
              { success: false, error: `Packing List upload failed: ${uploadErr.message}`, debug },
              { status: 200 }
            );
          }
        }

        if (commercialInvoiceFile) {
          try {
            commercialInvoiceUrl = await uploadShipmentDocumentToShopifyFiles({
              shop,
              file: commercialInvoiceFile,
            });
            commercialInvoiceFileName = String(commercialInvoiceFile.name || "commercial-invoice.pdf");
          } catch (uploadErr) {
            console.error("[logistics shipments] commercial invoice upload error:", uploadErr);
            return json(
              { success: false, error: `Commercial Invoice upload failed: ${uploadErr.message}`, debug },
              { status: 200 }
            );
          }
        }
      }

      // Notes entered during update go to tbl_containerNotes, not to the shipment record
      const updateNotes = cleanStrOrNull(shipment.notes);

      // Quantity: preserve existing if blank/omitted
      const quantityRaw = shipment.quantity;
      const quantityProvided =
        quantityRaw !== undefined &&
        quantityRaw !== null &&
        String(quantityRaw).trim() !== "";

      let quantity;
      if (quantityProvided) {
        const qtyParsed = parseBigIntLike(quantityRaw);
        if (qtyParsed && typeof qtyParsed === "object" && qtyParsed.error) {
          return json({ success: false, error: qtyParsed.error, debug }, { status: 200 });
        }
        quantity = qtyParsed;
      } else {
        quantity = undefined; // do not update DB
      }

      // Purchase orders: preserve unless purchaseOrderGIDs is explicitly present
      const poFieldPresent = shipment && Object.prototype.hasOwnProperty.call(shipment, "purchaseOrderGIDs");
      const nextPurchaseOrderGIDs = poFieldPresent ? normalizePurchaseOrderGIDsFromPayload(shipment) : null;

      // Product quantities: preserve unless productQuantities is explicitly present
      const productQuantitiesPresent = shipment && Object.prototype.hasOwnProperty.call(shipment, "productQuantities");
      const nextProductQuantities = productQuantitiesPresent ? normalizeProductQuantitiesFromPayload(shipment) : null;
      const poQuantitiesPresent = shipment && Object.prototype.hasOwnProperty.call(shipment, "poQuantities");
      const nextPoQuantities = poQuantitiesPresent ? normalizePoQuantitiesFromPayload(shipment) : null;

      // Data to update in tbl_container (notes field is NOT updated - initial notes stay)
      const data = {
        companyId: supplierId,
        companyName,
        containerNumber,
        containerSize,
        portOfOrigin,
        destinationPort,
        etaDate,

        cargoReadyDate,
        estimatedDeliveryToOrigin,
        supplierPi,
        bookingNumber,
        bookingAgent,
        vesselName,
        deliveryAddress,

        status,
        updatedAt: new Date(),
      };

      if (quantity !== undefined) {
        data.quantity = quantity;
      }

      // Add documentation fields if uploaded
      if (packingListUrl !== undefined) {
        data.packingListUrl = packingListUrl;
        data.packingListFileName = packingListFileName;
      }
      if (commercialInvoiceUrl !== undefined) {
        data.commercialInvoiceUrl = commercialInvoiceUrl;
        data.commercialInvoiceFileName = commercialInvoiceFileName;
      }

      // Detect changes for the history log
      const changes = detectChanges(existing, data);

      // Track PO changes separately
      if (poFieldPresent) {
        const oldGids = await logisticsDb.tbljn_container_purchaseOrder.findMany({
          where: { containerID: id },
          select: { purchaseOrderGID: true },
        });
        const oldGidSet = new Set(oldGids.map((x) => x.purchaseOrderGID));
        const newGidSet = new Set(nextPurchaseOrderGIDs || []);

        const added = [...newGidSet].filter((g) => !oldGidSet.has(g));
        const removed = [...oldGidSet].filter((g) => !newGidSet.has(g));

        if (added.length || removed.length) {
          changes.push({
            field: "Purchase Orders",
            from: oldGids.length ? oldGids.map((x) => x.purchaseOrderGID).join(", ") : "(none)",
            to: nextPurchaseOrderGIDs?.length ? nextPurchaseOrderGIDs.join(", ") : "(none)",
          });
        }
      }

      // Track product quantity changes
      if (productQuantitiesPresent) {
        const oldProducts = await logisticsDb.tbljn_container_purchaseOrder_rslProduct.findMany({
          where: { containerID: id },
          include: { tlkp_rslProduct: { select: { displayName: true } } },
        });

        // Build maps for comparison
        const oldQtyMap = new Map();
        for (const p of oldProducts) {
          const key = String(p.rslProductID || "").trim();
          if (!key) continue;
          const prev = oldQtyMap.get(key) || {
            quantity: 0,
            displayName: p.tlkp_rslProduct?.displayName || key,
          };
          oldQtyMap.set(key, {
            quantity: (Number(prev.quantity) || 0) + (Number(p.quantity) || 0),
            displayName: prev.displayName,
          });
        }

        const newQtyMap = new Map();
        for (const pq of nextProductQuantities || []) {
          newQtyMap.set(pq.rslProductID, pq.quantity);
        }

        // Check for added, removed, or changed quantities
        const allProductIds = new Set([...oldQtyMap.keys(), ...newQtyMap.keys()]);
        for (const productId of allProductIds) {
          const oldData = oldQtyMap.get(productId);
          const oldQty = oldData?.quantity ?? 0;
          const newQty = newQtyMap.get(productId) ?? 0;
          const displayName = oldData?.displayName || productId;

          if (oldQty !== newQty) {
            if (oldQty === 0 && newQty > 0) {
              changes.push({
                field: `Product: ${displayName}`,
                from: "(not set)",
                to: String(newQty),
              });
            } else if (oldQty > 0 && newQty === 0) {
              changes.push({
                field: `Product: ${displayName}`,
                from: String(oldQty),
                to: "(removed)",
              });
            } else {
              changes.push({
                field: `Product: ${displayName}`,
                from: String(oldQty),
                to: String(newQty),
              });
            }
          }
        }
      }

      try {
        await logisticsDb.$transaction(async (tx) => {
          await tx.tbl_container.update({ where: { id }, data });

          if (poFieldPresent) {
            const gids = nextPurchaseOrderGIDs || [];
            await validatePurchaseOrdersExist(tx, gids);
            await validatePurchaseOrdersHaveProForma(tx, gids);

            await tx.tbljn_container_purchaseOrder.deleteMany({
              where: { containerID: id },
            });

            if (gids.length) {
              await tx.tbljn_container_purchaseOrder.createMany({
                data: gids.map((purchaseOrderGID) => ({
                  containerID: id,
                  purchaseOrderGID,
                })),
              });
            }
          }

          const shouldSyncAllocations = poFieldPresent || poQuantitiesPresent || productQuantitiesPresent;
          if (shouldSyncAllocations) {
            const effectivePoGids = poFieldPresent
              ? (nextPurchaseOrderGIDs || [])
              : uniqStrings(
                (
                  await tx.tbljn_container_purchaseOrder.findMany({
                    where: { containerID: id },
                    select: { purchaseOrderGID: true },
                  })
                ).map((x) => String(x.purchaseOrderGID || ""))
              );

            const existingAllocationRows = await tx.tbljn_container_purchaseOrder_rslProduct.findMany({
              where: { containerID: id },
              select: { rslProductID: true, quantity: true },
            });
            const effectiveProductQuantities = productQuantitiesPresent
              ? (nextProductQuantities || [])
              : buildProductQuantitiesFromAllocationRows(existingAllocationRows);

            const allocationPlan = await prepareContainerAllocationChanges(tx, {
              containerId: id,
              purchaseOrderGIDs: effectivePoGids,
              poQuantities: poQuantitiesPresent ? (nextPoQuantities || {}) : {},
              productQuantities: effectiveProductQuantities,
            });

            await applyCommittedQuantityDeltas(tx, allocationPlan.committedDeltas);

            await tx.tbljn_container_purchaseOrder_rslProduct.deleteMany({
              where: { containerID: id },
            });
            if (allocationPlan.allocationRows.length) {
              await tx.tbljn_container_purchaseOrder_rslProduct.createMany({
                data: allocationPlan.allocationRows.map((row) => ({
                  containerID: id,
                  purchaseOrderGID: row.purchaseOrderGID,
                  rslProductID: row.rslProductID,
                  quantity: row.quantity,
                })),
              });
            }
          }

          // Create a history note if there are changes or notes
          if (changes.length > 0 || updateNotes) {
            await tx.tbl_containerNotes.create({
              data: {
                containerId: id,
                userId: userId,
                content: updateNotes || "",
                changes: changes.length > 0 ? JSON.stringify(changes) : null,
              },
            });
          }
        });
      } catch (err) {
        console.error("[logistics shipments] update error:", err);

        if (String(err?.message || "") === "PO_NOT_FOUND") {
          const missing = Array.isArray(err.missing) ? err.missing.join(", ") : "";
          return json(
            { success: false, error: `Purchase Order not found: ${missing || "unknown"}.`, debug },
            { status: 200 }
          );
        }

        if (String(err?.message || "") === "PO_MISSING_PRO_FORMA") {
          const missing = Array.isArray(err.missing) ? err.missing.join(", ") : "";
          return json(
            {
              success: false,
              error: `A Pro-forma invoice is required before using Purchase Order(s): ${missing || "unknown"}.`,
              debug,
            },
            { status: 200 }
          );
        }

        if (String(err?.message || "") === "PO_COMMITTED_CONFLICT") {
          const details = Array.isArray(err.details) ? err.details.join("; ") : "";
          return json(
            {
              success: false,
              error:
                `Unable to save container because PO committed quantities changed in the database. ` +
                `Refresh and try again.${details ? ` (${details})` : ""}`,
              debug,
            },
            { status: 200 }
          );
        }

        return json({ success: false, error: "Server error while updating container.", debug }, { status: 200 });
      }

      const full = await loadContainerWithPoByDbId(id);
      const mapped = mapDbContainerToUi(full || {});
      return json({ success: true, container: mapped, shipment: mapped, debug }, { status: 200 });
    }

    // DELETE
    if (intent === "delete") {
      debug.stage = "delete";

      const existing = await resolveContainerFromPayload(shipment);
      if (!existing) {
        return json({ success: false, error: "Container not found. Refresh and try again.", debug }, { status: 200 });
      }
      const id = existing.id;

      if (actorIsSupplier && String(existing.companyId || "").trim() !== actorCompanyId) {
        return json({ success: false, error: "Not authorized." }, { status: 403 });
      }

      await logisticsDb.$transaction(async (tx) => {
        const allocationRows = await tx.tbljn_container_purchaseOrder_rslProduct.findMany({
          where: { containerID: id },
          select: { purchaseOrderGID: true, rslProductID: true, quantity: true },
        });

        if (allocationRows.length) {
          await applyCommittedQuantityDeltas(
            tx,
            allocationRows
              .filter((row) => Number(row.quantity) > 0)
              .map((row) => ({
                purchaseOrderGID: row.purchaseOrderGID,
                rslProductID: row.rslProductID,
                delta: -Math.abs(Number(row.quantity) || 0),
              }))
          );
        }

        await tx.tbljn_container_purchaseOrder_rslProduct.deleteMany({
          where: { containerID: id },
        });
        await tx.tbljn_container_purchaseOrder.deleteMany({
          where: { containerID: id },
        });
        await tx.tbl_container.delete({ where: { id } });
      });

      return json(
        { success: true, deletedId: normalizeRslLogisticsID(existing.rslLogisticsID) || String(id), debug },
        { status: 200 }
      );
    }

    return json({ success: false, error: "Unknown intent.", debug }, { status: 200 });
  } catch (err) {
    console.error("[logistics shipments] unexpected error:", err, debug);
    return json({ success: false, error: "Server error while saving container.", debug }, { status: 200 });
  }
}
