// scripts/clear-offline-session.mjs
import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const SHOP = process.env.SHOPIFY_STORE_DOMAIN || "rsldev.myshopify.com";

try {
  const result = await prisma.session.deleteMany({
    where: { shop: SHOP, isOnline: false },
  });
  console.log(`Deleted ${result.count} offline session row(s) for ${SHOP}.`);
} catch (err) {
  console.error("Failed to clear offline session:", err);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
