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
import { useEffect, useMemo, useRef, useState } from "react";

const DEBUG = true; // set to false when you're done debugging
const TARGET = "admin.order-details.block.render";

// Prefer CLI tunnel via __APP_URL__, then Vite var, then Fly
const BASE_URL =
  (typeof __APP_URL__ !== "undefined" && __APP_URL__) ||
  (typeof globalThis !== "undefined" && globalThis.__APP_URL__) ||
  "https://rsl-services-app.fly.dev";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function getSessionTokenWithRetry(shopify, attempts = 10) {
  for (let i = 0; i < attempts; i++) {
    try {
      // Call with no args for widest compatibility
      const t = shopify?.sessionToken?.get ? await shopify.sessionToken.get() : null;
      if (t) return t;
    } catch {
      /* ignore and retry */
    }
    await sleep(150 + i * 200);
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
  troubleshootingCategory: { value: "", label: "Set troubleshooting category" },
  primaryReason: { value: "", label: "Set customer reason" },
};

const DEFAULT_STATE = {
  // Hidden but stored
  orderId: "",
  orderGid: "",
  customerGid: "",
  userGid: "",
  customerName: "",
  csrUsername: "",

  // Visible inputs
  returnType: PLACEHOLDERS.returnType.value,
  primaryReason: PLACEHOLDERS.primaryReason.value,
  troubleOccurredOn: todayISO(),

  hasTroubleshooting: false,
  troubleshootingCategory: PLACEHOLDERS.troubleshootingCategory.value,
  associatedSerialNumber: "",
  customerReportedInfo: "",
};

function normalizeOptions(rows, placeholder) {
  const opts = Array.isArray(rows)
    ? rows.map(({ id, label }) => ({ value: String(id), label: String(label ?? id) }))
    : [];
  return [placeholder, ...opts];
}

async function fetchLookupsOnce(shopify, { timeoutMs = 10000, signal } = {}) {
  const token = await getSessionTokenWithRetry(shopify);
  const url = `${BASE_URL}/apps/returns/lookups?sets=returnTypes,troubleshootingCategories,primaryReasons`;
  const headers = token ? { Authorization: `Bearer ${token}` } : {};

  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort();
  signal?.addEventListener?.("abort", onAbort, { once: true });
  const to = setTimeout(() => ctrl.abort(), timeoutMs);

  try {
    const res = await fetch(url, { headers, signal: ctrl.signal });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      throw new Error(`Lookups fetch failed ${res.status}: ${t}`);
    }
    return await res.json();
  } finally {
    clearTimeout(to);
    signal?.removeEventListener?.("abort", onAbort);
  }
}

export default reactExtension(TARGET, () => <BlockExtension />);

function BlockExtension() {
  const shopify = useApi(TARGET); // { data, query, sessionToken, toast, ... }

  // state
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [error, setError] = useState(null);

  const [lookups, setLookups] = useState({
    returnTypes: [],
    troubleshootingCategories: [],
    primaryReasons: [],
  });
  const [lookupsLoading, setLookupsLoading] = useState(false);
  const [lookupsLoaded, setLookupsLoaded] = useState(false);
  const lookupsAbortRef = useRef(null);

  const [form, setForm] = useState(DEFAULT_STATE);
  const [isOpen, setIsOpen] = useState(false); // collapsed by default
  const [adminTokenReady, setAdminTokenReady] = useState(false);

  const onChange = (key) => (value) => setForm((prev) => ({ ...prev, [key]: value }));

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

  // 🔇 Quiet prefetch at mount
  useEffect(() => {
    if (lookupsLoaded || lookupsLoading) return;

    const abort = new AbortController();
    lookupsAbortRef.current = abort;
    setLookupsLoading(true);
    setError(null);

    fetchLookupsOnce(shopify, { timeoutMs: 10000, signal: abort.signal })
      .then((data) => {
        setLookups({
          returnTypes: Array.isArray(data.returnTypes) ? data.returnTypes : [],
          troubleshootingCategories: Array.isArray(data.troubleshootingCategories)
            ? data.troubleshootingCategories
            : [],
          primaryReasons: Array.isArray(data.primaryReasons) ? data.primaryReasons : [],
        });
        setLookupsLoaded(true);
      })
      .catch((e) => {
        if (DEBUG) console.warn("Prefetch lookups failed:", e);
      })
      .finally(() => {
        setLookupsLoading(false);
        lookupsAbortRef.current = null;
      });

    return () => {
      abort.abort();
      lookupsAbortRef.current = null;
    };
  }, [shopify, lookupsLoaded, lookupsLoading]);

  // ▶️ When opening, ensure lookups are present; also probe token
  useEffect(() => {
    if (!isOpen) return;
    (async () => {
      const t = await getSessionTokenWithRetry(shopify);
      setAdminTokenReady(!!t);
      if (DEBUG) console.info("Admin token present?", !!t);
    })();

    if (lookupsLoaded) return;

    if (lookupsAbortRef.current) {
      try {
        lookupsAbortRef.current.abort();
      } catch {}
      lookupsAbortRef.current = null;
    }

    const abort = new AbortController();
    lookupsAbortRef.current = abort;
    setLookupsLoading(true);
    setError(null);

    fetchLookupsOnce(shopify, { timeoutMs: 12000, signal: abort.signal })
      .then((data) => {
        setLookups({
          returnTypes: Array.isArray(data.returnTypes) ? data.returnTypes : [],
          troubleshootingCategories: Array.isArray(data.troubleshootingCategories)
            ? data.troubleshootingCategories
            : [],
          primaryReasons: Array.isArray(data.primaryReasons) ? data.primaryReasons : [],
        });
        setLookupsLoaded(true);
      })
      .catch((e) => setError(e.message))
      .finally(() => {
        setLookupsLoading(false);
        lookupsAbortRef.current = null;
      });
  }, [isOpen, shopify, lookupsLoaded]);

  // Auto-fill hidden order/customer/user identifiers (only when opening)
  useEffect(() => {
    if (!isOpen) return;

    const orderGid = shopify?.data?.selected?.[0]?.id;
    if (orderGid && !form.orderGid) {
      setForm((p) => ({ ...p, orderGid }));
    }

    if (typeof shopify?.query === "function" && orderGid) {
      (async () => {
        try {
          // Get order display name + customer IDs/names
          const { data } = await shopify.query(
            /* GraphQL */ `
              query OrderInfo($id: ID!) {
                order(id: $id) {
                  id
                  name
                  legacyResourceId
                  customer {
                    id
                    displayName
                    firstName
                    lastName
                  }
                }
              }
            `,
            { variables: { id: orderGid } }
          );
          const o = data?.order;
          const display =
            o?.name || (o?.legacyResourceId ? String(o.legacyResourceId) : orderGid);
          const cust = o?.customer;
          const custName =
            cust?.displayName ||
            [cust?.firstName, cust?.lastName].filter(Boolean).join(" ") ||
            "";

          setForm((p) => ({
            ...p,
            orderId: p.orderId || display,
            customerGid: p.customerGid || cust?.id || "",
            customerName: p.customerName || custName,
          }));
        } catch {
          setForm((p) => ({
            ...p,
            orderId: p.orderId || orderGid,
          }));
        }

        try {
          // Current staff user (for CSR fields)
          const { data: me } = await shopify.query(
            /* GraphQL */ `
              query CurrentUser {
                currentUser {
                  id
                  displayName
                  firstName
                  lastName
                  email
                }
              }
            `
          );
          const u = me?.currentUser;
          const name =
            u?.displayName ||
            [u?.firstName, u?.lastName].filter(Boolean).join(" ") ||
            u?.email ||
            "";
          setForm((p) => ({
            ...p,
            userGid: p.userGid || u?.id || "",
            csrUsername: p.csrUsername || name,
          }));
        } catch {
          /* ignore */
        }
      })();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shopify?.data, isOpen]);

  /**
   * Ensure we have CSR identity JUST-IN-TIME for saving.
   * Returns the identity so handleSave can use it immediately.
   * Also updates state for UI, but handleSave must use the returned values.
   */
  async function ensureActorIdentity() {
    let userGid = form.userGid;
    let csrUsername = form.csrUsername;

    if (userGid && csrUsername) return { userGid, csrUsername };
    if (typeof shopify?.query !== "function") return { userGid, csrUsername };

    try {
      const { data: me } = await shopify.query(
        /* GraphQL */ `
          query CurrentUser {
            currentUser {
              id
              displayName
              firstName
              lastName
              email
            }
          }
        `
      );
      const u = me?.currentUser;
      const name =
        u?.displayName ||
        [u?.firstName, u?.lastName].filter(Boolean).join(" ") ||
        u?.email ||
        "";
      userGid = userGid || u?.id || "";
      csrUsername = csrUsername || name;

      setForm((p) => ({ ...p, userGid, csrUsername }));
    } catch {
      // ignore; return whatever we have
    }
    return { userGid, csrUsername };
  }

  function resetForAnother() {
    // Clear the visible inputs but preserve hidden context (order/user/customer)
    setForm((p) => ({
      ...DEFAULT_STATE,
      orderId: p.orderId,
      orderGid: p.orderGid,
      customerGid: p.customerGid,
      userGid: p.userGid,
      customerName: p.customerName,
      csrUsername: p.csrUsername,
      troubleOccurredOn: todayISO(),
    }));
  }

  function toggleOpen() {
    if (isOpen) {
      setForm(DEFAULT_STATE);
      setIsOpen(false);
    } else {
      setIsOpen(true);
    }
  }

  // ---- Save gating & label logic ----
  const essentialFieldsSelected = Boolean(form.returnType) || Boolean(form.primaryReason);
  const preconditionsMet = lookupsLoaded && essentialFieldsSelected;
  const saveDisabled = !preconditionsMet || saving || saveSuccess;
  const saveLabel = saving ? "Saving…" : saveSuccess ? "Save successful" : "Save";

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      // Fetch identity JUST-IN-TIME and use it directly
      const { userGid, csrUsername } = await ensureActorIdentity();

      // Try for a fresh Admin token (server will use it to fill CSR if needed)
      const token = await getSessionTokenWithRetry(shopify);
      setAdminTokenReady(!!token);

      const toIntOrNull = (v) => {
        const n = parseInt(v, 10);
        return Number.isFinite(n) ? n : null;
      };

      const payload = {
        // FKs (Int)
        return_type_id: toIntOrNull(form.returnType),
        primary_customer_reason_id: toIntOrNull(form.primaryReason),

        // Shopify identifiers (GIDs)
        original_order_gid: form.orderGid || null,
        customer_gid: form.customerGid || null,
        rsl_csr_gid: userGid || null, // <- use resolved identity

        // Business fields
        original_order: form.orderId || null,
        customer_name: form.customerName || null,
        rsl_csr: csrUsername || null, // <- use resolved identity
        serial_number: form.associatedSerialNumber || null,
      };

      if (DEBUG) {
        console.info("SAVE payload identity:", {
          rsl_csr_gid: payload.rsl_csr_gid,
          rsl_csr: payload.rsl_csr,
          adminTokenReady,
          tokenPresentForThisCall: !!token,
        });
      }

      const headers = { "Content-Type": "application/json" };
      if (token) headers.Authorization = `Bearer ${token}`;

      const res = await fetch(`${BASE_URL}/apps/returns/save`, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        throw new Error(`Save failed ${res.status}: ${txt}`);
      }

      // ✅ Success: show temporary success label, disable button, then reset
      setSaveSuccess(true);
      resetForAnother();
      setTimeout(() => setSaveSuccess(false), 1500);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Box padding="none" maxBlockSize={isOpen ? 520 : 80}>
      <BlockStack gap="small">
        {/* Toggle button always visible */}
        <InlineStack gap="small">
          <Button kind={isOpen ? "secondary" : "primary"} onPress={toggleOpen}>
            {isOpen ? "Cancel RSL Return Data Entry" : "Enter RSL Return Data"}
          </Button>
          {!isOpen && !lookupsLoaded && lookupsLoading && <Text>…</Text>}
        </InlineStack>

        {/* Hidden until opened */}
        {isOpen && (
          <BlockStack gap="small">
            {error && (
              <InlineStack gap="small">
                <Text emphasis>Problem</Text>
                <Text>{String(error)}</Text>
                <Button
                  kind="secondary"
                  onPress={() => {
                    setError(null);
                    setLookupsLoaded(false); // trigger refetch on next open
                  }}
                >
                  Retry
                </Button>
              </InlineStack>
            )}

            {!lookupsLoaded && lookupsLoading ? (
              <InlineStack gap="small">
                <Text>Preparing …</Text>
              </InlineStack>
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

                {/* Row 2: Troubleshooting performed (checkbox only; label must not wrap) */}
                <InlineStack gap="small" blockAlignment="center">
                  <Box minInlineSize="40ch" maxInlineSize="100%">
                    <Checkbox
                      label="Troubleshooting performed"
                      checked={form.hasTroubleshooting}
                      onChange={(v) => setForm((p) => ({ ...p, hasTroubleshooting: v }))}
                    />
                  </Box>
                </InlineStack>

                {/* Row 3: Troubleshooting Category | Serial # (only when checked; 50/50 split) */}
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

                {/* Notes always visible when open, with dynamic label */}
                <TextArea
                  label={
                    form.hasTroubleshooting
                      ? "Customer reported info / troubleshooting steps"
                      : "Customer reported info"
                  }
                  value={form.customerReportedInfo}
                  onChange={onChange("customerReportedInfo")}
                  maxLength={2000}
                />

                {/* Optional hint if identity missing / no token */}
                {DEBUG && (!Boolean(form.userGid && form.csrUsername) || !adminTokenReady) && (
                  <Text appearance="subdued" size="small">
                    {adminTokenReady
                      ? "CSR identity not available; saving will omit CSR fields unless opened in Admin."
                      : "No Admin token detected — CSR may be blank with dev bypass. Open in Admin to record user."}
                  </Text>
                )}

                {/* Optional debug context */}
                {DEBUG && (
                  <InlineStack gap="small">
                    <Text>
                      host: {globalThis.location?.host || "?"} · ref:{" "}
                      {typeof document !== "undefined" ? document.referrer || "?" : "?"}
                    </Text>
                    <Button
                      onPress={async () => {
                        const t = await getSessionTokenWithRetry(shopify);
                        if (t) {
                          try {
                            await navigator.clipboard.writeText(t);
                          } catch {}
                          shopify?.toast?.show?.("Session token copied");
                          console.info("SESSION_TOKEN:", t);
                        } else {
                          shopify?.toast?.show?.("No token in this context");
                          console.info("No token available in this context");
                        }
                      }}
                    >
                      Copy Admin token
                    </Button>
                  </InlineStack>
                )}

                <InlineStack gap="small">
                  <Button
                    kind="primary"
                    onPress={handleSave}
                    disabled={
                      (!lookupsLoaded || (!form.returnType && !form.primaryReason)) ||
                      saving ||
                      saveSuccess
                    }
                  >
                    {saveLabel}
                  </Button>
                </InlineStack>
              </BlockStack>
            )}
          </BlockStack>
        )}
      </BlockStack>
    </Box>
  );
}
