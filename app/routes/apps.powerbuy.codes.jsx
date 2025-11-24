// app/routes/apps.powerbuy.codes.jsx
// Lists PowerBuy discount codes via app proxy, using Shopify's `discountNodes`.
// Behavior controlled by ?status=… query param:
//   - status=all      → all matching codes (any status)
//   - status=inactive → only non-ACTIVE codes
//   - default         → only ACTIVE codes in current time window

import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { prisma } from "~/db.server";
import { runAdminQuery } from "~/shopify-admin.server";
import { verifyProxyIfPresent } from "~/utils/app-proxy-verify.server";

// -----------------------------
// Helpers
// -----------------------------

function slugify(text) {
  return String(text || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function formatExpires(iso) {
  if (!iso) return "No expiry";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "No expiry";
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

// -----------------------------
// Loader (server-only)
// -----------------------------

export async function loader({ request }) {
  // App proxy HMAC validation
  await verifyProxyIfPresent(request);

  const url = new URL(request.url);
  const shop =
    url.searchParams.get("shop") ||
    process.env.SHOPIFY_SHOP_DOMAIN ||
    "rsldev.myshopify.com";

  const statusFilterRaw = url.searchParams.get("status");
  const statusFilter = statusFilterRaw
    ? statusFilterRaw.toLowerCase()
    : null; // "all" | "inactive" | null
  console.log("[PB codes] statusFilter:", statusFilter);

  // 1) Load PowerBuy configs (prefixes + purchase URLs + titles)
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
    console.log("[PB codes] No tbl_powerbuy_config rows with discount_prefix.");
    return json({ shop, discounts: [], statusFilter });
  }

  const configByPrefix = new Map();
  for (const cfg of configs) {
    const p = (cfg.discount_prefix || "").trim().toUpperCase();
    if (!p) continue;
    configByPrefix.set(p, cfg);
  }

  // 2) Build title fragment from the FIRST config with a non-empty title
  let titleFragment = null;
  for (const cfg of configs) {
    const fullTitle = (cfg.title || "").trim();
    if (!fullTitle) continue;
    const idx = fullTitle.indexOf("(");
    if (idx !== -1) {
      titleFragment = fullTitle.slice(0, idx + 1).trim(); // include "("
    } else {
      titleFragment = fullTitle;
    }
    if (titleFragment) break;
  }

  if (!titleFragment) {
    // Fallback if no title is set in configs
    titleFragment = "RSL Power Buy";
  }

  // Build search query:
  // - default: status:active AND title:<fragment>*
  // - status=all or inactive: only title:<fragment>* (we filter status in JS)
  let SEARCH_QUERY;
  if (statusFilter === "all" || statusFilter === "inactive") {
    SEARCH_QUERY = `title:${titleFragment}*`;
  } else {
    SEARCH_QUERY = `status:active AND title:${titleFragment}*`;
  }
  console.log("[PB codes] Computed SEARCH_QUERY:", SEARCH_QUERY);

  // 3) Single Shopify Admin GraphQL call using discountNodes

  const GQL = `#graphql
    query ActivePowerBuyDiscounts($first: Int!, $query: String!) {
      discountNodes(first: $first, query: $query) {
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

  let raw;
  try {
    raw = await runAdminQuery(shop, GQL, {
      first: 50,
      query: SEARCH_QUERY,
    });
  } catch (err) {
    console.error("[PB codes] Error calling runAdminQuery:", err);
    throw err;
  }

  const root = raw && raw.data ? raw.data : raw;
  const edges = root?.discountNodes?.edges ?? [];
  console.log("[PB codes] discountNodes edges count:", edges.length);

  edges.forEach((edge, index) => {
    const disc = edge?.node?.discount;
    const codes =
      disc?.codes?.nodes?.map((n) => n?.code).filter(Boolean) ?? [];
    console.log(`[PB codes] discountNode #${index}`, {
      id: edge?.node?.id,
      typename: disc?.__typename,
      status: disc?.status,
      title: disc?.title,
      startsAt: disc?.startsAt,
      endsAt: disc?.endsAt,
      usageLimit: disc?.usageLimit,
      asyncUsageCount: disc?.asyncUsageCount,
      codes,
    });
  });

  // 4) Filter by PowerBuy prefixes + status/time window

  const now = new Date();
  const discounts = [];

  for (const edge of edges) {
    const node = edge?.node;
    const disc = node?.discount;
    if (!disc || disc.__typename !== "DiscountCodeBasic") continue;

    const startsAt = disc.startsAt ? new Date(disc.startsAt) : null;
    const endsAt = disc.endsAt ? new Date(disc.endsAt) : null;

    // Status / time filtering by mode
    if (statusFilter === "inactive") {
      // Only non-active discounts
      if (!disc.status || disc.status === "ACTIVE") continue;
      // No time window filtering here
    } else if (statusFilter === "all") {
      // Show all statuses, no time window filter
    } else {
      // Default: active-only, in current time window
      if (disc.status && disc.status !== "ACTIVE") continue;
      if (startsAt && startsAt > now) continue;
      if (endsAt && endsAt <= now) continue;
    }

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
        ? `/powerbuy-${purchaseSlug}`
        : null;

      discounts.push({
        id: node.id,
        code,
        title: disc.title,
        status: disc.status,
        used,
        usageLimit,
        usesRemaining,
        endsAt: disc.endsAt,
        purchasePath,
      });
    }
  }

  // Sort by expiry (soonest first)
  discounts.sort((a, b) => {
    const aEnd = a.endsAt ? Date.parse(a.endsAt) : Infinity;
    const bEnd = b.endsAt ? Date.parse(b.endsAt) : Infinity;
    return aEnd - bEnd;
  });

  console.log("[PB codes] Final discounts after filtering:", discounts);

  return json({ shop, discounts, statusFilter });
}

// -----------------------------
// React component
// -----------------------------

export default function PowerBuyCodesPage() {
  const { shop, discounts, statusFilter } = useLoaderData();

  const filterLabel =
    statusFilter === "all"
      ? "All (any status)"
      : statusFilter === "inactive"
        ? "Inactive only"
        : "Active only";

  return (
    <main
      style={{
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif',
        padding: "20px",
        maxWidth: "960px",
        margin: "0 auto",
      }}
    >
      <h1 style={{ fontSize: "24px", marginBottom: "4px" }}>
        Power Buy Discount Codes
      </h1>
      <p style={{ fontSize: "12px", color: "#666", marginBottom: "4px" }}>
        Shop: {shop}
      </p>
      <p style={{ fontSize: "12px", color: "#666", marginBottom: "16px" }}>
        Filter: {filterLabel}
      </p>

      {discounts.length === 0 ? (
        <p style={{ color: "#555" }}>No Power Buy discounts found.</p>
      ) : (
        <div
          style={{
            border: "1px solid #ddd",
            borderRadius: "8px",
            overflow: "hidden",
          }}
        >
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              fontSize: "14px",
            }}
          >
            <thead style={{ backgroundColor: "#f7f7f7" }}>
            <tr>
              <th
                style={{
                  textAlign: "left",
                  padding: "10px 12px",
                  borderBottom: "1px solid #ddd",
                }}
              >
                Code
              </th>
              <th
                style={{
                  textAlign: "left",
                  padding: "10px 12px",
                  borderBottom: "1px solid #ddd",
                }}
              >
                Title
              </th>
              <th
                style={{
                  textAlign: "left",
                  padding: "10px 12px",
                  borderBottom: "1px solid #ddd",
                }}
              >
                Status
              </th>
              <th
                style={{
                  textAlign: "right",
                  padding: "10px 12px",
                  borderBottom: "1px solid #ddd",
                }}
              >
                Slots Available
              </th>
              <th
                style={{
                  textAlign: "left",
                  padding: "10px 12px",
                  borderBottom: "1px solid #ddd",
                }}
              >
                Expires
              </th>
            </tr>
            </thead>
            <tbody>
            {discounts.map((d) => (
              <tr key={`${d.id}:${d.code}`}>
                <td
                  style={{
                    padding: "8px 12px",
                    borderBottom: "1px solid #eee",
                    whiteSpace: "nowrap",
                  }}
                >
                  {d.purchasePath ? (
                    <a
                      href={d.purchasePath}
                      style={{ color: "#0b5cff", textDecoration: "none" }}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {d.code}
                    </a>
                  ) : (
                    d.code
                  )}
                </td>
                <td
                  style={{
                    padding: "8px 12px",
                    borderBottom: "1px solid #eee",
                  }}
                >
                  {d.title}
                </td>
                <td
                  style={{
                    padding: "8px 12px",
                    borderBottom: "1px solid #eee",
                    textTransform: "capitalize",
                  }}
                >
                  {d.status ? d.status.toLowerCase() : "unknown"}
                </td>
                <td
                  style={{
                    padding: "8px 12px",
                    borderBottom: "1px solid #eee",
                    textAlign: "right",
                  }}
                >
                  {d.usageLimit == null || d.usesRemaining == null
                    ? "—"
                    : d.usesRemaining}
                </td>
                <td
                  style={{
                    padding: "8px 12px",
                    borderBottom: "1px solid #eee",
                  }}
                >
                  {formatExpires(d.endsAt)}
                </td>
              </tr>
            ))}
            </tbody>
          </table>
        </div>
      )}

      <p
        style={{
          marginTop: "10px",
          fontSize: "12px",
          color: "#888",
          lineHeight: 1.4,
        }}
      >
        SEARCH_QUERY is built from the first{" "}
        <code>tbl_powerbuy_config.title</code> (characters up to and including
        the first <code>(</code>) as{" "}
        <code>title:&lt;fragment&gt;*</code>. Status filtering is controlled by
        the <code>?status</code> query parameter and matched to configs via{" "}
        <code>tbl_powerbuy_config.discount_prefix</code>.
      </p>
    </main>
  );
}
