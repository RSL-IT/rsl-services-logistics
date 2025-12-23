// app/logistics-ui/LogisticsApp.tsx
import { useState } from "react";
import Login from "./components/Login";
import { SupplierView } from "./components/SupplierView";
import { InternalDashboard } from "./components/InternalDashboard";
import { UserManagement } from "./components/UserManagement";
import { PurchaseOrderManagement } from "./components/PurchaseOrderManagement";

import { mockShipments } from "./data/mockData";
import { mockUsers, type User } from "./data/usersData";
import type { Role } from "./components/types";
import type { UIPurchaseOrder } from "./components/PurchaseOrderDetailsModal";

// ---- Shared lookup types ----
export type LookupOption = {
  shortName: string;
  displayName?: string | null;
};

export type CompanyOption = {
  shortName: string;
  displayName?: string | null;

  // optional company fields if your loader provides them
  address1?: string | null;
  address2?: string | null;
  city?: string | null;
  province?: string | null;
  postalCode?: string | null;
  country?: string | null;
  primaryContact?: string | null;
  primaryPhone?: string | null;
  primaryEmail?: string | null;
};

// type imported from original App.tsx (same shape as mockShipments)
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

  cargoReadyDate: string; // YYYY-MM-DD
  etd: string; // YYYY-MM-DD
  actualDepartureDate: string;
  eta: string; // YYYY-MM-DD

  sealNumber: string;
  hblNumber: string;
  estimatedDeliveryDate: string;

  status: string;

  // New fields requested
  estimatedDeliveryToOrigin?: string; // YYYY-MM-DD
  supplierPi?: string;
  quantity?: number | null; // INT, allow null
  bookingAgent?: string; // shortName (lookup)
  bookingNumber?: string;
  vesselName?: string;
  deliveryAddress?: string; // shortName (lookup)
  notes?: string;

  // Multi-select Purchase Orders
  purchaseOrderGIDs?: string[];
};

export type ViewType = "login" | "supplier" | "dashboard" | "users" | "purchaseOrders";

interface LogisticsAppProps {
  initialShipments: Shipment[]; // DB-backed or mocks, same shape
  initialUsers: User[];

  // Lookups (DB-backed)
  companies: CompanyOption[];
  containers: LookupOption[];
  originPorts: LookupOption[];
  destinationPorts: LookupOption[];
  bookingAgents: LookupOption[];
  deliveryAddresses: LookupOption[];

  // Purchase Orders (DB-backed)
  purchaseOrders: UIPurchaseOrder[];

  currentUser?: User | null; // optional user from logistics DB
}

export default function LogisticsApp({
                                       initialShipments,
                                       initialUsers,
                                       companies,
                                       containers,
                                       originPorts,
                                       destinationPorts,
                                       bookingAgents,
                                       deliveryAddresses,
                                       purchaseOrders,
                                       currentUser,
                                     }: LogisticsAppProps) {
  const [currentView, setCurrentView] = useState<ViewType>("login");
  const [supplierId, setSupplierId] = useState<string | null>(null);

  const [activeUser, setActiveUser] = useState<User | null>(currentUser ?? null);

  const [shipments, setShipments] = useState<Shipment[]>(
    initialShipments && initialShipments.length > 0 ? initialShipments : (mockShipments as any)
  );

  const [usersState, setUsersState] = useState<User[]>(
    initialUsers && initialUsers.length > 0 ? initialUsers : mockUsers
  );

  const [purchaseOrdersState, setPurchaseOrdersState] = useState<UIPurchaseOrder[]>(
    Array.isArray(purchaseOrders) ? purchaseOrders : []
  );

  // Must match LoginProps.onLogin signature exactly
  const handleLogin = (role: Role, user: User, supplierIdArg?: string | null) => {
    setActiveUser(user);

    if (role === "supplier" && supplierIdArg) {
      setSupplierId(supplierIdArg);
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
  const handleNavigateToPurchaseOrders = () => setCurrentView("purchaseOrders");
  const handleBackToDashboard = () => setCurrentView("dashboard");

  // ---- Views ----

  if (currentView === "login") {
    return <Login onLogin={handleLogin} users={usersState} />;
  }

  if (currentView === "supplier" && supplierId) {
    return <SupplierView supplierId={supplierId} shipments={shipments as any} onLogout={handleLogout} />;
  }

  if (currentView === "users") {
    return (
      <UserManagement
        users={usersState}
        onUsersChange={setUsersState as any}
        onBack={handleBackToDashboard}
        onLogout={handleLogout}
        companies={companies as any}
      />
    );
  }

  if (currentView === "purchaseOrders") {
    return (
      <PurchaseOrderManagement
        purchaseOrders={purchaseOrdersState}
        onPurchaseOrdersChange={setPurchaseOrdersState}
        companies={companies as any}
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
      companies={companies}
      containers={containers}
      originPorts={originPorts}
      destinationPorts={destinationPorts}
      bookingAgents={bookingAgents}
      deliveryAddresses={deliveryAddresses}
      purchaseOrders={purchaseOrdersState as any}
      onShipmentsChange={setShipments}
      onLogout={handleLogout}
      onNavigateToUsers={handleNavigateToUsers}
      onNavigateToPurchaseOrders={handleNavigateToPurchaseOrders}
    />
  );
}
