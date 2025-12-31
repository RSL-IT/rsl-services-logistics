// app/routes/apps.logistics.users.jsx
//
// DB-backed CRUD for Logistics users.
// - Creates/updates tbl_logisticsUser
// - Maintains permission links in tbljn_logisticsUser_permission
// - Validates supplier company shortName exists in tbl_company
//
// Payload (JSON or FormData):
//   {
//     intent: "create" | "update" | "delete",
//     user: {
//       id?: string|number,
//       email: string,
//       name?: string,
//       userType?: "RSL Internal"|"RSL Supplier"|string,
//       isActive?: boolean,
//       password?: string,
//       supplierId?: string|null,
//       permissions?: {
//         viewUserManagement?: boolean,
//         createEditUser?: boolean,
//         modifyShipper?: boolean,
//         viewDashboard?: boolean,
//         editDashboard?: boolean,
//         viewShipment?: boolean,
//         createUpdateShipment?: boolean,
//       }
//     }
//   }

import { json } from "@remix-run/node";
import bcrypt from "bcryptjs";
import { verifyProxyIfPresent } from "~/utils/app-proxy-verify.server";
import { logisticsDb } from "~/logistics-db.server";

const INTERNAL_COMPANY_ID = "RSL";

function normalizeUserTypeForDb(input) {
  const raw = String(input || "").trim().toLowerCase();
  if (raw.includes("supplier")) return "RSL Supplier";
  return "RSL Internal";
}

function normalizeUserTypeForUi(input) {
  const raw = String(input || "").trim().toLowerCase();
  if (raw.includes("supplier")) return "RSL Supplier";
  return "RSL Internal";
}

function toBool(v, fallback = false) {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    if (s === "true" || s === "1" || s === "yes") return true;
    if (s === "false" || s === "0" || s === "no") return false;
  }
  return fallback;
}

function mapUiPermissionsToDbShortNames(uiPerms = {}) {
  // Map UI permission booleans -> DB tlkp_permission.shortName(s)
  const p = uiPerms || {};
  const out = new Set();

  // User management
  if (p.viewUserManagement) out.add("user_view");
  if (p.createEditUser) {
    out.add("user_create");
    out.add("user_update");
    out.add("user_delete");
  }

  // Dashboard
  if (p.viewDashboard) out.add("dashboard_view");
  if (p.editDashboard) out.add("dashboard_update");

  // Shipments
  if (p.viewShipment) out.add("shipment_view");
  if (p.createUpdateShipment) {
    out.add("shipment_create");
    out.add("shipment_update");
  }

  // Best-fit mapping for legacy UI permission (no dedicated DB key)
  if (p.modifyShipper) out.add("shipment_update");

  return Array.from(out);
}

function mapDbPermissionSetToUi(dbShortNameSet) {
  const has = (k) => dbShortNameSet.has(k);

  return {
    viewUserManagement: has("user_view"),
    createEditUser: has("user_create") || has("user_update") || has("user_delete"),
    modifyShipper: has("shipment_update"),

    viewDashboard: has("dashboard_view"),
    editDashboard: has("dashboard_update"),

    viewShipment: has("shipment_view"),
    createUpdateShipment: has("shipment_create") || has("shipment_update"),
  };
}

async function readPayload(request) {
  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return await request.json();
  }

  const formData = await request.formData();
  const payload = Object.fromEntries(formData);

  if (typeof payload.user === "string") {
    try {
      payload.user = JSON.parse(payload.user);
    } catch {
      // ignore
    }
  }

  return payload;
}

function mapDbUserToUi(dbUser) {
  const userType = normalizeUserTypeForUi(dbUser.userType);
  const role = userType === "RSL Supplier" ? "supplier" : "internal";
  const supplierId = role === "supplier" ? dbUser.companyID ?? null : null;

  const dbPerms = new Set(
    (dbUser.permissionLinks || [])
      .map((x) => x.permission?.shortName)
      .filter(Boolean),
  );

  return {
    id: String(dbUser.id),
    email: dbUser.email,
    name: dbUser.displayName || "",
    userType,
    role,
    supplierId,
    isActive: dbUser.isActive !== false,
    password: "", // never return password hashes
    permissions: mapDbPermissionSetToUi(dbPerms),
  };
}

export async function action({ request }) {
  const debug = { stage: "start", proxyVerified: false };

  // Best-effort app proxy verification
  try {
    await verifyProxyIfPresent(request);
    debug.proxyVerified = true;
  } catch (err) {
    if (err instanceof Response && err.status === 401) {
      debug.proxyVerified = false;
      debug.proxySkipReason = "no_proxy_signature";
      console.warn("[logistics users] proxy verification skipped:", { status: err.status });
    } else {
      console.error("[logistics users] proxy verification error:", err);
    }
  }

  try {
    debug.stage = "parse-body";
    const payload = await readPayload(request);

    const intent = payload.intent;
    const user = payload.user || {};
    debug.intent = intent;

    if (!intent) {
      return json({ success: false, error: "Missing intent.", debug }, { status: 200 });
    }

    if (intent === "create") {
      debug.stage = "create";

      const email = String(user.email || "").trim().toLowerCase();
      const name = String(user.name || user.displayName || "").trim();
      const password = String(user.password || "").trim();
      const isActive = user.isActive === false ? false : true;

      const userTypeDb = normalizeUserTypeForDb(user.userType || user.role);
      const isSupplier = userTypeDb === "RSL Supplier";

      const supplierId = isSupplier
        ? String(user.supplierId || user.companyID || "").trim()
        : "";

      const companyID = isSupplier ? supplierId : INTERNAL_COMPANY_ID;

      if (!email || !password) {
        return json({ success: false, error: "Email and password are required.", debug }, { status: 200 });
      }

      if (isSupplier && !companyID) {
        return json({ success: false, error: "Supplier users must have a company.", debug }, { status: 200 });
      }

      const existing = await logisticsDb.tbl_logisticsUser.findUnique({ where: { email } });
      if (existing) {
        return json({ success: false, error: "A user with this email already exists.", debug }, { status: 200 });
      }

      // Validate company exists
      const company = await logisticsDb.tbl_company.findUnique({ where: { shortName: companyID } });
      if (!company) {
        return json(
          { success: false, error: `Unknown company shortName: ${companyID}`, debug },
          { status: 200 },
        );
      }

      // Permissions
      const requestedDbPermShortNames = mapUiPermissionsToDbShortNames(user.permissions || {});
      if (requestedDbPermShortNames.length === 0) {
        return json({ success: false, error: "Select at least one permission.", debug }, { status: 200 });
      }

      const perms = await logisticsDb.tlkp_permission.findMany({
        where: { shortName: { in: requestedDbPermShortNames } },
        select: { id: true, shortName: true },
      });

      const found = new Set(perms.map((p) => p.shortName));
      const missing = requestedDbPermShortNames.filter((s) => !found.has(s));
      if (missing.length) {
        return json(
          { success: false, error: `Unknown permission(s): ${missing.join(", ")}`, debug },
          { status: 200 },
        );
      }

      const passwordHash = await bcrypt.hash(password, 10);

      const created = await logisticsDb.$transaction(async (tx) => {
        const dbUser = await tx.tbl_logisticsUser.create({
          data: {
            email,
            displayName: name || null,
            password: passwordHash,
            isActive,
            userType: userTypeDb,
            companyID,
          },
        });

        await tx.tbljn_logisticsUser_permission.createMany({
          data: perms.map((p) => ({
            logisticsUserID: dbUser.id,
            permissionID: p.id,
          })),
        });

        return tx.tbl_logisticsUser.findUnique({
          where: { id: dbUser.id },
          include: { permissionLinks: { include: { permission: true } } },
        });
      });

      return json({ success: true, user: mapDbUserToUi(created), debug }, { status: 200 });
    }

    if (intent === "update") {
      debug.stage = "update";

      const id = Number(user.id);
      if (!id || Number.isNaN(id)) {
        return json({ success: false, error: "Missing user id.", debug }, { status: 200 });
      }

      const existing = await logisticsDb.tbl_logisticsUser.findUnique({
        where: { id },
        include: { permissionLinks: { include: { permission: true } } },
      });

      if (!existing) {
        return json({ success: false, error: "User not found.", debug }, { status: 200 });
      }

      const email = String(user.email || existing.email || "").trim().toLowerCase();
      const name = String(user.name || user.displayName || existing.displayName || "").trim();
      const password = String(user.password || "").trim();
      const isActive = toBool(user.isActive, existing.isActive !== false);

      // User type is NOT editable after creation. Keep DB value.
      const existingTypeUi = normalizeUserTypeForUi(existing.userType);
      const isSupplier = existingTypeUi === "RSL Supplier";

      const supplierId = isSupplier
        ? String(user.supplierId || existing.companyID || "").trim()
        : "";

      const companyID = isSupplier ? supplierId : INTERNAL_COMPANY_ID;

      if (isSupplier && !companyID) {
        return json({ success: false, error: "Supplier users must have a company.", debug }, { status: 200 });
      }

      // Validate company exists
      const company = await logisticsDb.tbl_company.findUnique({ where: { shortName: companyID } });
      if (!company) {
        return json(
          { success: false, error: `Unknown company shortName: ${companyID}`, debug },
          { status: 200 },
        );
      }

      // Permissions
      const requestedDbPermShortNames = mapUiPermissionsToDbShortNames(user.permissions || {});
      if (requestedDbPermShortNames.length === 0) {
        return json({ success: false, error: "Select at least one permission.", debug }, { status: 200 });
      }

      const perms = await logisticsDb.tlkp_permission.findMany({
        where: { shortName: { in: requestedDbPermShortNames } },
        select: { id: true, shortName: true },
      });

      const found = new Set(perms.map((p) => p.shortName));
      const missing = requestedDbPermShortNames.filter((s) => !found.has(s));
      if (missing.length) {
        return json(
          { success: false, error: `Unknown permission(s): ${missing.join(", ")}`, debug },
          { status: 200 },
        );
      }

      const updated = await logisticsDb.$transaction(async (tx) => {
        const baseData = {
          email,
          displayName: name || null,
          isActive,
          companyID,
          userType: existing.userType,
        };

        const dataToUpdate = password
          ? { ...baseData, password: await bcrypt.hash(password, 10) }
          : baseData;

        await tx.tbl_logisticsUser.update({ where: { id }, data: dataToUpdate });

        // Replace permissions
        await tx.tbljn_logisticsUser_permission.deleteMany({ where: { logisticsUserID: id } });
        await tx.tbljn_logisticsUser_permission.createMany({
          data: perms.map((p) => ({
            logisticsUserID: id,
            permissionID: p.id,
          })),
        });

        return tx.tbl_logisticsUser.findUnique({
          where: { id },
          include: { permissionLinks: { include: { permission: true } } },
        });
      });

      return json({ success: true, user: mapDbUserToUi(updated), debug }, { status: 200 });
    }

    if (intent === "delete") {
      debug.stage = "delete";

      const id = Number(user.id);
      if (!id || Number.isNaN(id)) {
        return json({ success: false, error: "Missing user id.", debug }, { status: 200 });
      }

      await logisticsDb.$transaction(async (tx) => {
        await tx.tbljn_logisticsUser_permission.deleteMany({ where: { logisticsUserID: id } });
        await tx.tbl_logisticsUser.delete({ where: { id } });
      });

      return json({ success: true, deletedId: String(id), debug }, { status: 200 });
    }

    debug.stage = "unknown-intent";
    return json({ success: false, error: "Unknown intent.", debug }, { status: 200 });
  } catch (err) {
    console.error("[logistics users] unexpected error:", err, debug);
    return json(
      {
        success: false,
        error: "Server error while saving user.",
        debug: { ...debug, caught: true },
      },
      { status: 200 },
    );
  }
}
