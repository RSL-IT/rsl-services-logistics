// app/routes/apps.csd-entry.dbcheck.js
import { json } from "@remix-run/node";
import { authenticate } from "~/shopify.server"; // adjust path if needed
import { prisma } from "../db.server";            // adjust path if needed

function redactDbUrl(url) {
  if (!url) return null;
  try {
    // Parse unknown schemes too (e.g., prisma+postgres://...)
    const u = new URL(url);
    const proto = u.protocol.replace("prisma+postgres", "postgresql");
    const host = u.hostname;
    const port = u.port || "5432";
    const db = u.pathname?.replace(/^\//, "") || "";
    const user = u.username ? `${u.username}` : "";
    // Return a redacted summary (no password!)
    return {
      scheme: proto.replace(":", ""),
      host,
      port,
      database: db,
      user: user || undefined,
      // DO NOT include password or query string
      note: "redacted; this is only a summary",
    };
  } catch {
    return { raw: url.slice(0, 60) + (url.length > 60 ? "…" : ""), note: "could not parse; raw prefix only" };
  }
}

export async function loader({ request }) {
  // Protect this so only authenticated app admins can see DB info
  await authenticate.admin(request);

  const DATABASE_URL = process.env.DATABASE_URL || null;
  const DIRECT_URL = process.env.DIRECT_URL || null;

  // 1) Redacted env snapshot the app is actually running with
  const envSnapshot = {
    DATABASE_URL: DATABASE_URL ? redactDbUrl(DATABASE_URL) : null,
    DIRECT_URL: DIRECT_URL ? redactDbUrl(DIRECT_URL) : null,
    usingAccelerate: !!(DATABASE_URL && DATABASE_URL.startsWith("prisma+postgres://")),
  };

  // 2) Live DB queries (if connection works)
  let serverInfo = null;
  let tables = null;
  let knownTables = null;
  let error = null;

  try {
    const [info] = await prisma.$queryRawUnsafe(`
      select
        current_database() as db,
        current_user as "user",
        inet_server_addr()::text as host,
        inet_server_port()::int as port,
        version() as version
    `);

    serverInfo = info;

    const [tblCount] = await prisma.$queryRawUnsafe(`
      select count(*)::int as table_count
      from information_schema.tables
      where table_schema = 'public'
    `);
    tables = tblCount;

    const [exists] = await prisma.$queryRawUnsafe(`
      select
        to_regclass('public."Session"') as session_table,
        to_regclass('public.csd_entry') as csd_entry_table,
        to_regclass('public.repair_entry') as repair_entry_table
    `);
    knownTables = exists;
  } catch (e) {
    error = String(e?.message || e);
  }

  return json(
    {
      envSnapshot,
      serverInfo,   // what DB you actually connected to
      tables,       // table count in 'public'
      knownTables,  // existence of a few expected tables
      error,        // if connection failed, you’ll see it here
      timestamp: new Date().toISOString(),
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
