// /app/routes/app.returns.jsx
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { prisma } from "../db.server";
import { authenticate } from "../shopify.server";
import {
  Page,
  Layout,
  Card,
  Tabs,
  IndexTable,
  Text,
} from "@shopify/polaris";
import { useMemo, useState } from "react";

// ───────────────────────────────────────────────────────────────────────────────
// Loader: fetch dashboard rows (limit to 200 most recent)
// ───────────────────────────────────────────────────────────────────────────────
export async function loader({ request }) {
  // Ensure this page is only viewed inside Shopify Admin
  await authenticate.admin(request);

  // Query the actual DB tables with SQL; join lookups for item, return_type, and status
  const rows = await prisma.$queryRaw`
    SELECT
      re.id,
      re.date_requested,
      re.date_received,
      re.date_inspected,
      re.original_order,
      re.customer_name,
      re.item_id,
      re.return_type_id,
      re.status_id,
      ci.value  AS item,
      crt.value AS return_type,
      rstat.value AS status
    FROM return_entry re
    LEFT JOIN csd_item ci                               ON ci.id   = re.item_id
    LEFT JOIN csd_return_type crt                       ON crt.id  = re.return_type_id
    LEFT JOIN repair_entry_returns_repair_status rstat  ON rstat.id = re.status_id
    ORDER BY re.date_requested DESC NULLS LAST, re.id DESC
    LIMIT 200
  `;

  return json({ rows });
}

// ───────────────────────────────────────────────────────────────────────────────
// Component
// ───────────────────────────────────────────────────────────────────────────────
export default function ReturnsPage() {
  const { rows } = useLoaderData();

  // Tabs: 0 = Dashboard, 1 = Inspection (placeholder)
  const [selected, setSelected] = useState(0);
  const tabs = useMemo(
    () => [
      { id: "dashboard", content: "Dashboard" },
      { id: "inspection", content: "Inspection" },
    ],
    []
  );

  return (
    <Page title="RSL Services - Returns">
      <Layout>
        <Layout.Section>
          <Card>
            <Tabs tabs={tabs} selected={selected} onSelect={setSelected}>
              {selected === 0 ? (
                <DashboardTable rows={rows} />
              ) : (
                <Placeholder />
              )}
            </Tabs>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}

// ───────────────────────────────────────────────────────────────────────────────
// Dashboard table
// ───────────────────────────────────────────────────────────────────────────────
function DashboardTable({ rows }) {
  const items = Array.isArray(rows) ? rows : [];

  return (
    <IndexTable
      resourceName={{ singular: "return", plural: "returns" }}
      itemCount={items.length}
      headings={[
        { title: "Date requested" }, // existing first column
        { title: "Date Received" },  // new second column
        { title: "Date Inspected" }, // new third column
        { title: "Original order" },
        { title: "Customer name" },
        { title: "Item" },
        { title: "Return type" },
        { title: "Status" },         // new last column
      ]}
      selectable={false}
    >
      {items.map((r, i) => (
        <IndexTable.Row id={String(r.id)} key={r.id} position={i}>
          {/* Date requested */}
          <IndexTable.Cell>
            <Text as="span" variant="bodyMd">
              {formatDate(r.date_requested)}
            </Text>
          </IndexTable.Cell>

          {/* Date Received (or "not yet received") */}
          <IndexTable.Cell>
            <Text as="span" variant="bodyMd">
              {r.date_received ? formatDate(r.date_received) : "not yet received"}
            </Text>
          </IndexTable.Cell>

          {/* Date Inspected with conditional phrasing */}
          <IndexTable.Cell>
            <Text as="span" variant="bodyMd">
              {formatInspected(r.date_inspected, r.date_received)}
            </Text>
          </IndexTable.Cell>

          {/* Original order */}
          <IndexTable.Cell>
            <Text as="span" variant="bodyMd">{r.original_order ?? "—"}</Text>
          </IndexTable.Cell>

          {/* Customer name */}
          <IndexTable.Cell>
            <Text as="span" variant="bodyMd">{r.customer_name ?? "—"}</Text>
          </IndexTable.Cell>

          {/* Item (lookup text) */}
          <IndexTable.Cell>
            <Text as="span" variant="bodyMd">{r.item ?? "—"}</Text>
          </IndexTable.Cell>

          {/* Return type (lookup text) */}
          <IndexTable.Cell>
            <Text as="span" variant="bodyMd">{r.return_type ?? "—"}</Text>
          </IndexTable.Cell>

          {/* Status (lookup text) */}
          <IndexTable.Cell>
            <Text as="span" variant="bodyMd">{r.status ?? "—"}</Text>
          </IndexTable.Cell>
        </IndexTable.Row>
      ))}
    </IndexTable>
  );
}

// ───────────────────────────────────────────────────────────────────────────────
// Inspection placeholder
// ───────────────────────────────────────────────────────────────────────────────
function Placeholder() {
  return (
    <div style={{ padding: "1rem" }}>
      <Text as="p" variant="bodyMd" tone="subdued">
        Return Inspection Under Development
      </Text>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────────
// Utils
// ───────────────────────────────────────────────────────────────────────────────
function formatDate(d) {
  if (!d) return "—";
  try {
    const dateObj = d instanceof Date ? d : new Date(d);
    return dateObj.toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "2-digit",
    });
  } catch {
    return String(d);
  }
}

// Date Inspected rules:
// - both null  => "not yet received"
// - inspected set & received null => "pending"
// - inspected set & received set  => inspected date
// - inspected null & received set => "—"
function formatInspected(dateInspected, dateReceived) {
  const hasInspected = Boolean(dateInspected);
  const hasReceived = Boolean(dateReceived);

  if (!hasInspected && !hasReceived) return "not yet received";
  if (hasInspected && !hasReceived) return "pending";
  if (hasInspected && hasReceived) return formatDate(dateInspected);
  // no inspected but yes received
  return "—";
}
