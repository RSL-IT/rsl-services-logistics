import { useState } from 'react';
import { X, Package, Ship, MapPin, Calendar, Tag, Edit2, Save } from 'lucide-react';
import { Shipment, Product } from '../App';
import { productList, destinations, containerTypes, pointsOfOrigin } from '../data/mockData';
import { mockUsers } from '../data/usersData';

interface EditableShipmentModalProps {
  shipment: Shipment;
  canEdit: boolean;
  onClose: () => void;
  onSave: (shipment: Shipment) => void;
}

export function EditableShipmentModal({ shipment, canEdit, onClose, onSave }: EditableShipmentModalProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState<Shipment>(shipment);

  const handleSave = () => {
    onSave(editForm);
    setIsEditing(false);
  };

  const handleCancel = () => {
    setEditForm(shipment);
    setIsEditing(false);
  };

  const updateProduct = (index: number, field: keyof Product, value: any) => {
    const newProducts = [...editForm.products];
    newProducts[index] = { ...newProducts[index], [field]: value };
    setEditForm({ ...editForm, products: newProducts });
  };

  const removeProduct = (index: number) => {
    const newProducts = [...editForm.products];
    newProducts.splice(index, 1);
    setEditForm({ ...editForm, products: newProducts });
  };

  const addProduct = () => {
    const newProduct: Product = {
      id: `P${Date.now()}`,
      name: productList[0],
      sku: '',
      quantity: 0,
    };
    setEditForm({ ...editForm, products: [...editForm.products, newProduct] });
  };

  const suppliers = Array.from(new Set(mockUsers.filter(u => u.userType === 'RSL Supplier').map(u => ({
    id: u.id,
    name: u.companyName || u.email
  }))));

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="bg-blue-600 text-white px-6 py-4 flex items-center justify-between sticky top-0">
          <div className="flex items-center gap-3">
            <Ship className="w-6 h-6" />
            <div>
              <h2>Shipment Details</h2>
              <p className="text-blue-100">{editForm.id}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {canEdit && !isEditing && (
              <button
                onClick={() => setIsEditing(true)}
                className="flex items-center gap-2 px-3 py-1.5 bg-white text-blue-600 rounded hover:bg-blue-50 transition-colors"
              >
                <Edit2 className="w-4 h-4" />
                Edit
              </button>
            )}
            {isEditing && (
              <>
                <button
                  onClick={handleSave}
                  className="flex items-center gap-2 px-3 py-1.5 bg-green-600 text-white rounded hover:bg-green-700 transition-colors"
                >
                  <Save className="w-4 h-4" />
                  Save
                </button>
                <button
                  onClick={handleCancel}
                  className="px-3 py-1.5 bg-gray-600 text-white rounded hover:bg-gray-700 transition-colors"
                >
                  Cancel
                </button>
              </>
            )}
            <button
              onClick={onClose}
              className="p-1 hover:bg-blue-700 rounded transition-colors"
            >
              <X className="w-6 h-6" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          {/* Status & Supplier */}
          <div className="flex items-center justify-between">
            <div>
              <p className="text-gray-600 mb-1">Status</p>
              {isEditing ? (
                <select
                  value={editForm.status}
                  onChange={(e) => setEditForm({ ...editForm, status: e.target.value as any })}
                  className="px-3 py-2 border border-gray-300 rounded"
                >
                  <option value="Pending">Pending</option>
                  <option value="In Transit">In Transit</option>
                  <option value="Arrived">Arrived</option>
                  <option value="Delivered">Delivered</option>
                </select>
              ) : (
                <span className={`px-4 py-2 rounded-full inline-block ${
                  editForm.status === 'Delivered' ? 'bg-green-100 text-green-800' :
                  editForm.status === 'In Transit' ? 'bg-blue-100 text-blue-800' :
                  editForm.status === 'Arrived' ? 'bg-purple-100 text-purple-800' :
                  'bg-yellow-100 text-yellow-800'
                }`}>
                  {editForm.status}
                </span>
              )}
            </div>
            <div className="text-right">
              <p className="text-gray-600 mb-1">Supplier</p>
              {isEditing ? (
                <select
                  value={editForm.supplierId}
                  onChange={(e) => {
                    const supplier = suppliers.find(s => s.id === e.target.value);
                    setEditForm({
                      ...editForm,
                      supplierId: e.target.value,
                      supplierName: supplier?.name || ''
                    });
                  }}
                  className="px-3 py-2 border border-gray-300 rounded"
                >
                  {suppliers.map(s => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              ) : (
                <>
                  <p className="text-gray-900">{editForm.supplierName}</p>
                  <p className="text-gray-500 text-sm">{editForm.supplierId}</p>
                </>
              )}
            </div>
          </div>

          {/* Container Information */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Package className="w-5 h-5 text-gray-600" />
              <h3 className="text-gray-900">Container Information</h3>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-gray-600 mb-1">Container Number</p>
                {isEditing ? (
                  <input
                    type="text"
                    value={editForm.containerNumber}
                    onChange={(e) => setEditForm({ ...editForm, containerNumber: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded"
                  />
                ) : (
                  <p className="text-gray-900">{editForm.containerNumber}</p>
                )}
              </div>
              <div>
                <p className="text-gray-600 mb-1">Container Size</p>
                {isEditing ? (
                  <select
                    value={editForm.containerSize}
                    onChange={(e) => setEditForm({ ...editForm, containerSize: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded"
                  >
                    {containerTypes.map(type => (
                      <option key={type} value={type}>{type}</option>
                    ))}
                  </select>
                ) : (
                  <p className="text-gray-900">{editForm.containerSize}</p>
                )}
              </div>
              <div>
                <p className="text-gray-600 mb-1">Seal Number</p>
                {isEditing ? (
                  <input
                    type="text"
                    value={editForm.sealNumber}
                    onChange={(e) => setEditForm({ ...editForm, sealNumber: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded"
                  />
                ) : (
                  <p className="text-gray-900">{editForm.sealNumber}</p>
                )}
              </div>
              <div>
                <p className="text-gray-600 mb-1">HBL Number</p>
                {isEditing ? (
                  <input
                    type="text"
                    value={editForm.hblNumber}
                    onChange={(e) => setEditForm({ ...editForm, hblNumber: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded"
                  />
                ) : (
                  <p className="text-gray-900">{editForm.hblNumber}</p>
                )}
              </div>
            </div>
          </div>

          {/* Route Information */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <MapPin className="w-5 h-5 text-gray-600" />
              <h3 className="text-gray-900">Route Information</h3>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-gray-600 mb-1">Port of Origin</p>
                {isEditing ? (
                  <select
                    value={editForm.portOfOrigin}
                    onChange={(e) => setEditForm({ ...editForm, portOfOrigin: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded"
                  >
                    {pointsOfOrigin.map(port => (
                      <option key={port} value={port}>{port}</option>
                    ))}
                  </select>
                ) : (
                  <p className="text-gray-900">{editForm.portOfOrigin}</p>
                )}
              </div>
              <div>
                <p className="text-gray-600 mb-1">Destination Port</p>
                {isEditing ? (
                  <select
                    value={editForm.destinationPort}
                    onChange={(e) => setEditForm({ ...editForm, destinationPort: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded"
                  >
                    {destinations.map(dest => (
                      <option key={dest} value={dest}>{dest}</option>
                    ))}
                  </select>
                ) : (
                  <p className="text-gray-900">{editForm.destinationPort}</p>
                )}
              </div>
            </div>
          </div>

          {/* Dates */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Calendar className="w-5 h-5 text-gray-600" />
              <h3 className="text-gray-900">Important Dates</h3>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-gray-600 mb-1">Cargo Ready Date</p>
                {isEditing ? (
                  <input
                    type="date"
                    value={editForm.cargoReadyDate}
                    onChange={(e) => setEditForm({ ...editForm, cargoReadyDate: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded"
                  />
                ) : (
                  <p className="text-gray-900">{editForm.cargoReadyDate || 'N/A'}</p>
                )}
              </div>
              <div>
                <p className="text-gray-600 mb-1">ETD (Estimated Departure)</p>
                {isEditing ? (
                  <input
                    type="date"
                    value={editForm.etd}
                    onChange={(e) => setEditForm({ ...editForm, etd: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded"
                  />
                ) : (
                  <p className="text-gray-900">{editForm.etd || 'N/A'}</p>
                )}
              </div>
              <div>
                <p className="text-gray-600 mb-1">Actual Departure Date</p>
                {isEditing ? (
                  <input
                    type="date"
                    value={editForm.actualDepartureDate}
                    onChange={(e) => setEditForm({ ...editForm, actualDepartureDate: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded"
                  />
                ) : (
                  <p className="text-gray-900">{editForm.actualDepartureDate || 'Not departed yet'}</p>
                )}
              </div>
              <div>
                <p className="text-gray-600 mb-1">ETA (Estimated Arrival)</p>
                {isEditing ? (
                  <input
                    type="date"
                    value={editForm.eta}
                    onChange={(e) => setEditForm({ ...editForm, eta: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded"
                  />
                ) : (
                  <p className="text-gray-900">{editForm.eta || 'N/A'}</p>
                )}
              </div>
              <div className="col-span-2">
                <p className="text-gray-600 mb-1">Estimated Delivery Date</p>
                {isEditing ? (
                  <input
                    type="date"
                    value={editForm.estimatedDeliveryDate}
                    onChange={(e) => setEditForm({ ...editForm, estimatedDeliveryDate: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded"
                  />
                ) : (
                  <p className="text-gray-900">{editForm.estimatedDeliveryDate || 'N/A'}</p>
                )}
              </div>
            </div>
          </div>

          {/* Products */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Tag className="w-5 h-5 text-gray-600" />
                <h3 className="text-gray-900">Products</h3>
              </div>
              {isEditing && (
                <button
                  onClick={addProduct}
                  className="px-3 py-1 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 transition-colors"
                >
                  Add Product
                </button>
              )}
            </div>
            <div className="bg-gray-50 rounded-lg overflow-hidden">
              <table className="w-full">
                <thead className="bg-gray-100">
                  <tr>
                    <th className="px-4 py-2 text-left text-gray-700">Product Name</th>
                    <th className="px-4 py-2 text-left text-gray-700">SKU</th>
                    <th className="px-4 py-2 text-right text-gray-700">Quantity</th>
                    {isEditing && <th className="px-4 py-2 text-center text-gray-700">Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {editForm.products.map((product, index) => (
                    <tr key={product.id} className="border-t border-gray-200">
                      <td className="px-4 py-2">
                        {isEditing ? (
                          <select
                            value={product.name}
                            onChange={(e) => updateProduct(index, 'name', e.target.value)}
                            className="w-full px-2 py-1 border border-gray-300 rounded"
                          >
                            {productList.map(p => (
                              <option key={p} value={p}>{p}</option>
                            ))}
                          </select>
                        ) : (
                          <span className="text-gray-900">{product.name}</span>
                        )}
                      </td>
                      <td className="px-4 py-2">
                        {isEditing ? (
                          <input
                            type="text"
                            value={product.sku}
                            onChange={(e) => updateProduct(index, 'sku', e.target.value)}
                            className="w-full px-2 py-1 border border-gray-300 rounded"
                          />
                        ) : (
                          <span className="text-gray-600">{product.sku}</span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-right">
                        {isEditing ? (
                          <input
                            type="number"
                            value={product.quantity}
                            onChange={(e) => updateProduct(index, 'quantity', parseInt(e.target.value) || 0)}
                            className="w-full px-2 py-1 border border-gray-300 rounded text-right"
                            min="0"
                          />
                        ) : (
                          <span className="text-gray-900">{product.quantity}</span>
                        )}
                      </td>
                      {isEditing && (
                        <td className="px-4 py-2 text-center">
                          <button
                            onClick={() => removeProduct(index)}
                            className="text-red-600 hover:bg-red-50 p-1 rounded"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-gray-100 border-t-2 border-gray-300">
                  <tr>
                    <td className="px-4 py-2 text-gray-900" colSpan={2}>Total Items</td>
                    <td className="px-4 py-2 text-gray-900 text-right">
                      {editForm.products.reduce((sum, p) => sum + p.quantity, 0)}
                    </td>
                    {isEditing && <td></td>}
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="bg-gray-50 px-6 py-4 flex justify-end border-t border-gray-200">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
