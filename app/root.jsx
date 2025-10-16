// app/root.jsx
import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  LiveReload,
  useRouteError,
  useLoaderData,
  useLocation,
} from "@remix-run/react";
import { json } from "@remix-run/node";

import { AppProvider } from "@shopify/shopify-app-remix/react";
// ✅ Use the React wrapper (no actions package needed)
import { NavMenu } from "@shopify/app-bridge-react";

import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";
import { Banner, Box, InlineStack, Button } from "@shopify/polaris";
import { useEffect, useState } from "react";

export const links = () => [{ rel: "stylesheet", href: polarisStyles }];

export const meta = () => [
  { charSet: "utf-8" },
  { title: "RSL Services App" },
  { name: "viewport", content: "width=device-width,initial-scale=1" },
];

export const loader = async () => {
  return json({ devTools: process.env.ENABLE_DEV_TOOLS === "1" });
};

// Client-only mount avoids SSR timing issues
function ClientNavMenu() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return (
    <NavMenu
      navigationLinks={[
        { label: "Returns", destination: "/app/returns" },
        { label: "In Process", destination: "/app/inprocess" },
        { label: "Inventory Adjust", destination: "/app/inventory-adjust" },
      ]}
    />
  );
}

// Preserve ?host=… across navigations so App Bridge stays happy
function DevToolsBanner() {
  const { devTools } = useLoaderData();
  const { search } = useLocation();
  if (!devTools) return null;

  const go = (path) => {
    const hasQuery = !!search && search !== "?";
    const href = hasQuery ? `${path}${path.includes("?") ? "&" : "?"}${search.slice(1)}` : path;
    window.location.assign(href);
  };

  return (
    <Box padding="200">
      <Banner title="Dev Tools" tone="info">
        <InlineStack gap="200" align="start">
          <Button onClick={() => go("/app/tools/price-rules")}>Price Rules</Button>
          <Button onClick={() => go("/app/tools/generate-discount")}>Generator</Button>
        </InlineStack>
      </Banner>
    </Box>
  );
}

export default function App() {
  return (
    <html lang="en">
    <head>
      <Meta />
      <Links />
    </head>
    <body>
    <AppProvider>
      <ClientNavMenu />
      <DevToolsBanner />
      <Outlet />
    </AppProvider>

    <ScrollRestoration />
    <Scripts />
    <LiveReload />
    </body>
    </html>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();
  const message =
    (error && ("statusText" in error ? error.statusText : error.message)) ||
    "Unknown error";

  return (
    <html lang="en">
    <head>
      <Meta />
      <Links />
      <title>Application error</title>
    </head>
    <body>
    <AppProvider>
      <Box padding="400">
        <Banner tone="critical" title="Something went wrong">
              <pre style={{ whiteSpace: "pre-wrap", marginTop: 12 }}>
                {message}
              </pre>
        </Banner>
      </Box>
    </AppProvider>
    <Scripts />
    </body>
    </html>
  );
}
