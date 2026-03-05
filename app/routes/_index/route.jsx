// app/routes/_index/route.jsx
import { authenticate } from "~/shopify.server";
import LogisticsPortalRoute, { loader as portalLoader } from "../apps.logistics.portal.jsx";

export const loader = async ({ request }) => {
  const url = new URL(request.url);
  const shop = url.searchParams.get("shop");

  // Ensure Shopify auth/session bootstrap still runs for embedded admin loads.
  // This allows new shops (like dev stores) to create session records before
  // server actions call Admin API helpers.
  if (shop) {
    try {
      const authResult = await authenticate.admin(request);
      if (authResult instanceof Response) return authResult;
    } catch (err) {
      if (err instanceof Response) return err;
      throw err;
    }
  }

  return portalLoader({ request, params: {} });
};

export default function Index() {
  return <LogisticsPortalRoute />;
}
