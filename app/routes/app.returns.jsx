// /app/routes/app.returns.jsx
import { json } from "@remix-run/node";
import { useLoaderData, useFetcher, useRevalidator } from "@remix-run/react";
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
  Popover,
  DatePicker,
} from "@shopify/polaris";
import { CalendarIcon } from "@shopify/polaris-icons";
import { useEffect, useMemo, useState } from "react";

// ───────────────────────────────────────────────────────────────────────────────
// CONFIG
const SCHEMA = process.env.DB_SCHEMA || "public";
// ───────────────────────────────────────────────────────────────────────────────

/**
 * ACTIONS:
 *  - lookup
 *  - saveEdit
 *  - saveReceiving
 */
export async function action({ request }) {
  await authenticate.admin(request);

  const form = await request.formData();
  const intent = String(form.get("intent") || "");

  if (intent === "lookup") {
    return handleLookup(form);
  }

  if (intent === "saveEdit") {
    const id = toIntOrNull(form.get("id"));
    if (!id) return json({ ok: false, intent, error: "Missing id" }, { status: 400 });

    const payload = {
      original_order: toStringOrNull(form.get("original_order")),
      date_requested: toDateOrNull(form.get("date_requested")),
      date_received: toDateOrNull(form.get("date_received")),
      date_inspected: toDateOrNull(form.get("date_inspected")),
      customer_name: toStringOrNull(form.get("customer_name")),
      customer_gid: toStringOrNull(form.get("customer_gid")),
      item_id: toIntOrNull(form.get("item_id")),
      serial_number: toStringOrNull(form.get("serial_number")),
      tracking_number: toStringOrNull(form.get("tracking_number")),
      rsl_rd_staff: toStringOrNull(form.get("rsl_rd_staff")),
      repair_condition_received_id: toIntOrNull(form.get("repair_condition_received_id")),
      status_id: toIntOrNull(form.get("status_id")),
      final_disposition_id: toIntOrNull(form.get("final_disposition_id")),
    };

    const fieldErrors = validateEditServer(payload);
    if (Object.keys(fieldErrors).length > 0) {
      return json({ ok: false, intent, fieldErrors }, { status: 422 });
    }

    const { row, error } = await updateReturnEntry(id, payload);
    if (error) return json({ ok: false, intent, error }, { status: 500 });
    return json({ ok: true, intent, updated: bigIntSafeRow(row) });
  }

  if (intent === "saveReceiving") {
    const id = toIntOrNull(form.get("id"));
    const date_received = toDateOrNull(form.get("date_received"));
    if (!id) return json({ ok: false, intent, error: "Missing id" }, { status: 400 });

    const p = { date_received };
    const fieldErrors = validateReceivingServer(p);
    if (Object.keys(fieldErrors).length > 0) {
      return json({ ok: false, intent, fieldErrors }, { status: 422 });
    }

    const { row, error } = await updateReturnEntry(id, { date_received: p.date_received });
    if (error) return json({ ok: false, intent, error }, { status: 500 });
    return json({ ok: true, intent, updated: bigIntSafeRow(row) });
  }

  return json({ error: "Unknown action intent." }, { status: 400 });
}

// ── lookup handler ─────────────────────────────────────────────────────────────
async function handleLookup(form) {
  const serialNumber = String(form.get("serialNumber") || "").trim();
  const trackingNumber = String(form.get("trackingNumber") || "").trim();
  const orderNumber = String(form.get("orderNumber") || "").trim();
  const lastName = String(form.get("lastName") || "").trim();

  if (!serialNumber && !trackingNumber && !orderNumber && !lastName) {
    return json(
      { error: "Enter a Serial Number, Tracking Number, Order Number, or Last Name to lookup." },
      { status: 400 }
    );
  }

  const MODE = serialNumber
    ? "serial"
    : trackingNumber
      ? "tracking"
      : orderNumber
        ? "order"
        : "last";

  const value = (serialNumber || trackingNumber || orderNumber || lastName).trim();
  const valueLC = value.toLowerCase();
  const valLitLC = sqlQuote(valueLC);

  // Canonical column or expression per mode
  const CANON =
    MODE === "serial"
      ? `"serial_number"`
      : MODE === "tracking"
        ? `"tracking_number"`
        : MODE === "order"
          ? `"original_order"`
          : /* last name from customer_name */ `LOWER(split_part(trim("customer_name"), ' ', array_length(string_to_array(trim("customer_name"), ' '), 1)))`;

  const ALIASES =
    MODE === "serial"
      ? [`"serial_number"`, `"serial"`, `"serialNumber"`, `"sn"`, `"serial_no"`, `"serialNo"`]
      : MODE === "tracking"
        ? [`"tracking_number"`, `"tracking"`, `"trackingNumber"`, `"tracking_no"`, `"trackingNo"`]
        : MODE === "order"
          ? [`"original_order"`, `"order_number"`, `"order_no"`, `"orderid"`, `"order_id"`, `"orderId"`, `"order"`]
          : []; // no aliases for last name

  const canonCond =
    MODE === "last"
      ? `${CANON} = ${valLitLC}`
      : `LOWER(${CANON}::text) = ${valLitLC}`;

  const aliasCond =
    MODE === "last"
      ? "" // not used
      : ALIASES.map((c) => `LOWER(${c}::text) = ${valLitLC}`).join(" OR ");

  async function countWhere(whereSql) {
    const try1 = async () =>
      prisma.$queryRawUnsafe(
        `SELECT COUNT(*)::int AS n FROM "${SCHEMA}"."return_entry" WHERE ${whereSql}`
      );
    const try2 = async () =>
      prisma.$queryRawUnsafe(`SELECT COUNT(*)::int AS n FROM return_entry WHERE ${whereSql}`);

    try {
      const r = await try1();
      return Array.isArray(r) ? Number(r[0]?.n ?? 0) : Number(r?.n ?? 0);
    } catch {}
    try {
      const r2 = await try2();
      return Array.isArray(r2) ? Number(r2[0]?.n ?? 0) : Number(r2?.n ?? 0);
    } catch {}
    return 0;
  }

  async function getOneRow(whereSql) {
    const try1 = async () =>
      prisma.$queryRawUnsafe(
        `SELECT * FROM "${SCHEMA}"."return_entry" WHERE ${whereSql} ORDER BY 1 DESC LIMIT 1`
      );
    const try2 = async () =>
      prisma.$queryRawUnsafe(`SELECT * FROM return_entry WHERE ${whereSql} ORDER BY 1 DESC LIMIT 1`);

    try {
      const a = await try1();
      if (Array.isArray(a) && a.length) return a[0];
    } catch {}
    try {
      const b = await try2();
      if (Array.isArray(b) && b.length) return b[0];
    } catch {}
    return null;
  }

  // 1) canonical
  let n = await countWhere(canonCond);
  if (n === 1) {
    const row = await getOneRow(canonCond);
    if (row) return json({ row: bigIntSafeRow(row), mode: MODE, intent: "lookup" });
  }
  if (n > 1) return json({ multi: { mode: MODE, value }, intent: "lookup" });

  // 2) aliases (not used for last name)
  if (MODE !== "last") {
    n = await countWhere(aliasCond);
    if (n === 0) {
      const label =
        MODE === "serial"
          ? "serial number"
          : MODE === "tracking"
            ? "tracking number"
            : "order number";
      return json({ error: `No match found for ${label}: ${value}`, intent: "lookup" }, { status: 404 });
    }
    if (n > 1) return json({ multi: { mode: MODE, value }, intent: "lookup" });

    const row = await getOneRow(aliasCond);
    if (!row) return json({ error: "Lookup failed after match found.", intent: "lookup" }, { status: 500 });
    return json({ row: bigIntSafeRow(row), mode: MODE, intent: "lookup" });
  }

  // last name path (no alias)
  if (n === 0) {
    return json({ error: `No match found for last name: ${value}`, intent: "lookup" }, { status: 404 });
  }
  // n === 1 handled above; if we got here, it's multi
  return json({ multi: { mode: MODE, value }, intent: "lookup" });
}

// ── UPDATE helper ──────────────────────────────────────────────────────────────
async function updateReturnEntry(id, payload) {
  const allow = new Set([
    "original_order",
    "date_requested",
    "date_received",
    "date_inspected",
    "customer_name",
    "customer_gid",
    "item_id",
    "serial_number",
    "tracking_number",
    "rsl_rd_staff",
    "repair_condition_received_id",
    "status_id",
    "final_disposition_id",
  ]);

  const sets = [];
  for (const [k, v] of Object.entries(payload || {})) {
    if (!allow.has(k)) continue;
    sets.push(sqlSet(k, v));
  }
  if (sets.length === 0) return { error: "Nothing to update." };

  const setSql = sets.join(", ");
  try {
    const res = await prisma.$queryRawUnsafe(
      `UPDATE "${SCHEMA}"."return_entry" SET ${setSql} WHERE id = ${Number(id)} RETURNING *`
    );
    const row = Array.isArray(res) ? res[0] : res;
    if (!row) throw new Error("No row returned");
    return { row };
  } catch (e) {
    try {
      const res2 = await prisma.$queryRawUnsafe(
        `UPDATE return_entry SET ${setSql} WHERE id = ${Number(id)} RETURNING *`
      );
      const row2 = Array.isArray(res2) ? res2[0] : res2;
      if (!row2) throw new Error("No row returned");
      return { row: row2 };
    } catch (e2) {
      return { error: String(e2?.message || e2 || "Update failed") };
    }
  }
}

function sqlSet(col, val) {
  const idCols = new Set(["item_id", "status_id", "final_disposition_id", "repair_condition_received_id"]);
  const dateCols = new Set(["date_requested", "date_received", "date_inspected"]);

  if (val === null) {
    return `"${col}" = NULL`;
  }
  if (idCols.has(col)) {
    const n = Number(val);
    return Number.isFinite(n) ? `"${col}" = ${n}::int` : `"${col}" = NULL`;
  }
  if (dateCols.has(col)) {
    return `"${col}" = ${sqlQuote(val)}::date`;
  }
  return `"${col}" = ${sqlQuote(String(val))}`;
}

// ── coercion + date parsing helpers (server) ───────────────────────────────────
function toIntOrNull(v) {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// Accepts YYYY-MM-DD or MM/DD/YYYY; returns ISO or null
function parseDateToISO(value) {
  if (value === undefined || value === null) return null;
  const s = String(value).trim();
  if (!s) return null;

  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (isoMatch) {
    const y = +isoMatch[1], m = +isoMatch[2], d = +isoMatch[3];
    if (isValidYMD(y, m, d)) return `${y}-${String(m).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
    return null;
  }

  const usMatch = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (usMatch) {
    const m = +usMatch[1], d = +usMatch[2], y = +usMatch[3];
    if (isValidYMD(y, m, d)) return `${y}-${String(m).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
    return null;
  }

  return null;
}

function isValidYMD(y, m, d) {
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return false;
  if (m < 1 || m > 12) return false;
  if (d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && (dt.getUTCMonth() + 1) === m && dt.getUTCDate() === d;
}

function toDateOrNull(v) {
  return parseDateToISO(v);
}

function toStringOrNull(v) {
  if (v === undefined || v === null) return null;
  const s = String(v);
  return s.length ? s : null;
}
function sqlQuote(v) {
  return `'${String(v).replace(/'/g, "''")}'`;
}

// ── validation helpers (server) ────────────────────────────────────────────────
function cmpISO(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}
function todayISO() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}
function validateEditServer(p) {
  const errors = {};

  const rqISO = p.date_requested ? parseDateToISO(p.date_requested) : null;
  const rcISO = p.date_received ? parseDateToISO(p.date_received) : null;
  const insISO = p.date_inspected ? parseDateToISO(p.date_inspected) : null;

  if (p.date_requested && !rqISO) errors.date_requested = "Use YYYY-MM-DD or MM/DD/YYYY";
  if (p.date_received && !rcISO) errors.date_received = "Use YYYY-MM-DD or MM/DD/YYYY";
  if (p.date_inspected && !insISO) errors.date_inspected = "Use YYYY-MM-DD or MM/DD/YYYY";

  if (!errors.date_requested && rqISO && rcISO && cmpISO(rcISO, rqISO) < 0) {
    errors.date_received = "Date Received cannot be before Date Requested";
  }
  if (!errors.date_received && rcISO && insISO && cmpISO(insISO, rcISO) < 0) {
    errors.date_inspected = "Date Inspected cannot be before Date Received";
  }

  if (rqISO) p.date_requested = rqISO;
  if (rcISO) p.date_received = rcISO;
  if (insISO) p.date_inspected = insISO;

  return errors;
}
function validateReceivingServer(p) {
  const errors = {};
  const rcISO = parseDateToISO(p.date_received);
  if (!p.date_received) errors.date_received = "Date Received is required";
  else if (!rcISO) errors.date_received = "Use YYYY-MM-DD or MM/DD/YYYY";
  else {
    const today = todayISO();
    if (cmpISO(rcISO, today) > 0) errors.date_received = "Date Received cannot be in the future";
  }
  if (!errors.date_received) p.date_received = rcISO;
  return errors;
}

/**
 * Loader: (1) sync rsl_staff from Shopify, (2) returns data & lookups
 */
export async function loader({ request }) {
  const { admin } = await authenticate.admin(request);

  const diagnostics = {
    dbOk: null,
    count: null,
    used: null,
    joinErr: null,
    simpleStarErr: null,
    schemaStarErr: null,
    statusModelUsed: null,
    finalDispModelUsed: null,
    repairCondModelUsed: null,
    staffSync: null,
  };

  // 0) One-time runtime sync of rsl_staff
  diagnostics.staffSync = await staffAutofillSync(admin);

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
// STAFF SYNC (Shopify → rsl_staff via Prisma model `tblkp_staff` or raw SQL)
// ───────────────────────────────────────────────────────────────────────────────
const ALLOWED_ROLE_NAMES = new Set(["administrator", "shipping", "customer service"]);

// Prefer Prisma model that maps to rsl_staff; your model name is `tblkp_staff`.
function getStaffDelegate() {
  return (
    prisma?.tblkp_staff || // primary
    prisma?.rsl_staff ||   // optional fallback if you also defined this
    null
  );
}

async function staffAutofillSync(admin) {
  // Never throw — always return a result object with details (or error message).
  const result = {
    ok: false,
    usedRoles: false,
    staffFetched: 0,
    considered: 0,
    inserted: 0,
    error: null,
  };

  try {
    let rolesAvailable = true;
    let staff = [];
    try {
      staff = await fetchStaffWithRoles(admin);
    } catch (e) {
      rolesAvailable = false;
      try {
        staff = await fetchStaffBasic(admin);
      } catch (e2) {
        result.error = `Shopify staff fetch failed: ${String(e2?.message || e2)}`;
        return result;
      }
    }

    result.usedRoles = rolesAvailable;
    result.staffFetched = staff.length;

    // Filter by allowed roles if rolesAvailable; else include all (dev fallback)
    const candidates = staff.filter((u) => {
      if (!rolesAvailable) return true;
      const roles = (u.roles || []).map((r) => String(r).toLowerCase());
      return roles.some((r) => ALLOWED_ROLE_NAMES.has(r));
    });
    result.considered = candidates.length;

    // Existing gids
    const existing = await getExistingStaffGidSet();

    // Insert missing
    for (const u of candidates) {
      const gid = String(u.id || "").trim();
      if (!gid || existing.has(gid)) continue;
      const first = (u.firstName || "").trim();
      const last = (u.lastName || "").trim();
      const name = [first, last].filter(Boolean).join(" ") || (u.name || "").trim() || "Unknown";
      const roleCsv = rolesAvailable ? (u.roles || []).join(", ") : "";

      const ok = await insertStaffRow({ gid, name, role: roleCsv });
      if (ok) {
        existing.add(gid);
        result.inserted += 1;
      }
    }

    result.ok = true;
    return result;
  } catch (e) {
    result.error = `staffAutofillSync error: ${String(e?.message || e)}`;
    return result;
  }
}

async function fetchStaffBasic(admin) {
  const query = `#graphql
    query StaffBasic($first:Int!, $after:String) {
      staffMembers(first: $first, after: $after, query: "active:true", sortKey: ID) {
        edges { cursor node { id firstName lastName name active email } }
        pageInfo { hasNextPage endCursor }
      }
    }`;
  return paginateStaff(admin, query, (n) => ({
    id: n.id, firstName: n.firstName, lastName: n.lastName, name: n.name, roles: []
  }));
}

async function fetchStaffWithRoles(admin) {
  const query = `#graphql
    query StaffWithRoles($first:Int!, $after:String) {
      staffMembers(first: $first, after: $after, query: "active:true", sortKey: ID) {
        edges {
          cursor
          node {
            id
            firstName
            lastName
            name
            permissions { userPermissions { name } }
            privateData { permissions { roles { name } } }
          }
        }
        pageInfo { hasNextPage endCursor }
      }
    }`;
  return paginateStaff(admin, query, (n) => {
    let roles = [];
    if (n?.permissions?.userPermissions) {
      roles = n.permissions.userPermissions.map((x) => x?.name).filter(Boolean);
    } else if (n?.privateData?.permissions?.roles) {
      roles = n.privateData.permissions.roles.map((x) => x?.name).filter(Boolean);
    }
    return { id: n.id, firstName: n.firstName, lastName: n.lastName, name: n.name, roles };
  });
}

async function paginateStaff(admin, query, mapNode) {
  const out = [];
  let after = null;
  for (let i = 0; i < 10; i++) {
    const resp = await admin.graphql(query, { variables: { first: 100, after } });
    const json = await resp.json();
    if (json?.errors?.length) {
      const msg = json.errors.map((e) => e.message).join("; ");
      throw new Error(msg || "GraphQL error");
    }
    const edges = json?.data?.staffMembers?.edges || [];
    edges.forEach(({ node }) => out.push(mapNode(node)));
    const pageInfo = json?.data?.staffMembers?.pageInfo;
    if (!pageInfo?.hasNextPage) break;
    after = pageInfo.endCursor;
  }
  return out;
}

async function getExistingStaffGidSet() {
  const delegate = getStaffDelegate();
  if (delegate) {
    try {
      const rows = await delegate.findMany({ select: { gid: true } });
      return new Set(rows.map((r) => String(r.gid)));
    } catch {
      // fall through to raw SQL
    }
  }
  try {
    const r1 = await prisma.$queryRawUnsafe(`SELECT gid FROM "${SCHEMA}"."rsl_staff"`);
    return new Set((Array.isArray(r1) ? r1 : []).map((r) => String(r.gid)));
  } catch {
    try {
      const r2 = await prisma.$queryRawUnsafe(`SELECT gid FROM rsl_staff`);
      return new Set((Array.isArray(r2) ? r2 : []).map((r) => String(r.gid)));
    } catch {
      return new Set();
    }
  }
}

async function insertStaffRow({ gid, name, role }) {
  const delegate = getStaffDelegate();

  if (delegate) {
    try {
      const exists = await delegate.findFirst({ where: { gid } });
      if (exists) return true;
      await delegate.create({ data: { gid, name, role } });
      return true;
    } catch {
      // fall through to raw SQL
    }
  }

  // Raw SQL path — check existence first; then plain INSERT (no ON CONFLICT dependency)
  const exists = await (async () => {
    try {
      const r = await prisma.$queryRawUnsafe(
        `SELECT 1 FROM "${SCHEMA}"."rsl_staff" WHERE gid = ${sqlQuote(gid)} LIMIT 1`
      );
      return Array.isArray(r) && r.length > 0;
    } catch {
      try {
        const r2 = await prisma.$queryRawUnsafe(
          `SELECT 1 FROM rsl_staff WHERE gid = ${sqlQuote(gid)} LIMIT 1`
        );
        return Array.isArray(r2) && r2.length > 0;
      } catch {
        return false;
      }
    }
  })();
  if (exists) return true;

  try {
    await prisma.$executeRawUnsafe(
      `INSERT INTO "${SCHEMA}"."rsl_staff" ("gid","name","role") VALUES (${sqlQuote(gid)}, ${sqlQuote(name)}, ${sqlQuote(role)})`
    );
    return true;
  } catch {
    try {
      await prisma.$executeRawUnsafe(
        `INSERT INTO rsl_staff ("gid","name","role") VALUES (${sqlQuote(gid)}, ${sqlQuote(name)}, ${sqlQuote(role)})`
      );
      return true;
    } catch {
      return false;
    }
  }
}

// ───────────────────────────────────────────────────────────────────────────────
/** DateInput: TextField + Popover DatePicker (opens on focus or via icon) */
// ───────────────────────────────────────────────────────────────────────────────
function DateInput({ id, label, value, onChange, error, disabled = false }) {
  const [active, setActive] = useState(false);

  const toDate = (val) => {
    const iso = parseDateToISOClient(val);
    if (!iso) return null;
    const [y, m, d] = iso.split("-").map((x) => +x);
    return new Date(y, m - 1, d);
  };

  const selectedDate = toDate(value) || null;
  const initial = selectedDate || new Date();

  const [{ month, year }, setMonthYear] = useState({
    month: initial.getMonth(),
    year: initial.getFullYear(),
  });

  const handlePick = (date) => {
    const iso = dateToISO(date);
    onChange?.(iso);
    setActive(false);
  };

  const handleText = (text) => {
    onChange?.(text);
  };

  const handleBlur = () => {
    const iso = parseDateToISOClient(value);
    if (iso) onChange?.(iso);
  };

  const handleFocus = () => setActive(true);

  const rangeSelected = {
    start: selectedDate || initial,
    end: selectedDate || initial,
  };

  return (
    <div style={{ display: "flex", gap: 8, alignItems: "end" }}>
      <div style={{ flex: 1 }}>
        <TextField
          id={id}
          label={label}
          value={value || ""}
          onChange={handleText}
          onBlur={handleBlur}
          onFocus={handleFocus}
          placeholder="YYYY-MM-DD or MM/DD/YYYY"
          error={error}
          autoComplete="off"
          disabled={disabled}
        />
      </div>
      <Popover
        active={active}
        activator={
          <Button
            icon={CalendarIcon}
            accessibilityLabel={`Choose ${label}`}
            onClick={() => setActive((a) => !a)}
            disabled={disabled}
          />
        }
        autofocusTarget="none"
        onClose={() => setActive(false)}
        preferredAlignment="right"
      >
        <div style={{ padding: 8 }}>
          <DatePicker
            month={month}
            year={year}
            onMonthChange={(m, y) => setMonthYear({ month: m, year: y })}
            selected={rangeSelected}
            onChange={({ start }) => handlePick(start || new Date())}
          />
        </div>
      </Popover>
    </div>
  );
}

function dateToISO(d) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

// ───────────────────────────────────────────────────────────────────────────────
// Component
// ───────────────────────────────────────────────────────────────────────────────
export default function ReturnsPage() {
  const { rows, lookups, diagnostics } = useLoaderData();
  const lookupFetcher = useFetcher();
  const saveEditFetcher = useFetcher();
  const saveReceivingFetcher = useFetcher();
  const revalidator = useRevalidator();

  const schemaMap = useMemo(() => inferSchemaMap(rows), [rows]);

  const [selected, setSelected] = useState(0);
  const tabs = useMemo(
    () => [{ id: "dashboard", content: "Dashboard" }, { id: "inspection", content: "Inspection" }],
    []
  );

  const itemOptions = useMemo(
    () => [
      { label: "Enter Item", value: "" },
      ...(lookups.items || []).map((o) => ({ label: o.value, value: String(o.id) })),
    ],
    [lookups.items]
  );

  const statusOptions = useMemo(
    () => [
      { label: "Set Status", value: "" },
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
  const [lastName, setLastName] = useState("");
  const hasLookupInput =
    trackingNumber.trim().length > 0 ||
    serialNumber.trim().length > 0 ||
    orderNumber.trim().length > 0 ||
    lastName.trim().length > 0;

  // ids to manage focus
  const trackingId = "trackingInput";
  const serialId = "serialInput";
  const orderId = "orderInput";
  const lastId = "lastInput";
  const focusById = (id) => {
    const el = document.getElementById(id);
    if (el && typeof el.focus === "function") el.focus();
  };

  // Initial focus: Tracking Number
  useEffect(() => {
    focusById(trackingId);
  }, []);

  // Enter to lookup + tab cycle across fields
  function handleLookupKeyDown(e, field) {
    if (e.key === "Enter") {
      if (hasLookupInput) {
        e.preventDefault();
        setFilterSpec(null);
        onLookup();
      }
      return;
    }
    if (e.key === "Tab") {
      if (!e.shiftKey) {
        if (field === "tracking") { e.preventDefault(); focusById(serialId); }
        else if (field === "serial") { e.preventDefault(); focusById(orderId); }
        else if (field === "order") { e.preventDefault(); focusById(lastId); }
        else if (field === "last") { e.preventDefault(); focusById(trackingId); }
      } else {
        if (field === "tracking") { e.preventDefault(); focusById(lastId); }
        else if (field === "serial") { e.preventDefault(); focusById(trackingId); }
        else if (field === "order") { e.preventDefault(); focusById(serialId); }
        else if (field === "last") { e.preventDefault(); focusById(orderId); }
      }
    }
  }

  const [feedbackText, setFeedbackText] = useState("");
  const [lookupErrorMsg, setLookupErrorMsg] = useState("");
  const [filterSpec, setFilterSpec] = useState(null); // { mode, value }

  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState(null);
  const [initialForm, setInitialForm] = useState(null);
  const [editErrors, setEditErrors] = useState({});

  const [receivingOpen, setReceivingOpen] = useState(false);
  const [receivingForm, setReceivingForm] = useState(null);
  const [receivingInitial, setReceivingInitial] = useState(null);
  const [receivingErrors, setReceivingErrors] = useState({});

  function openAppropriate(row) {
    const mapForRow = inferSchemaMap([row]);
    const rawDateReceived = mapForRow.date_received ? row?.[mapForRow.date_received] : null;
    const missing =
      rawDateReceived === null ||
      rawDateReceived === undefined ||
      String(rawDateReceived).trim() === "";
    if (missing) openReceiving(row, mapForRow);
    else openEditorWithRow(row, mapForRow);
  }

  function openEditorWithRow(row, mapForRowParam) {
    const mapForRow = mapForRowParam || inferSchemaMap([row]);
    const next = toForm(row, mapForRow);
    setReceivingOpen(false);
    setModalOpen(true);
    setForm(next);
    setInitialForm(next);
    setEditErrors({});
  }

  function openReceiving(row, mapForRowParam) {
    const mapForRow = mapForRowParam || inferSchemaMap([row]);
    const initial = toReceivingForm(row, mapForRow, { defaultToday: false });
    const next = toReceivingForm(row, mapForRow, { defaultToday: true });
    setModalOpen(false);
    setReceivingOpen(true);
    setReceivingForm(next);
    setReceivingInitial(initial);
    setReceivingErrors(validateReceivingClient(next));
  }

  function closeEditor() {
    setModalOpen(false);
    setForm(null);
    setInitialForm(null);
    setEditErrors({});
  }
  function closeReceiving() {
    setReceivingOpen(false);
    setReceivingForm(null);
    setReceivingInitial(null);
    setReceivingErrors({});
  }

  const isDirty = form && initialForm ? JSON.stringify(form) !== JSON.stringify(initialForm) : false;
  const receivingDirty =
    receivingForm && receivingInitial ? JSON.stringify(receivingForm) !== JSON.stringify(receivingInitial) : false;

  function onLookup() {
    const fd = new FormData();
    fd.append("intent", "lookup");
    fd.append("trackingNumber", trackingNumber);
    fd.append("serialNumber", serialNumber);
    fd.append("orderNumber", orderNumber);
    fd.append("lastName", lastName);
    setFeedbackText("");
    setLookupErrorMsg("");
    lookupFetcher.submit(fd, { method: "post" });
  }

  useEffect(() => {
    if (!lookupFetcher?.data) return;
    const mode = lookupFetcher.data.mode || lookupFetcher.data?.multi?.mode || null;

    if (lookupFetcher.data.row) {
      setFilterSpec(null);
      if (mode === "tracking") setFeedbackText("Tracking number found on entry in the window to the right.");
      else if (mode === "serial") setFeedbackText("Serial number found on entry in the window to the right.");
      else if (mode === "order") setFeedbackText("Order number found on entry in the window to the right.");
      else if (mode === "last") setFeedbackText("Last name found on entry in the window to the right.");
      setLookupErrorMsg("");
      openAppropriate(lookupFetcher.data.row);
    } else if (lookupFetcher.data.multi) {
      const { mode: m, value } = lookupFetcher.data.multi;
      setFilterSpec({ mode: m, value: String(value).toLowerCase() });
      if (m === "tracking")
        setFeedbackText("Tracking number found on several entries -- pick one of the entries to the right.");
      else if (m === "serial")
        setFeedbackText("Serial number found on several entries -- this might be a mistake.  Please check the entries to the right.");
      else if (m === "order")
        setFeedbackText("Order number found on several entries -- pick one of the entries to the right.");
      else if (m === "last")
        setFeedbackText("Last name found on several entries -- pick one of the entries to the right.");
      setLookupErrorMsg("");
    } else if (lookupFetcher.data.error) {
      setFeedbackText("");
      setLookupErrorMsg(lookupFetcher.data.error);
    }
  }, [lookupFetcher?.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const lookupPending = lookupFetcher.state !== "idle";

  useEffect(() => {
    if (form) setEditErrors(validateEditClient(form));
  }, [form]);

  useEffect(() => {
    if (receivingForm) setReceivingErrors(validateReceivingClient(receivingForm));
  }, [receivingForm]);

  function handleEditSave() {
    if (!form?.id) return;
    const errs = validateEditClient(form);
    if (Object.keys(errs).length > 0) {
      setEditErrors(errs);
      return;
    }
    const normalized = {
      ...form,
      date_requested: form.date_requested ? parseDateToISOClient(form.date_requested) : "",
      date_received:  form.date_received  ? parseDateToISOClient(form.date_received)  : "",
      date_inspected: form.date_inspected ? parseDateToISOClient(form.date_inspected) : "",
    };
    const fd = new FormData();
    fd.append("intent", "saveEdit");
    Object.entries(normalized).forEach(([k, v]) => fd.append(k, v ?? ""));
    saveEditFetcher.submit(fd, { method: "post" });
  }

  function handleReceivingSave() {
    if (!receivingForm?.id) return;
    const errs = validateReceivingClient(receivingForm);
    if (Object.keys(errs).length > 0) {
      setReceivingErrors(errs);
      return;
    }
    const fd = new FormData();
    fd.append("intent", "saveReceiving");
    fd.append("id", receivingForm.id);
    fd.append("date_received", parseDateToISOClient(receivingForm.date_received) || "");
    saveReceivingFetcher.submit(fd, { method: "post" });
  }

  useEffect(() => {
    const d = saveEditFetcher.data;
    if (!d) return;
    if (d.fieldErrors) {
      setEditErrors(d.fieldErrors);
      return;
    }
    if (d.ok && d.intent === "saveEdit") {
      closeEditor();
      revalidator.revalidate();
      setFeedbackText("Changes saved.");
    }
  }, [saveEditFetcher.data]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const d = saveReceivingFetcher.data;
    if (!d) return;
    if (d.fieldErrors) {
      setReceivingErrors(d.fieldErrors);
      return;
    }
    if (d.ok && d.intent === "saveReceiving") {
      closeReceiving();
      revalidator.revalidate();
      setFeedbackText("Order marked as received.");
    }
  }, [saveReceivingFetcher.data]); // eslint-disable-line react-hooks_exhaustive-deps

  const baseRows = Array.isArray(rows) ? rows : [];
  const displayedRows = useMemo(
    () => applyFilter(baseRows, filterSpec, schemaMap),
    [baseRows, filterSpec, schemaMap]
  );

  const showing = displayedRows.length;

  function handleReset() {
    setFilterSpec(null);
    setTrackingNumber("");
    setSerialNumber("");
    setOrderNumber("");
    setLastName("");
    setFeedbackText("");
    setLookupErrorMsg("");
    setTimeout(() => focusById(trackingId), 0);
  }

  return (
    <Page fullWidth title="RSL Services - Returns">
      {/* Diagnostics */}
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
          {diagnostics?.staffSync
            ? diagnostics.staffSync.error
              ? ` • staffSync: err (${String(diagnostics.staffSync.error).slice(0, 80)})`
              : ` • staffSync: ${diagnostics.staffSync.inserted} added / ${diagnostics.staffSync.considered} considered${diagnostics.staffSync.usedRoles ? "" : " (no roles)"}`
            : ""}
        </Text>
      </InlineStack>

      {/* Layout: Lookup + Table */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 20 }}>
        {/* Lookup Panel */}
        <div style={{ width: 320, maxWidth: 320, flex: "0 0 auto" }}>
          <Card title="Lookup Panel" sectioned>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", minHeight: 520 }}>
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
                <Text as="p" variant="bodyMd">OR</Text>
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
                <Text as="p" variant="bodyMd">OR</Text>
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
              <div style={{ textAlign: "center" }}>
                <Text as="p" variant="bodyMd">OR</Text>
              </div>
              <div onKeyDown={(e) => handleLookupKeyDown(e, "last")}>
                <TextField
                  id={lastId}
                  label="Last Name"
                  value={lastName}
                  onChange={setLastName}
                  autoComplete="off"
                />
              </div>

              {feedbackText ? (
                <div
                  aria-label="Feedback"
                  style={{
                    border: "1px solid rgba(0,0,0,0.28)",
                    borderRadius: 4,
                    padding: "8px 10px",
                    minHeight: 72,
                    whiteSpace: "pre-wrap",
                    color: "#111",
                    background: "rgba(0,0,0,0.03)",
                  }}
                >
                  {feedbackText}
                </div>
              ) : null}

              <div style={{ marginTop: "auto" }}>
                <Button
                  fullWidth
                  onClick={() => { setFilterSpec(null); onLookup(); }}
                  disabled={!hasLookupInput}
                  loading={lookupPending}
                >
                  Lookup Order
                </Button>
              </div>

              {lookupErrorMsg ? (
                <Text as="p" tone="critical" variant="bodySm">
                  {lookupErrorMsg}
                </Text>
              ) : null}
            </div>
          </Card>
        </div>

        {/* Table / Tabs */}
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
        primaryAction={{ content: "Save", onAction: handleEditSave, disabled: !isDirty || Object.keys(editErrors).length > 0 }}
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
                <DateInput
                  label="Date Received"
                  value={form.date_received || ""}
                  onChange={(v) => setForm({ ...form, date_received: v })}
                  error={editErrors.date_received}
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
                <DateInput
                  label="Date Requested"
                  value={form.date_requested || ""}
                  onChange={(v) => setForm({ ...form, date_requested: v })}
                  error={editErrors.date_requested}
                />
                <DateInput
                  label="Date Inspected"
                  value={form.date_inspected || ""}
                  onChange={(v) => setForm({ ...form, date_inspected: v })}
                  error={editErrors.date_inspected}
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
        onClose={() => { handleReset(); closeReceiving(); }}
        title="RECEIVING A RETURN"
        primaryAction={{
          content: "MARK ORDER AS RECEIVED",
          onAction: handleReceivingSave,
          disabled: !receivingDirty || Object.keys(receivingErrors).length > 0
        }}
        secondaryActions={[{ content: "Cancel", onAction: () => { handleReset(); closeReceiving(); } }]}
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
                <DateInput
                  label="Date Received"
                  value={receivingForm.date_received || ""}
                  onChange={(v) => setReceivingForm({ ...receivingForm, date_received: v })}
                  error={receivingErrors.date_received}
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
// Dashboard table and helpers
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
  const [sortDir, setSortDir] = useState(defaultSortDir);

  const items = Array.isArray(rows) ? rows : [];

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

  const getAge = (row) => {
    const drc = k(row, map.date_received);
    return drc ? daysSince(drc) : null;
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
    if (sortKey === key) setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    else { setSortKey(key); setSortDir("desc"); }
  };

  const SortHeader = ({ label, keyName }) => {
    const active = sortKey === keyName;
    const arrow = active ? (sortDir === "desc" ? "▼" : "▲") : "";
    return (
      <span
        onClick={() => toggleSort(keyName)}
        style={{ cursor: "pointer", userSelect: "none", display: "inline-flex", alignItems: "center", gap: 6 }}
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

  if (filterSpec.mode === "last") {
    // Match last token of customer_name
    return rows.filter((row) => {
      const raw = map.customer_name ? row?.[map.customer_name] : row?.customer_name;
      if (raw === null || raw === undefined) return false;
      const last = String(raw).trim().split(/\s+/).pop()?.toLowerCase() || "";
      return last === v;
    });
  }

  const mappedKey =
    filterSpec.mode === "serial" ? map.serial_number :
      filterSpec.mode === "tracking" ? map.tracking_number :
        map.original_order;

  return rows.filter((row) => {
    const tryKeys = mappedKey ? [mappedKey, ...KEYS[filterSpec.mode]] : KEYS[filterSpec.mode];
    for (const k of tryKeys) {
      if (Object.prototype.hasOwnProperty.call(row, k)) {
        const cell = row[k];
        if (cell !== null && cell !== undefined) {
          const sv = String(cell).toLowerCase();
          if (sv === v) return true;
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

function colorNameForAgeStrict(age) {
  if (age === null || age === undefined) return null;
  if (age === 1 || age === 2) return "green";
  if (age === 3) return "yellow";
  if (age > 3) return "red";
  return null;
}

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

// ── validation helpers (client) ────────────────────────────────────────────────
function parseDateToISOClient(value) {
  if (value === undefined || value === null) return null;
  const s = String(value).trim();
  if (!s) return null;

  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (iso) {
    const y = +iso[1], m = +iso[2], d = +iso[3];
    return isValidYMDClient(y, m, d)
      ? `${y}-${String(m).padStart(2,"0")}-${String(d).padStart(2,"0")}`
      : null;
  }

  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (us) {
    const m = +us[1], d = +us[2], y = +us[3];
    return isValidYMDClient(y, m, d)
      ? `${y}-${String(m).padStart(2,"0")}-${String(d).padStart(2,"0")}`
      : null;
  }

  return null;
}
function isValidYMDClient(y, m, d) {
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return false;
  if (m < 1 || m > 12) return false;
  if (d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && (dt.getUTCMonth() + 1) === m && dt.getUTCDate() === d;
}
function todayISOClient() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}
function validateEditClient(f) {
  const errors = {};
  const rqISO = f?.date_requested ? parseDateToISOClient(f.date_requested) : null;
  const rcISO = f?.date_received ? parseDateToISOClient(f.date_received) : null;
  const insISO = f?.date_inspected ? parseDateToISOClient(f.date_inspected) : null;

  if (f?.date_requested && !rqISO) errors.date_requested = "Use YYYY-MM-DD or MM/DD/YYYY";
  if (f?.date_received && !rcISO) errors.date_received = "Use YYYY-MM-DD or MM/DD/YYYY";
  if (f?.date_inspected && !insISO) errors.date_inspected = "Use YYYY-MM-DD or MM/DD/YYYY";

  if (!errors.date_requested && rqISO && rcISO && rcISO < rqISO) {
    errors.date_received = "Date Received cannot be before Date Requested";
  }
  if (!errors.date_received && rcISO && insISO && insISO < rcISO) {
    errors.date_inspected = "Date Inspected cannot be before Date Received";
  }

  return errors;
}
function validateReceivingClient(f) {
  const errors = {};
  const rcISO = f?.date_received ? parseDateToISOClient(f.date_received) : null;
  if (!f?.date_received) errors.date_received = "Date Received is required";
  else if (!rcISO) errors.date_received = "Use YYYY-MM-DD or MM/DD/YYYY";
  else if (rcISO > todayISOClient()) errors.date_received = "Date Received cannot be in the future";
  return errors;
}
