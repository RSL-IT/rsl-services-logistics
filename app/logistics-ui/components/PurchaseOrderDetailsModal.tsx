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
  SKU?: string | null;

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

  createdAt?: string | Date | null;
  updatedAt?: string | Date | null;

  companyID?: string | null;
  companyName?: string | null;

  lastUpdatedBy?: string | null;

  // Products assigned to this PO (association only)
  products?: UIPurchaseOrderProduct[];

  notes?: UIPurchaseOrderNote[];
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
  rslModels: RslModelOption[];
  currentUser?: CurrentUser | null;

  // View-only mode for suppliers (no editing, no delete)
  viewOnly?: boolean;

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
    }
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
    .map((p) => safeStr(p?.rslModelID || (p as any)?.rslProductID || p?.shortName))
    .filter(Boolean);
  return uniqStrings(ids);
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

// Scroll container for modal content. Footer stays visible.
const bodyStyle: React.CSSProperties = {
  padding: 16,
  overflow: "auto",
  flex: 1,
  minHeight: 0,
};

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

const checkboxWrapStyle: React.CSSProperties = {
  border: "1px solid #e2e8f0",
  borderRadius: 12,
  background: "#fff",
  padding: 12,
  maxHeight: 260,
  overflow: "auto",
};

const checkboxGridStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
  gap: 10,
};

const checkboxItemStyle: React.CSSProperties = {
  display: "flex",
  gap: 10,
  alignItems: "flex-start",
  border: "1px solid #e2e8f0",
  borderRadius: 12,
  padding: 10,
  background: "#ffffff",
  cursor: "pointer",
};

export function PurchaseOrderDetailsModal({
                                            mode,
                                            purchaseOrder,
                                            companies,
                                            rslModels,
                                            currentUser,
                                            viewOnly = false,
                                            isSaving = false,
                                            error = null,
                                            onClose,
                                            onSave,
                                            onDelete,
                                          }: PurchaseOrderDetailsModalProps) {
  const isCreate = mode === "create";
  const saveMode: SaveMode = isCreate ? "create" : "update";

  const currentUserName = safeStr(currentUser?.displayName || currentUser?.name || currentUser?.email) || "Current User";

  const [poNumber, setPoNumber] = useState<string>(safeStr(purchaseOrder.shortName));
  const [gid, setGid] = useState<string>(safeStr(purchaseOrder.purchaseOrderGID));
  const [companyID, setCompanyID] = useState<string>(safeStr(purchaseOrder.companyID));
  const [note, setNote] = useState<string>("");
  const [pdfFile, setPdfFile] = useState<File | null>(null);

  const rslModelMap = useMemo(() => {
    const m = new Map<string, RslModelOption>();
    for (const x of rslModels || []) {
      const id = safeStr(x?.shortName);
      if (id) m.set(id, x);
    }
    return m;
  }, [rslModels]);

  const allModelsSorted = useMemo(() => {
    const list = Array.isArray(rslModels) ? rslModels.slice() : [];
    list.sort((a, b) => safeStr(a.displayName || a.shortName).localeCompare(safeStr(b.displayName || b.shortName)));
    return list;
  }, [rslModels]);

  // Product association selection
  const baselineSelectedRef = useRef<Set<string>>(new Set());
  const [selectedSet, setSelectedSet] = useState<Set<string>>(() => {
    const ids = normalizeSelectedIdsFromPo(purchaseOrder);
    return new Set(ids);
  });

  // Reset modal state when switching POs/modes
  useEffect(() => {
    setPoNumber(safeStr(purchaseOrder.shortName));
    setGid(safeStr(purchaseOrder.purchaseOrderGID));
    setCompanyID(safeStr(purchaseOrder.companyID));
    setNote("");
    setPdfFile(null);

    const ids = normalizeSelectedIdsFromPo(purchaseOrder);
    const next = new Set(ids);
    setSelectedSet(next);
    baselineSelectedRef.current = new Set(ids);
  }, [mode, purchaseOrder?.purchaseOrderGID, purchaseOrder?.id]);

  const selectedCount = selectedSet.size;

  const productsChanged = useMemo(() => {
    return !setsEqual(selectedSet, baselineSelectedRef.current);
  }, [selectedSet]);

  const toggleProduct = (id: string) => {
    const clean = safeStr(id);
    if (!clean) return;
    setSelectedSet((prev) => {
      const next = new Set(prev);
      if (next.has(clean)) next.delete(clean);
      else next.add(clean);
      return next;
    });
  };

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

  const currentPdfUrl = safeStr(purchaseOrder.purchaseOrderPdfUrl);
  const createdText = fmtDate(purchaseOrder.createdAt);
  const updatedText = fmtDate(purchaseOrder.updatedAt);

  const canSave = useMemo(() => {
    if (isSaving) return false;

    if (saveMode === "create") {
      return Boolean(safeStr(poNumber) && safeStr(companyID) && safeStr(gid) && selectedCount > 0);
    }

    // update:
    // - allow if note OR pdf (requires note) OR products changed
    const noteOk = Boolean(safeStr(note));
    if (pdfFile && !noteOk) return false;
    return noteOk || Boolean(pdfFile) || productsChanged;
  }, [isSaving, saveMode, poNumber, companyID, gid, note, pdfFile, selectedCount, productsChanged]);

  const submit = async () => {
    const trimmedPo = safeStr(poNumber);
    const trimmedGid = safeStr(gid);
    const trimmedCompany = safeStr(companyID);
    const trimmedNote = safeStr(note);

    const selectedProducts: UIPurchaseOrderProduct[] = Array.from(selectedSet)
      .map((id) => {
        const meta = rslModelMap.get(id);
        return {
          rslModelID: id,
          rslProductID: id,
          shortName: meta?.shortName || id,
          displayName: meta?.displayName || id,
          SKU: meta?.SKU || null,
          quantity: 0,
        };
      })
      .sort((a, b) => safeStr(a.displayName || a.shortName).localeCompare(safeStr(b.displayName || b.shortName)));

    const poToSave: UIPurchaseOrder = {
      ...purchaseOrder,
      shortName: trimmedPo || purchaseOrder.shortName,
      purchaseOrderGID: trimmedGid || purchaseOrder.purchaseOrderGID,
      companyID: trimmedCompany || purchaseOrder.companyID || null,
      products: selectedProducts,
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
          <div style={titleStyle}>{isCreate ? "Create Purchase Order" : "Purchase Order Details"}</div>

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
                    placeholder="Enter the PO number"
                    disabled={isSaving}
                  />
                </div>
              ) : (
                <div style={readOnlyBoxStyle}>
                  {viewOnly ? (
                    <span style={{ fontWeight: 900, color: "#0f172a" }}>
                      #{safeStr(purchaseOrder.shortName) || "-"}
                    </span>
                  ) : (
                    <a
                      href={adminPurchaseOrderUrl(purchaseOrder.purchaseOrderGID)}
                      target="_blank"
                      rel="noreferrer"
                      style={{ color: "#2563eb", fontWeight: 900, textDecoration: "none" }}
                    >
                      #{safeStr(purchaseOrder.shortName) || "-"}
                    </a>
                  )}
                </div>
              )}
            </div>

            {/* For Create: show "Created By"; For View: show Created */}
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

              {isCreate ? <div style={helperStyle}>Select the company for this purchase order.</div> : null}
            </div>

            {/* Products (Create + View/Update) */}
            <div style={{ ...fieldStyle, gridColumn: "1 / -1" }}>
              <div style={labelStyle}>Products</div>

              {!viewOnly && (
                <div style={{ ...helperStyle, marginTop: 2 }}>
                  {isCreate
                    ? "Select at least one product to create a purchase order."
                    : "Check/uncheck products, then click Update Purchase Order to save changes."}
                </div>
              )}

              {isCreate && selectedCount === 0 ? (
                <div style={{ ...helperStyle, color: "#991b1b" }}>At least one product must be selected.</div>
              ) : null}

              <div style={checkboxWrapStyle}>
                <div style={checkboxGridStyle}>
                  {allModelsSorted.length === 0 ? (
                    <div style={helperStyle}>No products found in the product table.</div>
                  ) : (
                    allModelsSorted.map((m) => {
                      const id = safeStr(m.shortName);
                      if (!id) return null;
                      const checked = selectedSet.has(id);
                      // In viewOnly mode, only show selected products
                      if (viewOnly && !checked) return null;
                      return (
                        <label
                          key={id}
                          style={{
                            ...checkboxItemStyle,
                            ...(checked ? { borderColor: "#93c5fd", background: "#eff6ff" } : {}),
                            ...(viewOnly ? { cursor: "default" } : {}),
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleProduct(id)}
                            disabled={isSaving || viewOnly}
                            style={{ marginTop: 2, ...(viewOnly ? { display: "none" } : {}) }}
                          />
                          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                            <div style={{ fontWeight: 900, fontSize: 12, color: "#0f172a" }}>
                              {safeStr(m.displayName) || id}
                            </div>
                            <div style={{ fontSize: 11, color: "#64748b" }}>
                              {id}
                              {safeStr(m.SKU) ? ` • ${safeStr(m.SKU)}` : ""}
                            </div>
                          </div>
                        </label>
                      );
                    })
                  )}
                </div>
              </div>

              <div style={{ ...helperStyle, marginTop: 6 }}>Selected: {selectedCount}</div>
            </div>

            {/* For View: Last Updated By */}
            {!isCreate ? (
              <div style={fieldStyle}>
                <div style={labelStyle}>Last Updated By</div>
                <div style={readOnlyBoxStyle}>{safeStr(purchaseOrder.lastUpdatedBy) || "-"}</div>
              </div>
            ) : null}

            {/* For View: PDF */}
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

                  {!viewOnly && (
                    <>
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
                            <div style={{ color: "#991b1b", marginTop: 4 }}>Note is required when uploading a new PDF.</div>
                          ) : null}
                        </div>
                      ) : null}
                    </>
                  )}
                </div>
              </div>
            ) : null}

            {/* For View: Last Updated */}
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

            {/* Note - hidden in viewOnly mode */}
            {!viewOnly && (
              <div style={fieldStyle}>
                <div style={labelStyle}>Note</div>
                <textarea
                  style={{ ...inputStyle, minHeight: 104, resize: "vertical" }}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder={isCreate ? "Optional note…" : "Optional note… (required if uploading a new PDF)"}
                  disabled={isSaving}
                />
              </div>
            )}
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
            <button type="button" style={btnStyle} onClick={onClose} disabled={isSaving}>
              {viewOnly ? "Close" : "Cancel"}
            </button>

            {!viewOnly && (
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
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default PurchaseOrderDetailsModal;
