// app/routes/apps.powerbuy.debug-last-token.js
import { json } from "@remix-run/node";
import { prisma } from "../db.server.js";

export async function loader({ request }) {
  if (process.env.NODE_ENV !== "development" && process.env.POWERBUY_DEBUG !== "1") {
    return json({ error: "not_found" }, { status: 404 });
  }

  const url = new URL(request.url);
  const email = url.searchParams.get("email");
  const any = url.searchParams.get("any") === "1"; // fallback to latest (even if confirmed)
  if (!email) return json({ error: "email_required" }, { status: 400 });

  // 1) Try to find a PENDING request, case-insensitive
  let req = await prisma.tbl_powerbuy_requests.findFirst({
    where: {
      email: { equals: email, mode: "insensitive" },
      confirmed_at: null,
    },
    orderBy: { id: "desc" },
  });

  // 2) If none and ?any=1, return latest by email (any status)
  let note;
  if (!req && any) {
    note = "no_pending; returning_latest_any_status";
    req = await prisma.tbl_powerbuy_requests.findFirst({
      where: { email: { equals: email, mode: "insensitive" } },
      orderBy: { id: "desc" },
    });
  }

  if (!req) return json({ error: "no_pending_request_for_email" }, { status: 404 });

  const origin = url.origin;
  return json({
    email: req.email,
    status: req.confirmed_at ? "confirmed" : "pending",
    note,
    token: req.token,
    confirmUrl: `${origin}/apps/powerbuy/confirm?token=${encodeURIComponent(req.token)}`,
    powerbuyId: req.powerbuy_id,
    productId: req.product_id,
    variantId: req.variant_id,
    expiresAt: req.token_expires,
    createdAt: req.created_at ?? undefined,
    confirmedAt: req.confirmed_at ?? undefined,
  });
}
