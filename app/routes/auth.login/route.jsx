// app/routes/auth.login/route.jsx
import { redirect } from "@remix-run/node";

// Convenience entry that just forwards to /auth?shop=...
export async function loader({ request }) {
  const url = new URL(request.url);
  const shop = url.searchParams.get("shop");
  if (!shop) {
    return new Response("Missing ?shop", { status: 400 });
  }
  return redirect(`/auth?shop=${encodeURIComponent(shop)}`);
}

