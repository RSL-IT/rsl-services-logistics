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
  Divider,
  BlockStack,
  InlineStack,
  Heading,
  useApi,
} from "@shopify/ui-extensions-react/admin";
import { useEffect, useMemo, useState } from "react";

// Enable dev helpers (token copy + auto log)
const DEBUG = true;

// Resolve backend base URL automatically (CLI tunnel via __APP_URL__, then Vite var, then Fly)
const BASE_URL =
  (typeof __APP_URL__ !== "undefined" && __APP_URL__) ||
  (typeof import.meta !== "undefined" && import.meta.env?.VITE_APP_URL) ||
  "https://rsl-services-app.fly.dev"; // prod fallback

const PLACEHOLDERS = {
  returnType: { value: "", label: "Pick a return type" },
  troubleshootingCategory: { value: "", label: "Pick a troubleshooting category" },
  primaryReason: { value: "", label: "Pick a customer reason category" },
};

const DEFAULT_STATE = {
  orderId: "",
  returnType: PLACEHOLDERS.returnType.value,
  primaryReason: PLACEHOLDERS.primaryReason.value,
  troubleOccurredOn: "",
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
  // Admin UI extensions expose `sessionToken.get()`
  let token = null;
  try {
    token = shopify?.sessionToken?.get ? await shopify.sessionToken.get() : null;
  } catch (e) {
    if (DEBUG) console.warn("No session token (preview likely). Proceeding without it.");
  }

  const url = `${BASE_URL}/apps/returns/lookups?sets=returnTypes,troubleshootingCategories,primaryReasons`;
  if (DEBUG) console.info("Lookups URL:", url);
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  const res = await fetch(url, { headers, signal });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Lookups fetch failed ${res.status}: ${text}`);
  }
  return res.json();
}

// Register the extension
export default reactExtension("admin.order-details.block.render", () => <BlockExtension />);

function BlockExtension() {
  const shopify = useApi();

  // DEV: auto-log a fresh Admin session token on mount so you don't need to scroll.
  useEffect(() => {
    if (!DEBUG) return;
    (async () => {
      try {
        const t = shopify?.sessionToken?.get ? await shopify.sessionToken.get() : null;
        if (t) {
          console.info("SESSION_TOKEN:", t);
          try { (globalThis || window).__ADMIN_TOKEN = t; } catch (_) {}
        }
      } catch (e) {
        console.warn("Token fetch failed (likely preview context)", e);
      }
    })();
  }, [shopify]);

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [lookups, setLookups] = useState({
    returnTypes: [],
    troubleshootingCategories: [],
    primaryReasons: [],
  });

  const [form, setForm] = useState(DEFAULT_STATE);

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

  // Load the lookup lists from backend on mount
  useEffect(() => {
    let aborted = false;
    const ctrl = new AbortController();

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const data = await fetchLookups({ shopify, signal: ctrl.signal });
        if (aborted) return;
        setLookups({
          returnTypes: Array.isArray(data.returnTypes) ? data.returnTypes : [],
          troubleshootingCategories: Array.isArray(data.troubleshootingCategories)
            ? data.troubleshootingCategories
            : [],
          primaryReasons: Array.isArray(data.primaryReasons) ? data.primaryReasons : [],
        });
      } catch (e) {
        if (DEBUG) console.error("Lookup load error:", e);
        setError(e.message);
      } finally {
        if (!aborted) setLoading(false);
      }
    }

    load();
    return () => {
      aborted = true;
      ctrl.abort();
    };
  }, [shopify]);

  const onChange = (key) => (value) => setForm((prev) => ({ ...prev, [key]: value }));

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const token = shopify?.sessionToken?.get ? await shopify.sessionToken.get() : null;
      const url = `${BASE_URL}/apps/csd-entry/save`;
      if (DEBUG) console.info("Save URL:", url);
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error(`Save failed ${res.status}`);
      await shopify?.toast?.show?.("Saved.");
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <BlockStack gap>
      <Heading>Returns Extension — Customer Support Data Entry</Heading>

      {DEBUG && (
        <InlineStack gap="small">
          <Button
            onPress={async () => {
              try {
                const t = shopify?.sessionToken?.get ? await shopify.sessionToken.get() : null;
                if (t) {
                  await navigator.clipboard.writeText(t);
                  await shopify?.toast?.show?.("Session token copied");
                  console.info("SESSION_TOKEN:", t);
                } else {
                  await shopify?.toast?.show?.("No token available in this context");
                  console.info("No token available in this context");
                }
              } catch (e) {
                console.error("Token fetch failed", e);
              }
            }}
          >
            Copy Admin token
          </Button>
        </InlineStack>
      )}

      {error && (
        <InlineStack gap="small">
          <Text emphasis>Problem</Text>
          <Text>{String(error)}</Text>
        </InlineStack>
      )}

      {loading ? (
        <InlineStack gap="small">
          <Text>Loading lookups…</Text>
        </InlineStack>
      ) : (
        <BlockStack gap>
          <TextField
            label="Order ID"
            value={form.orderId}
            onChange={onChange("orderId")}
          />

          <Select
            label="Return Type"
            value={form.returnType}
            onChange={onChange("returnType")}
            options={returnTypeOptions}
          />

          <Select
            label="Troubleshooting Category"
            value={form.troubleshootingCategory}
            onChange={onChange("troubleshootingCategory")}
            options={troubleshootingCategoryOptions}
          />

          <Select
            label="Customer Reported Reason Category"
            value={form.primaryReason}
            onChange={onChange("primaryReason")}
            options={primaryReasonOptions}
          />

          <DateField
            label="Trouble Occurred On"
            value={form.troubleOccurredOn}
            onChange={onChange("troubleOccurredOn")}
          />

          <TextField
            label="Associated Serial #"
            value={form.associatedSerialNumber}
            onChange={onChange("associatedSerialNumber")}
          />

          <Checkbox
            label="Troubleshooting Performed"
            checked={form.hasTroubleshooting}
            onChange={(v) => setForm((p) => ({ ...p, hasTroubleshooting: v }))}
          />

          <TextArea
            label="Customer Reported Info"
            value={form.customerReportedInfo}
            onChange={onChange("customerReportedInfo")}
            maxLength={2000}
          />

          <InlineStack gap>
            <Button kind="primary" onPress={handleSave} disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </InlineStack>
        </BlockStack>
      )}

      <Divider />
      <Text size="small" emphasis="subdued">
        Tip: In preview, tokens may be unavailable; the dropdowns may stay empty until loaded in Admin.
      </Text>
    </BlockStack>
  );
}
