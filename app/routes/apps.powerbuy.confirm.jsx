// app/routes/apps.powerbuy.confirm.jsx
import {json} from "@remix-run/node";
import {useLoaderData} from "@remix-run/react";
import {Page, Card, Text, Banner, InlineStack, Box} from "@shopify/polaris";
import {prisma} from "~/db.server";
import {runAdminQuery} from "~/shopify-admin.server";
import {sendConfirmEmail} from "~/services/mailer.server";

// ----- helpers -----

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
  // Accepts things like "7d", "10", "P7D"; fallback 7 days
  if (!duration) return addDays(start, 7);
  const raw = String(duration).trim();
  const matchNum = raw.match(/^(\d+)$/);
  if (matchNum) return addDays(start, parseInt(matchNum[1], 10));
  const matchDays = raw.match(/^(\d+)\s*d$/i);
  if (matchDays) return addDays(start, parseInt(matchDays[1], 10));
  // crude ISO PnD
  const matchIso = raw.match(/^P(\d+)D$/i);
  if (matchIso) return addDays(start, parseInt(matchIso[1], 10));
  return addDays(start, 7);
}

function makeCode(prefix, length = 6) {
  const L = Math.max(1, Math.min(12, Number(length) || 6));
  let n = "";
  while (n.length < L) n += Math.floor(Math.random() * 10);
  return `${String(prefix || "RSLPB").toUpperCase()}${n}`;
}

function applyTitleTokens(template, {pb, customerEmail}) {
  const src = String(template ?? "").trim();
  if (!src) return `PowerBuy - ${customerEmail || ""}`;
  return src.replace(/\[([^\]]+)\]/g, (_m, keyRaw) => {
    const key = String(keyRaw || "").trim().toLowerCase();
    switch (key) {
      case "short_description":
        return pb?.short_description ?? "";
      case "customer_email":
        return customerEmail ?? "";
      default:
        return ""; // unknown tokens drop out
    }
  });
}

// ----- GraphQL -----

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

// ----- loader (server) -----

export const loader = async ({request}) => {
  const url = new URL(request.url);
  const token = url.searchParams.get("token")?.trim();
  const shop = url.searchParams.get("shop")?.trim();

  if (!token || !shop) {
    return json(
      { ok: false, reason: "Missing token or shop" },
      { status: 400 }
    );
  }

  // 1) Lookup request by token
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

  if (!req) {
    return json({ ok: false, reason: "Invalid token" }, { status: 400 });
  }
  if (req.confirmed_at) {
    return json({ ok: false, reason: "Already confirmed" }, { status: 400 });
  }

  // 2) Get config row
  const pb = await prisma.tbl_powerbuy_config.findUnique({
    where: { id: req.powerbuy_id },
    select: {
      id: true,
      title: true,
      discount_prefix: true,
      discount_type: true,         // 'fixed' | 'percentage'
      discount_value: true,        // Decimal
      discount_combines_with: true,
      duration: true,              // e.g. '7d'
      number_of_uses: true,        // usage limit for the code
      powerbuy_variant_ids: true,  // comma-separated variant IDs
      short_description: true,
    },
  });

  if (!pb) {
    return json({ ok: false, reason: "PowerBuy config not found" }, { status: 400 });
  }

  // 3) Build discount input
  const now = new Date();
  const endsAt = durationToEnd(now, pb.duration);
  const combines = parseCombinesWith(pb.discount_combines_with);
  const variantGids = toVariantGids(pb.powerbuy_variant_ids);
  const codeString = makeCode(pb.discount_prefix, /*length*/ 6);

  // Discount value mapping
  let valueInput;
  const val = pb.discount_value ? String(pb.discount_value) : "0";
  if ((pb.discount_type || "fixed") === "percentage") {
    valueInput = { discountPercentage: { percentage: val } };
  } else {
    // fixed amount; "once per order" achieved by appliesOnEachItem: false
    valueInput = { discountAmount: { amount: val || "0", appliesOnEachItem: false } };
  }

  // Title with tokens
  const title = applyTitleTokens(pb.title, { pb, customerEmail: req.email });

  const basicCodeDiscount = {
    title,
    code: codeString,
    startsAt: now.toISOString(),
    endsAt: endsAt.toISOString(),
    usageLimit: pb.number_of_uses ?? 1,
    appliesOncePerCustomer: true, // "use only once" per customer
    combinesWith: combines,
    customerSelection: { all: true }, // avoid BLANK error
    customerGets: {
      items: variantGids.length
        ? { products: { productVariantsToAdd: variantGids } }
        : { all: true }, // fallback if no variants configured
      value: valueInput,
    },
  };

  // 4) Create discount in Admin GraphQL
  const gql = await runAdminQuery(shop, CREATE_MUTATION, {
    basicCodeDiscount,
  });

  const gData = gql?.data?.discountCodeBasicCreate;
  const gErrors = gql?.errors;
  if (gErrors?.length) {
    return json(
      { ok: false, reason: "Shopify GraphQL errors", details: gErrors },
      { status: 500 }
    );
  }
  if (!gData) {
    return json(
      { ok: false, reason: "No data from Shopify", raw: gql },
      { status: 500 }
    );
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

  // 5) Persist code + link request
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

  // 6) EMAIL: use your mailer as-is
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

// ----- component (client) -----

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
