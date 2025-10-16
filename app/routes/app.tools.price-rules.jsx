// app/routes/app.tools.price-rules.jsx
import { json } from "@remix-run/node";
import { useLoaderData, useSearchParams, Form } from "@remix-run/react";
import { useCallback } from "react";
import { authenticate } from "../shopify.server";

import {
  Page,
  Layout,
  Card,
  TextField,
  IndexTable,
  InlineStack,
  Button,
  Text,
  Badge,
  Box,
  Banner,
} from "@shopify/polaris";

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);

  if (process.env.ENABLE_DEV_TOOLS !== "1") {
    throw new Response("Not Found", { status: 404 });
  }

  const url = new URL(request.url);
  const q = (url.searchParams.get("q") || "").trim().toLowerCase();
  const limit = Math.min(Number(url.searchParams.get("limit") || 50), 100);

  try {
    // ✅ Use the session returned from authenticate.admin
    const rules = await admin.rest.resources.PriceRule.all({ session, limit });

    const items = (rules || [])
      .map((r) => ({
        id: r.id,
        title: r.title || "(untitled)",
        value_type: r.value_type,            // "percentage" | "fixed_amount"
        value: r.value,                      // negative number (e.g. "-10.0")
        allocation_method: r.allocation_method, // "each" | "across"
        usage_limit: r.usage_limit ?? null,
        starts_at: r.starts_at || null,
        ends_at: r.ends_at || null,
        created_at: r.created_at || null,
      }))
      .filter((r) => (q ? r.title.toLowerCase().includes(q) : true));

    return json({ items, q, limit });
  } catch (e) {
    // Return a friendly payload instead of letting Remix 500
    const raw =
      e?.response?.body?.errors ??
      e?.response?.body ??
      e?.message ??
      "Unknown Admin API error";
    return json({ items: [], q, limit, error: raw });
  }
};

export const meta = () => [{ title: "Price Rules (Dev Tools)" }];

function statusFor({ starts_at, ends_at }) {
  const now = Date.now();
  const start = starts_at ? Date.parse(starts_at) : null;
  const end = ends_at ? Date.parse(ends_at) : null;

  if (end && end < now) return { tone: "critical", label: "Expired" };
  if (start && start > now) return { tone: "attention", label: "Scheduled" };
  return { tone: "success", label: "Active" };
}

function formatValue({ value_type, value }) {
  if (value_type === "percentage") {
    const pct = Math.abs(Number(value));
    return `${pct}% off`;
  }
  return `${Math.abs(Number(value)).toFixed(2)} off`;
}

export default function PriceRulesTool() {
  const { items = [], q = "", error } = useLoaderData();
  const [searchParams] = useSearchParams();

  const rows = items.map((r, idx) => {
    const s = statusFor(r);
    const genUrl = `/app/tools/generate-discount?priceRuleId=${r.id}&prefix=RSL-&length=10`;
    return (
      <IndexTable.Row id={String(r.id)} key={r.id} position={idx}>
        <IndexTable.Cell>
          <Text as="span" variant="bodyMd" fontWeight="semibold">
            {r.title}
          </Text>
          <Box as="div" paddingBlockStart="100">
            <Text as="span" variant="bodySm" tone="subdued">
              ID: {r.id}
            </Text>
          </Box>
        </IndexTable.Cell>
        <IndexTable.Cell>
          <Badge tone={s.tone}>{s.label}</Badge>
        </IndexTable.Cell>
        <IndexTable.Cell>
          <Text as="span" variant="bodyMd">{formatValue(r)}</Text>
          <Box as="div" paddingBlockStart="050">
            <Text as="span" variant="bodySm" tone="subdued">
              {r.allocation_method === "across" ? "Across cart" : "Each item"}
            </Text>
          </Box>
        </IndexTable.Cell>
        <IndexTable.Cell>
          <Text as="span" variant="bodyMd">{r.usage_limit ?? "—"}</Text>
        </IndexTable.Cell>
        <IndexTable.Cell>
          <InlineStack gap="200">
            <Button
              onClick={() => navigator.clipboard?.writeText(String(r.id))}
              accessibilityLabel="Copy Price Rule ID"
            >
              Copy ID
            </Button>
            <Button url={genUrl} variant="primary">
              Use this
            </Button>
          </InlineStack>
        </IndexTable.Cell>
      </IndexTable.Row>
    );
  });

  const initialQuery = q || searchParams.get("q") || "";

  const renderHeader = useCallback(
    () => (
      <Form method="get">
        <InlineStack align="start" gap="400">
          <TextField
            label="Search by title"
            labelHidden
            name="q"
            defaultValue={initialQuery}
            autoComplete="off"
            placeholder="Search price rules…"
          />
          <Button submit>Search</Button>
          <Button variant="plain" url="/app/tools/price-rules">
            Reset
          </Button>
        </InlineStack>
      </Form>
    ),
    [initialQuery]
  );

  return (
    <Page title="Price Rules (Dev Tools)">
      <Layout>
        {error && (
          <Layout.Section>
            <Banner tone="critical" title="Failed to load price rules">
              <p style={{ whiteSpace: "pre-wrap" }}>
                {typeof error === "string" ? error : JSON.stringify(error, null, 2)}
              </p>
              <p style={{ marginTop: 8 }}>
                Tip: ensure the app has the necessary Discounts/Price Rules read scope and you’re
                logged in as staff on the correct shop.
              </p>
            </Banner>
          </Layout.Section>
        )}

        <Layout.Section>
          <Card>
            <Box padding="400">
              <Text as="p" variant="bodyMd">
                Pick a Price Rule, then click <em>Use this</em> to open the generator with the ID
                pre-filled.
              </Text>
              <Box paddingBlockStart="300">{renderHeader()}</Box>
            </Box>
            <IndexTable
              resourceName={{ singular: "price rule", plural: "price rules" }}
              itemCount={rows.length}
              headings={[
                { title: "Title" },
                { title: "Status" },
                { title: "Value" },
                { title: "Usage limit" },
                { title: "Actions" },
              ]}
              selectable={false}
            >
              {rows}
            </IndexTable>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
