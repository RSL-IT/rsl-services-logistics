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

function pickPurchaseOrdersInfo(s) {
  const links = Array.isArray(s?.purchaseOrders) ? s.purchaseOrders : [];
  const gids = links
    .map((l) => l?.purchaseOrder?.purchaseOrderGID)
    .filter(Boolean)
    .map((x) => String(x));
  const names = links
    .map((l) => l?.purchaseOrder?.shortName)
    .filter(Boolean)
    .map((x) => String(x));

  return {
    purchaseOrderGIDs: uniqStrings(gids),
    purchaseOrderShortNames: uniqStrings(names),
  };
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

  try {
    const [
      shipmentRows,
      userRows,
      companyRows,
      containerRows,
      originRows,
      destRows,
      bookingAgentRows,
      deliveryAddressRows,
      purchaseOrderRows,
    ] = await Promise.all([
      logisticsDb.tbl_shipment.findMany({
        orderBy: { etaDate: "asc" },
        include: { purchaseOrders: { include: { purchaseOrder: true } } },
      }),
      logisticsDb.tbl_logisticsUser.findMany({
        orderBy: { id: "asc" },
        include: { permissionLinks: { include: { permission: true } } },
      }),
      // Supplier dropdown source in this schema is tlkp_company (shortName/displayName)
      logisticsDb.tlkp_company.findMany({
        select: { shortName: true, displayName: true },
        orderBy: { shortName: "asc" },
      }),
      logisticsDb.tlkp_container.findMany({
        select: { shortName: true, displayName: true },
        orderBy: { shortName: "asc" },
      }),
      logisticsDb.tlkp_originPort.findMany({
        select: { shortName: true, displayName: true },
        orderBy: { shortName: "asc" },
      }),
      logisticsDb.tlkp_destinationPort.findMany({
        select: { shortName: true, displayName: true },
        orderBy: { shortName: "asc" },
      }),
      logisticsDb.tlkp_bookingAgent.findMany({
        select: { shortName: true, displayName: true },
        orderBy: { shortName: "asc" },
      }),
      logisticsDb.tlkp_deliveryAddress.findMany({
        select: { shortName: true, displayName: true },
        orderBy: { shortName: "asc" },
      }),
      logisticsDb.tbl_purchaseOrder.findMany({
        select: { purchaseOrderGID: true, shortName: true },
        orderBy: { shortName: "asc" },
      }),
    ]);

    shipments = shipmentRows.map((s) => {
      const po = pickPurchaseOrdersInfo(s);
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

    users = userRows.map((u) => {
      const userType = normalizeUserTypeForUi(u.userType);
      const role = userType === "RSL Supplier" ? "supplier" : "internal";
      const supplierId = role === "supplier" ? u.companyID ?? null : null;

      const dbPerms = new Set(
        (u.permissionLinks || []).map((x) => x.permission?.shortName).filter(Boolean)
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

    companies = companyRows.map((c) => ({ shortName: c.shortName, displayName: c.displayName }));
    containers = containerRows.map((c) => ({ shortName: c.shortName, displayName: c.displayName }));
    originPorts = originRows.map((p) => ({ shortName: p.shortName, displayName: p.displayName }));
    destinationPorts = destRows.map((p) => ({ shortName: p.shortName, displayName: p.displayName }));
    bookingAgents = bookingAgentRows.map((b) => ({ shortName: b.shortName, displayName: b.displayName }));
    deliveryAddresses = deliveryAddressRows.map((d) => ({ shortName: d.shortName, displayName: d.displayName }));
    purchaseOrders = purchaseOrderRows.map((po) => ({
      purchaseOrderGID: po.purchaseOrderGID,
      shortName: po.shortName,
    }));
  } catch (err) {
    console.error("[logistics portal] DB error:", err);
  }

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
            currentUser={currentUser}
          />
        </div>
      </body>
    </html>
  );
}
