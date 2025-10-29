// app/entry.server.jsx
import { RemixServer } from "@remix-run/react";
import { PassThrough } from "node:stream";
import server from "react-dom/server"; // CJS-safe default import
import { createReadableStreamFromReadable } from "@remix-run/node";
import isbot from "~/utils/isbot.server";

const ABORT_DELAY = 5000;

export default function handleRequest(request, status, headers, remixContext) {
  const ua = request.headers.get("user-agent") || "";
  const bot = isbot(ua);

  return bot
    ? streamForBots(request, status, headers, remixContext)
    : streamForBrowsers(request, status, headers, remixContext);
}

function streamForBrowsers(request, status, headers, remixContext) {
  let didError = false;

  return new Promise((resolve, reject) => {
    const { pipe, abort } = server.renderToPipeableStream(
      <RemixServer context={remixContext} url={request.url} />,
      {
        onShellReady() {
          const body = new PassThrough();
          headers.set("Content-Type", "text/html");
          resolve(
            new Response(createReadableStreamFromReadable(body), {
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

function streamForBots(request, status, headers, remixContext) {
  let didError = false;

  return new Promise((resolve, reject) => {
    const { pipe, abort } = server.renderToPipeableStream(
      <RemixServer context={remixContext} url={request.url} />,
      {
        onAllReady() {
          const body = new PassThrough();
          headers.set("Content-Type", "text/html");
          resolve(
            new Response(createReadableStreamFromReadable(body), {
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
