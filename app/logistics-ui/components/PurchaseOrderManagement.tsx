// app/logistics-ui/components/PurchaseOrderManagement.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Eye, LogOut, Plus, Search } from "lucide-react";

import PurchaseOrderDetailsModal, {
  CompanyOption,
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
};

interface PurchaseOrderManagementProps {
  purchaseOrders: UIPurchaseOrder[];
  onPurchaseOrdersChange: (nextPurchaseOrders: UIPurchaseOrder[]) => void;

  companies: CompanyOption[];
  currentUser?: CurrentUser | null;

  onBack: () => void;
  onLogout: () => void;
}

function safeStr(v: unknown) {
  return String(v ?? "").trim();
}

function adminPurchaseOrderUrl(gid: string) {
  const clean = safeStr(gid);
  return `https://admin.shopify.com/store/rogersoundlabs/purchase_orders/${encodeURIComponent(clean)}`;
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

const headerRowStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 12,
  flexWrap: "wrap",
  marginBottom: 14,
};

const titleStyle: React.CSSProperties = {
  fontSize: 16,
  fontWeight: 900,
  color: "#0f172a",
  display: "flex",
  alignItems: "center",
  gap: 10,
};

const toolbarStyle: React.CSSProperties = {
  display: "flex",
  gap: 10,
  alignItems: "center",
  flexWrap: "wrap",
};

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

const primaryBtnStyle: React.CSSProperties = {
  ...btnStyle,
  border: "none",
  background: "#2563eb",
  color: "#fff",
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
  padding: "10px 12px",
  fontSize: 12,
  fontWeight: 900,
  color: "#0f172a",
  background: "#f8fafc",
  borderBottom: "1px solid #e2e8f0",
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

const linkBtnStyle: React.CSSProperties = {
  padding: "8px 10px",
  borderRadius: 10,
  border: "1px solid #e2e8f0",
  background: "#ffffff",
  color: "#0f172a",
  fontSize: 12,
  fontWeight: 900,
  cursor: "pointer",
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
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

// -----------------------------------------------------------------------------
// Component
// -----------------------------------------------------------------------------

const PO_SESSION_KEY = "logistics_po_modal";

export function PurchaseOrderManagement({
                                          purchaseOrders,
                                          onPurchaseOrdersChange,
                                          companies,
                                          currentUser,
                                          onBack,
                                          onLogout,
                                        }: PurchaseOrderManagementProps) {
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
  const [error, setError] = useState<string | null>(null);

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

  const companyMap = useMemo(() => {
    const m = new Map<string, CompanyOption>();
    for (const c of companies || []) m.set(String(c.shortName), c);
    return m;
  }, [companies]);

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

  const normalized = useMemo(() => {
    const list = Array.isArray(purchaseOrders) ? purchaseOrders.slice() : [];
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
  }, [purchaseOrders]);

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
      return shortName.includes(needle) || gid.includes(needle) || company.includes(needle);
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

  const openCreate = () => {
    setError(null);
    setMode("create");
    setSelectedPO({
      id: "new",
      shortName: "",
      purchaseOrderGID: "",
      purchaseOrderPdfUrl: null,
      companyID: "",
      companyName: null,
      createdAt: null,
      updatedAt: null,
      notes: [],
    });
  };

  const openView = (po: UIPurchaseOrder) => {
    setError(null);
    setMode("view");
    setSelectedPO(po);
  };

  const closeModal = () => setSelectedPO(null);

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
    payload: { purchaseOrder: UIPurchaseOrder; companyID: string; note?: string | null; pdfFile?: File | null },
  ) => {
    setIsSaving(true);
    setError(null);

    try {
      const url = withShopParam("/apps/logistics/purchase-orders");
      const fd = new FormData();

      fd.append("intent", saveMode);
      fd.append("purchaseOrder", JSON.stringify(payload.purchaseOrder));
      fd.append("companyID", payload.companyID);

      const note = safeStr(payload.note);
      if (note) fd.append("note", note);

      if (payload.pdfFile) fd.append("pdf", payload.pdfFile);

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
      } else {
        setSelectedPO(updated);
        setMode("view");
      }
    } catch (e: any) {
      setError(e?.message || "Save failed.");
    } finally {
      setIsSaving(false);
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

      <div style={headerRowStyle}>
        <div style={titleStyle}>
          <button type="button" style={btnStyle} onClick={onBack} disabled={isSaving}>
            <ArrowLeft size={16} />
            Back
          </button>
          Purchase Orders
        </div>

        <div style={toolbarStyle}>
          <div style={searchWrapStyle}>
            <span style={iconBoxStyle}>
              <Search size={16} />
            </span>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search PO / GID / company…"
              style={inputStyle}
              disabled={isSaving}
            />
          </div>

          <button type="button" style={primaryBtnStyle} onClick={openCreate} disabled={isSaving}>
            <Plus size={16} />
            Create Purchase Order
          </button>

          <button type="button" style={btnStyle} onClick={onLogout} disabled={isSaving}>
            <LogOut size={16} />
            Logout
          </button>
        </div>
      </div>

      <div style={tableWrapStyle}>
        <table style={tableStyle}>
          <thead>
          <tr>
            <th style={thStyle} onClick={() => toggleSort("purchaseOrder")}>Purchase Order</th>
            <th style={thStyle} onClick={() => toggleSort("company")}>Company</th>
            <th style={thStyle} onClick={() => toggleSort("created")}>Created</th>
            <th style={thStyle} onClick={() => toggleSort("updated")}>Updated</th>
            <th style={{ ...thStyle, cursor: "default" }}>Action</th>
          </tr>
          </thead>

          <tbody>
          {filteredSorted.length === 0 ? (
            <tr>
              <td style={tdStyle} colSpan={5}>
                <div style={subtleStyle}>No purchase orders found.</div>
              </td>
            </tr>
          ) : (
            filteredSorted.map((po) => (
              <tr key={safeStr(po.id) || safeStr(po.purchaseOrderGID) || safeStr(po.shortName)}>
                <td style={tdStyle}>
                  <a
                    href={adminPurchaseOrderUrl(po.purchaseOrderGID)}
                    target="_blank"
                    rel="noreferrer"
                    style={{ color: "#2563eb", fontWeight: 700, textDecoration: "none" }}
                  >
                    #{safeStr(po.shortName) || "-"}
                  </a>
                </td>
                <td style={tdStyle}>{companyTextForRow(po)}</td>
                <td style={tdStyle}>{createdTextForRow(po)}</td>
                <td style={tdStyle}>{updatedTextForRow(po)}</td>
                <td style={tdStyle}>
                  <button type="button" style={linkBtnStyle} onClick={() => openView(po)} disabled={isSaving}>
                    <Eye size={14} />
                    View
                  </button>
                </td>
              </tr>
            ))
          )}
          </tbody>
        </table>
      </div>

      {selectedPO ? (
        <PurchaseOrderDetailsModal
          mode={mode}
          purchaseOrder={selectedPO}
          companies={companies}
          currentUser={currentUser}
          isSaving={isSaving}
          error={error}
          onClose={closeModal}
          onSave={handleSave}
          onDelete={mode === "view" ? handleDelete : undefined}
        />
      ) : null}
    </div>
  );
}

export default PurchaseOrderManagement;
