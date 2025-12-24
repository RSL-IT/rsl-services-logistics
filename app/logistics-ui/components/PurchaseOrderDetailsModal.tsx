// app/logistics-ui/components/PurchaseOrderDetailsModal.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";

export type UICompany = {
  shortName: string;
  displayName?: string | null;

  // Optional rollover details (safe if not provided)
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

export type UIPurchaseOrder = {
  id?: number | string; // "new" for create mode is common in your project
  shortName: string;
  purchaseOrderGID: string;
  purchaseOrderPdfUrl?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  companyID?: string | null;
  companyName?: string | null;
};

type UINote = {
  id: number;
  createdAt: string;
  content: string;
  pdfUrl?: string | null;
  pdfFileName?: string | null;
  eventType?: string | null;
  user?: { id: number; displayName?: string | null; email?: string | null } | null;
};

function getShopParam(): string | null {
  try {
    const s = new URLSearchParams(window.location.search).get("shop");
    return s ? String(s).trim() : null;
  } catch {
    return null;
  }
}

function withShop(url: string): string {
  const shop = getShopParam();
  if (!shop) return url;

  try {
    const u = new URL(url, window.location.origin);
    u.searchParams.set("shop", shop);
    return u.toString();
  } catch {
    return url.includes("?")
      ? `${url}&shop=${encodeURIComponent(shop)}`
      : `${url}?shop=${encodeURIComponent(shop)}`;
  }
}

function formatDateTime(v: string | null | undefined): string {
  if (!v) return "-";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleString();
}

function isNewPurchaseOrder(po: UIPurchaseOrder | null | undefined): boolean {
  if (!po) return true;
  const s = String(po.id ?? "").trim().toLowerCase();
  return !s || s === "new";
}

function pickCompanyDisplay(c: UICompany) {
  return c.displayName ? `${c.displayName} (${c.shortName})` : c.shortName;
}

function buildCompanyRolloverText(c?: UICompany | null) {
  if (!c) return "";
  const lines: string[] = [];
  lines.push(pickCompanyDisplay(c));

  const addr = [c.address1, c.address2].filter(Boolean).map(String).join(" · ");
  if (addr) lines.push(addr);

  const cityLine = [c.city, c.province, c.postalCode, c.country].filter(Boolean).map(String).join(", ");
  if (cityLine) lines.push(cityLine);

  const contactLine = [c.primaryContact, c.primaryEmail, c.primaryPhone].filter(Boolean).map(String).join(" · ");
  if (contactLine) lines.push(contactLine);

  if (c.supplierCurrency) lines.push(`Currency: ${c.supplierCurrency}`);

  return lines.join("\n");
}

function adminPurchaseOrderUrl(purchaseOrderGID: string): string {
  const id = encodeURIComponent(String(purchaseOrderGID || "").trim());
  return `https://admin.shopify.com/store/rogersoundlabs/purchase_orders/${id}`;
}

export default function PurchaseOrderDetailsModal(props: {
  open: boolean;
  mode: "create" | "view";
  purchaseOrder: UIPurchaseOrder;
  companies: UICompany[];
  onClose: () => void;
  onSaved: (po: UIPurchaseOrder) => void;
}) {
  const { open, mode, purchaseOrder, companies, onClose, onSaved } = props;

  // We compute create/view mode without early returns (hooks must be stable)
  const isCreate = mode === "create" || isNewPurchaseOrder(purchaseOrder);

  const [saving, setSaving] = useState(false);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [companyID, setCompanyID] = useState(purchaseOrder.companyID || "");
  const [purchaseOrderGID, setPurchaseOrderGID] = useState(purchaseOrder.purchaseOrderGID || "");
  const [currentPdfUrl, setCurrentPdfUrl] = useState<string | null>(purchaseOrder.purchaseOrderPdfUrl || null);

  // Deferred upload: file is held until Save click
  const [pendingPdfFile, setPendingPdfFile] = useState<File | null>(null);

  // Main note field (always visible)
  // - Create: optional
  // - Update: required
  const [note, setNote] = useState("");

  // History notes (view-only)
  const [notes, setNotes] = useState<UINote[]>([]);

  // Snapshot for "has changes"
  const initialRef = useRef<{
    isCreate: boolean;
    companyID: string;
    purchaseOrderGID: string;
    pdfUrl: string | null;
    note: string;
  } | null>(null);

  // Build company map for rollover text in view mode
  const companyMap = useMemo(() => {
    const m = new Map<string, UICompany>();
    for (const c of companies || []) m.set(String(c.shortName), c);
    return m;
  }, [companies]);

  const viewCompany = useMemo(() => {
    const key = String(purchaseOrder.companyID || "").trim();
    return key ? companyMap.get(key) || null : null;
  }, [purchaseOrder.companyID, companyMap]);

  const companyRollover = useMemo(() => buildCompanyRolloverText(viewCompany), [viewCompany]);

  // When modal opens or PO changes, reset
  useEffect(() => {
    if (!open) return;

    setError(null);
    setSaving(false);
    setLoadingDetails(false);

    setCompanyID(purchaseOrder.companyID || "");
    setPurchaseOrderGID(purchaseOrder.purchaseOrderGID || "");
    setCurrentPdfUrl(purchaseOrder.purchaseOrderPdfUrl || null);

    setPendingPdfFile(null);
    setNote("");
    setNotes([]);

    initialRef.current = {
      isCreate,
      companyID: String(purchaseOrder.companyID || ""),
      purchaseOrderGID: String(purchaseOrder.purchaseOrderGID || ""),
      pdfUrl: purchaseOrder.purchaseOrderPdfUrl || null,
      note: "",
    };

    // Load history in view mode
    if (!isCreate && purchaseOrder.purchaseOrderGID) {
      void (async () => {
        try {
          setLoadingDetails(true);
          const res = await fetch(
            withShop(
              `/apps/logistics/purchase-orders?intent=details&purchaseOrderGID=${encodeURIComponent(
                purchaseOrder.purchaseOrderGID
              )}`
            ),
            { method: "GET", headers: { Accept: "application/json" } }
          );
          const data = await res.json().catch(() => null);
          if (!res.ok || !data?.success) throw new Error(data?.error || `Failed to load details (${res.status})`);

          if (data?.purchaseOrder?.purchaseOrderPdfUrl) setCurrentPdfUrl(data.purchaseOrder.purchaseOrderPdfUrl);
          setNotes(Array.isArray(data.notes) ? data.notes : []);
        } catch (e: any) {
          setError(e?.message || "Failed to load purchase order details.");
        } finally {
          setLoadingDetails(false);
        }
      })();
    }
  }, [open, purchaseOrder, isCreate]);

  // Display dates per your rules
  const createdDisplay = useMemo(() => {
    if (isCreate) return formatDateTime(new Date().toISOString());
    return formatDateTime(purchaseOrder.createdAt || null);
  }, [isCreate, purchaseOrder.createdAt]);

  const updatedDisplay = useMemo(() => {
    if (isCreate) return "-";
    return formatDateTime(purchaseOrder.updatedAt || null);
  }, [isCreate, purchaseOrder.updatedAt]);

  // "Cancel" if anything entered/selected
  const hasChanges = useMemo(() => {
    if (!open) return false;

    if (isCreate) {
      return (
        !!String(companyID || "").trim() ||
        !!String(purchaseOrderGID || "").trim() ||
        !!pendingPdfFile ||
        !!String(note || "").trim()
      );
    }

    // View/update: enable Update when note or pdf selected
    return !!pendingPdfFile || !!String(note || "").trim();
  }, [open, isCreate, companyID, purchaseOrderGID, pendingPdfFile, note]);

  const closeLabel = hasChanges ? "Cancel" : "Close";

  const canCreate = useMemo(() => {
    if (!isCreate) return false;
    return !!String(companyID || "").trim() && !!String(purchaseOrderGID || "").trim();
  }, [isCreate, companyID, purchaseOrderGID]);

  const canUpdate = useMemo(() => {
    if (isCreate) return false;
    return hasChanges;
  }, [isCreate, hasChanges]);

  async function handleClose() {
    setError(null);
    if (!hasChanges) {
      onClose();
      return;
    }
    const ok = window.confirm("Discard changes?");
    if (ok) onClose();
  }

  async function handleSave() {
    setError(null);

    if (isCreate) {
      if (!String(companyID || "").trim() || !String(purchaseOrderGID || "").trim()) {
        setError("Company and Purchase Order are required.");
        return;
      }
      // note optional on create
    } else {
      // note required on update (per your request)
      if (!String(note || "").trim()) {
        setError("Note is required when updating a purchase order.");
        return;
      }
      if (!purchaseOrder.purchaseOrderGID) {
        setError("Missing purchaseOrderGID for update.");
        return;
      }
      if (!hasChanges) {
        setError("No changes to save.");
        return;
      }
    }

    try {
      setSaving(true);

      const fd = new FormData();
      fd.append("intent", isCreate ? "create" : "update");

      const poPayload: any = {};

      if (isCreate) {
        const gid = String(purchaseOrderGID || "").trim();

        // UI now treats "Purchase Order" as the GID.
        poPayload.purchaseOrderGID = gid;

        // Server requires shortName; we keep them the same so create works
        poPayload.shortName = gid;

        poPayload.companyID = String(companyID || "").trim();
      } else {
        // read-only fields on update
        poPayload.purchaseOrderGID = purchaseOrder.purchaseOrderGID;
        poPayload.shortName = purchaseOrder.shortName;
        poPayload.companyID = purchaseOrder.companyID;
      }

      fd.append("purchaseOrder", JSON.stringify(poPayload));
      fd.append("note", note);

      if (pendingPdfFile) {
        fd.append("pdf", pendingPdfFile);
      }

      const res = await fetch(withShop("/apps/logistics/purchase-orders"), {
        method: "POST",
        body: fd,
      });

      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        throw new Error(data?.error || `Save failed (${res.status})`);
      }

      const savedPo: UIPurchaseOrder = data.purchaseOrder;
      onSaved(savedPo);
      onClose();
    } catch (e: any) {
      setError(e?.message || "Save failed.");
    } finally {
      setSaving(false);
    }
  }

  // ----- Styles -----
  const overlayStyle: React.CSSProperties = {
    position: "fixed",
    inset: 0,
    background: "rgba(15,23,42,0.55)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
    zIndex: 9999,
  };

  const cardStyle: React.CSSProperties = {
    width: "min(980px, 100%)",
    maxHeight: "90vh",
    overflow: "auto",
    background: "white",
    borderRadius: 16,
    boxShadow: "0 25px 60px rgba(0,0,0,0.25)",
    border: "1px solid #e2e8f0",
  };

  const headerStyle: React.CSSProperties = {
    padding: 16,
    borderBottom: "1px solid #e2e8f0",
    display: "flex",
    justifyContent: "space-between",
    gap: 12,
    alignItems: "center",
  };

  const sectionStyle: React.CSSProperties = {
    padding: 16,
    borderBottom: "1px solid #f1f5f9",
  };

  const labelStyle: React.CSSProperties = {
    fontSize: 12,
    fontWeight: 900,
    color: "#0f172a",
    marginBottom: 6,
  };

  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid #e2e8f0",
    outline: "none",
    fontSize: 13,
  };

  const roStyle: React.CSSProperties = {
    ...inputStyle,
    background: "#f8fafc",
    color: "#334155",
  };

  const linkStyle: React.CSSProperties = {
    color: "#0f172a",
    textDecoration: "underline",
    fontWeight: 900,
  };

  const footerStyle: React.CSSProperties = {
    padding: 16,
    display: "flex",
    justifyContent: "space-between",
    gap: 12,
    alignItems: "center",
  };

  const title = isCreate ? "Create Purchase Order" : "Purchase Order Details";

  const purchaseOrderHref = useMemo(() => {
    const gid = String(purchaseOrder.purchaseOrderGID || "").trim();
    return gid ? adminPurchaseOrderUrl(gid) : "";
  }, [purchaseOrder.purchaseOrderGID]);

  // IMPORTANT: We now return null AFTER hooks (fixes hook-order ESLint)
  if (!open) return null;

  return (
    <div
      style={overlayStyle}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) void handleClose();
      }}
    >
      <div style={cardStyle} onMouseDown={(e) => e.stopPropagation()}>
        <div style={headerStyle}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 900 }}>{title}</div>
            {!isCreate ? (
              <div style={{ marginTop: 4, fontSize: 12, color: "#64748b", fontWeight: 700 }}>
                {purchaseOrder.shortName} · {purchaseOrder.purchaseOrderGID}
              </div>
            ) : null}
          </div>
          <button
            type="button"
            onClick={() => void handleClose()}
            style={{
              padding: "8px 10px",
              borderRadius: 12,
              border: "1px solid #e2e8f0",
              background: "white",
              cursor: "pointer",
              fontWeight: 900,
            }}
          >
            ✕
          </button>
        </div>

        {error ? (
          <div style={{ padding: 16, background: "#fff1f2", borderBottom: "1px solid #fecdd3" }}>
            <div style={{ fontWeight: 900, color: "#9f1239" }}>Error</div>
            <div style={{ color: "#9f1239" }}>{error}</div>
          </div>
        ) : null}

        {/* Top: Company | Purchase Order; Created | Last Updated */}
        <div style={sectionStyle}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <div style={labelStyle}>Company</div>
              {isCreate ? (
                <select value={companyID} onChange={(e) => setCompanyID(e.target.value)} style={inputStyle}>
                  <option value="">Select a company…</option>
                  {companies.map((c) => (
                    <option key={c.shortName} value={c.shortName}>
                      {pickCompanyDisplay(c)}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  style={roStyle}
                  value={purchaseOrder.companyName || purchaseOrder.companyID || "-"}
                  readOnly
                  title={companyRollover}
                />
              )}
            </div>

            <div>
              <div style={labelStyle}>Purchase Order</div>
              {isCreate ? (
                <input
                  style={inputStyle}
                  value={purchaseOrderGID}
                  onChange={(e) => setPurchaseOrderGID(e.target.value)}
                  placeholder="Enter Shopify Purchase Order ID…"
                />
              ) : (
                <div style={roStyle}>
                  {purchaseOrderHref ? (
                    <a href={purchaseOrderHref} target="_blank" rel="noreferrer" style={linkStyle}>
                      {purchaseOrder.shortName || purchaseOrder.purchaseOrderGID || "-"} ↗
                    </a>
                  ) : (
                    <span style={{ fontWeight: 900, color: "#334155" }}>
                      {purchaseOrder.shortName || "-"}
                    </span>
                  )}
                </div>
              )}
            </div>

            <div>
              <div style={labelStyle}>Created</div>
              <input style={roStyle} value={createdDisplay} readOnly />
            </div>

            <div>
              <div style={labelStyle}>Last Updated</div>
              <input style={roStyle} value={updatedDisplay} readOnly />
            </div>
          </div>
        </div>

        {/* PDF + Note */}
        <div style={sectionStyle}>
          <div style={{ fontSize: 13, fontWeight: 950, marginBottom: 10 }}>PDF</div>

          {currentPdfUrl ? (
            <div
              style={{
                marginBottom: 10,
                display: "flex",
                justifyContent: "space-between",
                gap: 12,
                alignItems: "center",
              }}
            >
              <div style={{ fontSize: 12, fontWeight: 900, color: "#0f172a" }}>PDF linked</div>
              <a href={currentPdfUrl} target="_blank" rel="noreferrer" style={{ ...linkStyle, fontSize: 12 }}>
                View PDF ↗
              </a>
            </div>
          ) : (
            <div style={{ marginBottom: 10, fontSize: 12, color: "#64748b", fontWeight: 700 }}>
              No PDF linked.
            </div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <div style={labelStyle}>{isCreate ? "Select PDF (optional)" : "Select new PDF (optional)"}</div>
              <input
                type="file"
                accept="application/pdf"
                style={inputStyle}
                onChange={(e) => setPendingPdfFile(e.target.files?.[0] || null)}
              />
              {pendingPdfFile ? (
                <div style={{ marginTop: 6, fontSize: 12, color: "#334155", fontWeight: 800 }}>
                  Selected: {pendingPdfFile.name}
                </div>
              ) : null}
            </div>

            <div>
              <div style={labelStyle}>{isCreate ? "Note (optional)" : "Note (required)"}</div>
              <textarea
                style={{ ...inputStyle, minHeight: 42, resize: "vertical" }}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={isCreate ? "Optional note…" : "Required (reason for update)…"}
              />
            </div>
          </div>
        </div>

        {/* History */}
        {!isCreate ? (
          <div style={sectionStyle}>
            <div style={{ fontSize: 13, fontWeight: 950 }}>History</div>

            <div style={{ marginTop: 12 }}>
              {loadingDetails ? (
                <div style={{ color: "#64748b", fontWeight: 700, fontSize: 12 }}>Loading notes…</div>
              ) : notes.length === 0 ? (
                <div style={{ color: "#64748b", fontWeight: 700, fontSize: 12 }}>No notes yet.</div>
              ) : (
                <div style={{ display: "grid", gap: 10 }}>
                  {notes.map((n) => (
                    <div
                      key={n.id}
                      style={{
                        border: "1px solid #e2e8f0",
                        borderRadius: 14,
                        padding: 12,
                        background: "white",
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                        <div style={{ fontWeight: 950, fontSize: 12, color: "#0f172a" }}>
                          {n.eventType || "NOTE"}
                        </div>
                        <div style={{ fontSize: 12, color: "#64748b", fontWeight: 800 }}>
                          {formatDateTime(n.createdAt)}
                        </div>
                      </div>

                      <div style={{ marginTop: 6, fontSize: 13, color: "#0f172a", whiteSpace: "pre-wrap" }}>
                        {n.content}
                      </div>

                      {n.pdfUrl ? (
                        <div style={{ marginTop: 8 }}>
                          <a href={n.pdfUrl} target="_blank" rel="noreferrer" style={{ ...linkStyle, fontSize: 12 }}>
                            View attached PDF ↗
                          </a>
                          {n.pdfFileName ? (
                            <div style={{ marginTop: 4, fontSize: 12, color: "#64748b", fontWeight: 700 }}>
                              {n.pdfFileName}
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : null}

        {/* Footer */}
        <div style={footerStyle}>
          <button
            type="button"
            onClick={() => void handleClose()}
            style={{
              padding: "10px 12px",
              borderRadius: 12,
              border: "1px solid #e2e8f0",
              background: "white",
              cursor: "pointer",
              fontWeight: 900,
            }}
            disabled={saving}
          >
            {closeLabel}
          </button>

          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving || (isCreate ? !canCreate : !canUpdate)}
            style={{
              padding: "10px 12px",
              borderRadius: 12,
              border: "1px solid #0f172a",
              background: "#0f172a",
              color: "white",
              cursor: saving || (isCreate ? !canCreate : !canUpdate) ? "not-allowed" : "pointer",
              fontWeight: 950,
              opacity: saving || (isCreate ? !canCreate : !canUpdate) ? 0.45 : 1,
            }}
          >
            {saving ? "Saving…" : isCreate ? "Create Purchase Order" : "Update Purchase Order"}
          </button>
        </div>
      </div>
    </div>
  );
}
