// app/routes/webhooks.jsx
import { json } from "@remix-run/node";
// If you have a shopify instance, you can import it here:
// import { shopify } from "~/shopify-admin.server";

export async function action({ request }) {
  try {
    // 🔹 Minimal safe version: just 200 so Shopify stops seeing 404s.
    // TODO: Replace this with your real Shopify webhook processing.

    // If you have shopify.webhooks.process, it would look like:
    // await shopify.webhooks.process({
    //   rawBody: await request.text(),
    //   rawRequest: request,
    // });

    return new Response(null, { status: 200 });
  } catch (error) {
    console.error("Error handling webhook", error);
    return new Response("Error", { status: 500 });
  }
}

// We don't really expect GET /webhooks
export function loader() {
  return new Response("Not found", { status: 404 });
}
