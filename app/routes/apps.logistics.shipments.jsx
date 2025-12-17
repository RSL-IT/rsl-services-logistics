// app/routes/apps.logistics.shipments.jsx
import { json } from "@remix-run/node";
import { verifyProxyIfPresent } from "~/utils/app-proxy-verify.server";
import { logisticsDb } from "~/logistics-db.server";

function parseDateLike(value) {
  const v = String(value ?? "").trim();
  if (!v) return null;

  // YYYY-MM-DD
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

/**
 * Quantity is BigInt in DB, UI uses string.
 * Integer-only; commas/spaces allowed.
 */
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

function mapDbShipmentToUi(s) {
  return {
    id: String(s.id),
    supplierId: s.companyId,
    supplierName: s.companyName,
    products: [],

    containerNumber: s.containerNumber,
    containerSize: s.containerSize ?? "",
    portOfOrigin: s.portOfOrigin ?? "",
    destinationPort: s.destinationPort ?? "",

    // NEW fields
    cargoReadyDate: toYyyyMmDd(s.cargoReadyDate),
    estimatedDeliveryToOrigin: toYyyyMmDd(s.estimatedDeliveryToOrigin),
    supplierPi: s.supplierPi ?? "",
    quantity: s.quantity != null ? String(s.quantity) : "",
    bookingNumber: s.bookingNumber ?? "",
    notes: s.notes ?? "",

    // Existing UI fields
    etd: "",
    actualDepartureDate: "",
    eta: toYyyyMmDd(s.etaDate),
    sealNumber: "",
    hblNumber: "",
    estimatedDeliveryDate: "",
    status: s.status ?? "",
  };
}

export async function action({ request }) {
  const debug = { stage: "start", proxyVerified: false };

  // Best-effort proxy verification
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

    if (contentType.includes("application/json")) {
      payload = await request.json();
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

      const supplierId = String(shipment.supplierId || "").trim();
      const containerNumber = String(shipment.containerNumber || "").trim().toUpperCase();

      const containerSize = cleanStrOrNull(shipment.containerSize);
      const portOfOrigin = cleanStrOrNull(shipment.portOfOrigin);
      const destinationPort = cleanStrOrNull(shipment.destinationPort);
      const status = cleanStrOrNull(shipment.status);

      const etaDate = parseDateLike(shipment.eta);

      // NEW date fields
      const cargoReadyDate = parseDateLike(shipment.cargoReadyDate);
      const estimatedDeliveryToOrigin = parseDateLike(shipment.estimatedDeliveryToOrigin);

      // NEW strings
      const supplierPi = cleanStrOrNull(shipment.supplierPi);
      const bookingNumber = cleanStrOrNull(shipment.bookingNumber);
      const notes = cleanStrOrNull(shipment.notes);

      // NEW BigInt
      const qtyParsed = parseBigIntLike(shipment.quantity);
      if (qtyParsed && typeof qtyParsed === "object" && qtyParsed.error) {
        return json({ success: false, error: qtyParsed.error, debug }, { status: 200 });
      }
      const quantity = qtyParsed; // BigInt | null

      if (!supplierId || !containerNumber) {
        return json(
          { success: false, error: "Supplier and Container # are required.", debug },
          { status: 200 }
        );
      }

      // companyName is required on tbl_shipment
      const company = await logisticsDb.tlkp_company.findUnique({
        where: { shortName: supplierId },
        select: { shortName: true, displayName: true },
      });

      const companyName =
        (company?.displayName && String(company.displayName).trim()) || supplierId;

      let created;
      try {
        created = await logisticsDb.tbl_shipment.create({
          data: {
            companyId: supplierId,
            companyName,
            containerNumber,
            containerSize,
            portOfOrigin,
            destinationPort,
            etaDate,

            // NEW fields
            cargoReadyDate,
            estimatedDeliveryToOrigin,
            supplierPi,
            quantity,
            bookingNumber,
            notes,

            status,
          },
        });
      } catch (err) {
        console.error("[logistics shipments] create error:", err);
        return json(
          { success: false, error: "Container # already exists (must be unique).", debug },
          { status: 200 }
        );
      }

      return json({ success: true, shipment: mapDbShipmentToUi(created), debug }, { status: 200 });
    }

    // UPDATE
    if (intent === "update") {
      debug.stage = "update";

      const id = Number(shipment.id);
      if (!id || Number.isNaN(id)) {
        return json({ success: false, error: "Missing shipment id.", debug }, { status: 200 });
      }

      const existing = await logisticsDb.tbl_shipment.findUnique({ where: { id } });
      if (!existing) {
        return json({ success: false, error: "Shipment not found.", debug }, { status: 200 });
      }

      const supplierId = String(shipment.supplierId || "").trim() || existing.companyId;

      const company = await logisticsDb.tlkp_company.findUnique({
        where: { shortName: supplierId },
        select: { shortName: true, displayName: true },
      });

      const companyName =
        (company?.displayName && String(company.displayName).trim()) || supplierId;

      const containerSize = cleanStrOrNull(shipment.containerSize);
      const portOfOrigin = cleanStrOrNull(shipment.portOfOrigin);
      const destinationPort = cleanStrOrNull(shipment.destinationPort);
      const status = cleanStrOrNull(shipment.status);
      const etaDate = parseDateLike(shipment.eta);

      // NEW date fields
      const cargoReadyDate = parseDateLike(shipment.cargoReadyDate);
      const estimatedDeliveryToOrigin = parseDateLike(shipment.estimatedDeliveryToOrigin);

      // NEW strings
      const supplierPi = cleanStrOrNull(shipment.supplierPi);
      const bookingNumber = cleanStrOrNull(shipment.bookingNumber);
      const notes = cleanStrOrNull(shipment.notes);

      // NEW BigInt (PRESERVE EXISTING IF BLANK)
      const quantityRaw = shipment.quantity;
      const quantityProvided =
        quantityRaw !== undefined &&
        quantityRaw !== null &&
        String(quantityRaw).trim() !== "";

      let quantity; // BigInt | null | undefined
      if (quantityProvided) {
        const qtyParsed = parseBigIntLike(quantityRaw);
        if (qtyParsed && typeof qtyParsed === "object" && qtyParsed.error) {
          return json({ success: false, error: qtyParsed.error, debug }, { status: 200 });
        }
        quantity = qtyParsed; // BigInt | null (null only if parseBigIntLike returned null, but provided => should be BigInt)
      } else {
        quantity = undefined; // do not update the DB column
      }

      // IMPORTANT: do not update containerNumber here
      const data = {
        companyId: supplierId,
        companyName,
        containerSize,
        portOfOrigin,
        destinationPort,
        etaDate,

        cargoReadyDate,
        estimatedDeliveryToOrigin,
        supplierPi,
        bookingNumber,
        notes,

        status,
      };

      if (quantity !== undefined) {
        data.quantity = quantity;
      }

      const updated = await logisticsDb.tbl_shipment.update({
        where: { id },
        data,
      });

      return json({ success: true, shipment: mapDbShipmentToUi(updated), debug }, { status: 200 });
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

      await logisticsDb.tbljn_shipment_company_rslModel.deleteMany({
        where: { shipmentID: existing.containerNumber },
      });
      await logisticsDb.tbljn_shipment_purchaseOrder.deleteMany({
        where: { shipmentID: existing.containerNumber },
      });

      await logisticsDb.tbl_shipment.delete({ where: { id } });

      return json({ success: true, deletedId: String(id), debug }, { status: 200 });
    }

    return json({ success: false, error: "Unknown intent.", debug }, { status: 200 });
  } catch (err) {
    console.error("[logistics shipments] unexpected error:", err, debug);
    return json(
      { success: false, error: "Server error while saving shipment.", debug },
      { status: 200 }
    );
  }
}
