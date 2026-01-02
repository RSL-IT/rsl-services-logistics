// app/logistics-ui/components/SupplierDashboard.tsx
import React, { useMemo, useState } from "react";
import type { Shipment } from "../LogisticsApp";
import type { UIUser, CompanyOption, LookupOption, PurchaseOrderOption } from "./types";
import ShipmentDetailsModal from "./ShipmentDetailsModal";

interface SupplierDashboardProps {
  currentUser: UIUser | null;
  shipments: Shipment[];

  companies: CompanyOption[];
  containers: LookupOption[];
  originPorts: LookupOption[];
  destinationPorts: LookupOption[];

  bookingAgents: LookupOption[];
  deliveryAddresses: LookupOption[];
  purchaseOrders: PurchaseOrderOption[];

  onShipmentsChange: (next: Shipment[] | ((prev: Shipment[]) => Shipment[])) => void;

  onLogout: () => void | Promise<void>;
  onNavigateToPurchaseOrders: () => void;
}

function companyLabel(c: CompanyOption) {
  const d = String(c.displayName ?? "").trim();
  return d ? `${c.shortName} — ${d}` : c.shortName;
}

function statusPill(status: string): React.CSSProperties {
  const s = String(status || "").toLowerCase();
  if (s.includes("deliver")) return { background: "#dcfce7", color: "#166534" };
  if (s.includes("transit")) return { background: "#ffedd5", color: "#9a3412" };
  if (s.includes("arriv")) return { background: "#dbeafe", color: "#1d4ed8" };
  if (s.includes("pend")) return { background: "#f1f5f9", color: "#334155" };
  return { background: "#f1f5f9", color: "#334155" };
}

const pageStyle: React.CSSProperties = {
  minHeight: "100vh",
  background: "#f8fafc",
  padding: 18,
};

const headerStyle: React.CSSProperties = {
  background: "#059669", // Green for supplier dashboard
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

const btnDisabled: React.CSSProperties = {
  ...btnBase,
  background: "#cbd5e1",
  color: "#475569",
  cursor: "not-allowed",
};

const cardStyle: React.CSSProperties = {
  background: "#fff",
  border: "1px solid #e5e7eb",
  borderRadius: 14,
  boxShadow: "0 10px 24px rgba(15,23,42,0.06)",
  padding: 14,
};

const controlsRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "flex-end",
  gap: 12,
  flexWrap: "wrap",
};

const fieldStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
};

const labelStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 700,
  color: "#475569",
};

const selectStyle: React.CSSProperties = {
  minWidth: 220,
  borderRadius: 10,
  border: "1px solid #d1d5db",
  padding: "10px 10px",
  fontSize: 13,
  background: "#fff",
};

const tableWrapStyle: React.CSSProperties = {
  marginTop: 14,
  overflow: "hidden",
  borderRadius: 14,
  border: "1px solid #e5e7eb",
  background: "#fff",
};

const tableStyle: React.CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
};

const thStyle: React.CSSProperties = {
  textAlign: "left",
  fontSize: 12,
  fontWeight: 800,
  color: "#475569",
  padding: "12px 12px",
  background: "#f1f5f9",
  borderBottom: "1px solid #e5e7eb",
  letterSpacing: 0.3,
};

const tdStyle: React.CSSProperties = {
  padding: "12px 12px",
  borderBottom: "1px solid #eef2f7",
  fontSize: 13,
  color: "#0f172a",
  verticalAlign: "middle",
};

const rowHoverStyle: React.CSSProperties = {
  cursor: "pointer",
};

const pillBase: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  padding: "6px 10px",
  borderRadius: 999,
  fontSize: 12,
  fontWeight: 800,
  border: "1px solid rgba(15,23,42,0.06)",
};

export function SupplierDashboard({
                                    currentUser,
                                    shipments,
                                    companies,
                                    containers,
                                    originPorts,
                                    destinationPorts,
                                    bookingAgents,
                                    deliveryAddresses,
                                    purchaseOrders,
                                    onShipmentsChange,
                                    onLogout,
                                    onNavigateToPurchaseOrders,
                                  }: SupplierDashboardProps) {
  const [selectedStatus, setSelectedStatus] = useState<string>("all");

  const [showShipmentModal, setShowShipmentModal] = useState(false);
  const [activeShipment, setActiveShipment] = useState<Shipment | null>(null);
  const [savingShipment, setSavingShipment] = useState(false);
  const [shipmentError, setShipmentError] = useState<string | null>(null);

  // Get the supplier ID from the current user's company
  const supplierId = (currentUser as any)?.companyName || (currentUser as any)?.supplierId || "";

  // Find the company details for display
  const supplierCompany = useMemo(() => {
    return companies.find((c) => c.shortName === supplierId);
  }, [companies, supplierId]);

  const supplierDisplayName = supplierCompany
    ? companyLabel(supplierCompany)
    : supplierId || "Unknown Supplier";

  const canCreateShipment = !!(
    (currentUser as any)?.permissions?.createUpdateShipment ||
    (currentUser as any)?.permissions?.modifyShipper
  );

  // Filter shipments to only show this supplier's shipments
  const filteredShipments = useMemo(() => {
    return (shipments || []).filter((s) => {
      const matchSupplier = s.supplierId === supplierId;
      const matchStatus = selectedStatus === "all" || s.status === selectedStatus;
      return matchSupplier && matchStatus;
    });
  }, [shipments, supplierId, selectedStatus]);

  // Filter purchase orders to only show this supplier's POs
  const filteredPurchaseOrders = useMemo(() => {
    return (purchaseOrders || []).filter((po) => po.companyID === supplierId);
  }, [purchaseOrders, supplierId]);

  const openCreateShipment = () => {
    setShipmentError(null);

    const presetSupplierName =
      (supplierCompany?.displayName && String(supplierCompany.displayName).trim()) || supplierId;

    const blank: Shipment = {
      id: "new",
      supplierId: supplierId,
      supplierName: presetSupplierName,
      products: [] as Shipment["products"],

      containerNumber: "",
      containerSize: "",
      portOfOrigin: "",
      destinationPort: "",

      cargoReadyDate: "",
      etd: "",
      actualDepartureDate: "",
      eta: "",
      sealNumber: "",
      hblNumber: "",
      estimatedDeliveryDate: "",

      status: "Pending",

      estimatedDeliveryToOrigin: "",
      supplierPi: "",
      quantity: 0,
      bookingAgent: "",
      bookingNumber: "",
      vesselName: "",
      deliveryAddress: "",
      notes: "",

      purchaseOrderGIDs: [],
      purchaseOrderShortNames: [],
    };

    setActiveShipment(blank);
    setShowShipmentModal(true);
  };

  const openShipmentDetail = (s: Shipment) => {
    setShipmentError(null);
    setActiveShipment(s);
    setShowShipmentModal(true);
  };

  const closeShipmentModal = () => {
    setShowShipmentModal(false);
    setActiveShipment(null);
    setSavingShipment(false);
    setShipmentError(null);
  };

  const saveShipment = async (mode: "create" | "update", s: Shipment) => {
    setSavingShipment(true);
    setShipmentError(null);

    try {
      const res = await fetch("/apps/logistics/shipments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ intent: mode, shipment: s }),
      });

      const data = await res.json();

      if (!data?.success) {
        setShipmentError(data?.error || "Could not save shipment.");
        setSavingShipment(false);
        return;
      }

      const saved: Shipment = data.shipment;

      if (mode === "create") {
        onShipmentsChange((prev) => [saved, ...(prev || [])]);
      } else {
        onShipmentsChange((prev) => (prev || []).map((x) => (x.id === saved.id ? saved : x)));
      }

      closeShipmentModal();
    } catch (err) {
      console.error("saveShipment error:", err);
      setShipmentError("Network/server error while saving shipment.");
      setSavingShipment(false);
    }
  };

  const deleteShipment = async (s: Shipment) => {
    setSavingShipment(true);
    setShipmentError(null);

    try {
      const res = await fetch("/apps/logistics/shipments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ intent: "delete", shipment: s }),
      });

      const data = await res.json();

      if (!data?.success) {
        setShipmentError(data?.error || "Could not delete shipment.");
        setSavingShipment(false);
        return;
      }

      onShipmentsChange((prev) => (prev || []).filter((x) => x.id !== String(s.id)));
      closeShipmentModal();
    } catch (err) {
      console.error("deleteShipment error:", err);
      setShipmentError("Network/server error while deleting shipment.");
      setSavingShipment(false);
    }
  };

  return (
    <div style={pageStyle}>
      <div style={headerStyle}>
        <div>
          <div style={headerTitleStyle}>RSL Logistics Supplier Dashboard</div>
          <div style={headerSubStyle}>
            <b>{supplierDisplayName}</b> — Logged in as{" "}
            <b>{String((currentUser as any)?.name || currentUser?.email || "User")}</b>
          </div>
        </div>

        <div style={headerRightStyle}>
          <button
            onClick={onNavigateToPurchaseOrders}
            style={btnPrimary}
          >
            View Purchase Orders
          </button>

          <button onClick={() => void onLogout()} style={btnDanger}>
            Log Out
          </button>
        </div>
      </div>

      <div style={cardStyle}>
        <div style={controlsRowStyle}>
          <div style={fieldStyle}>
            <div style={labelStyle}>Filter by Status</div>
            <select
              value={selectedStatus}
              onChange={(e) => setSelectedStatus(e.target.value)}
              style={selectStyle}
            >
              <option value="all">All</option>
              <option value="Pending">Pending</option>
              <option value="In Transit">In Transit</option>
              <option value="Arrived">Arrived</option>
              <option value="Delivered">Delivered</option>
            </select>
          </div>

          <div style={{ flex: 1 }} />

          <button
            type="button"
            onClick={openCreateShipment}
            disabled={!canCreateShipment}
            style={canCreateShipment ? btnSuccess : btnDisabled}
            title={!canCreateShipment ? "You do not have permission to create/update shipments." : ""}
          >
            Create Shipment
          </button>
        </div>

        <div style={tableWrapStyle}>
          <table style={tableStyle}>
            <thead>
            <tr>
              <th style={thStyle}>Container #</th>
              <th style={thStyle}>ETA</th>
              <th style={thStyle}>Status</th>
            </tr>
            </thead>

            <tbody>
            {filteredShipments.map((s, idx) => (
              <tr
                key={s.id}
                style={{
                  ...(rowHoverStyle as any),
                  background: idx % 2 === 0 ? "#ffffff" : "#fbfdff",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "#f8fafc")}
                onMouseLeave={(e) =>
                  (e.currentTarget.style.backgroundColor = idx % 2 === 0 ? "#ffffff" : "#fbfdff")
                }
                onClick={() => openShipmentDetail(s)}
              >
                <td style={tdStyle}>{s.containerNumber || "—"}</td>
                <td style={tdStyle}>{(s as any).eta || "—"}</td>
                <td style={tdStyle}>
                    <span style={{ ...pillBase, ...statusPill(String(s.status || "")) }}>
                      {s.status || "—"}
                    </span>
                </td>
              </tr>
            ))}

            {filteredShipments.length === 0 && (
              <tr>
                <td colSpan={3} style={{ ...tdStyle, textAlign: "center", color: "#64748b" }}>
                  No shipments match your filters
                </td>
              </tr>
            )}
            </tbody>
          </table>
        </div>
      </div>

      {showShipmentModal && activeShipment ? (
        <ShipmentDetailsModal
          shipment={activeShipment}
          companies={companies.filter((c) => c.shortName === supplierId)} // Only show their company
          containers={containers}
          originPorts={originPorts}
          destinationPorts={destinationPorts}
          bookingAgents={bookingAgents}
          deliveryAddresses={deliveryAddresses}
          purchaseOrders={filteredPurchaseOrders} // Only their POs
          canEdit={canCreateShipment}
          isSupplier={true}
          isSaving={savingShipment}
          error={shipmentError}
          onClose={closeShipmentModal}
          onSave={saveShipment}
          onDelete={deleteShipment}
        />
      ) : null}
    </div>
  );
}
