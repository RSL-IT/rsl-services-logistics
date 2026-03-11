// app/logistics-ui/LogisticsApp.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";

import Login from "./components/Login";
import { SupplierView } from "./components/SupplierView";
import { InternalDashboard } from "./components/InternalDashboard";
import { SupplierDashboard } from "./components/SupplierDashboard";
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
import { withShopParam } from "./utils/shop";

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
  packingListUrl?: string | null;
  packingListFileName?: string | null;
  commercialInvoiceUrl?: string | null;
  commercialInvoiceFileName?: string | null;
  quantity?: number | string | null;
  bookingAgent?: string | null;
  bookingNumber?: string | null;
  vesselName?: string | null;
  notes?: string | null;

  purchaseOrderGIDs?: string[] | null;
  purchaseOrderShortNames?: string[] | null;
  poQuantities?: Record<string, Record<string, string | number>> | null;
};

// Raw lookup shapes that can come from loaders (often allow null displayName)
type RawLookup = { shortName: string; displayName?: string | null };
type RawCompany = { shortName: string; displayName?: string | null };

type ViewType = "login" | "supplier" | "dashboard" | "supplierDashboard" | "users" | "purchaseOrders";

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
  isEmbedded?: boolean;
  isProxy?: boolean;
  debugInfo?: any;
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

    // Map products from UIPurchaseOrder to PurchaseOrderProduct format
    const products = Array.isArray(po.products)
      ? po.products.map((p: any) => ({
          rslModelID: String(p.rslModelID || p.rslProductID || "").trim(),
          shortName: p.shortName || undefined,
          displayName: p.displayName || undefined,
          SKU: p.SKU || null,
          initialQuantity:
            typeof p.initialQuantity === "number"
              ? p.initialQuantity
              : (typeof p.quantity === "number" ? p.quantity : 0),
          committedQuantity: typeof p.committedQuantity === "number" ? p.committedQuantity : 0,
          quantity: p.quantity,
        }))
      : [];

    out.push({
      purchaseOrderGID: gid,
      shortName: label,
      products,
      purchaseOrderPdfUrl: po.purchaseOrderPdfUrl || null,
      proFormaInvoiceUrl: po.proFormaInvoiceUrl || null,
      companyID: po.companyID || null,
    });
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
                                       isEmbedded = false,
                                       isProxy = false,
                                       debugInfo = null,
                                     }: LogisticsAppProps) {
  // Support both naming conventions: shipments/initialShipments, users/initialUsers
  const shipmentsData = shipments ?? initialShipments;
  const usersData = users ?? initialUsers;

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const url = new URL(window.location.href);
      const token = url.searchParams.get("logistics_token");
      if (!token) return;
      sessionStorage.setItem("logistics_token", token);
      url.searchParams.delete("logistics_token");
      window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
    } catch {
      // ignore token handling errors
    }
  }, []);

  // Session storage keys
  const SESSION_KEY = "logistics_session";
  const CONTAINER_DRAFT_SESSION_KEY = "logistics_container_modal_draft";

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

  // Helper to determine the correct dashboard view based on user role
  const getDefaultDashboardView = (user: UIUser | null | undefined): ViewType => {
    if (!user) return "login";
    // Check if user is a supplier (RSL Supplier role)
    const userType = String((user as any)?.userType || "").toLowerCase();
    const role = String((user as any)?.role || "").toLowerCase();
    if (userType.includes("supplier") || role === "supplier") {
      return "supplierDashboard";
    }
    return "dashboard";
  };

  // Initialize state from session storage if available, otherwise use defaults
  const [currentView, setCurrentView] = useState<ViewType>(() => {
    // If server sent currentUser, user is already logged in
    if (currentUser) {
      // Use saved view if valid, otherwise determine based on user role
      const savedView = savedSession?.currentView;
      if (savedView && savedView !== "login") {
        return savedView;
      }
      return getDefaultDashboardView(currentUser);
    }
    return "login";
  });

  const [supplierId, setSupplierId] = useState<string | null>(() => {
    if (currentUser) {
      return savedSession?.supplierId || currentUser.supplierId || null;
    }
    return null;
  });

  const showLogout = !isEmbedded;

  const [shipmentsState, setShipmentsState] = useState<Shipment[]>(
    Array.isArray(shipmentsData) ? shipmentsData : [],
  );

  const [usersState, setUsersState] = useState<UIUser[]>(
    Array.isArray(usersData) ? usersData : [],
  );

  const [purchaseOrdersState, setPurchaseOrdersState] = useState<UIPurchaseOrder[]>(
    Array.isArray(purchaseOrders) ? purchaseOrders : [],
  );
  const [showDebug, setShowDebug] = useState(false);
  const canShowDebug = Boolean(debugInfo);
  const [apiProbeRunning, setApiProbeRunning] = useState(false);
  const [apiProbeResult, setApiProbeResult] = useState<any>(null);
  const [apiProbeError, setApiProbeError] = useState<string | null>(null);
  const [apiProbeRanAt, setApiProbeRanAt] = useState<string | null>(null);
  const [apiProbeShop, setApiProbeShop] = useState<string | null>(null);

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

  const unauthorizedMessage = initialError && !currentUserState && isEmbedded;
  useEffect(() => {
    if (!canShowDebug) setShowDebug(false);
  }, [canShowDebug]);

  const runApiProbe = async () => {
    if (!canShowDebug || apiProbeRunning) return;
    setShowDebug(true);
    setApiProbeRunning(true);
    setApiProbeError(null);
    setApiProbeResult(null);
    setApiProbeRanAt(null);
    setApiProbeShop(null);

    try {
      const response = await fetch(withShopParam("/apps/logistics/api-probe"), {
        method: "POST",
      });
      const payload = await response.json().catch(() => null);

      if (!response.ok || !payload?.ok) {
        throw new Error(String(payload?.error || `API probe failed (${response.status}).`));
      }

      setApiProbeResult(payload?.probe ?? null);
      setApiProbeRanAt(String(payload?.ranAt || new Date().toISOString()));
      setApiProbeShop(payload?.shop ? String(payload.shop) : null);

      if (typeof console !== "undefined") {
        // eslint-disable-next-line no-console
        console.info("[logistics ui] api probe success", payload);
      }
    } catch (err: any) {
      const message = String(err?.message || "API probe failed.");
      setApiProbeError(message);
      setApiProbeRanAt(new Date().toISOString());
      if (typeof console !== "undefined") {
        // eslint-disable-next-line no-console
        console.error("[logistics ui] api probe failed:", err);
      }
    } finally {
      setApiProbeRunning(false);
    }
  };

  const debugInfoWithProbe = useMemo(() => {
    const hasProbeDetails = apiProbeRunning || apiProbeResult !== null || Boolean(apiProbeError) || Boolean(apiProbeRanAt);
    if (!hasProbeDetails) return debugInfo;

    const base =
      debugInfo && typeof debugInfo === "object" && !Array.isArray(debugInfo)
        ? { ...debugInfo }
        : debugInfo != null
          ? { debugInfo }
          : {};

    return {
      ...base,
      apiProbe: {
        running: apiProbeRunning,
        ranAt: apiProbeRanAt,
        shop: apiProbeShop,
        ...(apiProbeError ? { error: apiProbeError } : {}),
        ...(apiProbeResult !== null ? { result: apiProbeResult } : {}),
      },
    };
  }, [debugInfo, apiProbeRunning, apiProbeResult, apiProbeError, apiProbeRanAt, apiProbeShop]);

  if (unauthorizedMessage) {
    return (
      <div style={{ minHeight: "100vh", background: "#f8fafc", padding: 18 }}>
        <div
          style={{
            background: "#1e40af",
            color: "#fff",
            borderRadius: 14,
            padding: "14px 16px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            boxShadow: "0 12px 30px rgba(15,23,42,0.15)",
            marginBottom: 14,
          }}
        >
          <div>
            <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: 0.2 }}>
              RSL Logistics Internal Dashboard
            </div>
            <div style={{ fontSize: 12, opacity: 0.92, marginTop: 2 }}>
              Not Logged in
            </div>
          </div>
          {canShowDebug ? (
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
                <input
                  type="checkbox"
                  checked={showDebug}
                  onChange={() => setShowDebug((prev) => !prev)}
                />
                Show Debug
              </label>
              <button
                type="button"
                onClick={() => void runApiProbe()}
                disabled={apiProbeRunning}
                style={{
                  borderRadius: 10,
                  padding: "8px 10px",
                  fontSize: 12,
                  fontWeight: 700,
                  border: "1px solid transparent",
                  cursor: apiProbeRunning ? "not-allowed" : "pointer",
                  background: apiProbeRunning ? "#cbd5e1" : "#2563eb",
                  color: apiProbeRunning ? "#475569" : "#fff",
                }}
              >
                {apiProbeRunning ? "Running Probe..." : "Run API Probe"}
              </button>
            </div>
          ) : null}
        </div>

        {debugInfoWithProbe && showDebug ? (
          <div
            style={{
              marginBottom: 12,
              background: "#fef3c7",
              border: "1px solid #fcd34d",
              borderRadius: 12,
              padding: 12,
              color: "#7c2d12",
              fontSize: 12,
              whiteSpace: "pre-wrap",
            }}
          >
            {JSON.stringify(debugInfoWithProbe, null, 2)}
          </div>
        ) : null}

        <div
          style={{
            background: "#fff",
            border: "1px solid #e5e7eb",
            borderRadius: 14,
            boxShadow: "0 10px 24px rgba(15,23,42,0.06)",
            padding: 14,
          }}
        >
          <div style={{ fontSize: 13, color: "#991b1b", fontWeight: 700 }}>
            {initialError}
          </div>
        </div>
      </div>
    );
  }

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
        sessionStorage.removeItem(CONTAINER_DRAFT_SESSION_KEY);
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
      // Use new SupplierDashboard for supplier users
      setCurrentView("supplierDashboard");
      return;
    }

    setSupplierId(null);
    setCurrentView("dashboard");
  };

  const returnToContainerDetails = () => {
    let nextView: ViewType = getDefaultDashboardView(currentUserState);
    if (typeof window !== "undefined") {
      try {
        const raw = sessionStorage.getItem(CONTAINER_DRAFT_SESSION_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          const sourceView = String(parsed?.sourceView || "").trim();
          if (sourceView === "dashboard" || sourceView === "supplierDashboard") {
            nextView = sourceView;
          }
        }
      } catch {
        // ignore storage errors
      }
    }
    setCurrentView(nextView);
  };

  return (
    <div style={{ minHeight: "100vh" }}>
      {currentView === "login" && (
        <Login
          onLogin={handleLogin}
          users={usersState}
          initialError={initialError ?? null}
          isProxy={isProxy}
        />
      )}

      {currentView === "supplier" && supplierId && (
        <SupplierView
          supplierId={supplierId}
          shipments={shipmentsState}
          onLogout={logout}
          showLogout={showLogout}
          debugInfo={debugInfoWithProbe}
          canShowDebug={canShowDebug}
          showDebug={showDebug}
          onToggleDebug={() => setShowDebug((prev) => !prev)}
          onRunApiProbe={() => void runApiProbe()}
          isApiProbeRunning={apiProbeRunning}
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
          showLogout={showLogout}
          debugInfo={debugInfoWithProbe}
          canShowDebug={canShowDebug}
          showDebug={showDebug}
          onToggleDebug={() => setShowDebug((prev) => !prev)}
          onRunApiProbe={() => void runApiProbe()}
          isApiProbeRunning={apiProbeRunning}
        />
      )}

      {currentView === "supplierDashboard" && (
        <SupplierDashboard
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
          onNavigateToPurchaseOrders={() => setCurrentView("purchaseOrders")}
          onLogout={logout}
          showLogout={showLogout}
          debugInfo={debugInfoWithProbe}
          canShowDebug={canShowDebug}
          showDebug={showDebug}
          onToggleDebug={() => setShowDebug((prev) => !prev)}
          onRunApiProbe={() => void runApiProbe()}
          isApiProbeRunning={apiProbeRunning}
        />
      )}

      {currentView === "users" && (
        <UserManagement
          users={usersState}
          onUsersChange={(next) => setUsersState(next)}
          companies={companiesSafe}
          onBack={() => setCurrentView("dashboard")}
          onLogout={logout}
          showLogout={showLogout}
          currentUser={currentUserState}
          debugInfo={debugInfoWithProbe}
          canShowDebug={canShowDebug}
          showDebug={showDebug}
          onToggleDebug={() => setShowDebug((prev) => !prev)}
          onRunApiProbe={() => void runApiProbe()}
          isApiProbeRunning={apiProbeRunning}
        />
      )}

      {currentView === "purchaseOrders" && (
        <PurchaseOrderManagement
          purchaseOrders={purchaseOrdersState}
          onPurchaseOrdersChange={(next) => setPurchaseOrdersState(next)}
          companies={companiesSafe}
          deliveryAddresses={deliveryAddressesSafe}
          rslModels={rslModelsSafe}
          currentUser={currentUserState}
          viewOnly={getDefaultDashboardView(currentUserState) === "supplierDashboard"}
          onBack={() => setCurrentView(getDefaultDashboardView(currentUserState))}
          onReturnToContainerDetails={returnToContainerDetails}
          onLogout={logout}
          showLogout={showLogout}
          debugInfo={debugInfoWithProbe}
          canShowDebug={canShowDebug}
          showDebug={showDebug}
          onToggleDebug={() => setShowDebug((prev) => !prev)}
          onRunApiProbe={() => void runApiProbe()}
          isApiProbeRunning={apiProbeRunning}
        />
      )}
    </div>
  );
}
