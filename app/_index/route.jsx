// app/routes/_index.jsx
import { redirect } from "@remix-run/node";

export async function loader({ request }) {
  const url = new URL(request.url);
  const shop = url.searchParams.get("shop");

  if (shop) {
    // If Shopify hits root, send it to auth flow
    return redirect(`/auth/login?shop=${encodeURIComponent(shop)}`);
  }

  // Fallback health check for hitting the app directly
  return new Response(
    "RSL Services App<br/>App is running. To authenticate a shop, go to /auth/login.",
    { headers: { "Content-Type": "text/html" } }
  );
}

export default function Index() {
  return null; // response above handles it
}
