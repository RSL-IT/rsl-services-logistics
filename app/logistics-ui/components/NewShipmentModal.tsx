// app/logistics-ui/components/NewShipmentModal.tsx
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Modal,
  BlockStack,
  InlineStack,
  Text,
  TextField,
  Select,
  Checkbox,
  Button,
  Banner,
  Box,
  Divider,
} from "@shopify/polaris";

type LookupOption = {
  shortName: string;
  displayName?: string | null;
};

type PurchaseOrderOption = {
  // Preferred key (matches tbl_purchaseOrder.purchaseOrderGID)
  purchaseOrderGID?: string;
  // Optional back-compat if caller passes numeric IDs
  id?: number | string;
  shortName: string;
};

type ShipmentDraft = {
  supplierId: string;
  containerNumber: string;

  // Lookups
  containerSize: string;
  portOfOrigin: string;
  destinationPort: string;

  // New fields requested
  bookingAgent: string; // shortName
  bookingNumber: string;
  vesselName: string;
  deliveryAddress: string; // shortName

  // Dates
  cargoReadyDate: string; // YYYY-MM-DD
  etd: string; // YYYY-MM-DD
  eta: string; // YYYY-MM-DD

  // Existing DB-ish fields
  supplierPi: string;
  quantity: string; // keep as string in UI, parse to int on save
  estimatedDeliveryToOrigin: string; // YYYY-MM-DD
  status: string;
  notes: string;

  // POs
  purchaseOrderGIDs: string[];
};

function toYyyyMmDd(v: unknown): string {
  const s = String(v ?? "").trim();
  if (!s) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

function safeIntString(s: string): string {
  const v = String(s ?? "").trim();
  if (!v) return "";
  const n = Number(v);
  if (!Number.isFinite(n)) return "";
  const i = Math.trunc(n);
  if (i < 0) return "";
  return String(i);
}

interface NewShipmentModalProps {
  open: boolean;
  onClose: () => void;

  // called with the shipment returned by the server
  onCreated: (createdShipment: any) => void;

  // Lookups
  // Supplier source (requested: tlkp_supplier). In this repo schema it's tbl_company.
  // Accept both names so callers don't have to be perfectly consistent.
  suppliers?: LookupOption[];
  companies?: LookupOption[]; // back-compat

  containers: LookupOption[];
  originPorts: LookupOption[];
  destinationPorts: LookupOption[];
  bookingAgents: LookupOption[];
  deliveryAddresses: LookupOption[];
  purchaseOrders: PurchaseOrderOption[];

  // Optional preselects
  initialSupplierId?: string;
}

export function NewShipmentModal({
                                   open,
                                   onClose,
                                   onCreated,
                                   suppliers,
                                   companies,
                                   containers,
                                   originPorts,
                                   destinationPorts,
                                   bookingAgents,
                                   deliveryAddresses,
                                   purchaseOrders,
                                   initialSupplierId,
                                 }: NewShipmentModalProps) {
  const supplierOptions =
    Array.isArray(suppliers) && suppliers.length > 0 ? suppliers : Array.isArray(companies) ? companies : [];

  const defaultSupplierId = useMemo(() => {
    const first = supplierOptions?.[0]?.shortName ?? "";
    return String(initialSupplierId ?? first).trim();
  }, [supplierOptions, initialSupplierId]);

  const defaults: ShipmentDraft = useMemo(
    () => ({
      supplierId: defaultSupplierId,
      containerNumber: "",

      containerSize: containers?.[0]?.shortName ?? "",
      portOfOrigin: originPorts?.[0]?.shortName ?? "",
      destinationPort: destinationPorts?.[0]?.shortName ?? "",

      bookingAgent: bookingAgents?.[0]?.shortName ?? "",
      bookingNumber: "",
      vesselName: "",
      deliveryAddress: deliveryAddresses?.[0]?.shortName ?? "",

      cargoReadyDate: "",
      etd: "",
      eta: "",

      supplierPi: "",
      quantity: "",
      estimatedDeliveryToOrigin: "",

      status: "Pending",
      notes: "",

      purchaseOrderGIDs: [],
    }),
    [defaultSupplierId, containers, originPorts, destinationPorts, bookingAgents, deliveryAddresses]
  );

  const [form, setForm] = useState<ShipmentDraft>(defaults);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset only when the modal transitions from closed -> open.
  const prevOpenRef = useRef<boolean>(open);
  useEffect(() => {
    const wasOpen = prevOpenRef.current;
    if (open && !wasOpen) {
      setError(null);
      setBusy(false);
      setForm(defaults);
    }
    prevOpenRef.current = open;
  }, [open, defaults]);

  const supplierChoices = [{ label: "Select…", value: "" }].concat(
    (supplierOptions || []).map((c) => ({
      label: c.displayName ? `${c.displayName} (${c.shortName})` : c.shortName,
      value: c.shortName,
    }))
  );

  const lookupChoices = (items: LookupOption[]) =>
    [{ label: "Select…", value: "" }].concat(
      (items || []).map((x) => ({
        label: x.displayName ? `${x.displayName} (${x.shortName})` : x.shortName,
        value: x.shortName,
      }))
    );

  const containerChoices = lookupChoices(containers || []);
  const originChoices = lookupChoices(originPorts || []);
  const destChoices = lookupChoices(destinationPorts || []);
  const bookingAgentChoices = lookupChoices(bookingAgents || []);
  const deliveryAddressChoices = lookupChoices(deliveryAddresses || []);

  const poItems = Array.isArray(purchaseOrders) ? purchaseOrders : [];

  const poValue = (po: PurchaseOrderOption) => {
    const gid = String(po.purchaseOrderGID ?? "").trim();
    if (gid) return gid;
    const id = po.id;
    return id === undefined || id === null ? "" : String(id);
  };

  const togglePo = (gid: string) => {
    setForm((prev) => {
      const cur = prev.purchaseOrderGIDs || [];
      const next = cur.includes(gid) ? cur.filter((x) => x !== gid) : [...cur, gid];
      return { ...prev, purchaseOrderGIDs: next };
    });
  };

  const confirmCancel = () => {
    if (busy) return false;
    if (typeof window === "undefined") return true;
    return window.confirm("Discard this new shipment and lose your changes?");
  };

  const handleCancel = () => {
    if (!confirmCancel()) return;
    onClose();
  };

  const submitCreate = async () => {
    setError(null);

    const supplierId = String(form.supplierId || "").trim();
    const containerNumber = String(form.containerNumber || "").trim().toUpperCase();

    if (!supplierId || !containerNumber) {
      setError("Supplier and Container # are required.");
      return;
    }

    const payload: any = {
      supplierId,
      containerNumber,
      containerSize: form.containerSize || null,
      portOfOrigin: form.portOfOrigin || null,
      destinationPort: form.destinationPort || null,
      status: form.status || null,

      eta: toYyyyMmDd(form.eta),
      cargoReadyDate: toYyyyMmDd(form.cargoReadyDate),
      etd: toYyyyMmDd(form.etd),
      estimatedDeliveryToOrigin: toYyyyMmDd(form.estimatedDeliveryToOrigin),

      supplierPi: String(form.supplierPi || "").trim() || null,
      quantity: form.quantity ? safeIntString(form.quantity) : null,

      bookingAgent: String(form.bookingAgent || "").trim() || null,
      bookingNumber: String(form.bookingNumber || "").trim() || null,
      vesselName: String(form.vesselName || "").trim() || null,
      deliveryAddress: String(form.deliveryAddress || "").trim() || null,

      notes: String(form.notes || "").trim() || null,
      purchaseOrderGIDs: Array.isArray(form.purchaseOrderGIDs) ? form.purchaseOrderGIDs : [],
    };

    setBusy(true);
    try {
      const res = await fetch("/apps/logistics/shipments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ intent: "create", shipment: payload }),
      });

      const data = await res.json().catch(() => null);
      if (!data || data.success !== true) {
        setError(data?.error || "Server error while creating shipment.");
        setBusy(false);
        return;
      }

      onCreated(data.shipment);
      setBusy(false);
      onClose();
    } catch (e: any) {
      setError(e?.message || "Network error while creating shipment.");
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={handleCancel}
      title="Create Shipment"
    >
      <Modal.Section>
        {/* Scroll container */}
        <div style={{ maxHeight: "75vh", overflowY: "auto" }}>
          {/* Sticky top actions */}
          <div
            style={{
              position: "sticky",
              top: 0,
              zIndex: 10,
              background: "white",
              paddingBottom: 12,
              marginBottom: 12,
              borderBottom: "1px solid var(--p-color-border-secondary, #e5e7eb)",
            }}
          >
            <InlineStack align="space-between" blockAlign="center">
              <Button onClick={handleCancel} disabled={busy}>
                Cancel
              </Button>
              <Button onClick={submitCreate} loading={busy} disabled={busy}>
                Submit
              </Button>
            </InlineStack>
          </div>

          <BlockStack gap="400">
            {error ? (
              <Banner tone="critical" title="Could not create shipment">
                <p>{error}</p>
              </Banner>
            ) : null}

            {Array.isArray(deliveryAddresses) && deliveryAddresses.length === 0 ? (
              <Banner tone="warning" title="Delivery Address list is empty">
                <p>
                  No rows were returned from <code>tlkp_deliveryAddress</code>, so the dropdown will be empty.
                </p>
              </Banner>
            ) : null}

            <Box>
              <Text variant="headingSm" as="h3">Booking</Text>
              <Box paddingBlockStart="200" />
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 12 }}>
                <Select
                  label="Booking Agent"
                  options={bookingAgentChoices}
                  value={form.bookingAgent}
                  onChange={(v) => setForm((p) => ({ ...p, bookingAgent: v }))}
                />
                <TextField
                  label="Booking #"
                  value={form.bookingNumber}
                  onChange={(v) => setForm((p) => ({ ...p, bookingNumber: v }))}
                  autoComplete="off"
                  placeholder="Enter the booking number"
                />
                <TextField
                  label="Vessel Name"
                  value={form.vesselName}
                  onChange={(v) => setForm((p) => ({ ...p, vesselName: v }))}
                  autoComplete="off"
                  placeholder="Name of the vessel carrying this shipment"
                />
              </div>
            </Box>

            <Divider />

            <Box>
              <Text variant="headingSm" as="h3">Parties & Container</Text>
              <Box paddingBlockStart="200" />
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 12 }}>
                <Select
                  label="Supplier"
                  options={supplierChoices}
                  value={form.supplierId}
                  onChange={(v) => setForm((p) => ({ ...p, supplierId: v }))}
                />
                <TextField
                  label="Container #"
                  value={form.containerNumber}
                  onChange={(v) => setForm((p) => ({ ...p, containerNumber: v }))}
                  autoComplete="off"
                />
                <Select
                  label="Container Size"
                  options={containerChoices}
                  value={form.containerSize}
                  onChange={(v) => setForm((p) => ({ ...p, containerSize: v }))}
                />
              </div>
            </Box>

            <Box>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 12 }}>
                <Select
                  label="Port of Origin"
                  options={originChoices}
                  value={form.portOfOrigin}
                  onChange={(v) => setForm((p) => ({ ...p, portOfOrigin: v }))}
                />
                <Select
                  label="Destination Port"
                  options={destChoices}
                  value={form.destinationPort}
                  onChange={(v) => setForm((p) => ({ ...p, destinationPort: v }))}
                />
                <Select
                  label="Delivery Address"
                  options={deliveryAddressChoices}
                  value={form.deliveryAddress}
                  onChange={(v) => setForm((p) => ({ ...p, deliveryAddress: v }))}
                />
              </div>
            </Box>

            <Divider />

            <Box>
              <Text variant="headingSm" as="h3">Purchase Orders</Text>
              <Box paddingBlockStart="200" />
              {poItems.length === 0 ? (
                <Text as="p" tone="subdued">No purchase orders available.</Text>
              ) : (
                <BlockStack gap="100">
                  {poItems.map((po) => {
                    const value = poValue(po);
                    const label = String(po.shortName || "").trim() || value || "(unnamed PO)";
                    const checked = value ? (form.purchaseOrderGIDs || []).includes(value) : false;
                    return (
                      <Checkbox
                        key={value || label}
                        label={label}
                        checked={checked}
                        disabled={!value}
                        onChange={() => value && togglePo(value)}
                      />
                    );
                  })}
                </BlockStack>
              )}
            </Box>

            {busy ? (
              <InlineStack gap="200" align="end">
                <Button loading>Saving</Button>
              </InlineStack>
            ) : null}
          </BlockStack>
        </div>
      </Modal.Section>
    </Modal>
  );
}
