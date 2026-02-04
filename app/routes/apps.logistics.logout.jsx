// app/routes/apps.logistics.logout.jsx
import { json } from "@remix-run/node";
import { destroyLogisticsUserSession } from "~/logistics-auth.server";

// Simple JSON endpoint used by the SPA to clear the logistics session cookie.
export async function action({ request }) {
  const setCookie = await destroyLogisticsUserSession(request);

  return json(
    { ok: true },
    {
      status: 200,
      headers: { "Set-Cookie": setCookie },
    },
  );
}
