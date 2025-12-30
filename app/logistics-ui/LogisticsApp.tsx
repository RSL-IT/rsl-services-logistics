// app/logistics-ui/LogisticsApp.tsx
import React, { useMemo, useState } from "react";

import Login from "./components/Login";
import { SupplierView } from "./components/SupplierView";
import { InternalDashboard } from "./components/InternalDashboard";
import { UserManagement } from "./components/UserManagement";
import { PurchaseOrderManagement } from "./components/PurchaseOrderManagement";

import type {
  Role,
  UIUser,
  CompanyOption,
  LookupOption,
  PurchaseOrderOption,
} from "./components/types";

import type { UIPurchaseOrder } from "./components/PurchaseOrderDetailsModal";

// Re-export types that other components import from LogisticsApp
export type { CompanyOption, LookupOption, PurchaseOrderOption } from "./components/types";

// -------------------- Types used by this file --------------------

export type Shipment = {
  id: string;

  supplierId: string;
  supplierName: string;

  products: any[];

  containerNumber: string;
  containerSize: string;

  portOfOrigin: string;
  destinationPort: string;
  deliveryAddress?: string | null;

  cargoReadyDate: string; // YYYY-MM-DD
  etd: string; // YYYY-MM-DD
  actualDepartureDate?: string | null;

  eta: string; // YYYY-MM-DD
  estimatedDeliveryDate?: string | null;

  sealNumber?: string | null;
  hblNumber?: string | null;

  status?: string | null;

  estimatedDeliveryToOrigin?: string | null;
  supplierPi?: string | null;
  quantity?: number | string | null;
  bookingAgent?: string | null;
  bookingNumber?: string | null;
  vesselName?: string | null;
  notes?: string | null;

  purchaseOrderGIDs?: string[] | null;
  purchaseOrderShortNames?: string[] | null;
};

// Raw lookup shapes that can come from loaders (often allow null displayName)
type RawLookup = { shortName: string; displayName?: string | null };
type RawCompany = { shortName: string; displayName?: string | null };

type ViewType = "login" | "supplier" | "dashboard" | "users" | "purchaseOrders";

interface LogisticsAppProps {
  // Accept both naming conventions for compatibility
  shipments?: Shipment[];
  initialShipments?: Shipment[];
  users?: UIUser[];
  initialUsers?: UIUser[];

  companies: RawCompany[];
  containers: RawLookup[];
  originPorts: RawLookup[];
  destinationPorts: RawLookup[];
  bookingAgents: RawLookup[];
  deliveryAddresses: RawLookup[];

  // used for shipment PO selection + PO management (PO management will refresh from server)
  purchaseOrders: UIPurchaseOrder[];

  currentUser?: UIUser | null;
  initialError?: string | null;
}

function normalizeLookup(list: RawLookup[] | null | undefined): LookupOption[] {
  if (!Array.isArray(list)) return [];
  return list
    .filter((x) => x && String(x.shortName || "").trim())
    .map((x) => ({
      shortName: String(x.shortName).trim(),
      displayName: String((x.displayName ?? x.shortName) || "").trim(),
    }));
}

function normalizeCompanies(list: RawCompany[] | null | undefined): CompanyOption[] {
  if (!Array.isArray(list)) return [];
  return list
    .filter((x) => x && String(x.shortName || "").trim())
    .map((x) => ({
      shortName: String(x.shortName).trim(),
      displayName: String((x.displayName ?? x.shortName) || "").trim(),
    }));
}

function buildPurchaseOrderOptions(purchaseOrders: UIPurchaseOrder[]): PurchaseOrderOption[] {
  const seen = new Set<string>();
  const out: PurchaseOrderOption[] = [];
  for (const po of purchaseOrders || []) {
    const gid = String(po?.purchaseOrderGID || "").trim();
    const label = String(po?.shortName || "").trim();
    if (!gid || !label) continue;
    if (seen.has(gid)) continue;
    seen.add(gid);
    out.push({ purchaseOrderGID: gid, shortName: label });
  }
  return out;
}

export default function LogisticsApp({
                                       shipments,
                                       initialShipments,
                                       users,
                                       initialUsers,
                                       companies,
                                       containers,
                                       originPorts,
                                       destinationPorts,
                                       bookingAgents,
                                       deliveryAddresses,
                                       purchaseOrders,
                                       currentUser,
                                       initialError,
                                     }: LogisticsAppProps) {
  const [currentView, setCurrentView] = useState<ViewType>("login");
  const [supplierId, setSupplierId] = useState<string | null>(null);

  // Support both naming conventions: shipments/initialShipments, users/initialUsers
  const shipmentsData = shipments ?? initialShipments;
  const usersData = users ?? initialUsers;

  const [shipmentsState, setShipmentsState] = useState<Shipment[]>(
    Array.isArray(shipmentsData) ? shipmentsData : [],
  );

  const [usersState, setUsersState] = useState<UIUser[]>(
    Array.isArray(usersData) ? usersData : [],
  );

  const [purchaseOrdersState, setPurchaseOrdersState] = useState<UIPurchaseOrder[]>(
    Array.isArray(purchaseOrders) ? purchaseOrders : [],
  );

  const [currentUserState, setCurrentUserState] = useState<UIUser | null>(
    currentUser ?? null,
  );

  const companiesSafe = useMemo(() => normalizeCompanies(companies), [companies]);
  const containersSafe = useMemo(() => normalizeLookup(containers), [containers]);
  const originPortsSafe = useMemo(() => normalizeLookup(originPorts), [originPorts]);
  const destinationPortsSafe = useMemo(() => normalizeLookup(destinationPorts), [destinationPorts]);
  const bookingAgentsSafe = useMemo(() => normalizeLookup(bookingAgents), [bookingAgents]);
  const deliveryAddressesSafe = useMemo(() => normalizeLookup(deliveryAddresses), [deliveryAddresses]);

  const purchaseOrderOptions = useMemo(
    () => buildPurchaseOrderOptions(purchaseOrdersState),
    [purchaseOrdersState],
  );

  const logout = () => {
    setCurrentUserState(null);
    setSupplierId(null);
    setCurrentView("login");
  };

  const handleLogin = (role: Role, userArg: UIUser, supplierIdArg?: string | null) => {
    setCurrentUserState(userArg ?? null);

    if (role === "supplier") {
      setSupplierId(supplierIdArg ?? null);
      setCurrentView("supplier");
      return;
    }

    setSupplierId(null);
    setCurrentView("dashboard");
  };

  return (
    <div style={{ minHeight: "100vh" }}>
      {currentView === "login" && (
        <Login
          onLogin={handleLogin}
          users={usersState}
          initialError={initialError ?? null}
        />
      )}

      {currentView === "supplier" && supplierId && (
        <SupplierView
          supplierId={supplierId}
          shipments={shipmentsState}
          onLogout={logout}
        />
      )}

      {currentView === "dashboard" && (
        <InternalDashboard
          shipments={shipmentsState}
          onShipmentsChange={(next) => setShipmentsState(next)}
          companies={companiesSafe}
          containers={containersSafe}
          originPorts={originPortsSafe}
          destinationPorts={destinationPortsSafe}
          bookingAgents={bookingAgentsSafe}
          deliveryAddresses={deliveryAddressesSafe}
          purchaseOrders={purchaseOrderOptions}
          currentUser={currentUserState}
          onNavigateToUsers={() => setCurrentView("users")}
          onNavigateToPurchaseOrders={() => setCurrentView("purchaseOrders")}
          onLogout={logout}
        />
      )}

      {currentView === "users" && (
        <UserManagement
          users={usersState}
          onUsersChange={(next) => setUsersState(next)}
          companies={companiesSafe}
          onBack={() => setCurrentView("dashboard")}
          onLogout={logout}
        />
      )}

      {currentView === "purchaseOrders" && (
        <PurchaseOrderManagement
          purchaseOrders={purchaseOrdersState}
          onPurchaseOrdersChange={(next) => setPurchaseOrdersState(next)}
          companies={companiesSafe}
          currentUser={currentUserState}
          onBack={() => setCurrentView("dashboard")}
          onLogout={logout}
        />
      )}
    </div>
  );
}
