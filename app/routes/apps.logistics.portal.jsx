// app/routes/apps.logistics.portal.jsx
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { verifyProxyIfPresent } from "~/utils/app-proxy-verify.server";
import { logisticsDb } from "~/logistics-db.server";
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

export async function loader({ request }) {
  const debug = { proxyVerified: false };

  // Best-effort proxy verification
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

  let shipments = [];
  let users = [];
  let companies = [];
  let containers = [];
  let originPorts = [];
  let destinationPorts = [];

  try {
    const [
      shipmentRows,
      userRows,
      companyRows,
      containerRows,
      originRows,
      destRows,
    ] = await Promise.all([
      logisticsDb.tbl_shipment.findMany({ orderBy: { etaDate: "asc" } }),
      logisticsDb.tbl_logisticsUser.findMany({
        orderBy: { id: "asc" },
        include: { permissionLinks: { include: { permission: true } } },
      }),
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
    ]);

    companies = companyRows ?? [];
    containers = containerRows ?? [];
    originPorts = originRows ?? [];
    destinationPorts = destRows ?? [];

    shipments = shipmentRows.map((s) => ({
      id: String(s.id),
      supplierId: s.companyId,
      supplierName: s.companyName,
      products: [],

      containerNumber: s.containerNumber,
      containerSize: s.containerSize ?? "",
      portOfOrigin: s.portOfOrigin ?? "",
      destinationPort: s.destinationPort ?? "",

      cargoReadyDate: "",
      etd: "",
      actualDepartureDate: "",
      eta: s.etaDate ? s.etaDate.toISOString().slice(0, 10) : "",
      sealNumber: "",
      hblNumber: "",
      estimatedDeliveryDate: "",
      status: s.status ?? "",
    }));

    users = userRows.map((u) => {
      const userType = normalizeUserTypeForUi(u.userType);
      const role = userType === "RSL Supplier" ? "supplier" : "internal";
      const supplierId = role === "supplier" ? u.companyID ?? null : null;

      const dbPerms = new Set(
        (u.permissionLinks || [])
          .map((x) => x.permission?.shortName)
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
  } catch (err) {
    console.error("[logistics portal] DB error:", err);
  }

  return json({
    initialShipments: shipments,
    initialUsers: users,
    initialCompanies: companies,
    initialContainers: containers,
    initialOriginPorts: originPorts,
    initialDestinationPorts: destinationPorts,
    debug,
  });
}

export default function LogisticsPortalRoute() {
  const {
    initialShipments,
    initialUsers,
    initialCompanies,
    initialContainers,
    initialOriginPorts,
    initialDestinationPorts,
  } = useLoaderData();

  // IMPORTANT: return only the app content so Remix root provides CSS/JS
  return (
    <LogisticsApp
      initialShipments={initialShipments}
      initialUsers={initialUsers}
      initialCompanies={initialCompanies}
      initialContainers={initialContainers}
      initialOriginPorts={initialOriginPorts}
      initialDestinationPorts={initialDestinationPorts}
    />
  );
}
