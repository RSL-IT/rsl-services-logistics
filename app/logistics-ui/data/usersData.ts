// app/logistics-ui/data/usersData.ts

export type User = {
  id: number;
  email: string;
  isActive: boolean;
  userType: "internal" | "supplier";
  supplierId?: string | null;
};

export const mockUsers: User[] = [
  {
    id: 1,
    email: "itadmin@rslspeakers.com",
    isActive: true,
    userType: "internal",
    supplierId: null,
  },
  {
    id: 2,
    email: "supplier@vendor.com",
    isActive: true,
    userType: "supplier",
    supplierId: "VENDOR_001",
  },
  {
    id: 3,
    email: "inactive@rslspeakers.com",
    isActive: false,
    userType: "internal",
    supplierId: null,
  },
];
