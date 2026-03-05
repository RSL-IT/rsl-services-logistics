// app/logistics-db.server.js
//
// Reuse the same PrismaClient instance used by Shopify session/auth paths.
// This avoids maintaining multiple pools against the same Postgres instance.
import { prisma as logisticsDb } from "./db.server.js";

export { logisticsDb };
