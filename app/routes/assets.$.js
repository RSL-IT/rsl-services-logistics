// app/routes/assets.$.js
import path from "node:path";
import { readFile, readdir } from "node:fs/promises";

const ASSETS_ROOT = path.resolve(process.cwd(), "build", "client", "assets");
const ASSET_BASE = normalizeAssetBase(process.env.LOGISTICS_ASSET_BASE || "/");

function normalizeAssetBase(value) {
  const raw = String(value || "").trim();
  if (!raw) return "/";
  const withLeading = raw.startsWith("/") ? raw : `/${raw}`;
  return withLeading.endsWith("/") ? withLeading : `${withLeading}/`;
}

function rewriteManifest(text) {
  if (ASSET_BASE === "/") return text;
  return text
    .replace(/(["'])\/assets\//g, `$1${ASSET_BASE}assets/`)
    .replace(/(["'])\/build\//g, `$1${ASSET_BASE}build/`);
}

function contentTypeFor(filename) {
  const ext = path.extname(filename).toLowerCase();
  switch (ext) {
    case ".js":
      return "application/javascript; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    case ".json":
    case ".map":
      return "application/json; charset=utf-8";
    default:
      return "application/octet-stream";
  }
}

export async function loader({ params }) {
  const rel = String(params["*"] || "").replace(/^\/+/, "");
  const requestedName = path.basename(rel);
  const isManifestRequest = requestedName.startsWith("manifest-");
  const filePath = path.resolve(ASSETS_ROOT, rel);

  if (!filePath.startsWith(ASSETS_ROOT)) {
    return new Response("Not found", { status: 404 });
  }

  try {
    const ext = path.extname(filePath).toLowerCase();
    const isManifest = requestedName.startsWith("manifest-");
    if (isManifest && (ext === ".js" || ext === ".json")) {
      try {
        const text = await readFile(filePath, "utf8");
        const rewritten = rewriteManifest(text);
        return new Response(rewritten, {
          status: 200,
          headers: {
            "Content-Type": contentTypeFor(filePath),
            "Cache-Control": "public, max-age=31536000, immutable",
          },
        });
      } catch {
        // fall through to optional manifest fallback
      }
    }

    const data = await readFile(filePath);
    return new Response(data, {
      status: 200,
      headers: {
        "Content-Type": contentTypeFor(filePath),
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch {
    if (isManifestRequest) {
      try {
        const entries = await readdir(ASSETS_ROOT);
        const fallback = entries.find((name) => name.startsWith("manifest-"));
        if (fallback) {
          const fallbackPath = path.resolve(ASSETS_ROOT, fallback);
          const text = await readFile(fallbackPath, "utf8");
          const rewritten = rewriteManifest(text);
          return new Response(rewritten, {
            status: 200,
            headers: {
              "Content-Type": contentTypeFor(fallbackPath),
              "Cache-Control": "public, max-age=60",
            },
          });
        }
      } catch {
        // ignore fallback failures
      }
    }
    return new Response("Not found", { status: 404 });
  }
}
