// app/root.jsx
import * as React from "react";
import { json } from "@remix-run/node";
import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  LiveReload,
} from "@remix-run/react";
import { authenticate } from "./shopify.server";
import polarisStylesHref from "@shopify/polaris/build/esm/styles.css?url";

export const links = () => [
  { rel: "stylesheet", href: polarisStylesHref },
];

export const meta = () => ([
  { title: "RSL Services App" },
  { name: "viewport", content: "width=device-width,initial-scale=1" },
]);

// Only bypass global auth for resource endpoints that must not reauth.
const API_BYPASS = [
  /^\/apps\/returns\/lookups(?:$|\/|\?)/, // let the child route handle its own CORS/auth
];

export async function loader({ request }) {
  const { pathname } = new URL(request.url);

  // ✅ Skip global auth for allowed API routes
  if (API_BYPASS.some((re) => re.test(pathname))) {
    return json(null);
  }

  // ⬇️ Normal app pages still require Admin auth
  await authenticate.admin(request);
  return json({});
}

export default function App() {
  return (
    <html lang="en">
    <head>
      <Meta />
      <Links />
    </head>
    <body>
    <Outlet />
    <ScrollRestoration />
    <Scripts />
    <LiveReload />
    </body>
    </html>
  );
}

export function ErrorBoundary({ error }) {
  return (
    <html lang="en">
    <head>
      <Meta />
      <Links />
      <title>App Error</title>
    </head>
    <body>
    <div style={{ padding: 16 }}>
      <h1>Something went wrong</h1>
      <pre style={{ whiteSpace: "pre-wrap" }}>{String(error?.stack || error)}</pre>
    </div>
    <Scripts />
    </body>
    </html>
  );
}
