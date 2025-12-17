// app/logistics-ui/components/UserDetailsModal.tsx
import React, { useEffect, useMemo, useState } from "react";
import { X, Mail, Shield, User as UserIcon, Lock, Factory } from "lucide-react";
import type { UIUser } from "./UserManagement";

export type CompanyOption = {
  shortName: string;
  displayName?: string | null;
};

// Optional permission option type – when you start feeding from tlkp_permission
export interface PermissionOption {
  shortName: string; // e.g. "viewUserManagement"
  displayName: string;
}

interface UserDetailsModalProps {
  user: UIUser;
  onClose: () => void;

  companies?: CompanyOption[];

  /**
   * Optional: full list of permissions from DB (tlkp_permission).
   * If not provided, we fall back to the hard-coded set.
   */
  availablePermissions?: PermissionOption[];

  /**
   * Optional hooks to actually persist changes.
   * We'll call these when Create / Update / Delete are clicked.
   */
  onSave?: (mode: "create" | "update", user: UIUser) => void;
  onDelete?: (user: UIUser) => void;

  isSaving?: boolean;
  error?: string | null;
}

/**
 * Exact permission shape from usersData.User["permissions"].
 */
type PermissionMap = {
  viewUserManagement: boolean;
  createEditUser: boolean;
  modifyShipper: boolean;
  editDashboard: boolean;
  viewDashboard: boolean;
  viewShipment: boolean;
  createUpdateShipment: boolean;
};

type FormUser = Omit<UIUser, "permissions"> & {
  permissions: PermissionMap;
};

const FALLBACK_PERMISSION_DEFS: PermissionOption[] = [
  { shortName: "viewUserManagement", displayName: "View User Management" },
  { shortName: "createEditUser", displayName: "Create / Edit User" },
  { shortName: "modifyShipper", displayName: "Modify Shipper" },
  { shortName: "editDashboard", displayName: "Edit Dashboard" },
  { shortName: "viewDashboard", displayName: "View Dashboard" },
  { shortName: "viewShipment", displayName: "View Shipment" },
  { shortName: "createUpdateShipment", displayName: "Create / Update Shipment" },
];

function normalizeUserType(v: any): "RSL Internal" | "RSL Supplier" | "" {
  const raw = String(v ?? "").trim();
  if (!raw) return "";
  const lower = raw.toLowerCase();
  if (lower === "internal") return "RSL Internal";
  if (lower === "supplier") return "RSL Supplier";
  if (lower.includes("supplier")) return "RSL Supplier";
  if (lower.includes("internal")) return "RSL Internal";
  if (raw === "RSL Supplier" || raw === "RSL Internal") return raw;
  return "";
}

function isSupplierType(v: any) {
  return normalizeUserType(v) === "RSL Supplier";
}

function normalizeToFormUser(u: UIUser): FormUser {
  const { permissions, ...rest } = u;
  const incoming = (permissions || {}) as Partial<PermissionMap>;

  const perms: PermissionMap = {
    viewUserManagement: incoming.viewUserManagement ?? false,
    createEditUser: incoming.createEditUser ?? false,
    modifyShipper: incoming.modifyShipper ?? false,
    editDashboard: incoming.editDashboard ?? false,
    viewDashboard: incoming.viewDashboard ?? false,
    viewShipment: incoming.viewShipment ?? false,
    createUpdateShipment: incoming.createUpdateShipment ?? false,
  };

  const userType = normalizeUserType((rest as any).userType);

  // Company id may be stored in supplierId (new) or companyName (older mocks)
  const supplierId =
    (rest as any).supplierId ??
    (rest as any).companyID ??
    (rest as any).companyName ??
    null;

  return {
    ...(rest as Omit<UIUser, "permissions">),
    userType: userType || (rest as any).userType,
    supplierId: supplierId ? String(supplierId) : null,
    permissions: perms,
  };
}

function generatePassword(len = 12) {
  const chars =
    "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@$%^&*";
  let out = "";
  for (let i = 0; i < len; i++) out += chars.charAt(Math.floor(Math.random() * chars.length));
  return out;
}

function companyLabel(c: CompanyOption) {
  const display = String(c.displayName ?? "").trim();
  return display ? `${c.shortName} — ${display}` : c.shortName;
}

const overlayStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.45)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 50,
  padding: 16,
};

const modalStyle: React.CSSProperties = {
  width: "100%",
  maxWidth: 980,
  background: "#fff",
  borderRadius: 16,
  overflow: "hidden",
  boxShadow: "0 30px 80px rgba(15,23,42,0.25)",
  display: "flex",
  flexDirection: "column",
  maxHeight: "90vh",
};

const headerStyle: React.CSSProperties = {
  background: "#2563eb",
  color: "#fff",
  padding: "14px 18px",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
};

const headerLeftStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
};

const bodyStyle: React.CSSProperties = {
  padding: 18,
  overflowY: "auto",
};

const sectionTitleStyle: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 650,
  color: "#0f172a",
  marginBottom: 10,
};

const gridStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
  gap: 12,
};

const fieldLabelStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: "#64748b",
  marginBottom: 6,
};

const inputWrapStyle: React.CSSProperties = {
  position: "relative",
};

const iconStyle: React.CSSProperties = {
  position: "absolute",
  left: 10,
  top: "50%",
  transform: "translateY(-50%)",
  color: "#94a3b8",
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px 10px 10px 34px",
  borderRadius: 10,
  border: "1px solid #d1d5db",
  fontSize: 13,
  outline: "none",
};

const selectStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px 10px 10px 34px",
  borderRadius: 10,
  border: "1px solid #d1d5db",
  fontSize: 13,
  background: "#fff",
  outline: "none",
};

const footerStyle: React.CSSProperties = {
  borderTop: "1px solid #e5e7eb",
  background: "#f8fafc",
  padding: "12px 18px",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 10,
};

const btnStyle: React.CSSProperties = {
  borderRadius: 10,
  padding: "10px 14px",
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
  border: "1px solid transparent",
};

function pillStyle(active: boolean): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    padding: "6px 12px",
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 700,
    cursor: "pointer",
    background: active ? "#dcfce7" : "#fee2e2",
    color: active ? "#166534" : "#b91c1c",
    border: "1px solid rgba(15,23,42,0.06)",
  };
}

const errorBoxStyle: React.CSSProperties = {
  background: "#fef2f2",
  border: "1px solid #fecaca",
  color: "#991b1b",
  borderRadius: 12,
  padding: "10px 12px",
  fontSize: 12,
  marginBottom: 12,
};

const UserDetailsModal: React.FC<UserDetailsModalProps> = ({
                                                             user,
                                                             onClose,
                                                             companies = [],
                                                             availablePermissions,
                                                             onSave,
                                                             onDelete,
                                                             isSaving = false,
                                                             error = null,
                                                           }) => {
  const isNew = !user?.id || user.id === "new";

  const [formUser, setFormUser] = useState<FormUser>(() => normalizeToFormUser(user));
  const [originalUser, setOriginalUser] = useState<FormUser>(() => normalizeToFormUser(user));

  useEffect(() => {
    const next = normalizeToFormUser(user);
    setFormUser(next);
    setOriginalUser(next);
  }, [user]);

  const orderedCompanies = useMemo(() => {
    const list = Array.isArray(companies) ? companies.slice() : [];
    const norm = (v: any) => String(v || "").trim().toLowerCase();

    list.sort((a, b) => {
      const aKey = norm(a.shortName);
      const bKey = norm(b.shortName);

      const aIsRsl = aKey === "rsl";
      const bIsRsl = bKey === "rsl";
      if (aIsRsl && !bIsRsl) return -1;
      if (bIsRsl && !aIsRsl) return 1;

      const aIsOther = aKey === "other";
      const bIsOther = bKey === "other";
      if (aIsOther && !bIsOther) return 1;
      if (bIsOther && !aIsOther) return -1;

      return aKey.localeCompare(bKey);
    });

    return list;
  }, [companies]);

  const permissionDefs =
    availablePermissions && availablePermissions.length > 0
      ? availablePermissions
      : FALLBACK_PERMISSION_DEFS;

  const userTypeNormalized = normalizeUserType(formUser.userType);
  const supplierMode = isSupplierType(userTypeNormalized);

  const hasEmail = !!String(formUser.email || "").trim();
  const hasType = userTypeNormalized === "RSL Internal" || userTypeNormalized === "RSL Supplier";
  const hasName = !!String((formUser as any).name || "").trim();
  const hasCompany = supplierMode ? !!String(formUser.supplierId || "").trim() : true;

  const hasAnyPermission = useMemo(
    () => Object.values(formUser.permissions).some((value) => value === true),
    [formUser.permissions]
  );

  const createDisabled = !(hasEmail && hasType && hasName && hasCompany && hasAnyPermission);

  const isDirty = useMemo(() => {
    const keysToCompare: (keyof FormUser)[] = [
      "email",
      "userType",
      "isActive",
      "password",
      "name" as any,
      "supplierId" as any,
    ];

    const baseA: any = {};
    const baseB: any = {};

    keysToCompare.forEach((k) => {
      baseA[k] = (originalUser as any)[k];
      baseB[k] = (formUser as any)[k];
    });

    baseA.permissions = originalUser.permissions || {};
    baseB.permissions = formUser.permissions || {};

    return JSON.stringify(baseA) !== JSON.stringify(baseB);
  }, [originalUser, formUser]);

  const updateDisabled = !isDirty || createDisabled || isNew;

  const setUserType = (next: "RSL Internal" | "RSL Supplier" | "") => {
    setFormUser((prev) => {
      // if switching to internal, default company to RSL (if present)
      if (next === "RSL Internal") {
        const hasRsl = orderedCompanies.some(
          (c) => String(c.shortName).trim().toLowerCase() === "rsl"
        );
        const rslVal = hasRsl ? "RSL" : prev.supplierId ?? null;

        return {
          ...prev,
          userType: next,
          supplierId: rslVal,
          companyName: rslVal ?? (prev as any).companyName,
        } as any;
      }

      // switching to supplier – keep existing supplierId if any, otherwise blank
      if (next === "RSL Supplier") {
        return {
          ...prev,
          userType: next,
          supplierId: prev.supplierId ?? null,
        } as any;
      }

      return { ...prev, userType: next } as any;
    });
  };

  const handlePermissionToggle = (key: keyof PermissionMap, checked: boolean) => {
    setFormUser((prev) => ({
      ...prev,
      permissions: { ...prev.permissions, [key]: checked },
    }));
  };

  const handleSaveClick = () => {
    if (!onSave) return;
    onSave(isNew ? "create" : "update", formUser);
  };

  const handleDeleteClick = () => {
    if (!onDelete || isNew) return;

    const confirmed = window.confirm(
      "Are you sure you want to delete this user? This action cannot be undone."
    );
    if (!confirmed) return;

    onDelete(formUser);
  };

  const companyValue = String(formUser.supplierId || "");
  const companyDisabled = !supplierMode && !isNew; // internal users (edit) are locked

  return (
    <div style={overlayStyle} role="dialog" aria-modal="true">
      <div style={modalStyle}>
        <div style={headerStyle}>
          <div style={headerLeftStyle}>
            <UserIcon size={20} />
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <div style={{ fontSize: 14, fontWeight: 750 }}>
                {isNew ? "Create User" : "User Details"}
              </div>
              <div style={{ fontSize: 12, opacity: 0.9 }}>
                {isNew ? "Add a new user and assign permissions" : "Review and update user settings"}
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              ...btnStyle,
              padding: "8px 10px",
              background: "rgba(255,255,255,0.12)",
              color: "#fff",
            }}
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        <div style={bodyStyle}>
          {error ? <div style={errorBoxStyle}>{error}</div> : null}

          <section style={{ marginBottom: 18 }}>
            <div style={sectionTitleStyle}>Basic Information</div>

            <div style={gridStyle}>
              {/* Row 1: User Type (left) */}
              <div>
                <div style={fieldLabelStyle}>User Type</div>

                {isNew ? (
                  <div style={inputWrapStyle}>
                    <span style={iconStyle}>
                      <Shield size={16} />
                    </span>
                    <select
                      value={userTypeNormalized || ""}
                      onChange={(e) =>
                        setUserType(e.target.value as "RSL Internal" | "RSL Supplier" | "")
                      }
                      style={selectStyle}
                      disabled={isSaving}
                    >
                      <option value="">Select user type…</option>
                      <option value="RSL Internal">RSL Internal</option>
                      <option value="RSL Supplier">RSL Supplier</option>
                    </select>
                  </div>
                ) : (
                  <div style={inputWrapStyle}>
                    <span style={iconStyle}>
                      <Lock size={16} />
                    </span>
                    <input
                      value={userTypeNormalized || "RSL Internal"}
                      readOnly
                      style={{ ...inputStyle, background: "#f8fafc" }}
                    />
                  </div>
                )}
              </div>

              {/* Row 1: Email (right) */}
              <div>
                <div style={fieldLabelStyle}>Email</div>
                <div style={inputWrapStyle}>
                  <span style={iconStyle}>
                    <Mail size={16} />
                  </span>
                  <input
                    type="email"
                    value={String(formUser.email || "")}
                    onChange={(e) =>
                      setFormUser((prev) => ({ ...prev, email: e.target.value }))
                    }
                    style={inputStyle}
                    disabled={isSaving}
                  />
                </div>
              </div>

              {/* Row 2: Company (left) */}
              <div>
                <div style={fieldLabelStyle}>Company</div>
                <div style={inputWrapStyle}>
                  <span style={iconStyle}>
                    <Factory size={16} />
                  </span>
                  <select
                    value={companyValue}
                    onChange={(e) => {
                      const val = e.target.value || "";
                      setFormUser((prev) => ({
                        ...prev,
                        supplierId: val ? val : null,
                        companyName: val ? val : (prev as any).companyName,
                      }) as any);
                    }}
                    style={selectStyle}
                    disabled={isSaving || companyDisabled}
                  >
                    <option value="">{orderedCompanies.length ? "Select company…" : "No companies loaded"}</option>
                    {orderedCompanies.map((c) => (
                      <option key={c.shortName} value={c.shortName}>
                        {companyLabel(c)}
                      </option>
                    ))}
                  </select>
                </div>
                {!supplierMode && (
                  <div style={{ marginTop: 6, fontSize: 11, color: "#64748b" }}>
                    Company is fixed for internal users.
                  </div>
                )}
              </div>

              {/* Row 2: User Name (right) */}
              <div>
                <div style={fieldLabelStyle}>User Name</div>
                <div style={inputWrapStyle}>
                  <span style={iconStyle}>
                    <UserIcon size={16} />
                  </span>
                  <input
                    type="text"
                    value={String((formUser as any).name || "")}
                    onChange={(e) =>
                      setFormUser((prev) => ({ ...(prev as any), name: e.target.value }))
                    }
                    style={inputStyle}
                    disabled={isSaving}
                    placeholder="Display name"
                  />
                </div>
              </div>

              {/* Row 3: Password (left) */}
              <div>
                <div style={fieldLabelStyle}>Password</div>
                <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  <div style={{ ...inputWrapStyle, flex: 1 }}>
                    <span style={iconStyle}>
                      <Lock size={16} />
                    </span>
                    <input
                      type="text"
                      value={String(formUser.password || "")}
                      onChange={(e) =>
                        setFormUser((prev) => ({ ...prev, password: e.target.value }))
                      }
                      style={inputStyle}
                      disabled={isSaving}
                      placeholder={isNew ? "Set initial password" : "Leave blank to keep unchanged"}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      setFormUser((prev) => ({ ...prev, password: generatePassword() }))
                    }
                    disabled={isSaving}
                    style={{
                      ...btnStyle,
                      background: "#fff",
                      borderColor: "#d1d5db",
                      color: "#0f172a",
                      padding: "10px 12px",
                    }}
                  >
                    Generate
                  </button>
                </div>
              </div>

              {/* Row 3: Status (right) */}
              <div>
                <div style={fieldLabelStyle}>Status</div>
                <button
                  type="button"
                  onClick={() =>
                    setFormUser((prev) => ({
                      ...prev,
                      isActive: prev.isActive === false ? true : false,
                    }))
                  }
                  style={pillStyle(formUser.isActive !== false)}
                  disabled={isSaving}
                >
                  {formUser.isActive !== false ? "Active" : "Inactive"}
                </button>
              </div>
            </div>
          </section>

          <section>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <Shield size={18} color="#334155" />
              <div style={{ ...sectionTitleStyle, marginBottom: 0 }}>Permissions</div>
            </div>

            <div style={{ fontSize: 12, color: "#64748b", marginBottom: 10 }}>
              Select at least one permission to enable access for this user.
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                gap: 10,
              }}
            >
              {permissionDefs.map((perm) => {
                const key = perm.shortName as keyof PermissionMap;
                const checked = !!formUser.permissions[key];

                return (
                  <label
                    key={perm.shortName}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      padding: "10px 12px",
                      borderRadius: 12,
                      border: "1px solid #e5e7eb",
                      background: "#fff",
                      cursor: "pointer",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => handlePermissionToggle(key, e.target.checked)}
                      disabled={isSaving}
                      style={{ width: 16, height: 16 }}
                    />
                    <span style={{ fontSize: 13, color: "#0f172a" }}>
                      {perm.displayName}
                    </span>
                  </label>
                );
              })}
            </div>
          </section>
        </div>

        <div style={footerStyle}>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            {!isNew && onDelete ? (
              <button
                type="button"
                onClick={handleDeleteClick}
                disabled={isSaving}
                style={{
                  ...btnStyle,
                  background: "#fff",
                  borderColor: "#fecaca",
                  color: "#b91c1c",
                }}
              >
                Delete This User
              </button>
            ) : null}
          </div>

          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <button
              type="button"
              onClick={onClose}
              disabled={isSaving}
              style={{
                ...btnStyle,
                background: "#fff",
                borderColor: "#d1d5db",
                color: "#0f172a",
              }}
            >
              Close
            </button>

            <button
              type="button"
              onClick={handleSaveClick}
              disabled={isSaving || (isNew ? createDisabled : updateDisabled) || !onSave}
              style={{
                ...btnStyle,
                background:
                  isSaving || (isNew ? createDisabled : updateDisabled) || !onSave
                    ? "#93c5fd"
                    : "#2563eb",
                color: "#fff",
              }}
            >
              {isSaving ? "Saving…" : isNew ? "Create User" : "Update User"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default UserDetailsModal;
