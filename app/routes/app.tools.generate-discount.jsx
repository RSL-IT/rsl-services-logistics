// app/routes/app.tools.generate-discount.jsx
import { json } from "@remix-run/node";
import { useFetcher, useLocation } from "@remix-run/react";
import { useEffect, useState } from "react";
import { authenticate } from "../shopify.server";

import {
  Page,
  Layout,
  Card,
  TextField,
  InlineStack,
  Box,
  Button,
  Text,
  Banner,
} from "@shopify/polaris";

export const loader = async ({ request }) => {
  // Staff-only (requires embedded admin session)
  await authenticate.admin(request);

  // Hide this tool unless explicitly enabled
  if (process.env.ENABLE_DEV_TOOLS !== "1") {
    throw new Response("Not Found", { status: 404 });
  }
  return json({});
};

export const meta = () => [{ title: "Generate Discount Code (Test)" }];

export default function GenerateDiscountCodeTool() {
  const fetcher = useFetcher();
  const location = useLocation();
  const [form, setForm] = useState({
    priceRuleId: "",
    expiresAt: "",    // e.g. 2025-12-31T23:59:59-08:00
    usageLimit: "1",  // integer >= 1
    prefix: "RSL-",
    length: "10",
  });

  // Prefill from query params when navigated from the Price Rule list
  useEffect(() => {
    const sp = new URLSearchParams(location.search);
    setForm((s) => ({
      ...s,
      priceRuleId: sp.get("priceRuleId") ?? s.priceRuleId,
      prefix: sp.get("prefix") ?? s.prefix,
      length: sp.get("length") ?? s.length,
    }));
    // run once on mount for current URL
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onChange = (key) => (value) => setForm((s) => ({ ...s, [key]: value }));
  const busy = fetcher.state !== "idle";
  const resp = fetcher.data;
  const error =
    resp && typeof resp === "object" && "error" in resp ? resp.error : null;

  return (
    <Page title="Generate Discount Code (Test)">
      <Layout>
        {error && (
          <Layout.Section>
            <Banner tone="critical" title="Error">
              <p style={{ whiteSpace: "pre-wrap" }}>
                {typeof error === "string"
                  ? error
                  : JSON.stringify(error, null, 2)}
              </p>
            </Banner>
          </Layout.Section>
        )}

        <Layout.Section>
          <Card>
            <Box padding="400">
              <fetcher.Form method="post" action="/api/generate-discount-code">
                <InlineStack align="start" gap="400" wrap={false}>
                  <TextField
                    label="Price Rule ID"
                    value={form.priceRuleId}
                    onChange={onChange("priceRuleId")}
                    name="priceRuleId"
                    autoComplete="off"
                    requiredIndicator
                  />
                  <TextField
                    label="Expires At (ISO8601)"
                    helpText="Example: 2025-12-31T23:59:59-08:00"
                    value={form.expiresAt}
                    onChange={onChange("expiresAt")}
                    name="expiresAt"
                    autoComplete="off"
                    requiredIndicator
                  />
                  <TextField
                    label="Usage Limit (integer)"
                    value={form.usageLimit}
                    onChange={onChange("usageLimit")}
                    name="usageLimit"
                    type="number"
                    min={1}
                    autoComplete="off"
                    requiredIndicator
                  />
                </InlineStack>

                <Box paddingBlockStart="400">
                  <InlineStack align="start" gap="400" wrap={false}>
                    <TextField
                      label="Prefix"
                      value={form.prefix}
                      onChange={onChange("prefix")}
                      name="prefix"
                      autoComplete="off"
                    />
                    <TextField
                      label="Length"
                      value={form.length}
                      onChange={onChange("length")}
                      name="length"
                      type="number"
                      min={4}
                      max={24}
                      autoComplete="off"
                    />
                    <Button submit variant="primary" loading={busy}>
                      Create code
                    </Button>
                  </InlineStack>
                </Box>
              </fetcher.Form>
            </Box>
          </Card>
        </Layout.Section>

        {resp && !error && (
          <Layout.Section>
            <Card>
              <Box padding="400">
                <Text as="h3" variant="headingMd">
                  Response
                </Text>
                <pre style={{ whiteSpace: "pre-wrap", marginTop: 12 }}>
{JSON.stringify(resp, null, 2)}
                </pre>
              </Box>
            </Card>
          </Layout.Section>
        )}
      </Layout>
    </Page>
  );
}
