// app/logistics-ui/data/purchaseOrdersData.ts

export type PurchaseOrderStatus =
  | "Draft"
  | "Sent"
  | "Confirmed"
  | "Partially Received"
  | "Completed"
  | "Cancelled";

export type PurchaseOrderLineItem = {
  id: string;
  sku?: string;
  description?: string;
  quantity: number;
  unitPrice: number;
};

export type PurchaseOrder = {
  id: string;

  // what the Figma table is using
  poNumber: string;
  supplierId: string;
  supplierName: string;
  orderDate: string;              // YYYY-MM-DD
  expectedDeliveryDate: string;   // YYYY-MM-DD
  total: number;
  status: PurchaseOrderStatus;

  // for details views
  items: PurchaseOrderLineItem[];
  notes?: string;

  // optional: if/when you map to your real schema
  shortName?: string;
  purchaseOrderGID?: string;
};

// Keep empty (you’ll replace this with DB data / loader data)
export const mockPurchaseOrders: PurchaseOrder[] = [];
