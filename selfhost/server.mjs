import { createServer } from "node:http";
import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { contentTypeFor, resolveStaticPath } from "./static-handler.mjs";

const PORT = Number(process.env.PORT || 8787);
const TOKEN = process.env.CADENCE_TOKEN || "";
const DATA = process.env.DATA_PATH || "/data/state.json";
const STATIC_DIR = process.env.STATIC_DIR || "/app/static";
const MAX_BODY = 1_500_000;

if (!TOKEN || TOKEN === "change-me") {
  console.warn("WARNING: CADENCE_TOKEN is unset or using default 'change-me'. Secure with a strong bearer token.");
}

function readState() {
  try {
    if (!existsSync(DATA)) {
      return { tasks: [], categories: [] };
    }
    const parsed = JSON.parse(readFileSync(DATA, "utf8"));
    return {
      tasks: Array.isArray(parsed.tasks) ? parsed.tasks : [],
      categories: Array.isArray(parsed.categories) ? parsed.categories : [],
    };
  } catch (err) {
    console.error("Failed to read server state file:", err.message);
    return { tasks: [], categories: [] };
  }
}

let writing = Promise.resolve();

function writeState(state) {
  writing = writing.then(() => {
    mkdirSync(dirname(DATA), { recursive: true });
    const tmp = `${DATA}.tmp`;
    writeFileSync(tmp, JSON.stringify(state));
    renameSync(tmp, DATA);
  });
  return writing;
}

function send(res, status, body, type = "application/json; charset=utf-8", headers = {}) {
  res.writeHead(status, {
    "Content-Type": type,
    "Cache-Control": "no-store",
    ...headers,
  });
  res.end(body);
}

function authorized(req) {
  if (!TOKEN) return false;
  const header = req.headers.authorization || "";
  return header === `Bearer ${TOKEN}`;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new Error("too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function serveStatic(res, pathname) {
  const filePath = resolveStaticPath(STATIC_DIR, pathname === "/" ? "/index.html" : pathname);
  if (filePath && existsSync(filePath)) {
    const stat = statSync(filePath);
    if (stat.isFile()) {
      const type = contentTypeFor(filePath);
      const isAsset = pathname.startsWith("/assets/") || pathname.startsWith("/__grok/");
      const cacheHeader = isAsset ? "public, max-age=31536000, immutable" : "no-cache";
      try {
        const content = readFileSync(filePath);
        send(res, 200, content, type, { "Cache-Control": cacheHeader });
        return true;
      } catch {
        return false;
      }
    }
  }

  // SPA fallback to index.html for text/html requests
  const fallbackIndex = join(STATIC_DIR, "index.html");
  if (existsSync(fallbackIndex)) {
    try {
      const content = readFileSync(fallbackIndex);
      send(res, 200, content, "text/html; charset=utf-8", { "Cache-Control": "no-cache" });
      return true;
    } catch {
      return false;
    }
  }

  return false;
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || "/", "http://localhost");

  // Health endpoint
  if (url.pathname === "/health" && req.method === "GET") {
    if (!authorized(req)) {
      send(res, TOKEN ? 401 : 503, JSON.stringify({ error: TOKEN ? "Unauthorized" : "Set CADENCE_TOKEN" }));
      return;
    }
    send(res, 200, JSON.stringify({ ok: true, name: "cadence" }));
    return;
  }

  // API sync endpoint
  if (url.pathname === "/v1/state" && (req.method === "GET" || req.method === "PUT")) {
    if (!authorized(req)) {
      send(res, TOKEN ? 401 : 503, JSON.stringify({ error: TOKEN ? "Unauthorized" : "Set CADENCE_TOKEN" }));
      return;
    }
    if (req.method === "GET") {
      send(res, 200, JSON.stringify(readState()));
      return;
    }
    try {
      const parsed = JSON.parse(await readBody(req));
      if (!Array.isArray(parsed.tasks) || !Array.isArray(parsed.categories)) {
        send(res, 400, JSON.stringify({ error: "Expected tasks and categories arrays" }));
        return;
      }
      if (parsed.tasks.length > 5000 || parsed.categories.length > 200) {
        send(res, 400, JSON.stringify({ error: "Too many items" }));
        return;
      }
      const state = { tasks: parsed.tasks, categories: parsed.categories };
      await writeState(state);
      send(res, 200, JSON.stringify({ ok: true }));
    } catch {
      send(res, 400, JSON.stringify({ error: "Invalid JSON" }));
    }
    return;
  }

  // Static files / Web UI fallback
  if (req.method === "GET" || req.method === "HEAD") {
    if (serveStatic(res, url.pathname)) {
      return;
    }
  }

  send(res, 404, JSON.stringify({ error: "Not found" }));
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Cadence server listening on ${PORT}`);
});
