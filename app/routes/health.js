// app/routes/health.js
export const loader = async () => {
  // Optional: very light DB ping with a short timeout.
  // Comment the try/catch out if you want *pure* liveness.
  try {
    const { prisma } = await import("../db.server.js");
    await Promise.race([
      prisma.$queryRaw`SELECT 1`,
      new Promise((_, reject) => setTimeout(() => reject(new Error("db_timeout")), 800)),
    ]);
  } catch (_) {
    // swallow errors to keep health 200 (liveness)
  }

  return new Response(
    JSON.stringify({
      ok: true,
      ts: new Date().toISOString(),
      uptime: typeof process?.uptime === "function" ? process.uptime() : null,
    }),
    { status: 200, headers: { "content-type": "application/json" } }
  );
};
