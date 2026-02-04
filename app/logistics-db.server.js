// app/logistics-db.server.js

import { PrismaClient } from "@prisma/client";

let logisticsDb;

/**
 * Avoid creating multiple PrismaClient instances in dev
 * (the standard Remix/Prisma pattern).
 */
if (process.env.NODE_ENV === "production") {
  logisticsDb = new PrismaClient();
} else {
  if (!global.__logisticsDb) {
    global.__logisticsDb = new PrismaClient();
  }
  logisticsDb = global.__logisticsDb;
}

export { logisticsDb };
