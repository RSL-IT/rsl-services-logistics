// vite.config.js
import path from "node:path";
import { defineConfig } from "vite";
import { vitePlugin as remix } from "@remix-run/dev";

export default defineConfig({
  plugins: [
    // Remix + Vite
    remix(),
  ],

  // So "~" resolves to your /app folder, and "utils/..." works too.
  resolve: {
    alias: {
      "~": path.resolve(process.cwd(), "app"),
      utils: path.resolve(process.cwd(), "app/utils"),
    },
  },

  // Server-Side Rendering bundling hints
  ssr: {
    // Prisma must remain external (don't bundle it)
    external: ["@prisma/client", "prisma"],
    // These Shopify ESM packages are safer when processed by Vite during SSR
    noExternal: [
      "@shopify/polaris",
      "@shopify/app-bridge-react",
      "@shopify/shopify-app-remix",
    ],
    target: "node",
  },

  // Helpful in prod debugging; optional
  build: {
    sourcemap: false,
  },
});
