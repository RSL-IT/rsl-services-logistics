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
  onSave: (
    mode: SaveMode,
    shipment: Shipment,
    packingListFile?: File | null,
    commercialInvoiceFile?: File | null
  ) => void;
  onDelete: (shipment: Shipment) => void;
  onOpenPurchaseOrder?: (purchaseOrderGID: string, draftShipment: Shipment) => void;
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

const requiredAsteriskStyle: React.CSSProperties = {
  color: "#dc2626",
  marginLeft: 4,
  fontWeight: 900,
  cursor: "help",
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

function parseWholeNonNegativeInt(v: unknown): number | null {
  const raw = String(v ?? "").trim();
  if (!raw) return 0;
  if (!/^\d+$/.test(raw)) return null;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

function clampWholeNonNegativeInt(v: unknown, min: number, max: number): number {
  const n = parseWholeNonNegativeInt(v);
  if (n == null) return min;
  return Math.min(Math.max(n, min), max);
}

function normalizePoQuantitiesShape(
  raw: unknown
): Record<string, Record<string, string>> {
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, Record<string, string>> = {};
  for (const [productIdRaw, rowRaw] of Object.entries(raw as Record<string, unknown>)) {
    const productId = String(productIdRaw || "").trim();
    if (!productId || !rowRaw || typeof rowRaw !== "object") continue;
    const rowOut: Record<string, string> = {};
    for (const [gidRaw, qtyRaw] of Object.entries(rowRaw as Record<string, unknown>)) {
      const gid = String(gidRaw || "").trim();
      if (!gid) continue;
      const qty = parseWholeNonNegativeInt(qtyRaw);
      if (qty == null) continue;
      rowOut[gid] = String(qty);
    }
    if (Object.keys(rowOut).length) out[productId] = rowOut;
  }
  return out;
}

function poQuantitiesEqual(
  a: Record<string, Record<string, string>> | null | undefined,
  b: Record<string, Record<string, string>> | null | undefined
) {
  const left = a || {};
  const right = b || {};
  const leftProducts = Object.keys(left).sort();
  const rightProducts = Object.keys(right).sort();
  if (leftProducts.length !== rightProducts.length) return false;
  for (let i = 0; i < leftProducts.length; i += 1) {
    const productId = leftProducts[i];
    if (productId !== rightProducts[i]) return false;
    const leftRow = left[productId] || {};
    const rightRow = right[productId] || {};
    const leftGids = Object.keys(leftRow).sort();
    const rightGids = Object.keys(rightRow).sort();
    if (leftGids.length !== rightGids.length) return false;
    for (let j = 0; j < leftGids.length; j += 1) {
      const gid = leftGids[j];
      if (gid !== rightGids[j]) return false;
      if (String(leftRow[gid] ?? "") !== String(rightRow[gid] ?? "")) return false;
    }
  }
  return true;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function titleWithoutSku(displayName: string, sku: string) {
  const title = norm(displayName).replace(/\bPowered by Shopify\b/gi, "").replace(/\s{2,}/g, " ").trim();
  const normalizedSku = norm(sku);
  if (!title || !normalizedSku) return title || "-";

  const skuPattern = escapeRegExp(normalizedSku);
  const cleaned = title
    .replace(new RegExp(`\\s*\\(${skuPattern}\\)\\s*`, "ig"), " ")
    .replace(new RegExp(`\\s*[-|]\\s*${skuPattern}\\b`, "ig"), " ")
    .replace(new RegExp(`\\b${skuPattern}\\b`, "ig"), " ")
    .replace(/\s{2,}/g, " ")
    .trim();

  return cleaned || title;
}

function companyLabel(c: CompanyOption) {
  const d = String(c.displayName ?? "").trim();
  return d || c.shortName;
}

const CHANGE_FIELDS_WITH_FILE_LINKS = new Set(["Pro Forma Invoice", "Packing List", "Commercial Invoice"]);

type ShipmentRequiredFieldKey =
  | "supplierId"
  | "containerSize"
  | "containerNumber"
  | "portOfOrigin"
  | "destinationPort"
  | "deliveryAddress"
  | "packingList"
  | "commercialInvoice"
  | "thisContainerProducts"
  | "cargoReadyDate"
  | "etd"
  | "eta"
  | "bookingAgent"
  | "bookingNumber"
  | "vesselName";

const REQUIRED_FIELD_LABELS: Record<ShipmentRequiredFieldKey, string> = {
  supplierId: "Supplier",
  containerSize: "Container Size",
  containerNumber: "Container #",
  portOfOrigin: "Port of Origin",
  destinationPort: "Destination Port",
  deliveryAddress: "Delivery Address",
  packingList: "Packing List",
  commercialInvoice: "Commercial Invoice",
  thisContainerProducts: "Products (This Container)",
  cargoReadyDate: "CRD",
  etd: "ETD",
  eta: "ETA",
  bookingAgent: "Booking Agent",
  bookingNumber: "Booking #",
  vesselName: "Vessel Name",
};

// Helper to render file change values as links
function renderChangeValue(field: string, value: string, color: string): React.ReactNode {
  if (CHANGE_FIELDS_WITH_FILE_LINKS.has(field) && value && value !== "(none)") {
    try {
      // Try to parse as JSON first
      const parsed = JSON.parse(value);
      if (parsed.url && parsed.name) {
        return (
          <a
            href={parsed.url}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color, textDecoration: "underline" }}
          >
            {parsed.name}
          </a>
        );
      }
      // If JSON but missing url/name, just show the name or value
      return parsed.name || value;
    } catch {
      // Not valid JSON - check if it's a URL
      if (value.startsWith("http://") || value.startsWith("https://")) {
        // Extract filename from URL
        try {
          const url = new URL(value);
          const pathParts = url.pathname.split("/");
          const filename = pathParts[pathParts.length - 1] || "file";
          return (
            <a
              href={value}
              target="_blank"
              rel="noopener noreferrer"
              style={{ color, textDecoration: "underline" }}
            >
              {decodeURIComponent(filename)}
            </a>
          );
        } catch {
          return value;
        }
      }
      // Plain filename or other text
      return value;
    }
  }
  return value;
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
                                               onOpenPurchaseOrder,
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

      status: isNewShipment ? "Pending" : (norm((shipment as any).status) || "Pending"),

      containerNumber: norm((shipment as any).containerNumber),
      containerSize: norm((shipment as any).containerSize),
      portOfOrigin: norm((shipment as any).portOfOrigin),
      destinationPort: norm((shipment as any).destinationPort),

      cargoReadyDate: norm((shipment as any).cargoReadyDate),
      etd: norm((shipment as any).etd),
      eta: norm((shipment as any).eta),

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
    status: isCreate ? "Pending" : (norm((shipment as any).status) || "Pending"),
    containerNumber: norm((shipment as any).containerNumber),
    containerSize: norm((shipment as any).containerSize),
    portOfOrigin: norm((shipment as any).portOfOrigin),
    destinationPort: norm((shipment as any).destinationPort),
    cargoReadyDate: norm((shipment as any).cargoReadyDate),
    etd: norm((shipment as any).etd),
    eta: norm((shipment as any).eta),
    quantity: norm((shipment as any).quantity),
    notes: isCreate ? norm((shipment as any).notes) : "",
    bookingAgent: norm((shipment as any).bookingAgent),
    bookingNumber: norm((shipment as any).bookingNumber),
    vesselName: norm((shipment as any).vesselName),
    deliveryAddress: norm((shipment as any).deliveryAddress),
    purchaseOrderGIDs: Array.isArray(initialPoGids) ? [...initialPoGids] : [],
  });

  const initialProductQuantitiesRef = React.useRef<Record<string, string>>(
    (() => {
      const saved = (shipment as any).productQuantities;
      if (saved && typeof saved === "object") {
        const result: Record<string, string> = {};
        for (const [key, val] of Object.entries(saved)) {
          result[key] = String(val ?? 0);
        }
        return result;
      }
      return {};
    })()
  );

  const title = "Shipping Container Details";

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
            .filter((po) => po.companyID === currentSupplierId && Boolean(po.proFormaInvoiceUrl))
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

  React.useEffect(() => {
    if (!isCreate) return;
    const allowedGids = new Set(
      filteredPurchaseOrders
        .filter((po) => Boolean(po.proFormaInvoiceUrl))
        .map((po) => po.purchaseOrderGID)
    );

    setDraft((prev) => {
      const current = Array.isArray(prev.purchaseOrderGIDs) ? prev.purchaseOrderGIDs : [];
      const next = current.filter((gid) => allowedGids.has(gid));
      if (next.length === current.length) return prev;
      return { ...prev, purchaseOrderGIDs: next };
    });
  }, [isCreate, filteredPurchaseOrders]);

  // Documentation file state
  const [packingListFile, setPackingListFile] = useState<File | null>(null);
  const [commercialInvoiceFile, setCommercialInvoiceFile] = useState<File | null>(null);
  const existingPackingListUrl = norm((shipment as any).packingListUrl);
  const existingPackingListFileName = norm((shipment as any).packingListFileName);
  const existingCommercialInvoiceUrl = norm((shipment as any).commercialInvoiceUrl);
  const existingCommercialInvoiceFileName = norm((shipment as any).commercialInvoiceFileName);
  const isReadOnlySupplierDocs = isSupplier && !isCreate;

  const buildInitialProductQuantities = () => {
    const saved = (shipment as any).productQuantities;
    if (saved && typeof saved === "object") {
      const result: Record<string, string> = {};
      for (const [key, val] of Object.entries(saved)) {
        result[key] = String(val ?? 0);
      }
      return result;
    }
    return {};
  };

  const buildInitialPoFieldQuantities = () =>
    normalizePoQuantitiesShape((shipment as any).poQuantities);

  // Track typed quantities and validated (applied) quantities separately.
  const [productQuantities, setProductQuantities] = useState<Record<string, string>>(
    buildInitialProductQuantities
  );
  const [appliedProductQuantities, setAppliedProductQuantities] = useState<Record<string, string>>(
    buildInitialProductQuantities
  );
  const initialPoFieldQuantitiesRef = React.useRef<Record<string, Record<string, string>>>(
    buildInitialPoFieldQuantities()
  );
  const [poFieldQuantities, setPoFieldQuantities] = useState<Record<string, Record<string, string>>>(
    buildInitialPoFieldQuantities
  );
  const [selectedPoFieldsByProduct, setSelectedPoFieldsByProduct] = useState<Record<string, string[]>>({});
  const poFieldFocusFromPointerRef = React.useRef(false);
  const [productQuantityErrors, setProductQuantityErrors] = useState<Record<string, string>>({});
  const previousProductQuantitiesRef = React.useRef<Record<string, string>>({});
  const previousPoFieldQuantitiesRef = React.useRef<Record<string, string>>({});
  const [clientValidationError, setClientValidationError] = useState<string | null>(null);
  const [highlightedRequiredFields, setHighlightedRequiredFields] = useState<ShipmentRequiredFieldKey[]>([]);

  const clearClientValidation = React.useCallback(() => {
    setClientValidationError(null);
    setHighlightedRequiredFields([]);
  }, []);

  const selectedPurchaseOrders = useMemo(() => {
    const selectedGIDs = Array.isArray(draft.purchaseOrderGIDs) ? draft.purchaseOrderGIDs : [];
    if (selectedGIDs.length === 0) return [] as PurchaseOrderOption[];

    const byGid = new Map<string, PurchaseOrderOption>();
    for (const po of filteredPurchaseOrders) {
      const gid = String(po.purchaseOrderGID || "").trim();
      if (!gid) continue;
      byGid.set(gid, po);
    }

    const ordered: PurchaseOrderOption[] = [];
    for (const gid of selectedGIDs) {
      const match = byGid.get(String(gid || "").trim());
      if (match) ordered.push(match);
    }
    return ordered;
  }, [draft.purchaseOrderGIDs, filteredPurchaseOrders]);

  const perPoProductQuantities = useMemo(() => {
    const out = new Map<string, Map<string, number>>();
    for (const po of selectedPurchaseOrders) {
      const gid = String(po.purchaseOrderGID || "").trim();
      if (!gid) continue;
      const productMap = new Map<string, number>();
      const poProducts = Array.isArray(po.products) ? po.products : [];
      for (const product of poProducts) {
        const productId = String(product?.rslModelID || "").trim();
        if (!productId) continue;
        const initialQuantity =
          typeof product?.initialQuantity === "number"
            ? product.initialQuantity
            : (typeof product?.quantity === "number" ? product.quantity : 0);
        const committedQuantity =
          typeof product?.committedQuantity === "number" ? product.committedQuantity : 0;
        const availableQuantity = Math.max(0, initialQuantity - committedQuantity);
        productMap.set(productId, (productMap.get(productId) || 0) + availableQuantity);
      }
      out.set(gid, productMap);
    }
    return out;
  }, [selectedPurchaseOrders]);

  // Aggregate products from all selected purchase orders
  const aggregatedProducts = useMemo(() => {
    if (selectedPurchaseOrders.length === 0) return [];

    // Build a map to aggregate products by rslModelID (summing quantities from multiple POs)
    const productMap = new Map<string, PurchaseOrderProduct & { quantity: number }>();

    for (const po of selectedPurchaseOrders) {
      const products = Array.isArray(po.products) ? po.products : [];

      for (const product of products) {
        const id = String(product.rslModelID || "").trim();
        if (!id) continue;

        const existingQuantity = productMap.get(id)?.quantity || 0;
        const initialQuantity =
          typeof product?.initialQuantity === "number"
            ? product.initialQuantity
            : (typeof product?.quantity === "number" ? product.quantity : 0);
        const committedQuantity =
          typeof product?.committedQuantity === "number" ? product.committedQuantity : 0;
        const availableQuantity = Math.max(0, initialQuantity - committedQuantity);

        // Add or update the product (summing available quantities if from multiple POs)
        productMap.set(id, {
          rslModelID: id,
          shortName: product.shortName || id,
          displayName: product.displayName || product.shortName || id,
          SKU: product.SKU || null,
          quantity: existingQuantity + availableQuantity,
        });
      }
    }

    // Convert to sorted array
    return Array.from(productMap.values()).sort((a, b) =>
      (a.displayName || a.shortName || "").localeCompare(b.displayName || b.shortName || "")
    );
  }, [selectedPurchaseOrders]);

  // Initialize product quantities from PO quantities when products change
  React.useEffect(() => {
    setProductQuantities((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const product of aggregatedProducts) {
        const id = String(product.rslModelID || "").trim();
        if (!id) continue;
        // Start container quantity at 0 for newly selected rows.
        if (!(id in next)) {
          next[id] = "0";
          changed = true;
        }
      }
      return changed ? next : prev;
    });
    setAppliedProductQuantities((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const product of aggregatedProducts) {
        const id = String(product.rslModelID || "").trim();
        if (!id) continue;
        if (!(id in next)) {
          next[id] = "0";
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [aggregatedProducts]);

  React.useEffect(() => {
    setPoFieldQuantities((prev) => {
      const next: Record<string, Record<string, string>> = {};
      for (const product of aggregatedProducts) {
        const productId = String(product.rslModelID || "").trim();
        if (!productId) continue;
        const prevRow = prev[productId] && typeof prev[productId] === "object" ? prev[productId] : {};
        const savedRow =
          initialPoFieldQuantitiesRef.current[productId] &&
          typeof initialPoFieldQuantitiesRef.current[productId] === "object"
            ? initialPoFieldQuantitiesRef.current[productId]
            : {};

        const rowOut: Record<string, string> = {};

        for (const po of selectedPurchaseOrders) {
          const gid = String(po.purchaseOrderGID || "").trim();
          if (!gid) continue;
          const base = perPoProductQuantities.get(gid)?.get(productId);
          if (typeof base !== "number") continue;

          if (Object.prototype.hasOwnProperty.call(prevRow, gid)) {
            rowOut[gid] = String(clampWholeNonNegativeInt(prevRow[gid], 0, base));
            continue;
          }
          if (Object.prototype.hasOwnProperty.call(savedRow, gid)) {
            rowOut[gid] = String(clampWholeNonNegativeInt(savedRow[gid], 0, base));
            continue;
          }
          rowOut[gid] = String(base);
        }
        next[productId] = rowOut;
      }
      return next;
    });

    setSelectedPoFieldsByProduct((prev) => {
      const next: Record<string, string[]> = {};
      for (const product of aggregatedProducts) {
        const productId = String(product.rslModelID || "").trim();
        if (!productId) continue;
        const validGids = selectedPurchaseOrders
          .map((po) => String(po.purchaseOrderGID || "").trim())
          .filter((gid) => typeof perPoProductQuantities.get(gid)?.get(productId) === "number");
        if (!validGids.length) continue;
        const currentRaw = Array.isArray(prev[productId]) ? prev[productId] : [];
        const current = currentRaw.filter((gid) => validGids.includes(gid));
        next[productId] = current.length ? current : [validGids[0]];
      }
      return next;
    });
  }, [aggregatedProducts, selectedPurchaseOrders, perPoProductQuantities]);

  const getRowMaxAvailable = (productId: string) =>
    Number(aggregatedProducts.find((p) => String(p.rslModelID || "").trim() === productId)?.quantity || 0);

  const getRowUsedFromPoFields = (productId: string, row: Record<string, string>) => {
    let used = 0;
    for (const [gid, remainingRaw] of Object.entries(row || {})) {
      const base = perPoProductQuantities.get(gid)?.get(productId);
      if (typeof base !== "number") continue;
      const remaining = clampWholeNonNegativeInt(remainingRaw, 0, base);
      used += Math.max(0, base - remaining);
    }
    return used;
  };

  const getOrderedRowPoGids = (productId: string, row: Record<string, string>) =>
    selectedPurchaseOrders
      .map((po) => String(po.purchaseOrderGID || "").trim())
      .filter((gid) =>
        Boolean(gid) &&
        Object.prototype.hasOwnProperty.call(row, gid) &&
        typeof perPoProductQuantities.get(gid)?.get(productId) === "number"
      );

  const getSelectedPoGidsForProduct = (productId: string, row: Record<string, string>) => {
    const orderedGids = getOrderedRowPoGids(productId, row);
    const selectedRaw = Array.isArray(selectedPoFieldsByProduct[productId])
      ? selectedPoFieldsByProduct[productId]
      : [];
    const selected = orderedGids.filter((gid) => selectedRaw.includes(gid));
    if (selected.length > 0) return selected;
    if (orderedGids.length > 0) return [orderedGids[0]];
    return [];
  };

  const buildInitialRenderedPoRow = (productId: string, row: Record<string, string>) => {
    const orderedGids = getOrderedRowPoGids(productId, row);
    const savedRow =
      initialPoFieldQuantitiesRef.current[productId] &&
      typeof initialPoFieldQuantitiesRef.current[productId] === "object"
        ? initialPoFieldQuantitiesRef.current[productId]
        : {};
    const rowNext: Record<string, string> = { ...row };
    for (const gid of orderedGids) {
      const base = perPoProductQuantities.get(gid)?.get(productId);
      if (typeof base !== "number") continue;
      if (Object.prototype.hasOwnProperty.call(savedRow, gid)) {
        rowNext[gid] = String(clampWholeNonNegativeInt(savedRow[gid], 0, base));
      } else {
        rowNext[gid] = String(base);
      }
    }
    return rowNext;
  };

  const distributeUsedAcrossSelectedPoFields = (
    productId: string,
    row: Record<string, string>,
    selectedGids: string[],
    targetTotalUsed: number
  ): { ok: true; rowNext: Record<string, string> } | { ok: false; error: string } => {
    const orderedGids = getOrderedRowPoGids(productId, row);
    if (!orderedGids.length) {
      return { ok: false, error: "No PO quantity fields are available for this row." };
    }

    const orderedSelectedGids = orderedGids.filter((gid) => selectedGids.includes(gid));
    const effectiveSelectedGids = orderedSelectedGids.length ? orderedSelectedGids : [orderedGids[0]];

    const baseByGid: Record<string, number> = {};
    const usedByGid: Record<string, number> = {};
    for (const gid of orderedGids) {
      const base = perPoProductQuantities.get(gid)?.get(productId);
      if (typeof base !== "number") continue;
      const remaining = clampWholeNonNegativeInt(row[gid], 0, base);
      baseByGid[gid] = base;
      usedByGid[gid] = Math.max(0, base - remaining);
    }

    const selectedSet = new Set(effectiveSelectedGids);
    const fixedUsed = orderedGids.reduce((sum, gid) => {
      if (selectedSet.has(gid)) return sum;
      return sum + (usedByGid[gid] || 0);
    }, 0);

    if (targetTotalUsed < fixedUsed) {
      return {
        ok: false,
        error: "This Container value cannot be less than quantities already assigned to unselected PO fields.",
      };
    }

    const targetSelectedUsed = targetTotalUsed - fixedUsed;
    const selectedCapacity = effectiveSelectedGids.reduce((sum, gid) => sum + (baseByGid[gid] || 0), 0);
    if (targetSelectedUsed > selectedCapacity) {
      return {
        ok: false,
        error: "Selected PO quantity fields do not have enough available quantity for this value.",
      };
    }

    const allocatedSelectedUsed: Record<string, number> = {};
    for (const gid of effectiveSelectedGids) allocatedSelectedUsed[gid] = 0;

    let remainingToAllocate = targetSelectedUsed;
    while (remainingToAllocate > 0) {
      let allocatedInRound = false;
      for (const gid of effectiveSelectedGids) {
        const base = baseByGid[gid] || 0;
        const current = allocatedSelectedUsed[gid] || 0;
        if (current >= base) continue;
        allocatedSelectedUsed[gid] = current + 1;
        remainingToAllocate -= 1;
        allocatedInRound = true;
        if (remainingToAllocate === 0) break;
      }
      if (!allocatedInRound) {
        return { ok: false, error: "Unable to distribute quantity across selected PO fields." };
      }
    }

    const rowNext: Record<string, string> = { ...row };
    for (const gid of orderedGids) {
      const base = baseByGid[gid];
      if (typeof base !== "number") continue;
      if (selectedSet.has(gid)) {
        const used = allocatedSelectedUsed[gid] || 0;
        rowNext[gid] = String(Math.max(0, base - used));
        continue;
      }
      const existingRemaining = clampWholeNonNegativeInt(row[gid], 0, base);
      rowNext[gid] = String(existingRemaining);
    }

    return { ok: true, rowNext };
  };

  const syncThisContainerFromPoRow = (productId: string, row: Record<string, string>) => {
    const used = getRowUsedFromPoFields(productId, row);
    const asText = String(used);
    setProductQuantities((prev) => ({ ...prev, [productId]: asText }));
    setAppliedProductQuantities((prev) => ({ ...prev, [productId]: asText }));
  };

  React.useEffect(() => {
    setProductQuantities((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const product of aggregatedProducts) {
        const productId = String(product.rslModelID || "").trim();
        if (!productId) continue;
        const row = poFieldQuantities[productId] || {};
        const used = String(getRowUsedFromPoFields(productId, row));
        if (next[productId] !== used) {
          next[productId] = used;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
    setAppliedProductQuantities((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const product of aggregatedProducts) {
        const productId = String(product.rslModelID || "").trim();
        if (!productId) continue;
        const row = poFieldQuantities[productId] || {};
        const used = String(getRowUsedFromPoFields(productId, row));
        if (next[productId] !== used) {
          next[productId] = used;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [poFieldQuantities, aggregatedProducts, perPoProductQuantities]);

  const clearRowError = (productId: string) => {
    setProductQuantityErrors((prev) => {
      if (!prev[productId]) return prev;
      const next = { ...prev };
      delete next[productId];
      return next;
    });
  };

  const updateThisContainerQuantity = (productId: string, raw: string) => {
    clearClientValidation();
    setProductQuantities((prev) => ({ ...prev, [productId]: raw }));

    const parsed = parseWholeNonNegativeInt(raw);
    if (parsed == null) return;
    const maxAvailable = getRowMaxAvailable(productId);
    if (parsed > maxAvailable) return;

    const currentRow = poFieldQuantities[productId] || {};
    if (parsed === 0) {
      const resetRow = buildInitialRenderedPoRow(productId, currentRow);
      setPoFieldQuantities((prev) => ({ ...prev, [productId]: resetRow }));
      setProductQuantities((prev) => ({ ...prev, [productId]: "0" }));
      setAppliedProductQuantities((prev) => ({ ...prev, [productId]: "0" }));
      clearRowError(productId);
      return;
    }

    const selectedGids = getSelectedPoGidsForProduct(productId, currentRow);
    if (!selectedGids.length) {
      const normalized = String(parsed);
      setProductQuantities((prev) => ({ ...prev, [productId]: normalized }));
      setAppliedProductQuantities((prev) => ({ ...prev, [productId]: normalized }));
      clearRowError(productId);
      return;
    }

    const allocation = distributeUsedAcrossSelectedPoFields(productId, currentRow, selectedGids, parsed);
    if (!allocation.ok) return;

    setPoFieldQuantities((prev) => {
      const rowPrev = prev[productId] || {};
      const rowNext = { ...rowPrev, ...allocation.rowNext };
      return { ...prev, [productId]: rowNext };
    });

    const normalized = String(parsed);
    setProductQuantities((prev) => ({ ...prev, [productId]: normalized }));
    setAppliedProductQuantities((prev) => ({ ...prev, [productId]: normalized }));
    clearRowError(productId);
  };

  const rememberPreviousProductQuantity = (productId: string) => {
    previousProductQuantitiesRef.current[productId] = String(
      appliedProductQuantities[productId] ?? "0"
    );
  };

  const validateProductQuantityOnBlur = (productId: string) => {
    const maxAvailable = Number(
      aggregatedProducts.find((p) => String(p.rslModelID || "").trim() === productId)?.quantity || 0
    );

    const previousRaw = String(
      previousProductQuantitiesRef.current[productId] ?? appliedProductQuantities[productId] ?? "0"
    );
    const previousValue = parseWholeNonNegativeInt(previousRaw) ?? 0;

    const parsed = parseWholeNonNegativeInt(productQuantities[productId]);
    if (parsed == null) {
      setProductQuantityErrors((prev) => ({
        ...prev,
        [productId]: "Quantity must be a whole number.",
      }));
      setProductQuantities((prev) => ({ ...prev, [productId]: String(previousValue) }));
      setAppliedProductQuantities((prev) => ({ ...prev, [productId]: String(previousValue) }));
      return;
    }

    if (parsed > maxAvailable) {
      setProductQuantityErrors((prev) => ({
        ...prev,
        [productId]: `Quantity cannot exceed the initial quantity (${maxAvailable}).`,
      }));
      setProductQuantities((prev) => ({ ...prev, [productId]: String(previousValue) }));
      setAppliedProductQuantities((prev) => ({ ...prev, [productId]: String(previousValue) }));
      return;
    }

    const normalized = String(parsed);
    previousProductQuantitiesRef.current[productId] = normalized;
    const currentRow = poFieldQuantities[productId] || {};
    const selectedGids = getSelectedPoGidsForProduct(productId, currentRow);
    if (!selectedGids.length) {
      setProductQuantities((prev) => ({ ...prev, [productId]: normalized }));
      setAppliedProductQuantities((prev) => ({ ...prev, [productId]: normalized }));
      clearRowError(productId);
      return;
    }

    const allocation = distributeUsedAcrossSelectedPoFields(productId, currentRow, selectedGids, parsed);
    if (!allocation.ok) {
      setProductQuantityErrors((prev) => ({
        ...prev,
        [productId]: allocation.error,
      }));
      setProductQuantities((prev) => ({ ...prev, [productId]: String(previousValue) }));
      setAppliedProductQuantities((prev) => ({ ...prev, [productId]: String(previousValue) }));
      return;
    }

    setPoFieldQuantities((prev) => {
      const rowPrev = prev[productId] || {};
      const rowNext = { ...rowPrev, ...allocation.rowNext };
      syncThisContainerFromPoRow(productId, rowNext);
      return { ...prev, [productId]: rowNext };
    });
    clearRowError(productId);
  };

  const rememberPreviousPoFieldQuantity = (productId: string, poGid: string) => {
    previousPoFieldQuantitiesRef.current[`${productId}::${poGid}`] = String(
      poFieldQuantities[productId]?.[poGid] ?? "0"
    );
  };

  const handlePoFieldFocus = (productId: string, poGid: string) => {
    rememberPreviousPoFieldQuantity(productId, poGid);
    // Pointer interactions already update selection via click; keyboard focus (Tab) should select the focused field.
    if (!poFieldFocusFromPointerRef.current) {
      selectPoField(productId, poGid, false);
    }
  };

  const selectPoField = (productId: string, poGid: string, append: boolean) => {
    setSelectedPoFieldsByProduct((prev) => {
      const row = poFieldQuantities[productId] || {};
      const validGids = getOrderedRowPoGids(productId, row);
      if (!validGids.includes(poGid)) return prev;

      if (!append) {
        return { ...prev, [productId]: [poGid] };
      }

      const currentRaw = Array.isArray(prev[productId]) ? prev[productId] : [];
      const current = currentRaw.filter((gid) => validGids.includes(gid));
      const exists = current.includes(poGid);
      let next = exists ? current.filter((gid) => gid !== poGid) : [...current, poGid];
      next = validGids.filter((gid) => next.includes(gid));
      if (!next.length) next = [poGid];
      return { ...prev, [productId]: next };
    });
  };

  const updatePoFieldQuantity = (productId: string, poGid: string, raw: string) => {
    clearClientValidation();
    setPoFieldQuantities((prev) => {
      const rowPrev = prev[productId] || {};
      const rowNext = { ...rowPrev, [poGid]: raw };
      const parsed = parseWholeNonNegativeInt(raw);
      const base = perPoProductQuantities.get(poGid)?.get(productId);
      if (parsed != null && typeof base === "number" && parsed <= base) {
        syncThisContainerFromPoRow(productId, rowNext);
        clearRowError(productId);
      }
      return { ...prev, [productId]: rowNext };
    });
  };

  const validatePoFieldQuantityOnBlur = (productId: string, poGid: string) => {
    const base = perPoProductQuantities.get(poGid)?.get(productId);
    if (typeof base !== "number") return;

    const previousRaw = String(previousPoFieldQuantitiesRef.current[`${productId}::${poGid}`] ?? "0");
    const previousValue = clampWholeNonNegativeInt(previousRaw, 0, base);
    const parsed = parseWholeNonNegativeInt(poFieldQuantities[productId]?.[poGid] ?? "");
    if (parsed == null || parsed > base) {
      setProductQuantityErrors((prev) => ({
        ...prev,
        [productId]:
          parsed == null
            ? "Quantity must be a whole number."
            : `Quantity cannot exceed the initial quantity (${base}).`,
      }));
      setPoFieldQuantities((prev) => {
        const rowPrev = prev[productId] || {};
        const rowNext = { ...rowPrev, [poGid]: String(previousValue) };
        syncThisContainerFromPoRow(productId, rowNext);
        return { ...prev, [productId]: rowNext };
      });
      return;
    }

    setPoFieldQuantities((prev) => {
      const rowPrev = prev[productId] || {};
      const rowNext = { ...rowPrev, [poGid]: String(parsed) };
      syncThisContainerFromPoRow(productId, rowNext);
      return { ...prev, [productId]: rowNext };
    });
    clearRowError(productId);
  };

  const normalizedPoQuantities = useMemo(() => {
    const out: Record<string, Record<string, string>> = {};
    for (const product of aggregatedProducts) {
      const productId = String(product.rslModelID || "").trim();
      if (!productId) continue;
      const row = poFieldQuantities[productId] || {};
      const rowOut: Record<string, string> = {};
      for (const [gid, remainingRaw] of Object.entries(row)) {
        const base = perPoProductQuantities.get(gid)?.get(productId);
        if (typeof base !== "number") continue;
        rowOut[gid] = String(clampWholeNonNegativeInt(remainingRaw, 0, base));
      }
      out[productId] = rowOut;
    }
    return out;
  }, [aggregatedProducts, poFieldQuantities, perPoProductQuantities]);

  const initialNormalizedPoQuantitiesRef = React.useRef<Record<string, Record<string, string>> | null>(null);
  React.useEffect(() => {
    if (initialNormalizedPoQuantitiesRef.current != null) return;
    const hasSelectedPo = selectedPurchaseOrders.length > 0;
    const hasAnyRow = Object.values(normalizedPoQuantities).some(
      (row) => row && Object.keys(row).length > 0
    );
    if (hasSelectedPo && !hasAnyRow) return;
    initialNormalizedPoQuantitiesRef.current = normalizedPoQuantities;
  }, [normalizedPoQuantities, selectedPurchaseOrders.length]);

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
    const allKeys = new Set([...Object.keys(appliedProductQuantities), ...Object.keys(initialPQ)]);
    for (const key of allKeys) {
      if ((appliedProductQuantities[key] || "0") !== (initialPQ[key] || "0")) return true;
    }

    if (!poQuantitiesEqual(normalizedPoQuantities, initialNormalizedPoQuantitiesRef.current || {})) return true;

    // Check if any new documentation file was selected
    if (packingListFile) return true;
    if (commercialInvoiceFile) return true;

    return false;
  }, [draft, appliedProductQuantities, normalizedPoQuantities, packingListFile, commercialInvoiceFile]);

  const hasAnyThisContainerProducts = useMemo(() => {
    return aggregatedProducts.some((product) => {
      const productId = String(product.rslModelID || "").trim();
      if (!productId) return false;
      const parsed = parseWholeNonNegativeInt(appliedProductQuantities[productId]);
      return parsed != null && parsed > 0;
    });
  }, [aggregatedProducts, appliedProductQuantities]);

  const inTransitMissingFields = useMemo<ShipmentRequiredFieldKey[]>(() => {
    const missing: ShipmentRequiredFieldKey[] = [];
    const hasPackingList = Boolean(packingListFile || existingPackingListUrl);
    const hasCommercialInvoice = Boolean(commercialInvoiceFile || existingCommercialInvoiceUrl);

    if (!norm(draft.containerSize)) missing.push("containerSize");
    if (!norm(draft.containerNumber)) missing.push("containerNumber");
    if (!norm(draft.portOfOrigin)) missing.push("portOfOrigin");
    if (!norm(draft.destinationPort)) missing.push("destinationPort");
    if (!norm(draft.deliveryAddress)) missing.push("deliveryAddress");
    if (!hasPackingList) missing.push("packingList");
    if (!hasCommercialInvoice) missing.push("commercialInvoice");
    if (!hasAnyThisContainerProducts) missing.push("thisContainerProducts");
    if (!norm(draft.cargoReadyDate)) missing.push("cargoReadyDate");
    if (!norm(draft.etd)) missing.push("etd");
    if (!norm(draft.eta)) missing.push("eta");
    if (!norm(draft.bookingAgent)) missing.push("bookingAgent");
    if (!norm(draft.bookingNumber)) missing.push("bookingNumber");
    if (!norm(draft.vesselName)) missing.push("vesselName");

    return missing;
  }, [
    draft.containerSize,
    draft.containerNumber,
    draft.portOfOrigin,
    draft.destinationPort,
    draft.deliveryAddress,
    draft.cargoReadyDate,
    draft.etd,
    draft.eta,
    draft.bookingAgent,
    draft.bookingNumber,
    draft.vesselName,
    packingListFile,
    commercialInvoiceFile,
    existingPackingListUrl,
    existingCommercialInvoiceUrl,
    hasAnyThisContainerProducts,
  ]);

  const baseCreateMissingFields = useMemo<ShipmentRequiredFieldKey[]>(() => {
    if (!isCreate) return [];
    const missing: ShipmentRequiredFieldKey[] = [];
    if (!isSupplier && !norm(draft.supplierId)) missing.push("supplierId");
    if (!norm(draft.destinationPort)) missing.push("destinationPort");
    if (!norm(draft.deliveryAddress)) missing.push("deliveryAddress");
    if (!norm(draft.eta)) missing.push("eta");
    return missing;
  }, [isCreate, isSupplier, draft.supplierId, draft.destinationPort, draft.deliveryAddress, draft.eta]);

  const draftStatusLower = norm(draft.status).toLowerCase();
  const isInTransitStatus = draftStatusLower === "in transit";
  const inTransitSelectable =
    inTransitMissingFields.length === 0 || isInTransitStatus;

  const highlightedRequiredFieldSet = useMemo(
    () => new Set<ShipmentRequiredFieldKey>(highlightedRequiredFields),
    [highlightedRequiredFields]
  );

  const controlStyleFor = (
    baseStyle: React.CSSProperties,
    fieldKey: ShipmentRequiredFieldKey
  ): React.CSSProperties =>
    highlightedRequiredFieldSet.has(fieldKey)
      ? { ...baseStyle, borderColor: "#dc2626", boxShadow: "0 0 0 2px rgba(220, 38, 38, 0.18)" }
      : baseStyle;

  const cardStyleFor = (fieldKey: ShipmentRequiredFieldKey): React.CSSProperties =>
    highlightedRequiredFieldSet.has(fieldKey)
      ? { border: "1px solid #dc2626", boxShadow: "0 0 0 2px rgba(220, 38, 38, 0.1)" }
      : {};

  const saveDisabled =
    !canEdit ||
    isSaving ||
    (baseCreateMissingFields.length > 0 && !isInTransitStatus) ||
    (!isCreate && !hasChanges);
  const saveTitle = !canEdit
    ? "You do not have permission to create/update shipments."
    : baseCreateMissingFields.length > 0 && !isInTransitStatus
    ? "All required fields have not been set."
    : !isCreate && !hasChanges
    ? "No changes to save."
    : "";

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
    clearClientValidation();
    setDraft((prev) => ({ ...prev, [k]: v } as any));
  };

  const supplierDisplay = useMemo(() => {
    const found = companiesSafe.find((c) => c.shortName === draft.supplierId);
    if (!found) return draft.supplierId || "—";
    return companyLabel(found);
  }, [companiesSafe, draft.supplierId]);

  const togglePo = (gid: string) => {
    clearClientValidation();
    setDraft((prev) => {
      const current = Array.isArray(prev.purchaseOrderGIDs) ? prev.purchaseOrderGIDs : [];
      const exists = current.includes(gid);
      const next = exists ? current.filter((x: string) => x !== gid) : [...current, gid];
      return { ...prev, purchaseOrderGIDs: next };
    });
  };

  const buildDraftShipment = (): Shipment => {
    const company = companiesSafe.find((c) => c.shortName === draft.supplierId);
    const derivedSupplierName =
      (company?.displayName && String(company.displayName).trim()) || draft.supplierId || draft.supplierName;

    return {
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

      quantity: draft.quantity,
      notes: draft.notes,

      bookingAgent: draft.bookingAgent,
      bookingNumber: draft.bookingNumber,
      vesselName: draft.vesselName,
      deliveryAddress: draft.deliveryAddress,

      purchaseOrderGIDs: Array.isArray(draft.purchaseOrderGIDs) ? draft.purchaseOrderGIDs : [],
      productQuantities: appliedProductQuantities,
      poQuantities: normalizedPoQuantities,
    } as Shipment;
  };

  const handleSave = () => {
    const missing = [
      ...baseCreateMissingFields,
      ...(isInTransitStatus ? inTransitMissingFields : []),
    ];
    const uniqueMissing = Array.from(new Set(missing));

    if (uniqueMissing.length > 0) {
      const labels = uniqueMissing.map((fieldKey) => REQUIRED_FIELD_LABELS[fieldKey]);
      const message = isInTransitStatus
        ? `Cannot save as In Transit. Missing required fields: ${labels.join(", ")}.`
        : `Please complete required fields: ${labels.join(", ")}.`;
      setClientValidationError(message);
      setHighlightedRequiredFields(uniqueMissing);
      return;
    }

    clearClientValidation();
    const next = buildDraftShipment();
    onSave(mode, next, packingListFile, commercialInvoiceFile);
  };

  return (
    <div style={overlayStyle} role="dialog" aria-modal="true" className="shipment-details-overlay">
      <div style={modalStyle} className="shipment-details-modal">
        <div style={headerStyle} className="shipment-details-header">
          <div>
            <div style={headerTitleStyle}>{title}</div>
            <div style={headerSubStyle}>
              Supplier: <b>{supplierDisplay}</b>
            </div>
          </div>

          <div style={{ display: "flex", gap: 10, alignItems: "center" }} className="shipment-details-actions">
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
                className="shipment-details-delete"
              >
                Delete
              </button>
            ) : null}

            <button
              type="button"
              onClick={handleCancel}
              disabled={isSaving}
              style={isSaving ? btnDisabled : btnMuted}
              className="shipment-details-cancel"
            >
              Cancel
            </button>

            {saveDisabled && saveTitle ? (
              <span title={saveTitle} style={{ display: "inline-flex" }}>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={saveDisabled}
                  style={saveDisabled ? btnDisabled : btnPrimary}
                  className="shipment-details-save"
                >
                  {isSaving ? "Saving…" : isCreate ? "Save Container" : "Update Shipment"}
                </button>
              </span>
            ) : (
              <button
                type="button"
                onClick={handleSave}
                disabled={saveDisabled}
                style={saveDisabled ? btnDisabled : btnPrimary}
                className="shipment-details-save"
              >
                {isSaving ? "Saving…" : isCreate ? "Save Container" : "Update Shipment"}
              </button>
            )}
          </div>
        </div>

        <div style={bodyStyle} className="shipment-details-body">
          <style>{`
            @media (max-width: 720px) {
              .shipment-details-overlay {
                padding: 10px !important;
              }

              .shipment-details-modal {
                width: calc(100vw - 20px) !important;
                max-width: calc(100vw - 20px) !important;
                margin: 0 auto;
                box-sizing: border-box;
              }

              .shipment-details-header {
                flex-direction: column;
                align-items: stretch;
                gap: 10px;
                text-align: center;
              }

              .shipment-details-actions {
                width: 100%;
                flex-wrap: wrap;
                justify-content: space-between;
              }

              .shipment-details-actions button {
                flex: 0 0 auto;
                padding: 8px 10px;
                font-size: 12px;
              }

              .shipment-details-cancel {
                margin-right: auto;
                order: 2;
              }

              .shipment-details-save {
                margin-left: auto;
                order: 3;
              }

              .shipment-details-delete {
                order: 1;
              }

              .shipment-details-body * {
                box-sizing: border-box;
              }

              .shipment-details-body {
                padding: 12px;
              }

              .shipment-details-card {
                padding: 12px !important;
                width: 100% !important;
                max-width: 100% !important;
              }

              .shipment-details-grid {
                grid-template-columns: 1fr !important;
              }

              .shipment-details-grid > * {
                grid-column: 1 / -1 !important;
                min-width: 0 !important;
              }

              .shipment-po-grid {
                grid-template-columns: 1fr !important;
              }

              .shipment-doc-grid {
                grid-template-columns: 1fr !important;
              }

              .shipment-doc-grid > * {
                grid-column: 1 / -1 !important;
              }

              .shipment-details-body {
                overflow-x: hidden;
              }

              .shipment-details-body input,
              .shipment-details-body select,
              .shipment-details-body textarea {
                width: 100%;
                max-width: 100%;
              }

              .shipment-products-table thead {
                display: none;
              }

              .shipment-products-table,
              .shipment-products-table tbody,
              .shipment-products-table tr,
              .shipment-products-table td {
                display: block;
                width: 100%;
              }

              .shipment-products-table tr {
                border-bottom: 1px solid #e5e7eb;
              }

              .shipment-products-table td {
                border: none !important;
                padding: 8px 12px !important;
                display: flex;
                justify-content: space-between;
                align-items: flex-start;
                gap: 12px;
              }

              .shipment-products-table td::before {
                content: attr(data-label);
                font-size: 11px;
                color: #64748b;
                font-weight: 700;
                flex: 0 0 90px;
              }

              .shipment-this-container-col {
                position: static !important;
                right: auto !important;
                z-index: auto !important;
                box-shadow: none !important;
              }

            }
          `}</style>
          {error ? <div style={errorStyle}>{error}</div> : null}
          {clientValidationError ? <div style={errorStyle}>{clientValidationError}</div> : null}

          {/* Basics */}
          <div style={{ ...cardStyle, marginBottom: 12 }} className="shipment-details-card">
            <div style={sectionTitleStyle}>Basics</div>

            <div style={gridStyle} className="shipment-details-grid">
              {/* Supplier - read-only after create OR for supplier users */}
              <div style={{ ...fieldStyle, gridColumn: "span 3" }}>
                <div
                  style={
                    highlightedRequiredFieldSet.has("supplierId")
                      ? { ...labelStyle, color: "#b91c1c" }
                      : labelStyle
                  }
                >
                  Supplier
                  {!isSupplier ? (
                    <span style={requiredAsteriskStyle} title="This field is required">*</span>
                  ) : null}
                </div>
                {isSupplier && isCreate ? (
                  <div style={{ ...disabledStyle, fontWeight: 800, color: "#0f172a" }}>{supplierDisplay}</div>
                ) : (
                  <select
                    value={draft.supplierId}
                    onChange={(e) => setField("supplierId", e.target.value)}
                    style={
                      canEdit && isCreate && !isSupplier
                        ? controlStyleFor(selectStyle, "supplierId")
                        : disabledStyle
                    }
                    disabled={!canEdit || !isCreate || isSupplier}
                  >
                    <option value="">Select…</option>
                    {companiesSafe.map((c: CompanyOption) => (
                      <option key={c.shortName} value={c.shortName}>
                        {companyLabel(c)}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              {/* Status */}
              <div style={{ ...fieldStyle, gridColumn: "span 3" }}>
                <div style={labelStyle}>Status</div>
                <select
                  value={draft.status}
                  onChange={(e) => setField("status", e.target.value)}
                  style={canEdit ? selectStyle : disabledStyle}
                  disabled={!canEdit}
                >
                  <option value="Pending">Pending</option>
                  <option value="In Transit" disabled={!inTransitSelectable}>
                    In Transit
                  </option>
                  <option value="Arrived" disabled={isCreate}>
                    Arrived
                  </option>
                  <option value="Delivered" disabled={isCreate}>
                    Delivered
                  </option>
                </select>
              </div>

              {/* Container Size */}
              <div style={{ ...fieldStyle, gridColumn: "span 3" }}>
                <div
                  style={
                    highlightedRequiredFieldSet.has("containerSize")
                      ? { ...labelStyle, color: "#b91c1c" }
                      : labelStyle
                  }
                >
                  Container Size
                </div>
                <select
                  value={draft.containerSize}
                  onChange={(e) => setField("containerSize", e.target.value)}
                  style={canEdit ? controlStyleFor(selectStyle, "containerSize") : disabledStyle}
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

              {/* Container # */}
              <div style={{ ...fieldStyle, gridColumn: "span 3" }}>
                <div
                  style={
                    highlightedRequiredFieldSet.has("containerNumber")
                      ? { ...labelStyle, color: "#b91c1c" }
                      : labelStyle
                  }
                >
                  Container #
                </div>
                <input
                  value={draft.containerNumber}
                  onChange={(e) => setField("containerNumber", e.target.value.toUpperCase())}
                  style={canEdit ? controlStyleFor(inputStyle, "containerNumber") : disabledStyle}
                  disabled={!canEdit}
                  placeholder="e.g. MSCU1234567"
                />
              </div>

              {/* PO Origin */}
              <div style={{ ...fieldStyle, gridColumn: "span 4" }}>
                <div
                  style={
                    highlightedRequiredFieldSet.has("portOfOrigin")
                      ? { ...labelStyle, color: "#b91c1c" }
                      : labelStyle
                  }
                >
                  Port of Origin
                </div>
                <select
                  value={draft.portOfOrigin}
                  onChange={(e) => setField("portOfOrigin", e.target.value)}
                  style={canEdit ? controlStyleFor(selectStyle, "portOfOrigin") : disabledStyle}
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
                <div
                  style={
                    highlightedRequiredFieldSet.has("destinationPort")
                      ? { ...labelStyle, color: "#b91c1c" }
                      : labelStyle
                  }
                >
                  Destination Port
                  <span style={requiredAsteriskStyle} title="This field is required">*</span>
                </div>
                <select
                  value={draft.destinationPort}
                  onChange={(e) => setField("destinationPort", e.target.value)}
                  style={canEdit ? controlStyleFor(selectStyle, "destinationPort") : disabledStyle}
                  disabled={!canEdit}
                >
                  <option value="">—</option>
                  {destinationPortsSafe.map((o: LookupOption) => (
                    <option key={o.shortName} value={o.shortName}>
                      {o.displayName || o.shortName}
                    </option>
                  ))}
                </select>
              </div>

              <div style={{ ...fieldStyle, gridColumn: "span 4" }}>
                <div
                  style={
                    highlightedRequiredFieldSet.has("deliveryAddress")
                      ? { ...labelStyle, color: "#b91c1c" }
                      : labelStyle
                  }
                >
                  Delivery Address
                  <span style={requiredAsteriskStyle} title="This field is required">*</span>
                </div>
                <select
                  value={draft.deliveryAddress}
                  onChange={(e) => setField("deliveryAddress", e.target.value)}
                  style={canEdit ? controlStyleFor(selectStyle, "deliveryAddress") : disabledStyle}
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

          {/* Documentation Uploads */}
          <div style={{ ...cardStyle, marginBottom: 12 }} className="shipment-details-card">
            <div style={sectionTitleStyle}>Documentation (PDF only, max 20MB for uploads)</div>
            <div
              style={{ display: "grid", gridTemplateColumns: "repeat(12, 1fr)", gap: 12 }}
              className="shipment-doc-grid"
            >
              <div
                style={{
                  gridColumn: "span 6",
                  minHeight: 65,
                  border: "1px solid #e5e7eb",
                  borderRadius: 12,
                  padding: 12,
                  background: "#f8fafc",
                  ...cardStyleFor("packingList"),
                }}
              >
                <div
                  style={
                    highlightedRequiredFieldSet.has("packingList")
                      ? { ...labelStyle, marginBottom: 8, color: "#b91c1c" }
                      : { ...labelStyle, marginBottom: 8 }
                  }
                >
                  Packing List
                </div>
                {isReadOnlySupplierDocs ? (
                  existingPackingListUrl ? (
                    <a
                      href={existingPackingListUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ fontSize: 13, fontWeight: 700, color: "#2563eb", textDecoration: "underline" }}
                    >
                      {existingPackingListFileName || "View Packing List PDF"}
                    </a>
                  ) : (
                    <div style={{ fontSize: 13, color: "#64748b", fontWeight: 700 }}>Not yet added.</div>
                  )
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    {existingPackingListUrl && !packingListFile ? (
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 12,
                          background: "#f0fdf4",
                          border: "1px solid #bbf7d0",
                          borderRadius: 10,
                          padding: "10px 14px",
                        }}
                      >
                        <span style={{ fontSize: 13, fontWeight: 700, color: "#166534", flex: 1 }}>
                          {existingPackingListFileName || "Packing List uploaded"}
                        </span>
                        <a
                          href={existingPackingListUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 4,
                            padding: "6px 12px",
                            fontSize: 12,
                            fontWeight: 700,
                            color: "#16a34a",
                            background: "#fff",
                            border: "1px solid #16a34a",
                            borderRadius: 8,
                            textDecoration: "none",
                          }}
                        >
                          View
                        </a>
                      </div>
                    ) : null}

                    {packingListFile ? (
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 12,
                          background: "#eff6ff",
                          border: "1px solid #bfdbfe",
                          borderRadius: 10,
                          padding: "10px 14px",
                        }}
                      >
                        <span style={{ fontSize: 13, fontWeight: 700, color: "#1d4ed8", flex: 1 }}>
                          New file: {packingListFile.name}
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            clearClientValidation();
                            setPackingListFile(null);
                          }}
                          style={{
                            padding: "6px 12px",
                            fontSize: 12,
                            fontWeight: 700,
                            color: "#dc2626",
                            background: "#fff",
                            border: "1px solid #dc2626",
                            borderRadius: 8,
                            cursor: "pointer",
                          }}
                          disabled={isSaving}
                        >
                          Remove
                        </button>
                      </div>
                    ) : null}

                    {canEdit ? (
                      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                        <input
                          type="file"
                          accept="application/pdf"
                          disabled={isSaving}
                          onChange={(e) => {
                            clearClientValidation();
                            const f = e.target.files && e.target.files[0] ? e.target.files[0] : null;
                            setPackingListFile(f);
                          }}
                          style={{ fontSize: 13 }}
                        />
                      </div>
                    ) : null}
                    {!canEdit && !existingPackingListUrl && !packingListFile ? (
                      <div style={{ fontSize: 13, color: "#64748b", fontWeight: 700 }}>Not yet added.</div>
                    ) : null}
                  </div>
                )}
              </div>

              <div
                style={{
                  gridColumn: "span 6",
                  gridRow: "span 2",
                  minHeight: 130,
                  border: "1px solid #e5e7eb",
                  borderRadius: 12,
                  padding: 12,
                  background: "#f8fafc",
                }}
              >
                <div style={{ ...labelStyle, marginBottom: 8 }}>Notes</div>
                <textarea
                  value={draft.notes}
                  onChange={(e) => setField("notes", e.target.value)}
                  style={{
                    ...((canEdit ? inputStyle : disabledStyle) as any),
                    width: "100%",
                    minHeight: 130,
                    resize: "vertical",
                    fontFamily: "inherit",
                  }}
                  disabled={!canEdit}
                  placeholder="Add notes…"
                />
              </div>

              <div
                style={{
                  gridColumn: "span 6",
                  minHeight: 65,
                  border: "1px solid #e5e7eb",
                  borderRadius: 12,
                  padding: 12,
                  background: "#f8fafc",
                  ...cardStyleFor("commercialInvoice"),
                }}
              >
                <div
                  style={
                    highlightedRequiredFieldSet.has("commercialInvoice")
                      ? { ...labelStyle, marginBottom: 8, color: "#b91c1c" }
                      : { ...labelStyle, marginBottom: 8 }
                  }
                >
                  Commercial Invoice
                </div>
                {isReadOnlySupplierDocs ? (
                  existingCommercialInvoiceUrl ? (
                    <a
                      href={existingCommercialInvoiceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ fontSize: 13, fontWeight: 700, color: "#2563eb", textDecoration: "underline" }}
                    >
                      {existingCommercialInvoiceFileName || "View Commercial Invoice PDF"}
                    </a>
                  ) : (
                    <div style={{ fontSize: 13, color: "#64748b", fontWeight: 700 }}>Not yet added.</div>
                  )
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    {existingCommercialInvoiceUrl && !commercialInvoiceFile ? (
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 12,
                          background: "#f0fdf4",
                          border: "1px solid #bbf7d0",
                          borderRadius: 10,
                          padding: "10px 14px",
                        }}
                      >
                        <span style={{ fontSize: 13, fontWeight: 700, color: "#166534", flex: 1 }}>
                          {existingCommercialInvoiceFileName || "Commercial Invoice uploaded"}
                        </span>
                        <a
                          href={existingCommercialInvoiceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 4,
                            padding: "6px 12px",
                            fontSize: 12,
                            fontWeight: 700,
                            color: "#16a34a",
                            background: "#fff",
                            border: "1px solid #16a34a",
                            borderRadius: 8,
                            textDecoration: "none",
                          }}
                        >
                          View
                        </a>
                      </div>
                    ) : null}

                    {commercialInvoiceFile ? (
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 12,
                          background: "#eff6ff",
                          border: "1px solid #bfdbfe",
                          borderRadius: 10,
                          padding: "10px 14px",
                        }}
                      >
                        <span style={{ fontSize: 13, fontWeight: 700, color: "#1d4ed8", flex: 1 }}>
                          New file: {commercialInvoiceFile.name}
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            clearClientValidation();
                            setCommercialInvoiceFile(null);
                          }}
                          style={{
                            padding: "6px 12px",
                            fontSize: 12,
                            fontWeight: 700,
                            color: "#dc2626",
                            background: "#fff",
                            border: "1px solid #dc2626",
                            borderRadius: 8,
                            cursor: "pointer",
                          }}
                          disabled={isSaving}
                        >
                          Remove
                        </button>
                      </div>
                    ) : null}

                    {canEdit ? (
                      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                        <input
                          type="file"
                          accept="application/pdf"
                          disabled={isSaving}
                          onChange={(e) => {
                            clearClientValidation();
                            const f = e.target.files && e.target.files[0] ? e.target.files[0] : null;
                            setCommercialInvoiceFile(f);
                          }}
                          style={{ fontSize: 13 }}
                        />
                      </div>
                    ) : null}
                    {!canEdit && !existingCommercialInvoiceUrl && !commercialInvoiceFile ? (
                      <div style={{ fontSize: 13, color: "#64748b", fontWeight: 700 }}>Not yet added.</div>
                    ) : null}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Purchase Orders */}
          <div style={{ ...cardStyle, marginBottom: 12 }} className="shipment-details-card">
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
                className="shipment-po-grid"
              >
                {filteredPurchaseOrders.map((po: PurchaseOrderOption) => {
                  const checked =
                    Array.isArray(draft.purchaseOrderGIDs) && draft.purchaseOrderGIDs.includes(po.purchaseOrderGID);
                  const hasProForma = Boolean(po.proFormaInvoiceUrl);
                  const checkboxBlockedForMissingPi = !hasProForma;
                  const checkboxDisabled = !canEdit || checkboxBlockedForMissingPi;
                  const activationTooltip = checkboxBlockedForMissingPi
                    ? "A Pro-forma invoice is required to activate this purchase order.  Click the title to edit the Purchase Order."
                    : "";
                  const openPoInSystem = (e: React.MouseEvent) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onOpenPurchaseOrder?.(po.purchaseOrderGID, buildDraftShipment());
                  };
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
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 10,
                          cursor: checkboxDisabled ? "default" : "pointer",
                          flex: 1,
                        }}
                        title={activationTooltip}
                      >
                        <span title={activationTooltip}>
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={checkboxDisabled}
                            title={activationTooltip}
                            onChange={() => togglePo(po.purchaseOrderGID)}
                          />
                        </span>
                        <a
                          href="#"
                          onClick={openPoInSystem}
                          style={{
                            fontSize: 13,
                            fontWeight: 800,
                            color: hasProForma ? "#0f172a" : "#991b1b",
                            textDecoration: "underline",
                          }}
                        >
                          #{po.shortName}
                          {!hasProForma ? " (PI required)" : ""}
                        </a>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Products from Selected Purchase Orders */}
          {aggregatedProducts.length > 0 && (
            <div
              style={{ ...cardStyle, marginBottom: 12, ...cardStyleFor("thisContainerProducts") }}
              className="shipment-details-card"
            >
              <div style={sectionTitleStyle}>
                <span
                  style={
                    highlightedRequiredFieldSet.has("thisContainerProducts")
                      ? { color: "#b91c1c" }
                      : undefined
                  }
                >
                  Products from Selected Purchase Orders
                </span>
                <span style={{ fontSize: 12, color: "#64748b", fontWeight: 800 }}>
                  {aggregatedProducts.length} product{aggregatedProducts.length !== 1 ? "s" : ""}
                </span>
              </div>

              <div
                style={{
                  border: highlightedRequiredFieldSet.has("thisContainerProducts")
                    ? "1px solid #dc2626"
                    : "1px solid #e5e7eb",
                  borderRadius: 10,
                  overflowX: "auto",
                }}
              >
                <table
                  style={{ width: "max-content", minWidth: "100%", borderCollapse: "collapse", marginLeft: 0 }}
                  className="shipment-products-table"
                >
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
                          width: 320,
                          minWidth: 320,
                          whiteSpace: "nowrap",
                        }}
                      >
                        Product
                      </th>
                      {selectedPurchaseOrders.map((po) => (
                        <th
                          key={po.purchaseOrderGID}
                          style={{
                            textAlign: "center",
                            padding: "8px 10px",
                            fontSize: 12,
                            fontWeight: 800,
                            color: "#475569",
                            borderBottom: "1px solid #e5e7eb",
                            minWidth: 90,
                            whiteSpace: "nowrap",
                          }}
                        >
                          <div style={{ fontWeight: 800, textAlign: "center" }}>#{po.shortName}</div>
                          <div style={{ fontSize: 10, color: "#64748b", marginTop: 2 }}>(available)</div>
                        </th>
                      ))}
                      <th
                        style={{
                          textAlign: "center",
                          padding: "10px 12px",
                          fontSize: 12,
                          fontWeight: 800,
                          color: highlightedRequiredFieldSet.has("thisContainerProducts")
                            ? "#b91c1c"
                            : "#475569",
                          borderBottom: "1px solid #e5e7eb",
                          width: 130,
                          minWidth: 130,
                          position: "sticky",
                          right: 0,
                          zIndex: 4,
                          background: "#f8fafc",
                          boxShadow: "-1px 0 0 #e5e7eb",
                        }}
                        className="shipment-this-container-col"
                      >
                        This Container
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
                          data-label="Product"
                          style={{
                            padding: "10px 12px",
                            fontSize: 13,
                            width: 320,
                            minWidth: 320,
                            borderBottom:
                              idx < aggregatedProducts.length - 1
                                ? "1px solid #e5e7eb"
                                : "none",
                          }}
                        >
                          {(() => {
                            const sku = String(product.SKU || "").trim();
                            const title = titleWithoutSku(
                              String(product.displayName || product.shortName || ""),
                              sku
                            );
                            return (
                              <>
                                <div
                                  style={{
                                    fontWeight: 700,
                                    color: "#0f172a",
                                    whiteSpace: "normal",
                                    overflowWrap: "anywhere",
                                    wordBreak: "break-word",
                                    lineHeight: 1.3,
                                  }}
                                  title={title}
                                >
                                  {title}
                                </div>
                                <div style={{ fontSize: 11, color: "#64748b" }}>{sku || "—"}</div>
                              </>
                            );
                          })()}
                        </td>
                        {selectedPurchaseOrders.map((po) => {
                          const productId = String(product.rslModelID || "").trim();
                          const poGid = String(po.purchaseOrderGID || "").trim();
                          const baseQty = perPoProductQuantities.get(poGid)?.get(productId);
                          const row = poFieldQuantities[productId] || {};
                          const qtyRaw = typeof baseQty === "number"
                            ? String(row[poGid] ?? baseQty)
                            : "";
                          const selectedGids = Array.isArray(selectedPoFieldsByProduct[productId])
                            ? selectedPoFieldsByProduct[productId]
                            : [];
                          const isSelected = selectedGids.includes(poGid);
                          return (
                            <td
                              key={`${product.rslModelID}_${po.purchaseOrderGID}`}
                              data-label={`#${po.shortName}`}
                              style={{
                                padding: "10px 10px",
                                fontSize: 13,
                                color: "#0f172a",
                                textAlign: "center",
                                borderBottom:
                                  idx < aggregatedProducts.length - 1
                                    ? "1px solid #e5e7eb"
                                    : "none",
                              }}
                            >
                              {typeof baseQty === "number" ? (
                                <input
                                  type="number"
                                  min={0}
                                  max={baseQty}
                                  value={qtyRaw}
                                  onMouseDown={() => {
                                    poFieldFocusFromPointerRef.current = true;
                                  }}
                                  onClick={(e) => {
                                    selectPoField(productId, poGid, e.shiftKey);
                                    poFieldFocusFromPointerRef.current = false;
                                  }}
                                  onFocus={() => handlePoFieldFocus(productId, poGid)}
                                  onChange={(e) => updatePoFieldQuantity(productId, poGid, e.target.value)}
                                  onBlur={() => {
                                    validatePoFieldQuantityOnBlur(productId, poGid);
                                    poFieldFocusFromPointerRef.current = false;
                                  }}
                                  style={{
                                    ...inputStyle,
                                    width: 74,
                                    padding: "6px 8px",
                                    textAlign: "center",
                                    fontWeight: 700,
                                    border: isSelected ? "1px solid #1d4ed8" : "1px solid #94a3b8",
                                    boxShadow: isSelected
                                      ? "0 0 0 2px rgba(37,99,235,0.25)"
                                      : "0 0 0 2px rgba(148,163,184,0.18)",
                                    background: "#fff",
                                  }}
                                  disabled={!canEdit}
                                />
                              ) : null}
                            </td>
                          );
                        })}
                        <td
                          data-label="This Container"
                          style={{
                            padding: "6px 12px",
                            position: "sticky",
                            right: 0,
                            zIndex: 2,
                            background: idx % 2 === 0 ? "#fff" : "#fafafa",
                            boxShadow: "-1px 0 0 #e5e7eb",
                            borderBottom:
                              idx < aggregatedProducts.length - 1
                                ? "1px solid #e5e7eb"
                                : "none",
                          }}
                          className="shipment-this-container-col"
                        >
                          <input
                            type="number"
                            min={0}
                            value={productQuantities[product.rslModelID] ?? "0"}
                            onChange={(e) => updateThisContainerQuantity(product.rslModelID, e.target.value)}
                            onFocus={() => rememberPreviousProductQuantity(product.rslModelID)}
                            onBlur={() => validateProductQuantityOnBlur(product.rslModelID)}
                            placeholder="0"
                            style={{
                              ...inputStyle,
                              width: "100%",
                              padding: "8px 10px",
                              ...(highlightedRequiredFieldSet.has("thisContainerProducts")
                                ? { borderColor: "#dc2626", boxShadow: "0 0 0 2px rgba(220, 38, 38, 0.16)" }
                                : null),
                            }}
                            disabled={!canEdit}
                          />
                          {productQuantityErrors[product.rslModelID] ? (
                            <div style={{ marginTop: 4, color: "#b91c1c", fontSize: 11, fontWeight: 700 }}>
                              {productQuantityErrors[product.rslModelID]}
                            </div>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Dates */}
          <div style={{ ...cardStyle, marginBottom: 12 }} className="shipment-details-card">
            <div style={sectionTitleStyle}>Dates</div>

            <div style={gridStyle} className="shipment-details-grid">
              <div style={{ ...fieldStyle, gridColumn: "span 4" }}>
                <div
                  style={
                    highlightedRequiredFieldSet.has("cargoReadyDate")
                      ? { ...labelStyle, color: "#b91c1c" }
                      : labelStyle
                  }
                  title="Cargo-ready Date"
                >
                  CRD
                </div>
                <input
                  type="date"
                  value={draft.cargoReadyDate}
                  onChange={(e) => setField("cargoReadyDate", e.target.value)}
                  style={canEdit ? controlStyleFor(inputStyle, "cargoReadyDate") : disabledStyle}
                  disabled={!canEdit}
                />
              </div>

              <div style={{ ...fieldStyle, gridColumn: "span 4" }}>
                <div
                  style={
                    highlightedRequiredFieldSet.has("etd")
                      ? { ...labelStyle, color: "#b91c1c" }
                      : labelStyle
                  }
                  title="Estimated Time of Departure"
                >
                  ETD
                </div>
                <input
                  type="date"
                  value={draft.etd}
                  onChange={(e) => setField("etd", e.target.value)}
                  style={canEdit ? controlStyleFor(inputStyle, "etd") : disabledStyle}
                  disabled={!canEdit}
                />
              </div>

              <div style={{ ...fieldStyle, gridColumn: "span 4" }}>
                <div
                  style={
                    highlightedRequiredFieldSet.has("eta")
                      ? { ...labelStyle, color: "#b91c1c" }
                      : labelStyle
                  }
                  title="Estimated Time of Arrival"
                >
                  ETA
                  <span style={requiredAsteriskStyle} title="This field is required">*</span>
                </div>
                <input
                  type="date"
                  value={draft.eta}
                  onChange={(e) => setField("eta", e.target.value)}
                  style={canEdit ? controlStyleFor(inputStyle, "eta") : disabledStyle}
                  disabled={!canEdit}
                />
              </div>
            </div>
          </div>

          {/* Booking (moved BELOW Dates as requested) */}
          <div style={{ ...cardStyle, marginBottom: 12 }} className="shipment-details-card">
            <div style={sectionTitleStyle}>Booking</div>

            <div style={gridStyle} className="shipment-details-grid">
              <div style={{ ...fieldStyle, gridColumn: "span 4" }}>
                <div
                  style={
                    highlightedRequiredFieldSet.has("bookingAgent")
                      ? { ...labelStyle, color: "#b91c1c" }
                      : labelStyle
                  }
                >
                  Booking Agent
                </div>
                <select
                  value={draft.bookingAgent}
                  onChange={(e) => setField("bookingAgent", e.target.value)}
                  style={canEdit ? controlStyleFor(selectStyle, "bookingAgent") : disabledStyle}
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
                <div
                  style={
                    highlightedRequiredFieldSet.has("bookingNumber")
                      ? { ...labelStyle, color: "#b91c1c" }
                      : labelStyle
                  }
                >
                  Booking #
                </div>
                <input
                  value={draft.bookingNumber}
                  onChange={(e) => setField("bookingNumber", e.target.value)}
                  style={canEdit ? controlStyleFor(inputStyle, "bookingNumber") : disabledStyle}
                  disabled={!canEdit}
                  placeholder="Enter the booking number"
                />
              </div>

              <div style={{ ...fieldStyle, gridColumn: "span 4" }}>
                <div
                  style={
                    highlightedRequiredFieldSet.has("vesselName")
                      ? { ...labelStyle, color: "#b91c1c" }
                      : labelStyle
                  }
                >
                  Vessel Name
                </div>
                <input
                  value={draft.vesselName}
                  onChange={(e) => setField("vesselName", e.target.value)}
                  style={canEdit ? controlStyleFor(inputStyle, "vesselName") : disabledStyle}
                  disabled={!canEdit}
                  placeholder="Vessel transporting this container"
                />
              </div>

            </div>
          </div>

          {/* Notes entered at creation, shown read-only in update mode */}
          {!isCreate && norm((shipment as any).notes) && (
            <div style={{ ...cardStyle, marginBottom: 12 }} className="shipment-details-card">
              <div style={sectionTitleStyle}>Notes</div>
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

          {/* History (update mode only) */}
          {!isCreate && (
            <div style={{ ...cardStyle, marginBottom: 12 }} className="shipment-details-card">
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
                                  <span style={{ color: "#dc2626" }}>
                                    {renderChangeValue(change.field, change.from, "#dc2626")}
                                  </span>
                                  {" → "}
                                  <span style={{ color: "#16a34a" }}>
                                    {renderChangeValue(change.field, change.to, "#16a34a")}
                                  </span>
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
          )}
        </div>

      </div>
    </div>
  );
}
