// app/routes/apps.logistics.proxy.jsx
import { handleProxyRequest } from "~/utils/logistics-proxy.server";

export async function loader({ request }) {
  return handleProxyRequest(request);
}

export async function action({ request }) {
  return handleProxyRequest(request);
}
