// app/logistics-ui/components/PurchaseOrderDetailsModal.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { X, Trash2, Save } from "lucide-react";

export type CompanyOption = {
  shortName: string;
  displayName?: string | null;
};

export type RslModelOption = {
  shortName: string;
  displayName: string;
  SKU: string;
};

export type UIPurchaseOrderProduct = {
  // UI still refers to this as rslModelID, but it maps to tlkp_rslProduct.shortName in the DB.
  rslModelID: string;
  shortName?: string;
  displayName?: string;
  title?: string;
  SKU?: string | null;
  initialQuantity?: number;
  committedQuantity?: number;

  // Join table includes quantity, but for this app flow we treat it as an association only.
  // Keep it optional for backward-compat.
  quantity?: number;

  // Accept alternative naming from server payloads
  rslProductID?: string;
};

export type UIPurchaseOrderNote = {
  id: string;
  timestamp: string; // ISO
  content: string;
  eventType?: string | null;
  pdfUrl?: string | null;
  pdfFileName?: string | null;

  // displayName for the user who authored it
  user?: string | null;
};

export type UIPurchaseOrder = {
  id?: string | number;
  shortName: string;
  purchaseOrderGID: string;

  purchaseOrderPdfUrl?: string | null;
  proFormaInvoiceUrl?: string | null;
  originalPoDate?: string | Date | null;

  createdAt?: string | Date | null;
  updatedAt?: string | Date | null;

  companyID?: string | null;
  companyName?: string | null;
  deliveryAddressID?: string | null;
  deliveryAddressName?: string | null;

  lastUpdatedBy?: string | null;

  // Products assigned to this PO (association only)
  products?: UIPurchaseOrderProduct[];

  notes?: UIPurchaseOrderNote[];
};

export type PdfSupplierCandidate = {
  name?: string | null;
  rawLines?: string[] | null;
  address1?: string | null;
  address2?: string | null;
  city?: string | null;
  province?: string | null;
  postalCode?: string | null;
  country?: string | null;
  email?: string | null;
  phone?: string | null;
  supplierCurrency?: string | null;
};

export type PdfShipToCandidate = {
  displayName?: string | null;
  rawLines?: string[] | null;
};

type SaveMode = "create" | "update";

type CurrentUser = {
  id?: string | number;
  name?: string | null;
  displayName?: string | null;
  email?: string;
};

interface PurchaseOrderDetailsModalProps {
  mode: "create" | "view";

  purchaseOrder: UIPurchaseOrder;
  companies: CompanyOption[];
  deliveryAddresses?: CompanyOption[];
  rslModels: RslModelOption[];
  currentUser?: CurrentUser | null;

  // Supplier-limited mode: read-only fields, but allow Pro Forma upload + note on existing POs.
  viewOnly?: boolean;
  showDebugInfo?: boolean;

  isSaving?: boolean;
  error?: string | null;
  initialPdfFile?: File | null;
  createSupplierCandidate?: PdfSupplierCandidate | null;
  matchedCompany?: CompanyOption | null;
  createShipToCandidate?: PdfShipToCandidate | null;
  matchedDeliveryAddress?: CompanyOption | null;

  onClose: () => void;
  onReturnToContainer?: () => void;
  showReturnToContainer?: boolean;

  onSave: (
    saveMode: SaveMode,
    payload: {
      purchaseOrder: UIPurchaseOrder;
      companyID: string;
      deliveryAddressID?: string | null;
      note?: string | null;
      pdfFile?: File | null;
      proFormaFile?: File | null;
    }
  ) => Promise<void> | void;

  onDelete?: (purchaseOrder: UIPurchaseOrder) => Promise<void> | void;
  onCreateCompanyFromSupplier?: (supplier: PdfSupplierCandidate) => Promise<CompanyOption | null> | CompanyOption | null;
  onUpdateCompanyFromSupplier?: (
    companyID: string,
    supplier: PdfSupplierCandidate
  ) => Promise<CompanyOption | null> | CompanyOption | null;
  onCreateDeliveryAddressFromShipTo?: (shipTo: PdfShipToCandidate) => Promise<CompanyOption | null> | CompanyOption | null;
  onUpdateDeliveryAddressFromShipTo?: (
    deliveryAddressID: string,
    shipTo: PdfShipToCandidate
  ) => Promise<CompanyOption | null> | CompanyOption | null;
  onValidatePdfFile?: (
    file: File
  ) =>
    | Promise<{ ok: boolean; error?: string | null; analysis?: any }>
    | { ok: boolean; error?: string | null; analysis?: any };
}

function safeStr(v: unknown) {
  return String(v ?? "").trim();
}

function fmtDate(isoOrDate?: string | Date | null) {
  if (!isoOrDate) return "-";
  const d = isoOrDate instanceof Date ? isoOrDate : new Date(String(isoOrDate));
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleString();
}

function fmtDateOnly(isoOrDate?: string | Date | null) {
  if (!isoOrDate) return "-";
  const d = isoOrDate instanceof Date ? isoOrDate : new Date(String(isoOrDate));
  if (Number.isNaN(d.getTime())) return "-";
  // Keep the stored date stable across browser time zones.
  return d.toLocaleDateString(undefined, { timeZone: "UTC" });
}

function displayEventType(t?: string | null) {
  const s = safeStr(t);
  if (!s) return "Note";
  if (s === "PDF_UPDATE") return "New PDF Uploaded";
  if (s === "PRO_FORMA_INVOICE_UPDATE") return "Pro Forma Invoice Updated";
  if (s === "PO Created") return "PO Created";
  if (s === "NOTE") return "Note";
  return s;
}

function uniqStrings(arr: unknown[]) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of arr || []) {
    const s = safeStr(v);
    if (!s) continue;
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

function normalizeSelectedIdsFromPo(po?: UIPurchaseOrder | null) {
  const incoming = Array.isArray(po?.products) ? po!.products! : [];
  const ids = incoming
    // Never auto-select placeholder/non-mapped rows.
    .map((p) => safeStr(p?.rslModelID || p?.rslProductID))
    .filter(Boolean);
  return uniqStrings(ids);
}

function primaryProductTitle(product?: UIPurchaseOrderProduct | null) {
  return (
    safeStr(product?.title) ||
    safeStr(product?.displayName) ||
    safeStr(product?.shortName) ||
    "-"
  );
}

function setsEqual(a: Set<string>, b: Set<string>) {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}

// -----------------------------------------------------------------------------
// Styles
// -----------------------------------------------------------------------------

const overlayStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(15, 23, 42, 0.55)",
  display: "flex",
  justifyContent: "center",
  alignItems: "center",
  padding: 18,
  zIndex: 9999,
};

const modalStyle: React.CSSProperties = {
  width: "min(980px, 96vw)",
  maxHeight: "90vh",
  overflow: "hidden",
  display: "flex",
  flexDirection: "column",
  background: "#fff",
  borderRadius: 14,
  border: "1px solid #e2e8f0",
  boxShadow: "0 18px 55px rgba(0,0,0,0.25)",
};

const headerStyle: React.CSSProperties = {
  padding: "14px 16px",
  borderBottom: "1px solid #e2e8f0",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
};

const titleStyle: React.CSSProperties = {
  fontSize: 15,
  fontWeight: 900,
  color: "#0f172a",
};

const closeBtnStyle: React.CSSProperties = {
  border: "1px solid #e2e8f0",
  background: "#fff",
  borderRadius: 10,
  padding: "8px 10px",
  cursor: "pointer",
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  fontWeight: 900,
};

const returnBtnStyle: React.CSSProperties = {
  ...closeBtnStyle,
  border: "none",
  background: "#2563eb",
  color: "#fff",
};

// Scroll container for modal content. Footer stays visible.
const bodyStyle: React.CSSProperties = {
  padding: 16,
  overflow: "auto",
  flex: 1,
  minHeight: 0,
};

const gridStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
  gap: 12,
};

const fieldStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
};

const labelStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 900,
  color: "#0f172a",
};

const inputStyle: React.CSSProperties = {
  border: "1px solid #e2e8f0",
  borderRadius: 10,
  padding: "10px 12px",
  fontSize: 13,
  outline: "none",
};

const readOnlyBoxStyle: React.CSSProperties = {
  ...inputStyle,
  background: "#f8fafc",
  color: "#0f172a",
};

const helperStyle: React.CSSProperties = { fontSize: 12, color: "#64748b" };

const inlinePromptStyle: React.CSSProperties = {
  marginTop: 6,
  border: "1px solid #cbd5e1",
  borderRadius: 10,
  background: "#f8fafc",
  padding: 10,
  display: "flex",
  flexDirection: "column",
  gap: 8,
};

const inlinePromptActionsStyle: React.CSSProperties = {
  display: "flex",
  gap: 8,
  alignItems: "center",
  justifyContent: "flex-end",
};

const promptBtnYesStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  padding: "6px 10px",
  borderRadius: 10,
  fontWeight: 900,
  cursor: "pointer",
  fontSize: 12,
  background: "#2563eb",
  color: "#fff",
  border: "none",
};

const promptBtnNoStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  padding: "6px 10px",
  borderRadius: 10,
  fontWeight: 900,
  cursor: "pointer",
  fontSize: 12,
  border: "1px solid #e2e8f0",
  background: "#fff",
  color: "#0f172a",
};

const footerStyle: React.CSSProperties = {
  padding: "14px 16px",
  borderTop: "1px solid #e2e8f0",
  background: "#fff",
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 10,
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
  fontWeight: 900,
  cursor: "pointer",
};

const primaryBtnStyle: React.CSSProperties = {
  ...btnStyle,
  border: "none",
  background: "#2563eb",
  color: "#fff",
};

const dangerBtnStyle: React.CSSProperties = {
  ...btnStyle,
  border: "1px solid #fecaca",
  background: "#fef2f2",
  color: "#991b1b",
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

const sectionTitleStyle: React.CSSProperties = {
  marginTop: 16,
  marginBottom: 10,
  fontSize: 13,
  fontWeight: 900,
  color: "#0f172a",
};

const historyItemStyle: React.CSSProperties = {
  border: "1px solid #e2e8f0",
  borderRadius: 12,
  padding: 12,
  background: "#fff",
  marginBottom: 10,
};

// History should scroll independently so the button row stays visible.
const historyWrapStyle: React.CSSProperties = {
  border: "1px solid #e2e8f0",
  borderRadius: 12,
  background: "#fff",
  padding: 12,
  maxHeight: "32vh",
  minHeight: 120,
  overflow: "auto",
};

const productsTableWrapStyle: React.CSSProperties = {
  border: "1px solid #e2e8f0",
  borderRadius: 10,
  overflow: "hidden",
  background: "#fff",
};

const productsTableStyle: React.CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
};

const productsThStyle: React.CSSProperties = {
  textAlign: "left",
  padding: "10px 12px",
  background: "#f1f5f9",
  color: "#334155",
  fontSize: 12,
  fontWeight: 900,
  borderBottom: "1px solid #e2e8f0",
};

const productsTdStyle: React.CSSProperties = {
  padding: "10px 12px",
  borderBottom: "1px solid #e2e8f0",
  fontSize: 13,
  color: "#0f172a",
  verticalAlign: "top",
};

export function PurchaseOrderDetailsModal({
                                            mode,
                                            purchaseOrder,
                                            companies,
                                            deliveryAddresses = [],
                                            rslModels,
                                            currentUser,
                                            viewOnly = false,
                                            showDebugInfo = false,
                                            isSaving = false,
                                            error = null,
                                            initialPdfFile = null,
                                            createSupplierCandidate = null,
                                            matchedCompany = null,
                                            createShipToCandidate = null,
                                            matchedDeliveryAddress = null,
                                            onClose,
                                            onReturnToContainer,
                                            showReturnToContainer = false,
                                            onSave,
                                            onDelete,
                                            onCreateCompanyFromSupplier,
                                            onCreateDeliveryAddressFromShipTo,
                                            onUpdateCompanyFromSupplier,
                                            onUpdateDeliveryAddressFromShipTo,
                                            onValidatePdfFile,
                                          }: PurchaseOrderDetailsModalProps) {
  const isCreate = mode === "create";
  const saveMode: SaveMode = isCreate ? "create" : "update";
  const ADD_SUPPLIER_OPTION = "__ADD_SUPPLIER_FROM_PDF__";
  const ADD_SHIP_TO_OPTION = "__ADD_SHIP_TO_FROM_PDF__";

  const [poNumber, setPoNumber] = useState<string>(safeStr(purchaseOrder.shortName));
  const confirmedPoNumberRef = useRef<string>(safeStr(purchaseOrder.shortName));
  const [gid, setGid] = useState<string>(safeStr(purchaseOrder.purchaseOrderGID));
  const [originalPoDate, setOriginalPoDate] = useState<string>(safeStr(purchaseOrder.originalPoDate));
  const [companyID, setCompanyID] = useState<string>(safeStr(purchaseOrder.companyID));
  const [deliveryAddressID, setDeliveryAddressID] = useState<string>(safeStr(purchaseOrder.deliveryAddressID));
  const [companyLockedForCreate, setCompanyLockedForCreate] = useState<boolean>(false);
  const [deliveryAddressLockedForCreate, setDeliveryAddressLockedForCreate] = useState<boolean>(false);
  const [companyCreateError, setCompanyCreateError] = useState<string | null>(null);
  const [deliveryAddressCreateError, setDeliveryAddressCreateError] = useState<string | null>(null);
  const [isCreatingCompany, setIsCreatingCompany] = useState<boolean>(false);
  const [isCreatingDeliveryAddress, setIsCreatingDeliveryAddress] = useState<boolean>(false);
  const [pendingCompanyUpdateChoice, setPendingCompanyUpdateChoice] = useState<string | null>(null);
  const [pendingDeliveryAddressUpdateChoice, setPendingDeliveryAddressUpdateChoice] = useState<string | null>(null);
  const [note, setNote] = useState<string>("");
  const [pdfFile, setPdfFile] = useState<File | null>(initialPdfFile || null);
  const [proFormaFile, setProFormaFile] = useState<File | null>(null);
  const [draftProducts, setDraftProducts] = useState<UIPurchaseOrderProduct[]>(
    Array.isArray(purchaseOrder.products) ? purchaseOrder.products : []
  );
  const [isValidatingPdf, setIsValidatingPdf] = useState<boolean>(false);
  const [pdfValidationError, setPdfValidationError] = useState<string | null>(null);
  const [pdfValidationMessage, setPdfValidationMessage] = useState<string | null>(null);
  const showReturnToContainerControl = Boolean(showReturnToContainer && onReturnToContainer);

  const rslModelMap = useMemo(() => {
    const m = new Map<string, RslModelOption>();
    for (const x of rslModels || []) {
      const id = safeStr(x?.shortName);
      if (id) m.set(id, x);
    }
    return m;
  }, [rslModels]);

  // Product association selection
  const baselineSelectedRef = useRef<Set<string>>(new Set());
  const [selectedSet, setSelectedSet] = useState<Set<string>>(() => {
    const ids = normalizeSelectedIdsFromPo(purchaseOrder);
    return new Set(ids);
  });

  // Reset modal state when switching POs/modes
  useEffect(() => {
    if (showDebugInfo) return;
    setPendingCompanyUpdateChoice(null);
    setPendingDeliveryAddressUpdateChoice(null);
  }, [showDebugInfo]);

  useEffect(() => {
    const matchedCompanyID = isCreate ? safeStr(matchedCompany?.shortName) : "";
    const matchedDeliveryAddressID = isCreate ? safeStr(matchedDeliveryAddress?.shortName) : "";
    const initialCompany = matchedCompanyID || safeStr(purchaseOrder.companyID);
    const initialDeliveryAddress = matchedDeliveryAddressID || safeStr(purchaseOrder.deliveryAddressID);

    const nextPoNumber = safeStr(purchaseOrder.shortName);
    setPoNumber(nextPoNumber);
    confirmedPoNumberRef.current = nextPoNumber;
    setGid(safeStr(purchaseOrder.purchaseOrderGID));
    setOriginalPoDate(safeStr(purchaseOrder.originalPoDate));
    setCompanyID(initialCompany);
    setDeliveryAddressID(initialDeliveryAddress);
    setCompanyLockedForCreate(Boolean(isCreate && matchedCompanyID));
    setDeliveryAddressLockedForCreate(Boolean(isCreate && matchedDeliveryAddressID));
    setCompanyCreateError(null);
    setDeliveryAddressCreateError(null);
    setIsCreatingCompany(false);
    setIsCreatingDeliveryAddress(false);
    setPendingCompanyUpdateChoice(null);
    setPendingDeliveryAddressUpdateChoice(null);
    setNote("");
    setPdfFile(initialPdfFile || null);
    setProFormaFile(null);
    setDraftProducts(Array.isArray(purchaseOrder.products) ? purchaseOrder.products : []);
    setIsValidatingPdf(false);
    setPdfValidationError(null);
    setPdfValidationMessage(null);

    const ids = normalizeSelectedIdsFromPo(purchaseOrder);
    const next = new Set(ids);
    setSelectedSet(next);
    baselineSelectedRef.current = new Set(ids);
  }, [
    isCreate,
    matchedCompany?.shortName,
    matchedDeliveryAddress?.shortName,
    mode,
    purchaseOrder?.purchaseOrderGID,
    purchaseOrder?.id,
    purchaseOrder?.companyID,
    purchaseOrder?.deliveryAddressID,
    purchaseOrder?.originalPoDate,
    initialPdfFile,
  ]);

  const selectedCount = selectedSet.size;

  const productsChanged = useMemo(() => {
    return !setsEqual(selectedSet, baselineSelectedRef.current);
  }, [selectedSet]);

  const companyDisplay = useMemo(() => {
    const cid = safeStr(companyID) || safeStr(purchaseOrder.companyID);
    const match = (companies || []).find((c) => safeStr(c.shortName) === cid);
    if (match) return safeStr(match.displayName || match.shortName);
    if (purchaseOrder.companyName) {
      const s = safeStr(purchaseOrder.companyName);
      const idx = s.indexOf(" (");
      return idx > 0 ? s.slice(0, idx).trim() : s;
    }
    return cid || "-";
  }, [companyID, purchaseOrder.companyID, purchaseOrder.companyName, companies]);

  const deliveryAddressDisplay = useMemo(() => {
    const did = safeStr(deliveryAddressID) || safeStr(purchaseOrder.deliveryAddressID);
    const match = (deliveryAddresses || []).find((d) => safeStr(d.shortName) === did);
    if (match) return safeStr(match.displayName || match.shortName);
    if (purchaseOrder.deliveryAddressName) {
      return safeStr(purchaseOrder.deliveryAddressName);
    }
    return did || "-";
  }, [deliveryAddressID, purchaseOrder.deliveryAddressID, purchaseOrder.deliveryAddressName, deliveryAddresses]);

  const currentPdfUrl = safeStr(purchaseOrder.purchaseOrderPdfUrl);
  const currentProFormaUrl = safeStr(purchaseOrder.proFormaInvoiceUrl);
  const originalPoDateText = fmtDateOnly(originalPoDate || purchaseOrder.originalPoDate);
  const createdText = fmtDate(purchaseOrder.createdAt);
  const updatedText = fmtDate(purchaseOrder.updatedAt);
  const poProducts = Array.isArray(draftProducts) ? draftProducts : [];
  const unmatchedCount = poProducts.filter(
    (p) => {
      const hasSku = Boolean(safeStr(p?.SKU));
      const hasMappedId = Boolean(safeStr(p?.rslModelID || p?.rslProductID || p?.shortName));
      return hasSku && !hasMappedId;
    }
  ).length;
  const showCompanyUnmatchedWarning =
    isCreate &&
    !companyLockedForCreate &&
    Boolean(safeStr(createSupplierCandidate?.name)) &&
    !Boolean(safeStr(companyID));
  const showShipToUnmatchedWarning =
    isCreate &&
    !deliveryAddressLockedForCreate &&
    Boolean(safeStr(createShipToCandidate?.displayName)) &&
    !Boolean(safeStr(deliveryAddressID));
  const showCompanyUpdatePrompt =
    isCreate &&
    !companyLockedForCreate &&
    Boolean(safeStr(createSupplierCandidate?.name)) &&
    Boolean(safeStr(companyID)) &&
    Boolean(safeStr(pendingCompanyUpdateChoice));
  const showShipToUpdatePrompt =
    isCreate &&
    !deliveryAddressLockedForCreate &&
    Boolean(safeStr(createShipToCandidate?.displayName)) &&
    Boolean(safeStr(deliveryAddressID)) &&
    Boolean(safeStr(pendingDeliveryAddressUpdateChoice));
  const supplierProFormaOnlyMode = viewOnly && !isCreate;
  const showProFormaUploadControl = !viewOnly || supplierProFormaOnlyMode;
  const showNoteField = !viewOnly || (supplierProFormaOnlyMode && Boolean(proFormaFile));
  const showSaveControl = !viewOnly || supplierProFormaOnlyMode;
  const proFormaFieldStyle: React.CSSProperties = isCreate
    ? { ...fieldStyle, gridColumn: showNoteField ? "1 / span 2" : "1 / -1" }
    : fieldStyle;
  const hasPendingFileUpload = !isCreate && (Boolean(pdfFile) || Boolean(proFormaFile));
  const notePlaceholder = hasPendingFileUpload ? "Note required." : "Optional Note...";
  const canSave = useMemo(() => {
    if (isSaving || isCreatingCompany || isCreatingDeliveryAddress || isValidatingPdf) return false;
    if (safeStr(pendingCompanyUpdateChoice) || safeStr(pendingDeliveryAddressUpdateChoice)) return false;

    if (supplierProFormaOnlyMode) {
      return Boolean(proFormaFile) && Boolean(safeStr(note));
    }

    if (saveMode === "create") {
      return Boolean(safeStr(poNumber) && safeStr(companyID) && safeStr(deliveryAddressID));
    }

    // update:
    // - allow if note OR PO PDF upload OR Pro Forma upload OR products changed
    const noteOk = Boolean(safeStr(note));
    const hasPdfUpload = Boolean(pdfFile);
    const hasProFormaUpload = Boolean(proFormaFile);
    if (!isCreate && hasPdfUpload && !noteOk) return false;
    if (!isCreate && hasProFormaUpload && !noteOk) return false;
    return noteOk || hasPdfUpload || hasProFormaUpload || productsChanged;
  }, [
    isSaving,
    isCreatingCompany,
    isCreatingDeliveryAddress,
    isValidatingPdf,
    saveMode,
    poNumber,
    companyID,
    deliveryAddressID,
    note,
    pdfFile,
    proFormaFile,
    isCreate,
    pendingCompanyUpdateChoice,
    pendingDeliveryAddressUpdateChoice,
    productsChanged,
    supplierProFormaOnlyMode,
  ]);

  const handleReplacementPdfSelection = async (file: File | null, inputEl?: HTMLInputElement | null) => {
    setPdfValidationError(null);
    setPdfValidationMessage(null);

    if (!file) {
      setPdfFile(null);
      return;
    }

    if (!onValidatePdfFile) {
      setPdfFile(file);
      return;
    }

    setIsValidatingPdf(true);
    try {
      const result = await onValidatePdfFile(file);
      if (!result?.ok) {
        setPdfFile(null);
        if (inputEl) inputEl.value = "";
        setPdfValidationError(safeStr(result?.error) || "Uploaded PDF did not pass validation.");
        return;
      }

      setPdfFile(file);
      const extracted = Number(result?.analysis?.extractedCount || 0);
      const matched = Number(result?.analysis?.matchedCount || 0);
      setPdfValidationMessage(
        showDebugInfo
          ? `PDF validated. ${extracted} line item(s) detected; ${matched} matched.`
          : "PDF validated."
      );

      if (isCreate && result?.analysis) {
        const analysis = result.analysis;

        const nextPoNumber = safeStr(analysis?.purchaseOrderNumberCandidate);
        if (nextPoNumber) {
          setPoNumber(nextPoNumber);
          confirmedPoNumberRef.current = nextPoNumber;
        }

        const nextOriginalPoDate = safeStr(analysis?.originalPoDateCandidate);
        if (nextOriginalPoDate) setOriginalPoDate(nextOriginalPoDate);

        const nextPurchaseOrderGID = safeStr(analysis?.purchaseOrderGIDCandidate);
        if (nextPurchaseOrderGID) setGid(nextPurchaseOrderGID);

        const nextCompanyID = safeStr(analysis?.matchedCompany?.shortName);
        if (nextCompanyID) {
          setCompanyID(nextCompanyID);
          setCompanyLockedForCreate(true);
        } else {
          setCompanyLockedForCreate(false);
        }

        const nextDeliveryAddressID = safeStr(analysis?.matchedDeliveryAddress?.shortName);
        if (nextDeliveryAddressID) {
          setDeliveryAddressID(nextDeliveryAddressID);
          setDeliveryAddressLockedForCreate(true);
        } else {
          setDeliveryAddressLockedForCreate(false);
        }

        const analyzedRows: UIPurchaseOrderProduct[] = Array.isArray(analysis?.products)
          ? analysis.products.map((item: any, idx: number) => {
            const matchedId = safeStr(item?.rslProductID);
            const title = safeStr(item?.title);
            return {
              rslModelID: matchedId,
              rslProductID: matchedId || undefined,
              shortName: matchedId || "",
              displayName: title || safeStr(item?.rslProductName) || `Line ${idx + 1}`,
              title: title || safeStr(item?.rslProductName) || `Line ${idx + 1}`,
              SKU: safeStr(item?.sku) || null,
              quantity: typeof item?.quantity === "number" ? item.quantity : 0,
            };
          })
          : [];
        setDraftProducts(analyzedRows);

        const nextSelectedIds = uniqStrings(
          Array.isArray(analysis?.selectedProductIDs)
            ? analysis.selectedProductIDs.map((x: unknown) => safeStr(x)).filter(Boolean)
            : analyzedRows
              .map((row) => safeStr(row?.rslModelID || row?.rslProductID || row?.shortName))
              .filter(Boolean)
        );
        const nextSelectedSet = new Set(nextSelectedIds);
        setSelectedSet(nextSelectedSet);
        baselineSelectedRef.current = new Set(nextSelectedIds);
        setPendingCompanyUpdateChoice(null);
        setPendingDeliveryAddressUpdateChoice(null);
      }
    } catch (err: any) {
      setPdfFile(null);
      if (inputEl) inputEl.value = "";
      setPdfValidationError(safeStr(err?.message) || "Unable to validate the selected PDF.");
    } finally {
      setIsValidatingPdf(false);
    }
  };

  const createCompanyFromSupplier = async () => {
    if (!isCreate) return;
    if (!createSupplierCandidate?.name) {
      setCompanyCreateError("No supplier name was detected in the uploaded PDF.");
      return;
    }
    if (!onCreateCompanyFromSupplier) {
      setCompanyCreateError("Supplier creation is not available.");
      return;
    }

    setCompanyCreateError(null);
    setPendingCompanyUpdateChoice(null);
    setIsCreatingCompany(true);
    try {
      const created = await onCreateCompanyFromSupplier(createSupplierCandidate);
      const createdId = safeStr(created?.shortName);
      if (!createdId) throw new Error("Supplier was created but no company ID was returned.");
      setCompanyID(createdId);
      setCompanyLockedForCreate(true);
    } catch (e: any) {
      setCompanyCreateError(e?.message || "Unable to create supplier.");
    } finally {
      setIsCreatingCompany(false);
    }
  };

  const createDeliveryAddressFromShipTo = async () => {
    if (!isCreate) return;
    if (!createShipToCandidate?.displayName) {
      setDeliveryAddressCreateError("No Ship To address was detected in the uploaded PDF.");
      return;
    }
    if (!onCreateDeliveryAddressFromShipTo) {
      setDeliveryAddressCreateError("Delivery address creation is not available.");
      return;
    }

    setDeliveryAddressCreateError(null);
    setPendingDeliveryAddressUpdateChoice(null);
    setIsCreatingDeliveryAddress(true);
    try {
      const created = await onCreateDeliveryAddressFromShipTo(createShipToCandidate);
      const createdId = safeStr(created?.shortName);
      if (!createdId) throw new Error("Delivery address was created but no ID was returned.");
      setDeliveryAddressID(createdId);
      setDeliveryAddressLockedForCreate(true);
    } catch (e: any) {
      setDeliveryAddressCreateError(e?.message || "Unable to create delivery address.");
    } finally {
      setIsCreatingDeliveryAddress(false);
    }
  };

  const selectExistingCompany = async (nextValue: string) => {
    setCompanyCreateError(null);
    setCompanyID(nextValue);
    setPendingCompanyUpdateChoice(null);

    if (
      !isCreate ||
      !nextValue ||
      !showDebugInfo ||
      companyLockedForCreate ||
      !safeStr(createSupplierCandidate?.name) ||
      !onUpdateCompanyFromSupplier
    ) {
      return;
    }

    setPendingCompanyUpdateChoice(nextValue);
  };

  const confirmCompanyUpdateFromSupplier = async () => {
    const companyChoice = safeStr(pendingCompanyUpdateChoice);
    if (!companyChoice || !createSupplierCandidate || !onUpdateCompanyFromSupplier) return;

    setIsCreatingCompany(true);
    try {
      await onUpdateCompanyFromSupplier(companyChoice, createSupplierCandidate);
      setCompanyID(companyChoice);
      setCompanyLockedForCreate(true);
      setCompanyCreateError(null);
      setPendingCompanyUpdateChoice(null);
    } catch (e: any) {
      setCompanyCreateError(e?.message || "Unable to update selected company.");
    } finally {
      setIsCreatingCompany(false);
    }
  };

  const selectExistingDeliveryAddress = async (nextValue: string) => {
    setDeliveryAddressCreateError(null);
    setDeliveryAddressID(nextValue);
    setPendingDeliveryAddressUpdateChoice(null);

    if (
      !isCreate ||
      !nextValue ||
      !showDebugInfo ||
      deliveryAddressLockedForCreate ||
      !safeStr(createShipToCandidate?.displayName) ||
      !onUpdateDeliveryAddressFromShipTo
    ) {
      return;
    }

    setPendingDeliveryAddressUpdateChoice(nextValue);
  };

  const confirmDeliveryAddressUpdateFromShipTo = async () => {
    const deliveryChoice = safeStr(pendingDeliveryAddressUpdateChoice);
    if (!deliveryChoice || !createShipToCandidate || !onUpdateDeliveryAddressFromShipTo) return;

    setIsCreatingDeliveryAddress(true);
    try {
      await onUpdateDeliveryAddressFromShipTo(deliveryChoice, createShipToCandidate);
      setDeliveryAddressID(deliveryChoice);
      setDeliveryAddressLockedForCreate(true);
      setDeliveryAddressCreateError(null);
      setPendingDeliveryAddressUpdateChoice(null);
    } catch (e: any) {
      setDeliveryAddressCreateError(e?.message || "Unable to update selected delivery address.");
    } finally {
      setIsCreatingDeliveryAddress(false);
    }
  };

  const submit = async () => {
    const trimmedPo = safeStr(poNumber);
    const trimmedGid = safeStr(gid);
    const resolvedGid = trimmedGid || safeStr(purchaseOrder.purchaseOrderGID) || trimmedPo;
    const trimmedOriginalPoDate = safeStr(originalPoDate);
    const trimmedCompany = safeStr(companyID);
    const trimmedDeliveryAddress = safeStr(deliveryAddressID);
    const trimmedNote = safeStr(note);

    const allPoProducts: UIPurchaseOrderProduct[] = poProducts.map((p, idx) => {
      const mappedId = safeStr(p?.rslModelID || p?.rslProductID || p?.shortName);
      const meta = mappedId ? rslModelMap.get(mappedId) : null;
      const qtyRaw = Number(p?.quantity);
      const quantity = Number.isFinite(qtyRaw) ? Math.max(0, Math.trunc(qtyRaw)) : 0;
      const title = primaryProductTitle(p);
      return {
        rslModelID: mappedId,
        rslProductID: mappedId || undefined,
        shortName: mappedId || "",
        displayName: title || `Line ${idx + 1}`,
        title: title || `Line ${idx + 1}`,
        SKU: safeStr(p?.SKU) || meta?.SKU || null,
        quantity,
      };
    });

    const poToSave: UIPurchaseOrder = {
      ...purchaseOrder,
      shortName: trimmedPo || purchaseOrder.shortName,
      purchaseOrderGID: resolvedGid,
      originalPoDate: trimmedOriginalPoDate || purchaseOrder.originalPoDate || null,
      companyID: trimmedCompany || purchaseOrder.companyID || null,
      deliveryAddressID: trimmedDeliveryAddress || purchaseOrder.deliveryAddressID || null,
      products: allPoProducts,
    };

    await onSave(saveMode, {
      purchaseOrder: poToSave,
      companyID: trimmedCompany,
      deliveryAddressID: trimmedDeliveryAddress || null,
      note: trimmedNote ? trimmedNote : null,
      pdfFile,
      proFormaFile,
    });

    // clear transient fields after a successful save (parent updates selected PO)
    setNote("");
    setPdfFile(null);
    setProFormaFile(null);
    setPdfValidationError(null);
    setPdfValidationMessage(null);
  };

  const handlePoNumberBlur = () => {
    if (!isCreate) return;
    const nextPoNumber = safeStr(poNumber);
    const previousPoNumber = safeStr(confirmedPoNumberRef.current);
    if (nextPoNumber === previousPoNumber) return;
    const shouldKeepChange = window.confirm(
      "You are overriding the PO number on the PDF.  If this is what you meant to do, click CONFIRM.  Otherwise, cancel."
    );
    if (!shouldKeepChange) {
      setPoNumber(previousPoNumber);
      return;
    }
    confirmedPoNumberRef.current = nextPoNumber;
  };

  return (
    <div style={overlayStyle} onMouseDown={onClose}>
      <div style={modalStyle} onMouseDown={(e) => e.stopPropagation()}>
        <div style={headerStyle}>
          <div style={titleStyle}>{isCreate ? "Create Purchase Order" : "Purchase Order Details"}</div>

          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {showReturnToContainerControl ? (
              <button
                type="button"
                style={returnBtnStyle}
                onClick={onReturnToContainer}
                disabled={isSaving || isCreatingCompany || isCreatingDeliveryAddress}
              >
                Return to Container Details
              </button>
            ) : null}

            {!showReturnToContainerControl ? (
              <button
                type="button"
                style={closeBtnStyle}
                onClick={onClose}
                disabled={isSaving || isCreatingCompany || isCreatingDeliveryAddress}
              >
                <X size={16} />
                Close
              </button>
            ) : null}
          </div>
        </div>

        <div style={bodyStyle} className="po-details-body">
          <style>{`
            @media (max-width: 720px) {
              .po-details-grid {
                grid-template-columns: 1fr !important;
              }

              .po-products-list {
                column-count: 1 !important;
                column-width: auto !important;
              }

              .po-details-body {
                overflow-x: hidden;
              }
            }
          `}</style>
          {error ? <div style={errorStyle}>{error}</div> : null}

          <div style={gridStyle} className="po-details-grid">
            {/* Purchase Order */}
            <div style={fieldStyle}>
              <div style={labelStyle}>Purchase Order</div>

              {isCreate ? (
                <div style={{ display: "flex", alignItems: "center" }}>
                  <span
                    style={{
                      ...inputStyle,
                      borderRight: "none",
                      borderTopRightRadius: 0,
                      borderBottomRightRadius: 0,
                      background: "#f1f5f9",
                      color: "#64748b",
                      fontWeight: 700,
                      paddingRight: 8,
                    }}
                  >
                    #
                  </span>
                  <input
                    style={{
                      ...inputStyle,
                      borderTopLeftRadius: 0,
                      borderBottomLeftRadius: 0,
                      flex: 1,
                    }}
                    value={poNumber}
                    onChange={(e) => setPoNumber(e.target.value)}
                    onBlur={handlePoNumberBlur}
                    placeholder="Enter the PO number"
                    disabled={isSaving}
                  />
                </div>
              ) : (
                <div style={readOnlyBoxStyle}>
                  <span style={{ fontWeight: 900, color: "#0f172a" }}>
                    #{safeStr(purchaseOrder.shortName) || "-"}
                  </span>
                </div>
              )}
            </div>

            {/* Original PO Date */}
            <div style={fieldStyle}>
              <div style={labelStyle}>Original PO Date</div>
              <div style={readOnlyBoxStyle}>{originalPoDateText}</div>
            </div>

            <div style={fieldStyle}>
              <div style={labelStyle}>Created</div>
              <div style={readOnlyBoxStyle}>{createdText}</div>
            </div>

            {/* Company */}
            <div style={fieldStyle}>
              <div style={labelStyle}>Company</div>

              {isCreate ? (
                companyLockedForCreate ? (
                  <div style={readOnlyBoxStyle}>{companyDisplay}</div>
                ) : (
                  <select
                    style={inputStyle}
                    value={companyID}
                    onChange={(e) => {
                      const nextValue = e.target.value;
                      if (nextValue === ADD_SUPPLIER_OPTION) {
                        setPendingCompanyUpdateChoice(null);
                        void createCompanyFromSupplier();
                        return;
                      }
                      void selectExistingCompany(nextValue);
                    }}
                    disabled={isSaving || isCreatingCompany}
                  >
                    <option value="">Select a company…</option>
                    {(companies || []).map((c) => (
                      <option key={safeStr(c.shortName)} value={safeStr(c.shortName)}>
                        {safeStr(c.displayName) || safeStr(c.shortName)}
                      </option>
                    ))}
                    {safeStr(createSupplierCandidate?.name) && onCreateCompanyFromSupplier ? (
                      <option value={ADD_SUPPLIER_OPTION}>ADD THIS SUPPLIER AS NEW</option>
                    ) : null}
                  </select>
                )
              ) : (
                <div style={readOnlyBoxStyle}>{companyDisplay}</div>
              )}

              {isCreate && showDebugInfo ? (
                showCompanyUpdatePrompt ? (
                  <div style={inlinePromptStyle}>
                    <div style={helperStyle}>
                      Would you like to update the selected company to match the supplier details pulled from this PO?
                    </div>
                    <div style={inlinePromptActionsStyle}>
                      <button
                        type="button"
                        style={promptBtnNoStyle}
                        disabled={isCreatingCompany}
                        onClick={() => setPendingCompanyUpdateChoice(null)}
                      >
                        No
                      </button>
                      <button
                        type="button"
                        style={promptBtnYesStyle}
                        disabled={isCreatingCompany}
                        onClick={() => void confirmCompanyUpdateFromSupplier()}
                      >
                        {isCreatingCompany ? "Updating..." : "Yes"}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div
                    style={
                      showCompanyUnmatchedWarning
                        ? { ...helperStyle, color: "#7f1d1d" }
                        : helperStyle
                    }
                  >
                    {companyLockedForCreate
                      ? "Matched from supplier name in the uploaded PDF."
                      : showCompanyUnmatchedWarning
                        ? `Supplier detected but not matched in the PDF (${safeStr(createSupplierCandidate?.name)}).  You can either assign this to an existing supplier or add the supplier to the database.`
                        : safeStr(companyID)
                          ? "Selected company will be used for this purchase order."
                        : "Select the company for this purchase order."}
                  </div>
                )
              ) : null}
            {companyCreateError ? <div style={{ ...helperStyle, color: "#991b1b" }}>{companyCreateError}</div> : null}
            </div>

            {/* Ship To / Delivery Address */}
            <div style={fieldStyle}>
              <div style={labelStyle}>Ship To</div>

              {isCreate ? (
                deliveryAddressLockedForCreate ? (
                  <div style={readOnlyBoxStyle}>{deliveryAddressDisplay}</div>
                ) : (
                  <select
                    style={inputStyle}
                    value={deliveryAddressID}
                    onChange={(e) => {
                      const nextValue = e.target.value;
                      if (nextValue === ADD_SHIP_TO_OPTION) {
                        setPendingDeliveryAddressUpdateChoice(null);
                        void createDeliveryAddressFromShipTo();
                        return;
                      }
                      void selectExistingDeliveryAddress(nextValue);
                    }}
                    disabled={isSaving || isCreatingDeliveryAddress}
                  >
                    <option value="">Select a delivery address…</option>
                    {(deliveryAddresses || []).map((d) => (
                      <option key={safeStr(d.shortName)} value={safeStr(d.shortName)}>
                        {safeStr(d.displayName) || safeStr(d.shortName)}
                      </option>
                    ))}
                    {safeStr(createShipToCandidate?.displayName) && onCreateDeliveryAddressFromShipTo ? (
                      <option value={ADD_SHIP_TO_OPTION}>ADD THIS SHIP TO AS NEW</option>
                    ) : null}
                  </select>
                )
              ) : (
                <div style={readOnlyBoxStyle}>{deliveryAddressDisplay}</div>
              )}

              {isCreate && showDebugInfo ? (
                showShipToUpdatePrompt ? (
                  <div style={inlinePromptStyle}>
                    <div style={helperStyle}>
                      Would you like to update the selected delivery address to match the Ship To details pulled from this PO?
                    </div>
                    <div style={inlinePromptActionsStyle}>
                      <button
                        type="button"
                        style={promptBtnNoStyle}
                        disabled={isCreatingDeliveryAddress}
                        onClick={() => setPendingDeliveryAddressUpdateChoice(null)}
                      >
                        No
                      </button>
                      <button
                        type="button"
                        style={promptBtnYesStyle}
                        disabled={isCreatingDeliveryAddress}
                        onClick={() => void confirmDeliveryAddressUpdateFromShipTo()}
                      >
                        {isCreatingDeliveryAddress ? "Updating..." : "Yes"}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div
                    style={
                      showShipToUnmatchedWarning
                        ? { ...helperStyle, color: "#7f1d1d" }
                        : helperStyle
                    }
                  >
                    {deliveryAddressLockedForCreate
                      ? "Matched from Ship To address in the uploaded PDF."
                      : showShipToUnmatchedWarning
                        ? `Ship To detected but not matched in the PDF (${safeStr(createShipToCandidate?.displayName)}). You can either assign this to an existing delivery address or add the address to the database.`
                        : safeStr(deliveryAddressID)
                          ? "Selected Ship To delivery address will be used for this purchase order."
                        : "Select the Ship To delivery address for this purchase order."}
                  </div>
                )
              ) : null}
              {deliveryAddressCreateError ? (
                <div style={{ ...helperStyle, color: "#991b1b" }}>{deliveryAddressCreateError}</div>
              ) : null}
            </div>

            {/* For View: Last Updated */}
            {!isCreate ? (
              <div style={fieldStyle}>
                <div style={labelStyle}>Last Updated</div>
                <div style={readOnlyBoxStyle}>{updatedText}</div>
              </div>
            ) : null}

            {/* For View: Purchase Order PDF */}
            {!isCreate ? (
              <div style={fieldStyle}>
                <div style={labelStyle}>Purchase Order PDF</div>

                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {currentPdfUrl ? (
                    <div style={readOnlyBoxStyle}>
                      <a
                        href={currentPdfUrl}
                        target="_blank"
                        rel="noreferrer"
                        style={{ color: "#2563eb", fontWeight: 900, textDecoration: "none" }}
                      >
                        View current Purchase Order
                      </a>
                    </div>
                  ) : (
                    <div style={readOnlyBoxStyle}>No PDF uploaded</div>
                  )}

                  {!viewOnly && (
                    <>
                      <input
                        type="file"
                        accept="application/pdf"
                        disabled={isSaving || isValidatingPdf}
                        onChange={(e) => {
                          const f = e.target.files && e.target.files[0] ? e.target.files[0] : null;
                          void handleReplacementPdfSelection(f, e.currentTarget);
                        }}
                      />

                      {pdfFile ? (
                        <div style={helperStyle}>
                          Selected: <b>{pdfFile.name}</b>
                        </div>
                      ) : null}

                      {isValidatingPdf ? (
                        <div style={helperStyle}>Validating PDF…</div>
                      ) : null}
                      {pdfValidationMessage ? (
                        <div style={{ ...helperStyle, color: "#166534" }}>{pdfValidationMessage}</div>
                      ) : null}
                      {pdfValidationError ? (
                        <div style={{ ...helperStyle, color: "#991b1b" }}>{pdfValidationError}</div>
                      ) : null}
                      {!isCreate && pdfFile && !safeStr(note) ? (
                        <div style={{ ...helperStyle, color: "#991b1b" }}>
                          A note is required when uploading a new Purchase Order PDF.
                        </div>
                      ) : null}
                    </>
                  )}
                </div>
              </div>
            ) : null}

            {/* Pro Forma Invoice */}
            <div style={proFormaFieldStyle}>
              <div style={labelStyle}>Pro Forma Invoice</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {currentProFormaUrl ? (
                  <div style={readOnlyBoxStyle}>
                    <a
                      href={currentProFormaUrl}
                      target="_blank"
                      rel="noreferrer"
                      style={{ color: "#2563eb", fontWeight: 900, textDecoration: "none" }}
                    >
                      View current Pro Forma Invoice
                    </a>
                  </div>
                ) : (
                  <div style={readOnlyBoxStyle}>No Pro Forma Invoice uploaded</div>
                )}

                {showProFormaUploadControl ? (
                  <>
                    <input
                      type="file"
                      accept="application/pdf"
                      disabled={isSaving}
                      onChange={(e) => {
                        const f = e.target.files && e.target.files[0] ? e.target.files[0] : null;
                        setProFormaFile(f);
                      }}
                    />
                    {proFormaFile ? (
                      <div style={helperStyle}>
                        Selected: <b>{proFormaFile.name}</b>
                      </div>
                    ) : null}
                    {!isCreate && proFormaFile && !safeStr(note) ? (
                      <div style={{ ...helperStyle, color: "#991b1b" }}>
                        A note is required when uploading a new Pro Forma Invoice.
                      </div>
                    ) : null}
                  </>
                ) : null}
              </div>
            </div>

            {/* Note */}
            {showNoteField && (
              <div style={fieldStyle}>
                <div style={labelStyle}>Note</div>
                <textarea
                  style={{ ...inputStyle, minHeight: 104, resize: "vertical" }}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder={notePlaceholder}
                  disabled={isSaving}
                />
              </div>
            )}

            {/* Products (Create + View/Update) */}
            <div style={{ ...fieldStyle, gridColumn: "1 / -1" }}>
              <div style={labelStyle}>Products</div>

              {showDebugInfo && isCreate && selectedCount === 0 ? (
                <div style={{ ...helperStyle, color: "#713f12" }}>
                  Warning: No products from this PDF matched your product table.
                </div>
              ) : null}

              {showDebugInfo && isCreate && unmatchedCount > 0 ? (
                <div style={{ ...helperStyle, color: "#713f12" }}>
                  Warning: {unmatchedCount} line item(s) were not matched to a product in your table.
                </div>
              ) : null}

              <div style={productsTableWrapStyle}>
                <table style={productsTableStyle}>
                  <thead>
                  <tr>
                    <th style={productsThStyle}>Products</th>
                    <th style={productsThStyle}>RSL SKU</th>
                    <th style={productsThStyle}>Qty</th>
                  </tr>
                  </thead>
                  <tbody>
                  {poProducts.length === 0 ? (
                    <tr>
                      <td style={productsTdStyle} colSpan={3}>No products found.</td>
                    </tr>
                  ) : (
                    poProducts.map((p, idx) => {
                      const title = primaryProductTitle(p);
                      const sku = safeStr(p?.SKU) || "-";
                      const qty = typeof p?.quantity === "number" ? String(p.quantity) : "-";
                      const mappedId = safeStr(p?.rslModelID || p?.rslProductID || "");
                      return (
                        <tr key={`${mappedId || "line"}_${idx}`}>
                          <td style={productsTdStyle}>
                            <div style={{ fontWeight: 800, whiteSpace: "normal", overflowWrap: "anywhere" }}>{title}</div>
                          </td>
                          <td style={productsTdStyle}>{sku}</td>
                          <td style={productsTdStyle}>{qty}</td>
                        </tr>
                      );
                    })
                  )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* For View: Last Updated By */}
            {!isCreate ? (
              <div style={fieldStyle}>
                <div style={labelStyle}>Last Updated By</div>
                <div style={readOnlyBoxStyle}>{safeStr(purchaseOrder.lastUpdatedBy) || "-"}</div>
              </div>
            ) : null}

            {/* For Create: PDF upload */}
            {isCreate ? (
              <div style={fieldStyle}>
                <div style={labelStyle}>Re-Upload PO PDF</div>

                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <input
                    type="file"
                    accept="application/pdf"
                    disabled={isSaving}
                    onChange={(e) => {
                      const f = e.target.files && e.target.files[0] ? e.target.files[0] : null;
                      void handleReplacementPdfSelection(f, e.currentTarget);
                    }}
                  />

                  {pdfFile ? (
                    <div style={helperStyle}>
                      Selected: <b>{pdfFile.name}</b>
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>

          <div style={sectionTitleStyle}>History</div>

          <div style={historyWrapStyle}>
            {Array.isArray(purchaseOrder.notes) && purchaseOrder.notes.length > 0 ? (
              purchaseOrder.notes.map((n) => (
                <div key={safeStr(n.id)} style={historyItemStyle}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                    <div style={{ fontWeight: 900, color: "#0f172a" }}>{displayEventType(n.eventType)}</div>
                    <div style={{ fontSize: 12, color: "#64748b" }}>
                      {fmtDate(n.timestamp)} {n.user ? `• ${safeStr(n.user)}` : ""}
                    </div>
                  </div>

                  {safeStr(n.content) ? (
                    <div style={{ marginTop: 8, fontSize: 13, color: "#0f172a" }}>{safeStr(n.content)}</div>
                  ) : null}

                  {n.pdfUrl ? (
                    <div style={{ marginTop: 8, fontSize: 12 }}>
                      <a
                        href={safeStr(n.pdfUrl)}
                        target="_blank"
                        rel="noreferrer"
                        style={{ color: "#2563eb", fontWeight: 900, textDecoration: "none" }}
                      >
                        {safeStr(n.pdfFileName) || "View PDF"}
                      </a>
                    </div>
                  ) : null}
                </div>
              ))
            ) : (
              <div style={helperStyle}>No history yet.</div>
            )}
          </div>
        </div>

        <div style={footerStyle}>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {onDelete && !isCreate && !viewOnly ? (
              <button type="button" style={dangerBtnStyle} disabled={isSaving} onClick={() => onDelete(purchaseOrder)}>
                <Trash2 size={16} />
                Delete
              </button>
            ) : null}
          </div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button
              type="button"
              style={btnStyle}
              onClick={onClose}
              disabled={isSaving || isCreatingCompany || isCreatingDeliveryAddress}
            >
              {viewOnly && !supplierProFormaOnlyMode ? "Close" : "Cancel"}
            </button>

            {showSaveControl && (
              <button
                type="button"
                style={{
                  ...primaryBtnStyle,
                  ...(canSave ? {} : { opacity: 0.5, cursor: "not-allowed" }),
                }}
                onClick={submit}
                disabled={!canSave}
              >
                <Save size={16} />
                {supplierProFormaOnlyMode
                  ? "Update Pro Forma Invoice"
                  : isCreate
                    ? "Create Purchase Order"
                    : "Update Purchase Order"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default PurchaseOrderDetailsModal;
