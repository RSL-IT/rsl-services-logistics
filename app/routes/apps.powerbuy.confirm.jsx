// app/routes/apps.powerbuy.confirm.jsx
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { Page, Card, Text, Banner, InlineStack, Box } from "@shopify/polaris";
import { prisma } from "~/db.server";
import { runAdminQuery } from "~/shopify-admin.server";
import { sendConfirmEmail } from "~/services/mailer.server";
import { replaceTokens, TOKEN_REGISTRY } from "~/utils/tokens.server";
import { verifyProxyIfPresent } from "~/utils/app-proxy-verify.server";

// -----------------------------
// Local helpers
// -----------------------------
function parseCombinesWith(s) {
  const set = new Set(String(s || "").toLowerCase().split(/[,\s]+/).filter(Boolean));
  return {
    orderDiscounts: set.has("order") || set.has("orders") || set.has("orderdiscounts"),
    productDiscounts: set.has("product") || set.has("products") || set.has("productdiscounts"),
    shippingDiscounts: set.has("shipping") || set.has("shippingdiscounts"),
  };
}

function toVariantGids(csv) {
  if (!csv) return [];
  return String(csv)
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean)
    .map((id) => (id.startsWith("gid://") ? id : `gid://shopify/ProductVariant/${id}`));
}

function addDays(date, days) {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

function durationToEnd(start, duration) {
  if (!duration) return addDays(start, 7);
  const raw = String(duration).trim();
  const m1 = raw.match(/^(\d+)$/);
  if (m1) return addDays(start, parseInt(m1[1], 10));
  const m2 = raw.match(/^(\d+)\s*d$/i);
  if (m2) return addDays(start, parseInt(m2[1], 10));
  const m3 = raw.match(/^P(\d+)D$/i);
  if (m3) return addDays(start, parseInt(m3[1], 10));
  return addDays(start, 7);
}

function makeCode(prefix, length = 6) {
  const L = Math.max(1, Math.min(12, Number(length) || 6));
  let n = "";
  while (n.length < L) n += Math.floor(Math.random() * 10);
  return `${String(prefix || "RSLPB").toUpperCase()}${n}`;
}

/** Title builder: uses the token engine; falls back to a sensible default if blank */
function buildTitleWithTokens(pbTitle, ctx, tokens = TOKEN_REGISTRY) {
  const replaced = replaceTokens(pbTitle, ctx, tokens).trim();
  if (replaced) return replaced;
  return `PowerBuy - ${ctx?.customerEmail || ""}`.trim();
}

// -----------------------------
// Shopify Admin GraphQL
// -----------------------------

const CREATE_MUTATION = `
mutation CreateDiscount($basicCodeDiscount: DiscountCodeBasicInput!) {
  discountCodeBasicCreate(basicCodeDiscount: $basicCodeDiscount) {
    codeDiscountNode {
      id
      codeDiscount {
        __typename
        ... on DiscountCodeBasic {
          title
          startsAt
          endsAt
          combinesWith { orderDiscounts productDiscounts shippingDiscounts }
          codes(first: 1) { edges { node { code } } }
        }
      }
    }
    userErrors { field message code }
  }
}
`;

// -----------------------------
// Loader
// -----------------------------
export const loader = async ({ request }) => {
  await verifyProxyIfPresent(request);
  const url = new URL(request.url);
  const token = url.searchParams.get("token")?.trim();
  const shop = url.searchParams.get("shop")?.trim();

  if (!token || !shop) {
    return json({ ok: false, reason: "Missing token or shop" }, { status: 400 });
  }

  // 1) Validate request token
  const req = await prisma.tbl_powerbuy_requests.findFirst({
    where: { token },
    select: {
      id: true,
      name: true,
      email: true,
      product_id: true,
      powerbuy_id: true,
      confirmed_at: true,
    },
  });

  if (!req) return json({ ok: false, reason: "Invalid token" }, { status: 400 });
  if (req.confirmed_at) {
    return json({ ok: false, reason: "Already confirmed" }, { status: 400 });
  }

  // 2) Load PowerBuy config
  const pb = await prisma.tbl_powerbuy_config.findUnique({
    where: { id: req.powerbuy_id },
    select: {
      id: true,
      title: true,
      discount_prefix: true,
      discount_type: true,        // 'fixed' | 'percentage'
      discount_value: true,       // Decimal
      discount_combines_with: true,
      duration: true,             // e.g. '7d'
      number_of_uses: true,       // usage limit
      powerbuy_variant_ids: true, // comma-separated variant IDs
      short_description: true,
      powerbuy_product_id: true,
    },
  });
  if (!pb) return json({ ok: false, reason: "PowerBuy config not found" }, { status: 400 });

  // 3) Build discount payload
  const now = new Date();
  const endsAt = durationToEnd(now, pb.duration);
  const combines = parseCombinesWith(pb.discount_combines_with);
  const variantGids = toVariantGids(pb.powerbuy_variant_ids);
  const codeString = makeCode(pb.discount_prefix, /*length*/ 6);

  // Determine value: once-per-order for fixed by setting appliesOnEachItem=false
  const rawVal = pb.discount_value ? String(pb.discount_value) : "0";
  const valueInput =
    (pb.discount_type || "fixed") === "percentage"
      ? { discountPercentage: { percentage: rawVal } }
      : { discountAmount: { amount: rawVal || "0", appliesOnEachItem: false } };

  // Token-aware title
  const title = buildTitleWithTokens(pb.title, { pb, customerEmail: req.email });

  const basicCodeDiscount = {
    title,
    code: codeString,
    startsAt: now.toISOString(),
    endsAt: endsAt.toISOString(),
    usageLimit: pb.number_of_uses ?? 1,
    appliesOncePerCustomer: true, // "use only once" per customer
    combinesWith: combines,
    customerSelection: { all: true },
    customerGets: {
      // Scope to configured variants only (preferred). Fallback to all if none configured.
      items: variantGids.length
        ? { products: { productVariantsToAdd: variantGids } }
        : { all: true },
      value: valueInput,
    },
  };

  // 4) Call Admin GraphQL
  const gql = await runAdminQuery(shop, CREATE_MUTATION, { basicCodeDiscount });
  const gErrors = gql?.errors;
  const gData = gql?.data?.discountCodeBasicCreate;

  if (gErrors?.length) {
    return json(
      { ok: false, reason: "Shopify GraphQL errors", details: gErrors },
      { status: 500 }
    );
  }
  if (!gData) {
    return json({ ok: false, reason: "No data from Shopify", raw: gql }, { status: 500 });
  }
  if (gData.userErrors?.length) {
    return json(
      { ok: false, reason: "Shopify GraphQL userErrors", details: gData.userErrors },
      { status: 400 }
    );
  }

  const nodeId = gData.codeDiscountNode?.id || null;
  const codeFromShopify =
    gData.codeDiscountNode?.codeDiscount?.codes?.edges?.[0]?.node?.code || basicCodeDiscount.code;

  if (!nodeId) {
    return json(
      { ok: false, reason: "Shopify did not return a discount node id", raw: gData },
      { status: 500 }
    );
  }

  // 5) Persist the code + link request
  const codeRow = await prisma.tbl_powerbuy_codes.create({
    data: {
      powerbuy_id: pb.id,
      discount_code: codeFromShopify,
      discount_code_gid: nodeId,
      start_time: now,
      end_time: endsAt,
      powerbuy_product_id: pb.powerbuy_product_id ?? null,
    },
    select: { id: true },
  });

  await prisma.tbl_powerbuy_requests.update({
    where: { id: req.id },
    data: { confirmed_at: new Date(), code_id: codeRow.id },
  });

  // 6) Send confirmation email (mailer stays as-is)
  await sendConfirmEmail({
    powerbuyId: pb.id,
    to: req.email,
    discountCode: codeFromShopify,
    startAt: now,
    expiresAt: endsAt,
  });

  return json({
    ok: true,
    code: codeFromShopify,
    title,
    startsAt: now.toISOString(),
    endsAt: endsAt.toISOString(),
    nodeId,
  });
};

// -----------------------------
// Component
// -----------------------------
export default function PowerBuyConfirm() {
  const data = useLoaderData();

  return (
    <Page title="PowerBuy Confirmation">
      {!data?.ok ? (
        <Banner tone="critical" title="Couldn’t confirm">
          <p>{data?.reason || "Unknown error"}</p>
        </Banner>
      ) : (
        <Card>
          <InlineStack align="start" gap="400">
            <Box>
              <Text as="h2" variant="headingMd">Success!</Text>
              <Text as="p">Your discount code is:</Text>
              <Text as="p" variant="headingLg" tone="success" emphasis="strong">
                {data.code}
              </Text>
              <Box paddingBlockStart="200">
                <Text as="p" tone="subdued">
                  Valid from {new Date(data.startsAt).toLocaleString()} to{" "}
                  {new Date(data.endsAt).toLocaleString()}
                </Text>
              </Box>
            </Box>
          </InlineStack>
        </Card>
      )}
    </Page>
  );
}
