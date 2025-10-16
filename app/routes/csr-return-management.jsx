// app/routes/csr-return-management.jsx
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";

// Polaris (CJS default import), stick to stable components
//import Polaris from "@shopify/polaris";
import * as Polaris from "@shopify/polaris";
const { Page, Card, Text, Button } = Polaris;

import { authenticate } from "../shopify.server";

export const meta = () => [{ title: "CSR Return Management" }];

function normalizeOrderId(raw) {
  if (!raw) return null;
  if (typeof raw === "string" && raw.startsWith("gid://")) return raw;
  const last = String(raw).split("/").pop();
  if (/^\d+$/.test(last)) return `gid://shopify/Order/${last}`;
  return raw;
}

export const loader = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  const url = new URL(request.url);

  // Admin Link can pass: id, resourceId, or ids[]
  const rawId =
    url.searchParams.get("id") ||
    url.searchParams.get("resourceId") ||
    url.searchParams.getAll("ids[]")[0];

  if (!rawId) {
    return json({ ok: false, reason: "missing-id" }, { status: 400 });
  }

  const id = normalizeOrderId(rawId);

  try {
    const query = `#graphql
      query FulfilledGate($id: ID!) {
        order(id: $id) {
          id
          name
          displayFulfillmentStatus
          legacyResourceId
        }
      }
    `;
    const resp = await admin.graphql(query, { variables: { id } });
    const body = await resp.json();

    if (!resp.ok || body?.errors?.length) {
      return json(
        {
          ok: false,
          reason: "admin-api-error",
          errors: body?.errors ?? [{ message: "Unknown Admin API error" }],
          debug: { rawId, normalized: id },
        },
        { status: 502 }
      );
    }

    const order = body?.data?.order ?? null;
    if (!order) {
      return json(
        { ok: false, reason: "order-not-found", debug: { rawId, normalized: id } },
        { status: 404 }
      );
    }

    const allowed = order.displayFulfillmentStatus === "FULFILLED";
    return json({ ok: true, allowed, order });
  } catch (err) {
    return json(
      {
        ok: false,
        reason: "server-error",
        error: err instanceof Error ? err.message : String(err),
        debug: { rawId, normalized: id },
      },
      { status: 500 }
    );
  }
};

export default function CSRReturnManagement() {
  const result = useLoaderData();

  // Computed Admin URL for the original order (or Orders index fallback)
  const adminOrderUrl = result?.order
    ? `/admin/orders/${result.order.legacyResourceId}`
    : "/admin/orders";

  const backLabel = result?.order?.name
    ? `Back to ${result.order.name}`
    : "Back to Orders";

  return (
    <Page
      narrowWidth
      title="CSR Return Management"
      backAction={{
        content: backLabel,
        onAction: () => {
          if (typeof window !== "undefined") {
            (window.top ?? window).location.href = adminOrderUrl;
          }
        },
      }}
    >
      {/* Error states */}
      {!result.ok && (
        <Card>
          <Text as="h2" variant="headingMd">Unable to open CSR Return Management</Text>
          <div style={{ marginTop: 8 }}>
            <Text as="p">
              {result.reason === "missing-id" &&
                "This page must be opened from an order’s More actions menu."}
              {result.reason === "admin-api-error" &&
                "The Shopify Admin API returned an error while loading the order."}
              {result.reason === "order-not-found" &&
                "We couldn’t find that order. It may have been deleted or you lack access."}
              {result.reason === "server-error" &&
                "An unexpected server error occurred while loading this page."}
            </Text>
          </div>
          {result.debug && (
            <div style={{ marginTop: 8 }}>
              <Text as="p" tone="subdued">
                Debug: rawId=<code>{String(result.debug.rawId)}</code> &nbsp; normalized=
                <code>{String(result.debug.normalized)}</code>
              </Text>
            </div>
          )}
          {Array.isArray(result.errors) && result.errors.length > 0 && (
            <div style={{ marginTop: 8 }}>
              {result.errors.map((e, i) => (
                <div key={i} style={{ fontFamily: "monospace", fontSize: 12 }}>
                  {e.message}
                </div>
              ))}
            </div>
          )}
          <div style={{ marginTop: 12 }}>
            <Button url={adminOrderUrl} external>Return to Order</Button>
          </div>
        </Card>
      )}

      {/* Gate for fulfilled orders */}
      {result.ok && !result.allowed && (
        <Card>
          <Text as="h2" variant="headingMd">This page is only available for fulfilled orders.</Text>
          <div style={{ marginTop: 8 }}>
            <Text as="p" tone="subdued">
              Open a fulfilled order and use <em>More actions → Begin RSL Return</em>.
            </Text>
          </div>
          <div style={{ marginTop: 12 }}>
            <Button url={adminOrderUrl} external>Return to Order</Button>
          </div>
        </Card>
      )}

      {/* Your actual page content for fulfilled orders */}
      {result.ok && result.allowed && (
        <Card>
          <Text as="h2" variant="headingMd">
            Tools for {result.order?.name} (Fulfilled)
          </Text>
          <div style={{ marginTop: 8 }}>
            <Text as="p" tone="subdued">
              Add widgets/actions for returns, labels, lookups, etc.
            </Text>
          </div>
        </Card>
      )}
    </Page>
  );
}
