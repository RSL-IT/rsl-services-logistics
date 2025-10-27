// app/entry.server.jsx
import { PassThrough } from "node:stream";
import { createReadableStreamFromReadable } from "@remix-run/node";
import { RemixServer } from "@remix-run/react";
import isbot from "isbot";
import { renderToPipeableStream } from "react-dom/server";
import { addDocumentResponseHeaders } from "~/shopify.server";

const ABORT_DELAY = 5000;

export default function handleRequest(request, status, headers, remixContext) {
  const ua = request.headers.get("user-agent") || "";
  return isbot(ua)
    ? handleBotRequest(request, status, headers, remixContext)
    : handleBrowserRequest(request, status, headers, remixContext);
}

function handleBotRequest(request, status, headers, remixContext) {
  return new Promise((resolve, reject) => {
    let didError = false;

    const { pipe, abort } = renderToPipeableStream(
      <RemixServer context={remixContext} url={request.url} />,
      {
        onAllReady() {
          const body = new PassThrough();

          headers.set("Content-Type", "text/html");
          // Let Shopify add CSP / frame-ancestors, etc.
          addDocumentResponseHeaders(headers, { request });

          const stream = createReadableStreamFromReadable(body);
          resolve(
            new Response(stream, {
              status: didError ? 500 : status,
              headers,
            })
          );

          pipe(body);
        },
        onShellError(err) {
          reject(err);
        },
        onError(err) {
          didError = true;
          console.error(err);
        },
      }
    );

    setTimeout(abort, ABORT_DELAY);
  });
}

function handleBrowserRequest(request, status, headers, remixContext) {
  return new Promise((resolve, reject) => {
    let didError = false;

    const { pipe, abort } = renderToPipeableStream(
      <RemixServer context={remixContext} url={request.url} />,
      {
        onShellReady() {
          const body = new PassThrough();

          headers.set("Content-Type", "text/html");
          // Let Shopify add CSP / frame-ancestors, etc.
          addDocumentResponseHeaders(headers, { request });

          const stream = createReadableStreamFromReadable(body);
          resolve(
            new Response(stream, {
              status: didError ? 500 : status,
              headers,
            })
          );

          pipe(body);
        },
        onShellError(err) {
          reject(err);
        },
        onError(err) {
          didError = true;
          console.error(err);
        },
      }
    );

    setTimeout(abort, ABORT_DELAY);
  });
}
