// app/logistics-ui/components/ShipmentDetailsModal.tsx
import React, { useMemo, useState } from "react";
import type { CompanyOption, LookupOption } from "../LogisticsApp";
import type { PurchaseOrderOption, Shipment } from "./InternalDashboard";

type SaveMode = "create" | "update";

interface ShipmentDetailsModalProps {
  shipment: Shipment;

  companies: CompanyOption[];
  containers: LookupOption[];
  originPorts: LookupOption[];
  destinationPorts: LookupOption[];

  bookingAgents: LookupOption[];
  deliveryAddresses: LookupOption[];
  purchaseOrders: PurchaseOrderOption[];

  canEdit?: boolean;

  isSaving?: boolean;
  error?: string | null;

  onClose: () => void;
  onSave: (mode: SaveMode, shipment: Shipment) => void;
  onDelete: (shipment: Shipment) => void;
}

const overlayStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(15, 23, 42, 0.55)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 18,
  zIndex: 9999,
};

const modalStyle: React.CSSProperties = {
  width: "min(1040px, 100%)",
  background: "#fff",
  borderRadius: 16,
  boxShadow: "0 30px 80px rgba(15,23,42,0.25)",
  overflow: "hidden",
  // Keep the modal within the viewport so actions are always reachable.
  maxHeight: "calc(100vh - 36px)",
  display: "flex",
  flexDirection: "column",
};

const headerStyle: React.CSSProperties = {
  padding: "14px 16px",
  background: "#0f172a",
  color: "#fff",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
};

const headerTitleStyle: React.CSSProperties = {
  fontSize: 16,
  fontWeight: 900,
};

const headerSubStyle: React.CSSProperties = {
  fontSize: 12,
  opacity: 0.9,
  marginTop: 3,
};

const bodyStyle: React.CSSProperties = {
  padding: 16,
  background: "#f8fafc",
  // Scroll the content area (header stays fixed).
  overflowY: "auto",
  flex: 1,
  minHeight: 0,
};

const cardStyle: React.CSSProperties = {
  background: "#fff",
  border: "1px solid #e5e7eb",
  borderRadius: 14,
  boxShadow: "0 10px 24px rgba(15,23,42,0.06)",
  padding: 14,
};

const sectionTitleStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 900,
  color: "#0f172a",
  letterSpacing: 0.25,
  marginBottom: 10,
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
};

const gridStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(12, 1fr)",
  gap: 12,
};

const fieldStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
};

const labelStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 800,
  color: "#475569",
};

const inputStyle: React.CSSProperties = {
  borderRadius: 10,
  border: "1px solid #d1d5db",
  padding: "10px 10px",
  fontSize: 13,
  background: "#fff",
  outline: "none",
};

const disabledStyle: React.CSSProperties = {
  ...inputStyle,
  background: "#f1f5f9",
  color: "#64748b",
};

const selectStyle: React.CSSProperties = inputStyle;

const btnBase: React.CSSProperties = {
  borderRadius: 10,
  padding: "10px 12px",
  fontSize: 13,
  fontWeight: 800,
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

const btnMuted: React.CSSProperties = {
  ...btnBase,
  background: "#e2e8f0",
  color: "#0f172a",
};

const btnDisabled: React.CSSProperties = {
  ...btnBase,
  background: "#cbd5e1",
  color: "#475569",
  cursor: "not-allowed",
};

const errorStyle: React.CSSProperties = {
  background: "#fee2e2",
  border: "1px solid #fecaca",
  color: "#991b1b",
  padding: "10px 12px",
  borderRadius: 12,
  fontSize: 13,
  fontWeight: 700,
  marginBottom: 12,
};

function norm(s: unknown) {
  return String(s ?? "").trim();
}

function companyLabel(c: CompanyOption) {
  const d = String(c.displayName ?? "").trim();
  return d ? `${c.shortName} — ${d}` : c.shortName;
}

export default function ShipmentDetailsModal({
                                               shipment,
                                               companies,
                                               containers,
                                               originPorts,
                                               destinationPorts,
                                               bookingAgents,
                                               deliveryAddresses,
                                               purchaseOrders,
                                               canEdit = true,
                                               isSaving = false,
                                               error = null,
                                               onClose,
                                               onSave,
                                               onDelete,
                                             }: ShipmentDetailsModalProps) {
  const isCreate = String(shipment.id) === "new";
  const mode: SaveMode = isCreate ? "create" : "update";
  const canChangeContainerNumber = isCreate; // do NOT change containerNumber on update

  const companiesSafe = Array.isArray(companies) ? companies : [];
  const containersSafe = Array.isArray(containers) ? containers : [];
  const originPortsSafe = Array.isArray(originPorts) ? originPorts : [];
  const destinationPortsSafe = Array.isArray(destinationPorts) ? destinationPorts : [];
  const bookingAgentsSafe = Array.isArray(bookingAgents) ? bookingAgents : [];
  const deliveryAddressesSafe = Array.isArray(deliveryAddresses) ? deliveryAddresses : [];
  const purchaseOrdersSafe = Array.isArray(purchaseOrders) ? purchaseOrders : [];

  const initialPoGids = useMemo<string[]>(
    () => (Array.isArray((shipment as any).purchaseOrderGIDs) ? (shipment as any).purchaseOrderGIDs : []),
    [shipment]
  );

  // Local draft state (strings for inputs)
  const [draft, setDraft] = useState(() => {
    const supplierId = norm((shipment as any).supplierId);
    const supplierName = norm((shipment as any).supplierName);

    return {
      supplierId,
      supplierName,

      status: norm((shipment as any).status) || "Pending",

      containerNumber: norm((shipment as any).containerNumber),
      containerSize: norm((shipment as any).containerSize),
      portOfOrigin: norm((shipment as any).portOfOrigin),
      destinationPort: norm((shipment as any).destinationPort),

      cargoReadyDate: norm((shipment as any).cargoReadyDate),
      etd: norm((shipment as any).etd),
      eta: norm((shipment as any).eta),
      estimatedDeliveryToOrigin: norm((shipment as any).estimatedDeliveryToOrigin),

      supplierPi: norm((shipment as any).supplierPi),
      quantity: norm((shipment as any).quantity), // keep as string for UI
      notes: norm((shipment as any).notes),

      bookingAgent: norm((shipment as any).bookingAgent),
      bookingNumber: norm((shipment as any).bookingNumber),
      vesselName: norm((shipment as any).vesselName),
      deliveryAddress: norm((shipment as any).deliveryAddress),

      purchaseOrderGIDs: Array.isArray(initialPoGids) ? [...initialPoGids] : [],
    };
  });

  const title = isCreate ? "Create Shipment" : "Shipment Details";
  const subtitle = isCreate ? "New shipment" : `ID: ${String(shipment.id)}`;

  const handleCancel = () => {
    if (isSaving) return;
    const ok = window.confirm("Cancel without saving? Your changes will be lost.");
    if (ok) onClose();
  };

  const setField = (k: keyof typeof draft, v: string | string[]) => {
    setDraft((prev) => ({ ...prev, [k]: v } as any));
  };

  const supplierDisplay = useMemo(() => {
    const found = companiesSafe.find((c) => c.shortName === draft.supplierId);
    if (!found) return draft.supplierId || "—";
    return companyLabel(found);
  }, [companiesSafe, draft.supplierId]);

  const togglePo = (gid: string) => {
    setDraft((prev) => {
      const current = Array.isArray(prev.purchaseOrderGIDs) ? prev.purchaseOrderGIDs : [];
      const exists = current.includes(gid);
      const next = exists ? current.filter((x: string) => x !== gid) : [...current, gid];
      return { ...prev, purchaseOrderGIDs: next };
    });
  };

  const handleSave = () => {
    // derive supplierName from company list when possible
    const company = companiesSafe.find((c) => c.shortName === draft.supplierId);
    const derivedSupplierName =
      (company?.displayName && String(company.displayName).trim()) || draft.supplierId || draft.supplierName;

    const next: Shipment = {
      ...(shipment as any),

      supplierId: draft.supplierId,
      supplierName: derivedSupplierName,

      status: draft.status,

      containerNumber: draft.containerNumber,
      containerSize: draft.containerSize,
      portOfOrigin: draft.portOfOrigin,
      destinationPort: draft.destinationPort,

      cargoReadyDate: draft.cargoReadyDate,
      etd: draft.etd,
      eta: draft.eta,
      estimatedDeliveryToOrigin: draft.estimatedDeliveryToOrigin,

      supplierPi: draft.supplierPi,
      quantity: draft.quantity, // string; server parses BigInt
      notes: draft.notes,

      bookingAgent: draft.bookingAgent,
      bookingNumber: draft.bookingNumber,
      vesselName: draft.vesselName,
      deliveryAddress: draft.deliveryAddress,

      purchaseOrderGIDs: Array.isArray(draft.purchaseOrderGIDs) ? draft.purchaseOrderGIDs : [],
    } as Shipment;

    onSave(mode, next);
  };

  return (
    <div style={overlayStyle} role="dialog" aria-modal="true">
      <div style={modalStyle}>
        <div style={headerStyle}>
          <div>
            <div style={headerTitleStyle}>{title}</div>
            <div style={headerSubStyle}>
              {subtitle} • Supplier: <b>{supplierDisplay}</b>
            </div>
          </div>

          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            {!isCreate ? (
              <button
                type="button"
                onClick={() => onDelete(shipment)}
                disabled={!canEdit || isSaving}
                style={!canEdit || isSaving ? btnDisabled : btnDanger}
                title={!canEdit ? "You do not have permission to delete shipments." : ""}
              >
                Delete
              </button>
            ) : null}

            <button
              type="button"
              onClick={handleCancel}
              disabled={isSaving}
              style={isSaving ? btnDisabled : btnMuted}
            >
              Cancel
            </button>

            <button
              type="button"
              onClick={handleSave}
              disabled={!canEdit || isSaving}
              style={!canEdit || isSaving ? btnDisabled : btnPrimary}
              title={!canEdit ? "You do not have permission to create/update shipments." : ""}
            >
              {isSaving ? "Saving…" : "Submit"}
            </button>
          </div>
        </div>

        <div style={bodyStyle}>
          {error ? <div style={errorStyle}>{error}</div> : null}

          {/* Basics */}
          <div style={{ ...cardStyle, marginBottom: 12 }}>
            <div style={sectionTitleStyle}>Basics</div>

            <div style={gridStyle}>
              {/* Supplier */}
              <div style={{ ...fieldStyle, gridColumn: "span 4" }}>
                <div style={labelStyle}>Supplier</div>
                <select
                  value={draft.supplierId}
                  onChange={(e) => setField("supplierId", e.target.value)}
                  style={canEdit ? selectStyle : disabledStyle}
                  disabled={!canEdit}
                >
                  <option value="">Select…</option>
                  {companiesSafe.map((c: CompanyOption) => (
                    <option key={c.shortName} value={c.shortName}>
                      {companyLabel(c)}
                    </option>
                  ))}
                </select>
              </div>

              {/* Status */}
              <div style={{ ...fieldStyle, gridColumn: "span 4" }}>
                <div style={labelStyle}>Status</div>
                <select
                  value={draft.status}
                  onChange={(e) => setField("status", e.target.value)}
                  style={canEdit ? selectStyle : disabledStyle}
                  disabled={!canEdit}
                >
                  <option value="Pending">Pending</option>
                  <option value="In Transit">In Transit</option>
                  <option value="Arrived">Arrived</option>
                  <option value="Delivered">Delivered</option>
                </select>
              </div>

              {/* Container # */}
              <div style={{ ...fieldStyle, gridColumn: "span 4" }}>
                <div style={labelStyle}>Container #</div>
                <input
                  value={draft.containerNumber}
                  onChange={(e) => setField("containerNumber", e.target.value.toUpperCase())}
                  style={canEdit && canChangeContainerNumber ? inputStyle : disabledStyle}
                  disabled={!canEdit || !canChangeContainerNumber}
                  placeholder="e.g. MSCU1234567"
                />
              </div>

              {/* Container Size */}
              <div style={{ ...fieldStyle, gridColumn: "span 4" }}>
                <div style={labelStyle}>Container Size</div>
                <select
                  value={draft.containerSize}
                  onChange={(e) => setField("containerSize", e.target.value)}
                  style={canEdit ? selectStyle : disabledStyle}
                  disabled={!canEdit}
                >
                  <option value="">—</option>
                  {containersSafe.map((o: LookupOption) => (
                    <option key={o.shortName} value={o.shortName}>
                      {o.displayName ? `${o.shortName} — ${o.displayName}` : o.shortName}
                    </option>
                  ))}
                </select>
              </div>

              {/* PO Origin */}
              <div style={{ ...fieldStyle, gridColumn: "span 4" }}>
                <div style={labelStyle}>Port of Origin</div>
                <select
                  value={draft.portOfOrigin}
                  onChange={(e) => setField("portOfOrigin", e.target.value)}
                  style={canEdit ? selectStyle : disabledStyle}
                  disabled={!canEdit}
                >
                  <option value="">—</option>
                  {originPortsSafe.map((o: LookupOption) => (
                    <option key={o.shortName} value={o.shortName}>
                      {o.displayName ? `${o.shortName} — ${o.displayName}` : o.shortName}
                    </option>
                  ))}
                </select>
              </div>

              {/* Destination Port */}
              <div style={{ ...fieldStyle, gridColumn: "span 4" }}>
                <div style={labelStyle}>Destination Port</div>
                <select
                  value={draft.destinationPort}
                  onChange={(e) => setField("destinationPort", e.target.value)}
                  style={canEdit ? selectStyle : disabledStyle}
                  disabled={!canEdit}
                >
                  <option value="">—</option>
                  {destinationPortsSafe.map((o: LookupOption) => (
                    <option key={o.shortName} value={o.shortName}>
                      {o.displayName ? `${o.shortName} — ${o.displayName}` : o.shortName}
                    </option>
                  ))}
                </select>
              </div>

              {/* Supplier PI */}
              <div style={{ ...fieldStyle, gridColumn: "span 4" }}>
                <div style={labelStyle}>Supplier PI</div>
                <input
                  value={draft.supplierPi}
                  onChange={(e) => setField("supplierPi", e.target.value)}
                  style={canEdit ? inputStyle : disabledStyle}
                  disabled={!canEdit}
                  placeholder="optional"
                />
              </div>

              {/* Quantity */}
              <div style={{ ...fieldStyle, gridColumn: "span 4" }}>
                <div style={labelStyle}>Quantity</div>
                <input
                  value={draft.quantity}
                  onChange={(e) => setField("quantity", e.target.value)}
                  style={canEdit ? inputStyle : disabledStyle}
                  disabled={!canEdit}
                  inputMode="numeric"
                  placeholder="whole number"
                />
              </div>
            </div>
          </div>

          {/* Purchase Orders */}
          <div style={{ ...cardStyle, marginBottom: 12 }}>
            <div style={sectionTitleStyle}>
              <span>Purchase Orders</span>
              <span style={{ fontSize: 12, color: "#64748b", fontWeight: 800 }}>
                {Array.isArray(draft.purchaseOrderGIDs) ? draft.purchaseOrderGIDs.length : 0} selected
              </span>
            </div>

            {purchaseOrdersSafe.length === 0 ? (
              <div style={{ fontSize: 13, color: "#64748b", fontWeight: 700 }}>
                No purchase orders available.
              </div>
            ) : (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
                  gap: 10,
                }}
              >
                {purchaseOrdersSafe.map((po: PurchaseOrderOption) => {
                  const checked =
                    Array.isArray(draft.purchaseOrderGIDs) && draft.purchaseOrderGIDs.includes(po.purchaseOrderGID);
                  return (
                    <label
                      key={po.purchaseOrderGID}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        background: "#f8fafc",
                        border: "1px solid #e5e7eb",
                        borderRadius: 12,
                        padding: "10px 10px",
                        cursor: canEdit ? "pointer" : "default",
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={!canEdit}
                        onChange={() => togglePo(po.purchaseOrderGID)}
                      />
                      <span style={{ fontSize: 13, fontWeight: 800, color: "#0f172a" }}>
                        {po.shortName}
                      </span>
                    </label>
                  );
                })}
              </div>
            )}
          </div>

          {/* Dates */}
          <div style={{ ...cardStyle, marginBottom: 12 }}>
            <div style={sectionTitleStyle}>Dates</div>

            <div style={gridStyle}>
              <div style={{ ...fieldStyle, gridColumn: "span 3" }}>
                <div style={labelStyle}>Cargo-ready Date</div>
                <input
                  type="date"
                  value={draft.cargoReadyDate}
                  onChange={(e) => setField("cargoReadyDate", e.target.value)}
                  style={canEdit ? inputStyle : disabledStyle}
                  disabled={!canEdit}
                />
              </div>

              <div style={{ ...fieldStyle, gridColumn: "span 3" }}>
                <div style={labelStyle}>ETD</div>
                <input
                  type="date"
                  value={draft.etd}
                  onChange={(e) => setField("etd", e.target.value)}
                  style={canEdit ? inputStyle : disabledStyle}
                  disabled={!canEdit}
                />
              </div>

              <div style={{ ...fieldStyle, gridColumn: "span 3" }}>
                <div style={labelStyle}>ETA</div>
                <input
                  type="date"
                  value={draft.eta}
                  onChange={(e) => setField("eta", e.target.value)}
                  style={canEdit ? inputStyle : disabledStyle}
                  disabled={!canEdit}
                />
              </div>

              <div style={{ ...fieldStyle, gridColumn: "span 3" }}>
                <div style={labelStyle}>Est. Delivery to Origin</div>
                <input
                  type="date"
                  value={draft.estimatedDeliveryToOrigin}
                  onChange={(e) => setField("estimatedDeliveryToOrigin", e.target.value)}
                  style={canEdit ? inputStyle : disabledStyle}
                  disabled={!canEdit}
                />
              </div>
            </div>
          </div>

          {/* Booking (moved BELOW Dates as requested) */}
          <div style={{ ...cardStyle, marginBottom: 12 }}>
            <div style={sectionTitleStyle}>Booking</div>

            <div style={gridStyle}>
              <div style={{ ...fieldStyle, gridColumn: "span 4" }}>
                <div style={labelStyle}>Booking Agent</div>
                <select
                  value={draft.bookingAgent}
                  onChange={(e) => setField("bookingAgent", e.target.value)}
                  style={canEdit ? selectStyle : disabledStyle}
                  disabled={!canEdit}
                >
                  <option value="">—</option>
                  {bookingAgentsSafe.map((o: LookupOption) => (
                    <option key={o.shortName} value={o.shortName}>
                      {o.displayName ? `${o.shortName} — ${o.displayName}` : o.shortName}
                    </option>
                  ))}
                </select>
              </div>

              <div style={{ ...fieldStyle, gridColumn: "span 4" }}>
                <div style={labelStyle}>Booking #</div>
                <input
                  value={draft.bookingNumber}
                  onChange={(e) => setField("bookingNumber", e.target.value)}
                  style={canEdit ? inputStyle : disabledStyle}
                  disabled={!canEdit}
                  placeholder="Enter the booking number"
                />
              </div>

              <div style={{ ...fieldStyle, gridColumn: "span 4" }}>
                <div style={labelStyle}>Vessel Name</div>
                <input
                  value={draft.vesselName}
                  onChange={(e) => setField("vesselName", e.target.value)}
                  style={canEdit ? inputStyle : disabledStyle}
                  disabled={!canEdit}
                  placeholder="Name of the vessel carrying this shipment"
                />
              </div>

              <div style={{ ...fieldStyle, gridColumn: "span 6" }}>
                <div style={labelStyle}>Delivery Address</div>
                <select
                  value={draft.deliveryAddress}
                  onChange={(e) => setField("deliveryAddress", e.target.value)}
                  style={canEdit ? selectStyle : disabledStyle}
                  disabled={!canEdit}
                >
                  <option value="">—</option>
                  {deliveryAddressesSafe.map((o: LookupOption) => (
                    <option key={o.shortName} value={o.shortName}>
                      {o.displayName ? `${o.shortName} — ${o.displayName}` : o.shortName}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Notes */}
          <div style={cardStyle}>
            <div style={sectionTitleStyle}>Notes</div>
            <textarea
              value={draft.notes}
              onChange={(e) => setField("notes", e.target.value)}
              style={{
                ...((canEdit ? inputStyle : disabledStyle) as any),
                minHeight: 110,
                resize: "vertical",
                fontFamily: "inherit",
              }}
              disabled={!canEdit}
              placeholder="internal notes…"
            />
          </div>
        </div>

      </div>
    </div>
  );
}
