// app/routes/auth.$.jsx
import { auth } from "~/shopify.server";

// Handles both GET and POST for OAuth callback
export const loader = async ({ request }) => {
  return auth.callback({ request });
};

export const action = async ({ request }) => {
  return auth.callback({ request });
};
