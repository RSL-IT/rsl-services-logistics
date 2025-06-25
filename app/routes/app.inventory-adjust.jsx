import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";

export const action = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  const { mutation, variables } = await request.json();

  const response = await admin.graphql(mutation, { variables });
  const data = await response.json();

  if (data?.data?.inventoryAdjustQuantities?.userErrors?.length) {
    return json({ success: false, errors: data.data.inventoryAdjustQuantities.userErrors });
  }

  return json({ success: true });
};
