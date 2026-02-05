// app/routes/apps.logistics.proxy.jsx
import { verifyProxyIfPresent } from "~/utils/app-proxy-verify.server";

function buildProxyTarget(request) {
  const url = new URL(request.url);
  const base = process.env.SHOPIFY_APP_URL || url.origin;

  const rawPath = url.searchParams.get("path") || "";
  let targetPath = "/apps/logistics/portal";
  let pathQuery = new URLSearchParams();

  if (rawPath && rawPath !== "/") {
    const parsed = new URL(rawPath, "https://example.invalid");
    targetPath = `/apps/logistics${parsed.pathname.startsWith("/") ? "" : "/"}${parsed.pathname}`;
    pathQuery = parsed.searchParams;
  }

  const target = new URL(targetPath, base);

  // Forward query params except proxy-specific ones.
  for (const [key, value] of url.searchParams.entries()) {
    if (key === "signature" || key === "path" || key === "path_prefix") continue;
    target.searchParams.append(key, value);
  }

  for (const [key, value] of pathQuery.entries()) {
    if (!target.searchParams.has(key)) target.searchParams.append(key, value);
  }

  return target;
}

function rewriteAssetUrls(html, base) {
  const root = String(base || "").replace(/\/$/, "");
  if (!root) return html;

  return html
    .replace(/(src|href)=["'](\/build\/[^"']+)["']/g, `$1="${root}$2"`)
    .replace(/(src|href)=["'](\/assets\/[^"']+)["']/g, `$1="${root}$2"`);
}

async function forwardProxyRequest(request) {
  const target = buildProxyTarget(request);
  const method = request.method.toUpperCase();

  const outboundHeaders = new Headers(request.headers);
  outboundHeaders.delete("host");

  const init = {
    method,
    headers: outboundHeaders,
  };

  if (method !== "GET" && method !== "HEAD") {
    const cloned = request.clone();
    init.body = await cloned.arrayBuffer();
  }

  const res = await fetch(target.toString(), init);
  const contentType = res.headers.get("content-type") || "";

  if (!contentType.includes("text/html")) {
    return new Response(res.body, {
      status: res.status,
      statusText: res.statusText,
      headers: res.headers,
    });
  }

  const bodyText = await res.text();
  const appUrl = process.env.SHOPIFY_APP_URL || target.origin;
  const rewritten = rewriteAssetUrls(bodyText, appUrl);

  const responseHeaders = new Headers(res.headers);
  responseHeaders.delete("content-length");
  responseHeaders.delete("content-encoding");
  if (!responseHeaders.get("content-type")) {
    responseHeaders.set("content-type", "text/html; charset=utf-8");
  }

  return new Response(rewritten, {
    status: res.status,
    statusText: res.statusText,
    headers: responseHeaders,
  });
}

export async function loader({ request }) {
  try {
    await verifyProxyIfPresent(request);
  } catch (err) {
    if (err instanceof Response) return err;
    throw err;
  }
  return forwardProxyRequest(request);
}

export async function action({ request }) {
  try {
    await verifyProxyIfPresent(request);
  } catch (err) {
    if (err instanceof Response) return err;
    throw err;
  }
  return forwardProxyRequest(request);
}
