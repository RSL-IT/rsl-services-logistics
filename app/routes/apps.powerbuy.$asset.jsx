/// app/routes/apps.powerbuy.$asset.jsx
import { redirect } from "@remix-run/node";

export async function loader({ params }) {
  const asset = params.asset || "";

  if (asset === "font-awesome.css") {
    return redirect("/assets/font-awesome.css");
  }
  if (asset === "pe-icon-7-stroke.css") {
    return redirect("/assets/pe-icon-7-stroke.css");
  }
  if (asset === "rs6.css") {
    return redirect("/assets/rs6.css");
  }
  if (asset === "revicons.woff") {
    return redirect("/assets/revicons.woff");
  }
  if (asset === "fontawesome-webfont.woff2") {
    return redirect("/assets/fontawesome-webfont.woff2");
  }
  if (asset === "revQuery.js") {
    return redirect("/assets/revQuery.js");
  }

  throw new Response("Not found", { status: 404 });
}

export default function ProxyAsset() {
  return null;
}
