// scripts/list-sessions.mjs
import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const SHOP = process.env.SHOPIFY_STORE_DOMAIN || "rsldev.myshopify.com";

try {
  const rows = await prisma.session.findMany({
    where: { shop: SHOP },
    select: { id: true, shop: true, isOnline: true, scope: true, expires: true },
    orderBy: { isOnline: "asc" }, // offline first
  });
  console.table(rows);
} catch (err) {
  console.error("Failed to list sessions:", err);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
