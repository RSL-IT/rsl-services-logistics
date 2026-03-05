// app/utils/logistics-proxy.server.js
import { verifyProxyIfPresent } from "~/utils/app-proxy-verify.server";

function normalizeSubPath(subPath) {
  const raw = String(subPath || "").trim();
  if (!raw || raw === "/") return "";
  return raw.startsWith("/") ? raw : `/${raw}`;
}

function buildProxyTarget(request, subPath) {
  const url = new URL(request.url);
  const base = process.env.SHOPIFY_APP_URL || url.origin;

  const rawPath = subPath ? normalizeSubPath(subPath) : url.searchParams.get("path") || "";
  let targetPath = "/apps/logistics/portal";
  let pathQuery = new URLSearchParams();

  if (rawPath && rawPath !== "/") {
    const parsed = new URL(rawPath, "https://example.invalid");
    let normalizedPath = parsed.pathname.startsWith("/") ? parsed.pathname : `/${parsed.pathname}`;
    if (normalizedPath.startsWith("/apps/logistics/")) {
      normalizedPath = normalizedPath.replace(/^\/apps\/logistics/, "") || "/";
    } else if (normalizedPath === "/apps/logistics") {
      normalizedPath = "/";
    }

    if (normalizedPath.startsWith("/build/") || normalizedPath.startsWith("/assets/")) {
      targetPath = normalizedPath;
    } else {
      targetPath = `/apps/logistics${normalizedPath}`;
    }
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

function escapeRegexLiteral(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function rewriteAssetUrls(html, base, appUrl) {
  const root = String(base || "").replace(/\/$/, "");
  if (!root) return html;

  let rewritten = html
    .replace(/(src|href)=["'](\/build\/[^"']+)["']/g, `$1="${root}$2"`)
    .replace(/(src|href)=["'](\/assets\/[^"']+)["']/g, `$1="${root}$2"`)
    .replace(
      /(src|href)=["']https?:\/\/[^"']+\/apps\/logistics\/(build|assets)\/([^"']+)["']/g,
      `$1="${root}/$2/$3"`
    );

  const appOrigin = String(appUrl || "").replace(/\/$/, "");
  if (appOrigin) {
    const appPrefix = `${appOrigin}/apps/logistics`;
    rewritten = rewritten.replace(new RegExp(escapeRegexLiteral(appPrefix), "g"), root);

    try {
      const host = new URL(appOrigin).host;
      const hostPrefix = `https?://${escapeRegexLiteral(host)}/apps/logistics`;
      rewritten = rewritten.replace(new RegExp(hostPrefix, "g"), root);
    } catch {
      // ignore malformed URL
    }
  }

  // Replace inline manifest strings like "/assets/manifest-..." in HTML scripts.
  rewritten = rewritten
    .replace(/(["'])\/assets\//g, `$1${root}/assets/`)
    .replace(/(["'])\/build\//g, `$1${root}/build/`);

  return rewritten;
}

function rewriteTextBody(text, base, appUrl) {
  const root = String(base || "").replace(/\/$/, "");
  let rewritten = String(text || "");
  if (!root) return rewritten;

  const appOrigin = String(appUrl || "").replace(/\/$/, "");
  if (appOrigin) {
    const appPrefix = `${appOrigin}/apps/logistics`;
    rewritten = rewritten.replace(new RegExp(escapeRegexLiteral(appPrefix), "g"), root);
    try {
      const host = new URL(appOrigin).host;
      const hostPrefix = `https?://${escapeRegexLiteral(host)}/apps/logistics`;
      rewritten = rewritten.replace(new RegExp(hostPrefix, "g"), root);
    } catch {
      // ignore malformed URL
    }
  }

  rewritten = rewritten.replace(
    /(https?:\/\/[^"']+\/apps\/logistics\/(build|assets)\/)/g,
    `${root}/$2/`
  );

  return rewritten;
}

async function forwardProxyRequest(request, subPath) {
  const target = buildProxyTarget(request, subPath);
  const method = request.method.toUpperCase();

  const outboundHeaders = new Headers(request.headers);
  outboundHeaders.delete("host");
  outboundHeaders.set("x-logistics-proxy", "1");

  const init = {
    method,
    headers: outboundHeaders,
    redirect: "manual",
  };

  if (method !== "GET" && method !== "HEAD") {
    const cloned = request.clone();
    init.body = await cloned.arrayBuffer();
  }

  const res = await fetch(target.toString(), init);
  const contentType = res.headers.get("content-type") || "";
  const isHtml = contentType.includes("text/html");
  const isText =
    isHtml ||
    contentType.includes("javascript") ||
    contentType.includes("ecmascript") ||
    contentType.includes("json") ||
    contentType.includes("css") ||
    contentType.startsWith("text/");

  if (!isText) {
    const passthroughHeaders = new Headers(res.headers);
    passthroughHeaders.delete("content-length");
    passthroughHeaders.delete("content-encoding");
    return new Response(res.body, {
      status: res.status,
      statusText: res.statusText,
      headers: passthroughHeaders,
    });
  }

  const requestUrl = new URL(request.url);
  const forwardedHost = request.headers.get("x-forwarded-host");
  const forwardedProto = request.headers.get("x-forwarded-proto");
  const proxyOrigin = forwardedHost
    ? `${forwardedProto || "https"}://${forwardedHost}`
    : requestUrl.origin;
  const proxyBase = `${proxyOrigin}/apps/logistics`;
  const appUrl = process.env.SHOPIFY_APP_URL || target.origin;

  if (res.status >= 300 && res.status < 400) {
    const responseHeaders = new Headers(res.headers);
    responseHeaders.delete("content-length");
    responseHeaders.delete("content-encoding");
    const location = responseHeaders.get("location");
    if (location) {
      try {
        const appOrigin = new URL(appUrl).origin;
        if (location.startsWith(appOrigin)) {
          responseHeaders.set("location", location.replace(appOrigin, proxyOrigin));
        }
      } catch {
        // ignore invalid URL
      }
    }
    return new Response(null, {
      status: res.status,
      statusText: res.statusText,
      headers: responseHeaders,
    });
  }
  const bodyText = await res.text();
  const rewritten = isHtml
    ? rewriteAssetUrls(bodyText, proxyBase, appUrl)
    : rewriteTextBody(bodyText, proxyBase, appUrl);

  const responseHeaders = new Headers(res.headers);
  responseHeaders.delete("content-length");
  responseHeaders.delete("content-encoding");
  if (!responseHeaders.get("content-type")) {
    responseHeaders.set("content-type", "text/html; charset=utf-8");
  }
  responseHeaders.set("cache-control", "no-store");

  return new Response(rewritten, {
    status: res.status,
    statusText: res.statusText,
    headers: responseHeaders,
  });
}

export async function handleProxyRequest(request, subPath) {
  try {
    await verifyProxyIfPresent(request);
  } catch (err) {
    if (err instanceof Response) return err;
    throw err;
  }
  return forwardProxyRequest(request, subPath);
}
