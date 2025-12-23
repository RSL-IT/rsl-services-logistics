// app/logistics-ui/components/InternalDashboard.tsx
import React, { useMemo, useState } from "react";
import type { Shipment as BaseShipment, CompanyOption, LookupOption } from "../LogisticsApp";
import type { User } from "../data/usersData";
import ShipmentDetailsModal from "./ShipmentDetailsModal";

// Local type so we don't depend on an export from LogisticsApp
export type PurchaseOrderOption = {
  purchaseOrderGID: string;
  shortName: string;
};

// Extend Shipment safely (works whether LogisticsApp's Shipment already has these or not)
export type Shipment = BaseShipment & {
  // DB-backed fields you’re using in the shipment endpoint:
  cargoReadyDate?: string;
  estimatedDeliveryToOrigin?: string;
  supplierPi?: string;
  quantity?: string | number | null; // UI sends string; server parses BigInt
  bookingNumber?: string;
  notes?: string;

  // UI-only fields (until you add DB columns):
  bookingAgent?: string;
  vesselName?: string;
  deliveryAddress?: string;

  // PO multi-select
  purchaseOrderGIDs?: string[];
  purchaseOrderShortNames?: string[];
};

interface InternalDashboardProps {
  currentUser: User;
  shipments: Shipment[];

  companies: CompanyOption[];
  containers: LookupOption[];
  originPorts: LookupOption[];
  destinationPorts: LookupOption[];

  bookingAgents: LookupOption[];
  deliveryAddresses: LookupOption[];
  purchaseOrders: PurchaseOrderOption[];

  // Allow passing setState directly (Dispatch<SetStateAction<Shipment[]>>)
  onShipmentsChange: (next: Shipment[] | ((prev: Shipment[]) => Shipment[])) => void;

  onLogout: () => void | Promise<void>;
  onNavigateToUsers: () => void;
  onNavigateToPurchaseOrders: () => void;
}

function sortCompaniesSpecial(companies: CompanyOption[]) {
  const list = companies.slice();
  const norm = (v: unknown) => String(v || "").trim().toLowerCase();

  list.sort((a, b) => {
    const aKey = norm(a.shortName);
    const bKey = norm(b.shortName);

    const aIsRsl = aKey === "rsl";
    const bIsRsl = bKey === "rsl";
    if (aIsRsl && !bIsRsl) return -1;
    if (bIsRsl && !aIsRsl) return 1;

    const aIsOther = aKey === "other";
    const bIsOther = bKey === "other";
    if (aIsOther && !bIsOther) return 1;
    if (bIsOther && !aIsOther) return -1;

    return aKey.localeCompare(bKey);
  });

  return list;
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

export function InternalDashboard({
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
                                    onNavigateToUsers,
                                    onNavigateToPurchaseOrders,
                                  }: InternalDashboardProps) {
  const [selectedStatus, setSelectedStatus] = useState<string>("all");
  const [selectedSupplier, setSelectedSupplier] = useState<string>("all");

  const [showShipmentModal, setShowShipmentModal] = useState(false);
  const [activeShipment, setActiveShipment] = useState<Shipment | null>(null);
  const [savingShipment, setSavingShipment] = useState(false);
  const [shipmentError, setShipmentError] = useState<string | null>(null);

  const orderedCompanies = useMemo(
    () => sortCompaniesSpecial(Array.isArray(companies) ? companies : []),
    [companies]
  );

  const canCreateShipment = !!(
    (currentUser as any)?.permissions?.createUpdateShipment ||
    (currentUser as any)?.permissions?.modifyShipper
  );

  const canManageUsers = !!(
    (currentUser as any)?.permissions?.viewUserManagement ||
    (currentUser as any)?.permissions?.createEditUser
  );

  // No dedicated PO permission yet; best-fit is dashboard edit OR shipment create/update.
  const canManagePurchaseOrders = !!(
    (currentUser as any)?.permissions?.editDashboard ||
    (currentUser as any)?.permissions?.createUpdateShipment ||
    (currentUser as any)?.permissions?.modifyShipper
  );

  const filteredShipments = useMemo(() => {
    return (shipments || []).filter((s) => {
      const matchStatus = selectedStatus === "all" || s.status === selectedStatus;
      const matchSupplier = selectedSupplier === "all" || s.supplierId === selectedSupplier;
      return matchStatus && matchSupplier;
    });
  }, [shipments, selectedStatus, selectedSupplier]);

  const openCreateShipment = () => {
    setShipmentError(null);

    const presetSupplierId = selectedSupplier !== "all" ? selectedSupplier : "";
    const presetCompany = orderedCompanies.find((c) => c.shortName === presetSupplierId);
    const presetSupplierName =
      (presetCompany?.displayName && String(presetCompany.displayName).trim()) || presetSupplierId;

    // ✅ IMPORTANT: include ALL required BaseShipment fields so TS is happy.
    const blank: Shipment = {
      id: "new",
      supplierId: presetSupplierId,
      supplierName: presetSupplierName,
      products: [] as Shipment["products"],

      containerNumber: "",
      containerSize: "",
      portOfOrigin: "",
      destinationPort: "",

      cargoReadyDate: "",
      etd: "",
      actualDepartureDate: "", // required
      eta: "",
      sealNumber: "", // required
      hblNumber: "", // required
      estimatedDeliveryDate: "", // required

      status: "Pending",

      // new fields
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
    const ok = window.confirm("Delete this shipment? This cannot be undone.");
    if (!ok) return;

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
          <div style={headerTitleStyle}>RSL Logistics Internal Dashboard</div>
          <div style={headerSubStyle}>
            Logged in as <b>{String((currentUser as any)?.name || currentUser?.email || "User")}</b>
          </div>
        </div>

        <div style={headerRightStyle}>
          <button
            onClick={onNavigateToUsers}
            disabled={!canManageUsers}
            style={canManageUsers ? btnPrimary : btnDisabled}
            title={!canManageUsers ? "You do not have permission to manage users." : ""}
          >
            Manage Users
          </button>

          <button
            onClick={onNavigateToPurchaseOrders}
            disabled={!canManagePurchaseOrders}
            style={canManagePurchaseOrders ? btnPrimary : btnDisabled}
            title={!canManagePurchaseOrders ? "You do not have permission to manage purchase orders." : ""}
          >
            Manage Purchase Orders
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

          <div style={fieldStyle}>
            <div style={labelStyle}>Filter by Supplier</div>
            <select
              value={selectedSupplier}
              onChange={(e) => setSelectedSupplier(e.target.value)}
              style={{ ...selectStyle, minWidth: 380 }}
            >
              <option value="all">All</option>
              {orderedCompanies.map((c) => (
                <option key={c.shortName} value={c.shortName}>
                  {companyLabel(c)}
                </option>
              ))}
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
              <th style={thStyle}>Supplier</th>
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
                <td style={tdStyle}>{s.supplierName || s.supplierId || "—"}</td>
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
                <td colSpan={4} style={{ ...tdStyle, textAlign: "center", color: "#64748b" }}>
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
          companies={companies}
          containers={containers}
          originPorts={originPorts}
          destinationPorts={destinationPorts}
          bookingAgents={bookingAgents}
          deliveryAddresses={deliveryAddresses}
          purchaseOrders={purchaseOrders}
          canEdit={canCreateShipment}
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
