// app/routes/_index/route.jsx
import { json } from "@remix-run/node";
import styles from "./styles.module.css";

export const links = () => [{ rel: "stylesheet", href: styles }];

export const loader = async () => {
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
