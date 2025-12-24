import React, { useCallback, useEffect, useMemo, useState } from "react";
import PurchaseOrderDetailsModal, {
  type UICompany,
  type UIPurchaseOrder,
} from "./PurchaseOrderDetailsModal";

function getShopParam(): string | null {
  try {
    const s = new URLSearchParams(window.location.search).get("shop");
    return s ? String(s).trim() : null;
  } catch {
    return null;
  }
}

function withShop(url: string): string {
  const shop = getShopParam();
  if (!shop) return url;
  try {
    const u = new URL(url, window.location.origin);
    u.searchParams.set("shop", shop);
    return u.toString();
  } catch {
    // if url is relative without base support
    return url.includes("?") ? `${url}&shop=${encodeURIComponent(shop)}` : `${url}?shop=${encodeURIComponent(shop)}`;
  }
}

function formatDateTime(v: string | Date | null | undefined): string {
  if (!v) return "-";
  const d = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleString();
}

function roundToNearest(n: number): number {
  if (!Number.isFinite(n)) return 0;
  const r = Math.round(n);
  return r < 1 ? 1 : r;
}

function formatUpdatedRelative(createdAt?: string | null, updatedAt?: string | null): string {
  if (!createdAt || !updatedAt) return "-";

  const c = new Date(createdAt);
  const u = new Date(updatedAt);
  if (Number.isNaN(c.getTime()) || Number.isNaN(u.getTime())) return "-";

  const diffMs = u.getTime() - c.getTime();
  // If no meaningful update since create, show "-"
  if (Math.abs(diffMs) < 60_000) return "-";

  const now = Date.now();
  const sinceMs = now - u.getTime();
  if (sinceMs < 0) return "0 minutes";

  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  const month = 30 * day;
  const year = 365 * day;

  let value = 0;
  let unit = "minutes";

  if (sinceMs < hour) {
    value = roundToNearest(sinceMs / minute);
    unit = "minute";
  } else if (sinceMs < day) {
    value = roundToNearest(sinceMs / hour);
    unit = "hour";
  } else if (sinceMs < month) {
    value = roundToNearest(sinceMs / day);
    unit = "day";
  } else if (sinceMs < year) {
    value = roundToNearest(sinceMs / month);
    unit = "month";
  } else {
    value = roundToNearest(sinceMs / year);
    unit = "year";
  }

  return `${value} ${unit}${value === 1 ? "" : "s"}`;
}

export function PurchaseOrderManagement() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [companies, setCompanies] = useState<UICompany[]>([]);
  const [purchaseOrders, setPurchaseOrders] = useState<UIPurchaseOrder[]>([]);

  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<"create" | "view">("view");
  const [selected, setSelected] = useState<UIPurchaseOrder | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(withShop("/apps/logistics/purchase-orders?intent=bootstrap"), {
        method: "GET",
        headers: { Accept: "application/json" },
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        throw new Error(data?.error || `Failed to load (${res.status})`);
      }
      setCompanies(Array.isArray(data.companies) ? data.companies : []);
      setPurchaseOrders(Array.isArray(data.purchaseOrders) ? data.purchaseOrders : []);
    } catch (e: any) {
      setError(e?.message || "Failed to load purchase orders.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const openCreate = useCallback(() => {
    const nowIso = new Date().toISOString();
    setSelected({
      id: "new",
      shortName: "",
      purchaseOrderGID: "",
      purchaseOrderPdfUrl: null,
      createdAt: nowIso,
      updatedAt: null,
      companyID: null,
      companyName: null,
    });
    setModalMode("create");
    setModalOpen(true);
  }, []);

  const openView = useCallback((po: UIPurchaseOrder) => {
    setSelected(po);
    setModalMode("view");
    setModalOpen(true);
  }, []);

  const onSaved = useCallback((po: UIPurchaseOrder) => {
    setPurchaseOrders((prev) => {
      const idx = prev.findIndex((p) => p.purchaseOrderGID === po.purchaseOrderGID);
      if (idx >= 0) {
        const copy = prev.slice();
        copy[idx] = { ...copy[idx], ...po };
        return copy;
      }
      return [po, ...prev];
    });
  }, []);

  const rows = useMemo(() => {
    return purchaseOrders.map((po) => {
      return {
        key: po.purchaseOrderGID,
        company: po.companyName || po.companyID || "-",
        shortName: po.shortName || "-",
        gid: po.purchaseOrderGID || "-",
        created: formatDateTime(po.createdAt),
        updatedRel: formatUpdatedRelative(po.createdAt ?? null, po.updatedAt ?? null),
        po,
      };
    });
  }, [purchaseOrders]);

  return (
    <div style={{ padding: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div style={{ fontSize: 18, fontWeight: 800 }}>Purchase Orders</div>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            type="button"
            onClick={() => void refresh()}
            style={{
              padding: "8px 12px",
              borderRadius: 10,
              border: "1px solid #e2e8f0",
              background: "white",
              cursor: "pointer",
              fontWeight: 700,
            }}
            disabled={loading}
          >
            Refresh
          </button>
          <button
            type="button"
            onClick={openCreate}
            style={{
              padding: "8px 12px",
              borderRadius: 10,
              border: "1px solid #0f172a",
              background: "#0f172a",
              color: "white",
              cursor: "pointer",
              fontWeight: 800,
            }}
          >
            Create Purchase Order
          </button>
        </div>
      </div>

      {error ? (
        <div style={{ marginTop: 12, padding: 12, borderRadius: 10, background: "#fff1f2", border: "1px solid #fecdd3" }}>
          <div style={{ fontWeight: 800, color: "#9f1239" }}>Error</div>
          <div style={{ color: "#9f1239" }}>{error}</div>
        </div>
      ) : null}

      <div style={{ marginTop: 12, border: "1px solid #e2e8f0", borderRadius: 14, overflow: "hidden", background: "white" }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
            <tr style={{ background: "#f8fafc", borderBottom: "1px solid #e2e8f0" }}>
              <th style={{ textAlign: "left", padding: 10, fontWeight: 900, whiteSpace: "nowrap" }}>Company</th>
              <th style={{ textAlign: "left", padding: 10, fontWeight: 900, whiteSpace: "nowrap" }}>PO Short Name</th>
              <th style={{ textAlign: "left", padding: 10, fontWeight: 900, whiteSpace: "nowrap" }}>Purchase Order Shopify ID</th>
              <th style={{ textAlign: "left", padding: 10, fontWeight: 900, whiteSpace: "nowrap" }}>Created</th>
              <th style={{ textAlign: "left", padding: 10, fontWeight: 900, whiteSpace: "nowrap" }}>Updated</th>
              <th style={{ textAlign: "right", padding: 10, fontWeight: 900, whiteSpace: "nowrap" }}>Actions</th>
            </tr>
            </thead>
            <tbody>
            {loading ? (
              <tr>
                <td colSpan={6} style={{ padding: 12, color: "#64748b" }}>
                  Loading…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={6} style={{ padding: 12, color: "#64748b" }}>
                  No purchase orders found.
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr
                  key={r.key}
                  style={{ borderBottom: "1px solid #f1f5f9", cursor: "pointer" }}
                  onClick={() => openView(r.po)}
                >
                  <td style={{ padding: 10, whiteSpace: "nowrap" }}>{r.company}</td>
                  <td style={{ padding: 10, whiteSpace: "nowrap", fontWeight: 800 }}>{r.shortName}</td>
                  <td style={{ padding: 10, whiteSpace: "nowrap" }}>{r.gid}</td>
                  <td style={{ padding: 10, whiteSpace: "nowrap" }}>{r.created}</td>
                  <td style={{ padding: 10, whiteSpace: "nowrap" }}>{r.updatedRel}</td>
                  <td style={{ padding: 10, textAlign: "right", whiteSpace: "nowrap" }}>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        openView(r.po);
                      }}
                      style={{
                        padding: "6px 10px",
                        borderRadius: 10,
                        border: "1px solid #e2e8f0",
                        background: "white",
                        cursor: "pointer",
                        fontWeight: 800,
                      }}
                    >
                      View
                    </button>
                  </td>
                </tr>
              ))
            )}
            </tbody>
          </table>
        </div>
      </div>

      {selected ? (
        <PurchaseOrderDetailsModal
          open={modalOpen}
          mode={modalMode}
          purchaseOrder={selected}
          companies={companies}
          onClose={() => setModalOpen(false)}
          onSaved={onSaved}
        />
      ) : null}
    </div>
  );
}

export default PurchaseOrderManagement;
