// app/routes/_index/route.jsx
import { authenticate } from "~/shopify.server";
import LogisticsPortalRoute, { loader as portalLoader } from "../apps.logistics.portal.jsx";

function shouldReturnAuthBootstrapResponse(response) {
  if (!(response instanceof Response)) return false;
  // Keep real redirects/errors, but ignore transient 200 auth bootstrap payloads
  // so the embedded UI doesn't flash a startup "200 error" before the portal renders.
  return response.status >= 300 || response.status < 200;
}

export const loader = async ({ request }) => {
  const url = new URL(request.url);
  const shop = url.searchParams.get("shop");

  // Ensure Shopify auth/session bootstrap still runs for embedded admin loads.
  // This allows new shops (like dev stores) to create session records before
  // server actions call Admin API helpers.
  if (shop) {
    try {
      const authResult = await authenticate.admin(request);
      if (shouldReturnAuthBootstrapResponse(authResult)) return authResult;
    } catch (err) {
      if (shouldReturnAuthBootstrapResponse(err)) return err;
      throw err;
    }
  }

  return portalLoader({ request, params: {} });
};

export default function Index() {
  return <LogisticsPortalRoute />;
}
