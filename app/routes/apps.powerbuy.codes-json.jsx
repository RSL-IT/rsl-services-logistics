// app/routes/apps.powerbuy.codes-json.jsx

// Resource route: reuse the same loader as the HTML page,
// but with no React component. This keeps it server-only and
// avoids the Vite "server-only module referenced by client" error.
export { loader } from "./apps.powerbuy.codes.jsx";
