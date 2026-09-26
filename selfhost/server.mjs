import { createServer } from "node:http";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const PORT = Number(process.env.PORT || 8787);
const TOKEN = process.env.CADENCE_TOKEN || "";
const DATA = process.env.DATA_PATH || "/data/state.json";
const MAX_BODY = 1_500_000;

function readState() {
  try {
    const parsed = JSON.parse(readFileSync(DATA, "utf8"));
    return {
      tasks: Array.isArray(parsed.tasks) ? parsed.tasks : [],
      categories: Array.isArray(parsed.categories) ? parsed.categories : [],
    };
  } catch {
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

function send(res, status, body, type = "application/json; charset=utf-8") {
  res.writeHead(status, {
    "Content-Type": type,
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Allow-Methods": "GET, PUT, OPTIONS",
    "Cache-Control": "no-store",
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

const server = createServer(async (req, res) => {
  const url = new URL(req.url || "/", "http://localhost");
  if (req.method === "OPTIONS") {
    send(res, 204, "");
    return;
  }

  if (url.pathname === "/" && req.method === "GET") {
    send(
      res,
      200,
      "<!doctype html><title>Cadence</title><body style=\"font-family:sans-serif\"><h1>Cadence server</h1><p>The list API is running.</p></body>",
      "text/html; charset=utf-8",
    );
    return;
  }

  if (url.pathname === "/health" && req.method === "GET") {
    if (!authorized(req)) {
      send(res, TOKEN ? 401 : 503, JSON.stringify({ error: TOKEN ? "Unauthorized" : "Set CADENCE_TOKEN" }));
      return;
    }
    send(res, 200, JSON.stringify({ ok: true, name: "cadence" }));
    return;
  }

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

  send(res, 404, JSON.stringify({ error: "Not found" }));
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Cadence server listening on ${PORT}`);
});
