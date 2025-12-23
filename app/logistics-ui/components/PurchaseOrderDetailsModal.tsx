// app/logistics-ui/components/PurchaseOrderDetailsModal.tsx
import React, { useEffect, useMemo, useState } from "react";
import {
  X,
  FileText,
  UploadCloud,
  Building2,
  ExternalLink,
  Clock,
  StickyNote,
  Plus,
  Info,
  ChevronDown,
  ChevronUp,
} from "lucide-react";

import { withShopParam } from "../utils/shop";

// -----------------------------------------------------------------------------
// Types (exported so other files can import them)
// -----------------------------------------------------------------------------

export type CompanyOption = {
  shortName: string;
  displayName?: string | null;

  // Optional extra fields for hover/rollover details (safe if not provided)
  address1?: string | null;
  address2?: string | null;
  city?: string | null;
  province?: string | null;
  postalCode?: string | null;
  country?: string | null;
  primaryContact?: string | null;
  primaryPhone?: string | null;
  primaryEmail?: string | null;
  supplierCurrency?: string | null;
};

export type UIPurchaseOrderNote = {
  id: string;
  timestamp: string; // ISO
  user?: string | null; // display name/email if available
  content: string;
  pdfUrl?: string | null;
};

export type UIPurchaseOrder = {
  id: string;

  // Human-readable PO number
  shortName: string;

  // Shopify PurchaseOrder GID (not editable)
  purchaseOrderGID?: string;

  // Current PDF URL (Shopify CDN)
  purchaseOrderPdfUrl?: string | null;

  // Associated company (via join table)
  companyID?: string | null;
  companyName?: string | null;

  createdAt?: string | null; // ISO
  updatedAt?: string | null; // ISO

  notes?: UIPurchaseOrderNote[];
};

interface PurchaseOrderDetailsModalProps {
  purchaseOrder: UIPurchaseOrder;

  // for create dropdown + view rollover
  companies?: CompanyOption[];

  isSaving?: boolean;
  error?: string | null;

  onClose: () => void;

  // create/update PO record (company, shortName, pdfUrl, etc.)
  onSave: (
    mode: "create" | "update",
    purchaseOrderToSave: UIPurchaseOrder
  ) => Promise<void> | void;

  onDelete?: (purchaseOrderToDelete: UIPurchaseOrder) => Promise<void> | void;
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function isNewId(id: unknown) {
  const s = String(id ?? "").trim().toLowerCase();
  return !s || s === "new";
}

function fmtDateTime(iso: string | null | undefined) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString();
}

function pickCompanyDisplay(c: CompanyOption) {
  return c.displayName ? `${c.displayName} (${c.shortName})` : c.shortName;
}

function buildCompanyRolloverText(c?: CompanyOption | null) {
  if (!c) return "";
  const lines: string[] = [];
  lines.push(pickCompanyDisplay(c));

  const addrParts = [c.address1, c.address2].filter(Boolean).map(String);
  if (addrParts.length) lines.push(addrParts.join(" · "));

  const cityLine = [c.city, c.province, c.postalCode, c.country]
    .filter(Boolean)
    .map(String)
    .join(", ");
  if (cityLine) lines.push(cityLine);

  const contactLine = [c.primaryContact, c.primaryEmail, c.primaryPhone]
    .filter(Boolean)
    .map(String)
    .join(" · ");
  if (contactLine) lines.push(contactLine);

  if (c.supplierCurrency) lines.push(`Currency: ${c.supplierCurrency}`);

  return lines.join("\n");
}

async function uploadPdfToCdn(file: File): Promise<{ pdfUrl: string }> {
  const fd = new FormData();
  fd.append("intent", "upload_pdf");
  fd.append("pdf", file);

  const res = await fetch(withShopParam("/apps/logistics/purchase-orders"), {
    method: "POST",
    body: fd,
  });

  const data = await res.json().catch(() => null);

  if (!data || data.success !== true || !data.pdfUrl) {
    throw new Error(data?.error || "Upload failed.");
  }

  return { pdfUrl: data.pdfUrl };
}

async function postJson(payload: any) {
  const res = await fetch(withShopParam("/apps/logistics/purchase-orders"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  return res.json();
}

// recommended server intent:
// { intent:"add_note", purchaseOrderGID, content, pdfUrl? }
async function addNoteToServer(args: {
  purchaseOrderGID: string;
  content: string;
  pdfUrl?: string | null;
}) {
  return postJson({
    intent: "add_note",
    purchaseOrderGID: args.purchaseOrderGID,
    content: args.content,
    pdfUrl: args.pdfUrl ?? null,
  });
}

// -----------------------------------------------------------------------------
// Styles (consistent w/ your inline-style system)
// -----------------------------------------------------------------------------

const overlayStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(15,23,42,0.55)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 16,
  zIndex: 50,
};

const modalStyle: React.CSSProperties = {
  width: "min(980px, 96vw)",
  background: "#ffffff",
  borderRadius: 14,
  overflow: "hidden",
  boxShadow: "0 30px 80px rgba(2,6,23,0.35)",
  border: "1px solid rgba(226,232,240,0.9)",
};

const headerStyle: React.CSSProperties = {
  padding: "14px 18px",
  background: "linear-gradient(135deg, #0f172a, #1e3a8a)",
  color: "#ffffff",
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "space-between",
  gap: 16,
};

const headerLeftStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
  minWidth: 0,
};

const headerRightStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "flex-end",
  gap: 4,
  flexShrink: 0,
  textAlign: "right",
};

const headerCompanyStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 800,
  letterSpacing: 0.2,
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
  maxWidth: 520,
};

const headerPoStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 800,
  opacity: 0.95,
};

const headerMetaStyle: React.CSSProperties = {
  fontSize: 11,
  opacity: 0.85,
};

const headerH1Style: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 900,
  letterSpacing: 0.2,
};

const btnStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  padding: "8px 12px",
  borderRadius: 10,
  border: "1px solid rgba(255,255,255,0.18)",
  background: "rgba(255,255,255,0.10)",
  color: "#fff",
  cursor: "pointer",
  fontSize: 12,
  fontWeight: 700,
};

const closeBtnStyle: React.CSSProperties = {
  ...btnStyle,
  padding: "8px 10px",
};

const bodyStyle: React.CSSProperties = { padding: 18 };

const errorBoxStyle: React.CSSProperties = {
  padding: "10px 12px",
  borderRadius: 10,
  background: "#fef2f2",
  border: "1px solid #fecaca",
  color: "#991b1b",
  fontSize: 12,
  marginBottom: 12,
};

const gridStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(12, 1fr)",
  gap: 12,
};

const sectionTitleStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 900,
  color: "#0f172a",
  marginBottom: 10,
  textTransform: "uppercase",
  letterSpacing: 0.5,
};

const fieldLabelStyle: React.CSSProperties = {
  fontSize: 12,
  color: "#475569",
  marginBottom: 6,
  fontWeight: 800,
};

const inputWrapStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  border: "1px solid #e2e8f0",
  borderRadius: 10,
  overflow: "hidden",
  background: "#ffffff",
};

const iconBoxStyle: React.CSSProperties = {
  padding: "10px 10px",
  borderRight: "1px solid #e2e8f0",
  color: "#64748b",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  border: "none",
  outline: "none",
  padding: "10px 12px",
  fontSize: 13,
  color: "#0f172a",
};

const selectStyle: React.CSSProperties = {
  ...inputStyle,
  appearance: "none",
  background: "transparent",
};

const readOnlyStyle: React.CSSProperties = {
  ...inputStyle,
  background: "#f8fafc",
  color: "#0f172a",
};

const textareaStyle: React.CSSProperties = {
  width: "100%",
  border: "1px solid #e2e8f0",
  borderRadius: 10,
  padding: "10px 12px",
  fontSize: 13,
  outline: "none",
  minHeight: 90,
  resize: "vertical",
};

const dividerStyle: React.CSSProperties = {
  height: 1,
  background: "#e2e8f0",
  margin: "16px 0",
};

const cardStyle: React.CSSProperties = {
  border: "1px solid #e2e8f0",
  borderRadius: 12,
  overflow: "hidden",
  background: "#ffffff",
};

const cardHeaderStyle: React.CSSProperties = {
  padding: "10px 12px",
  background: "#f8fafc",
  borderBottom: "1px solid #e2e8f0",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
};

const cardBodyStyle: React.CSSProperties = { padding: 12 };

const subtleText: React.CSSProperties = { fontSize: 12, color: "#64748b" };

const primaryActionStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  padding: "10px 14px",
  borderRadius: 10,
  border: "none",
  backgroundColor: "#2563eb",
  color: "#fff",
  fontSize: 13,
  fontWeight: 800,
  cursor: "pointer",
};

const secondaryActionStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  padding: "10px 14px",
  borderRadius: 10,
  border: "1px solid #e2e8f0",
  backgroundColor: "#ffffff",
  color: "#0f172a",
  fontSize: 13,
  fontWeight: 800,
  cursor: "pointer",
};

const dangerActionStyle: React.CSSProperties = {
  ...secondaryActionStyle,
  borderColor: "#fecaca",
  color: "#991b1b",
  background: "#fff1f2",
};

const linkStyle: React.CSSProperties = {
  color: "#2563eb",
  textDecoration: "none",
  fontWeight: 800,
};

// -----------------------------------------------------------------------------
// Component
// -----------------------------------------------------------------------------

const PurchaseOrderDetailsModal: React.FC<PurchaseOrderDetailsModalProps> = ({
                                                                               purchaseOrder,
                                                                               companies = [],
                                                                               isSaving = false,
                                                                               error = null,
                                                                               onClose,
                                                                               onSave,
                                                                               onDelete,
                                                                             }) => {
  const isNew = isNewId(purchaseOrder?.id);

  // form state (create mode only really edits these)
  const [formPo, setFormPo] = useState<UIPurchaseOrder>(() => ({
    ...purchaseOrder,
    ...(isNew ? { companyID: "" } : {}),
  }));

  const [localError, setLocalError] = useState<string | null>(null);

  // Notes/history local state (don’t mutate props)
  const [history, setHistory] = useState<UIPurchaseOrderNote[]>(
    Array.isArray(purchaseOrder.notes) ? purchaseOrder.notes : []
  );

  // Collapsible panels
  const [showAddNote, setShowAddNote] = useState(false);
  const [showUpdatePo, setShowUpdatePo] = useState(false);

  // Add note draft
  const [noteContent, setNoteContent] = useState("");
  const [notePdfUrl, setNotePdfUrl] = useState<string | null>(null);
  const [isUploadingNotePdf, setIsUploadingNotePdf] = useState(false);
  const [isSavingNote, setIsSavingNote] = useState(false);

  // Update PO draft (PDF + required note)
  const [updateNote, setUpdateNote] = useState("");
  const [pendingPoPdfUrl, setPendingPoPdfUrl] = useState<string | null>(null);
  const [isUploadingPoPdf, setIsUploadingPoPdf] = useState(false);
  const [isSavingUpdate, setIsSavingUpdate] = useState(false);

  useEffect(() => {
    setFormPo({
      ...purchaseOrder,
      ...(isNewId(purchaseOrder?.id) ? { companyID: "" } : {}),
    });

    setHistory(Array.isArray(purchaseOrder.notes) ? purchaseOrder.notes : []);

    setLocalError(null);

    setShowAddNote(false);
    setNoteContent("");
    setNotePdfUrl(null);
    setIsUploadingNotePdf(false);
    setIsSavingNote(false);

    setShowUpdatePo(false);
    setUpdateNote("");
    setPendingPoPdfUrl(null);
    setIsUploadingPoPdf(false);
    setIsSavingUpdate(false);
  }, [purchaseOrder]);

  const companyMap = useMemo(() => {
    const m = new Map<string, CompanyOption>();
    for (const c of companies || []) m.set(String(c.shortName), c);
    return m;
  }, [companies]);

  const selectedCompany = useMemo(() => {
    const key = String(formPo.companyID || "").trim();
    return key ? companyMap.get(key) || null : null;
  }, [formPo.companyID, companyMap]);

  const viewCompany = useMemo(() => {
    const key = String(purchaseOrder.companyID || "").trim();
    if (key) return companyMap.get(key) || null;
    return null;
  }, [purchaseOrder.companyID, companyMap]);

  const companyRollover = buildCompanyRolloverText(viewCompany || selectedCompany);

  const companyChoices = useMemo(() => {
    const list = Array.isArray(companies) ? companies.slice() : [];
    list.sort((a, b) => String(a.shortName).localeCompare(String(b.shortName)));
    return [{ label: "Select…", value: "" }].concat(
      list.map((c) => ({
        label: pickCompanyDisplay(c),
        value: String(c.shortName),
      }))
    );
  }, [companies]);

  const poNumber = String(formPo.shortName || "").trim() || "—";
  const directLinkGid = String(purchaseOrder.purchaseOrderGID || "").trim();

  const companyHeaderText = isNew
    ? selectedCompany
      ? pickCompanyDisplay(selectedCompany)
      : "Select a company"
    : purchaseOrder.companyName ||
    (viewCompany ? pickCompanyDisplay(viewCompany) : String(purchaseOrder.companyID || "—"));

  const canCreate = useMemo(() => {
    if (!isNew) return true;
    return !!String(formPo.companyID || "").trim() && !!String(formPo.shortName || "").trim();
  }, [isNew, formPo.companyID, formPo.shortName]);

  const handleDeleteClick = async () => {
    if (!onDelete || isNew) return;
    const ok = window.confirm("Delete this purchase order? This cannot be undone.");
    if (!ok) return;
    await onDelete(purchaseOrder);
  };

  const handleCreateClick = async () => {
    setLocalError(null);

    if (!String(formPo.companyID || "").trim()) {
      setLocalError("Please select a company.");
      return;
    }
    if (!String(formPo.shortName || "").trim()) {
      setLocalError("PO Number is required.");
      return;
    }

    await onSave("create", formPo);
  };

  // --- uploads ---------------------------------------------------------------

  const validatePdf = (file: File) => {
    const name = String(file.name || "");
    const type = String(file.type || "");
    return type === "application/pdf" || name.toLowerCase().endsWith(".pdf");
  };

  const uploadNotePdf = async (file: File) => {
    if (!validatePdf(file)) {
      setLocalError("Only PDF uploads are supported.");
      return;
    }

    setIsUploadingNotePdf(true);
    setLocalError(null);
    try {
      const { pdfUrl } = await uploadPdfToCdn(file);
      setNotePdfUrl(pdfUrl);
    } catch (e: any) {
      setLocalError(e?.message || "Upload failed.");
    } finally {
      setIsUploadingNotePdf(false);
    }
  };

  const uploadUpdatePoPdf = async (file: File) => {
    if (!validatePdf(file)) {
      setLocalError("Only PDF uploads are supported.");
      return;
    }

    setIsUploadingPoPdf(true);
    setLocalError(null);
    try {
      const { pdfUrl } = await uploadPdfToCdn(file);
      setPendingPoPdfUrl(pdfUrl);
    } catch (e: any) {
      setLocalError(e?.message || "Upload failed.");
    } finally {
      setIsUploadingPoPdf(false);
    }
  };

  // --- notes -----------------------------------------------------------------

  const submitAddNote = async () => {
    setLocalError(null);

    const gid = String(purchaseOrder.purchaseOrderGID || "").trim();
    if (!gid) {
      setLocalError("This purchase order has no purchaseOrderGID; cannot add notes yet.");
      return;
    }

    const content = String(noteContent || "").trim();
    if (!content) {
      setLocalError("Please enter a note.");
      return;
    }

    setIsSavingNote(true);
    try {
      const resp = await addNoteToServer({
        purchaseOrderGID: gid,
        content,
        pdfUrl: notePdfUrl,
      });

      if (!resp || resp.success !== true) {
        throw new Error(resp?.error || "Unable to add note.");
      }

      // Expect server to return the created note or updated list; handle both
      const created: UIPurchaseOrderNote | null = resp.note || null;
      const notesFromServer: UIPurchaseOrderNote[] | null = Array.isArray(resp.notes) ? resp.notes : null;

      if (notesFromServer) {
        setHistory(notesFromServer);
      } else if (created) {
        setHistory((prev) => [created, ...prev]);
      } else {
        // fallback optimistic
        const optimistic: UIPurchaseOrderNote = {
          id: `tmp_${Date.now()}`,
          timestamp: new Date().toISOString(),
          user: "You",
          content,
          pdfUrl: notePdfUrl,
        };
        setHistory((prev) => [optimistic, ...prev]);
      }

      setShowAddNote(false);
      setNoteContent("");
      setNotePdfUrl(null);
    } catch (e: any) {
      setLocalError(e?.message || "Unable to add note.");
    } finally {
      setIsSavingNote(false);
    }
  };

  // Update PO: if PDF selected -> require update note; creates a note w/ pdfUrl AND updates PO pdfUrl
  const submitUpdatePo = async () => {
    setLocalError(null);

    const gid = String(purchaseOrder.purchaseOrderGID || "").trim();
    if (!gid) {
      setLocalError("This purchase order has no purchaseOrderGID; cannot update PDFs yet.");
      return;
    }

    if (!pendingPoPdfUrl) {
      setLocalError("Please choose a PDF to upload.");
      return;
    }

    const content = String(updateNote || "").trim();
    if (!content) {
      setLocalError("A note is required when updating the PDF.");
      return;
    }

    setIsSavingUpdate(true);
    try {
      // 1) add note with pdfUrl
      const noteResp = await addNoteToServer({
        purchaseOrderGID: gid,
        content,
        pdfUrl: pendingPoPdfUrl,
      });

      if (!noteResp || noteResp.success !== true) {
        throw new Error(noteResp?.error || "Unable to add note for update.");
      }

      // 2) update PO record with new current pdf
      const nextPo: UIPurchaseOrder = {
        ...purchaseOrder,
        purchaseOrderPdfUrl: pendingPoPdfUrl,
      };

      await onSave("update", nextPo);

      // 3) refresh local history if server returned it; else prepend
      const created: UIPurchaseOrderNote | null = noteResp.note || null;
      const notesFromServer: UIPurchaseOrderNote[] | null = Array.isArray(noteResp.notes) ? noteResp.notes : null;

      if (notesFromServer) {
        setHistory(notesFromServer);
      } else if (created) {
        setHistory((prev) => [created, ...prev]);
      } else {
        const optimistic: UIPurchaseOrderNote = {
          id: `tmp_${Date.now()}`,
          timestamp: new Date().toISOString(),
          user: "You",
          content,
          pdfUrl: pendingPoPdfUrl,
        };
        setHistory((prev) => [optimistic, ...prev]);
      }

      setShowUpdatePo(false);
      setUpdateNote("");
      setPendingPoPdfUrl(null);
    } catch (e: any) {
      setLocalError(e?.message || "Unable to update purchase order.");
    } finally {
      setIsSavingUpdate(false);
    }
  };

  // ---------------------------------------------------------------------------

  const currentPdfUrl = String(purchaseOrder.purchaseOrderPdfUrl || "").trim();
  const historyList = history;

  return (
    <div style={overlayStyle} role="dialog" aria-modal="true">
      <div style={modalStyle}>
        <div style={headerStyle}>
          <div style={headerLeftStyle}>
            <div style={headerCompanyStyle} title={companyRollover}>
              {companyHeaderText}
            </div>
            <div style={headerH1Style}>Purchase Order - {poNumber}</div>
          </div>

          <div style={headerRightStyle}>
            <button type="button" onClick={onClose} style={closeBtnStyle} aria-label="Close">
              <X size={18} />
            </button>

            {!isNew ? (
              <>
                <div style={headerPoStyle}>
                  PO:{" "}
                  {directLinkGid ? (
                    <a
                      href={`https://admin.shopify.com/store/rogersoundlabs/purchase_orders/${encodeURIComponent(
                        directLinkGid
                      )}`}
                      target="_blank"
                      rel="noreferrer"
                      style={{ color: "#fff", textDecoration: "underline", fontWeight: 900 }}
                      title="Open in Shopify Admin (new tab)"
                    >
                      {purchaseOrder.shortName || "—"}
                    </a>
                  ) : (
                    <span>{purchaseOrder.shortName || "—"}</span>
                  )}
                </div>
                <div style={headerMetaStyle}>Created: {fmtDateTime(purchaseOrder.createdAt)}</div>
                <div style={headerMetaStyle}>Updated: {fmtDateTime(purchaseOrder.updatedAt)}</div>
              </>
            ) : null}
          </div>
        </div>

        <div style={bodyStyle}>
          {error ? <div style={errorBoxStyle}>{error}</div> : null}
          {localError ? <div style={errorBoxStyle}>{localError}</div> : null}

          {/* Overview fields */}
          <section style={{ marginBottom: 14 }}>
            <div style={sectionTitleStyle}>Details</div>

            <div style={gridStyle}>
              {/* Company */}
              <div style={{ gridColumn: "span 6" }}>
                <div style={fieldLabelStyle}>Company</div>

                {isNew ? (
                  <div style={inputWrapStyle}>
                    <span style={iconBoxStyle}>
                      <Building2 size={16} />
                    </span>
                    <select
                      value={String(formPo.companyID || "")}
                      onChange={(e) => setFormPo((prev) => ({ ...prev, companyID: e.target.value || "" }))}
                      style={selectStyle}
                      disabled={isSaving}
                    >
                      {companyChoices.map((c) => (
                        <option key={c.value} value={c.value}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : (
                  <div style={inputWrapStyle} title={companyRollover}>
                    <span style={iconBoxStyle}>
                      <Building2 size={16} />
                    </span>
                    <input
                      value={
                        purchaseOrder.companyName ||
                        (viewCompany ? pickCompanyDisplay(viewCompany) : String(purchaseOrder.companyID || "—"))
                      }
                      readOnly
                      style={readOnlyStyle}
                    />
                    <span style={{ padding: "0 10px", color: "#94a3b8" }}>
                      <Info size={16} />
                    </span>
                  </div>
                )}
              </div>

              {/* PO Number */}
              <div style={{ gridColumn: "span 6" }}>
                <div style={fieldLabelStyle}>PO Number</div>

                {isNew ? (
                  <div style={inputWrapStyle}>
                    <span style={iconBoxStyle}>
                      <FileText size={16} />
                    </span>
                    <input
                      value={String(formPo.shortName || "")}
                      onChange={(e) => setFormPo((prev) => ({ ...prev, shortName: e.target.value }))}
                      style={inputStyle}
                      disabled={isSaving}
                      placeholder="Enter PO Number…"
                    />
                  </div>
                ) : (
                  <div style={inputWrapStyle}>
                    <span style={iconBoxStyle}>
                      <ExternalLink size={16} />
                    </span>
                    <div style={{ padding: "10px 12px", fontSize: 13, width: "100%" }}>
                      {directLinkGid ? (
                        <a
                          href={`https://admin.shopify.com/store/rogersoundlabs/purchase_orders/${encodeURIComponent(
                            directLinkGid
                          )}`}
                          target="_blank"
                          rel="noreferrer"
                          style={linkStyle}
                          title="Open Shopify Purchase Order in a new tab"
                        >
                          {purchaseOrder.shortName || "—"}{" "}
                          <span style={{ opacity: 0.8, fontWeight: 900 }}>↗</span>
                        </a>
                      ) : (
                        <span style={{ color: "#334155", fontWeight: 900 }}>{purchaseOrder.shortName || "—"}</span>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Created / Updated shown only in create mode here (view mode shows in header) */}
              {isNew ? (
                <>
                  <div style={{ gridColumn: "span 6" }}>
                    <div style={fieldLabelStyle}>Created</div>
                    <div style={inputWrapStyle}>
                      <span style={iconBoxStyle}>
                        <Clock size={16} />
                      </span>
                      <input value={fmtDateTime(purchaseOrder.createdAt)} readOnly style={readOnlyStyle} />
                    </div>
                  </div>

                  <div style={{ gridColumn: "span 6" }}>
                    <div style={fieldLabelStyle}>Last Updated</div>
                    <div style={inputWrapStyle}>
                      <span style={iconBoxStyle}>
                        <Clock size={16} />
                      </span>
                      <input value={fmtDateTime(purchaseOrder.updatedAt)} readOnly style={readOnlyStyle} />
                    </div>
                  </div>
                </>
              ) : null}
            </div>
          </section>

          <div style={dividerStyle} />

          {/* PDF block (thumbnail + update button) */}
          <section style={{ marginBottom: 16 }}>
            <div style={sectionTitleStyle}>PDF</div>

            <div style={cardStyle}>
              <div style={cardHeaderStyle}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <FileText size={16} />
                  <div style={{ fontWeight: 900, fontSize: 13, color: "#0f172a" }}>Purchase Order PDF</div>
                </div>

                {!isNew ? (
                  <button
                    type="button"
                    style={secondaryActionStyle}
                    onClick={() => setShowUpdatePo((v) => !v)}
                    disabled={isSaving || isSavingUpdate || isUploadingPoPdf}
                  >
                    {showUpdatePo ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                    Update Purchase Order
                  </button>
                ) : null}
              </div>

              <div style={cardBodyStyle}>
                <div style={{ display: "grid", gridTemplateColumns: "220px 1fr", gap: 12, alignItems: "start" }}>
                  {/* Thumbnail */}
                  <div
                    style={{
                      border: "1px dashed #cbd5e1",
                      borderRadius: 12,
                      padding: 12,
                      height: 150,
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      justifyContent: "center",
                      background: "#f8fafc",
                      gap: 10,
                    }}
                  >
                    <FileText size={28} color="#64748b" />
                    {currentPdfUrl ? (
                      <>
                        <div style={{ fontSize: 12, fontWeight: 900, color: "#0f172a" }}>PDF linked</div>
                        <a href={currentPdfUrl} target="_blank" rel="noreferrer" style={{ ...linkStyle, fontSize: 12 }}>
                          View PDF ↗
                        </a>
                      </>
                    ) : (
                      <div style={{ fontSize: 12, fontWeight: 900, color: "#475569" }}>No PDF</div>
                    )}
                  </div>

                  {/* Create: allow immediate upload */}
                  {isNew ? (
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 900, color: "#0f172a", marginBottom: 4 }}>
                        Upload PDF (optional)
                      </div>
                      <div style={subtleText}>Uploads to Shopify Files (CDN) and stores the URL on this PO.</div>

                      <div style={{ height: 10 }} />

                      <label style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                        <span style={secondaryActionStyle}>
                          <UploadCloud size={16} />
                          Choose PDF
                        </span>
                        <input
                          type="file"
                          accept="application/pdf,.pdf"
                          disabled={isSaving || isUploadingPoPdf}
                          style={{ display: "none" }}
                          onChange={async (e) => {
                            const f = e.target.files?.[0] || null;
                            e.currentTarget.value = "";
                            if (!f) return;

                            setIsUploadingPoPdf(true);
                            setLocalError(null);
                            try {
                              const { pdfUrl } = await uploadPdfToCdn(f);
                              setFormPo((prev) => ({ ...prev, purchaseOrderPdfUrl: pdfUrl }));
                            } catch (err: any) {
                              setLocalError(err?.message || "Upload failed.");
                            } finally {
                              setIsUploadingPoPdf(false);
                            }
                          }}
                        />
                      </label>

                      {String(formPo.purchaseOrderPdfUrl || "").trim() ? (
                        <div style={{ marginTop: 10 }}>
                          <a
                            href={String(formPo.purchaseOrderPdfUrl)}
                            target="_blank"
                            rel="noreferrer"
                            style={{ ...linkStyle, fontSize: 12 }}
                          >
                            View uploaded PDF ↗
                          </a>
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <div>
                      <div style={subtleText}>
                        Use <strong>Update Purchase Order</strong> to upload a new PDF. A note is required when you
                        replace the PDF.
                      </div>

                      {/* Update PO panel */}
                      {showUpdatePo ? (
                        <div style={{ marginTop: 12, borderTop: "1px solid #e2e8f0", paddingTop: 12 }}>
                          <div style={{ fontSize: 13, fontWeight: 900, color: "#0f172a", marginBottom: 6 }}>
                            Upload new PDF + note
                          </div>

                          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                            <label style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                              <span style={secondaryActionStyle}>
                                <UploadCloud size={16} />
                                {isUploadingPoPdf ? "Uploading…" : pendingPoPdfUrl ? "Replace PDF" : "Choose PDF"}
                              </span>
                              <input
                                type="file"
                                accept="application/pdf,.pdf"
                                disabled={isSaving || isUploadingPoPdf || isSavingUpdate}
                                style={{ display: "none" }}
                                onChange={(e) => {
                                  const f = e.target.files?.[0] || null;
                                  e.currentTarget.value = "";
                                  if (f) uploadUpdatePoPdf(f);
                                }}
                              />
                            </label>

                            {pendingPoPdfUrl ? (
                              <a href={pendingPoPdfUrl} target="_blank" rel="noreferrer" style={{ ...linkStyle, fontSize: 12 }}>
                                View uploaded PDF ↗
                              </a>
                            ) : (
                              <span style={subtleText}>No new PDF selected</span>
                            )}
                          </div>

                          <div style={{ height: 12 }} />

                          <div style={fieldLabelStyle}>Note (required)</div>
                          <textarea
                            value={updateNote}
                            onChange={(e) => setUpdateNote(e.target.value)}
                            style={textareaStyle}
                            placeholder="Describe why this PO was updated…"
                            disabled={isSaving || isSavingUpdate}
                          />

                          <div style={{ marginTop: 10, display: "flex", gap: 10, justifyContent: "flex-end", flexWrap: "wrap" }}>
                            <button
                              type="button"
                              style={secondaryActionStyle}
                              onClick={() => {
                                setShowUpdatePo(false);
                                setUpdateNote("");
                                setPendingPoPdfUrl(null);
                              }}
                              disabled={isSavingUpdate || isUploadingPoPdf}
                            >
                              Cancel
                            </button>

                            <button
                              type="button"
                              style={primaryActionStyle}
                              onClick={submitUpdatePo}
                              disabled={isSavingUpdate || isUploadingPoPdf || !pendingPoPdfUrl}
                            >
                              {isSavingUpdate ? "Saving…" : "Save update"}
                            </button>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </section>

          {/* Notes + History */}
          {!isNew ? (
            <section style={{ marginBottom: 10 }}>
              <div style={sectionTitleStyle}>Notes</div>

              {/* Notes field (always visible) */}
              <div style={{ ...cardStyle, marginBottom: 12 }}>
                <div style={cardHeaderStyle}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <StickyNote size={16} />
                    <div style={{ fontWeight: 900, fontSize: 13, color: "#0f172a" }}>Add note</div>
                  </div>

                  <button
                    type="button"
                    style={secondaryActionStyle}
                    onClick={() => setShowAddNote((v) => !v)}
                    disabled={isSaving || isSavingNote || isUploadingNotePdf}
                  >
                    {showAddNote ? <ChevronUp size={16} /> : <Plus size={16} />}
                    {showAddNote ? "Hide" : "Add a note"}
                  </button>
                </div>

                {showAddNote ? (
                  <div style={cardBodyStyle}>
                    <div style={{ marginBottom: 10 }}>
                      <div style={fieldLabelStyle}>Notes</div>
                      <textarea
                        value={noteContent}
                        onChange={(e) => setNoteContent(e.target.value)}
                        style={textareaStyle}
                        placeholder="Add a note…"
                        disabled={isSaving || isSavingNote}
                      />
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                      <label style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                        <span style={secondaryActionStyle}>
                          <UploadCloud size={16} />
                          {isUploadingNotePdf ? "Uploading…" : notePdfUrl ? "Replace PDF" : "Attach PDF (optional)"}
                        </span>
                        <input
                          type="file"
                          accept="application/pdf,.pdf"
                          disabled={isSaving || isUploadingNotePdf || isSavingNote}
                          style={{ display: "none" }}
                          onChange={(e) => {
                            const f = e.target.files?.[0] || null;
                            e.currentTarget.value = "";
                            if (f) uploadNotePdf(f);
                          }}
                        />
                      </label>

                      {notePdfUrl ? (
                        <a href={notePdfUrl} target="_blank" rel="noreferrer" style={{ ...linkStyle, fontSize: 12 }}>
                          View attached PDF ↗
                        </a>
                      ) : (
                        <span style={subtleText}>No PDF attached</span>
                      )}

                      <div style={{ flex: 1 }} />

                      <button
                        type="button"
                        style={primaryActionStyle}
                        onClick={submitAddNote}
                        disabled={isSaving || isSavingNote}
                      >
                        {isSavingNote ? "Saving…" : "Add note"}
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>

              {/* History */}
              <div style={cardStyle}>
                <div style={cardHeaderStyle}>
                  <div style={{ fontWeight: 900, fontSize: 13, color: "#0f172a" }}>History</div>
                </div>
                <div style={cardBodyStyle}>
                  {historyList.length === 0 ? (
                    <div style={subtleText}>No notes yet.</div>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                      {historyList.map((n) => {
                        const when = fmtDateTime(n.timestamp);
                        const who = String(n.user || "").trim() || "—";
                        const hasPdf = Boolean(String(n.pdfUrl || "").trim());

                        return (
                          <div
                            key={n.id}
                            style={{
                              border: "1px solid #e2e8f0",
                              borderRadius: 12,
                              padding: 10,
                              background: "#ffffff",
                            }}
                          >
                            <div
                              style={{
                                display: "flex",
                                justifyContent: "space-between",
                                gap: 10,
                                flexWrap: "wrap",
                                marginBottom: 6,
                              }}
                            >
                              <div style={{ fontSize: 12, fontWeight: 900, color: "#0f172a" }}>{who}</div>
                              <div style={{ fontSize: 12, color: "#64748b" }}>{when}</div>
                            </div>

                            <div style={{ fontSize: 13, color: "#0f172a", whiteSpace: "pre-wrap" }}>{n.content}</div>

                            <div style={{ marginTop: 8 }}>
                              {hasPdf ? (
                                <a
                                  href={String(n.pdfUrl)}
                                  target="_blank"
                                  rel="noreferrer"
                                  style={{ ...linkStyle, fontSize: 12 }}
                                >
                                  View PDF ↗
                                </a>
                              ) : (
                                <span style={subtleText}>No PDF attached</span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </section>
          ) : (
            // Create mode notes (optional, non-persisted unless you implement it server-side)
            <section style={{ marginBottom: 10 }}>
              <div style={sectionTitleStyle}>Notes</div>
              <div style={cardStyle}>
                <div style={cardBodyStyle}>
                  <div style={fieldLabelStyle}>Notes (optional)</div>
                  <textarea
                    value={noteContent}
                    onChange={(e) => setNoteContent(e.target.value)}
                    style={textareaStyle}
                    placeholder="Optional note for this purchase order…"
                    disabled={isSaving}
                  />
                  <div style={{ marginTop: 10, ...subtleText }}>
                    Saving notes on create requires a server-side flow (e.g. create PO then add an initial note).
                  </div>
                </div>
              </div>
            </section>
          )}

          <div style={dividerStyle} />

          {/* Footer actions */}
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              {!isNew && onDelete ? (
                <button type="button" style={dangerActionStyle} onClick={handleDeleteClick} disabled={isSaving}>
                  Delete
                </button>
              ) : null}
            </div>

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button type="button" style={secondaryActionStyle} onClick={onClose} disabled={isSaving}>
                Close
              </button>

              {isNew ? (
                <button
                  type="button"
                  style={primaryActionStyle}
                  onClick={handleCreateClick}
                  disabled={isSaving || !canCreate}
                >
                  {isSaving ? "Creating…" : "Create Purchase Order"}
                </button>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PurchaseOrderDetailsModal;
