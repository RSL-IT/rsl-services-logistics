// app/routes/apps.powerbuy.confirm.jsx
// VERSION: html-only-view

import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { prisma } from "~/db.server";
import { runAdminQuery, shopTimeZone } from "~/shopify-admin.server";
import { makeAddDurationUTCForShop } from "~/utils/duration-parser.server";
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

// =====================================================
// LOADER — single function declaration (no trailing `};`)
// =====================================================
export async function loader({ request }) {
  await verifyProxyIfPresent(request);

  const tsNow = new Date(); // define once

  const tz = await shopTimeZone(request); // e.g., "America/Los_Angeles"
  console.log("confirm-loader: tz: ", tz);
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

  if (req?.confirmed_at) {
    const pick = { select: { discount_code: true, start_time: true, end_time: true, id: true } };

    async function findByIdLoose(id) {
      // attempt 1: raw
      let row = await prisma.tbl_powerbuy_codes.findFirst({ where: { id }, ...pick });
      if (row) return row;

      // attempt 2: numeric cast
      if (typeof id === "string" && /^\d+$/.test(id)) {
        row = await prisma.tbl_powerbuy_codes.findFirst({ where: { id: Number(id) }, ...pick });
        if (row) return row;
      }

      // attempt 3: bigint cast (if DB column is BIGINT)
      try {
        const bi = typeof id === "bigint" ? id : BigInt(id);
        row = await prisma.tbl_powerbuy_codes.findFirst({ where: { id: bi }, ...pick });
        if (row) return row;
      } catch (_) {
        // ignore BigInt parse errors
      }

      return null;
    }

    const codeRow = await findByIdLoose(req.code_id);

    if (!codeRow) {
      console.error("[PowerBuy Confirm] code lookup failed", {
        reqId: req.id,
        code_id_value: req.code_id,
        code_id_type: typeof req.code_id,
        powerbuy_id: req.powerbuy_id,
      });

      return json(
        { ok: false, reason: "Already confirmed, but code record not found" },
        { status: 404 }
      );
    }

    return json({
      ok: true,
      alreadyConfirmed: true,
      code: codeRow.discount_code,
      startsAt: codeRow.start_time,
      endsAt: codeRow.end_time,
    });
  }

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
      discount_type: true, // 'fixed' | 'percentage'
      discount_value: true, // Decimal
      discount_combines_with: true,
      duration: true, // e.g. '7d', '1 days', 'P7D'
      number_of_uses: true, // usage limit
      powerbuy_variant_ids: true, // comma-separated variant IDs
      short_description: true,
      powerbuy_product_id: true,
    },
  });
  if (!pb) {
    return json({ ok: false, reason: "PowerBuy config not found" }, { status: 400 });
  }

  // 3) Build discount payload
  const startsAtDate = tsNow.toISOString();
  console.log("DEBUG startsAtDate=", startsAtDate);
  // Duration handling (compute end in shop TZ, return ISO)
  const addDurationUTC = makeAddDurationUTCForShop(tz);
  const durationStr = (pb.duration || "2d").trim();
  const endsAtIso = addDurationUTC(durationStr);
  const endsAtDate = new Date(endsAtIso);

  const combines = parseCombinesWith(pb.discount_combines_with);
  const variantGids = toVariantGids(pb.powerbuy_variant_ids);
  const codeString = makeCode(pb.discount_prefix, pb.code_length - pb.discount_prefix.length);

  const rawVal = pb.discount_value ? String(pb.discount_value) : "0";
  const valueInput =
    (pb.discount_type || "fixed") === "percentage"
      ? { discountPercentage: { percentage: rawVal } }
      : { discountAmount: { amount: rawVal || "0", appliesOnEachItem: false } };

  const title = buildTitleWithTokens(pb.title, { pb, customerEmail: req.email });

  const basicCodeDiscount = {
    title,
    code: codeString,
    startsAt: startsAtDate,
    endsAt: endsAtIso,
    usageLimit: pb.number_of_uses ?? 1,
    appliesOncePerCustomer: true,
    combinesWith: combines,
    customerSelection: { all: true },
    customerGets: {
      items: variantGids.length
        ? { products: { productVariantsToAdd: variantGids } }
        : { all: true },
      value: valueInput,
    },
  };

  // 4) Shopify Admin GraphQL
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

  // 5) Persist
  const codeRow = await prisma.tbl_powerbuy_codes.create({
    data: {
      powerbuy_id: pb.id,
      discount_code: codeFromShopify,
      discount_code_gid: nodeId,
      start_time: tsNow,
      end_time: endsAtDate,
      powerbuy_product_id: pb.powerbuy_product_id ?? null,
    },
    select: { id: true },
  });

  await prisma.tbl_powerbuy_requests.update({
    where: { id: req.id },
    data: { confirmed_at: new Date(), code_id: codeRow.id },
  });

  // 6) Mail — format dates in the *shop* timezone for display
  const emailDateFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });

  const startsAtDisplay = emailDateFormatter.format(new Date(startsAtDate));
  const expiresAtDisplay = emailDateFormatter.format(endsAtDate);

  await sendConfirmEmail({
    powerbuyId: pb.id,
    to: req.email,
    discountCode: codeFromShopify,
    // These are now *already formatted* in the shop's timezone
    startsAt: startsAtDisplay,
    expiresAt: expiresAtDisplay,
    shortDescription: pb.short_description,
  });

  return json({
    ok: true,
    code: codeFromShopify,
    title,
    startsAt: startsAtDate,
    endsAt: endsAtDate,
    nodeId,
  });
}

// -----------------------------
// Component (plain HTML / JSX)
// -----------------------------
export default function PowerBuyConfirm() {
  const data = useLoaderData();

  // Render minimal HTML without Polaris
  const wrapper = {
    maxWidth: 800,
    margin: "40px auto",
    padding: "24px",
    border: "1px solid #e5e7eb",
    borderRadius: 12,
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol"',
    lineHeight: 1.5,
    color: "#111827",
    background: "#ffffff",
  };
  const h1 = { fontSize: 28, margin: "0 0 12px" };
  const sub = { color: "#6b7280", marginTop: 4, fontSize: 14 };
  const codeBox = {
    marginTop: 16,
    padding: "16px 20px",
    borderRadius: 12,
    border: "1px solid #d1d5db",
    background: "#f9fafb",
    fontSize: 24,
    fontWeight: 700,
    letterSpacing: 1,
  };
  const sectionH = { fontSize: 18, margin: "24px 0 8px" };
  const bullet = { margin: "6px 0" };
  const muted = { color: "#6b7280" };
  const notice = {
    marginTop: 8,
    padding: "12px 14px",
    borderRadius: 10,
    border: "1px solid #dbeafe",
    background: "#eff6ff",
    fontSize: 14,
  };

  if (!data?.ok) {
    return (
      <main style={wrapper}>
        <h1 style={h1}>Couldn’t confirm</h1>
        <p>{data?.reason || "Something went wrong."}</p>
      </main>
    );
  }

  const starts = data?.startsAt ? new Date(data.startsAt) : null;
  const ends = data?.endsAt ? new Date(data.endsAt) : null;
  const startsText = starts ? starts.toLocaleString() : "";
  const endsText = ends ? ends.toLocaleString() : "";
  const shortDescription = data?.short_description ? " " + data.short_description : "";

  return (
    <main style={wrapper}>
      <h1 style={h1}>RSL PowerBuy Validation – Success!</h1>
      <p>&nbsp;</p>
      <h2 style={sectionH}>Your email address has been validated.</h2>
      <p>
        You will shortly receive an email with your instructions, your PowerBuy code, and the link
        you’ll use to purchase your Speedwoofer{shortDescription}(s).
      </p>
      <p>(You may now close this browser tab/window.) </p>
    </main>
  );
}
