// app/routes/flow.actions.update-db-from-return.jsx
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { prisma } from "../db.server";
import { adminGraphQLClientForShop } from "../shopify-admin.server";

// Keep this query lean so the Flow call returns fast.
// You can add/remove fields as your schema/UI needs evolve.
const RETURN_QUERY = `#graphql
  query GetReturn($id: ID!) {
    return(id: $id) {
      id
      name
      status
      createdAt
      closedAt
      totalQuantity
      order { id name }
      returnLineItems(first: 100) {
        edges {
          node {
            id
            quantity
            reason
          }
        }
      }
      reverseFulfillmentOrders(first: 20) {
        edges {
          node {
            id
            status
            reverseDeliveries(first: 10) {
              edges {
                node {
                  id
                  status
                  trackingNumbers
                }
              }
            }
          }
        }
      }
    }
  }
`;

export const action = async ({ request }) => {
  try {
    // 1) Verify HMAC & identify the shop (Shopify Flow POST)
    const { shop } = await authenticate.flow(request);

    // 2) Parse Flow payload
    const body = await request.json();
    const runId = body?.action_run_id;
    const returnId = body?.properties?.returnId;

    if (!returnId) {
      return json({ ok: false, error: "Missing returnId" }, { status: 400 });
    }

    // 3) Idempotency: guard against re-processing the same Flow run
    if (runId) {
      try {
        await prisma.flowRunGuard.create({ data: { actionRunId: runId } });
      } catch {
        // already processed this run
        return json({ ok: true, duplicate: true });
      }
    }

    // 4) Fetch Return data from Admin GraphQL
    const admin = await adminGraphQLClientForShop(shop);
    const resp = await admin.query({
      data: { query: RETURN_QUERY, variables: { id: returnId } },
    });

    const ret = resp?.body?.data?.return;
    if (!ret) {
      const details = resp?.body?.errors || resp?.body?.data?.userErrors;
      return json({ ok: false, error: "Return not found", details }, { status: 404 });
    }

    // 5) Upsert into your DB (adjust fields to match your Prisma model)
    // Assumes a model like:
    // model return_entry {
    //   shopReturnId  String   @id
    //   shopDomain    String
    //   name          String?
    //   status        String?
    //   totalQuantity Int?
    //   orderGid      String?
    //   orderName     String?
    //   createdAtIso  String?
    //   closedAtIso   String?
    //   raw           Json?
    //   updatedByFlowAt DateTime?
    // }
    await prisma.return_entry.upsert({
      where: { shopReturnId: ret.id },
      create: {
        shopReturnId: ret.id,
        shopDomain: shop,
        name: ret.name ?? null,
        status: ret.status ?? null,
        totalQuantity: ret.totalQuantity ?? null,
        orderGid: ret.order?.id ?? null,
        orderName: ret.order?.name ?? null,
        createdAtIso: ret.createdAt ?? null,
        closedAtIso: ret.closedAt ?? null,
        raw: ret,
        updatedByFlowAt: new Date(),
      },
      update: {
        name: ret.name ?? null,
        status: ret.status ?? null,
        totalQuantity: ret.totalQuantity ?? null,
        orderGid: ret.order?.id ?? null,
        orderName: ret.order?.name ?? null,
        createdAtIso: ret.createdAt ?? null,
        closedAtIso: ret.closedAt ?? null,
        raw: ret,
        updatedByFlowAt: new Date(),
      },
    });

    // 6) Respond quickly so Flow is happy
    return json({ ok: true });
  } catch (err) {
    console.error("Flow action error:", err);
    return json({ ok: false, error: err?.message ?? "Unknown error" }, { status: 500 });
  }
};

// Optional: prevent accidental GETs from doing anything
export const loader = () => new Response("POST only", { status: 405 });
