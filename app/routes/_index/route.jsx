// app/routes/_index/route.jsx
import { json, redirect } from "@remix-run/node";
import { authenticate } from "~/shopify.server";
import styles from "./styles.module.css";

export const links = () => [{ rel: "stylesheet", href: styles }];

export const loader = async ({ request }) => {
  const url = new URL(request.url);
  const shop = url.searchParams.get("shop");
  if (shop) {
    // Let Shopify auth handle embedded reauth/top-level redirects.
    let authResult;
    try {
      authResult = await authenticate.admin(request);
    } catch (err) {
      if (err instanceof Response) return err;
      throw err;
    }
    if (authResult instanceof Response) return authResult;

    const params = new URLSearchParams();
    params.set("shop", shop);
    const host = url.searchParams.get("host");
    if (host) params.set("host", host);
    const embedded = url.searchParams.get("embedded");
    if (embedded) params.set("embedded", embedded);

    const target = `/app?${params.toString()}`;
    try {
      return authResult.redirect(target);
    } catch (err) {
      if (err instanceof Response) return err;
      throw err;
    }
  }

  // Basic loader so SSR is happy. No auth here.
  return json({ ok: true });
};

export default function Index() {
  return (
    <main className={styles.container}>
      <h1>RSL Services App</h1>
      <p>App is running. To authenticate a shop, go to <code>/auth/login</code>.</p>
    </main>
  );
}
