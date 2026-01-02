// app/logistics-ui/components/types.ts
// Shared types for the Logistics UI.
// These bridge the React components with the DB-backed endpoints.

export type Role = "internal" | "supplier";

// Permission flags for user capabilities
export type UIPermissions = {
  viewUserManagement?: boolean;
  createEditUser?: boolean;
  modifyShipper?: boolean;
  viewDashboard?: boolean;
  editDashboard?: boolean;
  viewShipment?: boolean;
  createUpdateShipment?: boolean;
};

// Full user model used throughout the UI
export type UIUser = {
  id: number | string;
  email: string;

  // Optional user-friendly name
  name?: string | null;

  // Used by the app's login/router
  role?: Role | null;

  // Display label used throughout the UI (e.g. "RSL Internal", "RSL Supplier")
  userType?: string | null;

  // Supplier/company reference when role/userType indicates supplier
  supplierId?: string | null;

  // Activation + auth
  isActive?: boolean;
  password?: string | null;

  // UI permissions toggles
  permissions?: UIPermissions;
};

// Alias for backward compatibility
export type User = UIUser;

// Lookup option for dropdowns (containers, ports, booking agents, etc.)
export type LookupOption = {
  shortName: string;
  displayName: string;
};

// Company option (suppliers)
export type CompanyOption = {
  shortName: string;
  displayName: string;
};

// Product associated with a purchase order
export type PurchaseOrderProduct = {
  rslModelID: string;
  shortName?: string;
  displayName?: string;
  SKU?: string | null;
  quantity?: number;
};

// Purchase order option for shipment PO selection
export type PurchaseOrderOption = {
  purchaseOrderGID: string;
  shortName: string;
  // Products associated with this purchase order
  products?: PurchaseOrderProduct[];
  // URL to the PDF for this purchase order (if available)
  purchaseOrderPdfUrl?: string | null;
  // Company/supplier associated with this purchase order
  companyID?: string | null;
};

export type OnLogin = (role: Role, user: UIUser, supplierId?: string | null) => void;

export interface LoginProps {
  onLogin: OnLogin;
  users: UIUser[];
  initialError?: string | null;
}
