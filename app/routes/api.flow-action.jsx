// app/routes/api/flow-action.jsx
import { json } from "@remix-run/node";
import crypto from "crypto";

export const action = async ({ request }) => {
  const body = await request.text();
  const hmacHeader = request.headers.get("x-shopify-hmac-sha256");
  const secret = process.env.SHOPIFY_API_SECRET;

  // Verify HMAC
  const hash = crypto.createHmac("sha256", secret).update(body).digest("base64");

  if (hash !== hmacHeader) {
    return new Response("Unauthorized", { status: 401 });
  }

  const payload = JSON.parse(body);
  console.log("Received Flow action payload:", payload);

  // Do something with the data here...

  return json({ success: true });
};
