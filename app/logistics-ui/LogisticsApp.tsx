// app/logistics-ui/LogisticsApp.tsx
import { useState } from "react";
import Login from "./components/Login";
import { SupplierView } from "./components/SupplierView";
import { InternalDashboard } from "./components/InternalDashboard";
import { UserManagement } from "./components/UserManagement";

import { mockShipments } from "./data/mockData";
import { mockUsers, type User } from "./data/usersData";
import type { Role } from "./components/types";

export type ViewType = "login" | "supplier" | "dashboard" | "users";

export type Product = {
  id: string;
  name: string;
  quantity: number;
  sku: string;
};

export type Shipment = {
  id: string;
  supplierId: string;
  supplierName: string;
  products: Product[];
  containerNumber: string;
  containerSize: string;
  portOfOrigin: string;
  destinationPort: string;
  cargoReadyDate: string;
  etd: string;
  actualDepartureDate: string;
  eta: string; // YYYY-MM-DD
  sealNumber: string;
  hblNumber: string;
  estimatedDeliveryDate: string;
  status: string;
};

export type CompanyOption = { shortName: string; displayName?: string | null };
export type LookupOption = { shortName: string; displayName?: string | null };

interface LogisticsAppProps {
  initialShipments: Shipment[];
  initialUsers: User[];

  initialCompanies?: CompanyOption[];
  initialContainers?: LookupOption[];
  initialOriginPorts?: LookupOption[];
  initialDestinationPorts?: LookupOption[];

  currentUser?: User | null;
}

export default function LogisticsApp({
                                       initialShipments,
                                       initialUsers,
                                       initialCompanies = [],
                                       initialContainers = [],
                                       initialOriginPorts = [],
                                       initialDestinationPorts = [],
                                       currentUser,
                                     }: LogisticsAppProps) {
  const [currentView, setCurrentView] = useState<ViewType>("login");
  const [supplierId, setSupplierId] = useState<string | null>(null);

  const [activeUser, setActiveUser] = useState<User | null>(currentUser ?? null);

  const [shipments, setShipments] = useState<Shipment[]>(
    initialShipments && initialShipments.length > 0 ? initialShipments : mockShipments
  );

  const [usersState, setUsersState] = useState<User[]>(
    initialUsers && initialUsers.length > 0 ? initialUsers : mockUsers
  );

  const handleLogin = (role: Role, user: User, supplierIdArg?: string | null) => {
    // IMPORTANT: resolve the “real” user from usersState so permissions exist
    const resolved =
      usersState.find(
        (u) => String(u.email || "").toLowerCase() === String(user.email || "").toLowerCase()
      ) ?? user;

    setActiveUser(resolved);

    const resolvedSupplierId =
      supplierIdArg ??
      (resolved as any)?.supplierId ??
      null;

    if (role === "supplier" && resolvedSupplierId) {
      setSupplierId(String(resolvedSupplierId));
      setCurrentView("supplier");
      return;
    }

    if (role === "internal") {
      setSupplierId(null);
      setCurrentView("dashboard");
      return;
    }

    setSupplierId(null);
    setCurrentView("login");
  };

  const handleLogout = () => {
    setActiveUser(null);
    setSupplierId(null);
    setCurrentView("login");
  };

  const handleNavigateToUsers = () => setCurrentView("users");
  const handleBackToDashboard = () => setCurrentView("dashboard");

  if (currentView === "login") {
    return <Login onLogin={handleLogin} users={usersState} />;
  }

  if (currentView === "supplier" && supplierId) {
    return <SupplierView supplierId={supplierId} shipments={shipments} onLogout={handleLogout} />;
  }

  if (currentView === "users") {
    return (
      <UserManagement
        users={usersState}
        companies={initialCompanies}
        onUsersChange={setUsersState}
        onBack={handleBackToDashboard}
        onLogout={handleLogout}
      />
    );
  }

  if (!activeUser) {
    return <Login onLogin={handleLogin} users={usersState} />;
  }

  return (
    <InternalDashboard
      currentUser={activeUser}
      shipments={shipments}
      companies={initialCompanies}
      containers={initialContainers}
      originPorts={initialOriginPorts}
      destinationPorts={initialDestinationPorts}
      onShipmentsChange={setShipments}
      onLogout={handleLogout}
      onNavigateToUsers={handleNavigateToUsers}
    />
  );
}
