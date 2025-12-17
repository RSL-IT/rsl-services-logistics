// app/logistics-ui/components/SupplierView.tsx
import { useMemo, useState } from "react";
import type { Shipment } from "../LogisticsApp";

interface SupplierViewProps {
  supplierId: string;
  shipments: Shipment[];   // ⬅ exactly what LogisticsApp passes
  onLogout: () => void;
}

export function SupplierView({
                               supplierId,
                               shipments,
                               onLogout,
                             }: SupplierViewProps) {
  // Only show shipments for this supplier
  const supplierShipments = useMemo(
    () => shipments.filter((s) => s.supplierId === supplierId),
    [shipments, supplierId]
  );

  const [selectedShipmentId, setSelectedShipmentId] = useState<string | null>(
    null
  );

  const selectedShipment =
    supplierShipments.find((s) => s.id === selectedShipmentId) ?? null;

  return (
    <div className="p-8 bg-gray-50 min-h-screen">
      {/* Header */}
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold text-gray-800">
          Supplier Portal – Shipments
        </h1>
        <button
          onClick={onLogout}
          className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700"
        >
          Log Out
        </button>
      </div>

      {/* Details panel or table */}
      {selectedShipment ? (
        <div className="bg-white shadow rounded-lg p-6">
          <h2 className="text-lg font-semibold text-gray-800 mb-4">
            Shipment Details
          </h2>
          <div className="space-y-1 text-sm text-gray-800">
            <p>
              <strong>Container #:</strong> {selectedShipment.containerNumber}
            </p>
            <p>
              <strong>Status:</strong> {selectedShipment.status}
            </p>
            <p>
              <strong>ETA:</strong> {selectedShipment.eta}
            </p>
            <p>
              <strong>Port of Origin:</strong> {selectedShipment.portOfOrigin}
            </p>
            <p>
              <strong>Destination Port:</strong>{" "}
              {selectedShipment.destinationPort}
            </p>
          </div>

          {selectedShipment.products?.length ? (
            <>
              <p className="mt-4 font-semibold text-gray-800">Products:</p>
              <ul className="list-disc ml-6 text-gray-700 text-sm">
                {selectedShipment.products.map((p) => (
                  <li key={p.id}>
                    {p.name} ({p.sku}) – {p.quantity}
                  </li>
                ))}
              </ul>
            </>
          ) : null}

          <button
            onClick={() => setSelectedShipmentId(null)}
            className="mt-6 px-3 py-2 bg-gray-200 rounded hover:bg-gray-300"
          >
            Back to Shipments
          </button>
        </div>
      ) : (
        <div className="bg-white shadow rounded-lg overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-100">
            <tr>
              <th className="px-4 py-2 text-left font-medium text-gray-500 uppercase tracking-wider">
                Container #
              </th>
              <th className="px-4 py-2 text-left font-medium text-gray-500 uppercase tracking-wider">
                Destination
              </th>
              <th className="px-4 py-2 text-left font-medium text-gray-500 uppercase tracking-wider">
                ETA
              </th>
              <th className="px-4 py-2 text-left font-medium text-gray-500 uppercase tracking-wider">
                Status
              </th>
            </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
            {supplierShipments.map((shipment) => (
              <tr
                key={shipment.id}
                onClick={() => setSelectedShipmentId(shipment.id)}
                className="hover:bg-blue-50 cursor-pointer"
              >
                <td className="px-4 py-2 text-gray-800">
                  {shipment.containerNumber}
                </td>
                <td className="px-4 py-2 text-gray-800">
                  {shipment.destinationPort}
                </td>
                <td className="px-4 py-2 text-gray-800">{shipment.eta}</td>
                <td className="px-4 py-2 text-gray-800">
                  {shipment.status}
                </td>
              </tr>
            ))}

            {supplierShipments.length === 0 && (
              <tr>
                <td
                  colSpan={4}
                  className="px-4 py-4 text-center text-gray-500 italic"
                >
                  No shipments found for this supplier.
                </td>
              </tr>
            )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
