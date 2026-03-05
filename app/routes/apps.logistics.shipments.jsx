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
  supplierPiFileName: "Pro Forma Invoice",
  quantity: "Quantity",
  bookingNumber: "Booking #",
  bookingAgent: "Booking Agent",
  vesselName: "Vessel Name",
  deliveryAddress: "Delivery Address",
  status: "Status",
};

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
      // For Pro Forma Invoice, include the URL with the filename as JSON
      if (field === "supplierPiFileName") {
        const oldUrl = existing.supplierPiUrl || null;
        const newUrl = newData.supplierPiUrl || null;
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

    containerNumber: s.containerNumber,
    containerSize: s.containerSize ?? "",
    portOfOrigin: s.portOfOrigin ?? "",
    destinationPort: s.destinationPort ?? "",

    cargoReadyDate: toYyyyMmDd(s.cargoReadyDate),
    etd: toYyyyMmDd(s.estimatedDeliveryToOrigin),
    estimatedDeliveryToOrigin: toYyyyMmDd(s.estimatedDeliveryToOrigin),
    supplierPi: s.supplierPi ?? "",
    supplierPiUrl: s.supplierPiUrl ?? "",
    supplierPiFileName: s.supplierPiFileName ?? "",
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
 * Upload PI Form PDF to Shopify Files.
 */
async function uploadPiFormToShopifyFiles({ shop, file }) {
  const filename = file.name || "pi-form.pdf";
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
    let piFormFile = null;

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

      // Get the PI form file if present
      const piForm = formData.get("piForm");
      const hasPiForm = piForm && typeof piForm === "object" && typeof piForm.arrayBuffer === "function";
      piFormFile = hasPiForm ? piForm : null;

      // Validate PI form if present
      if (piFormFile) {
        const name = String(piFormFile.name || "");
        const type = String(piFormFile.type || "");
        const looksPdf = type === "application/pdf" || name.toLowerCase().endsWith(".pdf");
        if (!looksPdf) {
          return json({ success: false, error: "Only PDF uploads are supported for PI Form." }, { status: 200 });
        }
        const maxBytes = 20 * 1024 * 1024;
        if (typeof piFormFile.size === "number" && piFormFile.size > maxBytes) {
          return json({ success: false, error: "PI Form PDF is too large (max 20MB)." }, { status: 200 });
        }
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
      const containerNumber = String(shipment.containerNumber || "").trim().toUpperCase();

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
      const notes = cleanStrOrNull(shipment.notes);

      const qtyParsed = parseBigIntLike(shipment.quantity);
      if (qtyParsed && typeof qtyParsed === "object" && qtyParsed.error) {
        return json({ success: false, error: qtyParsed.error, debug }, { status: 200 });
      }
      const quantity = qtyParsed;

      const purchaseOrderGIDs = normalizePurchaseOrderGIDsFromPayload(shipment);
      const productQuantities = normalizeProductQuantitiesFromPayload(shipment);

      if (actorIsSupplier && !supplierId) {
        return json({ success: false, error: "Supplier account has no company mapping." }, { status: 403 });
      }

      if (!supplierId || !containerNumber) {
        return json(
          { success: false, error: "Supplier and Container # are required.", debug },
          { status: 200 }
        );
      }

      const company = await logisticsDb.tlkp_company.findUnique({
        where: { shortName: supplierId },
        select: { shortName: true, displayName: true },
      });

      const companyName =
        (company?.displayName && String(company.displayName).trim()) || supplierId;

      // Upload PI form if present
      let supplierPiUrl = null;
      let supplierPiFileName = null;
      if (piFormFile) {
        const shop = await resolveShopForAdmin(request);
        if (!shop) {
          return json({ success: false, error: "Could not resolve shop for file upload.", debug }, { status: 200 });
        }
        try {
          supplierPiUrl = await uploadPiFormToShopifyFiles({ shop, file: piFormFile });
          supplierPiFileName = String(piFormFile.name || "pi-form.pdf");
        } catch (uploadErr) {
          console.error("[logistics shipments] PI form upload error:", uploadErr);
          return json({ success: false, error: `PI Form upload failed: ${uploadErr.message}`, debug }, { status: 200 });
        }
      }

      let createdId;

      try {
        createdId = await logisticsDb.$transaction(async (tx) => {
          await validatePurchaseOrdersExist(tx, purchaseOrderGIDs);

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
              supplierPiUrl,
              supplierPiFileName,
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

      const etaDate = parseDateLike(shipment.eta);
      const cargoReadyDate = parseDateLike(shipment.cargoReadyDate);
      // ETD maps to estimatedDeliveryToOrigin - use etd if provided, otherwise estimatedDeliveryToOrigin
      const estimatedDeliveryToOrigin = parseDateLike(shipment.etd) || parseDateLike(shipment.estimatedDeliveryToOrigin);

      const supplierPi = cleanStrOrNull(shipment.supplierPi);
      const bookingNumber = cleanStrOrNull(shipment.bookingNumber);
      const bookingAgent = cleanStrOrNull(shipment.bookingAgent);
      const vesselName = cleanStrOrNull(shipment.vesselName);
      const deliveryAddress = cleanStrOrNull(shipment.deliveryAddress);

      // Upload PI form if present
      let supplierPiUrl = undefined; // undefined = don't update
      let supplierPiFileName = undefined;
      if (piFormFile) {
        const shop = await resolveShopForAdmin(request);
        if (!shop) {
          return json({ success: false, error: "Could not resolve shop for file upload.", debug }, { status: 200 });
        }
        try {
          supplierPiUrl = await uploadPiFormToShopifyFiles({ shop, file: piFormFile });
          supplierPiFileName = String(piFormFile.name || "pi-form.pdf");
        } catch (uploadErr) {
          console.error("[logistics shipments] PI form upload error:", uploadErr);
          return json({ success: false, error: `PI Form upload failed: ${uploadErr.message}`, debug }, { status: 200 });
        }
      }

      // Notes entered during update go to tbl_shipmentNotes, not to the shipment record
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

      // Add PI form fields if uploaded
      if (supplierPiUrl !== undefined) {
        data.supplierPiUrl = supplierPiUrl;
        data.supplierPiFileName = supplierPiFileName;
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
