// app/routes/apps.powerbuy.confirm.jsx
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { Page, Card, Text, Box } from "@shopify/polaris";

import { prisma } from "~/db.server";
import { sendConfirmEmail } from "~/services/mailer.server";

// Use the same version everywhere
const API_VERSION = process.env.SHOPIFY_API_VERSION || "2024-10";

/* -------------------- utilities -------------------- */
function parseDurationMs(input) {
  if (!input || typeof input !== "string") return 24 * 60 * 60 * 1000; // default 24h
  const s = input.trim().toLowerCase();
  const m = s.match(
    /(\d+(?:\.\d+)?)\s*(weeks?|w|days?|d|hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)/
  );
  if (!m) return 24 * 60 * 60 * 1000;

  const num = parseFloat(m[1]);
  const unit = m[2];

  const SEC = 1000;
  const MIN = 60 * SEC;
  const HOUR = 60 * MIN;
  const DAY = 24 * HOUR;
  const WEEK = 7 * DAY;

  if (/^w(eeks?)?$/.test(unit)) return num * WEEK;
  if (/^d(ays?)?$/.test(unit)) return num * DAY;
  if (/^h(ours?|rs?)?$/.test(unit)) return num * HOUR;
  if (/^m(in(utes?)?)?$/.test(unit)) return num * MIN;
  if (/^s(ec(onds?)?)?$/.test(unit)) return num * SEC;
  return 24 * 60 * 60 * 1000;
}

function safeInt(x) {
  if (x == null) return undefined;
  const n = Number(x);
  return Number.isFinite(n) ? n : undefined;
}

function makeCode({ prefix = "", len = 16, type = "alpha" }) {
  const A = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // avoid I/O
  const D = "23456789"; // avoid 0/1
  const AD = A + D;

  let alphabet = A;
  if (type === "numeric") alphabet = D;
  else if (type === "mixed") alphabet = AD;

  const bodyLen = Math.max(1, len - prefix.length);
  let str = prefix.toUpperCase();
  for (let i = 0; i < bodyLen; i++) {
    str += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return str;
}

function asIso(d) {
  return new Date(d).toISOString();
}

/** Parse pb.discount_combines_with (csv of product, order, shipping) -> Shopify flags */
function parseCombinesWith(csv) {
  const flags = (csv || "")
    .toLowerCase()
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const product = flags.includes("product");
  const order = flags.includes("order");
  const shipping = flags.includes("shipping");

  return {
    product_discounts: product,
    order_discounts: order,
    shipping_discounts: shipping,
  };
}

/* -------------------- Admin REST via stored offline token -------------------- */
async function getOfflineAccessToken(shop) {
  const row = await prisma.session.findFirst({
    where: { shop, isOnline: false },
    select: { accessToken: true },
  });
  if (!row?.accessToken) {
    throw new Error(
      `Offline Admin token not found for ${shop}. Ensure the app installed an offline session.`
    );
  }
  return row.accessToken;
}

async function adminFetch(shop, token, path, { method = "GET", data } = {}) {
  const url = `https://${shop}/admin/api/${API_VERSION}/${path}`;
  const headers = {
    "X-Shopify-Access-Token": token,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  const res = await fetch(url, {
    method,
    headers,
    body: data ? JSON.stringify(data) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Admin REST ${method} ${path} failed: ${res.status} ${res.statusText} ${text}`.trim()
    );
  }
  return res.json();
}

/* -------------------- loader -------------------- */
export const loader = async ({ request }) => {
  try {
    const url = new URL(request.url);
    const tokenParam = url.searchParams.get("token")?.trim();
    const shop =
      url.searchParams.get("shop")?.trim() ||
      url.searchParams.get("store")?.trim();

    if (!tokenParam || !shop) {
      return json({ ok: false, error: "Missing token or shop." }, { status: 400 });
    }

    // 1) Load request + config
    const reqRow = await prisma.tbl_powerbuy_requests.findFirst({
      where: { token: tokenParam },
      include: { powerbuy: true },
    });
    if (!reqRow) {
      return json({ ok: false, error: "Invalid or unknown confirmation token." }, { status: 404 });
    }

    if (reqRow.confirmed_at) {
      // Already confirmed — return the last code we linked (preferred) or last for this powerbuy
      let code = null;
      if (reqRow.code_id) {
        code = await prisma.tbl_powerbuy_codes.findUnique({ where: { id: reqRow.code_id } });
      }
      if (!code) {
        code = await prisma.tbl_powerbuy_codes.findFirst({
          where: { powerbuy_id: reqRow.powerbuy_id },
          orderBy: { id: "desc" },
        });
      }
      return json({
        ok: true,
        alreadyConfirmed: true,
        discountCode: code?.discount_code || "(already confirmed)",
      });
    }

    if (reqRow.token_expires && new Date(reqRow.token_expires).getTime() < Date.now()) {
      return json({ ok: false, error: "Confirmation link has expired." }, { status: 410 });
    }

    const pb = reqRow.powerbuy;
    if (!pb) {
      return json({ ok: false, error: "PowerBuy config missing." }, { status: 500 });
    }

    // 2) Timing: start now; end = start + duration (ignore config end_time)
    const startAt = new Date();
    const endAt = new Date(startAt.getTime() + parseDurationMs(pb.duration));

    // 3) Admin token
    const adminToken = await getOfflineAccessToken(shop);

    // 4) Price rule payload (with combines_from csv)
    const title = `${new Date().getFullYear()} Power Buy (${pb.short_description || "Offer"}) - ${reqRow.email}`;

    const valueType = pb.discount_type === "fixed" ? "fixed_amount" : "percentage";
    const valueNum = Number(pb.discount_value || 0);
    if (!Number.isFinite(valueNum) || valueNum <= 0) {
      throw new Error("Invalid discount_value in config.");
    }
    // Shopify expects a negative number string
    const valueStr = `-${Math.abs(valueNum)}`;

    const combines = parseCombinesWith(pb.discount_combines_with);

    const entitled_variant_ids = [];
    const variantIdNum = safeInt(reqRow.product_id); // request endpoint saved the variant id here
    if (variantIdNum) entitled_variant_ids.push(variantIdNum);

    const priceRulePayload = {
      price_rule: {
        title,
        target_type: "line_item",
        target_selection: entitled_variant_ids.length ? "entitled" : "all",
        allocation_method: "across",
        value_type: valueType,
        value: valueStr,
        once_per_customer: false,
        customer_selection: "all",
        starts_at: asIso(startAt),
        ends_at: asIso(endAt),
        usage_limit: safeInt(pb.number_of_uses),
        combines_with: {
          product_discounts: !!combines.product_discounts,
          order_discounts: !!combines.order_discounts,
          shipping_discounts: !!combines.shipping_discounts,
        },
        ...(entitled_variant_ids.length ? { entitled_variant_ids } : {}),
      },
    };

    const ruleRes = await adminFetch(shop, adminToken, "price_rules.json", {
      method: "POST",
      data: priceRulePayload,
    });
    const priceRule = ruleRes?.price_rule;
    if (!priceRule?.id) throw new Error("Failed to create price rule.");

    // 5) Create discount code
    const prefix = (pb.discount_prefix || "").trim();
    const codeLen = safeInt(pb.code_length) || 16;
    const codeType = pb.code_type || "alpha";
    const codeStr = makeCode({ prefix, len: codeLen, type: codeType });

    const codeRes = await adminFetch(
      shop,
      adminToken,
      `price_rules/${priceRule.id}/discount_codes.json`,
      { method: "POST", data: { discount_code: { code: codeStr } } }
    );
    const dc = codeRes?.discount_code;
    if (!dc?.id) throw new Error("Failed to create discount code.");

    // 6) Persist in tbl_powerbuy_codes
    const codeRow = await prisma.tbl_powerbuy_codes.create({
      data: {
        powerbuy_id: pb.id,
        discount_code: dc.code,
        discount_code_gid: `gid://shopify/DiscountCode/${dc.id}`, // REST id mapping
        rsl_contact_email_address: pb.rsl_contact_email_address || null,
        start_time: startAt,
        end_time: endAt,
        number_of_uses: safeInt(pb.number_of_uses) ?? null,
        powerbuy_product_id: pb.powerbuy_product_id || null,
      },
    });

    // 7) Mark request confirmed + link code_id
    await prisma.tbl_powerbuy_requests.update({
      where: { id: reqRow.id },
      data: { confirmed_at: new Date(), code_id: codeRow.id },
    });

    // 8) Email the code
    try {
      await sendConfirmEmail({
        powerbuyId: pb.id,
        to: reqRow.email,
        discountCode: dc.code,
        startAt,
        expiresAt: endAt,
      });
    } catch (mailErr) {
      console.error("[PowerBuy][confirm] email error:", mailErr);
      return json({
        ok: true,
        discountCode: dc.code,
        mailed: false,
        mailError: String(mailErr?.message || mailErr),
        ruleId: priceRule.id,
        codeDbId: codeRow.id,
      });
    }

    return json({
      ok: true,
      discountCode: dc.code,
      mailed: true,
      ruleId: priceRule.id,
      codeDbId: codeRow.id,
    });
  } catch (err) {
    console.error("[PowerBuy][confirm] loader failed:", err);
    return json({ ok: false, error: err?.message || String(err) }, { status: 500 });
  }
};

/* -------------------- UI -------------------- */
export default function ConfirmPage() {
  const data = useLoaderData();
  const ok = !!data?.ok;

  return (
    <Page title="PowerBuy Confirmation">
      <Card>
        <Box padding="400">
          {ok ? (
            <>
              <Text as="h2" variant="headingMd">
                You’re all set!
              </Text>
              <Box paddingBlockStart="300">
                <Text as="p" variant="bodyMd">
                  Your discount code is:
                </Text>
                <Text as="p" variant="headingLg">
                  {data.discountCode}
                </Text>
                {data.mailed === false && data.mailError && (
                  <Box paddingBlockStart="300">
                    <Text as="p" tone="critical">
                      We created your code, but couldn’t send the email: {data.mailError}
                    </Text>
                  </Box>
                )}
                {data.alreadyConfirmed && (
                  <Box paddingBlockStart="300">
                    <Text as="p" tone="subdued">
                      This request was already confirmed earlier.
                    </Text>
                  </Box>
                )}
              </Box>
            </>
          ) : (
            <>
              <Text as="h2" variant="headingMd">
                Couldn’t confirm
              </Text>
              <Box paddingBlockStart="300">
                <Text as="p" tone="critical">
                  {data?.error || "Unexpected error"}
                </Text>
              </Box>
            </>
          )}
        </Box>
      </Card>
    </Page>
  );
}
