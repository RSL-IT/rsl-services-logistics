// app/routes/apps.powerbuy.codes.jsx
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { Page, DataTable, Text, Link } from "@shopify/polaris";
import { prisma } from "~/db.server";

// ----------------------
// Loader
// ----------------------
export const loader = async () => {
  const now = new Date();

  // Fetch all potentially active Shopify discount codes
  const codes = await prisma.tbl_powerbuy_codes.findMany({
    where: {
      AND: [
        // Must be a Shopify discount code (has a GID)
        { discount_code_gid: { not: null } },
        { discount_code_gid: { not: "" } },

        // Time window: started (or no start) and not yet ended (or no end)
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
          id: true,
          short_description: true,
          title: true,
        },
      },
      // Only confirmed requests count as "uses"
      requests: {
        where: { confirmed_at: { not: null } },
        select: { id: true },
      },
    },
    orderBy: {
      end_time: "asc", // soonest to expire at the top
    },
  });

  const rows = codes
    .map((code) => {
      const usedCount = code.requests.length;
      const usageLimit =
        typeof code.number_of_uses === "number" ? code.number_of_uses : null;

      const remaining =
        usageLimit === null
          ? null // treat null as "unlimited" if you ever need that
          : Math.max(usageLimit - usedCount, 0);

      const isActiveByUses = remaining === null || remaining > 0;

      const shortDescription = code.powerbuy?.short_description?.trim() || "";

      return {
        id: code.id,
        code: code.discount_code,
        shortDescription,
        // e.g. "/powerbuy-12s"
        purchasePath: shortDescription
          ? `/powerbuy-${shortDescription}`
          : null,
        expiresAt: code.end_time ? code.end_time.toISOString() : null,
        usageLimit,
        usedCount,
        remaining,
        isActive: isActiveByUses,
      };
    })
    // Ensure we only return codes that still have uses left
    .filter((r) => r.isActive);

  return json({ codes: rows });
};

// ----------------------
// Component
// ----------------------
export default function PowerBuyCodesPage() {
  const { codes } = useLoaderData();

  const tableRows = codes.map((c) => {
    const expiresLabel = c.expiresAt
      ? new Date(c.expiresAt).toLocaleString()
      : "No expiry";

    const remainingLabel =
      typeof c.remaining === "number"
        ? // "3 of 10 left" or just "3" if you want
        (typeof c.usageLimit === "number"
          ? `${c.remaining} of ${c.usageLimit}`
          : `${c.remaining}`)
        : "—";

    const offerLabel = c.shortDescription || "—";

    return [
      c.purchasePath ? (
        <Link key={c.id} url={c.purchasePath} target="_blank">
          {c.code}
        </Link>
      ) : (
        <Text key={c.id} as="span">
          {c.code}
        </Text>
      ),
      remainingLabel,
      expiresLabel,
      offerLabel,
    ];
  });

  return (
    <Page
      title="Active Power Buy discount codes"
      subtitle="Codes that are currently valid and have remaining uses."
    >
      {codes.length === 0 ? (
        <Text as="p" tone="subdued">
          There are no active Shopify discount codes right now.
        </Text>
      ) : (
        <DataTable
          columnContentTypes={["text", "numeric", "text", "text"]}
          headings={["Discount code", "Uses remaining", "Expires", "Offer"]}
          rows={tableRows}
        />
      )}
    </Page>
  );
}
