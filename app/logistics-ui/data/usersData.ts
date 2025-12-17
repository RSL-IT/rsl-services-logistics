export interface Contact {
  name: string;
  email: string;
  phone: string;
}

export interface User {
  id: string;
  email: string;
  password?: string;
  userType: 'RSL Internal' | 'RSL Supplier';
  isActive: boolean;
  permissions: {
    viewUserManagement: boolean;
    createEditUser: boolean;
    modifyShipper: boolean;
    editDashboard: boolean;
    viewDashboard: boolean;
    viewShipment: boolean;
    createUpdateShipment: boolean;
  };
  // Supplier-specific fields
  companyName?: string;
  companyAddress?: string;
  primaryContact?: Contact;
  secondaryContact?: Contact;
  assignedPointsOfOrigin?: string[];
  assignedProducts?: string[];
}

export const mockUsers: User[] = [
  {
    id: 'USR001',
    email: 'admin@rsl.com',
    password: 'password',
    userType: 'RSL Internal',
    isActive: true,
    permissions: {
      viewUserManagement: true,
      createEditUser: true,
      modifyShipper: true,
      editDashboard: true,
      viewDashboard: true,
      viewShipment: true,
      createUpdateShipment: true,
    },
  },
  {
    id: 'USR002',
    email: 'internal',
    password: 'password',
    userType: 'RSL Internal',
    isActive: true,
    permissions: {
      viewUserManagement: false,
      createEditUser: false,
      modifyShipper: false,
      editDashboard: false,
      viewDashboard: true,
      viewShipment: true,
      createUpdateShipment: false,
    },
  },
  {
    id: 'SUP001',
    email: 'supplier1',
    password: 'password',
    userType: 'RSL Supplier',
    isActive: true,
    permissions: {
      viewUserManagement: false,
      createEditUser: false,
      modifyShipper: false,
      editDashboard: false,
      viewDashboard: false,
      viewShipment: true,
      createUpdateShipment: true,
    },
    companyName: 'Global Electronics Ltd.',
    companyAddress: '123 Industrial Road, Shenzhen, Guangdong, China 518000',
    primaryContact: {
      name: 'Wei Zhang',
      email: 'wei.zhang@globalelectronics.com',
      phone: '+86 755 1234 5678',
    },
    secondaryContact: {
      name: 'Li Chen',
      email: 'li.chen@globalelectronics.com',
      phone: '+86 755 1234 5679',
    },
    assignedPointsOfOrigin: ['Shanghai', 'Ningbo', 'Yantian'],
    assignedProducts: ['10E Black', '10E White', '10S MKII Black', '10S MKII White', 'CG3M Black', 'CG3M White', 'CG3M Woofer', 'CG3M Tweeter', 'CG3M Crossover', 'CG23M Black', 'CG23M White', 'CG23M Woofer', 'CG23M Tweeter', 'CG23M Crossover', 'Speaker Bracket'],
  },
  {
    id: 'SUP002',
    email: 'supplier2',
    password: 'password',
    userType: 'RSL Supplier',
    isActive: true,
    permissions: {
      viewUserManagement: false,
      createEditUser: false,
      modifyShipper: false,
      editDashboard: false,
      viewDashboard: false,
      viewShipment: true,
      createUpdateShipment: true,
    },
    companyName: 'Pacific Manufacturing Co.',
    companyAddress: '456 Harbor Blvd, Busan, South Korea 48300',
    primaryContact: {
      name: 'Ji-hoon Kim',
      email: 'jihoon.kim@pacificmfg.com',
      phone: '+82 51 987 6543',
    },
    secondaryContact: {
      name: 'Min-jung Park',
      email: 'minjung.park@pacificmfg.com',
      phone: '+82 51 987 6544',
    },
    assignedPointsOfOrigin: ['Hong Kong', 'Yantian'],
    assignedProducts: ['12S Black', '12S White', '12S Woofer', 'XDR300', 'XDR350', 'XDR400W', 'XDR450', 'XDR500', 'XDR800', 'W25E', 'C34E MKII', '10U Woofer', 'Pallet'],
  },
  {
    id: 'USR003',
    email: 'manager@rsl.com',
    password: 'password',
    userType: 'RSL Internal',
    isActive: true,
    permissions: {
      viewUserManagement: true,
      createEditUser: true,
      modifyShipper: true,
      editDashboard: true,
      viewDashboard: true,
      viewShipment: true,
      createUpdateShipment: true,
    },
  },
  {
    id: 'SUP003',
    email: 'info@asiasupply.com',
    password: 'password',
    userType: 'RSL Supplier',
    isActive: false,
    permissions: {
      viewUserManagement: false,
      createEditUser: false,
      modifyShipper: false,
      editDashboard: false,
      viewDashboard: false,
      viewShipment: true,
      createUpdateShipment: true,
    },
    companyName: 'Asia Supply Chain Ltd.',
    companyAddress: '789 Commerce St, Hong Kong',
    primaryContact: {
      name: 'David Wong',
      email: 'david.wong@asiasupply.com',
      phone: '+852 2345 6789',
    },
    secondaryContact: {
      name: 'Mary Leung',
      email: 'mary.leung@asiasupply.com',
      phone: '+852 2345 6790',
    },
    assignedPointsOfOrigin: ['Hong Kong', 'Shanghai'],
    assignedProducts: ['10E Black', '10E White', 'Pallet'],
  },
];
