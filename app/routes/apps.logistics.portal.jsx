// app/routes/apps.logistics.portal.jsx
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { verifyProxyIfPresent } from "~/utils/app-proxy-verify.server";
import { logisticsDb } from "~/logistics-db.server";
import { prisma } from "~/db.server";
import {
  getLogisticsUserFromRequest,
  commitLogisticsUserSession,
  destroyLogisticsUserSession,
} from "~/logistics-auth.server";
import { authenticate } from "~/shopify.server";
import LogisticsApp from "~/logistics-ui/LogisticsApp";

function normalizeUserTypeForUi(dbUserType) {
  const raw = String(dbUserType || "").trim().toLowerCase();
  return raw.includes("supplier") ? "RSL Supplier" : "RSL Internal";
}

function mapDbPermissionSetToUi(dbShortNamesSet) {
  const has = (k) => dbShortNamesSet.has(k);

  return {
    viewUserManagement: has("user_view"),
    createEditUser: has("user_create") || has("user_update") || has("user_delete"),
    modifyShipper: has("shipment_update"),
    editDashboard: has("dashboard_update"),
    viewDashboard: has("dashboard_view"),
    viewShipment: has("shipment_view"),
    createUpdateShipment: has("shipment_create") || has("shipment_update"),
  };
}

function dbUserHasPermission(dbUser, permissionShortName) {
  if (!dbUser || !permissionShortName) return false;
  const perms = Array.isArray(dbUser.tbljn_logisticsUser_permission)
    ? dbUser.tbljn_logisticsUser_permission
    : [];
  return perms.some((p) => p?.tlkp_permission?.shortName === permissionShortName);
}

function toIsoOrEmpty(d) {
  if (!d) return "";
  try {
    return new Date(d).toISOString().slice(0, 10);
  } catch {
    return "";
  }
}

function uniqStrings(arr) {
  const seen = new Set();
  const out = [];
  for (const v of arr || []) {
    const s = String(v || "").trim();
    if (!s) continue;
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

function cleanStr(v) {
  return String(v ?? "").trim();
}

function cleanStrOrNull(v) {
  const s = cleanStr(v);
  return s ? s : null;
}

const SHOPIFY_FOOTER_NOISE_RE = /\bPowered by Shopify\b/ig;
const PO_LINE_ITEMS_SNAPSHOT_EVENT = "PO_LINE_ITEMS_SNAPSHOT";

function sanitizeProductTitleText(v) {
  const s = cleanStr(v).replace(SHOPIFY_FOOTER_NOISE_RE, " ");
  const normalized = s.replace(/\s+/g, " ").trim();
  return normalized || null;
}

function isPlaceholderProductId(v) {
  return /^line[_\s-]?\d+$/i.test(cleanStr(v));
}

function normalizeSkuForMatch(v) {
  const raw = cleanStr(v).toUpperCase().replace(/\s+/g, "");
  if (!raw) return "";
  if (raw.length < 7) return raw;
  return `${raw.slice(0, 6)}${raw.slice(7)}`;
}

function normalizeTitleForMatch(v) {
  const title = sanitizeProductTitleText(v);
  if (!title) return "";
  return title
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function titleMatchKeys(v) {
  const title = sanitizeProductTitleText(v);
  if (!title) return [];

  const variants = [title];
  const slashIdx = title.indexOf("/");
  if (slashIdx > 0) variants.push(title.slice(0, slashIdx));
  const dashIdx = title.indexOf(" - ");
  if (dashIdx > 0) variants.push(title.slice(0, dashIdx));

  const keys = [];
  for (const candidate of variants) {
    const normalized = normalizeTitleForMatch(candidate);
    if (!normalized) continue;
    keys.push(normalized);
    const compact = normalized.replace(/\s+/g, "");
    if (compact) keys.push(compact);
  }
  return uniqStrings(keys);
}

function normalizePoLineItemSnapshotRow(row, idx = 0) {
  const mappedId = cleanStrOrNull(
    row?.rslProductID ??
    row?.rslModelID ??
    row?.shortName ??
    null
  );
  const normalizedMappedId = mappedId && !isPlaceholderProductId(mappedId) ? mappedId : null;

  const title = sanitizeProductTitleText(row?.title ?? row?.displayName ?? null);
  const sku = cleanStrOrNull(row?.SKU ?? row?.sku ?? null);
  const qtyRaw = Number(row?.quantity);
  const quantity = Number.isFinite(qtyRaw) ? Math.max(0, Math.trunc(qtyRaw)) : 0;

  return {
    lineNumber: idx + 1,
    title: title || `Line ${idx + 1}`,
    sku,
    quantity,
    rslProductID: normalizedMappedId,
  };
}

function normalizePoLineItemsSnapshot(rows) {
  const raw = Array.isArray(rows) ? rows : [];
  return raw
    .map((row, idx) => normalizePoLineItemSnapshotRow(row, idx))
    .filter((row) => row.title || row.sku || row.quantity > 0 || row.rslProductID);
}

function parsePoLineItemsSnapshot(content) {
  const s = cleanStr(content);
  if (!s) return [];
  try {
    const parsed = JSON.parse(s);
    const rows = Array.isArray(parsed?.lineItems) ? parsed.lineItems : [];
    return normalizePoLineItemsSnapshot(rows);
  } catch {
    return [];
  }
}

function buildSkuLookup(rslProducts) {
  const bySku = new Map();
  for (const p of rslProducts || []) {
    const rawSku = cleanStr(p?.SKU).toUpperCase().replace(/\s+/g, "");
    const skuKey = normalizeSkuForMatch(rawSku);
    if (!skuKey) continue;
    if (!bySku.has(skuKey)) bySku.set(skuKey, []);
    bySku.get(skuKey).push({ product: p, rawSku });
  }
  return bySku;
}

function findSkuMatch(sku, bySku) {
  const normalizedInputSku = cleanStr(sku).toUpperCase().replace(/\s+/g, "");
  const skuKey = normalizeSkuForMatch(normalizedInputSku);
  if (!skuKey) return null;
  const skuMatches = bySku.get(skuKey) || [];
  const matchedEntry = skuMatches.find((m) => m.rawSku === normalizedInputSku) || skuMatches[0] || null;
  return matchedEntry?.product || null;
}

function buildTitleLookup(rslProducts) {
  const byTitle = new Map();
  for (const p of rslProducts || []) {
    const keys = uniqStrings([
      ...titleMatchKeys(p?.displayName),
      ...titleMatchKeys(p?.shortName),
    ]);
    for (const key of keys) {
      if (!byTitle.has(key)) byTitle.set(key, []);
      byTitle.get(key).push(p);
    }
  }
  return byTitle;
}

function findTitleMatch(title, byTitle) {
  const keys = titleMatchKeys(title);
  for (const key of keys) {
    const matches = byTitle.get(key) || [];
    if (matches.length) return matches[0];
  }
  return null;
}

function poProductKey(purchaseOrderGID, rslProductID) {
  return `${String(purchaseOrderGID || "").trim()}::${String(rslProductID || "").trim()}`;
}

/**
 * Schema-accurate shipment -> PO link reader:
 * tbl_container.tbljn_container_purchaseOrder[].tbl_purchaseOrder
 */
function pickPurchaseOrdersInfoFromShipment(s) {
  const links = Array.isArray(s?.tbljn_container_purchaseOrder) ? s.tbljn_container_purchaseOrder : [];

  const gids = links
    .map((l) => l?.tbl_purchaseOrder?.purchaseOrderGID)
    .filter(Boolean)
    .map((x) => String(x));

  const names = links
    .map((l) => l?.tbl_purchaseOrder?.shortName)
    .filter(Boolean)
    .map((x) => String(x));

  return {
    purchaseOrderGIDs: uniqStrings(gids),
    purchaseOrderShortNames: uniqStrings(names),
  };
}

function aggregateContainerProducts(containerRow) {
  const allocations = Array.isArray(containerRow?.tbljn_container_purchaseOrder_rslProduct)
    ? containerRow.tbljn_container_purchaseOrder_rslProduct
    : [];
  const byProduct = new Map();
  for (const row of allocations) {
    const rslProductID = String(row?.rslProductID || "").trim();
    if (!rslProductID) continue;
    const quantity = Number(row?.quantity) || 0;
    const existing = byProduct.get(rslProductID) || {
      rslProductID,
      shortName: row?.tlkp_rslProduct?.shortName || rslProductID,
      displayName: row?.tlkp_rslProduct?.displayName || rslProductID,
      SKU: row?.tlkp_rslProduct?.SKU || null,
      quantity: 0,
    };
    existing.quantity += quantity;
    byProduct.set(rslProductID, existing);
  }
  return [...byProduct.values()];
}

function buildContainerPoAllocationMap(containerRow) {
  const allocations = Array.isArray(containerRow?.tbljn_container_purchaseOrder_rslProduct)
    ? containerRow.tbljn_container_purchaseOrder_rslProduct
    : [];
  const out = {};
  for (const row of allocations) {
    const productId = String(row?.rslProductID || "").trim();
    const poGid = String(row?.purchaseOrderGID || "").trim();
    const qty = Number(row?.quantity) || 0;
    if (!productId || !poGid || qty <= 0) continue;
    if (!out[productId]) out[productId] = {};
    out[productId][poGid] = (Number(out[productId][poGid]) || 0) + qty;
  }
  return out;
}

/**
 * Avoid "cannot read ... findMany" hard-crashes if a model is missing from the generated client
 * (e.g. deploy didn't run prisma generate), and keep portal usable.
 */
async function safeFindMany(model, args, label) {
  try {
    if (!model || typeof model.findMany !== "function") {
      console.warn("[logistics portal] safeFindMany: model missing:", label);
      return [];
    }
    return await model.findMany(args);
  } catch (err) {
    console.error("[logistics portal] safeFindMany error:", label, err);
    return [];
  }
}

export async function loader({ request }) {
  const debug = { proxyVerified: false };
  const url = new URL(request.url);
  const shopParam = url.searchParams.get("shop");
  const isEmbedded =
    url.searchParams.get("embedded") === "1" ||
    url.searchParams.has("host");
  let setCookieHeader = null;
  let initialError = null;
  const debugEnabled = String(process.env.LOGISTICS_DEBUG || "").toLowerCase() === "true";
  let scopeList = null;
  let hasReadUsers = false;
  let staffEmail = null;
  let staffId = null;
  let staffName = null;
  let staffLookupError = null;
  const debugInfo = {
    isEmbedded,
    shop: shopParam,
    hasReadUsers: null,
    scopes: null,
    staffEmail: null,
    staffId: null,
    staffName: null,
    sessionUserId: null,
    sessionEmail: null,
    initialError: null,
  };

  // 1) Best-effort proxy verification
  try {
    await verifyProxyIfPresent(request);
    debug.proxyVerified = true;
  } catch (err) {
    if (err instanceof Response && err.status === 401) {
      debug.proxyVerified = false;
      debug.proxySkipReason = "no_proxy_signature";
      console.warn("[logistics portal] proxy verification skipped:", { status: err.status });
    } else {
      console.error("[logistics portal] proxy verification error:", err);
    }
  }

  // 2) Session user (if any)
  let sessionUser = await getLogisticsUserFromRequest(request);
  let sessionUserId = sessionUser?.id ?? null;
  let sessionEmail = sessionUser?.email ?? null;
  debugInfo.sessionUserId = sessionUserId;
  debugInfo.sessionEmail = sessionEmail;

  if (isEmbedded && shopParam) {
    try {
      const offlineSession = await prisma.session.findFirst({
        where: { shop: shopParam, isOnline: false },
        orderBy: [{ expires: "desc" }],
        select: { scope: true },
      });
      scopeList = String(offlineSession?.scope || "")
        .split(/[,\s]+/)
        .map((s) => s.trim())
        .filter(Boolean);
      hasReadUsers = scopeList.includes("read_users");
      if (debugEnabled) {
        debugInfo.hasReadUsers = hasReadUsers;
        debugInfo.scopes = scopeList;
      }
    } catch (err) {
      console.warn("[logistics portal] scope lookup failed", {
        shop: shopParam,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (isEmbedded && shopParam && hasReadUsers) {
    try {
      const authResult = await authenticate.admin(request);
      if (authResult instanceof Response) {
        staffLookupError = `admin_auth_redirect_${authResult.status}`;
        console.warn("[logistics portal] staff auth redirected; continuing without staff lookup", {
          shop: shopParam,
          status: authResult.status,
          location: authResult.headers.get("location") || null,
        });
      } else {
        const { admin, session } = authResult;
        if (admin?.graphql) {
          const associatedUser = session?.onlineAccessInfo?.associated_user || null;
          if (associatedUser?.email) {
            staffEmail = associatedUser.email;
            staffName = associatedUser.first_name || associatedUser.last_name
              ? `${associatedUser.first_name || ""} ${associatedUser.last_name || ""}`.trim()
              : staffName;
            staffId = associatedUser.id ? String(associatedUser.id) : staffId;
          }

          const query = `#graphql
            query CurrentStaffMember {
              currentStaffMember {
                id
                email
                firstName
                lastName
              }
            }
          `;
          const resp = await admin.graphql(query);
          const body = await resp.json();
          if (resp.ok && !body?.errors?.length) {
            const gqlEmail = body?.data?.currentStaffMember?.email || null;
            const gqlId = body?.data?.currentStaffMember?.id || null;
            const gqlName =
              `${body?.data?.currentStaffMember?.firstName || ""} ${body?.data?.currentStaffMember?.lastName || ""}`
                .trim() || null;

            staffEmail = gqlEmail || staffEmail;
            staffId = gqlId || staffId;
            staffName = gqlName || staffName;

            console.info("[logistics portal] staff member", {
              shop: shopParam,
              email: staffEmail,
              id: staffId,
              name: staffName,
              sessionIsOnline: session?.isOnline ?? null,
              sessionAssociatedUser: associatedUser?.email ? associatedUser.email : null,
            });
          } else {
            staffLookupError = body?.errors ?? "staff_query_failed";
            console.warn("[logistics portal] staff query failed", {
              shop: shopParam,
              status: resp.status,
              errors: body?.errors ?? null,
              sessionIsOnline: session?.isOnline ?? null,
              sessionAssociatedUser: associatedUser?.email ? associatedUser.email : null,
            });
          }
        }
      }
    } catch (err) {
      staffLookupError = err instanceof Error ? err.message : String(err);
      console.error("[logistics portal] staff query exception", {
        shop: shopParam,
        error: staffLookupError,
      });
    }
    if (debugEnabled) {
      debugInfo.staffEmail = staffEmail;
      debugInfo.staffId = staffId;
      debugInfo.staffName = staffName;
      if (staffLookupError) debugInfo.staffLookupError = staffLookupError;
    }
  }

  // 2b) If opened from Shopify Admin, auto-login as current staff member
  if (!sessionUserId && isEmbedded && shopParam) {
    console.info("[logistics portal] embedded auth scopes", {
      shop: shopParam,
      hasReadUsers,
      scopes: scopeList || [],
    });

    if (!hasReadUsers) {
      debug.autoLogin = {
        ok: false,
        reason: "missing_scope",
        required: "read_users",
        scopes: scopeList || [],
      };
      initialError =
        "You haven't been added as a user for the Logistics app. Please contact the admin for access.";
    }
  }

  if (isEmbedded && shopParam && hasReadUsers) {
    if (staffEmail) {
      const matched = await logisticsDb.tbl_logisticsUser.findFirst({
        where: {
          email: { equals: staffEmail, mode: "insensitive" },
        },
        select: { id: true, email: true },
      });

      if (matched?.id) {
        sessionUserId = matched.id;
        sessionEmail = matched.email;
        sessionUser = { id: matched.id, email: matched.email };
        setCookieHeader = await commitLogisticsUserSession(request, matched.id);
        debug.autoLogin = {
          ok: true,
          shop: shopParam,
          staffEmail: staffEmail,
        };
      } else {
        initialError =
          "You haven't been added as a user for the Logistics app. Please contact the admin for access.";
        if (debugEnabled) debugInfo.initialError = initialError;
        sessionUserId = null;
        sessionEmail = null;
        sessionUser = null;
        setCookieHeader = await destroyLogisticsUserSession(request);
        debug.autoLogin = {
          ok: false,
          reason: "no_matching_logistics_user",
          emailUsed: staffEmail,
          staffEmail: staffEmail,
          shop: shopParam,
        };
      }
    } else if (!initialError) {
      const pendingAuth = typeof staffLookupError === "string" &&
        staffLookupError.startsWith("admin_auth_redirect_");
      initialError = pendingAuth
        ? "Shopify authentication is still initializing. Please refresh in a moment."
        : "You haven't been added as a user for the Logistics app. Please contact the admin for access.";
      if (debugEnabled) debugInfo.initialError = initialError;
      sessionUserId = null;
      sessionEmail = null;
      sessionUser = null;
      setCookieHeader = await destroyLogisticsUserSession(request);
      debug.autoLogin = {
        ok: false,
        reason: "missing_staff_email",
        shop: shopParam,
      };
    }
  }

  // 3) Fetch shipments + users + lookups
  let shipments = [];
  let users = [];
  let companies = [];
  let containers = [];
  let originPorts = [];
  let destinationPorts = [];
  let bookingAgents = [];
  let deliveryAddresses = [];
  let purchaseOrders = [];
  let rslModels = [];

  // Do NOT use Promise.all() that can fail-all if one query fails.
  // Each query is isolated so login doesn't break.
  const shipmentRows = await safeFindMany(
    logisticsDb.tbl_container,
    {
      orderBy: { etaDate: "asc" },
      include: {
        // schema: tbl_container.tbljn_container_purchaseOrder[]
        tbljn_container_purchaseOrder: {
          include: {
            // schema: tbljn_container_purchaseOrder.tbl_purchaseOrder
            tbl_purchaseOrder: { select: { purchaseOrderGID: true, shortName: true } },
          },
        },
        // schema: tbl_container.tbljn_container_purchaseOrder_rslProduct[]
        tbljn_container_purchaseOrder_rslProduct: {
          include: {
            // schema: tbljn_container_purchaseOrder_rslProduct.tlkp_rslProduct
            tlkp_rslProduct: { select: { shortName: true, displayName: true, SKU: true } },
          },
        },
        // schema: tbl_container.tbl_containerNotes[]
        tbl_containerNotes: {
          orderBy: { createdAt: "desc" },
          include: {
            tbl_logisticsUser: { select: { displayName: true } },
          },
        },
      },
    },
    "tbl_container"
  );

  let userRows = await safeFindMany(
    logisticsDb.tbl_logisticsUser,
    {
      orderBy: { id: "asc" },
      include: {
        // schema: tbl_logisticsUser.tbljn_logisticsUser_permission[]
        tbljn_logisticsUser_permission: {
          include: {
            // schema: tbljn_logisticsUser_permission.tlkp_permission
            tlkp_permission: true,
          },
        },
      },
    },
    "tbl_logisticsUser"
  );

  // If the main users query failed but we have a session, try to load just the session user
  if ((!userRows || userRows.length === 0) && (sessionUserId || sessionEmail)) {
    const where = sessionUserId
      ? { id: Number(sessionUserId) }
      : { email: String(sessionEmail) };

    const oneUserRows = await safeFindMany(
      logisticsDb.tbl_logisticsUser,
      {
        where,
        take: 1,
        include: {
          tbljn_logisticsUser_permission: {
            include: { tlkp_permission: true },
          },
        },
      },
      "tbl_logisticsUser(session fallback)"
    );
    if (oneUserRows && oneUserRows.length > 0) userRows = oneUserRows;
  }

  let canViewDebug = false;
  if (debugEnabled && (sessionUserId || sessionEmail)) {
    const match = (userRows || []).find((u) => {
      if (sessionUserId && String(u.id) === String(sessionUserId)) return true;
      if (sessionEmail && String(u.email || "").toLowerCase() === String(sessionEmail).toLowerCase()) return true;
      return false;
    });
    canViewDebug = dbUserHasPermission(match, "debug_view");
  }

  const companyRows = await safeFindMany(
    logisticsDb.tlkp_company,
    { select: { shortName: true, displayName: true }, orderBy: { shortName: "asc" } },
    "tlkp_company"
  );

  const containerRows = await safeFindMany(
    logisticsDb.tlkp_container,
    { select: { shortName: true, displayName: true }, orderBy: { shortName: "asc" } },
    "tlkp_container"
  );

  const originRows = await safeFindMany(
    logisticsDb.tlkp_originPort,
    { select: { shortName: true, displayName: true }, orderBy: { shortName: "asc" } },
    "tlkp_originPort"
  );

  const destRows = await safeFindMany(
    logisticsDb.tlkp_destinationPort,
    { select: { shortName: true, displayName: true }, orderBy: { shortName: "asc" } },
    "tlkp_destinationPort"
  );

  const bookingAgentRows = await safeFindMany(
    logisticsDb.tlkp_bookingAgent,
    { select: { shortName: true, displayName: true }, orderBy: { shortName: "asc" } },
    "tlkp_bookingAgent"
  );

  const deliveryAddressRows = await safeFindMany(
    logisticsDb.tlkp_deliveryAddress,
    { select: { shortName: true, displayName: true }, orderBy: { shortName: "asc" } },
    "tlkp_deliveryAddress"
  );

  const purchaseOrderRows = await safeFindMany(
    logisticsDb.tbl_purchaseOrder,
    {
      orderBy: { shortName: "asc" },
      select: {
        id: true,
        purchaseOrderGID: true,
        shortName: true,
        purchaseOrderPdfUrl: true,
        proFormaInvoiceUrl: true,
        originalPoDate: true,
        deliveryAddress: true,
        createdAt: true,
        updatedAt: true,

        // schema: tbl_purchaseOrder.tbljn_purchaseOrder_rslProduct[]
        tbljn_purchaseOrder_rslProduct: {
          select: {
            rslProductID: true,
            initialQuantity: true,
            committedQuantity: true,
            // schema: tbljn_purchaseOrder_rslProduct.tlkp_rslProduct
            tlkp_rslProduct: { select: { shortName: true, displayName: true, SKU: true } },
          },
        },

        // schema: tbl_purchaseOrder.tbljn_purchaseOrder_company[]
        tbljn_purchaseOrder_company: {
          take: 1,
          select: {
            // schema: tbljn_purchaseOrder_company.tlkp_company
            tlkp_company: { select: { shortName: true, displayName: true } },
          },
        },
        tlkp_deliveryAddress: {
          select: { shortName: true, displayName: true },
        },

        // schema: tbl_purchaseOrder.tbl_purchaseOrderNotes[]
        tbl_purchaseOrderNotes: {
          orderBy: [{ createdAt: "desc" }],
          select: {
            id: true,
            createdAt: true,
            content: true,
            pdfUrl: true,
            pdfFileName: true,
            eventType: true,
            // schema: tbl_purchaseOrderNotes.tbl_logisticsUser
            tbl_logisticsUser: { select: { displayName: true } },
          },
        },
      },
    },
    "tbl_purchaseOrder"
  );

  const rslModelRows = await safeFindMany(
    logisticsDb.tlkp_rslProduct,
    { select: { shortName: true, displayName: true, SKU: true }, orderBy: [{ displayName: "asc" }] },
    "tlkp_rslProduct"
  );
  const rslShortNameSet = new Set(
    (rslModelRows || [])
      .map((row) => cleanStr(row?.shortName))
      .filter(Boolean)
  );
  const rslSkuLookup = buildSkuLookup(rslModelRows);
  const rslTitleLookup = buildTitleLookup(rslModelRows);

  // Derive committed quantities from live container allocations so stale committedQuantity
  // values in tbljn_purchaseOrder_rslProduct never surface as false "0 available" rows.
  const containerAllocationRows = await safeFindMany(
    logisticsDb.tbljn_container_purchaseOrder_rslProduct,
    {
      select: {
        purchaseOrderGID: true,
        rslProductID: true,
        quantity: true,
      },
    },
    "tbljn_container_purchaseOrder_rslProduct"
  );
  const committedByPoProduct = new Map();
  for (const row of containerAllocationRows || []) {
    const key = poProductKey(row?.purchaseOrderGID, row?.rslProductID);
    if (!key || key === "::") continue;
    const qty = Number(row?.quantity) || 0;
    if (qty <= 0) continue;
    committedByPoProduct.set(key, (committedByPoProduct.get(key) || 0) + qty);
  }

  // Map shipments
  shipments = (shipmentRows || []).map((s) => {
    const po = pickPurchaseOrdersInfoFromShipment(s);
    const externalContainerId = String(s.rslLogisticsID || s.id || "").trim();

    // Map shipment notes/history
    const history = Array.isArray(s.tbl_containerNotes)
      ? s.tbl_containerNotes.map((n) => ({
          id: String(n.id),
          timestamp: n.createdAt ? new Date(n.createdAt).toISOString() : new Date().toISOString(),
          content: n.content || "",
          changes: n.changes || null,
          user: n.tbl_logisticsUser?.displayName || null,
        }))
      : [];

    const products = aggregateContainerProducts(s);

    const productQuantities = {};
    for (const p of products) {
      productQuantities[p.rslProductID] = p.quantity;
    }
    const poAllocations = buildContainerPoAllocationMap(s);

    return {
      id: externalContainerId,
      dbId: String(s.id),
      rslLogisticsID: externalContainerId,
      supplierId: s.companyId,
      supplierName: s.companyName,
      products,
      productQuantities,
      poAllocations,

      containerNumber: s.containerNumber ?? "",
      containerSize: s.containerSize ?? "",
      portOfOrigin: s.portOfOrigin ?? "",
      destinationPort: s.destinationPort ?? "",

      cargoReadyDate: toIsoOrEmpty(s.cargoReadyDate),
      etd: toIsoOrEmpty(s.estimatedDeliveryToOrigin),
      actualDepartureDate: "",
      eta: toIsoOrEmpty(s.etaDate),
      sealNumber: "",
      hblNumber: "",
      estimatedDeliveryDate: "",
      status: s.status ?? "",

      estimatedDeliveryToOrigin: toIsoOrEmpty(s.estimatedDeliveryToOrigin),
      supplierPi: s.supplierPi ?? "",
      packingListUrl: s.packingListUrl ?? "",
      packingListFileName: s.packingListFileName ?? "",
      commercialInvoiceUrl: s.commercialInvoiceUrl ?? "",
      commercialInvoiceFileName: s.commercialInvoiceFileName ?? "",
      quantity: s.quantity != null ? String(s.quantity) : "",
      bookingAgent: s.bookingAgent ?? "",
      bookingNumber: s.bookingNumber ?? "",
      vesselName: s.vesselName ?? "",
      deliveryAddress: s.deliveryAddress ?? "",
      notes: s.notes ?? "",

      purchaseOrderGIDs: po.purchaseOrderGIDs,
      purchaseOrderShortNames: po.purchaseOrderShortNames,

      history,
    };
  });

  // Map users
  users = (userRows || []).map((u) => {
    const userType = normalizeUserTypeForUi(u.userType);
    const role = userType === "RSL Supplier" ? "supplier" : "internal";
    const supplierId = role === "supplier" ? u.companyID ?? null : null;

    const dbPerms = new Set(
      (u.tbljn_logisticsUser_permission || [])
        .map((x) => x.tlkp_permission?.shortName)
        .filter(Boolean)
    );

    return {
      id: String(u.id),
      email: u.email,
      password: "",
      userType,
      isActive: u.isActive !== false,
      permissions: mapDbPermissionSetToUi(dbPerms),
      name: u.displayName || u.email,
      role,
      supplierId,
      companyName: u.companyID || "",
    };
  });

  companies = (companyRows || []).map((c) => ({ shortName: c.shortName, displayName: c.displayName }));
  containers = (containerRows || []).map((c) => ({ shortName: c.shortName, displayName: c.displayName }));
  originPorts = (originRows || []).map((p) => ({ shortName: p.shortName, displayName: p.displayName }));
  destinationPorts = (destRows || []).map((p) => ({ shortName: p.shortName, displayName: p.displayName }));
  bookingAgents = (bookingAgentRows || []).map((b) => ({ shortName: b.shortName, displayName: b.displayName }));
  deliveryAddresses = (deliveryAddressRows || []).map((d) => ({ shortName: d.shortName, displayName: d.displayName }));

  purchaseOrders = (purchaseOrderRows || []).map((po) => {
    const company = po.tbljn_purchaseOrder_company?.[0]?.tlkp_company || null;
    const deliveryAddress = po.tlkp_deliveryAddress || null;
    const joinedProducts = Array.isArray(po.tbljn_purchaseOrder_rslProduct)
      ? po.tbljn_purchaseOrder_rslProduct
      : [];
    const joinMetaById = new Map(
      joinedProducts.map((l) => [
        cleanStr(l?.rslProductID),
        {
          shortName: l?.tlkp_rslProduct?.shortName || l?.rslProductID || null,
          displayName: l?.tlkp_rslProduct?.displayName || l?.rslProductID || null,
          sku: l?.tlkp_rslProduct?.SKU || null,
          initialQuantity: Number.isFinite(Number(l?.initialQuantity))
            ? Math.max(0, Math.trunc(Number(l.initialQuantity)))
            : 0,
          committedQuantity: Math.max(
            0,
            Math.trunc(Number(committedByPoProduct.get(poProductKey(po.purchaseOrderGID, l?.rslProductID))) || 0)
          ),
        },
      ])
    );

    const rawNotes = Array.isArray(po.tbl_purchaseOrderNotes) ? po.tbl_purchaseOrderNotes : [];
    const snapshotNote = rawNotes.find((n) => cleanStr(n?.eventType) === PO_LINE_ITEMS_SNAPSHOT_EVENT) || null;
    const snapshotLineItems = parsePoLineItemsSnapshot(snapshotNote?.content);

    const products = snapshotLineItems.length
      ? snapshotLineItems.map((row, idx) => {
        const snapshotMappedId = cleanStrOrNull(row?.rslProductID);
        let mappedId = snapshotMappedId;
        let fallbackMatchedProduct = null;
        const snapshotMappedIdLooksUsable = Boolean(
          mappedId && (joinMetaById.has(mappedId) || rslShortNameSet.has(mappedId))
        );
        if (!snapshotMappedIdLooksUsable) {
          mappedId = null;
        }
        if (!mappedId) {
          fallbackMatchedProduct = findSkuMatch(row?.sku, rslSkuLookup);
          if (!fallbackMatchedProduct) {
            fallbackMatchedProduct = findTitleMatch(row?.title, rslTitleLookup);
          }
          mappedId = cleanStrOrNull(fallbackMatchedProduct?.shortName);
        }

        const joinMeta = mappedId ? joinMetaById.get(mappedId) : null;
        const qtyRaw = Number(row?.quantity);
        const quantity = Number.isFinite(qtyRaw) ? Math.max(0, Math.trunc(qtyRaw)) : 0;
        const title =
          sanitizeProductTitleText(joinMeta?.displayName) ||
          sanitizeProductTitleText(fallbackMatchedProduct?.displayName) ||
          sanitizeProductTitleText(row?.title) ||
          `Line ${idx + 1}`;
        const committedQuantity = Number.isFinite(Number(joinMeta?.committedQuantity))
          ? Math.max(0, Math.trunc(Number(joinMeta?.committedQuantity)))
          : 0;

        return {
          rslProductID: mappedId || "",
          shortName: mappedId || "",
          displayName: title,
          SKU: cleanStrOrNull(row?.sku) || joinMeta?.sku || cleanStrOrNull(fallbackMatchedProduct?.SKU) || null,
          initialQuantity: quantity,
          committedQuantity,
          quantity,
        };
      })
      : joinedProducts.map((l) => ({
        rslProductID: l.rslProductID,
        shortName: l.tlkp_rslProduct?.shortName || l.rslProductID,
        displayName: l.tlkp_rslProduct?.displayName || l.rslProductID,
        SKU: l.tlkp_rslProduct?.SKU || null,
        initialQuantity: typeof l.initialQuantity === "number" ? l.initialQuantity : 0,
        committedQuantity: Math.max(
          0,
          Math.trunc(Number(committedByPoProduct.get(poProductKey(po.purchaseOrderGID, l.rslProductID))) || 0)
        ),
        // keep legacy quantity for existing UI consumers
        quantity: typeof l.initialQuantity === "number" ? l.initialQuantity : 0,
      }));

    const notes = rawNotes
      .filter((n) => cleanStr(n?.eventType) !== PO_LINE_ITEMS_SNAPSHOT_EVENT)
      .map((n) => ({
        id: String(n.id),
        timestamp: n.createdAt ? new Date(n.createdAt).toISOString() : new Date().toISOString(),
        content: n.content || "",
        eventType: n.eventType === "PDF_UPDATE" ? "New PDF Uploaded" : n.eventType,
        pdfUrl: n.pdfUrl || null,
        pdfFileName: n.pdfFileName || null,
        user: n.tbl_logisticsUser?.displayName || null,
      }));

    const lastUpdatedBy = notes.length > 0 && notes[0].user ? notes[0].user : null;

    return {
      id: po.id,
      purchaseOrderGID: po.purchaseOrderGID,
      shortName: po.shortName,
      purchaseOrderPdfUrl: po.purchaseOrderPdfUrl || null,
      proFormaInvoiceUrl: po.proFormaInvoiceUrl || null,
      originalPoDate: po.originalPoDate ? po.originalPoDate.toISOString() : null,
      createdAt: po.createdAt ? po.createdAt.toISOString() : null,
      updatedAt: po.updatedAt ? po.updatedAt.toISOString() : null,

      products,

      companyID: company?.shortName || null,
      companyName: company?.displayName || company?.shortName || null,
      deliveryAddressID: deliveryAddress?.shortName || po.deliveryAddress || null,
      deliveryAddressName: deliveryAddress?.displayName || deliveryAddress?.shortName || null,
      lastUpdatedBy,
      notes,
    };
  });

  rslModels = (rslModelRows || []).map((m) => ({
    shortName: m.shortName,
    displayName: m.displayName,
    SKU: m.SKU,
  }));

  const currentUser = sessionUserId
    ? users.find((u) => String(u.id) === String(sessionUserId)) || null
    : null;
  const isSupplierUser = String(currentUser?.role || "").toLowerCase() === "supplier";
  const supplierCompanyId = String(currentUser?.supplierId || currentUser?.companyName || "").trim() || null;

  if (isSupplierUser) {
    if (supplierCompanyId) {
      shipments = shipments.filter((s) => String(s?.supplierId || "").trim() === supplierCompanyId);
      purchaseOrders = purchaseOrders.filter((po) => String(po?.companyID || "").trim() === supplierCompanyId);
      companies = companies.filter((c) => String(c?.shortName || "").trim() === supplierCompanyId);
    } else {
      shipments = [];
      purchaseOrders = [];
      companies = [];
    }

    // Supplier clients only need their own profile record.
    users = currentUser ? [currentUser] : [];

    // Minimize model enumeration in supplier payloads.
    const allowedProductIds = new Set();
    for (const po of purchaseOrders) {
      for (const p of po?.products || []) {
        const id = String(p?.rslProductID || "").trim();
        if (id) allowedProductIds.add(id);
      }
    }
    for (const s of shipments) {
      for (const p of s?.products || []) {
        const id = String(p?.rslProductID || "").trim();
        if (id) allowedProductIds.add(id);
      }
    }
    rslModels = rslModels.filter((m) => allowedProductIds.has(String(m?.shortName || "").trim()));
  }

  const payload = {
    initialShipments: shipments,
    initialUsers: users,
    companies,
    containers,
    originPorts,
    destinationPorts,
    bookingAgents,
    deliveryAddresses,
    purchaseOrders,
    rslModels,
    currentUser,
    isEmbedded,
    isProxy: request.headers.get("x-logistics-proxy") === "1",
    initialError,
    debugInfo: debugEnabled && canViewDebug && !isSupplierUser ? debugInfo : null,
  };

  if (debugEnabled && canViewDebug && !isSupplierUser) {
    payload.debug = debug;
  }

  return json(payload, setCookieHeader ? { headers: { "Set-Cookie": setCookieHeader } } : undefined);
}

export default function LogisticsPortalRoute() {
  const {
    initialShipments,
    initialUsers,
    companies,
    containers,
    originPorts,
    destinationPorts,
    bookingAgents,
    deliveryAddresses,
    purchaseOrders,
    rslModels,
    currentUser,
    isEmbedded,
    isProxy,
    initialError,
    debugInfo,
  } = useLoaderData();

  return (
    <div id="logistics-root">
      <LogisticsApp
        initialShipments={initialShipments}
        initialUsers={initialUsers}
        companies={companies}
        containers={containers}
        originPorts={originPorts}
        destinationPorts={destinationPorts}
        bookingAgents={bookingAgents}
        deliveryAddresses={deliveryAddresses}
        purchaseOrders={purchaseOrders}
        rslModels={rslModels}
        currentUser={currentUser}
        isEmbedded={isEmbedded}
        isProxy={isProxy}
        initialError={initialError}
        debugInfo={debugInfo}
      />
    </div>
  );
}
