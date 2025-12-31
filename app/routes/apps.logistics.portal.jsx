// app/routes/apps.logistics.portal.jsx
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { verifyProxyIfPresent } from "~/utils/app-proxy-verify.server";
import { logisticsDb } from "~/logistics-db.server";
import { getLogisticsUser } from "~/logistics-auth.server";
import LogisticsApp from "~/logistics-ui/LogisticsApp";

function normalizeUserTypeForUi(dbUserType) {
  const raw = String(dbUserType || "").trim().toLowerCase();
  return raw.includes("supplier") ? "RSL Supplier" : "RSL Internal";
}

function mapDbPermissionSetToUi(dbShortNamesSet) {
  const has = (k) => dbShortNamesSet.has(k);

  return {
    viewUserManagement: has("user_view"),
    createEditUser: has("user_create") || has("user_update") || has("user_delete"),
    modifyShipper: has("shipment_update"),
    editDashboard: has("dashboard_update"),
    viewDashboard: has("dashboard_view"),
    viewShipment: has("shipment_view"),
    createUpdateShipment: has("shipment_create") || has("shipment_update"),
  };
}

function toIsoOrEmpty(d) {
  if (!d) return "";
  try {
    return new Date(d).toISOString().slice(0, 10);
  } catch {
    return "";
  }
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

/**
 * Schema-accurate shipment -> PO link reader:
 * tbl_shipment.tbljn_shipment_purchaseOrder[].tbl_purchaseOrder
 */
function pickPurchaseOrdersInfoFromShipment(s) {
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

/**
 * Avoid "cannot read ... findMany" hard-crashes if a model is missing from the generated client
 * (e.g. deploy didn't run prisma generate), and keep portal usable.
 */
async function safeFindMany(model, args, label) {
  try {
    if (!model || typeof model.findMany !== "function") {
      console.warn("[logistics portal] safeFindMany: model missing:", label);
      return [];
    }
    return await model.findMany(args);
  } catch (err) {
    console.error("[logistics portal] safeFindMany error:", label, err);
    return [];
  }
}

export async function loader({ request }) {
  const debug = { proxyVerified: false };

  // 1) Best-effort proxy verification
  try {
    await verifyProxyIfPresent(request);
    debug.proxyVerified = true;
  } catch (err) {
    if (err instanceof Response && err.status === 401) {
      debug.proxyVerified = false;
      debug.proxySkipReason = "no_proxy_signature";
      console.warn("[logistics portal] proxy verification skipped:", { status: err.status });
    } else {
      console.error("[logistics portal] proxy verification error:", err);
    }
  }

  // 2) Session user (if any)
  const sessionUser = await getLogisticsUser(request);
  const sessionUserId = sessionUser?.id ?? null;
  const sessionEmail = sessionUser?.email ?? null;

  // 3) Fetch shipments + users + lookups
  let shipments = [];
  let users = [];
  let companies = [];
  let containers = [];
  let originPorts = [];
  let destinationPorts = [];
  let bookingAgents = [];
  let deliveryAddresses = [];
  let purchaseOrders = [];
  let rslModels = [];

  // Do NOT use Promise.all() that can fail-all if one query fails.
  // Each query is isolated so login doesn't break.
  const shipmentRows = await safeFindMany(
    logisticsDb.tbl_shipment,
    {
      orderBy: { etaDate: "asc" },
      include: {
        // schema: tbl_shipment.tbljn_shipment_purchaseOrder[]
        tbljn_shipment_purchaseOrder: {
          include: {
            // schema: tbljn_shipment_purchaseOrder.tbl_purchaseOrder
            tbl_purchaseOrder: { select: { purchaseOrderGID: true, shortName: true } },
          },
        },
      },
    },
    "tbl_shipment"
  );

  let userRows = await safeFindMany(
    logisticsDb.tbl_logisticsUser,
    {
      orderBy: { id: "asc" },
      include: {
        // schema: tbl_logisticsUser.tbljn_logisticsUser_permission[]
        tbljn_logisticsUser_permission: {
          include: {
            // schema: tbljn_logisticsUser_permission.tlkp_permission
            tlkp_permission: true,
          },
        },
      },
    },
    "tbl_logisticsUser"
  );

  // If the main users query failed but we have a session, try to load just the session user
  if ((!userRows || userRows.length === 0) && (sessionUserId || sessionEmail)) {
    const where = sessionUserId
      ? { id: Number(sessionUserId) }
      : { email: String(sessionEmail) };

    const oneUserRows = await safeFindMany(
      logisticsDb.tbl_logisticsUser,
      {
        where,
        take: 1,
        include: {
          tbljn_logisticsUser_permission: {
            include: { tlkp_permission: true },
          },
        },
      },
      "tbl_logisticsUser(session fallback)"
    );
    if (oneUserRows && oneUserRows.length > 0) userRows = oneUserRows;
  }

  const companyRows = await safeFindMany(
    logisticsDb.tlkp_company,
    { select: { shortName: true, displayName: true }, orderBy: { shortName: "asc" } },
    "tlkp_company"
  );

  const containerRows = await safeFindMany(
    logisticsDb.tlkp_container,
    { select: { shortName: true, displayName: true }, orderBy: { shortName: "asc" } },
    "tlkp_container"
  );

  const originRows = await safeFindMany(
    logisticsDb.tlkp_originPort,
    { select: { shortName: true, displayName: true }, orderBy: { shortName: "asc" } },
    "tlkp_originPort"
  );

  const destRows = await safeFindMany(
    logisticsDb.tlkp_destinationPort,
    { select: { shortName: true, displayName: true }, orderBy: { shortName: "asc" } },
    "tlkp_destinationPort"
  );

  const bookingAgentRows = await safeFindMany(
    logisticsDb.tlkp_bookingAgent,
    { select: { shortName: true, displayName: true }, orderBy: { shortName: "asc" } },
    "tlkp_bookingAgent"
  );

  const deliveryAddressRows = await safeFindMany(
    logisticsDb.tlkp_deliveryAddress,
    { select: { shortName: true, displayName: true }, orderBy: { shortName: "asc" } },
    "tlkp_deliveryAddress"
  );

  const purchaseOrderRows = await safeFindMany(
    logisticsDb.tbl_purchaseOrder,
    {
      orderBy: { shortName: "asc" },
      select: {
        id: true,
        purchaseOrderGID: true,
        shortName: true,
        purchaseOrderPdfUrl: true,
        createdAt: true,
        updatedAt: true,

        // schema: tbl_purchaseOrder.tbljn_purchaseOrder_rslProduct[]
        tbljn_purchaseOrder_rslProduct: {
          select: {
            rslProductID: true,
            quantity: true,
            // schema: tbljn_purchaseOrder_rslProduct.tlkp_rslProduct
            tlkp_rslProduct: { select: { shortName: true, displayName: true, SKU: true } },
          },
        },

        // schema: tbl_purchaseOrder.tbljn_purchaseOrder_company[]
        tbljn_purchaseOrder_company: {
          take: 1,
          select: {
            // schema: tbljn_purchaseOrder_company.tlkp_company
            tlkp_company: { select: { shortName: true, displayName: true } },
          },
        },

        // schema: tbl_purchaseOrder.tbl_purchaseOrderNotes[]
        tbl_purchaseOrderNotes: {
          orderBy: [{ createdAt: "desc" }],
          select: {
            id: true,
            createdAt: true,
            content: true,
            pdfUrl: true,
            pdfFileName: true,
            eventType: true,
            // schema: tbl_purchaseOrderNotes.tbl_logisticsUser
            tbl_logisticsUser: { select: { displayName: true } },
          },
        },
      },
    },
    "tbl_purchaseOrder"
  );

  const rslModelRows = await safeFindMany(
    logisticsDb.tlkp_rslProduct,
    { select: { shortName: true, displayName: true, SKU: true }, orderBy: [{ displayName: "asc" }] },
    "tlkp_rslProduct"
  );

  // Map shipments
  shipments = (shipmentRows || []).map((s) => {
    const po = pickPurchaseOrdersInfoFromShipment(s);
    return {
      id: String(s.id),
      supplierId: s.companyId,
      supplierName: s.companyName,
      products: [],

      containerNumber: s.containerNumber,
      containerSize: s.containerSize ?? "",
      portOfOrigin: s.portOfOrigin ?? "",
      destinationPort: s.destinationPort ?? "",

      cargoReadyDate: toIsoOrEmpty(s.cargoReadyDate),
      etd: "",
      actualDepartureDate: "",
      eta: toIsoOrEmpty(s.etaDate),
      sealNumber: "",
      hblNumber: "",
      estimatedDeliveryDate: "",
      status: s.status ?? "",

      estimatedDeliveryToOrigin: toIsoOrEmpty(s.estimatedDeliveryToOrigin),
      supplierPi: s.supplierPi ?? "",
      quantity: s.quantity != null ? String(s.quantity) : "",
      bookingAgent: s.bookingAgent ?? "",
      bookingNumber: s.bookingNumber ?? "",
      vesselName: s.vesselName ?? "",
      deliveryAddress: s.deliveryAddress ?? "",
      notes: s.notes ?? "",

      purchaseOrderGIDs: po.purchaseOrderGIDs,
      purchaseOrderShortNames: po.purchaseOrderShortNames,
    };
  });

  // Map users
  users = (userRows || []).map((u) => {
    const userType = normalizeUserTypeForUi(u.userType);
    const role = userType === "RSL Supplier" ? "supplier" : "internal";
    const supplierId = role === "supplier" ? u.companyID ?? null : null;

    const dbPerms = new Set(
      (u.tbljn_logisticsUser_permission || [])
        .map((x) => x.tlkp_permission?.shortName)
        .filter(Boolean)
    );

    return {
      id: String(u.id),
      email: u.email,
      password: "",
      userType,
      isActive: u.isActive !== false,
      permissions: mapDbPermissionSetToUi(dbPerms),
      name: u.displayName || u.email,
      role,
      supplierId,
      companyName: u.companyID || "",
    };
  });

  companies = (companyRows || []).map((c) => ({ shortName: c.shortName, displayName: c.displayName }));
  containers = (containerRows || []).map((c) => ({ shortName: c.shortName, displayName: c.displayName }));
  originPorts = (originRows || []).map((p) => ({ shortName: p.shortName, displayName: p.displayName }));
  destinationPorts = (destRows || []).map((p) => ({ shortName: p.shortName, displayName: p.displayName }));
  bookingAgents = (bookingAgentRows || []).map((b) => ({ shortName: b.shortName, displayName: b.displayName }));
  deliveryAddresses = (deliveryAddressRows || []).map((d) => ({ shortName: d.shortName, displayName: d.displayName }));

  purchaseOrders = (purchaseOrderRows || []).map((po) => {
    const company = po.tbljn_purchaseOrder_company?.[0]?.tlkp_company || null;

    const products = Array.isArray(po.tbljn_purchaseOrder_rslProduct)
      ? po.tbljn_purchaseOrder_rslProduct.map((l) => ({
        rslProductID: l.rslProductID,
        shortName: l.tlkp_rslProduct?.shortName || l.rslProductID,
        displayName: l.tlkp_rslProduct?.displayName || l.rslProductID,
        SKU: l.tlkp_rslProduct?.SKU || null,
        quantity: typeof l.quantity === "number" ? l.quantity : 0,
      }))
      : [];

    const notes = Array.isArray(po.tbl_purchaseOrderNotes)
      ? po.tbl_purchaseOrderNotes.map((n) => ({
        id: String(n.id),
        timestamp: n.createdAt ? new Date(n.createdAt).toISOString() : new Date().toISOString(),
        content: n.content || "",
        eventType: n.eventType === "PDF_UPDATE" ? "New PDF Uploaded" : n.eventType,
        pdfUrl: n.pdfUrl || null,
        pdfFileName: n.pdfFileName || null,
        user: n.tbl_logisticsUser?.displayName || null,
      }))
      : [];

    const lastUpdatedBy = notes.length > 0 && notes[0].user ? notes[0].user : null;

    return {
      id: po.id,
      purchaseOrderGID: po.purchaseOrderGID,
      shortName: po.shortName,
      purchaseOrderPdfUrl: po.purchaseOrderPdfUrl || null,
      createdAt: po.createdAt ? po.createdAt.toISOString() : null,
      updatedAt: po.updatedAt ? po.updatedAt.toISOString() : null,

      products,

      companyID: company?.shortName || null,
      companyName: company?.displayName || company?.shortName || null,
      lastUpdatedBy,
      notes,
    };
  });

  rslModels = (rslModelRows || []).map((m) => ({
    shortName: m.shortName,
    displayName: m.displayName,
    SKU: m.SKU,
  }));

  const currentUser = sessionUserId
    ? users.find((u) => String(u.id) === String(sessionUserId)) || null
    : null;

  return json({
    initialShipments: shipments,
    initialUsers: users,
    companies,
    containers,
    originPorts,
    destinationPorts,
    bookingAgents,
    deliveryAddresses,
    purchaseOrders,
    rslModels,
    currentUser,
    debug,
  });
}

export default function LogisticsPortalRoute() {
  const {
    initialShipments,
    initialUsers,
    companies,
    containers,
    originPorts,
    destinationPorts,
    bookingAgents,
    deliveryAddresses,
    purchaseOrders,
    rslModels,
    currentUser,
  } = useLoaderData();

  return (
    <html lang="en">
    <head>
      <meta charSet="utf-8" />
      <title>RSL Logistics Portal</title>
    </head>
    <body>
    <div id="logistics-root">
      <LogisticsApp
        initialShipments={initialShipments}
        initialUsers={initialUsers}
        companies={companies}
        containers={containers}
        originPorts={originPorts}
        destinationPorts={destinationPorts}
        bookingAgents={bookingAgents}
        deliveryAddresses={deliveryAddresses}
        purchaseOrders={purchaseOrders}
        rslModels={rslModels}
        currentUser={currentUser}
      />
    </div>
    </body>
    </html>
  );
}
