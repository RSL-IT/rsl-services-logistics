import { Links, Meta, Outlet, Scripts, ScrollRestoration } from "@remix-run/react";
import { AppProvider } from "@shopify/polaris";
import en from "@shopify/polaris/locales/en.json";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";

export const links = () => [{ rel: "stylesheet", href: polarisStyles }];

export const meta = () => [
  { charSet: "utf-8" },
  { name: "viewport", content: "width=device-width, initial-scale=1" },
  { title: "RSL Services" },
];

export default function App() {
  return (
    <html lang="en">
    <head><Meta /><Links /></head>
    <body>
    <AppProvider i18n={en}><Outlet /></AppProvider>
    <ScrollRestoration /><Scripts />
    </body>
    </html>
  );
}
