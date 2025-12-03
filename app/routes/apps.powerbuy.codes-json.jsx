// app/routes/apps.powerbuy.codes-json.jsx
// JSON version of the PowerBuy codes list, based on apps.powerbuy.codes.jsx.
//
// Returns:
//   {
//     codes: [
//       {
//         id,
//         discountCode,
//         title,
//         purchaseUrl,
//         endTime,
//         limitOfUses,
//         usedCount,
//         remaining,
//         isActive
//       },
//       ...
//     ]
//   }

import { json } from "@remix-run/node";
import { prisma } from "~/db.server";
import { runAdminQuery } from "~/shopify-admin.server";
import { verifyProxyIfPresent } from "~/utils/app-proxy-verify.server";

// Base storefront, used to build full purchase URLs
const STOREFRONT_BASE =
  process.env.RSL_STOREFRONT_BASE || "https://rslspeakers.com";

function slugify(text) {
  return String(text || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export async function loader({ request }) {
  // Same proxy validation as the HTML page
  await verifyProxyIfPresent(request);

  const url = new URL(request.url);
  const shop =
    url.searchParams.get("shop") ||
    process.env.SHOPIFY_SHOP_DOMAIN ||
    "rsldev.myshopify.com";

  // 1) Load PowerBuy configs (prefixes + titles + short_description)
  const configs = await prisma.tbl_powerbuy_config.findMany({
    where: { discount_prefix: { not: null } },
    select: {
      id: true,
      discount_prefix: true,
      short_description: true,
      title: true,
    },
  });

  const prefixes = configs
    .map((c) => (c.discount_prefix || "").trim())
    .filter((p) => p.length > 0);

  if (!prefixes.length) {
    console.log("[PB codes-json] No tbl_powerbuy_config rows with discount_prefix.");
    return json({ codes: [] });
  }

  const configByPrefix = new Map();
  for (const cfg of configs) {
    const p = (cfg.discount_prefix || "").trim().toUpperCase();
    if (!p) continue;
    configByPrefix.set(p, cfg);
  }

  // 2) Build title fragments from EACH config title (up to and including '(')
  const titleFragments = [];
  for (const cfg of configs) {
    const fullTitle = (cfg.title || "").trim();
    if (!fullTitle) continue;
    const idx = fullTitle.indexOf("(");
    const frag =
      idx !== -1 ? fullTitle.slice(0, idx + 1).trim() : fullTitle;
    if (!frag) continue;
    if (!titleFragments.includes(frag)) {
      titleFragments.push(frag);
    }
  }

  if (!titleFragments.length) {
    // Fallback if no title is set in configs
    titleFragments.push("RSL Power Buy");
  }

  // 3) Shopify Admin GraphQL query using discountNodes
  const GQL = `#graphql
    query PowerBuyDiscounts($first: Int!, $query: String!, $after: String) {
      discountNodes(first: $first, query: $query, after: $after) {
        edges {
          node {
            id
            discount {
              __typename
              ... on DiscountCodeBasic {
                title
                status
                summary
                startsAt
                endsAt
                createdAt
                usageLimit
                asyncUsageCount
                codes(first: 50) {
                  nodes {
                    code
                  }
                }
              }
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

  const allEdges = [];
  const seenIds = new Set();

  const FIRST_PER_PAGE = 50;
  const MAX_PAGES_PER_FRAGMENT = 5;

  for (const fragment of titleFragments) {
    const SEARCH_QUERY = `title:${fragment}*`;
    console.log("[PB codes-json] Using SEARCH_QUERY:", SEARCH_QUERY);

    let hasNextPage = true;
    let afterCursor = null;
    let page = 1;

    while (hasNextPage && page <= MAX_PAGES_PER_FRAGMENT) {
      let raw;
      try {
        raw = await runAdminQuery(shop, GQL, {
          first: FIRST_PER_PAGE,
          query: SEARCH_QUERY,
          after: afterCursor,
        });
      } catch (err) {
        console.error(
          `[PB codes-json] Error calling runAdminQuery for fragment "${fragment}" on page ${page}:`,
          err
        );
        break;
      }

      const root = raw && raw.data ? raw.data : raw;
      const block = root?.discountNodes;
      const edges = block?.edges ?? [];

      for (const edge of edges) {
        const id = edge?.node?.id;
        if (id && !seenIds.has(id)) {
          seenIds.add(id);
          allEdges.push(edge);
        }
      }

      hasNextPage = block?.pageInfo?.hasNextPage ?? false;
      afterCursor = block?.pageInfo?.endCursor ?? null;
      page += 1;
    }
  }

  console.log(
    "[PB codes-json] Total discountNodes edges collected:",
    allEdges.length
  );

  // 4) Map to our PowerBuy-specific discount list (same as HTML loader)
  const baseDiscounts = [];

  for (const edge of allEdges) {
    const node = edge?.node;
    const disc = node?.discount;
    if (!disc || disc.__typename !== "DiscountCodeBasic") continue;

    const codeNodes = disc.codes?.nodes ?? [];
    for (const cNode of codeNodes) {
      const code = cNode?.code;
      if (!code) continue;

      // Match this code to a PowerBuy config by prefix
      const matchingPrefix = prefixes.find((p) =>
        code.toUpperCase().startsWith(p.toUpperCase())
      );
      if (!matchingPrefix) continue;

      const cfg =
        configByPrefix.get(matchingPrefix.toUpperCase()) ||
        configByPrefix.get(matchingPrefix);

      const usageLimit =
        disc.usageLimit != null ? disc.usageLimit : null;
      const used = disc.asyncUsageCount ?? 0;
      const usesRemaining =
        usageLimit == null ? null : Math.max(usageLimit - used, 0);

      const purchaseSlug = cfg
        ? slugify(cfg.short_description || "")
        : "";
      const purchasePath = purchaseSlug
        ? `/discount/${code}?redirect=/powerbuy-${purchaseSlug}`
        : null;

      baseDiscounts.push({
        id: node.id,
        code,
        title: disc.title,
        status: disc.status, // e.g. "ACTIVE", "DISABLED"
        used,
        usageLimit,
        usesRemaining,
        startsAt: disc.startsAt,
        createdAt: disc.createdAt,
        endsAt: disc.endsAt,
        purchasePath,
      });
    }
  }

  // 5) Filter to current/active codes
  const activeDiscounts = baseDiscounts.filter((d) => {
    const isActive = (d.status || "").toUpperCase() === "ACTIVE";
    return isActive;
  });

  // 6) Sort most recent first (by createdAt, falling back to startsAt)
  activeDiscounts.sort((a, b) => {
    const aTime = a.createdAt
      ? new Date(a.createdAt).getTime()
      : a.startsAt
        ? new Date(a.startsAt).getTime()
        : 0;
    const bTime = b.createdAt
      ? new Date(b.createdAt).getTime()
      : b.startsAt
        ? new Date(b.startsAt).getTime()
        : 0;
    return bTime - aTime;
  });

  // 7) Shape final JSON response
  const codes = activeDiscounts.map((d) => {
    const purchaseUrl = d.purchasePath
      ? `${STOREFRONT_BASE}${d.purchasePath}`
      : null;

    const isActive =
      (d.status || "").toUpperCase() === "ACTIVE" &&
      (d.usesRemaining == null || d.usesRemaining > 0);

    return {
      id: d.id,
      discountCode: d.code,
      title: d.title,
      purchaseUrl,
      endTime: d.endsAt || null,
      limitOfUses: d.usageLimit,
      usedCount: d.used,
      remaining: d.usesRemaining,
      isActive,
    };
  });

  return json({ codes });
}

// No default export → resource route returning JSON only
