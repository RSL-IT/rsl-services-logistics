// app/logistics-ui/LogisticsApp.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";

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

import type { UIPurchaseOrder, RslModelOption } from "./components/PurchaseOrderDetailsModal";

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

  // Product list used when creating POs
  rslModels?: RslModelOption[];

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
                                       rslModels,
                                       currentUser,
                                       initialError,
                                     }: LogisticsAppProps) {
  // Support both naming conventions: shipments/initialShipments, users/initialUsers
  const shipmentsData = shipments ?? initialShipments;
  const usersData = users ?? initialUsers;

  // Session storage keys
  const SESSION_KEY = "logistics_session";

  // Track if user has explicitly logged out this session (to prevent auto-login from server props)
  const hasLoggedOutRef = useRef(false);

  // Helper to get initial state from sessionStorage or default
  const getInitialSessionState = () => {
    if (typeof window === "undefined") return null;
    try {
      const stored = sessionStorage.getItem(SESSION_KEY);
      if (stored) {
        return JSON.parse(stored);
      }
    } catch {
      // ignore parse errors
    }
    return null;
  };

  const savedSession = getInitialSessionState();

  // Initialize state from session storage if available, otherwise use defaults
  const [currentView, setCurrentView] = useState<ViewType>(() => {
    // If server sent currentUser, user is already logged in
    if (currentUser) {
      return savedSession?.currentView || "dashboard";
    }
    return "login";
  });

  const [supplierId, setSupplierId] = useState<string | null>(() => {
    if (currentUser) {
      return savedSession?.supplierId || currentUser.supplierId || null;
    }
    return null;
  });

  const [shipmentsState, setShipmentsState] = useState<Shipment[]>(
    Array.isArray(shipmentsData) ? shipmentsData : [],
  );

  const [usersState, setUsersState] = useState<UIUser[]>(
    Array.isArray(usersData) ? usersData : [],
  );

  const [purchaseOrdersState, setPurchaseOrdersState] = useState<UIPurchaseOrder[]>(
    Array.isArray(purchaseOrders) ? purchaseOrders : [],
  );

  const rslModelsSafe = useMemo(() => {
    if (!Array.isArray(rslModels)) return [] as RslModelOption[];
    return rslModels
      .filter((m) => m && String(m.shortName || "").trim())
      .map((m) => ({
        shortName: String(m.shortName).trim(),
        displayName: String((m.displayName ?? m.shortName) || "").trim(),
        SKU: String((m.SKU ?? "") || "").trim(),
      }));
  }, [rslModels]);

  // Use server-provided currentUser if available
  const [currentUserState, setCurrentUserState] = useState<UIUser | null>(() => {
    if (currentUser) return currentUser;
    return null;
  });

  // Persist session state to sessionStorage whenever it changes
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (hasLoggedOutRef.current) return; // Don't persist after logout

    // Only persist if user is actually logged in
    if (currentUserState && currentView !== "login") {
      const sessionData = {
        currentView,
        supplierId,
        currentUserId: currentUserState?.id || null,
      };

      try {
        sessionStorage.setItem(SESSION_KEY, JSON.stringify(sessionData));
      } catch {
        // ignore storage errors
      }
    }
  }, [currentView, supplierId, currentUserState]);

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

  const logout = async () => {
    // Mark that user has logged out to prevent auto-login from stale server props
    hasLoggedOutRef.current = true;

    // Clear all client-side session storage first
    if (typeof window !== "undefined") {
      try {
        sessionStorage.removeItem(SESSION_KEY);
        sessionStorage.removeItem("logistics_po_modal");
      } catch {
        // ignore
      }
    }

    // Call server to clear the session cookie
    try {
      await fetch("/apps/logistics/logout", { method: "POST" });
    } catch {
      // ignore - we'll clear client state anyway
    }

    // Clear client state
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
          rslModels={rslModelsSafe}
          currentUser={currentUserState}
          onBack={() => setCurrentView("dashboard")}
          onLogout={logout}
        />
      )}
    </div>
  );
}
