// /app/routes/app.returns.jsx
import { json } from "@remix-run/node";
import { useLoaderData, useFetcher } from "@remix-run/react";
import { prisma } from "../db.server";
import { authenticate } from "../shopify.server";
import {
  Page,
  Card,
  Tabs,
  IndexTable,
  Text,
  TextField,
  Button,
  Modal,
  Select,
  Link,
  InlineStack,
} from "@shopify/polaris";
import { useEffect, useMemo, useState } from "react";

// ───────────────────────────────────────────────────────────────────────────────
// CONFIG
const SCHEMA = process.env.DB_SCHEMA || "public";
// ───────────────────────────────────────────────────────────────────────────────

/**
 * ACTION: Lookup by serial, tracking, or order number; open modal on single match,
 * filter rows on multiple; error on zero.
 * - Priority when multiple provided: serial > tracking > order
 * - Case-insensitive EXACT match (LOWER(col::text) = LOWER(value))
 * - Canonical column first, fallback to alias columns
 */
export async function action({ request }) {
  await authenticate.admin(request);

  const form = await request.formData();
  const intent = form.get("intent");

  if (intent !== "lookup") {
    return json({ error: "Unknown action intent." }, { status: 400 });
  }

  const serialNumber = String(form.get("serialNumber") || "").trim();
  const trackingNumber = String(form.get("trackingNumber") || "").trim();
  const orderNumber = String(form.get("orderNumber") || "").trim();

  if (!serialNumber && !trackingNumber && !orderNumber) {
    return json(
      { error: "Enter a Serial Number, Tracking Number, or Order Number to lookup." },
      { status: 400 }
    );
  }

  const MODE = serialNumber ? "serial" : trackingNumber ? "tracking" : "order";
  const value = (serialNumber || trackingNumber || orderNumber).trim();
  const valueLC = value.toLowerCase();
  const valLitLC = sqlQuote(valueLC);

  const CANON =
    MODE === "serial" ? `"serial_number"` :
      MODE === "tracking" ? `"tracking_number"` :
        `"original_order"`;

  const ALIASES =
    MODE === "serial"
      ? [`"serial_number"`, `"serial"`, `"serialNumber"`, `"sn"`, `"serial_no"`, `"serialNo"`]
      : MODE === "tracking"
        ? [`"tracking_number"`, `"tracking"`, `"trackingNumber"`, `"tracking_no"`, `"trackingNo"`]
        : [`"original_order"`, `"order_number"`, `"order_no"`, `"orderid"`, `"order_id"`, `"orderId"`, `"order"`];

  const canonCond = `LOWER(${CANON}::text) = ${valLitLC}`;
  const aliasCond = ALIASES.map((c) => `LOWER(${c}::text) = ${valLitLC}`).join(" OR ");

  // Helper to try schema-qualified then unqualified
  async function countWhere(whereSql) {
    try {
      const r = await prisma.$queryRawUnsafe(
        `SELECT COUNT(*)::int AS n FROM "${SCHEMA}"."return_entry" WHERE ${whereSql}`
      );
      return Array.isArray(r) ? Number(r[0]?.n ?? 0) : Number(r?.n ?? 0);
    } catch {}
    try {
      const r2 = await prisma.$queryRawUnsafe(
        `SELECT COUNT(*)::int AS n FROM return_entry WHERE ${whereSql}`
      );
      return Array.isArray(r2) ? Number(r2[0]?.n ?? 0) : Number(r2?.n ?? 0);
    } catch {}
    return 0;
  }

  async function getOneRow(whereSql) {
    try {
      const a = await prisma.$queryRawUnsafe(
        `SELECT * FROM "${SCHEMA}"."return_entry" WHERE ${whereSql} ORDER BY 1 DESC LIMIT 1`
      );
      if (Array.isArray(a) && a.length) return a[0];
    } catch {}
    try {
      const b = await prisma.$queryRawUnsafe(
        `SELECT * FROM return_entry WHERE ${whereSql} ORDER BY 1 DESC LIMIT 1`
      );
      if (Array.isArray(b) && b.length) return b[0];
    } catch {}
    return null;
  }

  // 1) Try canonical column first
  let n = await countWhere(canonCond);
  if (n === 1) {
    const row = await getOneRow(canonCond);
    if (row) return json({ row: bigIntSafeRow(row), mode: MODE });
  }
  if (n > 1) {
    // multiple canonical matches → filter on client
    return json({ multi: { mode: MODE, value } });
  }

  // 2) Fallback to alias columns
  n = await countWhere(aliasCond);
  if (n === 0) {
    const label = MODE === "serial" ? "serial number" : MODE === "tracking" ? "tracking number" : "order number";
    return json({ error: `No match found for ${label}: ${value}` }, { status: 404 });
  }
  if (n > 1) {
    return json({ multi: { mode: MODE, value } });
  }
  // n === 1
  const row = await getOneRow(aliasCond);
  if (!row) {
    return json({ error: "Lookup failed after match found." }, { status: 500 });
  }
  return json({ row: bigIntSafeRow(row), mode: MODE });
}

function sqlQuote(v) {
  return `'${String(v).replace(/'/g, "''")}'`;
}

/**
 * Loader: never-throw, SELECT * fallback, diagnostics, lookups
 */
export async function loader({ request }) {
  await authenticate.admin(request);

  const diagnostics = {
    dbOk: null,
    count: null,
    used: null, // "join" | "simpleStar" | "schemaStar" | "none"
    joinErr: null,
    simpleStarErr: null,
    schemaStarErr: null,
    statusModelUsed: null,
    finalDispModelUsed: null,
    repairCondModelUsed: null,
  };

  try {
    await prisma.$queryRaw`SELECT 1`;
    diagnostics.dbOk = true;
  } catch {
    diagnostics.dbOk = false;
  }

  let rows = [];

  // Attempt 1: joined query
  try {
    const r = await prisma.$queryRaw`
      SELECT
        re.*,
        ci.value   AS item_label,
        rstat.value AS status_label
      FROM return_entry re
      LEFT JOIN csd_item ci ON ci.id = re.item_id
      LEFT JOIN repair_entry_returns_repair_status rstat ON rstat.id = re.status_id
      ORDER BY re.id DESC
      LIMIT 200
    `;
    if (Array.isArray(r) && r.length > 0) {
      rows = r;
      diagnostics.used = "join";
    }
  } catch (e) {
    diagnostics.joinErr = String(e?.message || e);
  }

  // Attempt 2: SELECT * unqualified
  if (rows.length === 0) {
    try {
      const r = await prisma.$queryRawUnsafe(
        `SELECT * FROM return_entry ORDER BY 1 DESC LIMIT 200`
      );
      if (Array.isArray(r) && r.length > 0) {
        rows = r;
        diagnostics.used = "simpleStar";
      }
    } catch (e) {
      diagnostics.simpleStarErr = String(e?.message || e);
    }
  }

  // Attempt 3: SELECT * schema-qualified
  if (rows.length === 0) {
    try {
      const r = await prisma.$queryRawUnsafe(
        `SELECT * FROM "${SCHEMA}"."return_entry" ORDER BY 1 DESC LIMIT 200`
      );
      if (Array.isArray(r) && r.length > 0) {
        rows = r;
        diagnostics.used = "schemaStar";
      }
    } catch (e) {
      diagnostics.schemaStarErr = String(e?.message || e);
    }
  }

  // Count (best effort)
  try {
    const c = await prisma.$queryRawUnsafe(
      `SELECT COUNT(*)::int AS count FROM "${SCHEMA}"."return_entry"`
    );
    diagnostics.count = Array.isArray(c) ? Number(c[0]?.count ?? 0) : Number(c?.count ?? 0);
  } catch {
    try {
      const c2 = await prisma.$queryRaw`SELECT COUNT(*) AS count FROM return_entry`;
      const val = Array.isArray(c2) ? c2[0]?.count : c2?.count;
      diagnostics.count = Number(val ?? 0);
    } catch {
      diagnostics.count = null;
    }
  }

  // Lookups
  const lookups = { items: [], statuses: [], finalDispositions: [], repairConditions: [] };

  try {
    lookups.items = await prisma.$queryRaw`
      SELECT id, value FROM csd_item ORDER BY value
    `;
  } catch {}

  try {
    lookups.statuses = await tryFindManyOnFirstModel(
      ["repairEntryReturnsRepairStatus", "repair_entry_returns_repair_status", "returnsRepairStatus"],
      { select: { id: true, value: true }, orderBy: { value: "asc" } },
      diagnostics,
      "statusModelUsed"
    );
    if (!Array.isArray(lookups.statuses) || lookups.statuses.length === 0) {
      lookups.statuses = await prisma.$queryRaw`
        SELECT id, value FROM repair_entry_returns_repair_status ORDER BY value
      `;
      diagnostics.statusModelUsed = "SQL:repair_entry_returns_repair_status";
    }
  } catch {
    try {
      lookups.statuses = await prisma.$queryRaw`
        SELECT id, value FROM repair_entry_returns_repair_status ORDER BY value
      `;
      diagnostics.statusModelUsed = "SQL:repair_entry_returns_repair_status";
    } catch {}
  }

  try {
    lookups.finalDispositions = await tryFindManyOnFirstModel(
      ["repairEntryDisposition", "repair_entry_disposition", "finalDisposition"],
      { select: { id: true, value: true }, orderBy: { value: "asc" } },
      diagnostics,
      "finalDispModelUsed"
    );
    if (!Array.isArray(lookups.finalDispositions) || lookups.finalDispositions.length === 0) {
      lookups.finalDispositions = await prisma.$queryRaw`
        SELECT id, value FROM repair_entry_disposition ORDER BY value
      `;
      diagnostics.finalDispModelUsed = "SQL:repair_entry_disposition";
    }
  } catch {
    try {
      lookups.finalDispositions = await prisma.$queryRaw`
        SELECT id, value FROM repair_entry_disposition ORDER BY value
      `;
      diagnostics.finalDispModelUsed = "SQL:repair_entry_disposition";
    } catch {}
  }

  try {
    lookups.repairConditions = await tryFindManyOnFirstModel(
      ["repairEntryConditionReceived", "repair_entry_condition_received", "conditionReceived"],
      { select: { id: true, value: true }, orderBy: { value: "asc" } },
      diagnostics,
      "repairCondModelUsed"
    );
    if (!Array.isArray(lookups.repairConditions) || lookups.repairConditions.length === 0) {
      lookups.repairConditions = await prisma.$queryRaw`
        SELECT id, value FROM repair_entry_condition_received ORDER BY value
      `;
      diagnostics.repairCondModelUsed = "SQL:repair_entry_condition_received";
    }
  } catch {
    try {
      lookups.repairConditions = await prisma.$queryRaw`
        SELECT id, value FROM repair_entry_condition_received ORDER BY value
      `;
      diagnostics.repairCondModelUsed = "SQL:repair_entry_condition_received";
    } catch {}
  }

  const safeRows = (rows || []).map(bigIntSafeRow);
  const safeLookups = Object.fromEntries(
    Object.entries(lookups).map(([k, arr]) => [k, (arr || []).map(bigIntSafeRow)])
  );

  return json({ rows: safeRows, lookups: safeLookups, diagnostics });
}

/** Try a list of potential Prisma model names; return first successful findMany result. */
async function tryFindManyOnFirstModel(candidates, args, diagnostics, diagKey) {
  for (const name of candidates) {
    const delegate = prisma?.[name];
    if (delegate && typeof delegate.findMany === "function") {
      try {
        const res = await delegate.findMany(args);
        diagnostics[diagKey] = `Model:${name}`;
        return res;
      } catch {}
    }
  }
  return [];
}

function bigIntSafeRow(obj) {
  if (!obj || typeof obj !== "object") return obj;
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    out[k] = typeof v === "bigint" ? v.toString() : v;
  }
  return out;
}

// ───────────────────────────────────────────────────────────────────────────────
// Component
// ───────────────────────────────────────────────────────────────────────────────
export default function ReturnsPage() {
  const { rows, lookups, diagnostics } = useLoaderData();
  const fetcher = useFetcher();

  // Infer mapping from actual DB columns so UI works regardless of naming
  const schemaMap = useMemo(() => inferSchemaMap(rows), [rows]);

  // Tabs
  const [selected, setSelected] = useState(0);
  const tabs = useMemo(
    () => [{ id: "dashboard", content: "Dashboard" }, { id: "inspection", content: "Inspection" }],
    []
  );

  // Lookup options/maps
  const itemOptions = useMemo(
    () => (lookups.items || []).map((o) => ({ label: o.value, value: String(o.id) })),
    [lookups.items]
  );

  const statusOptions = useMemo(
    () => [
      { label: "select an option", value: "" },
      ...(lookups.statuses || []).map((o) => ({ label: o.value, value: String(o.id) })),
    ],
    [lookups.statuses]
  );

  const finalDispositionOptions = useMemo(
    () => [
      { label: "select an option", value: "" },
      ...(lookups.finalDispositions || []).map((o) => ({ label: o.value, value: String(o.id) })),
    ],
    [lookups.finalDispositions]
  );

  const repairConditionOptions = useMemo(
    () => [
      { label: "select an option", value: "" },
      ...(lookups.repairConditions || []).map((o) => ({ label: o.value, value: String(o.id) })),
    ],
    [lookups.repairConditions]
  );

  const itemLabelById = makeLabelMap(lookups.items);
  const statusLabelById = makeLabelMap(lookups.statuses);

  // Lookup Panel state
  const [trackingNumber, setTrackingNumber] = useState("");
  const [serialNumber, setSerialNumber] = useState("");
  const [orderNumber, setOrderNumber] = useState("");
  const hasLookupInput =
    trackingNumber.trim().length > 0 ||
    serialNumber.trim().length > 0 ||
    orderNumber.trim().length > 0;

  // Refs + focus helpers (use ids to focus Polaris inputs)
  const trackingId = "trackingInput";
  const serialId = "serialInput";
  const orderId = "orderInput";
  const focusById = (id) => {
    const el = document.getElementById(id);
    if (el && typeof el.focus === "function") el.focus();
  };

  // Initial focus: Tracking Number
  useEffect(() => {
    focusById(trackingId);
  }, []); // on mount

  // Handle Tab/Shift+Tab cycling among lookup fields + Enter-to-lookup
  function handleLookupKeyDown(e, field) {
    if (e.key === "Enter") {
      if (hasLookupInput) {
        e.preventDefault();
        // New lookup resets current filter; server will re-apply if multi
        setFilterSpec(null);
        onLookup();
      }
      return;
    }
    if (e.key === "Tab") {
      // trap focus within the three fields
      if (!e.shiftKey) {
        if (field === "tracking") {
          e.preventDefault();
          focusById(serialId);
        } else if (field === "serial") {
          e.preventDefault();
          focusById(orderId);
        } else if (field === "order") {
          e.preventDefault();
          focusById(trackingId);
        }
      } else {
        if (field === "tracking") {
          e.preventDefault();
          focusById(orderId);
        } else if (field === "serial") {
          e.preventDefault();
          focusById(trackingId);
        } else if (field === "order") {
          e.preventDefault();
          focusById(serialId);
        }
      }
    }
  }

  // Feedback area text (hidden until set)
  const [feedbackText, setFeedbackText] = useState("");

  // Inline error we can clear on Reset
  const [lookupErrorMsg, setLookupErrorMsg] = useState("");

  // Table filtering state (set when multi-match occurs)
  const [filterSpec, setFilterSpec] = useState(null); // { mode: 'serial'|'tracking'|'order', value: 'lowercased' }

  // Modal state (Edit)
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState(null);
  const [initialForm, setInitialForm] = useState(null);

  // Modal state (Receiving a Return)
  const [receivingOpen, setReceivingOpen] = useState(false);
  const [receivingForm, setReceivingForm] = useState(null);
  const [receivingInitial, setReceivingInitial] = useState(null);

  // Decide which popup to open based on date_received presence
  function openAppropriate(row) {
    const mapForRow = inferSchemaMap([row]);
    const rawDateReceived = mapForRow.date_received ? row?.[mapForRow.date_received] : null;
    const missing =
      rawDateReceived === null ||
      rawDateReceived === undefined ||
      String(rawDateReceived).trim() === "";
    if (missing) {
      openReceiving(row, mapForRow);
    } else {
      openEditorWithRow(row, mapForRow);
    }
  }

  function openEditorWithRow(row, mapForRowParam) {
    const mapForRow = mapForRowParam || inferSchemaMap([row]);
    const next = toForm(row, mapForRow);
    setReceivingOpen(false);
    setModalOpen(true);
    setForm(next);
    setInitialForm(next);
  }

  // Prefill Date Received with today if missing; SAVE enabled by default
  function openReceiving(row, mapForRowParam) {
    const mapForRow = mapForRowParam || inferSchemaMap([row]);
    const initial = toReceivingForm(row, mapForRow, { defaultToday: false });
    const next = toReceivingForm(row, mapForRow, { defaultToday: true });
    setModalOpen(false);
    setReceivingOpen(true);
    setReceivingForm(next);
    setReceivingInitial(initial);
  }

  function closeEditor() {
    setModalOpen(false);
    setForm(null);
    setInitialForm(null);
  }
  function closeReceiving() {
    setReceivingOpen(false);
    setReceivingForm(null);
    setReceivingInitial(null);
  }

  const isDirty = form && initialForm ? JSON.stringify(form) !== JSON.stringify(initialForm) : false;
  const receivingDirty =
    receivingForm && receivingInitial ? JSON.stringify(receivingForm) !== JSON.stringify(receivingInitial) : false;

  // Lookup submit
  function onLookup() {
    const fd = new FormData();
    fd.append("intent", "lookup");
    fd.append("trackingNumber", trackingNumber);
    fd.append("serialNumber", serialNumber);
    fd.append("orderNumber", orderNumber);
    // Clear feedback & error until we know the outcome
    setFeedbackText("");
    setLookupErrorMsg("");
    fetcher.submit(fd, { method: "post" });
  }

  // On lookup response:
  // - single match => open modal (and clear filter) + feedback
  // - multiple => set filter only, no popup + feedback
  useEffect(() => {
    if (!fetcher?.data) return;

    const mode = fetcher.data.mode || fetcher.data?.multi?.mode || null;

    if (fetcher.data.row) {
      setFilterSpec(null);
      // Feedback (single match)
      if (mode === "tracking") {
        setFeedbackText("Tracking number found on entry in the window to the right.");
      } else if (mode === "serial") {
        setFeedbackText("Serial number found on entry in the window to the right.");
      } else if (mode === "order") {
        setFeedbackText("Order number found on entry in the window to the right.");
      }
      setLookupErrorMsg("");
      openAppropriate(fetcher.data.row);
    } else if (fetcher.data.multi) {
      const { mode: m, value } = fetcher.data.multi;
      setFilterSpec({ mode: m, value: String(value).toLowerCase() });
      // Feedback (multiple matches)
      if (m === "tracking") {
        setFeedbackText("Tracking number found on several entries -- pick one of the entries to the right.");
      } else if (m === "serial") {
        setFeedbackText("Serial number found on several entries -- this might be a mistake.  Please check the entries to the right.");
      } else if (m === "order") {
        setFeedbackText("Order number found on several entries -- pick one of the entries to the right.");
      }
      setLookupErrorMsg("");
    } else if (fetcher.data.error) {
      // Keep inline error, no feedback text
      setFeedbackText("");
      setLookupErrorMsg(fetcher.data.error);
    }
  }, [fetcher?.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const lookupPending = fetcher.state !== "idle";

  // Derived: rows to display (filtered if needed)
  const baseRows = Array.isArray(rows) ? rows : [];
  const displayedRows = useMemo(
    () => applyFilter(baseRows, filterSpec, schemaMap),
    [baseRows, filterSpec, schemaMap]
  );

  const showing = displayedRows.length;

  // Reset handler: clear filter + lookup panel + feedback + inline error
  function handleReset() {
    setFilterSpec(null);
    setTrackingNumber("");
    setSerialNumber("");
    setOrderNumber("");
    setFeedbackText("");
    setLookupErrorMsg("");
    // Put focus back to Tracking Number after reset
    setTimeout(() => focusById(trackingId), 0);
  }

  return (
    <Page fullWidth title="RSL Services - Returns">
      {/* Diagnostics (remove once verified) */}
      <InlineStack align="start">
        <Text as="span" tone="subdued" variant="bodySm">
          DB {diagnostics?.dbOk ? "✅" : "❓"} • Showing {showing}
          {typeof diagnostics?.count === "number" ? ` / Count ${diagnostics.count}` : ""}
          {diagnostics?.used ? ` • dataPath: ${diagnostics.used}` : ""}
          {schemaMap?.__report ? ` • cols: ${schemaMap.__report}` : ""}
          {diagnostics?.statusModelUsed ? ` • statusSrc: ${diagnostics.statusModelUsed}` : ""}
          {diagnostics?.finalDispModelUsed ? ` • finalDispSrc: ${diagnostics.finalDispModelUsed}` : ""}
          {diagnostics?.repairCondModelUsed ? ` • condSrc: ${diagnostics.repairCondModelUsed}` : ""}
          {diagnostics?.joinErr ? " • joinErr" : ""}
          {diagnostics?.simpleStarErr ? " • simpleErr" : ""}
          {diagnostics?.schemaStarErr ? " • schemaErr" : ""}
        </Text>
      </InlineStack>

      {/* Keep 20px spacing; left Lookup Panel fixed width; table fills remainder */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 20 }}>
        {/* Left: Lookup Panel */}
        <div style={{ width: 320, maxWidth: 320, flex: "0 0 auto" }}>
          <Card title="Lookup Panel" sectioned>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "0.75rem",
                minHeight: 480,
              }}
            >
              {/* Wrap inputs to catch onKeyDown reliably */}
              <div onKeyDown={(e) => handleLookupKeyDown(e, "tracking")}>
                <TextField
                  id={trackingId}
                  label="Tracking Number"
                  value={trackingNumber}
                  onChange={setTrackingNumber}
                  autoComplete="off"
                />
              </div>
              <div style={{ textAlign: "center" }}>
                <Text as="p" variant="bodyMd">
                  OR
                </Text>
              </div>
              <div onKeyDown={(e) => handleLookupKeyDown(e, "serial")}>
                <TextField
                  id={serialId}
                  label="Serial Number"
                  value={serialNumber}
                  onChange={setSerialNumber}
                  autoComplete="off"
                />
              </div>
              <div style={{ textAlign: "center" }}>
                <Text as="p" variant="bodyMd">
                  OR
                </Text>
              </div>
              <div onKeyDown={(e) => handleLookupKeyDown(e, "order")}>
                <TextField
                  id={orderId}
                  label="Order Number"
                  value={orderNumber}
                  onChange={setOrderNumber}
                  autoComplete="off"
                />
              </div>

              {/* Feedback area (no title; darker text) */}
              {feedbackText ? (
                <div
                  aria-label="Feedback"
                  style={{
                    border: "1px solid rgba(0,0,0,0.28)",
                    borderRadius: 4,
                    padding: "8px 10px",
                    minHeight: 72,
                    whiteSpace: "pre-wrap",
                    color: "#111", // darker text
                    background: "rgba(0,0,0,0.03)",
                  }}
                >
                  {feedbackText}
                </div>
              ) : null}

              {/* Bottom-anchored Lookup button */}
              <div style={{ marginTop: "auto" }}>
                <Button
                  fullWidth
                  onClick={() => {
                    // New lookup resets current filter; server will re-apply if multi
                    setFilterSpec(null);
                    onLookup();
                  }}
                  disabled={!hasLookupInput}
                  loading={lookupPending}
                >
                  Lookup Order
                </Button>
              </div>

              {/* Inline error (if any) */}
              {lookupErrorMsg ? (
                <Text as="p" tone="critical" variant="bodySm">
                  {lookupErrorMsg}
                </Text>
              ) : null}
            </div>
          </Card>
        </div>

        {/* Right: table/tabs fills remaining viewport width */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <Card>
            <Tabs tabs={tabs} selected={selected} onSelect={setSelected}>
              {selected === 0 ? (
                <>
                  <DashboardTable
                    rows={displayedRows}
                    map={schemaMap}
                    itemLabelById={itemLabelById}
                    statusLabelById={statusLabelById}
                    onRowClick={openAppropriate}
                    defaultSortKey="age"
                    defaultSortDir="desc"
                  />
                  {/* Footer reset area (always available) */}
                  <div
                    style={{
                      display: "flex",
                      justifyContent: filterSpec ? "space-between" : "flex-end",
                      alignItems: "center",
                      padding: "10px 12px",
                      borderTop: "1px solid rgba(0,0,0,0.06)",
                      gap: 12,
                    }}
                  >
                    {filterSpec ? (
                      <Text as="span" variant="bodySm">
                        Filtered by {filterSpec.mode}: <strong>{filterSpec.value}</strong>
                      </Text>
                    ) : null}
                    <Button onClick={handleReset}>Reset</Button>
                  </div>
                </>
              ) : (
                <Placeholder />
              )}
            </Tabs>
          </Card>
        </div>
      </div>

      {/* Edit Return Modal */}
      <Modal
        open={modalOpen}
        onClose={closeEditor}
        title={form ? `Edit Return #${form.original_order || form.id}` : "Edit Return"}
        primaryAction={{ content: "Save", onAction: () => {}, disabled: !isDirty }}
        secondaryActions={[{ content: "Cancel", onAction: closeEditor }]}
        large
      >
        <Modal.Section>
          {form ? (
            <div className="editor-grid" style={{ display: "grid", gap: 12 }}>
              {/* Line 1 */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 12, alignItems: "end" }}>
                <TextField
                  label="Order number"
                  value={form.original_order || ""}
                  onChange={(v) => setForm({ ...form, original_order: v })}
                  autoComplete="off"
                />
                <TextField
                  label="Date Received"
                  type="date"
                  value={form.date_received || ""}
                  onChange={(v) => setForm({ ...form, date_received: v })}
                />
                <div>
                  <Text as="p" variant="bodySm">Customer Name</Text>
                  <div>
                    {form.customer_gid ? (
                      <Link url={customerAdminUrl(form.customer_gid)} external>
                        {form.customer_name || "—"}
                      </Link>
                    ) : (
                      <Text as="span" variant="bodyMd">{form.customer_name || "—"}</Text>
                    )}
                  </div>
                </div>
                <div><Text as="p" variant="bodySm">CSR GOES HERE</Text></div>
              </div>

              {/* Line 2 */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, alignItems: "end" }}>
                <Select
                  label="Item"
                  options={itemOptions}
                  value={form.item_id || ""}
                  onChange={(v) => setForm({ ...form, item_id: v })}
                />
                <TextField
                  label="Serial Number"
                  value={form.serial_number || ""}
                  onChange={(v) => setForm({ ...form, serial_number: v })}
                />
                <TextField
                  label="Tracking Number"
                  value={form.tracking_number || ""}
                  onChange={(v) => setForm({ ...form, tracking_number: v })}
                />
              </div>

              {/* Line 3 */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 12, alignItems: "end" }}>
                <TextField
                  label="Date Requested"
                  type="date"
                  value={form.date_requested || ""}
                  onChange={(v) => setForm({ ...form, date_requested: v })}
                />
                <TextField
                  label="Date Inspected"
                  type="date"
                  value={form.date_inspected || ""}
                  onChange={(v) => setForm({ ...form, date_inspected: v })}
                />
                <TextField
                  label="Inspector"
                  value={form.rsl_rd_staff || ""}
                  onChange={(v) => setForm({ ...form, rsl_rd_staff: v })}
                />
                <Select
                  label="Repair Condition Received"
                  options={repairConditionOptions}
                  value={form.repair_condition_received_id ?? ""}
                  onChange={(v) => setForm({ ...form, repair_condition_received_id: v })}
                />
              </div>

              {/* Line 4 */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, alignItems: "end" }}>
                <Select
                  label="Status"
                  options={statusOptions}
                  value={form?.status_id ?? ""}
                  onChange={(v) => setForm({ ...form, status_id: v })}
                />
                <Select
                  label="Final Disposition"
                  options={finalDispositionOptions}
                  value={form?.final_disposition_id ?? ""}
                  onChange={(v) => setForm({ ...form, final_disposition_id: v })}
                />
              </div>
            </div>
          ) : (
            <Text as="p" variant="bodyMd">Loading…</Text>
          )}
        </Modal.Section>
      </Modal>

      {/* RECEIVING A RETURN Modal */}
      <Modal
        open={receivingOpen}
        onClose={() => {
          // Cancel should behave like Reset
          handleReset();
          closeReceiving();
        }}
        title="RECEIVING A RETURN"
        primaryAction={{
          content: "MARK ORDER AS RECEIVED",
          onAction: () => console.log("Receiving SAVE payload:", receivingForm),
          disabled: !receivingDirty
        }}
        secondaryActions={[{ content: "Cancel", onAction: () => {
            handleReset();
            closeReceiving();
          }}]}
        large
      >
        <Modal.Section>
          {receivingForm ? (
            <div className="receiving-grid" style={{ display: "grid", gap: 12 }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <TextField label="Order number" value={receivingForm.original_order || ""} disabled />
                <TextField label="Customer Name" value={receivingForm.customer_name || ""} disabled />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <TextField label="Serial Number" value={receivingForm.serial_number || ""} disabled />
                <TextField label="Tracking Number" value={receivingForm.tracking_number || ""} disabled />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 12 }}>
                <TextField
                  label="Date Received"
                  type="date"
                  value={receivingForm.date_received || ""}
                  onChange={(v) => setReceivingForm({ ...receivingForm, date_received: v })}
                />
              </div>
            </div>
          ) : (
            <Text as="p" variant="bodyMd">Loading…</Text>
          )}
        </Modal.Section>
      </Modal>
    </Page>
  );
}

// ───────────────────────────────────────────────────────────────────────────────
// Dashboard table (clickable rows) + strict color rules with dynamic mapping
// ───────────────────────────────────────────────────────────────────────────────
function DashboardTable({
                          rows,
                          map,
                          itemLabelById,
                          statusLabelById,
                          onRowClick,
                          defaultSortKey = "age",
                          defaultSortDir = "desc",
                        }) {
  const [sortKey, setSortKey] = useState(defaultSortKey);
  const [sortDir, setSortDir] = useState(defaultSortDir); // 'asc' | 'desc'

  const items = Array.isArray(rows) ? rows : [];

  // Paint row backgrounds after render (override Polaris styles)
  useEffect(() => {
    const COLORS = {
      green: "rgba(16, 128, 67, 0.16)",
      yellow: "rgba(245, 158, 11, 0.22)",
      red: "rgba(220, 53, 69, 0.18)",
    };
    const nodes = document.querySelectorAll(".age-bg[data-age-color]");
    nodes.forEach((node) => {
      const colorKey = node.getAttribute("data-age-color");
      const tr = node.closest("tr");
      if (tr) tr.style.backgroundColor = colorKey ? COLORS[colorKey] || "" : "";
    });
  }, [items]);

  // Helpers using inferred keys
  const k = (row, key) => (key ? row?.[key] ?? null : null);
  const itemLabel = (row) => {
    const id = k(row, map.item_id);
    if (id === null || id === undefined) return "—";
    const key = typeof id === "bigint" ? id.toString() : String(id);
    return itemLabelById.get(key) || "—";
  };
  const statusLabel = (row) => {
    const id = k(row, map.status_id);
    if (id === null || id === undefined) return "—";
    const key = typeof id === "bigint" ? id.toString() : String(id);
    return statusLabelById.get(key) || "—";
  };

  // Sorting helpers
  const getAge = (row) => {
    const drc = k(row, map.date_received);
    return drc ? daysSince(drc) : null; // null means no age
  };
  const getTimestamp = (d) => {
    if (!d) return null;
    try {
      const dateObj = d instanceof Date ? d : new Date(d);
      const t = dateObj.getTime();
      return Number.isFinite(t) ? t : null;
    } catch {
      return null;
    }
  };
  const valForKey = (row) => {
    switch (sortKey) {
      case "date_requested": return getTimestamp(k(row, map.date_requested));
      case "date_received":  return getTimestamp(k(row, map.date_received));
      case "age":            return getAge(row);
      case "date_inspected": return getTimestamp(k(row, map.date_inspected));
      case "original_order": return k(row, map.original_order) ?? "";
      case "customer_name":  return k(row, map.customer_name) ?? "";
      case "item":           return itemLabel(row) ?? "";
      case "status":         return statusLabel(row) ?? "";
      default:               return null;
    }
  };
  const safeCompare = (a, b) => {
    const va = valForKey(a);
    const vb = valForKey(b);
    const dirMul = sortDir === "asc" ? 1 : -1;

    const isNilA = va === null || va === undefined || va === "";
    // nulls/empties last
    const isNilB = vb === null || vb === undefined || vb === "";
    if (isNilA && isNilB) return 0;
    if (isNilA) return 1;
    if (isNilB) return -1;

    if (typeof va === "number" && typeof vb === "number") {
      return dirMul * (va - vb);
    }
    const sa = String(va).toLowerCase();
    const sb = String(vb).toLowerCase();
    return dirMul * sa.localeCompare(sb);
  };
  const sorted = useMemo(() => {
    const copy = [...items];
    copy.sort(safeCompare);
    return copy;
  }, [items, sortKey, sortDir]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleSort = (key) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  const SortHeader = ({ label, keyName }) => {
    const active = sortKey === keyName;
    const arrow = active ? (sortDir === "desc" ? "▼" : "▲") : "";
    return (
      <span
        onClick={() => toggleSort(keyName)}
        style={{
          cursor: "pointer",
          userSelect: "none",
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
        }}
        title={`Sort by ${label}`}
      >
        <span>{label}</span>
        <span style={{ opacity: active ? 1 : 0.3 }}>{arrow}</span>
      </span>
    );
  };

  return (
    <IndexTable
      resourceName={{ singular: "return", plural: "returns" }}
      itemCount={sorted.length}
      headings={[
        { title: <SortHeader label="Date requested" keyName="date_requested" /> },
        { title: <SortHeader label="Date Received" keyName="date_received" /> },
        { title: <SortHeader label="Age" keyName="age" /> },
        { title: <SortHeader label="Date Inspected" keyName="date_inspected" /> },
        { title: <SortHeader label="Original order" keyName="original_order" /> },
        { title: <SortHeader label="Customer name" keyName="customer_name" /> },
        { title: <SortHeader label="Item" keyName="item" /> },
        { title: <SortHeader label="Status" keyName="status" /> },
      ]}
      selectable={false}
    >
      {sorted.map((r, i) => {
        const drq = r?.[map.date_requested];
        const drc = r?.[map.date_received];
        const dis = r?.[map.date_inspected];

        const age = drc ? daysSince(drc) : null;
        const colorName = colorNameForAgeStrict(age);
        const displayAge = drc ? age : null;

        const order = r?.[map.original_order];
        const customer = r?.[map.customer_name];

        const Cell = ({ children }) => (
          <div
            className="age-bg"
            data-age-color={colorName || ""}
            style={wrapperStyleForColor(colorName)}
            onClick={() => onRowClick?.(r)}
          >
            {children}
          </div>
        );

        return (
          <IndexTable.Row id={String(r.id ?? i)} key={r.id ?? i} position={i}>
            <IndexTable.Cell><Cell><Text as="span" variant="bodyMd">{formatDate(drq)}</Text></Cell></IndexTable.Cell>
            <IndexTable.Cell><Cell><Text as="span" variant="bodyMd">{drc ? formatDate(drc) : "not yet received"}</Text></Cell></IndexTable.Cell>
            <IndexTable.Cell><Cell><Text as="span" variant="bodyMd">{displayAge === null ? "—" : `${displayAge}d`}</Text></Cell></IndexTable.Cell>
            <IndexTable.Cell><Cell><Text as="span" variant="bodyMd">{dis ? formatDate(dis) : "—"}</Text></Cell></IndexTable.Cell>
            <IndexTable.Cell><Cell><Text as="span" variant="bodyMd">{order ?? "—"}</Text></Cell></IndexTable.Cell>
            <IndexTable.Cell><Cell><Text as="span" variant="bodyMd">{customer ?? "—"}</Text></Cell></IndexTable.Cell>
            <IndexTable.Cell><Cell><Text as="span" variant="bodyMd">{itemLabel(r)}</Text></Cell></IndexTable.Cell>
            <IndexTable.Cell><Cell><Text as="span" variant="bodyMd">{statusLabel(r)}</Text></Cell></IndexTable.Cell>
          </IndexTable.Row>
        );
      })}
    </IndexTable>
  );
}

// ───────────────────────────────────────────────────────────────────────────────
// Placeholder
// ───────────────────────────────────────────────────────────────────────────────
function Placeholder() {
  return (
    <div style={{ padding: "1rem" }}>
      <Text as="p" variant="bodyMd" tone="subdued">
        Return Inspection Under Development
      </Text>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────────
// Filtering, inference & helpers
// ───────────────────────────────────────────────────────────────────────────────
function applyFilter(rows, filterSpec, map) {
  if (!filterSpec) return rows;
  const v = String(filterSpec.value || "").toLowerCase();

  const KEYS = {
    serial: ["serial_number", "serial", "serialNumber", "sn", "serial_no", "serialNo"],
    tracking: ["tracking_number", "tracking", "trackingNumber", "tracking_no", "trackingNo"],
    order: ["original_order", "order_number", "order_no", "orderid", "order_id", "orderId", "order"],
  };

  const mappedKey =
    filterSpec.mode === "serial" ? map.serial_number :
      filterSpec.mode === "tracking" ? map.tracking_number :
        map.original_order;

  return rows.filter((row) => {
    // Prefer inferred key; fall back to common aliases present on the row.
    const tryKeys = mappedKey ? [mappedKey, ...KEYS[filterSpec.mode]] : KEYS[filterSpec.mode];
    for (const k of tryKeys) {
      if (Object.prototype.hasOwnProperty.call(row, k)) {
        const cell = row[k];
        if (cell !== null && cell !== undefined) {
          const sv = String(cell).toLowerCase();
          if (sv === v) return true; // exact, case-insensitive
        }
      }
    }
    return false;
  });
}

function inferSchemaMap(rows) {
  const map = {
    id: "id",
    original_order: null,
    date_requested: null,
    date_received: null,
    date_inspected: null,
    customer_name: null,
    customer_gid: null,
    item_id: null,
    serial_number: null,
    tracking_number: null,
    rsl_rd_staff: null,
    repair_condition_received_id: null,
    status_id: null,
    final_disposition_id: null,
  };
  const first = Array.isArray(rows) && rows.length ? rows[0] : null;
  const keys = first ? Object.keys(first) : [];
  const pick = (...cands) => cands.find((c) => keys.includes(c)) || null;

  map.original_order = pick("original_order", "order_number", "order_no", "orderid", "order_id", "orderId", "order");
  map.date_requested = pick("date_requested", "requested_at", "request_date", "dateRequested", "requestedAt");
  map.date_received = pick("date_received", "received_at", "receive_date", "dateReceived", "receivedAt");
  map.date_inspected = pick("date_inspected", "inspected_at", "inspection_date", "dateInspected", "inspectedAt");
  map.customer_name = pick("customer_name", "customer", "name", "customer_fullname", "customerName");
  map.customer_gid = pick("customer_gid", "customer_gid_id", "customerGid");
  map.item_id = pick("item_id", "itemid", "itemId", "product_id", "productId");
  map.serial_number = pick("serial_number", "serial", "serialNumber", "sn");
  map.tracking_number = pick("tracking_number", "tracking", "trackingNumber");
  map.rsl_rd_staff = pick("rsl_rd_staff", "inspector", "inspected_by", "inspectedBy");
  map.repair_condition_received_id = pick(
    "repair_condition_received_id",
    "repair_conditioned_received_id",
    "repair_condition_id",
    "condition_received_id"
  );
  map.status_id = pick("status_id", "statusId", "status");
  map.final_disposition_id = pick("final_disposition_id", "final_disposition", "disposition_id");

  map.__report = [
    `req=${map.date_requested || "-"}`,
    `rec=${map.date_received || "-"}`,
    `ins=${map.date_inspected || "-"}`,
    `ord=${map.original_order || "-"}`,
    `cust=${map.customer_name || "-"}`,
    `itemId=${map.item_id || "-"}`,
    `statusId=${map.status_id || "-"}`,
  ].join(" ");

  return map;
}

function makeLabelMap(arr) {
  const map = new Map();
  (arr || []).forEach((o) => map.set(String(o.id), o.value));
  return map;
}

function toForm(row, map) {
  const get = (k) => (k ? row?.[k] ?? "" : "");
  return {
    id: stringOr(row.id),
    original_order: get(map.original_order),
    date_requested: toInputDate(get(map.date_requested)),
    date_received: toInputDate(get(map.date_received)),
    date_inspected: toInputDate(get(map.date_inspected)),
    customer_name: get(map.customer_name),
    customer_gid: get(map.customer_gid),
    item_id: stringOr(get(map.item_id)),
    serial_number: get(map.serial_number),
    tracking_number: get(map.tracking_number),
    rsl_rd_staff: get(map.rsl_rd_staff),
    repair_condition_received_id: stringOr(get(map.repair_condition_received_id)),
    status_id: stringOr(get(map.status_id)),
    final_disposition_id: stringOr(get(map.final_disposition_id)),
  };
}

// Supports defaulting Date Received to today when missing
function toReceivingForm(row, map, { defaultToday = false } = {}) {
  const get = (k) => (k ? row?.[k] ?? "" : "");
  const existing = toInputDate(get(map.date_received));
  return {
    id: stringOr(row.id),
    original_order: get(map.original_order),
    customer_name: get(map.customer_name),
    serial_number: get(map.serial_number),
    tracking_number: get(map.tracking_number),
    date_received: existing || (defaultToday ? todayInputDate() : ""),
  };
}

function stringOr(v) {
  if (v === null || v === undefined || v === "") return "";
  return typeof v === "bigint" ? v.toString() : String(v);
}

function toInputDate(d) {
  if (!d) return "";
  try {
    const dateObj = d instanceof Date ? d : new Date(d);
    const yyyy = dateObj.getFullYear();
    const mm = String(dateObj.getMonth() + 1).padStart(2, "0");
    const dd = String(dateObj.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  } catch {
    return "";
  }
}

function todayInputDate() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function customerAdminUrl(customerGid) {
  if (!customerGid) return undefined;
  const id = String(customerGid).split("/").pop();
  return id ? `/admin/customers/${id}` : undefined;
}

// STRICT color rules (requires Date Received)
function colorNameForAgeStrict(age) {
  if (age === null || age === undefined) return null;
  if (age === 1 || age === 2) return "green";
  if (age === 3) return "yellow";
  if (age > 3) return "red";
  return null;
}

// Fill the cell by offsetting Polaris padding
function wrapperStyleForColor(colorName) {
  if (!colorName) return undefined;
  const colorMap = {
    green: "rgba(16, 128, 67, 0.16)",
    yellow: "rgba(245, 158, 11, 0.22)",
    red: "rgba(220, 53, 69, 0.18)",
  };
  return {
    backgroundColor: colorMap[colorName],
    display: "block",
    padding: "8px 12px",
    margin: "-8px -12px",
    cursor: "pointer",
  };
}

function formatDate(d) {
  if (!d) return "—";
  try {
    const dateObj = d instanceof Date ? d : new Date(d);
    return dateObj.toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "2-digit",
    });
  } catch {
    return String(d);
  }
}

function daysSince(d) {
  try {
    const dateObj = d instanceof Date ? d : new Date(d);
    const now = new Date();
    const start = new Date(dateObj.getFullYear(), dateObj.getMonth(), dateObj.getDate());
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return Math.max(0, Math.floor((end - start) / (24 * 60 * 60 * 1000)));
  } catch {
    return 0;
  }
}
