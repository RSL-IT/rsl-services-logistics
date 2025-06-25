import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import {
  IndexTable,
  Page,
  Text,
  Card,
  Layout,
  Frame,
  Link,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";

export const meta = () => [{ title: "Returns In Progress" }];

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;

  const ordersQuery = `
    query {
      orders(first: 50, query: "return_status:requested OR return_status:in_progress") {
        edges {
          node {
            id
            name
            createdAt
            customer {
              displayName
              email
            }
            returnStatus
            lineItems(first: 5) {
              edges {
                node {
                  title
                  quantity
                  fulfillmentStatus
                }
              }
            }
          }
        }
      }
    }
  `;

  const ordersResponse = await admin.graphql(ordersQuery);
  const ordersJson = await ordersResponse.json();

  const items = ordersJson?.data?.orders?.edges.flatMap((edge, index) => {
    const order = edge.node;
    return order.lineItems.edges
      .filter((itemEdge) => itemEdge.node.fulfillmentStatus !== "FULFILLED")
      .map((itemEdge, itemIndex) => ({
        id: `${index}-${itemIndex}`,
        orderId: order.id,
        orderName: order.name,
        customerName: order.customer?.displayName || "Unknown",
        email: order.customer?.email,
        returnStatus: order.returnStatus,
        createdAt: order.createdAt,
        title: itemEdge.node.title,
        quantity: itemEdge.node.quantity,
      }));
  });

  return json({ items, shop });
};

export default function ReturnOrdersPage() {
  const { items, shop } = useLoaderData();

  const headings = [
    { title: "Order" },
    { title: "Customer" },
    { title: "Email" },
    { title: "Return Status" },
    { title: "Item" },
    { title: "Quantity" },
  ];

  return (
    <Frame>
      <Page title="Return Orders">
        <Layout>
          <Layout.Section>
            <Card>
              <IndexTable
                resourceName={{ singular: "return item", plural: "return items" }}
                itemCount={items.length}
                headings={headings}
                selectable={false}
              >
                {items.map((item, index) => (
                  <IndexTable.Row id={item.id} key={item.id} position={index}>
                    <IndexTable.Cell>
                      <a
                        href={`https://${shop}/admin/orders/${item.orderId.split("/").pop()}`}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {item.orderName}
                      </a>
                    </IndexTable.Cell>
                    <IndexTable.Cell>{item.customerName}</IndexTable.Cell>
                    <IndexTable.Cell>{item.email}</IndexTable.Cell>
                    <IndexTable.Cell>{item.returnStatus}</IndexTable.Cell>
                    <IndexTable.Cell>{item.title}</IndexTable.Cell>
                    <IndexTable.Cell>{item.quantity}</IndexTable.Cell>
                  </IndexTable.Row>
                ))}
              </IndexTable>
            </Card>
          </Layout.Section>
        </Layout>
      </Page>
    </Frame>
  );
}
