// app/logistics-ui/components/PurchaseOrderManagement.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";

import PurchaseOrderDetailsModal, {
  CompanyOption,
  PdfShipToCandidate,
  PdfSupplierCandidate,
  RslModelOption,
  UIPurchaseOrder,
} from "./PurchaseOrderDetailsModal";

import { withShopParam } from "../utils/shop";

type SortKey = "purchaseOrder" | "company" | "created" | "updated";

// Current user type
type CurrentUser = {
  id?: string | number;
  name?: string | null;
  displayName?: string | null;
  email?: string;
  companyName?: string | null;
  supplierId?: string | null;
  role?: string | null;
  userType?: string | null;
};

type AnalyzedPoProduct = {
  title?: string | null;
  sku?: string | null;
  quantity?: number | null;
  rslProductID?: string | null;
  rslProductName?: string | null;
  matchReasonCode?: string | null;
  matchReason?: string | null;
};

type UnmatchedPoDiagnostic = {
  lineNumber?: number | null;
  title?: string | null;
  sku?: string | null;
  reasonCode?: string | null;
  reason?: string | null;
};

type AnalyzePdfResult = {
  selectedProductIDs: string[];
  products: AnalyzedPoProduct[];
  extractedCount: number;
  matchedCount: number;
  supplier: PdfSupplierCandidate | null;
  shipTo: PdfShipToCandidate | null;
  matchedCompany: CompanyOption | null;
  matchedDeliveryAddress: CompanyOption | null;
  purchaseOrderNumberCandidate: string | null;
  originalPoDateCandidate: string | null;
  purchaseOrderGIDCandidate: string | null;
  unmatchedDiagnostics?: UnmatchedPoDiagnostic[];
  unmatchedSummary?: Record<string, number>;
};

interface PurchaseOrderManagementProps {
  purchaseOrders: UIPurchaseOrder[];
  onPurchaseOrdersChange: (nextPurchaseOrders: UIPurchaseOrder[]) => void;

  companies: CompanyOption[];
  deliveryAddresses?: CompanyOption[];
  rslModels: RslModelOption[];
  currentUser?: CurrentUser | null;

  // Supplier-limited mode in PO modal (Pro Forma upload + note only).
  viewOnly?: boolean;

  onBack: () => void;
  onReturnToContainerDetails?: () => void;
  onLogout: () => void;
  showLogout?: boolean;
  debugInfo?: any;
  canShowDebug?: boolean;
  showDebug?: boolean;
  onToggleDebug?: () => void;
  onRunApiProbe?: () => void | Promise<void>;
  isApiProbeRunning?: boolean;
}

function safeStr(v: unknown) {
  return String(v ?? "").trim();
}

function upsertCompanyOption(list: CompanyOption[], next: CompanyOption): CompanyOption[] {
  const nextId = safeStr(next?.shortName);
  if (!nextId) return Array.isArray(list) ? list : [];

  const merged = Array.isArray(list) ? list.slice() : [];
  const idx = merged.findIndex((c) => safeStr(c.shortName) === nextId);
  if (idx >= 0) merged[idx] = { ...merged[idx], ...next, shortName: nextId };
  else merged.push({ ...next, shortName: nextId });
  return merged;
}

function parseCompanyLongName(companyName?: string | null) {
  const s = safeStr(companyName);
  if (!s) return "-";
  const idx = s.indexOf(" (");
  return idx > 0 ? s.slice(0, idx).trim() : s;
}

function fmtDate(isoOrDate?: string | Date | null) {
  if (!isoOrDate) return "-";
  const d = isoOrDate instanceof Date ? isoOrDate : new Date(String(isoOrDate));
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleString();
}

function isEffectivelySameMoment(aIso?: string | Date | null, bIso?: string | Date | null) {
  if (!aIso || !bIso) return true;
  const a = aIso instanceof Date ? aIso.getTime() : new Date(String(aIso)).getTime();
  const b = bIso instanceof Date ? bIso.getTime() : new Date(String(bIso)).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return true;
  return Math.abs(a - b) < 60_000; // < 60s = treat as same
}

function timeSinceNatural(isoOrDate?: string | Date | null) {
  if (!isoOrDate) return "-";
  const d = isoOrDate instanceof Date ? isoOrDate : new Date(String(isoOrDate));
  if (Number.isNaN(d.getTime())) return "-";

  let ms = Date.now() - d.getTime();
  if (!Number.isFinite(ms)) return "-";
  if (ms < 0) ms = 0;

  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  const month = 30.4375 * day;
  const year = 365.25 * day;

  const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? "" : "s"}`;

  if (ms < hour) return plural(Math.max(1, Math.round(ms / minute)), "minute");
  if (ms < day) return plural(Math.max(1, Math.round(ms / hour)), "hour");
  if (ms < month) return plural(Math.max(1, Math.round(ms / day)), "day");
  if (ms < year) return plural(Math.max(1, Math.round(ms / month)), "month");
  return plural(Math.max(1, Math.round(ms / year)), "year");
}

// -----------------------------------------------------------------------------
// Styles
// -----------------------------------------------------------------------------

const wrapStyle: React.CSSProperties = { padding: 18 };

const btnStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  padding: "10px 12px",
  borderRadius: 10,
  border: "1px solid #e2e8f0",
  background: "#fff",
  color: "#0f172a",
  fontSize: 13,
  fontWeight: 800,
  cursor: "pointer",
};

const headerStyle: React.CSSProperties = {
  background: "#1e40af",
  color: "#fff",
  borderRadius: 14,
  padding: "14px 16px",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  boxShadow: "0 12px 30px rgba(15,23,42,0.15)",
  marginBottom: 14,
};

const headerTitleStyle: React.CSSProperties = {
  fontSize: 18,
  fontWeight: 800,
  letterSpacing: 0.2,
};

const headerSubStyle: React.CSSProperties = {
  fontSize: 12,
  opacity: 0.92,
  marginTop: 2,
};

const headerRightStyle: React.CSSProperties = {
  display: "flex",
  gap: 10,
  alignItems: "center",
};

const btnBase: React.CSSProperties = {
  borderRadius: 10,
  padding: "10px 12px",
  fontSize: 13,
  fontWeight: 700,
  border: "1px solid transparent",
  cursor: "pointer",
  lineHeight: 1,
};

const btnPrimary: React.CSSProperties = {
  ...btnBase,
  background: "#2563eb",
  color: "#fff",
};

const btnDanger: React.CSSProperties = {
  ...btnBase,
  background: "#dc2626",
  color: "#fff",
};

const btnSuccess: React.CSSProperties = {
  ...btnBase,
  background: "#16a34a",
  color: "#fff",
};

const btnWarning: React.CSSProperties = {
  ...btnBase,
  background: "#f59e0b",
  color: "#1f2937",
};

const btnDisabled: React.CSSProperties = {
  ...btnBase,
  background: "#cbd5e1",
  color: "#475569",
  cursor: "not-allowed",
};

const uploadOverlayStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(15, 23, 42, 0.45)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 1100,
  padding: 16,
};

const uploadModalStyle: React.CSSProperties = {
  width: "min(460px, 100%)",
  background: "#fff",
  borderRadius: 12,
  border: "1px solid #e2e8f0",
  boxShadow: "0 20px 45px rgba(15,23,42,0.24)",
  overflow: "hidden",
};

const uploadModalHeaderStyle: React.CSSProperties = {
  padding: "12px 14px",
  borderBottom: "1px solid #e2e8f0",
  fontSize: 15,
  fontWeight: 800,
  color: "#0f172a",
};

const uploadModalBodyStyle: React.CSSProperties = {
  padding: 14,
  display: "flex",
  flexDirection: "column",
  gap: 10,
};

const uploadModalFooterStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  padding: 14,
  borderTop: "1px solid #e2e8f0",
};

const searchWrapStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  border: "1px solid #e2e8f0",
  borderRadius: 10,
  overflow: "hidden",
  background: "#fff",
};

const iconBoxStyle: React.CSSProperties = {
  padding: "9px 10px",
  borderRight: "1px solid #e2e8f0",
  color: "#64748b",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};

const inputStyle: React.CSSProperties = {
  border: "none",
  outline: "none",
  padding: "9px 12px",
  fontSize: 13,
  width: 260,
};

const cardStyle: React.CSSProperties = {
  background: "#fff",
  border: "1px solid #e5e7eb",
  borderRadius: 14,
  boxShadow: "0 10px 24px rgba(15,23,42,0.06)",
  padding: 14,
  marginBottom: 14,
};

const controlsRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 12,
  flexWrap: "wrap",
};

const tableWrapStyle: React.CSSProperties = {
  border: "1px solid #e2e8f0",
  borderRadius: 12,
  overflow: "hidden",
  background: "#fff",
};

const tableStyle: React.CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
};

const thStyle: React.CSSProperties = {
  textAlign: "left",
  padding: "12px 12px",
  fontSize: 12,
  fontWeight: 800,
  color: "#475569",
  background: "#f1f5f9",
  borderBottom: "1px solid #e5e7eb",
  userSelect: "none",
  cursor: "pointer",
  whiteSpace: "nowrap",
};

const tdStyle: React.CSSProperties = {
  padding: "10px 12px",
  fontSize: 13,
  color: "#0f172a",
  borderBottom: "1px solid #e2e8f0",
  verticalAlign: "top",
};

const subtleStyle: React.CSSProperties = {
  fontSize: 12,
  color: "#64748b",
};

const errorStyle: React.CSSProperties = {
  padding: "10px 12px",
  borderRadius: 10,
  background: "#fef2f2",
  border: "1px solid #fecaca",
  color: "#991b1b",
  fontSize: 12,
  marginBottom: 12,
};

const successStyle: React.CSSProperties = {
  padding: "10px 12px",
  borderRadius: 10,
  background: "#ecfdf3",
  border: "1px solid #bbf7d0",
  color: "#166534",
  fontSize: 12,
  marginBottom: 12,
};

// -----------------------------------------------------------------------------
// Component
// -----------------------------------------------------------------------------

const PO_SESSION_KEY = "logistics_po_modal";
const CONTAINER_DRAFT_SESSION_KEY = "logistics_container_modal_draft";

export function PurchaseOrderManagement({
                                          purchaseOrders,
                                          onPurchaseOrdersChange,
                                          companies,
                                          deliveryAddresses = [],
                                          rslModels,
                                          currentUser,
                                          viewOnly = false,
                                          onBack,
                                          onReturnToContainerDetails,
                                          onLogout,
                                          showLogout = true,
                                          debugInfo = null,
                                          canShowDebug = false,
                                          showDebug = false,
                                          onToggleDebug,
                                          onRunApiProbe,
                                          isApiProbeRunning = false,
                                        }: PurchaseOrderManagementProps) {
  const hasContainerDraftInSession = () => {
    if (typeof window === "undefined") return false;
    try {
      const raw = sessionStorage.getItem(CONTAINER_DRAFT_SESSION_KEY);
      if (!raw) return false;
      const parsed = JSON.parse(raw);
      return Boolean(parsed?.shipment && typeof parsed.shipment === "object");
    } catch {
      return false;
    }
  };

  const markContainerDraftForReturn = () => {
    if (typeof window === "undefined") return false;
    try {
      const raw = sessionStorage.getItem(CONTAINER_DRAFT_SESSION_KEY);
      if (!raw) return false;
      const parsed = JSON.parse(raw);
      if (!parsed?.shipment || typeof parsed.shipment !== "object") return false;
      sessionStorage.setItem(
        CONTAINER_DRAFT_SESSION_KEY,
        JSON.stringify({
          ...parsed,
          returnRequested: true,
          returnedAt: new Date().toISOString(),
        })
      );
      return true;
    } catch {
      return false;
    }
  };

  const clearContainerDraftSession = () => {
    if (typeof window === "undefined") return;
    try {
      sessionStorage.removeItem(CONTAINER_DRAFT_SESSION_KEY);
    } catch {
      // ignore storage errors
    }
  };

  // Helper to get initial modal state from sessionStorage
  const getInitialModalState = () => {
    if (typeof window === "undefined") return null;
    try {
      const stored = sessionStorage.getItem(PO_SESSION_KEY);
      if (stored) {
        return JSON.parse(stored);
      }
    } catch {
      // ignore parse errors
    }
    return null;
  };

  const savedModal = getInitialModalState();

  const [q, setQ] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("updated");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  // Restore modal state from session if available
  const [selectedPO, setSelectedPO] = useState<UIPurchaseOrder | null>(() => {
    if (savedModal?.selectedPOGID && Array.isArray(purchaseOrders)) {
      const found = purchaseOrders.find(
        (po) => safeStr(po.purchaseOrderGID) === savedModal.selectedPOGID
      );
      if (found) return found;
    }
    return null;
  });

  const [mode, setMode] = useState<"create" | "view">(() => {
    return savedModal?.mode || "view";
  });

  const [isSaving, setIsSaving] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshMessage, setRefreshMessage] = useState<string | null>(null);
  const [showCreateUploadModal, setShowCreateUploadModal] = useState(false);
  const [createUploadFile, setCreateUploadFile] = useState<File | null>(null);
  const [createUploadError, setCreateUploadError] = useState<string | null>(null);
  const [createUploadValidationDebug, setCreateUploadValidationDebug] = useState<any | null>(null);
  const [lastPdfAnalysisDebug, setLastPdfAnalysisDebug] = useState<any | null>(null);
  const [isProcessingUpload, setIsProcessingUpload] = useState(false);
  const [initialCreatePdfFile, setInitialCreatePdfFile] = useState<File | null>(null);
  const [createSupplierCandidate, setCreateSupplierCandidate] = useState<PdfSupplierCandidate | null>(null);
  const [createShipToCandidate, setCreateShipToCandidate] = useState<PdfShipToCandidate | null>(null);
  const [createMatchedCompany, setCreateMatchedCompany] = useState<CompanyOption | null>(null);
  const [createMatchedDeliveryAddress, setCreateMatchedDeliveryAddress] = useState<CompanyOption | null>(null);
  const [companyOptions, setCompanyOptions] = useState<CompanyOption[]>(() =>
    Array.isArray(companies) ? companies : []
  );
  const [deliveryAddressOptions, setDeliveryAddressOptions] = useState<CompanyOption[]>(() =>
    Array.isArray(deliveryAddresses) ? deliveryAddresses : []
  );
  const [showReturnToContainerControl, setShowReturnToContainerControl] = useState<boolean>(
    hasContainerDraftInSession
  );
  const createUploadInputRef = useRef<HTMLInputElement | null>(null);

  const didInitialFetch = useRef(false);

  // Persist modal state to sessionStorage
  useEffect(() => {
    if (typeof window === "undefined") return;

    const modalData = {
      selectedPOGID: selectedPO?.purchaseOrderGID || null,
      mode,
    };

    try {
      if (selectedPO) {
        sessionStorage.setItem(PO_SESSION_KEY, JSON.stringify(modalData));
      } else {
        sessionStorage.removeItem(PO_SESSION_KEY);
      }
    } catch {
      // ignore storage errors
    }
  }, [selectedPO, mode]);

  useEffect(() => {
    setCompanyOptions((prev) => {
      const incoming = Array.isArray(companies) ? companies : [];
      let merged = incoming.slice();
      for (const c of prev) merged = upsertCompanyOption(merged, c);
      return merged;
    });
  }, [companies]);

  useEffect(() => {
    setDeliveryAddressOptions((prev) => {
      const incoming = Array.isArray(deliveryAddresses) ? deliveryAddresses : [];
      let merged = incoming.slice();
      for (const d of prev) merged = upsertCompanyOption(merged, d);
      return merged;
    });
  }, [deliveryAddresses]);

  useEffect(() => {
    setShowReturnToContainerControl(hasContainerDraftInSession());
  }, []);

  const companyMap = useMemo(() => {
    const m = new Map<string, CompanyOption>();
    for (const c of companyOptions || []) m.set(String(c.shortName), c);
    return m;
  }, [companyOptions]);

  // Initial refresh from server so Company/Created/Updated are filled even if portal loader is minimal
  useEffect(() => {
    if (didInitialFetch.current) return;
    didInitialFetch.current = true;

    (async () => {
      try {
        const url = withShopParam("/apps/logistics/purchase-orders?intent=list");
        const res = await fetch(url, { method: "GET" });
        const data: any = await res.json().catch(() => null);
        if (!res.ok || !data?.ok) return;
        const next = Array.isArray(data.purchaseOrders) ? data.purchaseOrders : [];
        onPurchaseOrdersChange(next);

        // If we had a saved modal state, try to restore it with fresh data
        const savedModalState = getInitialModalState();
        if (savedModalState?.selectedPOGID) {
          const found = next.find(
            (po: UIPurchaseOrder) => safeStr(po.purchaseOrderGID) === savedModalState.selectedPOGID
          );
          if (found) {
            setSelectedPO(found);
            setMode(savedModalState.mode || "view");
          }
        }
      } catch {
        // silent: page still usable with existing list
      }
    })();
  }, [onPurchaseOrdersChange]);

  // Get supplier company ID for filtering when in viewOnly mode
  const supplierCompanyId = safeStr(currentUser?.companyName || currentUser?.supplierId);

  const normalized = useMemo(() => {
    let list = Array.isArray(purchaseOrders) ? purchaseOrders.slice() : [];

    // Filter by supplier company when in viewOnly mode (supplier users)
    if (viewOnly && supplierCompanyId) {
      list = list.filter((po) => safeStr(po.companyID) === supplierCompanyId);
    }

    return list.map((po, idx) => {
      const idRaw = safeStr((po as any)?.id);
      const gid = safeStr((po as any)?.purchaseOrderGID);
      const shortName = safeStr((po as any)?.shortName);
      const id =
        idRaw && idRaw.toLowerCase() !== "new"
          ? idRaw
          : gid
            ? `po_${gid}`
            : shortName
              ? `po_${shortName}`
              : `po_${idx}_${Date.now()}`;

      return { ...po, id };
    });
  }, [purchaseOrders, viewOnly, supplierCompanyId]);

  const filteredSorted = useMemo(() => {
    const needle = safeStr(q).toLowerCase();

    const companyText = (po: UIPurchaseOrder) => {
      const cid = safeStr(po.companyID);
      const c = cid ? companyMap.get(cid) : null;
      if (c) return safeStr(c.displayName || c.shortName);
      if (po.companyName) return parseCompanyLongName(po.companyName);
      return cid || "-";
    };

    const rows = normalized.filter((po) => {
      if (!needle) return true;
      const shortName = safeStr(po.shortName).toLowerCase();
      const gid = safeStr(po.purchaseOrderGID).toLowerCase();
      const company = companyText(po).toLowerCase();
      if (shortName.includes(needle) || gid.includes(needle) || company.includes(needle)) {
        return true;
      }

      const products = Array.isArray(po.products) ? po.products : [];
      return products.some((p) => {
        const sku = safeStr(p?.SKU).toLowerCase();
        const display = safeStr(p?.displayName).toLowerCase();
        const short = safeStr(p?.shortName).toLowerCase();
        return (
          (sku && sku.includes(needle)) ||
          (display && display.includes(needle)) ||
          (short && short.includes(needle))
        );
      });
    });

    const getCreated = (po: UIPurchaseOrder) => {
      const d = new Date(safeStr(po.createdAt));
      return Number.isNaN(d.getTime()) ? 0 : d.getTime();
    };

    const getUpdated = (po: UIPurchaseOrder) => {
      const d = new Date(safeStr(po.updatedAt));
      return Number.isNaN(d.getTime()) ? 0 : d.getTime();
    };

    rows.sort((a, b) => {
      let cmp = 0;

      if (sortKey === "purchaseOrder") {
        cmp = safeStr(a.shortName).localeCompare(safeStr(b.shortName));
      } else if (sortKey === "company") {
        cmp = companyText(a).localeCompare(companyText(b));
      } else if (sortKey === "created") {
        cmp = getCreated(a) - getCreated(b);
      } else if (sortKey === "updated") {
        cmp = getUpdated(a) - getUpdated(b);
      }

      return sortDir === "asc" ? cmp : -cmp;
    });

    return rows;
  }, [normalized, q, sortKey, sortDir, companyMap]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "purchaseOrder" || key === "company" ? "asc" : "desc");
    }
  };

  const openCreateDetails = (
    selectedProductIDs: string[] = [],
    pdfFile: File | null = null,
    analyzedProducts: AnalyzedPoProduct[] = [],
    analysis: Partial<AnalyzePdfResult> = {},
  ) => {
    const matchedCompanyId = safeStr(analysis?.matchedCompany?.shortName);
    const matchedCompanyDisplay =
      safeStr(analysis?.matchedCompany?.displayName) || matchedCompanyId || null;
    const matchedDeliveryAddressId = safeStr(analysis?.matchedDeliveryAddress?.shortName);
    const matchedDeliveryAddressDisplay =
      safeStr(analysis?.matchedDeliveryAddress?.displayName) || matchedDeliveryAddressId || null;
    const purchaseOrderNumberCandidate = safeStr(analysis?.purchaseOrderNumberCandidate);
    const originalPoDateCandidate = safeStr(analysis?.originalPoDateCandidate);
    const purchaseOrderGIDCandidate = safeStr(analysis?.purchaseOrderGIDCandidate);

    const supplierCandidate = analysis?.supplier || null;
    const shipToCandidate = analysis?.shipTo || null;
    setCreateSupplierCandidate(supplierCandidate);
    setCreateShipToCandidate(shipToCandidate);
    setCreateMatchedCompany(
      matchedCompanyId
        ? { shortName: matchedCompanyId, displayName: matchedCompanyDisplay || matchedCompanyId }
        : null
    );
    setCreateMatchedDeliveryAddress(
      matchedDeliveryAddressId
        ? {
          shortName: matchedDeliveryAddressId,
          displayName: matchedDeliveryAddressDisplay || matchedDeliveryAddressId,
        }
        : null
    );

    if (matchedCompanyId) {
      setCompanyOptions((prev) =>
        upsertCompanyOption(prev, {
          shortName: matchedCompanyId,
          displayName: matchedCompanyDisplay || matchedCompanyId,
        })
      );
    }

    if (matchedDeliveryAddressId) {
      setDeliveryAddressOptions((prev) =>
        upsertCompanyOption(prev, {
          shortName: matchedDeliveryAddressId,
          displayName: matchedDeliveryAddressDisplay || matchedDeliveryAddressId,
        })
      );
    }

    const analyzedRows = Array.isArray(analyzedProducts)
      ? analyzedProducts.map((item, idx) => {
        const matchedId = safeStr(item?.rslProductID);
        const primaryTitle = safeStr(item?.title);
        return {
          rslModelID: matchedId,
          rslProductID: matchedId || undefined,
          // Keep unmatched rows visible in the table, but never treat them as selected product IDs.
          shortName: matchedId || "",
          displayName: primaryTitle || safeStr(item?.rslProductName) || `Line ${idx + 1}`,
          title: primaryTitle || safeStr(item?.rslProductName) || `Line ${idx + 1}`,
          SKU: safeStr(item?.sku) || null,
          quantity: typeof item?.quantity === "number" ? item.quantity : 0,
        };
      })
      : [];

    const fallbackRows = selectedProductIDs.map((id) => ({
      rslModelID: id,
      rslProductID: id,
      shortName: id,
      displayName: id,
      title: id,
      SKU: null,
      quantity: 0,
    }));

    setMode("create");
    setInitialCreatePdfFile(pdfFile);
    setSelectedPO({
      id: "new",
      shortName: purchaseOrderNumberCandidate || "",
      purchaseOrderGID: purchaseOrderGIDCandidate || "",
      purchaseOrderPdfUrl: null,
      originalPoDate: originalPoDateCandidate || null,
      companyID: matchedCompanyId || "",
      companyName: matchedCompanyDisplay,
      deliveryAddressID: matchedDeliveryAddressId || "",
      deliveryAddressName: matchedDeliveryAddressDisplay,
      createdAt: null,
      updatedAt: null,
      products: analyzedRows.length ? analyzedRows : fallbackRows,
      notes: [],
    });
  };

  const clearCreateUploadSelection = () => {
    setCreateUploadFile(null);
    if (createUploadInputRef.current) createUploadInputRef.current.value = "";
  };

  const openCreate = () => {
    setError(null);
    setRefreshMessage(null);
    setCreateUploadError(null);
    setCreateUploadValidationDebug(null);
    setLastPdfAnalysisDebug(null);
    setCreateSupplierCandidate(null);
    setCreateShipToCandidate(null);
    setCreateMatchedCompany(null);
    setCreateMatchedDeliveryAddress(null);
    clearCreateUploadSelection();
    setShowCreateUploadModal(true);
  };

  const openView = (po: UIPurchaseOrder) => {
    setError(null);
    setRefreshMessage(null);
    setInitialCreatePdfFile(null);
    setCreateSupplierCandidate(null);
    setCreateShipToCandidate(null);
    setCreateMatchedCompany(null);
    setCreateMatchedDeliveryAddress(null);
    setMode("view");
    setSelectedPO(po);
  };

  const closeModal = () => {
    setSelectedPO(null);
    setInitialCreatePdfFile(null);
    setCreateSupplierCandidate(null);
    setCreateShipToCandidate(null);
    setCreateMatchedCompany(null);
    setCreateMatchedDeliveryAddress(null);
  };

  const handleBack = () => {
    clearContainerDraftSession();
    setShowReturnToContainerControl(false);
    onBack();
  };

  const handleReturnToContainer = () => {
    closeModal();
    const marked = markContainerDraftForReturn();
    if (marked) {
      onReturnToContainerDetails?.();
      return;
    }
    onBack();
  };

  const closeCreateUploadModal = () => {
    if (isProcessingUpload) return;
    setShowCreateUploadModal(false);
    clearCreateUploadSelection();
    setCreateUploadError(null);
    setCreateUploadValidationDebug(null);
  };

  const processCreateUpload = async () => {
    if (!createUploadFile || isProcessingUpload) return;

    setCreateUploadError(null);
    setIsProcessingUpload(true);

    try {
      const url = withShopParam("/apps/logistics/purchase-orders");
      const fd = new FormData();
      fd.append("intent", "analyze-pdf");
      fd.append("pdf", createUploadFile);

      const res = await fetch(url, { method: "POST", body: fd });
      const data: any = await res.json().catch(() => null);

      if (!res.ok || !data?.ok) {
        const errorCode = safeStr(data?.errorCode).toUpperCase();
        const errorMessage = data?.error || "PDF analysis failed.";
        if (errorCode === "INVALID_PO_FORMAT") {
          clearCreateUploadSelection();
          setCreateUploadError(errorMessage);
          setCreateUploadValidationDebug(data?.validation || null);
          return;
        }
        throw new Error(errorMessage);
      }

      const analysis: AnalyzePdfResult = {
        selectedProductIDs: Array.isArray(data?.analysis?.selectedProductIDs)
          ? data.analysis.selectedProductIDs.map((x: unknown) => safeStr(x)).filter(Boolean)
          : [],
        products: Array.isArray(data?.analysis?.products) ? data.analysis.products : [],
        extractedCount: Number(data?.analysis?.extractedCount || 0),
        matchedCount: Number(data?.analysis?.matchedCount || 0),
        supplier: data?.analysis?.supplier || null,
        shipTo: data?.analysis?.shipTo || null,
        matchedCompany: data?.analysis?.matchedCompany || null,
        matchedDeliveryAddress: data?.analysis?.matchedDeliveryAddress || null,
        purchaseOrderNumberCandidate: safeStr(data?.analysis?.purchaseOrderNumberCandidate) || null,
        originalPoDateCandidate: safeStr(data?.analysis?.originalPoDateCandidate) || null,
        purchaseOrderGIDCandidate: safeStr(data?.analysis?.purchaseOrderGIDCandidate) || null,
        unmatchedDiagnostics: Array.isArray(data?.analysis?.unmatchedDiagnostics)
          ? data.analysis.unmatchedDiagnostics
          : [],
        unmatchedSummary:
          data?.analysis?.unmatchedSummary && typeof data.analysis.unmatchedSummary === "object"
            ? data.analysis.unmatchedSummary
            : {},
      };

      const selectedProductIDs = analysis.selectedProductIDs;
      const analyzedProducts = analysis.products;
      const extractedCount = analysis.extractedCount;
      const matchedCount = analysis.matchedCount;
      const unmatchedCount = Array.isArray(analysis.unmatchedDiagnostics)
        ? analysis.unmatchedDiagnostics.length
        : Math.max(0, extractedCount - matchedCount);

      const matchedCompanyText = safeStr(analysis.matchedCompany?.displayName || analysis.matchedCompany?.shortName);
      const supplierNameText = safeStr(analysis.supplier?.name);
      const matchedDeliveryAddressText = safeStr(
        analysis.matchedDeliveryAddress?.displayName || analysis.matchedDeliveryAddress?.shortName
      );
      const shipToText = safeStr(analysis.shipTo?.displayName);
      const companyMessage = matchedCompanyText
        ? ` Supplier matched to company "${matchedCompanyText}".`
        : supplierNameText
          ? ` Supplier "${supplierNameText}" was not matched to an existing company.`
          : "";
      const shipToMessage = matchedDeliveryAddressText
        ? ` Ship To matched to "${matchedDeliveryAddressText}".`
        : shipToText
          ? " Ship To was not matched to an existing delivery address."
          : "";
      const unmatchedMessage = unmatchedCount
        ? ` ${unmatchedCount} line item(s) were not matched to known products.`
        : "";

      setRefreshMessage(
        showDebug
          ? `PDF processed. Extracted ${extractedCount} item(s); matched ${matchedCount} item(s) to known products.${unmatchedMessage}${companyMessage}${shipToMessage}`
          : "PDF processed."
      );
      setLastPdfAnalysisDebug({
        analyzedAt: new Date().toISOString(),
        extractedCount,
        matchedCount,
        unmatchedCount,
        unmatchedSummary: analysis.unmatchedSummary || {},
        unmatchedDiagnostics: analysis.unmatchedDiagnostics || [],
      });

      setShowCreateUploadModal(false);
      clearCreateUploadSelection();
      setCreateUploadError(null);
      setCreateUploadValidationDebug(null);
      openCreateDetails(selectedProductIDs, createUploadFile, analyzedProducts, analysis);
    } catch (e: any) {
      setCreateUploadError(e?.message || "PDF analysis failed.");
      setCreateUploadValidationDebug(null);
    } finally {
      setIsProcessingUpload(false);
    }
  };

  const handleCreateCompanyFromSupplier = async (supplier: PdfSupplierCandidate) => {
    const supplierName = safeStr(supplier?.name);
    if (!supplierName) throw new Error("Supplier name was not detected from the PDF.");

    const url = withShopParam("/apps/logistics/purchase-orders");
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        intent: "create-company-from-pdf-supplier",
        supplier,
      }),
    });
    const data: any = await res.json().catch(() => null);
    if (!res.ok || !data?.ok) {
      throw new Error(data?.error || "Unable to create supplier/company.");
    }

    const createdCompany: CompanyOption = {
      shortName: safeStr(data?.company?.shortName),
      displayName: safeStr(data?.company?.displayName || data?.company?.shortName),
    };
    if (!createdCompany.shortName) {
      throw new Error("Supplier/company creation succeeded but no company ID was returned.");
    }

    setCompanyOptions((prev) => upsertCompanyOption(prev, createdCompany));
    setCreateMatchedCompany(createdCompany);

    const supplierInsertReason = safeStr(data?.supplierInsert?.reason);
    if (
      supplierInsertReason &&
      supplierInsertReason !== "matched-existing-company" &&
      supplierInsertReason !== "already-exists"
    ) {
      console.warn("[purchase-orders] tlkp_supplier insert warning:", supplierInsertReason);
    }

    if (data?.created) {
      setRefreshMessage(`Supplier "${createdCompany.displayName || createdCompany.shortName}" was added as a new company.`);
    } else {
      setRefreshMessage(`Using existing company "${createdCompany.displayName || createdCompany.shortName}" for this supplier.`);
    }

    return createdCompany;
  };

  const handleUpdateCompanyFromSupplier = async (companyID: string, supplier: PdfSupplierCandidate) => {
    const nextCompanyID = safeStr(companyID);
    if (!nextCompanyID) throw new Error("Company ID is required.");
    const supplierName = safeStr(supplier?.name);
    if (!supplierName) throw new Error("Supplier name was not detected from the PDF.");

    const url = withShopParam("/apps/logistics/purchase-orders");
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        intent: "update-company-from-pdf-supplier",
        companyID: nextCompanyID,
        supplier,
      }),
    });
    const data: any = await res.json().catch(() => null);
    if (!res.ok || !data?.ok) {
      throw new Error(data?.error || "Unable to update company from supplier data.");
    }

    const updatedCompany: CompanyOption = {
      shortName: nextCompanyID,
      displayName: safeStr(data?.company?.displayName || data?.company?.shortName || nextCompanyID),
    };

    setCompanyOptions((prev) => upsertCompanyOption(prev, updatedCompany));
    setCreateMatchedCompany(updatedCompany);
    setRefreshMessage(`Company "${updatedCompany.displayName || updatedCompany.shortName}" was updated from the PO supplier.`);
    return updatedCompany;
  };

  const handleCreateDeliveryAddressFromShipTo = async (shipTo: PdfShipToCandidate) => {
    const displayName = safeStr(shipTo?.displayName);
    if (!displayName) throw new Error("Ship To address was not detected from the PDF.");

    const url = withShopParam("/apps/logistics/purchase-orders");
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        intent: "create-delivery-address-from-ship-to",
        shipTo,
      }),
    });
    const data: any = await res.json().catch(() => null);
    if (!res.ok || !data?.ok) {
      throw new Error(data?.error || "Unable to create delivery address.");
    }

    const createdDeliveryAddress: CompanyOption = {
      shortName: safeStr(data?.deliveryAddress?.shortName),
      displayName: safeStr(data?.deliveryAddress?.displayName || data?.deliveryAddress?.shortName),
    };
    if (!createdDeliveryAddress.shortName) {
      throw new Error("Delivery address creation succeeded but no ID was returned.");
    }

    setDeliveryAddressOptions((prev) => upsertCompanyOption(prev, createdDeliveryAddress));
    setCreateMatchedDeliveryAddress(createdDeliveryAddress);

    if (data?.created) {
      setRefreshMessage(
        `Delivery address "${createdDeliveryAddress.displayName || createdDeliveryAddress.shortName}" was added.`
      );
    } else {
      setRefreshMessage(
        `Using existing delivery address "${createdDeliveryAddress.displayName || createdDeliveryAddress.shortName}".`
      );
    }

    return createdDeliveryAddress;
  };

  const handleUpdateDeliveryAddressFromShipTo = async (deliveryAddressID: string, shipTo: PdfShipToCandidate) => {
    const nextDeliveryAddressID = safeStr(deliveryAddressID);
    if (!nextDeliveryAddressID) throw new Error("Delivery address ID is required.");
    const displayName = safeStr(shipTo?.displayName);
    if (!displayName) throw new Error("Ship To address was not detected from the PDF.");

    const url = withShopParam("/apps/logistics/purchase-orders");
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        intent: "update-delivery-address-from-ship-to",
        deliveryAddressID: nextDeliveryAddressID,
        shipTo,
      }),
    });
    const data: any = await res.json().catch(() => null);
    if (!res.ok || !data?.ok) {
      throw new Error(data?.error || "Unable to update delivery address from Ship To data.");
    }

    const updatedDeliveryAddress: CompanyOption = {
      shortName: nextDeliveryAddressID,
      displayName: safeStr(
        data?.deliveryAddress?.displayName || data?.deliveryAddress?.shortName || nextDeliveryAddressID
      ),
    };

    setDeliveryAddressOptions((prev) => upsertCompanyOption(prev, updatedDeliveryAddress));
    setCreateMatchedDeliveryAddress(updatedDeliveryAddress);
    setRefreshMessage(
      `Delivery address "${updatedDeliveryAddress.displayName || updatedDeliveryAddress.shortName}" was updated from the PO Ship To.`
    );
    return updatedDeliveryAddress;
  };

  const upsertLocal = (updated: UIPurchaseOrder) => {
    const gid = safeStr(updated.purchaseOrderGID);
    const list = Array.isArray(purchaseOrders) ? purchaseOrders.slice() : [];
    const idx = list.findIndex((x) => safeStr(x.purchaseOrderGID) === gid);

    if (idx >= 0) list[idx] = updated;
    else list.unshift(updated);

    onPurchaseOrdersChange(list);
  };

  const handleSave = async (
    saveMode: "create" | "update",
    payload: {
      purchaseOrder: UIPurchaseOrder;
      companyID: string;
      deliveryAddressID?: string | null;
      note?: string | null;
      pdfFile?: File | null;
      proFormaFile?: File | null;
    },
  ) => {
    setIsSaving(true);
    setError(null);
    setRefreshMessage(null);

    try {
      const url = withShopParam("/apps/logistics/purchase-orders");
      const fd = new FormData();
      const note = safeStr(payload.note);

      // Supplier users may only update Pro Forma Invoice + note for an existing PO.
      if (viewOnly && saveMode === "update") {
        const purchaseOrderGID = safeStr(payload.purchaseOrder?.purchaseOrderGID);
        if (!purchaseOrderGID) throw new Error("purchaseOrderGID is required for update.");
        const hasProFormaUpload = Boolean(payload.proFormaFile);
        if (!hasProFormaUpload) throw new Error("Pro Forma Invoice PDF is required.");
        if (!note) throw new Error("A note is required when uploading a new Pro Forma Invoice.");

        fd.append("intent", "supplier-update-proforma");
        fd.append("purchaseOrderGID", purchaseOrderGID);
        fd.append("note", note);
        fd.append("proFormaPdf", payload.proFormaFile as File);
      } else {
        fd.append("intent", saveMode);
        fd.append("purchaseOrder", JSON.stringify(payload.purchaseOrder));
        fd.append("companyID", payload.companyID);
        if (safeStr(payload.deliveryAddressID)) {
          fd.append("deliveryAddressID", safeStr(payload.deliveryAddressID));
        }
        if (note) fd.append("note", note);
        if (payload.pdfFile) fd.append("pdf", payload.pdfFile);
        if (payload.proFormaFile) fd.append("proFormaPdf", payload.proFormaFile);
      }

      const res = await fetch(url, { method: "POST", body: fd });
      const data: any = await res.json().catch(() => null);

      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || "Save failed.");
      }

      const updated = data.purchaseOrder as UIPurchaseOrder;
      upsertLocal(updated);

      // For create: close the modal; for update: stay in view mode
      if (saveMode === "create") {
        setSelectedPO(null);
        setInitialCreatePdfFile(null);
        setCreateSupplierCandidate(null);
        setCreateShipToCandidate(null);
        setCreateMatchedCompany(null);
        setCreateMatchedDeliveryAddress(null);
      } else {
        const shouldAutoReturnToContainer =
          Boolean(showReturnToContainerControl && onReturnToContainerDetails);
        if (shouldAutoReturnToContainer) {
          handleReturnToContainer();
          return;
        }
        setSelectedPO(updated);
        setMode("view");
      }
    } catch (e: any) {
      setError(e?.message || "Save failed.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleValidatePdfFile = async (file: File) => {
    const url = withShopParam("/apps/logistics/purchase-orders");
    const fd = new FormData();
    fd.append("intent", "analyze-pdf");
    fd.append("pdf", file);

    const res = await fetch(url, { method: "POST", body: fd });
    const data: any = await res.json().catch(() => null);

    if (!res.ok || !data?.ok) {
      return {
        ok: false,
        error: safeStr(data?.error) || "Uploaded PDF did not pass validation.",
        analysis: null,
      };
    }

    return {
      ok: true,
      error: null,
      analysis: data?.analysis || null,
    };
  };

  const handleRefreshProducts = async () => {
    setIsRefreshing(true);
    setError(null);
    setRefreshMessage(null);

    try {
      const url = withShopParam("/apps/logistics/purchase-orders");
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ intent: "refresh-products" }),
      });
      const data: any = await res.json().catch(() => null);

      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || "Refresh failed.");
      }

      const skipped = typeof data.skipped === "number" ? data.skipped : 0;
      const msg = `Products refreshed. Created ${data.created ?? 0}, updated ${data.updated ?? 0}, ` +
        `deleted ${data.deleted ?? 0}, skipped ${skipped}.` +
        (data.missingSkuCount ? ` Missing SKU: ${data.missingSkuCount}.` : "");
      setRefreshMessage(msg);
    } catch (e: any) {
      setError(e?.message || "Refresh failed.");
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleDelete = async (po: UIPurchaseOrder) => {
    // Confirm before deleting
    const confirmed = window.confirm(
      `Are you sure you want to delete purchase order "${safeStr(po.shortName)}"? This action cannot be undone.`
    );
    if (!confirmed) return;

    setIsSaving(true);
    setError(null);

    try {
      const url = withShopParam("/apps/logistics/purchase-orders");
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ intent: "delete", purchaseOrder: { purchaseOrderGID: po.purchaseOrderGID } }),
      });
      const data: any = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) throw new Error(data?.error || "Delete failed.");

      const gid = safeStr(po.purchaseOrderGID);
      const next = (purchaseOrders || []).filter((x) => safeStr(x.purchaseOrderGID) !== gid);
      onPurchaseOrdersChange(next);
      setSelectedPO(null);
    } catch (e: any) {
      setError(e?.message || "Delete failed.");
    } finally {
      setIsSaving(false);
    }
  };

  const companyTextForRow = (po: UIPurchaseOrder) => {
    const cid = safeStr(po.companyID);
    const c = cid ? companyMap.get(cid) : null;
    if (c) return safeStr(c.displayName || c.shortName);
    if (po.companyName) return parseCompanyLongName(po.companyName);
    return cid || "-";
  };

  const createdTextForRow = (po: UIPurchaseOrder) => fmtDate(po.createdAt);

  const updatedTextForRow = (po: UIPurchaseOrder) => {
    if (isEffectivelySameMoment(po.createdAt, po.updatedAt)) return "-";
    return timeSinceNatural(po.updatedAt);
  };

  return (
    <div style={wrapStyle}>
      {error ? <div style={errorStyle}>{error}</div> : null}
      {refreshMessage ? <div style={successStyle}>{refreshMessage}</div> : null}

      <div style={headerStyle}>
        <div>
          <div style={headerTitleStyle}>RSL Logistics Purchase Orders</div>
          <div style={headerSubStyle}>
            Logged in as <b>{String((currentUser as any)?.name || currentUser?.email || "User")}</b>
          </div>
        </div>

        <div style={headerRightStyle}>
          {canShowDebug ? (
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
                <input
                  type="checkbox"
                  checked={showDebug}
                  onChange={() => onToggleDebug?.()}
                />
                Show Debug
              </label>
              <button
                type="button"
                onClick={() => void onRunApiProbe?.()}
                disabled={isApiProbeRunning}
                style={isApiProbeRunning ? btnDisabled : btnWarning}
              >
                {isApiProbeRunning ? "Running Probe..." : "Run API Probe"}
              </button>
            </div>
          ) : null}

          {!viewOnly && (
            <button
              type="button"
              onClick={handleRefreshProducts}
              disabled={isSaving || isRefreshing}
              style={(isSaving || isRefreshing) ? btnDisabled : btnWarning}
              title="Refresh products from Shopify"
            >
              {isRefreshing ? "Refreshing…" : "Refresh Products"}
            </button>
          )}

          <button type="button" onClick={handleBack} disabled={isSaving} style={btnPrimary}>
            Back
          </button>

          {showLogout ? (
            <button type="button" onClick={onLogout} disabled={isSaving} style={btnDanger}>
              Log Out
            </button>
          ) : null}
        </div>
      </div>

      {debugInfo && showDebug ? (
        <div
          style={{
            marginBottom: 14,
            background: "#fef3c7",
            border: "1px solid #fcd34d",
            borderRadius: 12,
            padding: 12,
            color: "#7c2d12",
            fontSize: 12,
            whiteSpace: "pre-wrap",
          }}
        >
          {JSON.stringify(debugInfo, null, 2)}
        </div>
      ) : null}

      {showDebug && lastPdfAnalysisDebug ? (
        <div
          style={{
            marginBottom: 14,
            background: "#eef2ff",
            border: "1px solid #c7d2fe",
            borderRadius: 12,
            padding: 12,
            color: "#1e1b4b",
            fontSize: 12,
            whiteSpace: "pre-wrap",
          }}
        >
          <div style={{ fontWeight: 800, marginBottom: 6 }}>PO Match Debug</div>
          {JSON.stringify(lastPdfAnalysisDebug, null, 2)}
        </div>
      ) : null}

      <div style={cardStyle}>
        <div style={controlsRowStyle}>
          <div style={searchWrapStyle}>
            <span style={iconBoxStyle}>
              <Search size={16} />
            </span>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search PO / GID / company / SKU / product…"
              style={inputStyle}
              disabled={isSaving}
            />
          </div>

          <div style={{ flex: 1 }} />

          {!viewOnly && (
            <button
              type="button"
              style={(isSaving || isRefreshing) ? btnDisabled : btnSuccess}
              onClick={openCreate}
              disabled={isSaving || isRefreshing}
            >
              Create Purchase Order
            </button>
          )}
        </div>

        <div style={{ marginTop: 14 }}>
          <div style={tableWrapStyle}>
            <table style={tableStyle}>
              <thead>
              <tr>
                <th style={thStyle} onClick={() => toggleSort("purchaseOrder")}>Purchase Order</th>
                <th style={thStyle} onClick={() => toggleSort("company")}>Company</th>
                <th style={thStyle} onClick={() => toggleSort("created")}>Created</th>
                <th style={thStyle} onClick={() => toggleSort("updated")}>Updated</th>
              </tr>
              </thead>

              <tbody>
              {filteredSorted.length === 0 ? (
                <tr>
                  <td style={tdStyle} colSpan={4}>
                    <div style={subtleStyle}>No purchase orders found.</div>
                  </td>
                </tr>
              ) : (
                filteredSorted.map((po) => (
                  <tr
                    key={safeStr(po.id) || safeStr(po.purchaseOrderGID) || safeStr(po.shortName)}
                    onClick={() => openView(po)}
                    style={{ cursor: "pointer" }}
                  >
                    <td style={tdStyle}>
                      <span style={{ fontWeight: 700, color: "#0f172a" }}>
                        #{safeStr(po.shortName) || "-"}
                      </span>
                    </td>
                    <td style={tdStyle}>{companyTextForRow(po)}</td>
                    <td style={tdStyle}>{createdTextForRow(po)}</td>
                    <td style={tdStyle}>{updatedTextForRow(po)}</td>
                  </tr>
                ))
              )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {showCreateUploadModal ? (
        <div style={uploadOverlayStyle} onMouseDown={closeCreateUploadModal}>
          <div style={uploadModalStyle} onMouseDown={(e) => e.stopPropagation()}>
            <div style={uploadModalHeaderStyle}>Upload Purchase Order PDF</div>

            <div style={uploadModalBodyStyle}>
              {createUploadError ? <div style={errorStyle}>{createUploadError}</div> : null}

              <input
                ref={createUploadInputRef}
                type="file"
                accept="application/pdf"
                disabled={isProcessingUpload}
                onChange={(e) => {
                  const f = e.target.files && e.target.files[0] ? e.target.files[0] : null;
                  setCreateUploadFile(f);
                  setCreateUploadError(null);
                  setCreateUploadValidationDebug(null);
                }}
              />

              {createUploadFile ? (
                <div style={subtleStyle}>
                  Selected: <b>{createUploadFile.name}</b>
                </div>
              ) : (
                <div style={subtleStyle}>Select the Purchase Order PDF file you downloaded from Shopify.</div>
              )}

              {showDebug && createUploadValidationDebug ? (
                <div
                  style={{
                    background: "#f8fafc",
                    border: "1px solid #cbd5e1",
                    borderRadius: 10,
                    padding: 10,
                    fontSize: 12,
                    color: "#0f172a",
                    whiteSpace: "pre-wrap",
                  }}
                >
                  <div style={{ fontWeight: 800, marginBottom: 6 }}>PO Format Validation Debug</div>
                  {JSON.stringify(createUploadValidationDebug, null, 2)}
                </div>
              ) : null}
            </div>

            <div style={uploadModalFooterStyle}>
              <button
                type="button"
                style={btnStyle}
                onClick={closeCreateUploadModal}
                disabled={isProcessingUpload}
              >
                Cancel
              </button>

              <button
                type="button"
                style={createUploadFile && !isProcessingUpload ? btnPrimary : btnDisabled}
                onClick={() => void processCreateUpload()}
                disabled={!createUploadFile || isProcessingUpload}
              >
                {isProcessingUpload ? "Analyzing..." : "Process"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {selectedPO ? (
        <PurchaseOrderDetailsModal
          mode={mode}
          purchaseOrder={selectedPO}
          companies={companyOptions}
          deliveryAddresses={deliveryAddressOptions}
          rslModels={rslModels}
          currentUser={currentUser}
          viewOnly={viewOnly}
          showDebugInfo={showDebug}
          isSaving={isSaving}
          error={error}
          initialPdfFile={mode === "create" ? initialCreatePdfFile : null}
          createSupplierCandidate={mode === "create" ? createSupplierCandidate : null}
          matchedCompany={mode === "create" ? createMatchedCompany : null}
          createShipToCandidate={mode === "create" ? createShipToCandidate : null}
          matchedDeliveryAddress={mode === "create" ? createMatchedDeliveryAddress : null}
          showReturnToContainer={Boolean(showReturnToContainerControl && onReturnToContainerDetails)}
          onReturnToContainer={showReturnToContainerControl ? handleReturnToContainer : undefined}
          onClose={closeModal}
          onSave={handleSave}
          onDelete={mode === "view" && !viewOnly ? handleDelete : undefined}
          onCreateCompanyFromSupplier={mode === "create" ? handleCreateCompanyFromSupplier : undefined}
          onUpdateCompanyFromSupplier={mode === "create" ? handleUpdateCompanyFromSupplier : undefined}
          onCreateDeliveryAddressFromShipTo={
            mode === "create" ? handleCreateDeliveryAddressFromShipTo : undefined
          }
          onUpdateDeliveryAddressFromShipTo={
            mode === "create" ? handleUpdateDeliveryAddressFromShipTo : undefined
          }
          onValidatePdfFile={!viewOnly ? handleValidatePdfFile : undefined}
        />
      ) : null}
    </div>
  );
}

export default PurchaseOrderManagement;
