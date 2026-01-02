// app/logistics-ui/components/ShipmentDetailsModal.tsx
import React, { useMemo, useState } from "react";
import type { Shipment } from "../LogisticsApp";
import type { CompanyOption, LookupOption, PurchaseOrderOption, PurchaseOrderProduct } from "./types";

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

  // Is the current user a supplier? If true, supplier field is always read-only
  isSupplier?: boolean;

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
                                               isSupplier = false,
                                               isSaving = false,
                                               error = null,
                                               onClose,
                                               onSave,
                                               onDelete,
                                             }: ShipmentDetailsModalProps) {
  const isCreate = String(shipment.id) === "new";
  const mode: SaveMode = isCreate ? "create" : "update";

  const companiesSafe = Array.isArray(companies) ? companies : [];
  const containersSafe = Array.isArray(containers) ? containers : [];
  const originPortsSafe = Array.isArray(originPorts) ? originPorts : [];
  const destinationPortsSafe = Array.isArray(destinationPorts) ? destinationPorts : [];
  const bookingAgentsSafe = Array.isArray(bookingAgents) ? bookingAgents : [];
  const deliveryAddressesSafe = Array.isArray(deliveryAddresses) ? deliveryAddresses : [];
  const purchaseOrdersSafe = Array.isArray(purchaseOrders) ? purchaseOrders : [];

  // Track previous supplier to detect changes
  const prevSupplierIdRef = React.useRef<string | null>(null);

  const initialPoGids = useMemo<string[]>(
    () => (Array.isArray((shipment as any).purchaseOrderGIDs) ? (shipment as any).purchaseOrderGIDs : []),
    [shipment]
  );

  // Local draft state (strings for inputs)
  const [draft, setDraft] = useState(() => {
    const supplierId = norm((shipment as any).supplierId);
    const supplierName = norm((shipment as any).supplierName);
    const isNewShipment = String(shipment.id) === "new";

    return {
      supplierId,
      supplierName,

      status: norm((shipment as any).status) || "Pending",

      containerNumber: norm((shipment as any).containerNumber),
      containerSize: norm((shipment as any).containerSize),
      portOfOrigin: norm((shipment as any).portOfOrigin),
      destinationPort: norm((shipment as any).destinationPort),

      cargoReadyDate: norm((shipment as any).cargoReadyDate),
      // ETD maps to estimatedDeliveryToOrigin in the database
      etd: norm((shipment as any).etd) || norm((shipment as any).estimatedDeliveryToOrigin),
      eta: norm((shipment as any).eta),
      estimatedDeliveryToOrigin: norm((shipment as any).estimatedDeliveryToOrigin),

      supplierPi: norm((shipment as any).supplierPi),
      quantity: norm((shipment as any).quantity), // keep as string for UI
      // For create mode, show any existing notes; for update mode, start empty (notes go to history)
      notes: isNewShipment ? norm((shipment as any).notes) : "",

      bookingAgent: norm((shipment as any).bookingAgent),
      bookingNumber: norm((shipment as any).bookingNumber),
      vesselName: norm((shipment as any).vesselName),
      deliveryAddress: norm((shipment as any).deliveryAddress),

      purchaseOrderGIDs: Array.isArray(initialPoGids) ? [...initialPoGids] : [],
    };
  });

  // Store initial values to detect changes
  const initialDraftRef = React.useRef({
    supplierId: norm((shipment as any).supplierId),
    status: norm((shipment as any).status) || "Pending",
    containerNumber: norm((shipment as any).containerNumber),
    containerSize: norm((shipment as any).containerSize),
    portOfOrigin: norm((shipment as any).portOfOrigin),
    destinationPort: norm((shipment as any).destinationPort),
    cargoReadyDate: norm((shipment as any).cargoReadyDate),
    etd: norm((shipment as any).etd) || norm((shipment as any).estimatedDeliveryToOrigin),
    eta: norm((shipment as any).eta),
    estimatedDeliveryToOrigin: norm((shipment as any).estimatedDeliveryToOrigin),
    supplierPi: norm((shipment as any).supplierPi),
    quantity: norm((shipment as any).quantity),
    notes: isCreate ? norm((shipment as any).notes) : "",
    bookingAgent: norm((shipment as any).bookingAgent),
    bookingNumber: norm((shipment as any).bookingNumber),
    vesselName: norm((shipment as any).vesselName),
    deliveryAddress: norm((shipment as any).deliveryAddress),
    purchaseOrderGIDs: Array.isArray(initialPoGids) ? [...initialPoGids] : [],
  });

  const initialProductQuantitiesRef = React.useRef<Record<string, string>>(() => {
    const saved = (shipment as any).productQuantities;
    if (saved && typeof saved === "object") {
      const result: Record<string, string> = {};
      for (const [key, val] of Object.entries(saved)) {
        result[key] = String(val ?? 0);
      }
      return result;
    }
    return {};
  });

  const title = isCreate ? "Create Shipment" : "Shipment Details";
  const subtitle = isCreate ? "New shipment" : `ID: ${String(shipment.id)}`;

  // Filter purchase orders by selected supplier (for both create and edit mode)
  const filteredPurchaseOrders = useMemo(() => {
    const selectedSupplier = draft.supplierId;
    if (!selectedSupplier) {
      // No supplier selected, show no POs
      return [];
    }

    // Filter to only POs belonging to the selected supplier
    return purchaseOrdersSafe.filter((po) => po.companyID === selectedSupplier);
  }, [draft.supplierId, purchaseOrdersSafe]);

  // When supplier changes in create mode, clear selected POs that don't belong to new supplier
  React.useEffect(() => {
    if (!isCreate) return;

    const currentSupplierId = draft.supplierId;
    const prevSupplierId = prevSupplierIdRef.current;

    // Update ref
    prevSupplierIdRef.current = currentSupplierId;

    // If supplier changed and we have selected POs, filter them
    if (prevSupplierId !== null && prevSupplierId !== currentSupplierId) {
      setDraft((prev) => {
        const validGids = new Set(
          purchaseOrdersSafe
            .filter((po) => po.companyID === currentSupplierId)
            .map((po) => po.purchaseOrderGID)
        );

        const filteredGids = (prev.purchaseOrderGIDs || []).filter((gid) => validGids.has(gid));

        // Only update if something changed
        if (filteredGids.length !== (prev.purchaseOrderGIDs || []).length) {
          return { ...prev, purchaseOrderGIDs: filteredGids };
        }
        return prev;
      });
    }
  }, [isCreate, draft.supplierId, purchaseOrdersSafe]);

  // Track quantities for each product (keyed by rslModelID)
  // Initialize from saved shipment product quantities if editing existing shipment
  const [productQuantities, setProductQuantities] = useState<Record<string, string>>(() => {
    const saved = (shipment as any).productQuantities;
    if (saved && typeof saved === "object") {
      const result: Record<string, string> = {};
      for (const [key, val] of Object.entries(saved)) {
        result[key] = String(val ?? 0);
      }
      return result;
    }
    return {};
  });

  // Aggregate products from all selected purchase orders
  const aggregatedProducts = useMemo(() => {
    const selectedGIDs = draft.purchaseOrderGIDs || [];
    if (selectedGIDs.length === 0) return [];

    // Build a map to aggregate products by rslModelID (summing quantities from multiple POs)
    const productMap = new Map<string, PurchaseOrderProduct & { quantity: number }>();

    for (const po of filteredPurchaseOrders) {
      if (!selectedGIDs.includes(po.purchaseOrderGID)) continue;

      const products = Array.isArray(po.products) ? po.products : [];

      for (const product of products) {
        const id = String(product.rslModelID || "").trim();
        if (!id) continue;

        const existingQuantity = productMap.get(id)?.quantity || 0;
        const productQuantity = typeof product.quantity === "number" ? product.quantity : 0;

        // Add or update the product (summing quantities if from multiple POs)
        productMap.set(id, {
          rslModelID: id,
          shortName: product.shortName || id,
          displayName: product.displayName || product.shortName || id,
          SKU: product.SKU || null,
          quantity: existingQuantity + productQuantity,
        });
      }
    }

    // Convert to sorted array
    return Array.from(productMap.values()).sort((a, b) =>
      (a.displayName || a.shortName || "").localeCompare(b.displayName || b.shortName || "")
    );
  }, [draft.purchaseOrderGIDs, draft.supplierId, filteredPurchaseOrders]);

  // Initialize product quantities from PO quantities when products change
  React.useEffect(() => {
    const newQuantities: Record<string, string> = {};
    for (const product of aggregatedProducts) {
      // Only set if not already set by user
      if (!(product.rslModelID in productQuantities)) {
        newQuantities[product.rslModelID] = String(product.quantity || 0);
      }
    }
    if (Object.keys(newQuantities).length > 0) {
      setProductQuantities((prev) => ({ ...prev, ...newQuantities }));
    }
  }, [aggregatedProducts]);

  // Update quantity for a specific product
  const updateProductQuantity = (productId: string, quantity: string) => {
    setProductQuantities((prev) => ({
      ...prev,
      [productId]: quantity,
    }));
  };

  // Detect if any data has changed from initial state
  const hasChanges = useMemo(() => {
    const initial = initialDraftRef.current;

    // Compare draft fields
    if (draft.supplierId !== initial.supplierId) return true;
    if (draft.status !== initial.status) return true;
    if (draft.containerNumber !== initial.containerNumber) return true;
    if (draft.containerSize !== initial.containerSize) return true;
    if (draft.portOfOrigin !== initial.portOfOrigin) return true;
    if (draft.destinationPort !== initial.destinationPort) return true;
    if (draft.cargoReadyDate !== initial.cargoReadyDate) return true;
    if (draft.etd !== initial.etd) return true;
    if (draft.eta !== initial.eta) return true;
    if (draft.estimatedDeliveryToOrigin !== initial.estimatedDeliveryToOrigin) return true;
    if (draft.supplierPi !== initial.supplierPi) return true;
    if (draft.bookingAgent !== initial.bookingAgent) return true;
    if (draft.bookingNumber !== initial.bookingNumber) return true;
    if (draft.vesselName !== initial.vesselName) return true;
    if (draft.deliveryAddress !== initial.deliveryAddress) return true;
    if (draft.notes !== initial.notes) return true;

    // Compare purchase order GIDs
    const draftGids = draft.purchaseOrderGIDs || [];
    const initialGids = initial.purchaseOrderGIDs || [];
    if (draftGids.length !== initialGids.length) return true;
    const sortedDraft = [...draftGids].sort();
    const sortedInitial = [...initialGids].sort();
    if (sortedDraft.some((gid, i) => gid !== sortedInitial[i])) return true;

    // Compare product quantities
    const initialPQ = typeof initialProductQuantitiesRef.current === "function"
      ? {}
      : (initialProductQuantitiesRef.current || {});
    const allKeys = new Set([...Object.keys(productQuantities), ...Object.keys(initialPQ)]);
    for (const key of allKeys) {
      if ((productQuantities[key] || "0") !== (initialPQ[key] || "0")) return true;
    }

    return false;
  }, [draft, productQuantities]);

  const handleCancel = () => {
    if (isSaving) return;
    // Only show confirm dialog if there are unsaved changes
    if (hasChanges) {
      const ok = window.confirm("Cancel without saving? Your changes will be lost.");
      if (ok) onClose();
    } else {
      onClose();
    }
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
      productQuantities: productQuantities,
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
              Supplier: <b>{supplierDisplay}</b>
            </div>
          </div>

          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            {!isCreate ? (
              <button
                type="button"
                onClick={() => {
                  const ok = window.confirm(
                    `Are you sure you want to delete this shipment (Container #${draft.containerNumber || shipment.id})? This action cannot be undone.`
                  );
                  if (ok) onDelete(shipment);
                }}
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
              disabled={!canEdit || isSaving || (!isCreate && !hasChanges)}
              style={!canEdit || isSaving || (!isCreate && !hasChanges) ? btnDisabled : btnPrimary}
              title={
                !canEdit
                  ? "You do not have permission to create/update shipments."
                  : !isCreate && !hasChanges
                  ? "No changes to save."
                  : ""
              }
            >
              {isSaving ? "Saving…" : isCreate ? "Create Shipment" : "Update Shipment"}
            </button>
          </div>
        </div>

        <div style={bodyStyle}>
          {error ? <div style={errorStyle}>{error}</div> : null}

          {/* Basics */}
          <div style={{ ...cardStyle, marginBottom: 12 }}>
            <div style={sectionTitleStyle}>Basics</div>

            <div style={gridStyle}>
              {/* Supplier - read-only after create OR for supplier users */}
              <div style={{ ...fieldStyle, gridColumn: "span 4" }}>
                <div style={labelStyle}>Supplier</div>
                <select
                  value={draft.supplierId}
                  onChange={(e) => setField("supplierId", e.target.value)}
                  style={canEdit && isCreate && !isSupplier ? selectStyle : disabledStyle}
                  disabled={!canEdit || !isCreate || isSupplier}
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
                  style={canEdit ? inputStyle : disabledStyle}
                  disabled={!canEdit}
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
                  placeholder="Update PI when available."
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

            {!draft.supplierId && isCreate ? (
              <div style={{ fontSize: 13, color: "#64748b", fontWeight: 700 }}>
                Select a supplier to see available purchase orders.
              </div>
            ) : filteredPurchaseOrders.length === 0 ? (
              <div style={{ fontSize: 13, color: "#64748b", fontWeight: 700 }}>
                No purchase orders available for this supplier.
              </div>
            ) : (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
                  gap: 10,
                }}
              >
                {filteredPurchaseOrders.map((po: PurchaseOrderOption) => {
                  const checked =
                    Array.isArray(draft.purchaseOrderGIDs) && draft.purchaseOrderGIDs.includes(po.purchaseOrderGID);
                  const hasPdf = Boolean(po.purchaseOrderPdfUrl);
                  return (
                    <div
                      key={po.purchaseOrderGID}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 10,
                        background: checked ? "#eff6ff" : "#f8fafc",
                        border: checked ? "1px solid #2563eb" : "1px solid #e5e7eb",
                        borderRadius: 12,
                        padding: "10px 12px",
                      }}
                    >
                      <label
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 10,
                          cursor: canEdit ? "pointer" : "default",
                          flex: 1,
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={!canEdit}
                          onChange={() => togglePo(po.purchaseOrderGID)}
                        />
                        <span style={{ fontSize: 13, fontWeight: 800, color: "#0f172a" }}>
                          #{po.shortName}
                        </span>
                      </label>
                      {hasPdf ? (
                        <a
                          href={po.purchaseOrderPdfUrl!}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 4,
                            padding: "6px 10px",
                            fontSize: 12,
                            fontWeight: 700,
                            color: "#2563eb",
                            background: "#fff",
                            border: "1px solid #2563eb",
                            borderRadius: 8,
                            textDecoration: "none",
                            cursor: "pointer",
                            whiteSpace: "nowrap",
                          }}
                          onClick={(e) => e.stopPropagation()}
                        >
                          View PO
                        </a>
                      ) : (
                        <span
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 4,
                            padding: "6px 10px",
                            fontSize: 12,
                            fontWeight: 700,
                            color: "#9ca3af",
                            background: "#f3f4f6",
                            border: "1px solid #e5e7eb",
                            borderRadius: 8,
                            cursor: "not-allowed",
                            whiteSpace: "nowrap",
                          }}
                        >
                          View PO
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Products from Selected Purchase Orders */}
          {aggregatedProducts.length > 0 && (
            <div style={{ ...cardStyle, marginBottom: 12 }}>
              <div style={sectionTitleStyle}>
                <span>Products from Selected Purchase Orders</span>
                <span style={{ fontSize: 12, color: "#64748b", fontWeight: 800 }}>
                  {aggregatedProducts.length} product{aggregatedProducts.length !== 1 ? "s" : ""}
                </span>
              </div>

              <div
                style={{
                  border: "1px solid #e5e7eb",
                  borderRadius: 10,
                  overflow: "hidden",
                }}
              >
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ background: "#f8fafc" }}>
                      <th
                        style={{
                          textAlign: "left",
                          padding: "10px 12px",
                          fontSize: 12,
                          fontWeight: 800,
                          color: "#475569",
                          borderBottom: "1px solid #e5e7eb",
                        }}
                      >
                        Product
                      </th>
                      <th
                        style={{
                          textAlign: "left",
                          padding: "10px 12px",
                          fontSize: 12,
                          fontWeight: 800,
                          color: "#475569",
                          borderBottom: "1px solid #e5e7eb",
                          width: 120,
                        }}
                      >
                        SKU
                      </th>
                      <th
                        style={{
                          textAlign: "left",
                          padding: "10px 12px",
                          fontSize: 12,
                          fontWeight: 800,
                          color: "#475569",
                          borderBottom: "1px solid #e5e7eb",
                          width: 100,
                        }}
                      >
                        Quantity
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {aggregatedProducts.map((product, idx) => (
                      <tr
                        key={product.rslModelID}
                        style={{
                          background: idx % 2 === 0 ? "#fff" : "#fafafa",
                        }}
                      >
                        <td
                          style={{
                            padding: "10px 12px",
                            fontSize: 13,
                            borderBottom:
                              idx < aggregatedProducts.length - 1
                                ? "1px solid #e5e7eb"
                                : "none",
                          }}
                        >
                          <div style={{ fontWeight: 700, color: "#0f172a" }}>
                            {product.displayName || product.shortName}
                          </div>
                          <div style={{ fontSize: 11, color: "#64748b" }}>
                            {product.shortName}
                          </div>
                        </td>
                        <td
                          style={{
                            padding: "10px 12px",
                            fontSize: 12,
                            color: "#64748b",
                            borderBottom:
                              idx < aggregatedProducts.length - 1
                                ? "1px solid #e5e7eb"
                                : "none",
                          }}
                        >
                          {product.SKU || "—"}
                        </td>
                        <td
                          style={{
                            padding: "6px 12px",
                            borderBottom:
                              idx < aggregatedProducts.length - 1
                                ? "1px solid #e5e7eb"
                                : "none",
                          }}
                        >
                          <input
                            type="number"
                            min={0}
                            value={productQuantities[product.rslModelID] ?? ""}
                            onChange={(e) => updateProductQuantity(product.rslModelID, e.target.value)}
                            placeholder="0"
                            style={{
                              ...inputStyle,
                              width: "100%",
                              padding: "8px 10px",
                            }}
                            disabled={!canEdit}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

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
                <div style={labelStyle}>Est. Delivery to Origin</div>
                <input
                  type="date"
                  value={draft.estimatedDeliveryToOrigin}
                  onChange={(e) => setField("estimatedDeliveryToOrigin", e.target.value)}
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

          {/* Initial Notes - shown read-only in update mode if there are initial notes */}
          {!isCreate && norm((shipment as any).notes) && (
            <div style={{ ...cardStyle, marginBottom: 12 }}>
              <div style={sectionTitleStyle}>Initial Notes</div>
              <div
                style={{
                  background: "#f1f5f9",
                  border: "1px solid #e2e8f0",
                  borderRadius: 10,
                  padding: 12,
                  fontSize: 13,
                  color: "#475569",
                  whiteSpace: "pre-wrap",
                  minHeight: 60,
                }}
              >
                {norm((shipment as any).notes)}
              </div>
            </div>
          )}

          {/* Notes and History side by side (in update mode) or just Notes (in create mode) */}
          {isCreate ? (
            <div style={{ ...cardStyle, marginBottom: 12 }}>
              <div style={sectionTitleStyle}>Initial Notes</div>
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
                placeholder="Initial notes for this shipment…"
              />
            </div>
          ) : (
            <div style={{ display: "flex", gap: 12 }}>
              {/* Notes - left side */}
              <div style={{ ...cardStyle, flex: "0 0 300px" }}>
                <div style={sectionTitleStyle}>Notes</div>
                <textarea
                  value={draft.notes}
                  onChange={(e) => setField("notes", e.target.value)}
                  style={{
                    ...((canEdit ? inputStyle : disabledStyle) as any),
                    minHeight: 200,
                    resize: "vertical",
                    fontFamily: "inherit",
                  }}
                  disabled={!canEdit}
                  placeholder="Add notes about this update…"
                />
              </div>

              {/* History - right side */}
              <div style={{ ...cardStyle, flex: 1, minWidth: 0 }}>
                <div style={sectionTitleStyle}>
                  <span>History</span>
                  <span style={{ fontSize: 12, color: "#64748b", fontWeight: 800 }}>
                    {((shipment as any).history || []).length} update{((shipment as any).history || []).length !== 1 ? "s" : ""}
                  </span>
                </div>

                {((shipment as any).history || []).length === 0 ? (
                  <div style={{ fontSize: 13, color: "#64748b", fontWeight: 700 }}>
                    No update history yet.
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 12, maxHeight: 300, overflowY: "auto" }}>
                    {((shipment as any).history || []).map((entry: any) => {
                      const changes = entry.changes ? JSON.parse(entry.changes) : [];
                      const timestamp = entry.timestamp
                        ? new Date(entry.timestamp).toLocaleString()
                        : "";
                      const userName = entry.user || "Unknown User";

                      return (
                        <div
                          key={entry.id}
                          style={{
                            background: "#f8fafc",
                            border: "1px solid #e5e7eb",
                            borderRadius: 10,
                            padding: 12,
                          }}
                        >
                          {/* Header: User name (left) and Date (right) */}
                          <div
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              alignItems: "center",
                              marginBottom: 8,
                              paddingBottom: 8,
                              borderBottom: "1px solid #e5e7eb",
                            }}
                          >
                            <span style={{ fontSize: 13, fontWeight: 800, color: "#0f172a" }}>
                              {userName}
                            </span>
                            <span style={{ fontSize: 12, color: "#64748b" }}>
                              {timestamp}
                            </span>
                          </div>

                          {/* Changes */}
                          {changes.length > 0 && (
                            <div style={{ marginBottom: entry.content ? 8 : 0 }}>
                              <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12, color: "#374151" }}>
                                {changes.map((change: any, idx: number) => (
                                  <li key={idx} style={{ marginBottom: 2 }}>
                                    <strong>{change.field}:</strong>{" "}
                                    <span style={{ color: "#dc2626" }}>{change.from}</span>
                                    {" → "}
                                    <span style={{ color: "#16a34a" }}>{change.to}</span>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}

                          {/* Notes content */}
                          {entry.content && (
                            <div>
                              <div style={{ fontSize: 11, fontWeight: 700, color: "#475569", marginBottom: 4 }}>
                                Notes:
                              </div>
                              <div style={{ fontSize: 13, color: "#0f172a", whiteSpace: "pre-wrap" }}>
                                {entry.content}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
