import { createHash, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { contentTypeFor, resolveStaticPath } from "./static-handler.mjs";

const DEFAULT_MAX_BODY = 1_500_000;
const SECURITY_HEADERS = {
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self' https://grok.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'self' https://grok.com",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
};

export function validateToken(raw) {
  const token = String(raw || "");
  if (!token || token === "change-me") throw new Error("CADENCE_TOKEN must be explicitly configured.");
  if (Buffer.byteLength(token) < 32) throw new Error("CADENCE_TOKEN must be at least 32 characters long.");
  return token;
}

function emptyState() {
  return { revision: 0, tasks: [], categories: [] };
}

function normalizeState(value) {
  if (!value || typeof value !== "object") throw new Error("State must be an object.");
  if (!Array.isArray(value.tasks) || !Array.isArray(value.categories)) throw new Error("State must include tasks and categories arrays.");
  return {
    revision: Number.isSafeInteger(value.revision) && value.revision >= 0 ? value.revision : 0,
    tasks: value.tasks,
    categories: value.categories,
  };
}

function readStateFile(path) {
  return normalizeState(JSON.parse(readFileSync(path, "utf8")));
}

export function loadState(dataPath) {
  if (!existsSync(dataPath)) return emptyState();
  try {
    return readStateFile(dataPath);
  } catch (primaryError) {
    const backupPath = `${dataPath}.bak`;
    try {
      const recovered = readStateFile(backupPath);
      writeFileSync(dataPath, JSON.stringify(recovered));
      console.warn(`Recovered invalid primary state from ${backupPath}: ${primaryError.message}`);
      return recovered;
    } catch {
      throw new Error(`State file is invalid and no usable backup exists: ${primaryError.message}`);
    }
  }
}

function persistState(dataPath, state) {
  mkdirSync(dirname(dataPath), { recursive: true });
  const tmpPath = `${dataPath}.tmp`;
  const backupPath = `${dataPath}.bak`;
  writeFileSync(tmpPath, JSON.stringify(state));
  if (existsSync(dataPath)) copyFileSync(dataPath, backupPath);
  renameSync(tmpPath, dataPath);
  if (!existsSync(backupPath)) copyFileSync(dataPath, backupPath);
}

function etag(revision) {
  return `"${revision}"`;
}

function parseRevision(header) {
  const match = /^"(\d+)"$/.exec(String(header || ""));
  return match ? Number(match[1]) : null;
}

function tokenMatches(expected, authorization) {
  const supplied = String(authorization || "").replace(/^Bearer\s+/i, "");
  const expectedDigest = createHash("sha256").update(expected).digest();
  const suppliedDigest = createHash("sha256").update(supplied).digest();
  return timingSafeEqual(expectedDigest, suppliedDigest);
}

function readBody(req, maxBody) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let settled = false;
    req.on("data", (chunk) => {
      if (settled) return;
      size += chunk.length;
      if (size > maxBody) {
        settled = true;
        reject(Object.assign(new Error("Request body too large"), { statusCode: 413 }));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (!settled) resolve(Buffer.concat(chunks).toString("utf8"));
    });
    req.on("error", (error) => {
      if (!settled) reject(error);
    });
  });
}

function send(res, status, body, type = "application/json; charset=utf-8", headers = {}, headOnly = false) {
  res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store", ...SECURITY_HEADERS, ...headers });
  res.end(headOnly ? undefined : body);
}

export function createCadenceServer({ token, dataPath = "/data/state.json", staticDir = "/app/static", maxBody = DEFAULT_MAX_BODY, allowedOrigins = [] } = {}) {
  const configuredToken = validateToken(token);
  const origins = new Set(allowedOrigins.filter(Boolean));
  let state = loadState(dataPath);
  let writing = Promise.resolve();

  function corsHeaders(req) {
    const origin = req.headers.origin;
    return origin && origins.has(origin)
      ? {
          "Access-Control-Allow-Origin": origin,
          "Access-Control-Expose-Headers": "ETag",
          Vary: "Origin",
        }
      : {};
  }

  function originAllowed(req) {
    const origin = req.headers.origin;
    return !origin || origins.has(origin);
  }

  function serveStatic(req, res, pathname) {
    const filePath = resolveStaticPath(staticDir, pathname === "/" ? "/index.html" : pathname);
    if (filePath && existsSync(filePath) && statSync(filePath).isFile()) {
      const isAsset = pathname.startsWith("/assets/") || pathname.startsWith("/__grok/");
      send(res, 200, readFileSync(filePath), contentTypeFor(filePath), { "Cache-Control": isAsset ? "public, max-age=31536000, immutable" : "no-cache" }, req.method === "HEAD");
      return true;
    }
    const fallback = join(staticDir, "index.html");
    if (!existsSync(fallback)) return false;
    send(res, 200, readFileSync(fallback), "text/html; charset=utf-8", { "Cache-Control": "no-cache" }, req.method === "HEAD");
    return true;
  }

  return createServer(async (req, res) => {
    const url = new URL(req.url || "/", "http://localhost");

    if (url.pathname === "/health" && req.method === "OPTIONS") {
      if (!originAllowed(req)) {
        send(res, 403, JSON.stringify({ error: "Origin not allowed" }));
        return;
      }
      send(res, 204, "", "text/plain", { ...corsHeaders(req), "Access-Control-Allow-Headers": "Authorization", "Access-Control-Allow-Methods": "GET, OPTIONS" });
      return;
    }

    if (url.pathname === "/health" && req.method === "GET") {
      if (!originAllowed(req)) {
        send(res, 403, JSON.stringify({ error: "Origin not allowed" }));
        return;
      }
      send(res, 200, JSON.stringify({ ok: true, name: "cat2duck" }), undefined, corsHeaders(req));
      return;
    }

    if (url.pathname === "/v1/state" && req.method === "OPTIONS") {
      if (!originAllowed(req)) {
        send(res, 403, JSON.stringify({ error: "Origin not allowed" }));
        return;
      }
      send(res, 204, "", "text/plain", { ...corsHeaders(req), "Access-Control-Allow-Headers": "Authorization, Content-Type, If-Match", "Access-Control-Allow-Methods": "GET, PUT, OPTIONS" });
      return;
    }

    if (url.pathname === "/v1/state" && (req.method === "GET" || req.method === "PUT")) {
      if (!originAllowed(req)) {
        send(res, 403, JSON.stringify({ error: "Origin not allowed" }));
        return;
      }
      const headers = corsHeaders(req);
      if (!tokenMatches(configuredToken, req.headers.authorization)) {
        send(res, 401, JSON.stringify({ error: "Unauthorized" }), undefined, headers);
        return;
      }
      if (req.method === "GET") {
        send(res, 200, JSON.stringify({ tasks: state.tasks, categories: state.categories }), undefined, { ...headers, ETag: etag(state.revision) });
        return;
      }

      const expectedRevision = parseRevision(req.headers["if-match"]);
      if (expectedRevision === null) {
        send(res, 428, JSON.stringify({ error: "If-Match revision required" }), undefined, headers);
        return;
      }

      let rawBody = "";
      try {
        rawBody = await readBody(req, maxBody);
      } catch (error) {
        req.resume();
        const status = error?.statusCode === 413 ? 413 : 400;
        send(res, status, JSON.stringify({ error: status === 413 ? "Request body too large" : "Invalid request" }), undefined, headers);
        return;
      }

      let parsed;
      try {
        parsed = JSON.parse(rawBody);
      } catch {
        send(res, 400, JSON.stringify({ error: "Invalid JSON" }), undefined, headers);
        return;
      }

      if (!Array.isArray(parsed.tasks) || !Array.isArray(parsed.categories)) {
        send(res, 400, JSON.stringify({ error: "Expected tasks and categories arrays" }), undefined, headers);
        return;
      }
      if (parsed.tasks.length > 5000 || parsed.categories.length > 200) {
        send(res, 400, JSON.stringify({ error: "Too many items" }), undefined, headers);
        return;
      }

      const nextPromise = writing.catch(() => {}).then(async () => {
        if (expectedRevision !== state.revision) {
          const conflict = new Error("State changed");
          conflict.statusCode = 409;
          conflict.revision = state.revision;
          throw conflict;
        }
        const nextState = { revision: state.revision + 1, tasks: parsed.tasks, categories: parsed.categories };
        await persistState(dataPath, nextState);
        state = nextState;
        return nextState.revision;
      });

      writing = nextPromise.catch(() => {});

      try {
        const savedRevision = await nextPromise;
        send(res, 200, JSON.stringify({ ok: true, revision: savedRevision }), undefined, { ...headers, ETag: etag(savedRevision) });
      } catch (error) {
        if (error?.statusCode === 409) {
          send(res, 409, JSON.stringify({ error: "State changed", revision: error.revision }), undefined, { ...headers, ETag: etag(error.revision) });
          return;
        }
        send(res, 500, JSON.stringify({ error: "Failed to persist state" }), undefined, headers);
      }
      return;
    }

    if ((req.method === "GET" || req.method === "HEAD") && serveStatic(req, res, url.pathname)) return;
    send(res, 404, JSON.stringify({ error: "Not found" }));
  });
}

function runFromEnvironment() {
  const allowedOrigins = String(process.env.CADENCE_ALLOWED_ORIGINS || "").split(",").map((origin) => origin.trim()).filter(Boolean);
  const server = createCadenceServer({ token: process.env.CADENCE_TOKEN, dataPath: process.env.DATA_PATH || "/data/state.json", staticDir: process.env.STATIC_DIR || "/app/static", allowedOrigins });
  const port = Number(process.env.PORT || 8787);
  server.listen(port, "0.0.0.0", () => console.log(`Cat2Duck server listening on ${port}`));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    runFromEnvironment();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
