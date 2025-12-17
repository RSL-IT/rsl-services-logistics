// app/logistics-ui/components/NewShipmentModal.tsx
import React, { useMemo, useState, useEffect } from "react";
import {
  X,
  Factory,
  Box,
  Anchor,
  MapPin,
  CalendarDays,
  Truck,
  FileText,
  Hash,
} from "lucide-react";
import type { Shipment } from "../LogisticsApp";

export type CompanyOption = { shortName: string; displayName?: string | null };
export type LookupOption = { shortName: string; displayName?: string | null };

export type UIShipment = Shipment & {
  cargoReadyDate?: string; // YYYY-MM-DD
  estimatedDeliveryToOrigin?: string; // YYYY-MM-DD
  supplierPi?: string;
  quantity?: string; // BigInt in DB; keep as string in UI
  bookingNumber?: string;
  notes?: string;
};

interface NewShipmentModalProps {
  shipment: UIShipment;

  companies?: CompanyOption[];
  containers?: LookupOption[];

  // IMPORTANT: these should be fetched from tlkp_originPort and tlkp_destinationPort
  originPorts?: LookupOption[];
  destinationPorts?: LookupOption[];

  onClose: () => void;
  onCreate: (shipment: UIShipment) => void;

  isSaving?: boolean;
  error?: string | null;
}

function sortCompaniesSpecial(companies: CompanyOption[]) {
  const list = companies.slice();
  const norm = (v: any) => String(v || "").trim().toLowerCase();

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

function labelOpt(o: { shortName: string; displayName?: string | null }) {
  const d = String(o.displayName ?? "").trim();
  return d ? `${o.shortName} — ${d}` : o.shortName;
}

function sortLookupByLabel(list: LookupOption[]) {
  return (list || []).slice().sort((a, b) => {
    const al = labelOpt(a).toLowerCase();
    const bl = labelOpt(b).toLowerCase();
    return al.localeCompare(bl);
  });
}

const overlayStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.45)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 50,
  padding: 16,
};

const modalStyle: React.CSSProperties = {
  width: "100%",
  maxWidth: 980,
  background: "#fff",
  borderRadius: 16,
  overflow: "hidden",
  boxShadow: "0 30px 80px rgba(15,23,42,0.25)",
  display: "flex",
  flexDirection: "column",
  maxHeight: "90vh",
};

const headerStyle: React.CSSProperties = {
  background: "#2563eb",
  color: "#fff",
  padding: "14px 18px",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
};

const bodyStyle: React.CSSProperties = { padding: 18, overflowY: "auto" };

const sectionTitleStyle: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 650,
  color: "#0f172a",
  marginBottom: 10,
};

const gridStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
  gap: 12,
};

const fieldLabelStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: "#64748b",
  marginBottom: 6,
};

const inputWrapStyle: React.CSSProperties = { position: "relative" };

const iconStyle: React.CSSProperties = {
  position: "absolute",
  left: 10,
  top: "50%",
  transform: "translateY(-50%)",
  color: "#94a3b8",
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px 10px 10px 34px",
  borderRadius: 10,
  border: "1px solid #d1d5db",
  fontSize: 13,
  outline: "none",
};

const selectStyle: React.CSSProperties = {
  ...inputStyle,
  background: "#fff",
};

const textareaStyle: React.CSSProperties = {
  width: "100%",
  borderRadius: 10,
  border: "1px solid #d1d5db",
  fontSize: 13,
  outline: "none",
  padding: 10,
  minHeight: 90,
  resize: "vertical",
};

const footerStyle: React.CSSProperties = {
  borderTop: "1px solid #e5e7eb",
  background: "#f8fafc",
  padding: "12px 18px",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 10,
};

const btnStyle: React.CSSProperties = {
  borderRadius: 10,
  padding: "10px 14px",
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
  border: "1px solid transparent",
};

const errorBoxStyle: React.CSSProperties = {
  background: "#fef2f2",
  border: "1px solid #fecaca",
  color: "#991b1b",
  borderRadius: 12,
  padding: "10px 12px",
  fontSize: 12,
  marginBottom: 12,
};

export default function NewShipmentModal({
                                           shipment,
                                           companies = [],
                                           containers = [],
                                           originPorts = [],
                                           destinationPorts = [],
                                           onClose,
                                           onCreate,
                                           isSaving = false,
                                           error = null,
                                         }: NewShipmentModalProps) {
  const [form, setForm] = useState<UIShipment>(shipment);

  useEffect(() => setForm(shipment), [shipment]);

  const orderedCompanies = useMemo(
    () => sortCompaniesSpecial(Array.isArray(companies) ? companies : []),
    [companies]
  );

  // IMPORTANT: originPorts is the tlkp_originPort list
  const orderedOriginPorts = useMemo(
    () => sortLookupByLabel(Array.isArray(originPorts) ? originPorts : []),
    [originPorts]
  );

  const orderedDestinationPorts = useMemo(
    () => sortLookupByLabel(Array.isArray(destinationPorts) ? destinationPorts : []),
    [destinationPorts]
  );

  const canCreate = useMemo(() => {
    const supplierId = String(form.supplierId || "").trim();
    const containerNumber = String(form.containerNumber || "").trim();
    return !!supplierId && !!containerNumber;
  }, [form.supplierId, form.containerNumber]);

  return (
    <div style={overlayStyle} role="dialog" aria-modal="true">
      <div style={modalStyle}>
        <div style={headerStyle}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Truck size={20} />
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <div style={{ fontSize: 14, fontWeight: 750 }}>Create Shipment</div>
              <div style={{ fontSize: 12, opacity: 0.9 }}>Add a new shipment record</div>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            style={{
              ...btnStyle,
              padding: "8px 10px",
              background: "rgba(255,255,255,0.12)",
              color: "#fff",
            }}
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        <div style={bodyStyle}>
          {error ? <div style={errorBoxStyle}>{error}</div> : null}

          <section style={{ marginBottom: 18 }}>
            <div style={sectionTitleStyle}>Shipment</div>

            <div style={gridStyle}>
              {/* Supplier */}
              <div>
                <div style={fieldLabelStyle}>Supplier</div>
                <div style={inputWrapStyle}>
                  <span style={iconStyle}>
                    <Factory size={16} />
                  </span>
                  <select
                    value={String(form.supplierId || "")}
                    onChange={(e) => {
                      const supplierId = e.target.value || "";
                      const found = orderedCompanies.find((c) => c.shortName === supplierId);
                      const supplierName =
                        (found?.displayName && String(found.displayName).trim()) || supplierId;

                      setForm((p) => ({ ...p, supplierId, supplierName }));
                    }}
                    style={selectStyle}
                    disabled={isSaving}
                  >
                    <option value="">
                      {orderedCompanies.length ? "Select supplier…" : "No companies loaded"}
                    </option>
                    {orderedCompanies.map((c) => (
                      <option key={c.shortName} value={c.shortName}>
                        {labelOpt(c)}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Container # */}
              <div>
                <div style={fieldLabelStyle}>Container #</div>
                <div style={inputWrapStyle}>
                  <span style={iconStyle}>
                    <Box size={16} />
                  </span>
                  <input
                    value={String(form.containerNumber || "")}
                    onChange={(e) =>
                      setForm((p) => ({ ...p, containerNumber: e.target.value.toUpperCase() }))
                    }
                    style={inputStyle}
                    disabled={isSaving}
                    placeholder="e.g. MSCU1234567"
                  />
                </div>
              </div>

              {/* Booking Number */}
              <div>
                <div style={fieldLabelStyle}>Booking Number</div>
                <div style={inputWrapStyle}>
                  <span style={iconStyle}>
                    <Hash size={16} />
                  </span>
                  <input
                    value={String(form.bookingNumber || "")}
                    onChange={(e) => setForm((p) => ({ ...p, bookingNumber: e.target.value }))}
                    style={inputStyle}
                    disabled={isSaving}
                    placeholder="Booking #"
                  />
                </div>
              </div>

              {/* Supplier PI */}
              <div>
                <div style={fieldLabelStyle}>Supplier PI</div>
                <div style={inputWrapStyle}>
                  <span style={iconStyle}>
                    <FileText size={16} />
                  </span>
                  <input
                    value={String(form.supplierPi || "")}
                    onChange={(e) => setForm((p) => ({ ...p, supplierPi: e.target.value }))}
                    style={inputStyle}
                    disabled={isSaving}
                    placeholder="Supplier PI"
                  />
                </div>
              </div>

              {/* Quantity */}
              <div>
                <div style={fieldLabelStyle}>Quantity</div>
                <div style={inputWrapStyle}>
                  <span style={iconStyle}>
                    <Box size={16} />
                  </span>
                  <input
                    value={String(form.quantity || "")}
                    onChange={(e) => setForm((p) => ({ ...p, quantity: e.target.value }))}
                    style={inputStyle}
                    disabled={isSaving}
                    placeholder="(integer)"
                  />
                </div>
              </div>

              {/* Container Size */}
              <div>
                <div style={fieldLabelStyle}>Container Size</div>
                <div style={inputWrapStyle}>
                  <span style={iconStyle}>
                    <Box size={16} />
                  </span>
                  <select
                    value={String(form.containerSize || "")}
                    onChange={(e) => setForm((p) => ({ ...p, containerSize: e.target.value }))}
                    style={selectStyle}
                    disabled={isSaving}
                  >
                    <option value="">—</option>
                    {containers.map((c) => (
                      <option key={c.shortName} value={c.shortName}>
                        {labelOpt(c)}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Port of Origin (from tlkp_originPort) */}
              <div>
                <div style={fieldLabelStyle}>Port of Origin</div>
                <div style={inputWrapStyle}>
                  <span style={iconStyle}>
                    <Anchor size={16} />
                  </span>
                  <select
                    value={String(form.portOfOrigin || "")}
                    onChange={(e) => setForm((p) => ({ ...p, portOfOrigin: e.target.value }))}
                    style={selectStyle}
                    disabled={isSaving}
                  >
                    <option value="">
                      {orderedOriginPorts.length ? "Select origin port…" : "No origin ports loaded"}
                    </option>
                    {orderedOriginPorts.map((p) => (
                      <option key={p.shortName} value={p.shortName}>
                        {labelOpt(p)}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Destination Port (from tlkp_destinationPort) */}
              <div>
                <div style={fieldLabelStyle}>Destination Port</div>
                <div style={inputWrapStyle}>
                  <span style={iconStyle}>
                    <MapPin size={16} />
                  </span>
                  <select
                    value={String(form.destinationPort || "")}
                    onChange={(e) => setForm((p) => ({ ...p, destinationPort: e.target.value }))}
                    style={selectStyle}
                    disabled={isSaving}
                  >
                    <option value="">
                      {orderedDestinationPorts.length
                        ? "Select destination port…"
                        : "No destination ports loaded"}
                    </option>
                    {orderedDestinationPorts.map((p) => (
                      <option key={p.shortName} value={p.shortName}>
                        {labelOpt(p)}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Cargo Ready Date */}
              <div>
                <div style={fieldLabelStyle}>Cargo Ready Date</div>
                <div style={inputWrapStyle}>
                  <span style={iconStyle}>
                    <CalendarDays size={16} />
                  </span>
                  <input
                    type="date"
                    value={String(form.cargoReadyDate || "")}
                    onChange={(e) => setForm((p) => ({ ...p, cargoReadyDate: e.target.value }))}
                    style={inputStyle}
                    disabled={isSaving}
                  />
                </div>
              </div>

              {/* Est. Delivery To Origin */}
              <div>
                <div style={fieldLabelStyle}>Est. Delivery To Origin</div>
                <div style={inputWrapStyle}>
                  <span style={iconStyle}>
                    <CalendarDays size={16} />
                  </span>
                  <input
                    type="date"
                    value={String(form.estimatedDeliveryToOrigin || "")}
                    onChange={(e) =>
                      setForm((p) => ({ ...p, estimatedDeliveryToOrigin: e.target.value }))
                    }
                    style={inputStyle}
                    disabled={isSaving}
                  />
                </div>
              </div>

              {/* ETA */}
              <div>
                <div style={fieldLabelStyle}>ETA</div>
                <div style={inputWrapStyle}>
                  <span style={iconStyle}>
                    <CalendarDays size={16} />
                  </span>
                  <input
                    type="date"
                    value={String(form.eta || "")}
                    onChange={(e) => setForm((p) => ({ ...p, eta: e.target.value }))}
                    style={inputStyle}
                    disabled={isSaving}
                  />
                </div>
              </div>

              {/* Status */}
              <div>
                <div style={fieldLabelStyle}>Status</div>
                <div style={inputWrapStyle}>
                  <span style={iconStyle}>
                    <Truck size={16} />
                  </span>
                  <select
                    value={String(form.status || "")}
                    onChange={(e) => setForm((p) => ({ ...p, status: e.target.value }))}
                    style={selectStyle}
                    disabled={isSaving}
                  >
                    <option value="">—</option>
                    <option value="Pending">Pending</option>
                    <option value="In Transit">In Transit</option>
                    <option value="Arrived">Arrived</option>
                    <option value="Delivered">Delivered</option>
                  </select>
                </div>
              </div>

              {/* Notes */}
              <div style={{ gridColumn: "1 / -1" }}>
                <div style={fieldLabelStyle}>Notes</div>
                <textarea
                  value={String(form.notes || "")}
                  onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))}
                  style={textareaStyle}
                  disabled={isSaving}
                  placeholder="Internal notes…"
                />
              </div>
            </div>
          </section>
        </div>

        <div style={footerStyle}>
          <button
            type="button"
            onClick={onClose}
            disabled={isSaving}
            style={{
              ...btnStyle,
              background: "#fff",
              borderColor: "#d1d5db",
              color: "#0f172a",
            }}
          >
            Close
          </button>

          <button
            type="button"
            onClick={() => onCreate(form)}
            disabled={isSaving || !canCreate}
            style={{
              ...btnStyle,
              background: isSaving || !canCreate ? "#93c5fd" : "#2563eb",
              color: "#fff",
            }}
          >
            {isSaving ? "Creating…" : "Create Shipment"}
          </button>
        </div>
      </div>
    </div>
  );
}
