// app/routes/app.inprocess.jsx
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import {
  IndexTable,
  Page,
  Text,
  Card,
  Layout,
  Frame,
  Link as PolarisLink,
  Box,
  Banner,
  Button,
  InlineStack,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "~/shopify.server";

// ---------- Meta ----------
export const meta = () => [{ title: "Returns In Progress" }];

/**
 * Tuning knobs (also override with query params):
 *   ?perPage=20  — number of orders per request (default 20)
 *   ?after=CURSOR — pagination cursor
 *
 * Nested "first" are intentionally small to keep query cost < 1000.
 */
const DEFAULT_ORDERS_FIRST = 20;
const LINE_ITEMS_FIRST = 5;
const RFO_FIRST = 3;
const RD_FIRST = 3;

// ---------- Loader ----------
export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;

  const url = new URL(request.url);
  const perPageParam = parseInt(url.searchParams.get("perPage") || "", 10);
  const first = Number.isFinite(perPageParam) && perPageParam > 0 ? perPageParam : DEFAULT_ORDERS_FIRST;
  const after = url.searchParams.get("after") || null;

  const ordersQuery = `
    query InProcessReturns($first: Int!, $after: String, $liFirst: Int!, $rfoFirst: Int!, $rdFirst: Int!) {
      orders(first: $first, after: $after, query: "return_status:requested OR return_status:in_progress") {
        edges {
          cursor
          node {
            id
            name
            createdAt
            customer { displayName email }
            returnStatus
            shippingAddress { address1 city province zip country }
            lineItems(first: $liFirst) {
              edges { node { title quantity fulfillmentStatus } }
            }
            returns(first: 10) {
              edges {
                node {
                  id
                  status
                  reverseFulfillmentOrders(first: $rfoFirst) {
                    edges {
                      node {
                        id
                        reverseDeliveries(first: $rdFirst) {
                          edges {
                            node {
                              id
                              deliverable {
                                __typename
                                ... on ReverseDeliveryShippingDeliverable {
                                  tracking {
                                    carrierName
                                    number
                                    url
                                  }
                                  label {
                                    publicFileUrl
                                  }
                                }
                              }
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
        pageInfo {
          hasNextPage
          hasPreviousPage
          startCursor
          endCursor
        }
      }
    }
  `;

  try {
    const resp = await admin.graphql(ordersQuery, {
      variables: {
        first,
        after,
        liFirst: LINE_ITEMS_FIRST,
        rfoFirst: RFO_FIRST,
        rdFirst: RD_FIRST,
      },
    });

    const raw = await resp.text();
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      throw new Error(`Invalid JSON from Admin API: ${raw.slice(0, 500)}`);
    }

    if (parsed?.errors?.length) {
      const firstErr = parsed.errors[0];
      const msg =
        typeof firstErr === "string"
          ? firstErr
          : firstErr?.message || "Admin API returned an error.";
      return json({
        shop,
        error: msg,
        data: parsed?.data || null,
        page: { first, after },
      });
    }

    return json({
      shop,
      data: parsed?.data || null,
      page: { first, after },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return json({ shop, error: msg, data: null, page: { first, after } });
  }
};

// ---------- Component ----------
export default function InProcessReturnsPage() {
  const { data, error, page } = useLoaderData();

  const orderConn = data?.orders;
  const orderEdges = orderConn?.edges ?? [];
  const pageInfo = orderConn?.pageInfo ?? { hasNextPage: false, endCursor: null };

  const items =
    orderEdges.flatMap((edge, index) => {
      const order = edge?.node ?? {};

      // Flatten tracking info from reverse deliveries (if any)
      const orderReturnTrackers = (order?.returns?.edges ?? []).flatMap((rEdge) => {
        const r = rEdge?.node ?? {};
        const rfoEdges = r?.reverseFulfillmentOrders?.edges ?? [];
        return rfoEdges.flatMap((rfoEdge) => {
          const rfo = rfoEdge?.node ?? {};
          const rdEdges = rfo?.reverseDeliveries?.edges ?? [];
          return rdEdges
            .map((rdEdge) => {
              const rd = rdEdge?.node ?? {};
              const deliv = rd?.deliverable ?? {};
              if (deliv?.__typename !== "ReverseDeliveryShippingDeliverable") {
                return null; // skip non-shipping deliverables
              }
              const tracking = deliv?.tracking ?? null;
              const labelUrl = deliv?.label?.publicFileUrl ?? null;
              return {
                returnId: r.id ?? null,
                returnStatus: r.status ?? null,
                carrier: tracking?.carrierName ?? null,
                trackingNumber: tracking?.number ?? null,
                trackingUrl: tracking?.url ?? null,
                labelUrl,
              };
            })
            .filter(Boolean);
        });
      });

      const liEdges = order?.lineItems?.edges ?? [];
      return liEdges
        .filter((itemEdge) => itemEdge?.node?.fulfillmentStatus !== "FULFILLED")
        .map((itemEdge, itemIndex) => ({
          id: `${index}-${itemIndex}`,
          orderId: order.id,
          orderName: order.name,
          orderAddress: order.shippingAddress?.address1,
          orderProvince: order.shippingAddress?.province,
          orderCity: order.shippingAddress?.city,
          orderZip: order.shippingAddress?.zip,
          orderCountry: order.shippingAddress?.country,
          customerName: order.customer?.displayName || "Unknown",
          email: order.customer?.email,
          returnStatus: order.returnStatus,
          createdAt: order.createdAt,
          title: itemEdge?.node?.title,
          quantity: itemEdge?.node?.quantity,
          returnTracking: orderReturnTrackers,
        }));
    }) ?? [];

  const resourceName = { singular: "return", plural: "returns" };

  const headings = [
    { title: "Order" },
    { title: "Customer" },
    { title: "Email" },
    { title: "Return Status" },
    { title: "Item" },
    { title: "Quantity" },
    { title: "Return Tracking" },
  ];

  const nextUrl = pageInfo?.hasNextPage && pageInfo?.endCursor
    ? `?perPage=${page.first}&after=${encodeURIComponent(pageInfo.endCursor)}`
    : null;

  return (
    <Frame>
      <Page title="Returns In Progress">
        <TitleBar title="Returns In Progress" />

        <Layout>
          {error ? (
            <Layout.Section>
              <Banner tone="critical" title="Admin API error">
                <p>{error}</p>
                <p style={{ marginTop: 8 }}>
                  Tip: Reduce <code>?perPage=</code> (e.g., 10), or use Bulk Operations
                  for very large datasets. This page is now paginated to minimize cost.
                </p>
              </Banner>
            </Layout.Section>
          ) : null}

          <Layout.Section>
            <Card>
              <Box paddingBlock="400" paddingInline="400">
                <Text as="p" variant="bodyMd">
                  Orders with return status <b>requested</b> or <b>in_progress</b>. Page size:{" "}
                  <b>{page.first}</b>
                </Text>
              </Box>

              <IndexTable
                resourceName={resourceName}
                itemCount={items.length}
                headings={headings}
                selectable={false}
              >
                {items.map((item, rowIndex) => (
                  <IndexTable.Row id={item.id} key={item.id} position={rowIndex}>
                    <IndexTable.Cell>
                      <Text as="span" variant="bodyMd">
                        {item.orderName}
                      </Text>
                      <div style={{ color: "#6d7175", fontSize: 12 }}>
                        {[
                          item.orderAddress,
                          item.orderCity,
                          item.orderProvince,
                          item.orderZip,
                          item.orderCountry,
                        ]
                          .filter(Boolean)
                          .join(", ")}
                      </div>
                    </IndexTable.Cell>

                    <IndexTable.Cell>{item.customerName}</IndexTable.Cell>

                    <IndexTable.Cell>
                      {item.email ? (
                        <PolarisLink url={`mailto:${item.email}`}>{item.email}</PolarisLink>
                      ) : (
                        <span style={{ color: "#6d7175" }}>—</span>
                      )}
                    </IndexTable.Cell>

                    <IndexTable.Cell>{item.returnStatus || "—"}</IndexTable.Cell>
                    <IndexTable.Cell>{item.title}</IndexTable.Cell>
                    <IndexTable.Cell>{item.quantity}</IndexTable.Cell>

                    {/* Return Tracking + Label link */}
                    <IndexTable.Cell>
                      {Array.isArray(item.returnTracking) && item.returnTracking.length > 0 ? (
                        <div style={{ display: "grid", gap: 4 }}>
                          {item.returnTracking.map((trk, i) => {
                            const label =
                              [trk.carrier, trk.trackingNumber].filter(Boolean).join(" • ") ||
                              "Tracking available";
                            const key = `${item.id}-trk-${i}`;

                            const trackingNode = trk.trackingUrl ? (
                              <a
                                key={`${key}-t`}
                                href={trk.trackingUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                              >
                                {label}
                              </a>
                            ) : (
                              <span key={`${key}-t`}>{label}</span>
                            );

                            const labelNode = trk.labelUrl ? (
                              <a
                                key={`${key}-l`}
                                href={trk.labelUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                style={{ marginLeft: 8 }}
                              >
                                Label
                              </a>
                            ) : null;

                            return (
                              <div key={key}>
                                {trackingNode}
                                {labelNode ? <span> • </span> : null}
                                {labelNode}
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <span style={{ color: "#6d7175" }}>No tracking yet</span>
                      )}
                    </IndexTable.Cell>
                  </IndexTable.Row>
                ))}
              </IndexTable>

              {/* Pagination controls */}
              <Box padding="400">
                <InlineStack align="end" gap="200">
                  {nextUrl ? (
                    <Button url={nextUrl}>Load more</Button>
                  ) : (
                    <Text as="span" variant="bodySm" tone="subdued">
                      No more results
                    </Text>
                  )}
                </InlineStack>
              </Box>
            </Card>
          </Layout.Section>
        </Layout>
      </Page>
    </Frame>
  );
}
