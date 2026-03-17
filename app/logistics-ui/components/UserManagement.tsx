// app/logistics-ui/components/UserManagement.tsx
import React, { useMemo, useState } from "react";
import { Search, Shield, Factory, Eye } from "lucide-react";

import UserDetailsModal from "./UserDetailsModal";
import type { Role, UIUser, UIPermissions, CompanyOption } from "./types";

interface UserManagementProps {
  users: UIUser[];
  companies: CompanyOption[];
  onUsersChange: (nextUsers: UIUser[]) => void;
  onBack: () => void;
  onLogout: () => void;
  showLogout?: boolean;
  currentUser?: UIUser | null;
  debugInfo?: any;
  canShowDebug?: boolean;
  showDebug?: boolean;
  onToggleDebug?: () => void;
  onRunApiProbe?: () => void | Promise<void>;
  isApiProbeRunning?: boolean;
}

type FilterOption = "all" | "internal" | "supplier" | "active" | "inactive";

// --- Simple style helpers ----------------------------------------------------

const pageStyle: React.CSSProperties = {
  minHeight: "100vh",
  backgroundColor: "#f8fafc",
  fontFamily:
    'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  color: "#111827",
  padding: 18,
};

const headerStyle: React.CSSProperties = {
  background: "#1e40af",
  color: "#fff",
  borderRadius: 14,
  padding: "14px 16px",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  boxShadow: "0 12px 30px rgba(15,23,42,0.15)",
  marginBottom: 14,
};

const headerTitleStyle: React.CSSProperties = {
  fontSize: 18,
  fontWeight: 800,
  letterSpacing: 0.2,
};

const headerSubStyle: React.CSSProperties = {
  fontSize: 12,
  opacity: 0.92,
  marginTop: 2,
};

const headerRightStyle: React.CSSProperties = {
  display: "flex",
  gap: 10,
  alignItems: "center",
};

const btnBase: React.CSSProperties = {
  borderRadius: 10,
  padding: "10px 12px",
  fontSize: 13,
  fontWeight: 700,
  border: "1px solid transparent",
  cursor: "pointer",
  lineHeight: 1,
};

const btnPrimary: React.CSSProperties = {
  ...btnBase,
  background: "#2563eb",
  color: "#fff",
};

const btnDanger: React.CSSProperties = {
  ...btnBase,
  background: "#dc2626",
  color: "#fff",
};

const btnSuccess: React.CSSProperties = {
  ...btnBase,
  background: "#16a34a",
  color: "#fff",
};

const btnDisabled: React.CSSProperties = {
  ...btnBase,
  background: "#cbd5e1",
  color: "#475569",
  cursor: "not-allowed",
};

const mainStyle: React.CSSProperties = {
  paddingBottom: 32,
};

const cardStyle: React.CSSProperties = {
  background: "#fff",
  border: "1px solid #e5e7eb",
  borderRadius: 14,
  boxShadow: "0 10px 24px rgba(15,23,42,0.06)",
  padding: 14,
  marginBottom: 14,
};

const controlsRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 12,
  flexWrap: "wrap",
};

const searchWrapStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  border: "1px solid #e2e8f0",
  borderRadius: 10,
  overflow: "hidden",
  background: "#fff",
};

const iconBoxStyle: React.CSSProperties = {
  padding: "9px 10px",
  borderRight: "1px solid #e2e8f0",
  color: "#64748b",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};

const searchInputStyle: React.CSSProperties = {
  border: "none",
  outline: "none",
  padding: "9px 12px",
  fontSize: 13,
  width: 260,
};

const selectStyle: React.CSSProperties = {
  minWidth: 180,
  padding: "9px 12px",
  borderRadius: 10,
  border: "1px solid #e2e8f0",
  fontSize: 13,
  backgroundColor: "#ffffff",
};

const tableWrapStyle: React.CSSProperties = {
  border: "1px solid #e5e7eb",
  borderRadius: 12,
  overflow: "hidden",
  background: "#fff",
};

const tableStyle: React.CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  fontSize: 13,
};

const thStyle: React.CSSProperties = {
  textAlign: "left",
  padding: "12px 12px",
  fontWeight: 800,
  color: "#475569",
  background: "#f1f5f9",
  borderBottom: "1px solid #e5e7eb",
};

const tdStyle: React.CSSProperties = {
  padding: "12px 12px",
  borderBottom: "1px solid #eef2f7",
  verticalAlign: "middle",
  color: "#0f172a",
};

const statusPillBase: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  padding: "4px 10px",
  borderRadius: 999,
  fontSize: 11,
  fontWeight: 500,
};

const linkButtonStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
  fontSize: 12,
  color: "#2563eb",
  background: "none",
  border: "none",
  cursor: "pointer",
};


// --- helpers ------------------------------------------------------------------

function roleLabel(user: UIUser): string {
  const ut = String((user as any).userType || "");
  if (user.role === "internal" || ut === "RSL Internal") return "RSL Internal";
  if (user.role === "supplier" || ut === "RSL Supplier") return "RSL Supplier";
  return ut || "Unknown";
}

function isInternal(user: UIUser): boolean {
  const ut = String((user as any).userType || "");
  return user.role === "internal" || ut === "RSL Internal" || (!user.role && !ut);
}

function isSupplier(user: UIUser): boolean {
  const ut = String((user as any).userType || "");
  return user.role === "supplier" || ut === "RSL Supplier";
}

function companyLabel(companyId: string | null | undefined, companies: CompanyOption[]) {
  if (!companyId) return "RSL";
  const found = companies.find((c) => c.shortName === companyId);
  if (!found) return companyId;
  const display = String(found.displayName || "").trim();
  return display ? `${found.shortName} - ${display}` : found.shortName;
}

async function postUsersEndpoint(payload: any) {
  const res = await fetch("/apps/logistics/users", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  return res.json();
}

// -----------------------------------------------------------------------------
// Component (named export + default)
// -----------------------------------------------------------------------------

export function UserManagement({
                                 users,
                                 companies,
                                 onUsersChange,
                                 onBack,
                                 onLogout,
                                 showLogout = true,
                                 currentUser = null,
                                 debugInfo = null,
                                 canShowDebug = false,
                                 showDebug = false,
                                 onToggleDebug,
                                 onRunApiProbe,
                                 isApiProbeRunning = false,
                               }: UserManagementProps) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<FilterOption>("all");
  const [selectedUser, setSelectedUser] = useState<UIUser | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);

  const [isSaving, setIsSaving] = useState(false);
  const [isLoggingStaffMembers, setIsLoggingStaffMembers] = useState(false);

  const filteredUsers = useMemo(() => {
    const term = search.trim().toLowerCase();

    return (users || []).filter((user) => {
      const matchesSearch =
        !term ||
        (user.name && user.name.toLowerCase().includes(term)) ||
        (user.email && user.email.toLowerCase().includes(term)) ||
        (user.supplierId && user.supplierId.toLowerCase().includes(term));

      const matchesFilter =
        filter === "all"
          ? true
          : filter === "internal"
            ? isInternal(user)
            : filter === "supplier"
              ? isSupplier(user)
              : filter === "active"
                ? user.isActive !== false
                : user.isActive === false;

      return matchesSearch && matchesFilter;
    });
  }, [users, search, filter]);

  const openDetails = (user: UIUser) => {
    setModalError(null);
    setSelectedUser(user);
    setShowDetails(true);
  };

  const handleCreateClick = () => {
    const blankUser: UIUser = {
      id: "new",
      email: "",
      password: "",
      userType: "RSL Internal",
      isActive: true,
      permissions: {
        viewUserManagement: false,
        createEditUser: false,
        modifyShipper: false,
        editDashboard: false,
        viewDashboard: false,
        viewShipment: false,
        createUpdateShipment: false,
      },
      name: "",
      role: "internal",
      supplierId: null,
    };

    openDetails(blankUser);
  };

  const closeModal = () => {
    setShowDetails(false);
    setSelectedUser(null);
    setModalError(null);
  };

  const handleSave = async (mode: "create" | "update", userToSave: UIUser) => {
    try {
      setIsSaving(true);
      setModalError(null);

      const data = await postUsersEndpoint({ intent: mode, user: userToSave });

      if (!data || data.success !== true) {
        setModalError(data?.error || "Unable to save user.");
        return;
      }

      const saved = data.user as UIUser;

      if (mode === "create") {
        onUsersChange([...users, saved]);
      } else {
        onUsersChange(users.map((u) => (u.id === saved.id ? saved : u)));
      }

      closeModal();
    } catch (e: any) {
      setModalError(e?.message || "Unable to save user.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (userToDelete: UIUser) => {
    try {
      setIsSaving(true);
      setModalError(null);

      const data = await postUsersEndpoint({ intent: "delete", user: userToDelete });

      if (!data || data.success !== true) {
        setModalError(data?.error || "Unable to delete user.");
        return;
      }

      const deletedId = String(data.deletedId || userToDelete.id);
      onUsersChange(users.filter((u) => String(u.id) !== deletedId));

      closeModal();
    } catch (e: any) {
      setModalError(e?.message || "Unable to delete user.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleLogStaffMembers = async () => {
    try {
      setIsLoggingStaffMembers(true);
      setModalError(null);

      const data = await postUsersEndpoint({
        intent: "debug_log_staffmembers",
        first: 100,
        shop: String(debugInfo?.shop || "").trim(),
        debugEnabled: showDebug,
      });

      if (!data || data.success !== true) {
        setModalError(data?.error || "Unable to log staff members.");
      }
    } catch (e: any) {
      setModalError(e?.message || "Unable to log staff members.");
    } finally {
      setIsLoggingStaffMembers(false);
    }
  };

  return (
    <div style={pageStyle}>
      <div style={headerStyle}>
        <div>
          <div style={headerTitleStyle}>RSL Logistics Manage Users</div>
          <div style={headerSubStyle}>
            Logged in as <b>{String((currentUser as any)?.name || currentUser?.email || "User")}</b>
          </div>
        </div>
        <div style={headerRightStyle}>
          {canShowDebug ? (
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
                <input
                  type="checkbox"
                  checked={showDebug}
                  onChange={() => onToggleDebug?.()}
                />
                Show Debug
              </label>
              <button
                type="button"
                onClick={() => void onRunApiProbe?.()}
                disabled={isApiProbeRunning}
                style={isApiProbeRunning ? btnDisabled : btnPrimary}
              >
                {isApiProbeRunning ? "Running Probe..." : "Run API Probe"}
              </button>
              {showDebug ? (
                <button
                  type="button"
                  onClick={() => void handleLogStaffMembers()}
                  disabled={isLoggingStaffMembers}
                  style={isLoggingStaffMembers ? btnDisabled : btnPrimary}
                >
                  {isLoggingStaffMembers ? "Logging Staff..." : "Log Staff JSON (100)"}
                </button>
              ) : null}
            </div>
          ) : null}

          <button type="button" onClick={onBack} disabled={isSaving} style={btnPrimary}>
            Back
          </button>
          {showLogout ? (
            <button type="button" onClick={onLogout} disabled={isSaving} style={btnDanger}>
              Log out
            </button>
          ) : null}
        </div>
      </div>

      {debugInfo && showDebug ? (
        <div
          style={{
            marginBottom: 14,
            background: "#fef3c7",
            border: "1px solid #fcd34d",
            borderRadius: 12,
            padding: 12,
            color: "#7c2d12",
            fontSize: 12,
            whiteSpace: "pre-wrap",
          }}
        >
          {JSON.stringify(debugInfo, null, 2)}
        </div>
      ) : null}

      <main style={mainStyle}>
        <div style={cardStyle}>
          <div style={controlsRowStyle}>
            <div style={searchWrapStyle}>
              <span style={iconBoxStyle}>
                <Search size={16} />
              </span>
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by name, email, company..."
                style={searchInputStyle}
              />
            </div>

            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value as FilterOption)}
              style={selectStyle}
            >
              <option value="all">All users</option>
              <option value="internal">RSL internal</option>
              <option value="supplier">Suppliers</option>
              <option value="active">Active only</option>
              <option value="inactive">Inactive only</option>
            </select>

            <div style={{ flex: 1 }} />

            <button
              type="button"
              onClick={handleCreateClick}
              style={isSaving ? btnDisabled : btnSuccess}
              disabled={isSaving}
            >
              Create user
            </button>
          </div>

          <div style={{ marginTop: 14 }}>
            <div style={tableWrapStyle}>
              <table style={tableStyle}>
                <thead>
                <tr>
                  <th style={thStyle}>Name</th>
                  <th style={thStyle}>Email</th>
                  <th style={thStyle}>Role</th>
                  <th style={thStyle}>Company</th>
                  <th style={thStyle}>Status</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>Actions</th>
                </tr>
                </thead>
                <tbody>
                {filteredUsers.length === 0 ? (
                  <tr>
                    <td
                      colSpan={6}
                      style={{
                        ...tdStyle,
                        textAlign: "center",
                        padding: "24px 16px",
                        color: "#6b7280",
                      }}
                    >
                      No users found.
                    </td>
                  </tr>
                ) : (
                  filteredUsers.map((user) => (
                    <tr
                      key={user.id}
                      style={{ cursor: "pointer" }}
                      onClick={() => openDetails(user)}
                    >
                      <td style={tdStyle}>{user.name || user.email}</td>
                      <td style={tdStyle}>{user.email}</td>
                      <td style={tdStyle}>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                          <Shield size={14} color="#9ca3af" />
                          <span>{roleLabel(user)}</span>
                        </span>
                      </td>
                      <td style={tdStyle}>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                          <Factory size={14} color="#9ca3af" />
                          <span>{companyLabel(user.supplierId, companies)}</span>
                        </span>
                      </td>
                      <td style={tdStyle}>
                        <span
                          style={{
                            ...statusPillBase,
                            backgroundColor: user.isActive !== false ? "#dcfce7" : "#fee2e2",
                            color: user.isActive !== false ? "#166534" : "#b91c1c",
                          }}
                        >
                          {user.isActive !== false ? "Active" : "Inactive"}
                        </span>
                      </td>
                      <td style={{ ...tdStyle, textAlign: "right" }}>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            openDetails(user);
                          }}
                          style={linkButtonStyle}
                        >
                          <Eye size={14} />
                          <span>View</span>
                        </button>
                      </td>
                    </tr>
                  ))
                )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

      </main>

      {showDetails && selectedUser && (
        <UserDetailsModal
          user={selectedUser}
          companies={companies}
          isSaving={isSaving}
          error={modalError}
          onClose={closeModal}
          onSave={handleSave}
          onDelete={handleDelete}
        />
      )}
    </div>
  );
}

export default UserManagement;
