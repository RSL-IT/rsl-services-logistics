// app/routes/favicon.ico.js
import path from "node:path";
import { readFile } from "node:fs/promises";

const FAVICON_PATH = path.resolve(process.cwd(), "build", "client", "favicon.ico");

export async function loader() {
  try {
    const data = await readFile(FAVICON_PATH);
    return new Response(data, {
      status: 200,
      headers: {
        "Content-Type": "image/x-icon",
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
