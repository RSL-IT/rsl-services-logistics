// app/routes/apps.powerbuy.offerings.js  -> GET /apps/powerbuy/offerings (JSON)
import { json } from "@remix-run/node";
import { prisma } from "../db.server.js"; // one level up from routes/

export async function loader({ request }) {
  if (request.method === "OPTIONS") return new Response(null, { status: 204 });

  const now = new Date();
  const configs = await prisma.tbl_powerbuy_config.findMany({
    where: {
      start_time: { lte: now },
      end_time: { gte: now },
      powerbuy_product_id: { not: null },
    },
    orderBy: { id: "desc" },
  });

  return json(
    configs.map((c) => ({
      id: c.id,
      title: c.title ?? "Powerbuy",
      productId: c.powerbuy_product_id,
      start: c.start_time,
      end: c.end_time,
    }))
  );
}

// ❌ Do NOT export a default component here.
// export default function Empty() { return null; }
