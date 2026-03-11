import { json } from "@remix-run/node";
import { logisticsDb } from "~/logistics-db.server";
import { getLogisticsUserFromRequest } from "~/logistics-auth.server";
import { runAdminQuery } from "~/shopify-admin.server";
import { verifyProxyIfPresent } from "~/utils/app-proxy-verify.server";

function cleanStr(v) {
  return String(v ?? "").trim();
}

function getShopFromRequest(request) {
  try {
    const url = new URL(request.url);
    const fromQuery = cleanStr(url.searchParams.get("shop"));
    if (fromQuery) return fromQuery;
  } catch {
    // ignore URL parse issues
  }
  const fromHeader = cleanStr(request.headers.get("x-shopify-shop-domain"));
  return fromHeader || null;
}

function dbUserHasPermission(dbUser, permissionShortName) {
  if (!dbUser || !permissionShortName) return false;
  const links = Array.isArray(dbUser.tbljn_logisticsUser_permission)
    ? dbUser.tbljn_logisticsUser_permission
    : [];
  return links.some((x) => x?.tlkp_permission?.shortName === permissionShortName);
}

function extractShopifyErrorMessages(rawErrors) {
  if (!rawErrors) return [];
  const list = Array.isArray(rawErrors) ? rawErrors : [rawErrors];
  const out = [];
  for (const err of list) {
    if (!err) continue;
    if (typeof err === "string") {
      if (err.trim()) out.push(err.trim());
      continue;
    }
    if (typeof err?.message === "string" && err.message.trim()) {
      out.push(err.message.trim());
      continue;
    }
    try {
      const s = JSON.stringify(err);
      if (s && s !== "{}") out.push(s);
    } catch {
      // ignore serialization failures
    }
  }
  return out;
}

const PROBE_QUERY = `#graphql
  query LogisticsApiProbe(
    $ordersFirst: Int!
    $draftFirst: Int!
    $variantsFirst: Int!
    $filesFirst: Int!
  ) {
    shop {
      id
      name
      email
      url
      currencyCode
      ianaTimezone
      timezoneAbbreviation
    }
    orders(first: $ordersFirst) {
      edges {
        node {
          id
          name
          poNumber
          createdAt
          displayFulfillmentStatus
          returnStatus
          currentTotalPriceSet {
            shopMoney {
              amount
              currencyCode
            }
          }
          customer {
            displayName
            email
          }
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
    draftOrders(first: $draftFirst) {
      edges {
        node {
          id
          name
          poNumber
          status
          createdAt
          updatedAt
          totalPriceSet {
            shopMoney {
              amount
              currencyCode
            }
          }
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
    productVariants(first: $variantsFirst) {
      edges {
        node {
          id
          sku
          title
          updatedAt
          product {
            title
          }
          selectedOptions {
            name
            value
          }
          metafield(namespace: "custom", key: "surface_to_logistics") {
            value
            type
          }
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
    files(first: $filesFirst) {
      edges {
        node {
          __typename
          id
          alt
          createdAt
          updatedAt
          fileStatus
          ... on GenericFile {
            url
            mimeType
            originalFileSize
          }
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

export async function action({ request }) {
  const debug = { stage: "start", proxyVerified: false };

  const actor = await getLogisticsUserFromRequest(request);
  if (!actor) {
    return json({ ok: false, error: "Unauthorized", debug }, { status: 401 });
  }

  try {
    await verifyProxyIfPresent(request);
    debug.proxyVerified = true;
  } catch {
    debug.proxyVerified = false;
    debug.proxySkipReason = "no_proxy_signature";
  }

  debug.stage = "authorize";
  const actorWithPerms = await logisticsDb.tbl_logisticsUser.findUnique({
    where: { id: Number(actor.id) },
    include: {
      tbljn_logisticsUser_permission: {
        include: { tlkp_permission: true },
      },
    },
  });

  if (!dbUserHasPermission(actorWithPerms, "debug_view")) {
    return json({ ok: false, error: "Forbidden", debug }, { status: 403 });
  }

  const shop = getShopFromRequest(request);
  if (!shop) {
    return json(
      {
        ok: false,
        error: "Missing shop context for API probe. Include ?shop=... on the request.",
        debug,
      },
      { status: 400 }
    );
  }

  debug.stage = "run-probe";
  const probeResp = await runAdminQuery(shop, PROBE_QUERY, {
    ordersFirst: 3,
    draftFirst: 3,
    variantsFirst: 5,
    filesFirst: 5,
  });

  const errorMessages = extractShopifyErrorMessages(probeResp?.errors);
  if (errorMessages.length) {
    const msg = `Shopify Admin API probe failed: ${errorMessages.join("; ")}`;
    console.error("[logistics api-probe] graphql errors", {
      actorId: actor.id,
      shop,
      errors: probeResp?.errors,
    });
    return json({ ok: false, error: msg, debug }, { status: 502 });
  }

  const ranAt = new Date().toISOString();
  const probe = probeResp?.data || {};

  console.info("[logistics api-probe] success", {
    actorId: actor.id,
    shop,
    ranAt,
    probe,
  });

  return json({ ok: true, shop, ranAt, probe, debug });
}

export async function loader() {
  return json({ ok: false, error: "Method Not Allowed" }, { status: 405 });
}

