import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function keyFor(purchaseOrderGID, rslProductID) {
  return `${String(purchaseOrderGID || "").trim()}::${String(rslProductID || "").trim()}`;
}

function parseArgs(argv) {
  const args = new Set(argv.slice(2));
  return {
    apply: args.has("--apply"),
    verbose: args.has("--verbose"),
  };
}

async function loadLiveCommittedTotals() {
  const rows = await prisma.tbljn_container_purchaseOrder_rslProduct.groupBy({
    by: ["purchaseOrderGID", "rslProductID"],
    _sum: { quantity: true },
  });

  const byKey = new Map();
  for (const row of rows || []) {
    const key = keyFor(row.purchaseOrderGID, row.rslProductID);
    if (!key || key === "::") continue;
    const qty = Math.max(0, Math.trunc(Number(row?._sum?.quantity) || 0));
    byKey.set(key, qty);
  }
  return byKey;
}

async function loadPoProductRows() {
  return prisma.tbljn_purchaseOrder_rslProduct.findMany({
    select: {
      purchaseOrderGID: true,
      rslProductID: true,
      initialQuantity: true,
      committedQuantity: true,
    },
    orderBy: [{ purchaseOrderGID: "asc" }, { rslProductID: "asc" }],
  });
}

async function reconcile({ apply, verbose }) {
  const liveByKey = await loadLiveCommittedTotals();
  const poRows = await loadPoProductRows();

  const poByKey = new Map();
  for (const row of poRows) {
    poByKey.set(keyFor(row.purchaseOrderGID, row.rslProductID), row);
  }

  const mismatches = [];
  for (const row of poRows) {
    const key = keyFor(row.purchaseOrderGID, row.rslProductID);
    const liveCommitted = Math.max(0, Math.trunc(Number(liveByKey.get(key)) || 0));
    const currentCommitted = Math.max(0, Math.trunc(Number(row.committedQuantity) || 0));
    const initialQuantity = Math.max(0, Math.trunc(Number(row.initialQuantity) || 0));

    if (currentCommitted !== liveCommitted) {
      mismatches.push({
        key,
        purchaseOrderGID: row.purchaseOrderGID,
        rslProductID: row.rslProductID,
        initialQuantity,
        currentCommitted,
        liveCommitted,
      });
    }
  }

  const orphanAllocations = [];
  for (const [key, liveCommitted] of liveByKey.entries()) {
    if (!poByKey.has(key)) {
      const [purchaseOrderGID, rslProductID] = key.split("::");
      orphanAllocations.push({
        purchaseOrderGID,
        rslProductID,
        liveCommitted,
      });
    }
  }

  const header = apply ? "APPLY MODE" : "DRY-RUN MODE";
  console.log(`\n[reconcile-po-committed-quantity] ${header}`);
  console.log(`PO product rows: ${poRows.length}`);
  console.log(`Live allocation keys: ${liveByKey.size}`);
  console.log(`Committed mismatches: ${mismatches.length}`);
  console.log(`Orphan allocation keys: ${orphanAllocations.length}`);

  if (verbose && mismatches.length) {
    console.log("\nMismatches:");
    console.table(
      mismatches.map((m) => ({
        purchaseOrderGID: m.purchaseOrderGID,
        rslProductID: m.rslProductID,
        initialQuantity: m.initialQuantity,
        committedQuantity_db: m.currentCommitted,
        committedQuantity_live: m.liveCommitted,
      }))
    );
  }

  if (orphanAllocations.length) {
    console.warn(
      "\nFound allocation rows for PO/product pairs that do not exist in tbljn_purchaseOrder_rslProduct."
    );
    console.table(
      orphanAllocations.map((o) => ({
        purchaseOrderGID: o.purchaseOrderGID,
        rslProductID: o.rslProductID,
        liveCommitted: o.liveCommitted,
      }))
    );
  }

  if (!apply) {
    console.log("\nNo database changes made. Re-run with --apply to write updates.");
    return;
  }

  if (!mismatches.length) {
    console.log("\nNo committedQuantity updates needed.");
    return;
  }

  const updateOps = mismatches.map((m) =>
    prisma.tbljn_purchaseOrder_rslProduct.updateMany({
      where: {
        purchaseOrderGID: m.purchaseOrderGID,
        rslProductID: m.rslProductID,
      },
      data: { committedQuantity: m.liveCommitted },
    })
  );
  const results = await prisma.$transaction(updateOps);
  const updatedRows = results.reduce((sum, r) => sum + (Number(r?.count) || 0), 0);

  console.log(`\nUpdated committedQuantity on ${updatedRows} row(s).`);
}

const { apply, verbose } = parseArgs(process.argv);

try {
  await reconcile({ apply, verbose });
} catch (err) {
  console.error("[reconcile-po-committed-quantity] failed:", err);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
