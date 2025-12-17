// app/logistics-ui/components/CreateEditUserModal.tsx
import React from "react";
import UserDetailsModal, { type CompanyOption, type PermissionOption } from "./UserDetailsModal";
import type { UIUser } from "./UserManagement";

interface CreateEditUserModalProps {
  user?: UIUser;
  companies?: CompanyOption[];
  availablePermissions?: PermissionOption[];

  isSaving?: boolean;
  error?: string | null;

  onSave: (mode: "create" | "update", user: UIUser) => void;
  onDelete?: (user: UIUser) => void;
  onClose: () => void;
}

function makeBlankUser(): UIUser {
  return {
    id: "new",
    email: "",
    password: "",
    userType: "RSL Internal",
    isActive: true,
    name: "",
    role: "internal",
    supplierId: "RSL",
    permissions: {
      viewUserManagement: false,
      createEditUser: false,
      modifyShipper: false,
      editDashboard: false,
      viewDashboard: false,
      viewShipment: false,
      createUpdateShipment: false,
    },
  };
}

export function CreateEditUserModal({
                                      user,
                                      companies,
                                      availablePermissions,
                                      isSaving,
                                      error,
                                      onSave,
                                      onDelete,
                                      onClose,
                                    }: CreateEditUserModalProps) {
  return (
    <UserDetailsModal
      user={user ?? makeBlankUser()}
      companies={companies}
      availablePermissions={availablePermissions}
      isSaving={isSaving}
      error={error}
      onSave={onSave}
      onDelete={onDelete}
      onClose={onClose}
    />
  );
}

export default CreateEditUserModal;
