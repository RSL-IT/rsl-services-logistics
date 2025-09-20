// extensions/returns-extension/vite.config.ts
import { defineConfig } from "vite";

// Inject the current dev tunnel (SHOPIFY_APP_URL) into the extension bundle as __APP_URL__
// Falls back to VITE_APP_URL (if you set one) then your Fly URL in prod.
export default defineConfig({
  define: {
    __APP_URL__: JSON.stringify(
      process.env.SHOPIFY_APP_URL ||
      process.env.VITE_APP_URL ||
      "https://rsl-services-app.fly.dev"
    ),
  },
});
