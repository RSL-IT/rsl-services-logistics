import { json, redirect } from "@remix-run/node";
import { useLoaderData, useFetcher, useNavigation, useActionData } from "@remix-run/react";
import {
  IndexTable,
  Page,
  Text,
  Card,
  Button,
  useIndexResourceState,
  Layout,
  Frame,
  Toast,
  Select,
} from "@shopify/polaris";
import { useEffect, useState } from "react";
import { authenticate } from "../shopify.server";

export const meta = () => [{ title: "US Quarantine Inventory" }];

export const loader = async ({ request }) => {
  const { admin } = await authenticate.admin(request);

  const locationQuery = `
    query {
      locations(first: 10, query: "name:'US Quarantine'") {
        edges {
          node {
            id
            name
          }
        }
      }
    }
  `;

  const locationResponse = await admin.graphql(locationQuery);
  const locations = await locationResponse.json();
  const usLocation = locations?.data?.locations?.edges?.[0]?.node;

  if (!usLocation) {
    return json({ error: "Location 'US Quarantine' not found.", items: [] });
  }

  const locationId = usLocation.id;

  const inventoryQuery = `
    query {
      location(id: "${locationId}") {
        inventoryLevels(first: 100) {
          edges {
            node {
              item {
                id
                sku
                tracked
                variant {
                  id
                  title
                  product {
                    id
                    title
                    variants(first: 50) {
                      edges {
                        node {
                          id
                          title
                        }
                      }
                    }
                  }
                }
              }
              quantities(names: ["available", "quality_control"]) {
                name
                quantity
              }
            }
          }
        }
      }
    }
  `;

  const inventoryResponse = await admin.graphql(inventoryQuery);
  const inventoryJson = await inventoryResponse.json();

  const items =
    inventoryJson?.data?.location?.inventoryLevels?.edges?.map((edge, index) => {
      const item = edge.node.item;
      const variant = item.variant;
      const product = variant?.product;

      return {
        id: `${index}`,
        inventoryItemId: item.id,
        sku: item.sku || "—",
        tracked: item.tracked,
        productTitle: product?.title || "Unknown Product",
        variantTitle: variant?.title || "Untitled Variant",
        variantId: variant?.id,
        variantOptions: product?.variants?.edges?.map((v) => ({
          label: v.node.title,
          value: v.node.id,
        })) || [],
        quantityMap: Object.fromEntries((edge.node.quantities || []).map((q) => [q.name, q.quantity])),
      };
    }).filter(Boolean) || [];

  return json({ items, locationId });
};

export const action = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();

  if (formData.get("actionType") === "updateVariant") {
    // Handle variant change form if implemented
    const variantId = formData.get("variantId");
    const itemId = formData.get("itemId");
    console.log(`Updating item ${itemId} to variant ${variantId}`);
    return json({ success: true });
  }

  const ids = JSON.parse(formData.get("inventoryItemIds"));
  const locationId = formData.get("locationId");

  const inventoryAdjustMutation = `
    mutation ($input: InventoryAdjustQuantitiesInput!) {
      inventoryAdjustQuantities(input: $input) {
        inventoryAdjustmentGroup {
          id
          reason
          changes {
            name
            delta
            quantityAfterChange
            location {
              name
            }
            item {
              sku
            }
          }
        }
        userErrors {
          field
          message
          code
        }
      }
    }
  `;
  for (const inventoryItemId of ids) {
    const subtractVariables = {
      input: {
        name: "Move to quality_control",
        reason: "manual_adjustment",
        changes: [
          {
            delta: -1,
            inventoryItemId,
            locationId,
          },
        ],
      },
      quantityName: "available",
    };
    const subtractRes = await admin.graphql(inventoryAdjustMutation, { variables: subtractVariables });
    const subtractJson = await subtractRes.json();
    if (subtractJson.data?.inventoryAdjustQuantities?.userErrors?.length > 0) {
      return json({ error: subtractJson.data.inventoryAdjustQuantities.userErrors });
    }

    const addVariables = {
      input: {
        name: "Move to quality_control",
        reason: "manual_adjustment",
        changes: [
          {
            delta: 1,
            inventoryItemId,
            locationId,
          },
        ],
      },
      quantityName: "quality_control",
    };
    const addRes = await admin.graphql(inventoryAdjustMutation, { variables: addVariables });
    const addJson = await addRes.json();
    if (addJson.data?.inventoryAdjustQuantities?.userErrors?.length > 0) {
      return json({ error: addJson.data.inventoryAdjustQuantities.userErrors });
    }
  }

  return redirect("/app/inventory?success=true");
};

export default function InventoryPage() {
  const fetcher = useFetcher();
  const { items, locationId, error } = useLoaderData();
  const actionData = useActionData();
  const navigation = useNavigation();

  const [toastActive, setToastActive] = useState(false);

  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get("success") === "true") {
      setToastActive(true);
      url.searchParams.delete("success");
      window.history.replaceState({}, document.title, url.pathname);
      fetcher.load("/app/inventory");
    }
  }, [fetcher]);

  const {
    selectedResources,
    allResourcesSelected,
    handleSelectionChange,
  } = useIndexResourceState(items);

  const quantityTypes = ["available", "quality_control"];

  const headings = [
    { title: "Product" },
    { title: "Variant" },
    { title: "SKU" },
    { title: "Tracked" },
    ...quantityTypes.map((name) => ({
      title: name.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
    })),
  ];

  const handleMoveToSafetyStock = () => {
    fetcher.submit(
      {
        inventoryItemIds: JSON.stringify(
          items
            .filter((item) => selectedResources.includes(item.id))
            .map((item) => item.inventoryItemId)
        ),
        locationId,
      },
      { method: "post" }
    );
  };

  const toastMarkup = toastActive ? (
    <Toast content="Moved to Quality Control" onDismiss={() => setToastActive(false)} />
  ) : null;

  const errorMarkup = actionData?.error ? (
    <Card sectioned>
      <Text color="critical">
        {actionData.error.map((err, i) => (
          <div key={i}>{err.message}</div>
        ))}
      </Text>
    </Card>
  ) : null;

  return (
    <Frame>
      <Page title="US Quarantine Inventory">
        {errorMarkup}
        {error && (
          <Card sectioned>
            <Text color="critical">{error}</Text>
          </Card>
        )}
        <Layout>
          <Layout.Section>
            <Card>
              <IndexTable
                resourceName={{ singular: "inventory item", plural: "inventory items" }}
                itemCount={items.length}
                headings={headings}
                selectable={false}
              >
                {items.map((item, index) => (
                  <IndexTable.Row id={item.id} key={item.id} position={index}>
                    <IndexTable.Cell flush>{item.productTitle}</IndexTable.Cell>
                    <IndexTable.Cell flush>
                      <fetcher.Form method="post">
                        <input type="hidden" name="actionType" value="updateVariant" />
                        <input type="hidden" name="itemId" value={item.id} />
                        <Select
                          labelHidden
                          name="variantId"
                          options={item.variantOptions}
                          value={item.variantId}
                          onChange={(value) => {
                            fetcher.submit(
                              {
                                actionType: "updateVariant",
                                variantId: value,
                                itemId: item.id,
                              },
                              { method: "post" }
                            );
                          }}
                        />
                      </fetcher.Form>
                    </IndexTable.Cell>
                    <IndexTable.Cell flush>{item.sku}</IndexTable.Cell>
                    <IndexTable.Cell flush>{item.tracked ? "Yes" : "No"}</IndexTable.Cell>
                    {quantityTypes.map((type) => (
                      <IndexTable.Cell flush key={type}>
                        {item.quantityMap[type] ?? "—"}
                      </IndexTable.Cell>
                    ))}
                  </IndexTable.Row>
                ))}
              </IndexTable>
            </Card>

          </Layout.Section>
        </Layout>
        {toastMarkup}
      </Page>
    </Frame>
  );

}
