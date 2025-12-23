// app/logistics-ui/components/PurchaseOrderManagement.tsx
import React, { useMemo, useState } from "react";
import { Search, Plus, ChevronLeft, Eye, FileText, Building2 } from "lucide-react";

import PurchaseOrderDetailsModal, {
  type UIPurchaseOrder,
  type CompanyOption,
} from "./PurchaseOrderDetailsModal";
import {withShopParam} from "~/logistics-ui/utils/shop";

interface PurchaseOrderManagementProps {
  purchaseOrders: UIPurchaseOrder[];
  onPurchaseOrdersChange: (next: UIPurchaseOrder[]) => void;

  companies: CompanyOption[];

  onBack: () => void;
  onLogout: () => void;
}

type FilterOption = "all" | "withPdf" | "noPdf";

// --- styles (mirrors UserManagement.tsx) -------------------------------------

const pageStyle: React.CSSProperties = {
  minHeight: "100vh",
  backgroundColor: "#f5f7fb",
  fontFamily:
    'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  color: "#111827",
};

const headerOuterStyle: React.CSSProperties = {
  backgroundColor: "#ffffff",
  borderBottom: "1px solid #e5e7eb",
};

const headerInnerStyle: React.CSSProperties = {
  maxWidth: 1120,
  margin: "0 auto",
  padding: "12px 24px",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
};

const headerLeftStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 12,
};

const backButtonStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  padding: "6px 10px",
  borderRadius: 999,
  border: "1px solid transparent",
  background: "none",
  cursor: "pointer",
  color: "#4b5563",
};

const logoutButtonStyle: React.CSSProperties = {
  fontSize: 13,
  color: "#6b7280",
  background: "none",
  border: "none",
  cursor: "pointer",
};

const mainStyle: React.CSSProperties = {
  maxWidth: 1120,
  margin: "0 auto",
  padding: "20px 16px 32px",
};

const controlsRowStyle: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 12,
  alignItems: "center",
  justifyContent: "space-between",
  marginBottom: 16,
};

const searchContainerStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 220,
  display: "flex",
  gap: 8,
};

const searchWrapperStyle: React.CSSProperties = {
  position: "relative",
  flex: 1,
};

const searchInputStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px 10px 8px 30px",
  borderRadius: 6,
  border: "1px solid #d1d5db",
  fontSize: 13,
};

const selectStyle: React.CSSProperties = {
  minWidth: 150,
  padding: "8px 10px",
  borderRadius: 6,
  border: "1px solid #d1d5db",
  fontSize: 13,
  backgroundColor: "#ffffff",
};

const createButtonStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 8,
  padding: "8px 14px",
  borderRadius: 8,
  border: "none",
  backgroundColor: "#2563eb",
  color: "#ffffff",
  fontSize: 13,
  fontWeight: 500,
  cursor: "pointer",
  boxShadow: "0 10px 15px -3px rgba(37,99,235,0.25)",
};

const tableCardStyle: React.CSSProperties = {
  backgroundColor: "#ffffff",
  borderRadius: 10,
  border: "1px solid #e5e7eb",
  boxShadow: "0 10px 30px rgba(15,23,42,0.06)",
  overflow: "hidden",
};

const tableStyle: React.CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  fontSize: 13,
};

const thStyle: React.CSSProperties = {
  textAlign: "left",
  padding: "10px 16px",
  fontWeight: 500,
  color: "#6b7280",
  backgroundColor: "#f9fafb",
  borderBottom: "1px solid #e5e7eb",
};

const tdStyle: React.CSSProperties = {
  padding: "10px 16px",
  borderBottom: "1px solid #f3f4f6",
  verticalAlign: "middle",
};

const statusPillBase: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  padding: "4px 10px",
  borderRadius: 999,
  fontSize: 11,
  fontWeight: 500,
};

const linkButtonStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
  fontSize: 12,
  color: "#2563eb",
  background: "none",
  border: "none",
  cursor: "pointer",
};

const statsRowStyle: React.CSSProperties = {
  marginTop: 18,
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
  gap: 12,
};

const statCardStyle: React.CSSProperties = {
  backgroundColor: "#ffffff",
  borderRadius: 10,
  border: "1px solid #e5e7eb",
  padding: "10px 14px",
  fontSize: 12,
};

const statLabelStyle: React.CSSProperties = {
  color: "#6b7280",
  marginBottom: 4,
};

const statValueStyle: React.CSSProperties = {
  fontSize: 18,
  fontWeight: 600,
  color: "#111827",
};

// --- API helper --------------------------------------------------------------

async function postPurchaseOrdersEndpoint(payload: any) {
  const res = await fetch(withShopParam("/apps/logistics/purchase-orders"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  return res.json();
}

// -----------------------------------------------------------------------------
// Component (named export + default)
// -----------------------------------------------------------------------------

export function PurchaseOrderManagement({
                                          purchaseOrders,
                                          onPurchaseOrdersChange,
                                          companies,
                                          onBack,
                                          onLogout,
                                        }: PurchaseOrderManagementProps) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<FilterOption>("all");

  const [selectedPO, setSelectedPO] = useState<UIPurchaseOrder | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const filteredPOs = useMemo(() => {
    const term = search.trim().toLowerCase();

    return (purchaseOrders || []).filter((po) => {
      const matchesSearch =
        !term ||
        (po.shortName && po.shortName.toLowerCase().includes(term)) ||
        (po.purchaseOrderGID && String(po.purchaseOrderGID).toLowerCase().includes(term));

      const hasPdf = Boolean(String(po.purchaseOrderPdfUrl || "").trim());

      const matchesFilter =
        filter === "all" ? true : filter === "withPdf" ? hasPdf : !hasPdf;

      return matchesSearch && matchesFilter;
    });
  }, [purchaseOrders, search, filter]);

  const stats = useMemo(() => {
    const total = purchaseOrders.length;
    const withPdf = purchaseOrders.filter((po) =>
      Boolean(String(po.purchaseOrderPdfUrl || "").trim())
    ).length;
    const noPdf = total - withPdf;
    return { total, withPdf, noPdf };
  }, [purchaseOrders]);

  const openDetails = (po: UIPurchaseOrder) => {
    setModalError(null);
    setSelectedPO(po);
    setShowDetails(true);
  };

  const handleCreateClick = () => {
    const blank: UIPurchaseOrder = {
      id: "new",
      shortName: "",
      companyID: "", // IMPORTANT: default to Select…
      purchaseOrderGID: "",
      purchaseOrderPdfUrl: "",
      notes: [],
    };
    openDetails(blank);
  };

  const closeModal = () => {
    setShowDetails(false);
    setSelectedPO(null);
    setModalError(null);
  };

  const handleSave = async (mode: "create" | "update", purchaseOrderToSave: UIPurchaseOrder) => {
    try {
      setIsSaving(true);
      setModalError(null);

      const data = await postPurchaseOrdersEndpoint({
        intent: mode,
        purchaseOrder: purchaseOrderToSave,
      });

      if (!data || data.success !== true) {
        setModalError(data?.error || "Unable to save purchase order.");
        return;
      }

      const saved = data.purchaseOrder as UIPurchaseOrder;

      if (mode === "create") {
        onPurchaseOrdersChange([...purchaseOrders, saved]);
      } else {
        onPurchaseOrdersChange(
          purchaseOrders.map((po) => {
            const a = String(po.purchaseOrderGID || "");
            const b = String(saved.purchaseOrderGID || "");
            if (a && b) return a === b ? saved : po;
            return String(po.id) === String(saved.id) ? saved : po;
          })
        );
      }

      closeModal();
    } catch (e: any) {
      setModalError(e?.message || "Unable to save purchase order.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (purchaseOrderToDelete: UIPurchaseOrder) => {
    try {
      setIsSaving(true);
      setModalError(null);

      const data = await postPurchaseOrdersEndpoint({
        intent: "delete",
        purchaseOrder: purchaseOrderToDelete,
      });

      if (!data || data.success !== true) {
        setModalError(data?.error || "Unable to delete purchase order.");
        return;
      }

      const deletedGid = String(data.deletedPurchaseOrderGID || "");
      const deletedId = String(data.deletedPurchaseOrderId || "");

      onPurchaseOrdersChange(
        purchaseOrders.filter((po) => {
          if (deletedGid) return String(po.purchaseOrderGID || "") !== deletedGid;
          if (deletedId) return String(po.id) !== deletedId;
          return String(po.purchaseOrderGID || "") !== String(purchaseOrderToDelete.purchaseOrderGID || "");
        })
      );

      closeModal();
    } catch (e: any) {
      setModalError(e?.message || "Unable to delete purchase order.");
    } finally {
      setIsSaving(false);
    }
  };

  const companyLabel = (po: UIPurchaseOrder) => {
    if (po.companyName) return po.companyName;
    const cid = String(po.companyID || "").trim();
    if (!cid) return "—";
    const c = companies.find((x) => x.shortName === cid);
    if (!c) return cid;
    return c.displayName ? `${c.displayName} (${c.shortName})` : c.shortName;
  };

  return (
    <div style={pageStyle}>
      <header style={headerOuterStyle}>
        <div style={headerInnerStyle}>
          <div style={headerLeftStyle}>
            <button type="button" onClick={onBack} style={backButtonStyle}>
              <ChevronLeft size={16} />
              <span style={{ fontSize: 13 }}>Back to dashboard</span>
            </button>
            <div style={{ width: 1, height: 24, backgroundColor: "#e5e7eb" }} />
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 2 }}>
                Purchase Order Management
              </div>
              <div style={{ fontSize: 12, color: "#6b7280" }}>
                Manage purchase orders and PDF references
              </div>
            </div>
          </div>

          <button type="button" onClick={onLogout} style={logoutButtonStyle}>
            Log out
          </button>
        </div>
      </header>

      <main style={mainStyle}>
        <div style={controlsRowStyle}>
          <div style={searchContainerStyle}>
            <div style={searchWrapperStyle}>
              <Search
                size={16}
                style={{
                  position: "absolute",
                  left: 8,
                  top: "50%",
                  transform: "translateY(-50%)",
                  color: "#9ca3af",
                }}
              />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by PO number…"
                style={searchInputStyle}
              />
            </div>

            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value as FilterOption)}
              style={selectStyle}
            >
              <option value="all">All purchase orders</option>
              <option value="withPdf">With PDF</option>
              <option value="noPdf">No PDF</option>
            </select>
          </div>

          <button
            type="button"
            onClick={handleCreateClick}
            style={createButtonStyle}
            disabled={isSaving}
          >
            <Plus size={16} />
            <span>Create purchase order</span>
          </button>
        </div>

        <div style={tableCardStyle}>
          <table style={tableStyle}>
            <thead>
            <tr>
              <th style={thStyle}>PO Number</th>
              <th style={thStyle}>Company</th>
              <th style={thStyle}>PDF</th>
              <th style={{ ...thStyle, textAlign: "right" }}>Actions</th>
            </tr>
            </thead>

            <tbody>
            {filteredPOs.length === 0 ? (
              <tr>
                <td
                  colSpan={4}
                  style={{
                    ...tdStyle,
                    textAlign: "center",
                    padding: "24px 16px",
                    color: "#6b7280",
                  }}
                >
                  No purchase orders found.
                </td>
              </tr>
            ) : (
              filteredPOs.map((po) => {
                const hasPdf = Boolean(String(po.purchaseOrderPdfUrl || "").trim());

                return (
                  <tr
                    key={String(po.purchaseOrderGID || po.id)}
                    style={{ cursor: "pointer" }}
                    onClick={() => openDetails(po)}
                  >
                    <td style={tdStyle}>{po.shortName || "—"}</td>
                    <td style={tdStyle}>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                          <Building2 size={14} style={{ color: "#94a3b8" }} />
                          <span style={{ color: "#374151" }}>{companyLabel(po)}</span>
                        </span>
                    </td>
                    <td style={tdStyle}>
                        <span
                          style={{
                            ...statusPillBase,
                            backgroundColor: hasPdf ? "#dcfce7" : "#f1f5f9",
                            color: hasPdf ? "#166534" : "#334155",
                            gap: 6,
                          }}
                        >
                          <FileText size={14} />
                          {hasPdf ? "PDF linked" : "No PDF"}
                        </span>
                    </td>
                    <td style={{ ...tdStyle, textAlign: "right" }}>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          openDetails(po);
                        }}
                        style={linkButtonStyle}
                      >
                        <Eye size={14} />
                        <span>View</span>
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
            </tbody>
          </table>
        </div>

        <div style={statsRowStyle}>
          <div style={statCardStyle}>
            <div style={statLabelStyle}>Total POs</div>
            <div style={statValueStyle}>{stats.total}</div>
          </div>
          <div style={statCardStyle}>
            <div style={statLabelStyle}>With PDF</div>
            <div style={statValueStyle}>{stats.withPdf}</div>
          </div>
          <div style={statCardStyle}>
            <div style={statLabelStyle}>No PDF</div>
            <div style={statValueStyle}>{stats.noPdf}</div>
          </div>
        </div>
      </main>

      {showDetails && selectedPO ? (
        <PurchaseOrderDetailsModal
          purchaseOrder={selectedPO}
          companies={companies}
          isSaving={isSaving}
          error={modalError}
          onClose={closeModal}
          onSave={handleSave}
          onDelete={handleDelete}
        />
      ) : null}
    </div>
  );
}

export default PurchaseOrderManagement;
