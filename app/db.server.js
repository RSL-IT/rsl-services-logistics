// app/db.server.js
import { PrismaClient } from "@prisma/client";

let prisma;

if (process.env.NODE_ENV === "production") {
  // One instance in prod
  prisma = new PrismaClient();
} else {
  // Reuse in dev to avoid too many connections on HMR
  if (!global.__prisma) {
    global.__prisma = new PrismaClient();
  }
  prisma = global.__prisma;
}

export { prisma };        // ✅ named export for all routes
export default prisma;    // (optional) fallback default export
