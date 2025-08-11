import { json, redirect } from "@remix-run/node";
import { useLoaderData, useFetcher, useNavigation, useActionData, useRevalidator } from "@remix-run/react";
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
  Modal,
} from "@shopify/polaris";
import { useEffect, useState } from "react";
import { authenticate } from "../shopify.server";
import {TitleBar} from "@shopify/app-bridge-react";

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
                  selectedOptions {
                    name
                    value
                  }
                  product {
                    id
                    title
                    variants(first: 50) {
                      edges {
                        node {
                          id
                          title
                          selectedOptions {
                            name
                            value
                          }
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

  const items = inventoryJson?.data?.location?.inventoryLevels?.edges
    ?.map((edge, index) => {
      const item = edge.node.item;
      const variant = item.variant;
      const product = variant?.product;

      const currentFirstOption = variant?.selectedOptions?.[0]?.value;
      const variantOptions = [];

      if (product?.variants?.edges?.length) {
        for (const vEdge of product.variants.edges) {
          const v = vEdge.node;
          const option1 = v.selectedOptions?.[0]?.value;
          const option2 = v.selectedOptions?.[1];

          if (
            option1 === currentFirstOption &&
            option2 &&
            /^[ABC]\./.test(option2.value)
          ) {
            variantOptions.push({
              label: option2.value,
              value: v.id,
            });
          }
        }
      }

      const quantityMap = Object.fromEntries(
        (edge.node.quantities || []).map((q) => [q.name, q.quantity])
      );

      return {
        id: `${index}`,
        inventoryItemId: item.id,
        sku: item.sku || "—",
        tracked: item.tracked,
        productTitle: product?.title || "Unknown Product",
        variantTitle: variant?.title || "Untitled Variant",
        variantId: variant?.id,
        variantOptions,
        quantityMap,
      };
    })
    .filter(
      (item) => item.quantityMap["quality_control"] && item.quantityMap["quality_control"] >= 1
    ) || [];

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
  const [modalOpen, setModalOpen] = useState(false);
  const [pendingSelection, setPendingSelection] = useState(null); // { item, variantId, condition }

  const fetcher = useFetcher();
  const { items, locationId, error } = useLoaderData();
  const actionData = useActionData();
  const navigation = useNavigation();
  const { revalidate } = useRevalidator();


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
    { title: "SKU", alignment: "center" },
    { title: "Awaiting Evaluation", alignment: "center" },
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
      <Modal
      open={modalOpen}
      onClose={() => setModalOpen(false)}
      title="Confirm Open-Box Evaluation"
      primaryAction={{
        content: "Confirm",
        onAction: async () => {
          const { item } = pendingSelection;

          const mutation = `
            mutation ($input: InventoryAdjustQuantitiesInput!) {
              inventoryAdjustQuantities(input: $input) {
                inventoryAdjustmentGroup {
                  id
                  reason
                }
                userErrors {
                  field
                  message
                }
              }
            }
          `;

          const variables = {
            input: {
              name: "quality_control",
              reason: "received",
              changes: [
                {
                  delta: -1,
                  inventoryItemId: item.inventoryItemId,
                  locationId: locationId, // make sure this is in scope
                  ledgerDocumentUri: "https://docs.google.com/spreadsheets/d/1ET80aQp44Jk5cFTCeHiOXjrR5s7ncbZmfahRrgUBp9s/edit?usp=sharing"
                },
              ],
            },
            quantityName: "quality_control", // optional; mutation doesn't need this explicitly
          };

          const response = await fetch("/app/inventory-adjust", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ mutation, variables }),
          });

          const result = await response.json();

          if (result.success) {
            revalidate(); // refresh UI
            setModalOpen(false);
            setPendingSelection(null);
          } else {
            console.error("Inventory adjustment failed:", result.errors);
          }
        }
        ,
      }}
      secondaryActions={[
        {
          content: "Cancel",
          onAction: () => setModalOpen(false),
        },
      ]}
    >
        <Modal.Section>
          <Text as="p">
            Confirm that this{" "}
            <u>
              {pendingSelection?.option1} {pendingSelection?.item.productTitle}
            </u>{" "}
            (<strong>{pendingSelection?.item.sku}</strong>) has been evaluated as condition{" "}

            <u>{pendingSelection?.condition}</u>{" "}(<strong>
              {
                pendingSelection?.item.sku?.slice(0, -1) +
                (pendingSelection?.condition?.charAt(0) || "")
              }
            </strong>){" "}
            and should be added to the open-box inventory.
          </Text>
        </Modal.Section>

      </Modal>

      <Page>
        <TitleBar title="Return Handling" />
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
                    <IndexTable.Cell>{item.productTitle}</IndexTable.Cell>

                    <IndexTable.Cell>
                      <fetcher.Form method="post">
                        <input type="hidden" name="actionType" value="updateVariant" />
                        <input type="hidden" name="itemId" value={item.id} />
                        <div style={{ marginRight: "1rem" }}>
                          <Select
                            labelHidden
                            name="variantId"
                            options={[
                              { label: "Set Condition", value: "", disabled: true },
                              ...item.variantOptions,
                            ]}
                            value=""
                            onChange={(value) => {
                              const selected = item.variantOptions.find((opt) => opt.value === value);
                              const condition = selected?.label ?? "unknown condition";
                              const option1 = item.variantTitle.split(" / ")[0]; // assuming title like "Large / A. Mint"

                              setPendingSelection({
                                item,
                                variantId: value,
                                condition,
                                option1,
                              });

                              setModalOpen(true);
                            }}

                          />
                        </div>
                      </fetcher.Form>
                    </IndexTable.Cell>

                    <IndexTable.Cell style={{ textAlign: "center" }}>
                      {item.sku}
                    </IndexTable.Cell>

                    <IndexTable.Cell style={{ textAlign: "center" }}>
                      {item.quantityMap["quality_control"] ?? "—"}
                    </IndexTable.Cell>
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
