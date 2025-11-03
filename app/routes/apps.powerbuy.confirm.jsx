// app/routes/apps.powerbuy.confirm.jsx
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { Page, Card, Text, Banner, InlineStack } from "@shopify/polaris";
import { prisma } from "~/db.server";
import { runAdminQuery } from "~/shopify-admin.server";

// --- Helpers ---
function isoPlusDays(iso, days) {
  const d = new Date(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString();
}

export async function loader({ request }) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token");
  const shop = url.searchParams.get("shop"); // used only for display/logging

  if (!token) {
    return json(
      { ok: false, error: "Missing token." },
      { status: 400 }
    );
  }

  // Pull the pending request (token only; no 'shop' column on this table)
  const reqRow = await prisma.tbl_powerbuy_requests.findFirst({
    where: { token },
    select: {
      id: true,
      email: true,
      product_id: true,     // may be a Product or ProductVariant GID
      created_at: true,
      powerbuy_id: true,
      // NOTE: don't select generated_code (doesn't exist)
    },
  });

  if (!reqRow) {
    return json(
      { ok: false, error: "Invalid or expired token." },
      { status: 404 }
    );
  }

  // Build discount input
  const nowIso = new Date().toISOString();
  const endsIso = isoPlusDays(nowIso, 7); // 7-day window as discussed

  const { email, product_id: pid, powerbuy_id } = reqRow;

  // Decide how to target items. If it's a variant GID, attach to productVariants; if it's a product GID, attach to products.
  let itemsInput;
  if (pid && pid.includes("/ProductVariant/")) {
    itemsInput = {
      products: {
        productVariantsToAdd: [pid],
      },
    };
  } else if (pid && pid.includes("/Product/")) {
    itemsInput = {
      products: {
        productsToAdd: [pid],
      },
    };
  } else {
    // Fallback: apply to all items (not ideal, but better than failing)
    itemsInput = { all: true };
  }

  // Code prefix + random suffix (same style you’ve been using)
  const codePrefix = "RSLPB25A";
  const suffix = Math.floor(100000 + Math.random() * 900000).toString(); // 6 digits
  const code = `${codePrefix}${suffix}`;

  // Title example: keep your existing pattern
  const title = `RSL Power Buy (${powerbuy_id ?? "N/A"}) - ${email}`;

  // IMPORTANT: use the older, widely-available shape (no `context`, no `appliesOncePerOrder`)
  const variables = {
    basicCodeDiscount: {
      title,
      code,
      startsAt: nowIso,
      endsAt: endsIso,
      usageLimit: 12,
      combinesWith: {
        orderDiscounts: false,
        productDiscounts: false,
        shippingDiscounts: true,
      },
      customerSelection: {
        all: true,
      },
      customerGets: {
        items: itemsInput,
        value: {
          discountAmount: {
            amount: "5",
            appliesOnEachItem: false,
          },
        },
      },
    },
  };

  const mutation = `
    mutation CreateBasicCode($basicCodeDiscount: DiscountCodeBasicInput!) {
      discountCodeBasicCreate(basicCodeDiscount: $basicCodeDiscount) {
        codeDiscountNode {
          id
          codeDiscount {
            ... on DiscountCodeBasic {
              title
              startsAt
              endsAt
              combinesWith {
                orderDiscounts
                productDiscounts
                shippingDiscounts
              }
              codes(first: 1) {
                edges { node { code } }
              }
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

  // Run the Admin GraphQL call using the env-safe helper
  const resp = await runAdminQuery(request, mutation, variables);

  // Hard errors (GraphQL-level)
  if (resp.errors?.length) {
    return json(
      {
        ok: false,
        error: "Shopify GraphQL errors",
        details: resp.errors,
      },
      { status: 500 }
    );
  }

  const payload = resp.data?.discountCodeBasicCreate;
  const userErrors = payload?.userErrors ?? [];
  if (userErrors.length) {
    return json(
      {
        ok: false,
        error: "Shopify GraphQL userErrors",
        userErrors,
      },
      { status: 400 }
    );
  }

  const nodeId = payload?.codeDiscountNode?.id;
  const codeFromShopify =
    payload?.codeDiscountNode?.codeDiscount?.codes?.edges?.[0]?.node?.code;

  if (!nodeId || !codeFromShopify) {
    return json(
      { ok: false, error: "Shopify did not return a discount node id/code" },
      { status: 500 }
    );
  }

  // Mark request as confirmed (don’t try to write non-existent fields)
  await prisma.tbl_powerbuy_requests.update({
    where: { id: reqRow.id },
    data: {
      confirmed_at: new Date(),
      // If you later add a place to store the code or node ID, update here.
      // e.g., code_id: ..., or create tbl_powerbuy_codes & connect it.
    },
  });

  return json({
    ok: true,
    shop,
    nodeId,
    code: codeFromShopify,
    title: payload.codeDiscountNode.codeDiscount.title,
    startsAt: payload.codeDiscountNode.codeDiscount.startsAt,
    endsAt: payload.codeDiscountNode.codeDiscount.endsAt,
  });
}

export default function ConfirmPage() {
  const data = useLoaderData();

  return (
    <Page title="PowerBuy Confirmation">
      <Card>
        {!data?.ok ? (
          <Banner tone="critical" title="Couldn’t confirm">
            <p>{data?.error || "Unexpected error."}</p>
            {Array.isArray(data?.details) && (
              <div style={{ marginTop: 8 }}>
                <Text as="p" tone="subdued">
                  See logs for full details.
                </Text>
              </div>
            )}
            {Array.isArray(data?.userErrors) && data.userErrors.length > 0 && (
              <div style={{ marginTop: 8 }}>
                {data.userErrors.map((e, i) => (
                  <Text as="p" key={i}>
                    {JSON.stringify(e)}
                  </Text>
                ))}
              </div>
            )}
          </Banner>
        ) : (
          <Banner tone="success" title="Discount code created">
            <InlineStack gap="400" align="start">
              <Text as="p">
                <strong>Code:</strong> {data.code}
              </Text>
              <Text as="p">
                <strong>Starts:</strong> {new Date(data.startsAt).toLocaleString()}
              </Text>
              <Text as="p">
                <strong>Ends:</strong> {new Date(data.endsAt).toLocaleString()}
              </Text>
            </InlineStack>
          </Banner>
        )}
      </Card>
    </Page>
  );
}
