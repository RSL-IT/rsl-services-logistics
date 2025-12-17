// app/logistics-ui/components/types.ts
// Canonical shared types for the Logistics UI (Login + UserManagement + Dashboard)

import type { User as BaseUser } from "../data/usersData";

// Role returned by the login endpoint
export type Role = "internal" | "supplier";

// Permissions shape comes from the existing mock user model
export type Permissions = BaseUser["permissions"];

// Canonical User shape for the UI.
// Extends the mock/Base user model with optional DB-driven fields.
export type User = BaseUser & {
  // For DB users we compute/return these.
  role?: Role;

  // Supplier company identifier (alpha-numeric shortName, e.g. "RSL")
  supplierId?: string | null;

  // Convenience: display name (DB displayName or email fallback)
  name?: string;
};

export interface LoginProps {
  onLogin: (role: Role, user: User, supplierId?: string | null) => void;
  users: User[];
  initialError?: string | null;
}
