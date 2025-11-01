// app/routes/apps.powerbuy.confirm.jsx
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { Page, Card, Box, BlockStack, Text } from "@shopify/polaris";
import { prisma } from "~/db.server";
import { getOfflineSession } from "~/shopify-admin.server";

const API_VERSION = process.env.SHOPIFY_API_VERSION || "2025-01";

/* ---------------- helpers ---------------- */

function parseDurationMs(input) {
  if (!input) return 0;
  const s = String(input).trim().toLowerCase();
  const re = /(\d+(?:\.\d+)?)\s*(months?|mos?|month|mo\b|weeks?|w|days?|d|hours?|hrs?|hr|h|minutes?|mins?|min|m(?!o\b)|seconds?|secs?|sec|s)\b/g;
  let ms = 0, m;
  const add = (n, unit) => {
    if (/^mo(nths?)?$|^mos?$/.test(unit))            ms += n * 30 * 24 * 60 * 60 * 1000; // ~30d
    else if (/^weeks?$|^w$/.test(unit))              ms += n * 7 * 24 * 60 * 60 * 1000;
    else if (/^days?$|^d$/.test(unit))               ms += n * 24 * 60 * 60 * 1000;
    else if (/^hours?$|^hrs?$|^hr$|^h$/.test(unit))  ms += n * 60 * 60 * 1000;
    else if (/^minutes?$|^mins?$|^min$|^m$/.test(unit)) ms += n * 60 * 1000;
    else if (/^seconds?$|^secs?$|^sec$|^s$/.test(unit)) ms += n * 1000;
  };
  while ((m = re.exec(s))) add(Number(m[1]), m[2]);
  return ms;
}

function parseVariantIdsFromConfig(cfg) {
  const raw = String(cfg?.powerbuy_variant_ids || "").trim();
  if (!raw) return [];
  return raw
    .split(/[,\s;]+/)
    .map((t) => String(t).trim())
    .map((id) => {
      const m = id.match(/(\d{6,})$/);
      return m ? Number(m[1]) : Number(id);
    })
    .filter((n) => Number.isFinite(n));
}

async function fetchShopTimezone(shop, accessToken) {
  const res = await fetch(`https://${shop}/admin/api/${API_VERSION}/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": accessToken },
    body: JSON.stringify({ query: `query{ shop { ianaTimezone timezoneOffsetMinutes } }` }),
  });
  const body = await res.json();
  if (!res.ok || body.errors) throw new Error("Failed to read shop timezone");
  return {
    iana: body?.data?.shop?.ianaTimezone || "UTC",
    offsetMin: Number(body?.data?.shop?.timezoneOffsetMinutes ?? 0),
  };
}

function computeWindowUsingStartPlusDuration({ shopOffsetMin, cfgStart, durationMs }) {
  const nowUtc = new Date();
  const nowLocalMs = nowUtc.getTime() + shopOffsetMin * 60 * 1000;

  let startLocalMs;
  if (cfgStart instanceof Date && !isNaN(cfgStart)) {
    startLocalMs = cfgStart.getTime();
  } else {
    startLocalMs = nowLocalMs;
  }

  const endLocalMs = startLocalMs + (Number(durationMs) || 0);

  const starts_at_utc = new Date(startLocalMs - shopOffsetMin * 60 * 1000);
  const ends_at_utc   = new Date(endLocalMs   - shopOffsetMin * 60 * 1000);

  return {
    starts_at_utc,
    ends_at_utc,
    start_local: new Date(startLocalMs),
    end_local: new Date(endLocalMs),
  };
}

function buildTitle(cfg, email) {
  const short = String(cfg?.short_description || cfg?.title || "PowerBuy");
  return `2025 Power Buy (${short}) - ${email}`;
}

function makeCode(prefix, len, type = "numeric") {
  const L = Math.max(6, Math.min(32, Number(len) || 15));
  const pref = String(prefix || "").toUpperCase();
  const need = Math.max(0, L - pref.length);
  const alpha = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const digits = "0123456789";
  const bag = type === "alpha" ? alpha : type === "mixed" ? alpha + digits : digits;
  let tail = "";
  for (let i = 0; i < need; i++) tail += bag[Math.floor(Math.random() * bag.length)];
  return pref + tail;
}

async function createPriceRuleAndCode({
                                        shop, accessToken, title,
                                        discountType, discountValue,
                                        startsAtUtc, endsAtUtc,
                                        usageLimit, code, entitledVariantIds
                                      }) {
  const value_type = discountType === "fixed" ? "fixed_amount" : "percentage";
  const value = `-${Number(discountValue || 0)}`;

  const rulePayload = {
    price_rule: {
      title,
      target_type: "line_item",
      target_selection: entitledVariantIds?.length ? "entitled" : "all",
      allocation_method: "across",
      value_type,
      value,
      customer_selection: "all",
      starts_at: startsAtUtc.toISOString(),
      ends_at: endsAtUtc.toISOString(),
      ...(usageLimit ? { usage_limit: usageLimit } : {}),
      ...(entitledVariantIds?.length ? { entitled_variant_ids: entitledVariantIds } : {}),
      once_per_customer: false,
    },
  };

  const base = `https://${shop}/admin/api/${API_VERSION}`;
  const headers = { "Content-Type": "application/json", "X-Shopify-Access-Token": accessToken };

  const prRes = await fetch(`${base}/price_rules.json`, { method: "POST", headers, body: JSON.stringify(rulePayload) });
  const prText = await prRes.text();
  if (!prRes.ok) throw new Error(`Price rule create failed (${prRes.status}): ${prText.slice(0, 800)}`);
  const pr = JSON.parse(prText);
  const priceRuleId = pr?.price_rule?.id;
  if (!priceRuleId) throw new Error("No price_rule.id returned");

  const dcRes = await fetch(`${base}/price_rules/${priceRuleId}/discount_codes.json`, {
    method: "POST", headers, body: JSON.stringify({ discount_code: { code } }),
  });
  const dcText = await dcRes.text();
  if (!dcRes.ok) throw new Error(`Discount code create failed (${dcRes.status}): ${dcText.slice(0, 800)}`);
  const dc = JSON.parse(dcText);
  const discountId = dc?.discount_code?.id;
  if (!discountId) throw new Error("No discount_code.id returned");

  return {
    priceRuleId,
    discountCodeId: discountId,
    discountGid: `gid://shopify/DiscountCodeNode/${discountId}`,
  };
}

/* ---------------- loader (GET confirm) ---------------- */

export async function loader({ request }) {
  const url = new URL(request.url);
  const token = (url.searchParams.get("token") || "").trim();
  const shop  = (url.searchParams.get("shop")  || "").trim().toLowerCase();

  if (!token || !shop) return json({ ok: false, error: "Missing token or shop." }, { status: 400 });

  const reqRow = await prisma.tbl_powerbuy_requests.findUnique({
    where: { token },
    include: { powerbuy: true },
  });
  if (!reqRow) return json({ ok: false, error: "Invalid or unknown token." }, { status: 404 });

  const cfg = reqRow.powerbuy;
  if (!cfg) return json({ ok: false, error: "PowerBuy configuration not found." }, { status: 400 });

  const allow = String(cfg.allowed_stores || "")
    .split(/[\s,;]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (allow.length && !allow.includes(shop)) {
    return json({ ok: false, error: `Shop ${shop} is not allowed for this PowerBuy.` }, { status: 403 });
  }

  // Idempotency: claim this token
  const claimed = await prisma.tbl_powerbuy_requests.updateMany({
    where: { id: reqRow.id, confirmed_at: null },
    data: { confirmed_at: new Date(0) },
  });
  if (claimed.count === 0) {
    return json({ ok: true, alreadyConfirmed: true, message: "This confirmation link was already used." });
  }

  let revertClaim = true;
  try {
    const offline = await getOfflineSession(shop);
    if (!offline?.accessToken) {
      throw new Error(`No offline Admin session found for ${shop}. Re-install or re-authorize the app.`);
    }

    const { offsetMin } = await fetchShopTimezone(shop, offline.accessToken);

    // START = cfg.start_time (if provided) else "now" in shop local; END = START + DURATION (always)
    const durationMs = parseDurationMs(cfg.duration || "");
    if (!durationMs || durationMs <= 0) throw new Error(`Invalid duration "${cfg.duration}"`);
    const cfgStart = cfg.start_time instanceof Date ? cfg.start_time : null;

    const { starts_at_utc, ends_at_utc } = computeWindowUsingStartPlusDuration({
      shopOffsetMin: offsetMin,
      cfgStart,
      durationMs,
    });

    const nowUtc = new Date();
    if (starts_at_utc > nowUtc) {
      return json({ ok: false, error: "This PowerBuy hasn't started yet." }, { status: 403 });
    }

    const title = buildTitle(cfg, reqRow.email);
    const code = makeCode(cfg.discount_prefix || "PB", cfg.code_length || 15, String(cfg.code_type || "numeric"));
    const entitledVariantIds = parseVariantIdsFromConfig(cfg);

    const { priceRuleId, discountCodeId, discountGid } = await createPriceRuleAndCode({
      shop,
      accessToken: offline.accessToken,
      title,
      discountType: String(cfg.discount_type || "percentage"),
      discountValue: Number(cfg.discount_value || 0),
      startsAtUtc: starts_at_utc,
      endsAtUtc:   ends_at_utc,
      usageLimit: cfg.number_of_uses ?? null,
      code,
      entitledVariantIds,
    });

    await prisma.tbl_powerbuy_codes.create({
      data: {
        powerbuy_id: cfg.id,
        discount_code: code,
        discount_code_gid: discountGid,
        rsl_contact_email_address: cfg.rsl_contact_email_address || null,
        start_time: starts_at_utc, // timestamptz (UTC)
        end_time: ends_at_utc,     // timestamptz (UTC)
        number_of_uses: cfg.number_of_uses ?? null,
        powerbuy_product_id: cfg.powerbuy_product_id || null,
      },
    });

    await prisma.tbl_powerbuy_requests.update({
      where: { id: reqRow.id },
      data: { confirmed_at: new Date() },
    });
    revertClaim = false;

    return json({
      ok: true,
      price_rule_id: priceRuleId,
      discount_code_id: discountCodeId,
      discount_code: code,
      starts_at_utc: starts_at_utc.toISOString(),
      ends_at_utc: ends_at_utc.toISOString(),
    });
  } catch (e) {
    if (revertClaim) {
      try {
        await prisma.tbl_powerbuy_requests.update({
          where: { id: reqRow.id },
          data: { confirmed_at: null },
        });
      } catch {}
    }
    return json({ ok: false, error: String(e) }, { status: 500 });
  }
}

/* ---------------- minimal UI ---------------- */

export default function ConfirmPage() {
  const data = useLoaderData();
  return (
    <Page title="RSL Speakers • PowerBuy">
      <Card>
        <Box padding="400">
          {data?.ok ? (
            data.alreadyConfirmed ? (
              <BlockStack gap="200">
                <Text variant="bodyLg" as="p">Confirm your email and get your PowerBuy code.</Text>
                <Text tone="subdued">This link was already confirmed earlier.</Text>
              </BlockStack>
            ) : (
              <BlockStack gap="200">
                <Text variant="bodyLg" as="p">Confirm your email and get your PowerBuy code.</Text>
                <Text>Success! Your code is <b>{data.discount_code}</b>.</Text>
                <Text tone="subdued">
                  Active window (UTC): {new Date(data.starts_at_utc).toLocaleString()} → {new Date(data.ends_at_utc).toLocaleString()}
                </Text>
              </BlockStack>
            )
          ) : (
            <BlockStack gap="200">
              <Text variant="bodyLg" as="p">Confirm your email and get your PowerBuy code.</Text>
              <Text tone="critical">Failed to create your discount.</Text>
              <Text tone="subdued">{String(data?.error || "Unknown error")}</Text>
            </BlockStack>
          )}
        </Box>
      </Card>
    </Page>
  );
}
