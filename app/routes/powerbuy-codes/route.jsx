// app/routes/apps.powerbuy.codes.jsx
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { prisma } from "~/db.server";
import { runAdminQuery, requireShopParam } from "~/shopify-admin.server";
import { verifyProxyIfPresent } from "~/utils/app-proxy-verify.server";

// ----------------------
// Loader (server-side)
// ----------------------
export const loader = async ({ request }) => {
  // 1) Figure out which shop we're dealing with
  //    - If it's coming from the app proxy, verify + get shop from signature
  //    - Otherwise, fall back to ?shop=… param (direct access)
  let shop;
  try {
    shop = await verifyProxyIfPresent(request);
  } catch (err) {
    console.error("App proxy verification failed", err);
    throw new Response("Invalid app proxy signature", { status: 403 });
  }

  if (!shop) {
    // Not via proxy — allow direct calls, but require ?shop=…
    shop = requireShopParam(request);
  }

  const now = new Date();

  // 2) Get active PowerBuy codes that have Shopify discount GIDs
  const codes = await prisma.tbl_powerbuy_codes.findMany({
    where: {
      AND: [
        { discount_code_gid: { not: null } },
        { discount_code_gid: { not: "" } },
        {
          OR: [{ start_time: null }, { start_time: { lte: now } }],
        },
        {
          OR: [{ end_time: null }, { end_time: { gt: now } }],
        },
      ],
    },
    include: {
      powerbuy: {
        select: {
          short_description: true,
          title: true,
        },
      },
      // Confirmed requests = actual uses recorded by your app
      requests: {
        where: { confirmed_at: { not: null } },
        select: { id: true },
      },
    },
    orderBy: {
      end_time: "asc",
    },
  });

  // 3) Look up Shopify discount info (title, usageLimit, asyncUsageCount)
  const discountIds = codes
    .map((c) => c.discount_code_gid)
    .filter(Boolean);

  const shopifyById = {};

  if (discountIds.length > 0) {
    const uniqueIds = Array.from(new Set(discountIds));

    const result = await runAdminQuery(shop, {
      query: `
        query PowerBuyDiscountTitles($ids: [ID!]!) {
          nodes(ids: $ids) {
            id
            ... on DiscountCodeNode {
              id
              codeDiscount {
                ... on DiscountCodeBasic {
                  title
                  usageLimit
                  asyncUsageCount
                }
              }
            }
          }
        }
      `,
      variables: { ids: uniqueIds },
    });

    const data = result?.data ?? result;

    if (data?.nodes) {
      for (const node of data.nodes) {
        if (!node || !node.codeDiscount) continue;
        const discount = node.codeDiscount;
        shopifyById[node.id] = {
          title: discount.title,
          usageLimit: discount.usageLimit,
          asyncUsageCount: discount.asyncUsageCount,
        };
      }
    }
  }

  // 4) Normalize + compute "uses remaining" = maxUses - currentUses
  const normalized = codes
    .map((code) => {
      const dbUsedCount = code.requests.length;
      const dbMaxUses =
        typeof code.number_of_uses === "number"
          ? code.number_of_uses
          : null;

      const shopifyInfo = code.discount_code_gid
        ? shopifyById[code.discount_code_gid] ?? null
        : null;

      const shopifyTitle = shopifyInfo?.title || null;
      const shopifyUsageLimit =
        typeof shopifyInfo?.usageLimit === "number"
          ? shopifyInfo.usageLimit
          : null;
      const shopifyUsageCount =
        typeof shopifyInfo?.asyncUsageCount === "number"
          ? shopifyInfo.asyncUsageCount
          : null;

      // Max uses allowed: prefer Shopify; fall back to DB
      const maxUses =
        shopifyUsageLimit ?? dbMaxUses ?? null;

      // Current uses: prefer Shopify usage; fall back to DB-confirmed uses
      const currentUses =
        shopifyUsageCount ??
        (typeof dbUsedCount === "number" ? dbUsedCount : 0);

      let remaining = null;
      if (typeof maxUses === "number") {
        remaining = Math.max(maxUses - currentUses, 0);
      }

      const isExhausted =
        typeof remaining === "number" ? remaining <= 0 : false;

      const shortDescription =
        code.powerbuy?.short_description?.trim() || "";

      return {
        id: code.id,
        discountCode: code.discount_code,
        // Title column comes from Shopify's discount title
        title:
          shopifyTitle ||
          code.powerbuy?.title ||
          shortDescription ||
          "",
        purchasePath: shortDescription
          ? `/powerbuy-${shortDescription}`
          : null,
        endTime: code.end_time
          ? code.end_time.toISOString()
          : null,
        maxUses,
        currentUses,
        remaining,
        isActive: !isExhausted,
      };
    })
    // Only show codes that still have uses left if we know a max
    .filter((c) => c.isActive);

  return json({ codes: normalized });
};

// ----------------------
// Component (client-side)
// ----------------------
export default function PowerBuyCodesPublicPage() {
  const { codes } = useLoaderData();

  return (
    <main
      style={{
        fontFamily:
          'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        margin: 0,
        padding: "1.5rem",
        background: "#f5f5f7",
        color: "#111827",
      }}
    >
      <div
        style={{
          maxWidth: 960,
          margin: "0 auto",
          background: "#ffffff",
          padding: "1.5rem 2rem 2rem",
          borderRadius: "0.75rem",
          boxShadow: "0 10px 25px rgba(0,0,0,0.06)",
        }}
      >
        <h1
          style={{
            marginTop: 0,
            marginBottom: "0.25rem",
            fontSize: "1.6rem",
          }}
        >
          Active Power Buy Discount Codes
        </h1>
        <p
          style={{
            marginTop: 0,
            marginBottom: "1.5rem",
            color: "#6b7280",
          }}
        >
          These Shopify discount codes are currently valid and still have
          uses available.
        </p>

        {codes.length === 0 ? (
          <p style={{ marginTop: "1.5rem", color: "#6b7280" }}>
            There are no active discount codes at the moment.
          </p>
        ) : (
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              marginTop: "1rem",
            }}
          >
            <thead>
            <tr>
              <th
                style={{
                  padding: "0.75rem 0.5rem",
                  textAlign: "left",
                  borderBottom: "1px solid #e5e7eb",
                  fontSize: "0.95rem",
                  fontWeight: 600,
                  background: "#f9fafb",
                }}
              >
                Discount code
              </th>
              <th
                style={{
                  padding: "0.75rem 0.5rem",
                  textAlign: "left",
                  borderBottom: "1px solid #e5e7eb",
                  fontSize: "0.95rem",
                  fontWeight: 600,
                  background: "#f9fafb",
                }}
              >
                Uses remaining
              </th>
              <th
                style={{
                  padding: "0.75rem 0.5rem",
                  textAlign: "left",
                  borderBottom: "1px solid #e5e7eb",
                  fontSize: "0.95rem",
                  fontWeight: 600,
                  background: "#f9fafb",
                }}
              >
                Expires
              </th>
              <th
                style={{
                  padding: "0.75rem 0.5rem",
                  textAlign: "left",
                  borderBottom: "1px solid #e5e7eb",
                  fontSize: "0.95rem",
                  fontWeight: 600,
                  background: "#f9fafb",
                }}
              >
                Title
              </th>
            </tr>
            </thead>
            <tbody>
            {codes.map((c) => {
              const expiresLabel = c.endTime
                ? new Date(c.endTime).toLocaleString()
                : "No expiry";

              const usesLabel =
                typeof c.remaining === "number"
                  ? String(c.remaining)
                  : "Unlimited";

              return (
                <tr key={c.id}>
                  <td
                    style={{
                      padding: "0.75rem 0.5rem",
                      borderBottom: "1px solid #e5e7eb",
                      fontSize: "0.95rem",
                    }}
                  >
                    {c.purchasePath ? (
                      <a
                        href={c.purchasePath}
                        style={{
                          color: "#2563eb",
                          textDecoration: "none",
                          fontWeight: 600,
                        }}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {c.discountCode}
                      </a>
                    ) : (
                      <span>{c.discountCode}</span>
                    )}
                  </td>
                  <td
                    style={{
                      padding: "0.75rem 0.5rem",
                      borderBottom: "1px solid #e5e7eb",
                      fontSize: "0.95rem",
                    }}
                  >
                    {usesLabel}
                  </td>
                  <td
                    style={{
                      padding: "0.75rem 0.5rem",
                      borderBottom: "1px solid #e5e7eb",
                      fontSize: "0.95rem",
                    }}
                  >
                    {expiresLabel}
                  </td>
                  <td
                    style={{
                      padding: "0.75rem 0.5rem",
                      borderBottom: "1px solid #e5e7eb",
                      fontSize: "0.95rem",
                    }}
                  >
                    {c.title ? (
                      c.title
                    ) : (
                      <span style={{ color: "#6b7280" }}>–</span>
                    )}
                  </td>
                </tr>
              );
            })}
            </tbody>
          </table>
        )}
      </div>
    </main>
  );
}
