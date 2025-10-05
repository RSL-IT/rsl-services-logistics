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
 * ACTION: Lookup by serial or tracking, open modal on match
 * - Prefers serialNumber if both provided
 * - Case-insensitive EXACT match on canonical column first (LOWER(col::text) = LOWER(value))
 * - Falls back to alias columns if needed
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

  if (!serialNumber && !trackingNumber) {
    return json({ error: "Enter a Serial Number or a Tracking Number to lookup." }, { status: 400 });
  }

  const MODE = serialNumber ? "serial" : "tracking";
  const value = (serialNumber || trackingNumber).trim();
  const valueLC = value.toLowerCase();
  const valLitLC = sqlQuote(valueLC);

  // 1) Canonical column first (exact, case-insensitive)
  const targetCol = MODE === "serial" ? `"serial_number"` : `"tracking_number"`;

  const qExactSchema = `
    SELECT * FROM "${SCHEMA}"."return_entry"
    WHERE LOWER(${targetCol}::text) = ${valLitLC}
    ORDER BY 1 DESC
    LIMIT 1
  `;
  const qExactSimple = `
    SELECT * FROM return_entry
    WHERE LOWER(${targetCol}::text) = ${valLitLC}
    ORDER BY 1 DESC
    LIMIT 1
  `;

  let rows = [];
  try { rows = await prisma.$queryRawUnsafe(qExactSchema); } catch {}
  if (!Array.isArray(rows) || rows.length === 0) {
    try { rows = await prisma.$queryRawUnsafe(qExactSimple); } catch {}
  }

  // 2) Alias columns as fallback (exact, case-insensitive)
  if (!Array.isArray(rows) || rows.length === 0) {
    const SERIAL_CANDS = [`"serial_number"`, `"serial"`, `"serialNumber"`, `"sn"`, `"serial_no"`, `"serialNo"`];
    const TRACK_CANDS  = [`"tracking_number"`, `"tracking"`, `"trackingNumber"`, `"tracking_no"`, `"trackingNo"`];
    const cands = MODE === "serial" ? SERIAL_CANDS : TRACK_CANDS;

    const conds = cands.map((c) => `LOWER(${c}::text) = ${valLitLC}`).join(" OR ");

    const qSchema = `
      SELECT * FROM "${SCHEMA}"."return_entry"
      WHERE ${conds}
      ORDER BY 1 DESC
      LIMIT 1
    `;
    const qSimple = `
      SELECT * FROM return_entry
      WHERE ${conds}
      ORDER BY 1 DESC
      LIMIT 1
    `;

    try { rows = await prisma.$queryRawUnsafe(qSchema); } catch {}
    if (!Array.isArray(rows) || rows.length === 0) {
      try { rows = await prisma.$queryRawUnsafe(qSimple); } catch {}
    }
  }

  if (!Array.isArray(rows) || rows.length === 0) {
    const label = MODE === "serial" ? "serial number" : "tracking number";
    return json({ error: `No match found for ${label}: ${value}` }, { status: 404 });
  }

  const row = bigIntSafeRow(rows[0]);
  return json({ row });
}

function sqlQuote(v) {
  return `'${String(v).replace(/'/g, "''")}'`;
}

/**
 * Loader: never-throw, SELECT * fallback, diagnostics, lookups
 *  - Tries join → SELECT * (unqualified) → SELECT * (schema-qualified)
 *  - Lookups via Prisma models when available, else SQL fallback
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

  // Attempt 1: joined query (works if names match)
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

  // Lookups (best-effort only; none of these should throw)
  const lookups = { items: [], statuses: [], finalDispositions: [], repairConditions: [] };

  // Items
  try {
    lookups.items = await prisma.$queryRaw`
      SELECT id, value FROM csd_item ORDER BY value
    `;
  } catch {}

  // Statuses via model if available, else SQL
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

  // Final Disposition via model if available, else SQL
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

  // Repair Condition Received via model if available, else SQL
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

  // BigInt-safe
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
      } catch {
        // continue
      }
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
  const hasLookupInput = trackingNumber.trim().length > 0 || serialNumber.trim().length > 0;

  // Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState(null);
  const [initialForm, setInitialForm] = useState(null);

  function openEditorWithRow(row) {
    const mapForRow = inferSchemaMap([row]);
    const next = toForm(row, mapForRow);
    setForm(next);
    setInitialForm(next);
    setModalOpen(true);
  }

  function openEditor(row) {
    openEditorWithRow(row);
  }

  function closeEditor() {
    setModalOpen(false);
    setForm(null);
    setInitialForm(null);
  }

  const isDirty = form && initialForm ? JSON.stringify(form) !== JSON.stringify(initialForm) : false;

  // Lookup submit
  function onLookup() {
    const fd = new FormData();
    fd.append("intent", "lookup");
    fd.append("trackingNumber", trackingNumber);
    fd.append("serialNumber", serialNumber);
    fetcher.submit(fd, { method: "post" });
  }

  // On lookup response, open modal if row returned
  useEffect(() => {
    if (fetcher?.data?.row) {
      openEditorWithRow(fetcher.data.row);
    }
  }, [fetcher?.data?.row]); // eslint-disable-line react-hooks/exhaustive-deps

  const lookupPending = fetcher.state !== "idle";
  const lookupError = fetcher?.data?.error;

  const showing = Array.isArray(rows) ? rows.length : 0;

  return (
    <Page fullWidth title="RSL Services - Returns">
      {/* Diagnostics (remove once verified) */}
      <InlineStack align="end">
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
                minHeight: 260,
              }}
            >
              <TextField
                label="Tracking Number"
                value={trackingNumber}
                onChange={setTrackingNumber}
                autoComplete="off"
              />
              <div style={{ textAlign: "center" }}>
                <Text as="p" variant="bodyMd">
                  OR
                </Text>
              </div>
              <TextField
                label="Serial Number"
                value={serialNumber}
                onChange={setSerialNumber}
                autoComplete="off"
              />

              {/* Bottom-anchored Lookup button */}
              <div style={{ marginTop: "auto" }}>
                <Button
                  fullWidth
                  onClick={onLookup}
                  disabled={!hasLookupInput}
                  loading={lookupPending}
                >
                  Lookup Order
                </Button>
              </div>

              {/* Inline error (if any) */}
              {lookupError ? (
                <Text as="p" tone="critical" variant="bodySm">
                  {lookupError}
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
                <DashboardTable
                  rows={rows}
                  map={schemaMap}
                  itemLabelById={itemLabelById}
                  statusLabelById={statusLabelById}
                  onRowClick={openEditor}
                />
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
              {/* Line 1: Order number, Date Received, Customer Name (clickable), CSR GOES HERE */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr 1fr 1fr",
                  gap: 12,
                  alignItems: "end",
                }}
              >
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
                  <Text as="p" variant="bodySm">
                    Customer Name
                  </Text>
                  <div>
                    {form.customer_gid ? (
                      <Link url={customerAdminUrl(form.customer_gid)} external>
                        {form.customer_name || "—"}
                      </Link>
                    ) : (
                      <Text as="span" variant="bodyMd">
                        {form.customer_name || "—"}
                      </Text>
                    )}
                  </div>
                </div>
                <div>
                  <Text as="p" variant="bodySm">
                    CSR GOES HERE
                  </Text>
                </div>
              </div>

              {/* Line 2: Item, Serial Number, Tracking Number */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr 1fr",
                  gap: 12,
                  alignItems: "end",
                }}
              >
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

              {/* Line 3: Date Requested, Date Inspected, Inspector, Repair Condition Received */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr 1fr 1fr",
                  gap: 12,
                  alignItems: "end",
                }}
              >
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
                  onChange={(v) =>
                    setForm({ ...form, repair_condition_received_id: v })
                  }
                />
              </div>

              {/* Line 4: Status, Final Disposition */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 12,
                  alignItems: "end",
                }}
              >
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
                  onChange={(v) =>
                    setForm({ ...form, final_disposition_id: v })
                  }
                />
              </div>
            </div>
          ) : (
            <Text as="p" variant="bodyMd">
              Loading…
            </Text>
          )}
        </Modal.Section>
      </Modal>
    </Page>
  );
}

// ───────────────────────────────────────────────────────────────────────────────
// Dashboard table (clickable rows) + strict color rules with dynamic mapping
// ───────────────────────────────────────────────────────────────────────────────
function DashboardTable({ rows, map, itemLabelById, statusLabelById, onRowClick }) {
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

  return (
    <IndexTable
      resourceName={{ singular: "return", plural: "returns" }}
      itemCount={items.length}
      headings={[
        { title: "Date requested" },
        { title: "Date Received" },
        { title: "Age" },
        { title: "Date Inspected" },
        { title: "Original order" },
        { title: "Customer name" },
        { title: "Item" },
        { title: "Status" },
      ]}
      selectable={false}
    >
      {items.map((r, i) => {
        const drq = k(r, map.date_requested);
        const drc = k(r, map.date_received);
        const dis = k(r, map.date_inspected);

        const age = drc ? daysSince(drc) : null;
        const colorName = colorNameForAgeStrict(age);
        const displayAge = drc ? age : null;

        const order = k(r, map.original_order);
        const customer = k(r, map.customer_name);

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
// Inference & helpers
// ───────────────────────────────────────────────────────────────────────────────
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
    // handle common spellings for condition received
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

  // diagnostic report
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
