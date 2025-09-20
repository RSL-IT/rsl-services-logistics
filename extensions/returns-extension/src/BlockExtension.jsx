// /extensions/returns-extension/src/blockExtension.jsx
import {
  reactExtension,
  Text,
  TextField,
  TextArea,
  Checkbox,
  Select,
  DateField,
  Button,
  BlockStack,
  InlineStack,
  Box,
  useApi,
} from "@shopify/ui-extensions-react/admin";
import { useEffect, useMemo, useState } from "react";

const DEBUG = false;
const TARGET = "admin.order-details.block.render";

// Prefer CLI tunnel via __APP_URL__, then Vite var, then Fly
const BASE_URL =
  (typeof __APP_URL__ !== "undefined" && __APP_URL__) ||
  (typeof import.meta !== "undefined" && import.meta.env?.VITE_APP_URL) ||
  "https://rsl-services-app.fly.dev";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function getSessionTokenWithRetry(shopify, attempts = 5) {
  for (let i = 0; i < attempts; i++) {
    try {
      const t = shopify?.sessionToken?.get ? await shopify.sessionToken.get() : null;
      if (t) return t;
    } catch {}
    await sleep(150 * (i + 1));
  }
  return null;
}

function todayISO() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

const PLACEHOLDERS = {
  returnType: { value: "", label: "Pick a return type" },
  troubleshootingCategory: { value: "", label: "Pick a troubleshooting category" },
  primaryReason: { value: "", label: "Pick a customer reason category" },
};

const DEFAULT_STATE = {
  orderId: "",           // hidden but stored (human-readable)
  orderGid: "",          // hidden but stored (GID)
  customerGid: "",       // hidden
  userGid: "",           // hidden (current Shopify staff user)
  returnType: PLACEHOLDERS.returnType.value,
  primaryReason: PLACEHOLDERS.primaryReason.value,
  troubleOccurredOn: todayISO(),
  associatedSerialNumber: "",
  hasTroubleshooting: false,
  troubleshootingCategory: PLACEHOLDERS.troubleshootingCategory.value,
  customerReportedInfo: "",
};

function normalizeOptions(rows, placeholder) {
  const opts = Array.isArray(rows)
    ? rows.map(({ id, label }) => ({ value: String(id), label: String(label ?? id) }))
    : [];
  return [placeholder, ...opts];
}

async function fetchLookups({ shopify, signal }) {
  const token = await getSessionTokenWithRetry(shopify);
  const url = `${BASE_URL}/apps/returns/lookups?sets=returnTypes,troubleshootingCategories,primaryReasons`;
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  const res = await fetch(url, { headers, signal });
  if (!res.ok) throw new Error(`Lookups fetch failed ${res.status}: ${await res.text()}`);
  return res.json();
}

export default reactExtension(TARGET, () => <BlockExtension />);

function BlockExtension() {
  const shopify = useApi(TARGET); // { data, query, sessionToken, toast, ... }

  // state
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [lookups, setLookups] = useState({
    returnTypes: [],
    troubleshootingCategories: [],
    primaryReasons: [],
  });
  const [form, setForm] = useState(DEFAULT_STATE);

  // Auto-fill hidden order/customer/user identifiers using Admin context
  useEffect(() => {
    const orderGid = shopify?.data?.selected?.[0]?.id;
    if (!orderGid) return;

    setForm((p) => (p.orderGid ? p : { ...p, orderGid }));

    if (typeof shopify?.query === "function") {
      (async () => {
        try {
          const { data } = await shopify.query(
            `#graphql
            query OrderInfo($id: ID!) {
              order(id: $id) {
                id
                name
                legacyResourceId
                customer { id }
              }
            }
          `,
            { variables: { id: orderGid } }
          );
          const o = data?.order;
          const display = o?.name || (o?.legacyResourceId ? String(o.legacyResourceId) : orderGid);
          setForm((p) => ({
            ...p,
            orderId: p.orderId || display,
            customerGid: p.customerGid || o?.customer?.id || "",
          }));
        } catch {
          setForm((p) => ({ ...p, orderId: p.orderId || orderGid }));
        }

        // Best-effort: capture current staff user id if available
        try {
          const { data: me } = await shopify.query(
            `#graphql
            query CurrentUser { currentUser { id } }
          `
          );
          const uid = me?.currentUser?.id;
          if (uid) setForm((p) => ({ ...p, userGid: p.userGid || uid }));
        } catch {
          // ignore if not supported on this API version/shop
        }
      })();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shopify?.data]);

  // debug helper (optional)
  useEffect(() => {
    if (!DEBUG) return;
    (async () => {
      const t = await getSessionTokenWithRetry(shopify);
      if (t) {
        // eslint-disable-next-line no-console
        console.info("SESSION_TOKEN:", t);
        try { (globalThis || window).__ADMIN_TOKEN = t; } catch {}
      }
    })();
  }, [shopify]);

  const returnTypeOptions = useMemo(
    () => normalizeOptions(lookups.returnTypes, PLACEHOLDERS.returnType),
    [lookups.returnTypes]
  );
  const troubleshootingCategoryOptions = useMemo(
    () => normalizeOptions(lookups.troubleshootingCategories, PLACEHOLDERS.troubleshootingCategory),
    [lookups.troubleshootingCategories]
  );
  const primaryReasonOptions = useMemo(
    () => normalizeOptions(lookups.primaryReasons, PLACEHOLDERS.primaryReason),
    [lookups.primaryReasons]
  );

  // load lookups
  useEffect(() => {
    let aborted = false; const ctrl = new AbortController();
    (async () => {
      setLoading(true); setError(null);
      try {
        const data = await fetchLookups({ shopify, signal: ctrl.signal });
        if (!aborted) {
          setLookups({
            returnTypes: Array.isArray(data.returnTypes) ? data.returnTypes : [],
            troubleshootingCategories: Array.isArray(data.troubleshootingCategories) ? data.troubleshootingCategories : [],
            primaryReasons: Array.isArray(data.primaryReasons) ? data.primaryReasons : [],
          });
        }
      } catch (e) {
        if (!aborted) setError(e.message);
      } finally { if (!aborted) setLoading(false); }
    })();
    return () => { aborted = true; ctrl.abort(); };
  }, [shopify]);

  const onChange = (key) => (value) => setForm((prev) => ({ ...prev, [key]: value }));

  async function handleSave() {
    setSaving(true); setError(null);
    try {
      const token = await getSessionTokenWithRetry(shopify);
      if (!token) throw new Error("No Admin session token available; open in Admin (not Preview)");
      const url = `${BASE_URL}/apps/returns/save`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error(`Save failed ${res.status}: ${await res.text()}`);
      shopify?.toast?.show?.("Saved.");
    } catch (e) { setError(e.message); } finally { setSaving(false); }
  }

  return (
    <Box padding="none" maxBlockSize={460}>
      <BlockStack gap="small">
        {error && (
          <InlineStack gap="small">
            <Text emphasis>Problem</Text>
            <Text>{String(error)}</Text>
          </InlineStack>
        )}

        {loading ? (
          <InlineStack gap="small"><Text>Loading lookups…</Text></InlineStack>
        ) : (
          <BlockStack gap="small">
            {/* Row 1: Request Date | Return Type | Reason Category */}
            <InlineStack gap="small">
              <DateField
                label="Request Date"
                value={form.troubleOccurredOn}
                onChange={onChange("troubleOccurredOn")}
              />
              <Select
                label="Return Type"
                value={form.returnType}
                onChange={onChange("returnType")}
                options={returnTypeOptions}
              />
              <Select
                label="Reason Category"
                value={form.primaryReason}
                onChange={onChange("primaryReason")}
                options={primaryReasonOptions}
              />
            </InlineStack>

            {/* Row 2: Troubleshooting Performed (checkbox only; label must not wrap) */}
            <InlineStack gap="small" blockAlignment="center">
              <Box minInlineSize="40ch" maxInlineSize="100%">
                <Checkbox
                  label="Troubleshooting performed"
                  checked={form.hasTroubleshooting}
                  onChange={(v) => setForm((p) => ({ ...p, hasTroubleshooting: v }))}
                />
              </Box>
            </InlineStack>

            {/* Row 3: Troubleshooting Category | Serial # (only when checked; each half width) */}
            {form.hasTroubleshooting && (
              <InlineStack gap="small">
                <Box minInlineSize="50%" maxInlineSize="50%">
                  <Select
                    label="Troubleshooting Category"
                    value={form.troubleshootingCategory}
                    onChange={onChange("troubleshootingCategory")}
                    options={troubleshootingCategoryOptions}
                  />
                </Box>
                <Box minInlineSize="50%" maxInlineSize="50%">
                  <TextField
                    label="Serial #"
                    value={form.associatedSerialNumber}
                    onChange={onChange("associatedSerialNumber")}
                  />
                </Box>
              </InlineStack>
            )}

            {/* Notes always visible */}
            <TextArea
              label="Customer Reported Info"
              value={form.customerReportedInfo}
              onChange={onChange("customerReportedInfo")}
              maxLength={2000}
            />

            <InlineStack gap="small">
              <Button kind="primary" onPress={handleSave} disabled={saving}>
                {saving ? "Saving…" : "Save"}
              </Button>
            </InlineStack>

            {DEBUG && (
              <InlineStack gap="small">
                <Button onPress={async () => {
                  const t = await getSessionTokenWithRetry(shopify);
                  if (t) { await navigator.clipboard.writeText(t); shopify?.toast?.show?.("Session token copied"); console.info("SESSION_TOKEN:", t); }
                  else { shopify?.toast?.show?.("No token in this context"); }
                }}>Copy Admin token</Button>
              </InlineStack>
            )}
          </BlockStack>
        )}
      </BlockStack>
    </Box>
  );
}
