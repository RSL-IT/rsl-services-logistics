// app/routes/apps.logistics.shipments.jsx
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

function buildPendingContainerPlaceholder() {
  const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `${PENDING_CONTAINER_PREFIX}${Date.now()}-${rand}`.toUpperCase();
}

function isPendingContainerPlaceholder(value) {
  const s = String(value || "").trim().toUpperCase();
  return s.startsWith(PENDING_CONTAINER_PREFIX);
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

function validateUploadedPdf(file, label) {
  if (!file) return null;

  const name = String(file.name || "");
  const type = String(file.type || "");
  const looksPdf = type === "application/pdf" || name.toLowerCase().endsWith(".pdf");
  if (!looksPdf) return `Only PDF uploads are supported for ${label}.`;

  const maxBytes = 20 * 1024 * 1024;
  if (typeof file.size === "number" && file.size > maxBytes) {
    return `${label} PDF is too large (max 20MB).`;
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
  const links = Array.isArray(s?.tbljn_shipment_purchaseOrder) ? s.tbljn_shipment_purchaseOrder : [];
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

function mapDbShipmentToUi(s) {
  const po = pickPurchaseOrdersInfo(s);
  const rawContainerNumber = String(s.containerNumber ?? "").trim();
  const statusLower = String(s.status ?? "").trim().toLowerCase();
  const hidePendingPlaceholder = isPendingContainerPlaceholder(rawContainerNumber) && statusLower === "pending";

  // Map shipment notes/history
  const history = Array.isArray(s.tbl_shipmentNotes)
    ? s.tbl_shipmentNotes.map((n) => ({
        id: String(n.id),
        timestamp: n.createdAt ? new Date(n.createdAt).toISOString() : new Date().toISOString(),
        content: n.content || "",
        changes: n.changes || null,
        user: n.tbl_logisticsUser?.displayName || null,
      }))
    : [];

  // Map shipment product quantities
  const products = Array.isArray(s.tbljn_shipment_rslProduct)
    ? s.tbljn_shipment_rslProduct.map((p) => ({
        rslProductID: p.rslProductID,
        shortName: p.tlkp_rslProduct?.shortName || p.rslProductID,
        displayName: p.tlkp_rslProduct?.displayName || p.rslProductID,
        SKU: p.tlkp_rslProduct?.SKU || null,
        quantity: p.quantity,
      }))
    : [];

  // Build productQuantities map for easy access
  const productQuantities = {};
  for (const p of products) {
    productQuantities[p.rslProductID] = p.quantity;
  }

  return {
    id: String(s.id),
    supplierId: s.companyId,
    supplierName: s.companyName,
    products,
    productQuantities,

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

async function loadShipmentWithPo(id) {
  return logisticsDb.tbl_shipment.findUnique({
    where: { id },
    include: {
      tbljn_shipment_purchaseOrder: {
        include: {
          tbl_purchaseOrder: { select: { purchaseOrderGID: true, shortName: true } },
        },
      },
      tbljn_shipment_rslProduct: {
        include: {
          tlkp_rslProduct: { select: { shortName: true, displayName: true, SKU: true } },
        },
      },
      tbl_shipmentNotes: {
        orderBy: { createdAt: "desc" },
        include: {
          tbl_logisticsUser: { select: { displayName: true } },
        },
      },
    },
  });
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

async function prepareCommittedQuantityUpdates(tx, {
  purchaseOrderGIDs,
  poQuantities,
  productQuantities,
}) {
  const gids = uniqStrings(purchaseOrderGIDs || []);
  if (!gids.length || !poQuantities || typeof poQuantities !== "object") return [];

  const keyFor = (gid, productId) => `${gid}::${productId}`;
  const requestedByKey = new Map();

  for (const [productIdRaw, rowRaw] of Object.entries(poQuantities)) {
    const productId = String(productIdRaw || "").trim();
    if (!productId || !rowRaw || typeof rowRaw !== "object") continue;
    for (const [gidRaw, remainingRaw] of Object.entries(rowRaw)) {
      const gid = String(gidRaw || "").trim();
      if (!gid || !gids.includes(gid)) continue;
      const remaining = parseInt(String(remainingRaw ?? ""), 10);
      if (Number.isNaN(remaining) || remaining < 0) continue;
      requestedByKey.set(keyFor(gid, productId), {
        purchaseOrderGID: gid,
        rslProductID: productId,
        remaining,
      });
    }
  }

  const requestedRows = [...requestedByKey.values()];
  if (!requestedRows.length) return [];

  const dbRows = await tx.tbljn_purchaseOrder_rslProduct.findMany({
    where: {
      OR: requestedRows.map((x) => ({
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

  const dbByKey = new Map(
    dbRows.map((r) => [keyFor(r.purchaseOrderGID, r.rslProductID), r])
  );

  const desiredUsedByProduct = new Map();
  const updates = [];
  const conflicts = [];

  for (const req of requestedRows) {
    const db = dbByKey.get(keyFor(req.purchaseOrderGID, req.rslProductID));
    if (!db) continue; // no PO/product reference, ignore

    const initial = Number(db.initialQuantity) || 0;
    const currentCommitted = Number(db.committedQuantity) || 0;
    const currentAvailable = Math.max(0, initial - currentCommitted);
    const remaining = Math.min(Math.max(req.remaining, 0), initial);
    const desiredUsed = Math.max(0, initial - remaining);

    if (desiredUsed > currentAvailable) {
      conflicts.push(
        `${req.purchaseOrderGID}/${req.rslProductID} requested ${desiredUsed}, available ${currentAvailable}`
      );
      continue;
    }

    desiredUsedByProduct.set(
      req.rslProductID,
      (desiredUsedByProduct.get(req.rslProductID) || 0) + desiredUsed
    );

    updates.push({
      purchaseOrderGID: req.purchaseOrderGID,
      rslProductID: req.rslProductID,
      committedQuantity: desiredUsed,
    });
  }

  const productQtyMap = new Map(
    (productQuantities || []).map((pq) => [String(pq.rslProductID), Number(pq.quantity) || 0])
  );
  for (const [productId, desiredUsed] of desiredUsedByProduct.entries()) {
    const expected = productQtyMap.get(productId) || 0;
    if (expected !== desiredUsed) {
      conflicts.push(
        `${productId} container quantity mismatch (PO fields total ${desiredUsed}, This Container ${expected})`
      );
    }
  }

  if (conflicts.length) {
    const err = new Error("PO_COMMITTED_CONFLICT");
    err.details = conflicts;
    throw err;
  }

  return updates;
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
      const shipmentRaw = cleanStrOrNull(formData.get("shipment"));
      let shipmentData = {};
      try {
        shipmentData = shipmentRaw ? JSON.parse(shipmentRaw) : {};
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

      const packingListValidationError = validateUploadedPdf(packingListFile, "Packing List");
      if (packingListValidationError) {
        return json({ success: false, error: packingListValidationError }, { status: 200 });
      }

      const commercialInvoiceValidationError = validateUploadedPdf(commercialInvoiceFile, "Commercial Invoice");
      if (commercialInvoiceValidationError) {
        return json({ success: false, error: commercialInvoiceValidationError }, { status: 200 });
      }

      payload = { intent, shipment: shipmentData };
    } else {
      const formData = await request.formData();
      payload = Object.fromEntries(formData);
      if (typeof payload.shipment === "string") {
        try {
          payload.shipment = JSON.parse(payload.shipment);
        } catch {
          // ignore
        }
      }
    }

    const intent = payload.intent;
    const shipment = payload.shipment || {};
    debug.intent = intent;

    if (!intent) {
      return json({ success: false, error: "Missing intent.", debug }, { status: 200 });
    }

    // CREATE
    if (intent === "create") {
      debug.stage = "create";

      const supplierId = actorIsSupplier ? actorCompanyId : String(shipment.supplierId || "").trim();
      let containerNumber = String(shipment.containerNumber || "").trim().toUpperCase();

      const containerSize = cleanStrOrNull(shipment.containerSize);
      const portOfOrigin = cleanStrOrNull(shipment.portOfOrigin);
      const destinationPort = cleanStrOrNull(shipment.destinationPort);
      const status = cleanStrOrNull(shipment.status) || "Pending";
      const isPendingStatus = String(status || "").trim().toLowerCase() === "pending";

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

      if (!containerNumber && !isPendingStatus) {
        return json(
          { success: false, error: "Container # is required unless status is Pending.", debug },
          { status: 200 }
        );
      }

      if (!containerNumber && isPendingStatus) {
        containerNumber = buildPendingContainerPlaceholder();
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
        createdId = await logisticsDb.$transaction(async (tx) => {
          await validatePurchaseOrdersExist(tx, purchaseOrderGIDs);
          await validatePurchaseOrdersHaveProForma(tx, purchaseOrderGIDs);
          const committedUpdates = await prepareCommittedQuantityUpdates(tx, {
            purchaseOrderGIDs,
            poQuantities,
            productQuantities,
          });

          const created = await tx.tbl_shipment.create({
            data: {
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
            await tx.tbljn_shipment_purchaseOrder.createMany({
              data: purchaseOrderGIDs.map((purchaseOrderGID) => ({
                shipmentID: containerNumber,
                purchaseOrderGID,
              })),
            });
          }

          // Save product quantities
          if (productQuantities.length) {
            await tx.tbljn_shipment_rslProduct.createMany({
              data: productQuantities.map((pq) => ({
                shipmentId: created.id,
                rslProductID: pq.rslProductID,
                quantity: pq.quantity,
              })),
            });
          }

          if (committedUpdates.length) {
            for (const row of committedUpdates) {
              await tx.tbljn_purchaseOrder_rslProduct.updateMany({
                where: {
                  purchaseOrderGID: row.purchaseOrderGID,
                  rslProductID: row.rslProductID,
                },
                data: { committedQuantity: row.committedQuantity },
              });
            }
          }

          // Always add a history entry so create events are visible in the modal timeline.
          await tx.tbl_shipmentNotes.create({
            data: {
              shipmentId: created.id,
              userId: actor?.id ? Number(actor.id) : null,
              content: "Shipment created.",
              changes: null,
            },
          });

          return created.id;
        });
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

        return json(
          { success: false, error: "Container # already exists (must be unique).", debug },
          { status: 200 }
        );
      }

      const full = await loadShipmentWithPo(createdId);
      return json({ success: true, shipment: mapDbShipmentToUi(full || {}), debug }, { status: 200 });
    }

    // UPDATE
    if (intent === "update") {
      debug.stage = "update";

      // Track who made the update
      const userId = actor?.id ? Number(actor.id) : null;

      const id = Number(shipment.id);
      if (!id || Number.isNaN(id)) {
        return json({ success: false, error: "Missing shipment id.", debug }, { status: 200 });
      }

      const existing = await logisticsDb.tbl_shipment.findUnique({ where: { id } });
      if (!existing) {
        return json({ success: false, error: "Shipment not found.", debug }, { status: 200 });
      }

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

      // Container number - can be updated, but need to update join table references
      const containerNumberRaw = String(shipment.containerNumber || "").trim().toUpperCase();
      const containerNumber = containerNumberRaw || existing.containerNumber;
      const containerNumberChanged = containerNumber !== existing.containerNumber;

      const containerSize = cleanStrOrNull(shipment.containerSize);
      const portOfOrigin = cleanStrOrNull(shipment.portOfOrigin);
      const destinationPort = cleanStrOrNull(shipment.destinationPort);
      const status = cleanStrOrNull(shipment.status);
      const effectiveStatus = status ?? cleanStrOrNull(existing.status) ?? "";
      const isPendingStatus = String(effectiveStatus || "").trim().toLowerCase() === "pending";
      const existingContainerIsPlaceholder = isPendingContainerPlaceholder(existing.containerNumber);

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

      // Notes entered during update go to tbl_shipmentNotes, not to the shipment record
      const updateNotes = cleanStrOrNull(shipment.notes);

      if (!containerNumberRaw && !isPendingStatus && existingContainerIsPlaceholder) {
        return json(
          { success: false, error: "Container # is required unless status is Pending.", debug },
          { status: 200 }
        );
      }

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

      // Data to update in tbl_shipment (notes field is NOT updated - initial notes stay)
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
        const oldGids = await logisticsDb.tbljn_shipment_purchaseOrder.findMany({
          where: { shipmentID: existing.containerNumber },
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
        const oldProducts = await logisticsDb.tbljn_shipment_rslProduct.findMany({
          where: { shipmentId: id },
          include: { tlkp_rslProduct: { select: { displayName: true } } },
        });

        // Build maps for comparison
        const oldQtyMap = new Map();
        for (const p of oldProducts) {
          oldQtyMap.set(p.rslProductID, {
            quantity: p.quantity,
            displayName: p.tlkp_rslProduct?.displayName || p.rslProductID,
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
          await tx.tbl_shipment.update({ where: { id }, data });

          // If container number changed but POs not explicitly updated, update the join table references
          if (containerNumberChanged && !poFieldPresent) {
            await tx.tbljn_shipment_purchaseOrder.updateMany({
              where: { shipmentID: existing.containerNumber },
              data: { shipmentID: containerNumber },
            });
          }

          if (poFieldPresent) {
            const gids = nextPurchaseOrderGIDs || [];
            await validatePurchaseOrdersExist(tx, gids);
            await validatePurchaseOrdersHaveProForma(tx, gids);

            await tx.tbljn_shipment_purchaseOrder.deleteMany({
              where: { shipmentID: existing.containerNumber },
            });

            if (gids.length) {
              await tx.tbljn_shipment_purchaseOrder.createMany({
                data: gids.map((purchaseOrderGID) => ({
                  shipmentID: containerNumber, // Use new containerNumber
                  purchaseOrderGID,
                })),
              });
            }
          }

          if (poQuantitiesPresent) {
            const effectivePoGids = poFieldPresent
              ? (nextPurchaseOrderGIDs || [])
              : uniqStrings(
                (
                  await tx.tbljn_shipment_purchaseOrder.findMany({
                    where: { shipmentID: containerNumber },
                    select: { purchaseOrderGID: true },
                  })
                ).map((x) => String(x.purchaseOrderGID || ""))
              );

            const effectiveProductQuantities = productQuantitiesPresent
              ? (nextProductQuantities || [])
              : (
                await tx.tbljn_shipment_rslProduct.findMany({
                  where: { shipmentId: id },
                  select: { rslProductID: true, quantity: true },
                })
              ).map((x) => ({
                rslProductID: String(x.rslProductID || "").trim(),
                quantity: Number(x.quantity) || 0,
              }));

            const committedUpdates = await prepareCommittedQuantityUpdates(tx, {
              purchaseOrderGIDs: effectivePoGids,
              poQuantities: nextPoQuantities || {},
              productQuantities: effectiveProductQuantities,
            });

            if (committedUpdates.length) {
              for (const row of committedUpdates) {
                await tx.tbljn_purchaseOrder_rslProduct.updateMany({
                  where: {
                    purchaseOrderGID: row.purchaseOrderGID,
                    rslProductID: row.rslProductID,
                  },
                  data: { committedQuantity: row.committedQuantity },
                });
              }
            }
          }

          // Update product quantities if provided
          if (productQuantitiesPresent) {
            // Delete existing product quantities
            await tx.tbljn_shipment_rslProduct.deleteMany({
              where: { shipmentId: id },
            });

            // Insert new product quantities
            const pqs = nextProductQuantities || [];
            if (pqs.length) {
              await tx.tbljn_shipment_rslProduct.createMany({
                data: pqs.map((pq) => ({
                  shipmentId: id,
                  rslProductID: pq.rslProductID,
                  quantity: pq.quantity,
                })),
              });
            }
          }

          // Create a history note if there are changes or notes
          if (changes.length > 0 || updateNotes) {
            await tx.tbl_shipmentNotes.create({
              data: {
                shipmentId: id,
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

        return json({ success: false, error: "Server error while updating shipment.", debug }, { status: 200 });
      }

      const full = await loadShipmentWithPo(id);
      return json({ success: true, shipment: mapDbShipmentToUi(full || {}), debug }, { status: 200 });
    }

    // DELETE
    if (intent === "delete") {
      debug.stage = "delete";

      const id = Number(shipment.id);
      if (!id || Number.isNaN(id)) {
        return json({ success: false, error: "Missing shipment id.", debug }, { status: 200 });
      }

      const existing = await logisticsDb.tbl_shipment.findUnique({ where: { id } });
      if (!existing) {
        return json({ success: false, error: "Shipment not found.", debug }, { status: 200 });
      }

      if (actorIsSupplier && String(existing.companyId || "").trim() !== actorCompanyId) {
        return json({ success: false, error: "Not authorized." }, { status: 403 });
      }

      await logisticsDb.tbljn_shipment_purchaseOrder.deleteMany({
        where: { shipmentID: existing.containerNumber },
      });

      await logisticsDb.tbl_shipment.delete({ where: { id } });

      return json({ success: true, deletedId: String(id), debug }, { status: 200 });
    }

    return json({ success: false, error: "Unknown intent.", debug }, { status: 200 });
  } catch (err) {
    console.error("[logistics shipments] unexpected error:", err, debug);
    return json({ success: false, error: "Server error while saving shipment.", debug }, { status: 200 });
  }
}
