// app/logistics-ui/components/UserManagement.tsx
import React, { useMemo, useState } from "react";
import { Search, Plus, ChevronLeft, Shield, Factory, Eye } from "lucide-react";

import type { User as BaseUser } from "../data/usersData";
import UserDetailsModal from "./UserDetailsModal";

export type UIUser = import("./types").User;

export type CompanyOption = {
  shortName: string;
  displayName?: string | null;
};

interface UserManagementProps {
  users: UIUser[];
  companies: CompanyOption[];
  onUsersChange: (nextUsers: UIUser[]) => void;
  onBack: () => void;
  onLogout: () => void;
}

type FilterOption = "all" | "internal" | "supplier" | "active" | "inactive";

// --- Simple style helpers ----------------------------------------------------

const pageStyle: React.CSSProperties = {
  minHeight: "100vh",
  backgroundColor: "#f5f7fb",
  fontFamily:
    'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  color: "#111827",
};

const headerOuterStyle: React.CSSProperties = {
  backgroundColor: "#ffffff",
  borderBottom: "1px solid #e5e7eb",
};

const headerInnerStyle: React.CSSProperties = {
  maxWidth: 1120,
  margin: "0 auto",
  padding: "12px 24px",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
};

const headerLeftStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 12,
};

const backButtonStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  padding: "6px 10px",
  borderRadius: 999,
  border: "1px solid transparent",
  background: "none",
  cursor: "pointer",
  color: "#4b5563",
};

const logoutButtonStyle: React.CSSProperties = {
  fontSize: 13,
  color: "#6b7280",
  background: "none",
  border: "none",
  cursor: "pointer",
};

const mainStyle: React.CSSProperties = {
  maxWidth: 1120,
  margin: "0 auto",
  padding: "20px 16px 32px",
};

const controlsRowStyle: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 12,
  alignItems: "center",
  justifyContent: "space-between",
  marginBottom: 16,
};

const searchContainerStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 220,
  display: "flex",
  gap: 8,
};

const searchWrapperStyle: React.CSSProperties = {
  position: "relative",
  flex: 1,
};

const searchInputStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px 10px 8px 30px",
  borderRadius: 6,
  border: "1px solid #d1d5db",
  fontSize: 13,
};

const selectStyle: React.CSSProperties = {
  minWidth: 150,
  padding: "8px 10px",
  borderRadius: 6,
  border: "1px solid #d1d5db",
  fontSize: 13,
  backgroundColor: "#ffffff",
};

const createButtonStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 8,
  padding: "8px 14px",
  borderRadius: 8,
  border: "none",
  backgroundColor: "#2563eb",
  color: "#ffffff",
  fontSize: 13,
  fontWeight: 500,
  cursor: "pointer",
  boxShadow: "0 10px 15px -3px rgba(37,99,235,0.25)",
};

const tableCardStyle: React.CSSProperties = {
  backgroundColor: "#ffffff",
  borderRadius: 10,
  border: "1px solid #e5e7eb",
  boxShadow: "0 10px 30px rgba(15,23,42,0.06)",
  overflow: "hidden",
};

const tableStyle: React.CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  fontSize: 13,
};

const thStyle: React.CSSProperties = {
  textAlign: "left",
  padding: "10px 16px",
  fontWeight: 500,
  color: "#6b7280",
  backgroundColor: "#f9fafb",
  borderBottom: "1px solid #e5e7eb",
};

const tdStyle: React.CSSProperties = {
  padding: "10px 16px",
  borderBottom: "1px solid #f3f4f6",
  verticalAlign: "middle",
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

const statsRowStyle: React.CSSProperties = {
  marginTop: 18,
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
  gap: 12,
};

const statCardStyle: React.CSSProperties = {
  backgroundColor: "#ffffff",
  borderRadius: 10,
  border: "1px solid #e5e7eb",
  padding: "10px 14px",
  fontSize: 12,
};

const statLabelStyle: React.CSSProperties = {
  color: "#6b7280",
  marginBottom: 4,
};

const statValueStyle: React.CSSProperties = {
  fontSize: 18,
  fontWeight: 600,
  color: "#111827",
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
  if (!companyId) return "—";
  const found = companies.find((c) => c.shortName === companyId);
  if (!found) return companyId;
  const display = String(found.displayName || "").trim();
  return display ? `${found.shortName} — ${display}` : found.shortName;
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
                               }: UserManagementProps) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<FilterOption>("all");
  const [selectedUser, setSelectedUser] = useState<UIUser | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);

  // IMPORTANT: use this instead of an unused `busy` var
  const [isSaving, setIsSaving] = useState(false);

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

  const stats = useMemo(() => {
    const total = users.length;
    const active = users.filter((u) => u.isActive !== false).length;
    const internal = users.filter((u) => isInternal(u)).length;
    const supplier = users.filter((u) => isSupplier(u)).length;
    return { total, active, internal, supplier };
  }, [users]);

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

  return (
    <div style={pageStyle}>
      <header style={headerOuterStyle}>
        <div style={headerInnerStyle}>
          <div style={headerLeftStyle}>
            <button type="button" onClick={onBack} style={backButtonStyle}>
              <ChevronLeft size={16} />
              <span style={{ fontSize: 13 }}>Back to dashboard</span>
            </button>
            <div style={{ width: 1, height: 24, backgroundColor: "#e5e7eb" }} />
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 2 }}>
                User Management
              </div>
              <div style={{ fontSize: 12, color: "#6b7280" }}>
                Manage system users and their permissions
              </div>
            </div>
          </div>
          <button type="button" onClick={onLogout} style={logoutButtonStyle}>
            Log out
          </button>
        </div>
      </header>

      <main style={mainStyle}>
        <div style={controlsRowStyle}>
          <div style={searchContainerStyle}>
            <div style={searchWrapperStyle}>
              <Search
                size={16}
                style={{
                  position: "absolute",
                  left: 8,
                  top: "50%",
                  transform: "translateY(-50%)",
                  color: "#9ca3af",
                }}
              />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by name, email, company…"
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
          </div>

          <button
            type="button"
            onClick={handleCreateClick}
            style={createButtonStyle}
            disabled={isSaving}
          >
            <Plus size={16} />
            <span>Create user</span>
          </button>
        </div>

        <div style={tableCardStyle}>
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

        <div style={statsRowStyle}>
          <div style={statCardStyle}>
            <div style={statLabelStyle}>Total Users</div>
            <div style={statValueStyle}>{stats.total}</div>
          </div>
          <div style={statCardStyle}>
            <div style={statLabelStyle}>Active Users</div>
            <div style={statValueStyle}>{stats.active}</div>
          </div>
          <div style={statCardStyle}>
            <div style={statLabelStyle}>RSL Internal</div>
            <div style={statValueStyle}>{stats.internal}</div>
          </div>
          <div style={statCardStyle}>
            <div style={statLabelStyle}>RSL Supplier</div>
            <div style={statValueStyle}>{stats.supplier}</div>
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
