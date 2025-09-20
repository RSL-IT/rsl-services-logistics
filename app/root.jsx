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

// If you use Shopify auth helpers elsewhere:
import { authenticate } from "./shopify.server";

// Polaris CSS (works with Remix + Vite)
import polarisStylesHref from "@shopify/polaris/build/esm/styles.css?url";

export const links = () => [
  { rel: "stylesheet", href: polarisStylesHref },
];

export const meta = () => ([
  { title: "RSL Services App" },
  { name: "viewport", content: "width=device-width,initial-scale=1" },
]);

// Any resource paths that must NOT trigger global auth:
const API_BYPASS = [
  /^\/apps\/returns\/lookups(?:$|\/|\?)/,   // lookups endpoint (UI extension)
  /^\/apps\/csd-entry\/save(?:$|\/|\?)/,    // (optional) data save endpoint
  /^\/apps\/csd-entry\/load(?:$|\/|\?)/,    // (optional) data load endpoint
  // add more resource routes here if needed
];

export async function loader({ request }) {
  const { pathname } = new URL(request.url);

  // ✅ If this is one of our API/resource endpoints, DO NOT run global auth.
  //    This prevents 302/410 reauths (e.g., to /auth/login) from short-circuiting
  //    the child route like /apps/returns/lookups.
  if (API_BYPASS.some((re) => re.test(pathname))) {
    return json(null);
  }

  // ⬇️ For normal app pages, keep your existing auth flow.
  // If your app previously authenticated here, keep calling it:
  // (This will redirect/throw as needed for Admin access)
  await authenticate.admin(request);

  // You can return any root-level data your app needs:
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

// Optional (nice to have): error boundary to surface route errors nicely.
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
