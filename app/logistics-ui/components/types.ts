// app/logistics-ui/components/types.ts
// Shared types for the Logistics UI login flow.
// These bridge the React components with the DB-backed login endpoint.

import type { User as BaseUser } from "../data/usersData";

// Core user model used by the UI.
// We extend the static BaseUser with an optional supplierId
// that comes back from the login API.
export type User = BaseUser & {
  supplierId?: string | null;
};

export type Role = "internal" | "supplier";

export type OnLogin = (role: Role, user: User, supplierId?: string | null) => void;

export interface LoginProps {
  onLogin: OnLogin;
  users: User[];
  initialError?: string;
}
