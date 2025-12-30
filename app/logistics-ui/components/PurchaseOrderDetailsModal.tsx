// app/logistics-ui/components/PurchaseOrderDetailsModal.tsx
import React, { useMemo, useState } from "react";
import { X, Trash2, Save } from "lucide-react";

export type CompanyOption = {
  shortName: string;
  displayName?: string | null;
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

  createdAt?: string | Date | null;
  updatedAt?: string | Date | null;

  companyID?: string | null;
  companyName?: string | null;

  lastUpdatedBy?: string | null;

  notes?: UIPurchaseOrderNote[];
};

type SaveMode = "create" | "update";

// Current user type for showing who is creating
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
  currentUser?: CurrentUser | null;

  isSaving?: boolean;
  error?: string | null;

  onClose: () => void;

  onSave: (
    saveMode: SaveMode,
    payload: {
      purchaseOrder: UIPurchaseOrder;
      companyID: string;
      note?: string | null;
      pdfFile?: File | null;
    },
  ) => Promise<void> | void;

  onDelete?: (purchaseOrder: UIPurchaseOrder) => Promise<void> | void;
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

function adminPurchaseOrderUrl(gid: string) {
  const clean = safeStr(gid);
  return `https://admin.shopify.com/store/rogersoundlabs/purchase_orders/${encodeURIComponent(clean)}`;
}

function displayEventType(t?: string | null) {
  const s = safeStr(t);
  if (!s) return "Note";
  if (s === "PDF_UPDATE") return "New PDF Uploaded";
  if (s === "PO Created") return "PO Created";
  if (s === "NOTE") return "Note";
  return s;
}

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
  overflow: "auto",
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

const bodyStyle: React.CSSProperties = { padding: 16 };

const gridStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr",
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

const footerStyle: React.CSSProperties = {
  padding: "14px 16px",
  borderTop: "1px solid #e2e8f0",
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

export function PurchaseOrderDetailsModal({
                                            mode,
                                            purchaseOrder,
                                            companies,
                                            currentUser,
                                            isSaving = false,
                                            error = null,
                                            onClose,
                                            onSave,
                                            onDelete,
                                          }: PurchaseOrderDetailsModalProps) {
  const isCreate = mode === "create";
  const saveMode: SaveMode = isCreate ? "create" : "update";

  // Get current user display name for create mode
  const currentUserName = safeStr(currentUser?.displayName || currentUser?.name || currentUser?.email) || "Current User";

  const [poNumber, setPoNumber] = useState<string>(safeStr(purchaseOrder.shortName));
  const [gid, setGid] = useState<string>(safeStr(purchaseOrder.purchaseOrderGID));

  const [companyID, setCompanyID] = useState<string>(safeStr(purchaseOrder.companyID));
  const [note, setNote] = useState<string>("");

  const [pdfFile, setPdfFile] = useState<File | null>(null);

  const companyDisplay = useMemo(() => {
    const cid = safeStr(companyID) || safeStr(purchaseOrder.companyID);
    const match = (companies || []).find((c) => safeStr(c.shortName) === cid);
    if (match) return safeStr(match.displayName || match.shortName);
    // server sometimes sends "DisplayName (shortName)"
    if (purchaseOrder.companyName) {
      const s = safeStr(purchaseOrder.companyName);
      const idx = s.indexOf(" (");
      return idx > 0 ? s.slice(0, idx).trim() : s;
    }
    return cid || "-";
  }, [companyID, purchaseOrder.companyID, purchaseOrder.companyName, companies]);

  const currentPdfUrl = safeStr(purchaseOrder.purchaseOrderPdfUrl);

  const createdText = fmtDate(purchaseOrder.createdAt);
  const updatedText = fmtDate(purchaseOrder.updatedAt);

  const canSave = useMemo(() => {
    if (isSaving) return false;

    if (saveMode === "create") {
      return Boolean(safeStr(poNumber) && safeStr(companyID) && safeStr(gid));
    }

    // update:
    // - enable if note OR pdf chosen
    // - if pdf chosen, require note
    const noteOk = Boolean(safeStr(note));
    if (pdfFile && !noteOk) return false;
    return noteOk || Boolean(pdfFile);
  }, [isSaving, saveMode, poNumber, companyID, gid, note, pdfFile]);

  const submit = async () => {
    const trimmedPo = safeStr(poNumber);
    const trimmedGid = safeStr(gid);
    const trimmedCompany = safeStr(companyID);
    const trimmedNote = safeStr(note);

    const poToSave: UIPurchaseOrder = {
      ...purchaseOrder,
      shortName: trimmedPo || purchaseOrder.shortName,
      purchaseOrderGID: trimmedGid || purchaseOrder.purchaseOrderGID,
      companyID: trimmedCompany || purchaseOrder.companyID || null,
    };

    await onSave(saveMode, {
      purchaseOrder: poToSave,
      companyID: trimmedCompany,
      note: trimmedNote ? trimmedNote : null,
      pdfFile,
    });

    // clear transient fields after a successful save (parent updates selected PO)
    setNote("");
    setPdfFile(null);
  };

  return (
    <div style={overlayStyle} onMouseDown={onClose}>
      <div style={modalStyle} onMouseDown={(e) => e.stopPropagation()}>
        <div style={headerStyle}>
          <div style={titleStyle}>
            {isCreate ? "Create Purchase Order" : "Purchase Order Details"}
          </div>

          <button type="button" style={closeBtnStyle} onClick={onClose} disabled={isSaving}>
            <X size={16} />
            Close
          </button>
        </div>

        <div style={bodyStyle}>
          {error ? <div style={errorStyle}>{error}</div> : null}

          <div style={gridStyle}>
            {/* Purchase Order */}
            <div style={fieldStyle}>
              <div style={labelStyle}>Purchase Order</div>

              {isCreate ? (
                <>
                  <input
                    style={inputStyle}
                    value={poNumber}
                    onChange={(e) => setPoNumber(e.target.value)}
                    placeholder="Enter the PO number"
                    disabled={isSaving}
                  />
                </>
              ) : (
                <div style={readOnlyBoxStyle}>
                  <a
                    href={adminPurchaseOrderUrl(purchaseOrder.purchaseOrderGID)}
                    target="_blank"
                    rel="noreferrer"
                    style={{ color: "#2563eb", fontWeight: 900, textDecoration: "none" }}
                  >
                    {safeStr(purchaseOrder.shortName) || "-"}
                  </a>
                </div>
              )}
            </div>

            {/* For Create: show "Created By" with user name; For View: show Created */}
            {isCreate ? (
              <div style={fieldStyle}>
                <div style={labelStyle}>Created By</div>
                <div style={readOnlyBoxStyle}>{currentUserName}</div>
              </div>
            ) : (
              <div style={fieldStyle}>
                <div style={labelStyle}>Created</div>
                <div style={readOnlyBoxStyle}>{createdText}</div>
              </div>
            )}

            {/* Shopify PO ID - only shown in create mode */}
            {isCreate ? (
              <div style={fieldStyle}>
                <div style={labelStyle}>Shopify Purchase Order ID</div>
                <input
                  style={inputStyle}
                  value={gid}
                  onChange={(e) => setGid(e.target.value)}
                  placeholder="Enter the number at the end of the PO URL"
                  disabled={isSaving}
                />
              </div>
            ) : null}

            {/* Company */}
            <div style={fieldStyle}>
              <div style={labelStyle}>Company</div>

              {isCreate ? (
                <select
                  style={inputStyle}
                  value={companyID}
                  onChange={(e) => setCompanyID(e.target.value)}
                  disabled={isSaving}
                >
                  <option value="">Select a company…</option>
                  {(companies || []).map((c) => (
                    <option key={safeStr(c.shortName)} value={safeStr(c.shortName)}>
                      {safeStr(c.displayName) || safeStr(c.shortName)}
                    </option>
                  ))}
                </select>
              ) : (
                <div style={readOnlyBoxStyle}>{companyDisplay}</div>
              )}

              {isCreate ? (
                <div style={helperStyle}>Select the company for this purchase order.</div>
              ) : null}
            </div>

            {/* For View: Last Updated By */}
            {!isCreate ? (
              <div style={fieldStyle}>
                <div style={labelStyle}>Last Updated By</div>
                <div style={readOnlyBoxStyle}>{safeStr(purchaseOrder.lastUpdatedBy) || "-"}</div>
              </div>
            ) : null}

            {/* For View: PDF (swapped with Last Updated) */}
            {!isCreate ? (
              <div style={fieldStyle}>
                <div style={labelStyle}>PDF</div>

                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {currentPdfUrl ? (
                    <div style={readOnlyBoxStyle}>
                      <a
                        href={currentPdfUrl}
                        target="_blank"
                        rel="noreferrer"
                        style={{ color: "#2563eb", fontWeight: 900, textDecoration: "none" }}
                      >
                        View current PDF
                      </a>
                    </div>
                  ) : (
                    <div style={readOnlyBoxStyle}>No PDF uploaded</div>
                  )}

                  <input
                    type="file"
                    accept="application/pdf"
                    disabled={isSaving}
                    onChange={(e) => {
                      const f = e.target.files && e.target.files[0] ? e.target.files[0] : null;
                      setPdfFile(f);
                    }}
                  />

                  {pdfFile ? (
                    <div style={helperStyle}>
                      Selected: <b>{pdfFile.name}</b>
                      {!safeStr(note) ? (
                        <div style={{ color: "#991b1b", marginTop: 4 }}>
                          Note is required when uploading a new PDF.
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}

            {/* For View: Last Updated (swapped with PDF) */}
            {!isCreate ? (
              <div style={fieldStyle}>
                <div style={labelStyle}>Last Updated</div>
                <div style={readOnlyBoxStyle}>{updatedText}</div>
              </div>
            ) : null}

            {/* For Create: PDF upload */}
            {isCreate ? (
              <div style={fieldStyle}>
                <div style={labelStyle}>PDF (Optional)</div>

                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <input
                    type="file"
                    accept="application/pdf"
                    disabled={isSaving}
                    onChange={(e) => {
                      const f = e.target.files && e.target.files[0] ? e.target.files[0] : null;
                      setPdfFile(f);
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

            {/* Note */}
            <div style={fieldStyle}>
              <div style={labelStyle}>Note</div>
              <textarea
                style={{ ...inputStyle, minHeight: 104, resize: "vertical" }}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={isCreate ? "Optional note…" : "Enter a note (required if uploading a new PDF)…"}
                disabled={isSaving}
              />
            </div>
          </div>

          <div style={sectionTitleStyle}>History</div>

          {Array.isArray(purchaseOrder.notes) && purchaseOrder.notes.length > 0 ? (
            purchaseOrder.notes.map((n) => (
              <div key={safeStr(n.id)} style={historyItemStyle}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                  <div style={{ fontWeight: 900, color: "#0f172a" }}>
                    {displayEventType(n.eventType)}
                  </div>
                  <div style={{ fontSize: 12, color: "#64748b" }}>
                    {fmtDate(n.timestamp)} {n.user ? `• ${safeStr(n.user)}` : ""}
                  </div>
                </div>

                {safeStr(n.content) ? (
                  <div style={{ marginTop: 8, fontSize: 13, color: "#0f172a" }}>
                    {safeStr(n.content)}
                  </div>
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

        <div style={footerStyle}>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {onDelete && !isCreate ? (
              <button
                type="button"
                style={dangerBtnStyle}
                disabled={isSaving}
                onClick={() => onDelete(purchaseOrder)}
              >
                <Trash2 size={16} />
                Delete
              </button>
            ) : null}
          </div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button type="button" style={btnStyle} onClick={onClose} disabled={isSaving}>
              Cancel
            </button>

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
              {isCreate ? "Create Purchase Order" : "Update Purchase Order"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default PurchaseOrderDetailsModal;
