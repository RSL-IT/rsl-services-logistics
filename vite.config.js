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
    // Keep server-native deps out of the SSR bundle
    external: [
      "@prisma/client",
      "prisma",
      "nodemailer", // 👈 important for the mailer
    ],
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
    // If you ever see bundling tries again, you can also do:
    // rollupOptions: { external: ["nodemailer"] },
  },

  // Prevent pre-bundling for nodemailer (not strictly required, but harmless)
  optimizeDeps: {
    exclude: ["nodemailer"],
  },
});
