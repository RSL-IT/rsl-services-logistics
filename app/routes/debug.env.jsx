// app/routes/debug.env.jsx
import { json } from "@remix-run/node";

export const loader = ({ request }) => {
  if (process.env.NODE_ENV === "production") {
    return json({ ok: false, error: "Not found" }, { status: 404 });
  }

  const url = new URL(request.url);
  const base = process.env.SHOPIFY_APP_URL || "(unset)";
  return json({
    ok: true,
    origin: url.origin,
    SHOPIFY_APP_URL: base,
    callback: `${base.replace(/\/$/, "")}/auth/callback`,
    hasScheme: /^(https?):\/\//i.test(base),
  });
};
