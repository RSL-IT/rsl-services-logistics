// app/routes/auth.login/route.jsx
import { auth } from "~/shopify.server";

// Kicks off OAuth. Expects ?shop=<shop-domain>
export const loader = async ({ request }) => {
  // If you need online tokens, pass: { request, isOnline: true }
  return auth.begin({ request });
};
