// app/routes/apps.logistics.proxy.$.jsx
import { handleProxyRequest } from "~/utils/logistics-proxy.server";

export async function loader({ request, params }) {
  return handleProxyRequest(request, params["*"]);
}

export async function action({ request, params }) {
  return handleProxyRequest(request, params["*"]);
}
