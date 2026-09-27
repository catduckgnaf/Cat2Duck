import { resolve, normalize, extname, sep } from "node:path";

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

export function contentTypeFor(filePath) {
  const ext = extname(filePath).toLowerCase();
  return MIME_TYPES[ext] || "application/octet-stream";
}

export function resolveStaticPath(rootDir, requestedPath) {
  const decoded = decodeURIComponent(requestedPath);
  if (decoded.includes("..")) {
    return null;
  }
  const resolvedRoot = resolve(rootDir);
  const normalized = normalize(decoded);
  const relative = normalized.startsWith("/") ? normalized.slice(1) : normalized;
  const fullPath = resolve(resolvedRoot, relative);
  if (fullPath !== resolvedRoot && !fullPath.startsWith(resolvedRoot + sep)) {
    return null;
  }
  return fullPath;
}
