// app/routes/apps.powerbuy.offerings.js
// -> GET /apps/powerbuy/offerings  (JSON)
import { json } from "@remix-run/node";
import { prisma } from "../db.server.js"; // one level up from routes/
import { verifyProxyIfPresent } from "~/utils/app-proxy-verify.server";

/** Ensure a Shopify GID from a numeric id or an existing gid string */
function ensureGid(resource, value) {
  if (!value) return null;
  const s = String(value).trim();
  if (s.startsWith("gid://")) return s;
  // keep only digits, then append the proper resource prefix
  const digits = s.replace(/\D/g, "");
  return digits ? `gid://shopify/${resource}/${digits}` : null;
}

/** Split a comma/space separated list and return unique cleaned strings */
function splitIds(list) {
  if (!list) return [];
  return Array.from(
    new Set(
      String(list)
        .split(/[, \n\r\t]+/)
        .map((x) => x.trim())
        .filter(Boolean)
    )
  );
}

export async function loader({ request }) {
  // Preflight support
  await verifyProxyIfPresent(request);
  if (request.method === "OPTIONS") return new Response(null, { status: 204 });

  const now = new Date();

  // Active configs that have either a product OR variant targets
  const configs = await prisma.tbl_powerbuy_config.findMany({
    where: {
      start_time: { lte: now },
      end_time: { gte: now },
      OR: [
        { powerbuy_product_id: { not: null } },
        { powerbuy_variant_ids: { not: null } },
      ],
    },
    orderBy: { id: "desc" },
  });

  const offerings = configs.map((c) => {
    // Normalize product GID (DB stores numeric only OR full gid)
    const productIdGid = ensureGid("Product", c.powerbuy_product_id || "");

    // Normalize variant GIDs (DB stores comma-separated numerics OR full gids)
    const variantIdsGids = splitIds(c.powerbuy_variant_ids || "")
      .map((v) => ensureGid("ProductVariant", v))
      .filter(Boolean);

    // If variant list is present, we prefer it over product targeting
    const targets = variantIdsGids.length > 0
      ? { variantIds: variantIdsGids }
      : { productId: productIdGid };

    return {
      id: c.id,
      title: c.title ? String(c.title) : "Powerbuy",
      start: c.start_time,
      end: c.end_time,
      shops: c.allowed_stores,
      discountPrefix: c.discount_prefix || null,
      codeLength: typeof c.code_length === "number" ? c.code_length : null,
      codeType: c.code_type || null, // 'alpha' | 'numeric' | 'mixed' | null
      numberOfUses: typeof c.number_of_uses === "number" ? c.number_of_uses : null,
      discountType: c.discount_type || null, // 'percentage' | 'fixed' | null
      discountValue:
        c.discount_value != null ? c.discount_value.toString() : null, // keep precision
      ...targets,
    };
  });

  return json(offerings);
}

// Do NOT export a default component here; keep this a pure resource route.
