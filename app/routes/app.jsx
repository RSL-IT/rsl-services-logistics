// app/routes/app.jsx
import { Outlet } from "@remix-run/react";
import { NavMenu } from "@shopify/app-bridge-react";

// No AppProvider here — it's already in root.jsx

// Optional: if you want auth here too, you can keep a loader, but
// relying on the root loader is usually enough.
export const loader = async () => null;

export default function AppLayout() {
  return (
    <>
      {/* This drives the Shopify Admin left sidebar for your app */}
      <NavMenu>
        {/* First link labels the group and should point to your layout's home */}
        <a href="/app" rel="home">RSL Services</a>

        {/* Keep ONLY these three entries */}
        <a href="/app/returns">Returns</a>
        <a href="/app/inprocess">In-Process</a>
        <a href="/app/serialnumbers">Serial Number Services</a>
      </NavMenu>

      {/* Child pages under /app/* render here */}
      <Outlet />
    </>
  );
}
