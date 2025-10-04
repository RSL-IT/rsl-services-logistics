// /app/routes/app.returns.jsx
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { prisma } from "../db.server";
import { authenticate } from "../shopify.server";
import {
  Page,
  Card,
  Tabs,
  IndexTable,
  Text,
  TextField,
  Button,
} from "@shopify/polaris";
import { useEffect, useMemo, useState } from "react";

// ───────────────────────────────────────────────────────────────────────────────
// Loader: fetch dashboard rows (limit to 200 most recent)
// ───────────────────────────────────────────────────────────────────────────────
export async function loader({ request }) {
  await authenticate.admin(request);

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

  // Lookup Panel state
  const [trackingNumber, setTrackingNumber] = useState("");
  const [serialNumber, setSerialNumber] = useState("");
  const hasLookupInput =
    trackingNumber.trim().length > 0 || serialNumber.trim().length > 0;

  function onLookup() {
    // Wire to filter/navigate/fetch as needed
    console.log("Lookup triggered:", { trackingNumber, serialNumber });
  }

  return (
    <Page fullWidth title="RSL Services - Returns">
      {/* Custom flex row to guarantee >=20px gap and right card fills space */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-start", // top-align cards
          gap: 20,                  // >= 20px between cards
        }}
      >
        {/* Left: fixed-width Lookup Panel */}
        <div style={{ width: 320, maxWidth: 320, flex: "0 0 auto" }}>
          <Card title="Lookup Panel" sectioned>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
              <TextField
                label="Tracking Number"
                value={trackingNumber}
                onChange={setTrackingNumber}
                autoComplete="off"
              />
              <div style={{ textAlign: "center" }}>
                <Text as="p" variant="bodyMd">OR</Text>
              </div>
              <TextField
                label="Serial Number"
                value={serialNumber}
                onChange={setSerialNumber}
                autoComplete="off"
              />
              {hasLookupInput && (
                <div style={{ marginTop: "0.75rem" }}>
                  <Button fullWidth onClick={onLookup}>
                    Lookup Order
                  </Button>
                </div>
              )}
            </div>
          </Card>
        </div>

        {/* Right: table/tabs fills remaining viewport width */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <Card>
            <Tabs tabs={tabs} selected={selected} onSelect={setSelected}>
              {selected === 0 ? (
                <DashboardTable rows={rows} />
              ) : (
                <Placeholder />
              )}
            </Tabs>
          </Card>
        </div>
      </div>
    </Page>
  );
}

// ───────────────────────────────────────────────────────────────────────────────
// Dashboard table
// ───────────────────────────────────────────────────────────────────────────────
function DashboardTable({ rows }) {
  const items = Array.isArray(rows) ? rows : [];

  // After render, paint each <tr> to ensure background wins over Polaris styles
  useEffect(() => {
    const COLORS = {
      green: "rgba(16, 128, 67, 0.16)",
      yellow: "rgba(245, 158, 11, 0.22)",
      red: "rgba(220, 53, 69, 0.18)",
    };
    // Find per-cell wrappers tagged with data-age-color and color the row
    const nodes = document.querySelectorAll('.age-bg[data-age-color]');
    nodes.forEach((node) => {
      const colorKey = node.getAttribute('data-age-color');
      const tr = node.closest('tr');
      if (!tr) return;
      if (colorKey && COLORS[colorKey]) {
        tr.style.backgroundColor = COLORS[colorKey];
      } else {
        tr.style.backgroundColor = ""; // reset if no color
      }
    });
  }, [items]); // rerun when items array identity changes

  return (
    <IndexTable
      resourceName={{ singular: "return", plural: "returns" }}
      itemCount={items.length}
      headings={[
        { title: "Date requested" },
        { title: "Date Received" },
        { title: "Age" }, // Always defined as: days since Date Received
        { title: "Date Inspected" },
        { title: "Original order" },
        { title: "Customer name" },
        { title: "Item" },
        { title: "Return type" },
        { title: "Status" },
      ]}
      selectable={false}
    >
      {items.map((r, i) => {
        // --- Coloring rules use ONLY Date Received ---
        // If no Date Received -> no color
        const colorAge = r.date_received ? daysSince(r.date_received) : null;
        const colorName = colorNameForAgeStrict(colorAge);

        // Displayed age remains strictly "since Date Received"
        const displayAge = r.date_received ? colorAge : null;

        // Wrapper style to help visually even before effect runs
        const wrapperStyle = wrapperStyleForColor(colorName);

        // Helper to render a cell with the background wrapper
        const Cell = ({ children }) => (
          <div
            className="age-bg"
            data-age-color={colorName || ""}
            style={wrapperStyle}
          >
            {children}
          </div>
        );

        return (
          <IndexTable.Row id={String(r.id)} key={r.id} position={i}>
            <IndexTable.Cell>
              <Cell>
                <Text as="span" variant="bodyMd">
                  {formatDate(r.date_requested)}
                </Text>
              </Cell>
            </IndexTable.Cell>

            <IndexTable.Cell>
              <Cell>
                <Text as="span" variant="bodyMd">
                  {r.date_received ? formatDate(r.date_received) : "not yet received"}
                </Text>
              </Cell>
            </IndexTable.Cell>

            <IndexTable.Cell>
              <Cell>
                <Text as="span" variant="bodyMd">
                  {displayAge === null ? "—" : `${displayAge}d`}
                </Text>
              </Cell>
            </IndexTable.Cell>

            <IndexTable.Cell>
              <Cell>
                <Text as="span" variant="bodyMd">
                  {/* Always dash when there is no inspected date */}
                  {r.date_inspected ? formatDate(r.date_inspected) : "—"}
                </Text>
              </Cell>
            </IndexTable.Cell>

            <IndexTable.Cell>
              <Cell>
                <Text as="span" variant="bodyMd">{r.original_order ?? "—"}</Text>
              </Cell>
            </IndexTable.Cell>

            <IndexTable.Cell>
              <Cell>
                <Text as="span" variant="bodyMd">{r.customer_name ?? "—"}</Text>
              </Cell>
            </IndexTable.Cell>

            <IndexTable.Cell>
              <Cell>
                <Text as="span" variant="bodyMd">{r.item ?? "—"}</Text>
              </Cell>
            </IndexTable.Cell>

            <IndexTable.Cell>
              <Cell>
                <Text as="span" variant="bodyMd">{r.return_type ?? "—"}</Text>
              </Cell>
            </IndexTable.Cell>

            <IndexTable.Cell>
              <Cell>
                <Text as="span" variant="bodyMd">{r.status ?? "—"}</Text>
              </Cell>
            </IndexTable.Cell>
          </IndexTable.Row>
        );
      })}
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

// Map numeric age → color with STRICT rules (use only Date Received)
function colorNameForAgeStrict(age) {
  if (age === null || age === undefined) return null; // no Date Received → no color
  if (age === 1 || age === 2) return "green";         // 1–2 days
  if (age === 3) return "yellow";                     // exactly 3 days
  if (age > 3) return "red";                          // more than 3 days
  // age 0 (received today) or any other case → no color
  return null;
}

// Background style for the inner wrapper so you see color even before the effect runs
function wrapperStyleForColor(colorName) {
  if (!colorName) return undefined;
  const colorMap = {
    green: "rgba(16, 128, 67, 0.16)",
    yellow: "rgba(245, 158, 11, 0.22)",
    red: "rgba(220, 53, 69, 0.18)",
  };
  // Fill the cell area by offsetting Polaris padding
  return {
    backgroundColor: colorMap[colorName],
    display: "block",
    padding: "8px 12px",
    margin: "-8px -12px",
  };
}

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

// Days since a given date (integer, local time)
function daysSince(d) {
  try {
    const dateObj = d instanceof Date ? d : new Date(d);
    const now = new Date();
    // Normalize to midnight to avoid partial-day off-by-ones
    const start = new Date(dateObj.getFullYear(), dateObj.getMonth(), dateObj.getDate());
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const msPerDay = 24 * 60 * 60 * 1000;
    return Math.max(0, Math.floor((end - start) / msPerDay));
  } catch {
    return 0;
  }
}
