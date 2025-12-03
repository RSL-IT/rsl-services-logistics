// app/routes/apps.powerbuy.codes.jsx
// Lists PowerBuy discount codes via app proxy, using Shopify's `discountNodes`.
//
// All filtering is server-side, controlled by query params:
//   - q:        free-text search (partial match on code + title)
//   - active:   "1" (show active) or omitted (hide active)
//   - inactive: "1" (show inactive) or omitted (hide inactive)
//   - sort:     "code" | "title" | "status" | "slots" | "expires"
//   - dir:      "asc" | "desc"
//
// Default behavior if no status params are present: show both Active and Inactive.

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

function getSortIcon(column, sortKey, sortDir) {
  if (sortKey !== column) return "⇅"; // neutral
  return sortDir === "asc" ? "▲" : "▼";
}

function buildSortHref(column, currentSortKey, currentSortDir, opts) {
  const { search, showActive, showInactive } = opts || {};
  const params = new URLSearchParams();

  if (search) params.set("q", search);
  if (showActive) params.set("active", "1");
  if (showInactive) params.set("inactive", "1");

  const nextDir =
    currentSortKey === column && currentSortDir === "asc" ? "desc" : "asc";

  params.set("sort", column);
  params.set("dir", nextDir);

  return "?" + params.toString();
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

  const search = (url.searchParams.get("q") || "").trim();

  const hasStatusParams =
    url.searchParams.has("active") || url.searchParams.has("inactive");

  let showActive;
  let showInactive;

  if (!hasStatusParams) {
    // Default: both checked (all statuses)
    showActive = true;
    showInactive = true;
  } else {
    showActive = url.searchParams.get("active") === "1";
    showInactive = url.searchParams.get("inactive") === "1";

    // If user somehow unchecks both, fall back to both true
    if (!showActive && !showInactive) {
      showActive = true;
      showInactive = true;
    }
  }

  const sortKeyRaw = (url.searchParams.get("sort") || "expires").toLowerCase();
  const sortKey = ["code", "title", "status", "slots", "expires"].includes(
    sortKeyRaw
  )
    ? sortKeyRaw
    : "expires";

  const sortDirRaw = (url.searchParams.get("dir") || "asc").toLowerCase();
  const sortDir = sortDirRaw === "desc" ? "desc" : "asc";

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
    return json({
      shop,
      rows: [],
      totalCount: 0,
      search,
      showActive,
      showInactive,
      sortKey,
      sortDir,
    });
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

  console.log("[PB codes] Title fragments:", titleFragments);

  // 3) Shopify Admin GraphQL query using discountNodes
  //    We call this ONCE PER TITLE FRAGMENT (no "OR" in the search query).
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

  // Safety caps
  const FIRST_PER_PAGE = 50;
  const MAX_PAGES_PER_FRAGMENT = 5;

  for (const fragment of titleFragments) {
    const SEARCH_QUERY = `title:${fragment}*`;
    console.log("[PB codes] Using SEARCH_QUERY:", SEARCH_QUERY);

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
          `[PB codes] Error calling runAdminQuery for fragment "${fragment}" on page ${page}:`,
          err
        );
        break;
      }

      const root = raw && raw.data ? raw.data : raw;
      const block = root?.discountNodes;
      const edges = block?.edges ?? [];

      console.log(
        `[PB codes] fragment "${fragment}", page ${page}, edges:`,
        edges.length
      );

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

  console.log("[PB codes] Total discountNodes edges collected:", allEdges.length);

  // Debug log for each node
  allEdges.forEach((edge, index) => {
    const disc = edge?.node?.discount;
    const codes =
      disc?.codes?.nodes?.map((n) => n?.code).filter(Boolean) ?? [];
    console.log(`[PB codes] merged discountNode #${index}`, {
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

  // 4) Map to our PowerBuy-specific discount list (no filters yet)
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

      // Add admin code in link
      const adminPath = `https://7e8ac2-2.myshopify.com/admin/orders?query=tag:${code}`
      /*
      // For Reference:
      tag=RSLPB2512S318452+AND+-financial_status:partially_refunded
      */
      baseDiscounts.push({
        id: node.id,
        code,
        title: disc.title,
        status: disc.status, // e.g. "ACTIVE", "DISABLED", etc.
        used,
        usageLimit,
        usesRemaining,
        endsAt: disc.endsAt,
        adminPath,
      });
    }
  }

  const totalCount = baseDiscounts.length;

  // 5) Apply status + search filters + sort

  let rows = baseDiscounts.filter((d) => {
    const isActive =
      (d.status || "").toUpperCase() === "ACTIVE";
    if (isActive && !showActive) return false;
    if (!isActive && !showInactive) return false;
    return true;
  });

  // NEW: partial match only on code + title
  const q = search.toLowerCase();
  if (q) {
    rows = rows.filter((d) => {
      const codeMatch = d.code.toLowerCase().includes(q);
      const titleMatch = (d.title || "").toLowerCase().includes(q);
      return codeMatch || titleMatch;
    });
  }

  const dir = sortDir === "desc" ? -1 : 1;

  rows.sort((a, b) => {
    const norm = (v) => (v == null ? "" : String(v).toLowerCase());

    switch (sortKey) {
      case "code": {
        const av = norm(a.code);
        const bv = norm(b.code);
        return av < bv ? -1 * dir : av > bv ? 1 * dir : 0;
      }
      case "title": {
        const av = norm(a.title);
        const bv = norm(b.title);
        return av < bv ? -1 * dir : av > bv ? 1 * dir : 0;
      }
      case "status": {
        const av = norm(a.status);
        const bv = norm(b.status);
        return av < bv ? -1 * dir : av > bv ? 1 * dir : 0;
      }
      case "slots": {
        const aSlots =
          a.usageLimit == null || a.usesRemaining == null
            ? -1
            : a.usesRemaining;
        const bSlots =
          b.usageLimit == null || b.usesRemaining == null
            ? -1
            : b.usesRemaining;
        if (aSlots === bSlots) return 0;
        return aSlots < bSlots ? -1 * dir : 1 * dir;
      }
      case "expires":
      default: {
        const aEnd = a.endsAt ? Date.parse(a.endsAt) : Infinity;
        const bEnd = b.endsAt ? Date.parse(b.endsAt) : Infinity;
        if (aEnd === bEnd) return 0;
        return aEnd < bEnd ? -1 * dir : 1 * dir;
      }
    }
  });

  console.log("[PB codes] Final rows after filtering & sorting:", rows);

  return json({
    shop,
    rows,
    totalCount,
    search,
    showActive,
    showInactive,
    sortKey,
    sortDir,
  });
}

// -----------------------------
// React component (server-rendered HTML)
// -----------------------------

export default function PowerBuyCodesPage() {
  const {
    shop,
    rows,
    totalCount,
    search,
    showActive,
    showInactive,
    sortKey,
    sortDir,
  } = useLoaderData();

  const sortOpts = { search, showActive, showInactive };

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
      <p style={{ fontSize: "12px", color: "#666", marginBottom: "12px" }}>
        Shop: {shop}
      </p>

      {/* Search + status checkboxes + info */}
      <form
        method="get"
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "8px",
          alignItems: "center",
          marginBottom: "16px",
        }}
      >
        {/* Preserve sort params when submitting search/filter */}
        <input type="hidden" name="sort" value={sortKey} />
        <input type="hidden" name="dir" value={sortDir} />

        {/* Search box */}
        <input
          type="text"
          name="q"
          placeholder="Search by code or title…"
          defaultValue={search}
          style={{
            flex: "1 1 260px",
            padding: "6px 8px",
            fontSize: "14px",
            borderRadius: "4px",
            border: "1px solid #ccc",
          }}
        />

        {/* Search button */}
        <button
          type="submit"
          style={{
            padding: "6px 12px",
            fontSize: "13px",
            borderRadius: "4px",
            border: "1px solid #ccc",
            backgroundColor: "#f5f5f5",
            cursor: "pointer",
            whiteSpace: "nowrap",
          }}
        >
          Search / Filter
        </button>

        {/* Status checkboxes */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "6px",
            flexWrap: "wrap",
          }}
        >
          <span style={{ fontSize: "12px", color: "#444" }}>Status:</span>
          <label
            style={{
              fontSize: "12px",
              color: "#444",
              display: "flex",
              alignItems: "center",
              gap: "4px",
            }}
          >
            <input
              type="checkbox"
              name="active"
              value="1"
              defaultChecked={showActive}
            />
            Active
          </label>
          <label
            style={{
              fontSize: "12px",
              color: "#444",
              display: "flex",
              alignItems: "center",
              gap: "4px",
            }}
          >
            <input
              type="checkbox"
              name="inactive"
              value="1"
              defaultChecked={showInactive}
            />
            Inactive
          </label>
        </div>

        {/* Count summary */}
        <span
          style={{
            fontSize: "12px",
            color: "#666",
            marginLeft: "auto",
            whiteSpace: "nowrap",
          }}
        >
          Showing {rows.length} of {totalCount}
        </span>
      </form>

      {rows.length === 0 ? (
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
              {/* Code */}
              <th
                style={{
                  textAlign: "left",
                  padding: "10px 12px",
                  borderBottom: "1px solid #ddd",
                }}
              >
                <a
                  href={buildSortHref(
                    "code",
                    sortKey,
                    sortDir,
                    sortOpts
                  )}
                  style={{
                    color: "inherit",
                    textDecoration: "none",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "4px",
                  }}
                >
                  <span>Code</span>
                  <span
                    style={{
                      fontSize: "10px",
                      opacity: sortKey === "code" ? 1 : 0.4,
                    }}
                  >
                      {getSortIcon("code", sortKey, sortDir)}
                    </span>
                </a>
              </th>

              {/* Title */}
              <th
                style={{
                  textAlign: "left",
                  padding: "10px 12px",
                  borderBottom: "1px solid #ddd"
                }}
              >
                <a
                  href={buildSortHref(
                    "title",
                    sortKey,
                    sortDir,
                    sortOpts
                  )}
                  style={{
                    color: "inherit",
                    textDecoration: "none",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "4px",
                  }}
                >
                  <span>Title</span>
                  <span
                    style={{
                      fontSize: "10px",
                      opacity: sortKey === "title" ? 1 : 0.4,
                    }}
                  >
                      {getSortIcon("title", sortKey, sortDir)}
                    </span>
                </a>
              </th>

              {/* Status */}
              <th
                style={{
                  textAlign: "left",
                  padding: "10px 12px",
                  borderBottom: "1px solid #ddd",
                }}
              >
                <a
                  href={buildSortHref(
                    "status",
                    sortKey,
                    sortDir,
                    sortOpts
                  )}
                  style={{
                    color: "inherit",
                    textDecoration: "none",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "4px",
                  }}
                >
                  <span>Status</span>
                  <span
                    style={{
                      fontSize: "10px",
                      opacity: sortKey === "status" ? 1 : 0.4,
                    }}
                  >
                      {getSortIcon("status", sortKey, sortDir)}
                    </span>
                </a>
              </th>

              {/* Slots Available */}
              <th
                style={{
                  textAlign: "right",
                  padding: "10px 12px",
                  borderBottom: "1px solid #ddd",
                }}
              >
                <a
                  href={buildSortHref(
                    "slots",
                    sortKey,
                    sortDir,
                    sortOpts
                  )}
                  style={{
                    color: "inherit",
                    textDecoration: "none",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "4px",
                    justifyContent: "flex-end",
                    width: "100%",
                  }}
                >
                  <span>Slots Available</span>
                  <span
                    style={{
                      fontSize: "10px",
                      opacity: sortKey === "slots" ? 1 : 0.4,
                    }}
                  >
                      {getSortIcon("slots", sortKey, sortDir)}
                    </span>
                </a>
              </th>

              {/* Expires */}
              <th
                style={{
                  textAlign: "left",
                  padding: "10px 12px",
                  borderBottom: "1px solid #ddd",
                }}
              >
                <a
                  href={buildSortHref(
                    "expires",
                    sortKey,
                    sortDir,
                    sortOpts
                  )}
                  style={{
                    color: "inherit",
                    textDecoration: "none",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "4px",
                  }}
                >
                  <span>Expires</span>
                  <span
                    style={{
                      fontSize: "10px",
                      opacity: sortKey === "expires" ? 1 : 0.4,
                    }}
                  >
                      {getSortIcon("expires", sortKey, sortDir)}
                    </span>
                </a>
              </th>
            </tr>
            </thead>
            <tbody>
            {rows.map((d) => (
              <tr key={`${d.id}:${d.code}`}>
                <td
                  style={{
                    padding: "8px 12px",
                    borderBottom: "1px solid #eee",
                    whiteSpace: "nowrap",
                  }}
                >
                  {d.adminPath ? (
                    <a

                      href={d.adminPath}
                      style={{
                        color: "#0b5cff",
                        textDecoration: "none",
                      }}
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
        Discounts are loaded by matching each{" "}
        <code>tbl_powerbuy_config.title</code> (up to and including the first{" "}
        <code>(</code>) via <code>title:&lt;fragment&gt;*</code>, one query per
        fragment (no <code>OR</code> in the search string). The search box
        performs a partial, case-insensitive match against the discount{" "}
        <strong>code</strong> and <strong>title</strong>. Status filters
        (Active/Inactive) and column sorts are all applied on the server using
        query parameters.
      </p>
    </main>
  );
}
