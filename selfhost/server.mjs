import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { contentTypeFor, resolveStaticPath } from "./static-handler.mjs";

const DEFAULT_MAX_BODY = 1_500_000;
// 'unsafe-inline' in script-src is required: the built Web UI's index.html
// carries first-party inline bootstrap scripts (TanStack Start hydration).
// Without it the served app renders blank. All scripts are own build output.
const SECURITY_HEADERS = {
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self' 'unsafe-inline' https://grok.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'self' https://grok.com",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
};

export function validateToken(raw) {
  const token = String(raw || "");
  if (!token || token === "change-me") throw new Error("TODUCK_TOKEN must be explicitly configured.");
  if (Buffer.byteLength(token) < 32) throw new Error("TODUCK_TOKEN must be at least 32 characters long.");
  return token;
}

function emptyState() {
  return { revision: 0, tasks: [], categories: [], projects: [], users: [] };
}

function isUserRecord(value) {
  return (
    !!value &&
    typeof value === "object" &&
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    typeof value.tokenHash === "string"
  );
}

function normalizeState(value) {
  if (!value || typeof value !== "object") throw new Error("State must be an object.");
  if (!Array.isArray(value.tasks) || !Array.isArray(value.categories)) throw new Error("State must include tasks and categories arrays.");
  // Projects are optional: state files and clients from before projects
  // existed have no projects array, which reads as an empty one.
  if (value.projects !== undefined && !Array.isArray(value.projects)) throw new Error("State projects must be an array when present.");
  // Users are optional for the same reason: older state files have none.
  if (value.users !== undefined && (!Array.isArray(value.users) || !value.users.every(isUserRecord))) {
    throw new Error("State users must be an array of user records when present.");
  }
  return {
    revision: Number.isSafeInteger(value.revision) && value.revision >= 0 ? value.revision : 0,
    tasks: value.tasks,
    categories: value.categories,
    projects: value.projects ?? [],
    users: value.users ?? [],
  };
}

export function hashToken(token) {
  return createHash("sha256").update(String(token)).digest("hex");
}

/** Names and ids only — never token hashes. */
function publicUsers(state) {
  return state.users.map((user) => ({ id: user.id, name: user.name }));
}

function taskOwnerId(task) {
  return typeof task?.ownerId === "string" ? task.ownerId : null;
}

function taskSharedWith(task) {
  return Array.isArray(task?.sharedWith) ? task.sharedWith.filter((id) => typeof id === "string") : [];
}

function visibleToUser(task, userId) {
  return taskOwnerId(task) === userId || taskSharedWith(task).includes(userId);
}

/** Keep only ids of registered users, de-duplicated. */
function sanitizeSharedWith(value, state) {
  const known = new Set(state.users.map((user) => user.id));
  return [...new Set(taskSharedWith({ sharedWith: value }))].filter((id) => known.has(id));
}

/**
 * Merge a user token's PUT into the stored state. The requester only ever
 * sees tasks they own or that are shared with them, so:
 * - tasks they cannot see are preserved exactly as stored;
 * - a task they own that is missing from the payload is deleted;
 * - a shared task missing from the payload is left untouched (only the
 *   owner can delete it);
 * - ownerId is stamped from the stored task (or the requester for new
 *   tasks) — a client can never forge or move ownership;
 * - sharedWith changes only for tasks the requester owns.
 */
function mergeUserState(state, parsed, userId) {
  const incomingById = new Map();
  for (const task of parsed.tasks) {
    if (task && typeof task.id === "string" && !incomingById.has(task.id)) incomingById.set(task.id, task);
  }
  const storedIds = new Set(state.tasks.map((task) => task?.id));
  const handled = new Set();
  const tasks = [];
  for (const stored of state.tasks) {
    const incoming = incomingById.get(stored?.id);
    if (!visibleToUser(stored, userId)) {
      if (incoming) handled.add(stored.id);
      tasks.push(stored);
      continue;
    }
    if (!incoming) {
      // Own task omitted from the payload: deleted. Shared task omitted:
      // not the requester's to delete, keep it.
      if (taskOwnerId(stored) !== userId) tasks.push(stored);
      continue;
    }
    handled.add(stored.id);
    const isOwner = taskOwnerId(stored) === userId;
    // A shared user cannot delete the owner's task: a tombstone from them
    // is ignored (the Web client deletes by tombstone, not by omission).
    if (!isOwner && incoming.deleted && !stored.deleted) {
      tasks.push(stored);
      continue;
    }
    tasks.push({
      ...incoming,
      ownerId: taskOwnerId(stored),
      sharedWith: isOwner
        ? incoming.sharedWith === undefined
          ? taskSharedWith(stored)
          : sanitizeSharedWith(incoming.sharedWith, state)
        : taskSharedWith(stored),
    });
  }
  for (const incoming of parsed.tasks) {
    if (!incoming || typeof incoming.id !== "string" || handled.has(incoming.id) || storedIds.has(incoming.id)) continue;
    handled.add(incoming.id);
    tasks.push({ ...incoming, ownerId: userId, sharedWith: sanitizeSharedWith(incoming.sharedWith, state) });
  }
  return {
    revision: state.revision + 1,
    tasks,
    categories: parsed.categories,
    projects: parsed.projects ?? state.projects,
    users: state.users,
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

function bearerToken(authorization) {
  return String(authorization || "").replace(/^Bearer\s+/i, "");
}

/**
 * Resolve a request's credential: the TODUCK_TOKEN is the admin (full,
 * legacy access); a registered user's personal token scopes state access
 * to that user. Returns null when neither matches.
 */
function authenticate(state, configuredToken, authorization) {
  if (tokenMatches(configuredToken, authorization)) return { kind: "admin" };
  const suppliedHash = hashToken(bearerToken(authorization));
  const suppliedDigest = Buffer.from(suppliedHash, "utf8");
  for (const user of state.users) {
    const storedDigest = Buffer.from(user.tokenHash, "utf8");
    if (storedDigest.length === suppliedDigest.length && timingSafeEqual(storedDigest, suppliedDigest)) {
      return { kind: "user", user };
    }
  }
  return null;
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

export function createToduckServer({ token, dataPath = "/data/state.json", staticDir = "/app/static", maxBody = DEFAULT_MAX_BODY, allowedOrigins = [] } = {}) {
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

  /** Serialize a users mutation through the same write queue as state PUTs. */
  function mutateUsers(mutator) {
    const nextPromise = writing.catch(() => {}).then(async () => {
      const result = mutator(state);
      if (result === undefined) return undefined;
      await persistState(dataPath, result.nextState);
      state = result.nextState;
      return result.value;
    });
    writing = nextPromise.catch(() => {});
    return nextPromise;
  }

  return createServer(async (req, res) => {
    const url = new URL(req.url || "/", "http://localhost");

    if ((url.pathname === "/v1/users" || url.pathname.startsWith("/v1/users/") || url.pathname === "/v1/me") && req.method === "OPTIONS") {
      if (!originAllowed(req)) {
        send(res, 403, JSON.stringify({ error: "Origin not allowed" }));
        return;
      }
      send(res, 204, "", "text/plain", { ...corsHeaders(req), "Access-Control-Allow-Headers": "Authorization, Content-Type", "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS" });
      return;
    }

    if (url.pathname === "/v1/me" && req.method === "GET") {
      if (!originAllowed(req)) {
        send(res, 403, JSON.stringify({ error: "Origin not allowed" }));
        return;
      }
      const headers = corsHeaders(req);
      const auth = authenticate(state, configuredToken, req.headers.authorization);
      if (!auth) {
        send(res, 401, JSON.stringify({ error: "Unauthorized" }), undefined, headers);
        return;
      }
      send(res, 200, JSON.stringify(auth.kind === "admin" ? { kind: "admin" } : { kind: "user", id: auth.user.id, name: auth.user.name }), undefined, headers);
      return;
    }

    if (url.pathname === "/v1/users" && req.method === "GET") {
      if (!originAllowed(req)) {
        send(res, 403, JSON.stringify({ error: "Origin not allowed" }));
        return;
      }
      const headers = corsHeaders(req);
      const auth = authenticate(state, configuredToken, req.headers.authorization);
      if (!auth) {
        send(res, 401, JSON.stringify({ error: "Unauthorized" }), undefined, headers);
        return;
      }
      send(res, 200, JSON.stringify(publicUsers(state)), undefined, headers);
      return;
    }

    if (url.pathname === "/v1/users" && req.method === "POST") {
      if (!originAllowed(req)) {
        send(res, 403, JSON.stringify({ error: "Origin not allowed" }));
        return;
      }
      const headers = corsHeaders(req);
      const auth = authenticate(state, configuredToken, req.headers.authorization);
      if (!auth) {
        send(res, 401, JSON.stringify({ error: "Unauthorized" }), undefined, headers);
        return;
      }
      if (auth.kind !== "admin") {
        send(res, 403, JSON.stringify({ error: "Only the admin can create users" }), undefined, headers);
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
      let name = "";
      try {
        name = String(JSON.parse(rawBody)?.name ?? "").trim().slice(0, 80);
      } catch {
        send(res, 400, JSON.stringify({ error: "Invalid JSON" }), undefined, headers);
        return;
      }
      if (!name) {
        send(res, 400, JSON.stringify({ error: "A user name is required" }), undefined, headers);
        return;
      }
      // The raw personal token is returned once, here; only its SHA-256
      // hash is ever stored.
      const personalToken = randomBytes(32).toString("base64url");
      const record = { id: randomUUID(), name, tokenHash: hashToken(personalToken) };
      try {
        await mutateUsers((current) => ({ nextState: { ...current, users: [...current.users, record] }, value: record }));
      } catch {
        send(res, 500, JSON.stringify({ error: "Failed to persist state" }), undefined, headers);
        return;
      }
      send(res, 201, JSON.stringify({ id: record.id, name: record.name, token: personalToken }), undefined, headers);
      return;
    }

    const userDeleteMatch = /^\/v1\/users\/([^/]+)$/.exec(url.pathname);
    if (userDeleteMatch && req.method === "DELETE") {
      if (!originAllowed(req)) {
        send(res, 403, JSON.stringify({ error: "Origin not allowed" }));
        return;
      }
      const headers = corsHeaders(req);
      const auth = authenticate(state, configuredToken, req.headers.authorization);
      if (!auth) {
        send(res, 401, JSON.stringify({ error: "Unauthorized" }), undefined, headers);
        return;
      }
      if (auth.kind !== "admin") {
        send(res, 403, JSON.stringify({ error: "Only the admin can delete users" }), undefined, headers);
        return;
      }
      const targetId = decodeURIComponent(userDeleteMatch[1]);
      try {
        const removed = await mutateUsers((current) => {
          if (!current.users.some((user) => user.id === targetId)) return undefined;
          return {
            nextState: {
              ...current,
              users: current.users.filter((user) => user.id !== targetId),
              // Revoking a user also unshares everything shared with them.
              tasks: current.tasks.map((task) =>
                taskSharedWith(task).includes(targetId)
                  ? { ...task, sharedWith: taskSharedWith(task).filter((id) => id !== targetId) }
                  : task,
              ),
            },
            value: true,
          };
        });
        if (!removed) {
          send(res, 404, JSON.stringify({ error: "User not found" }), undefined, headers);
          return;
        }
      } catch {
        send(res, 500, JSON.stringify({ error: "Failed to persist state" }), undefined, headers);
        return;
      }
      send(res, 200, JSON.stringify({ ok: true }), undefined, headers);
      return;
    }

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
      send(res, 200, JSON.stringify({ ok: true, name: "toduck" }), undefined, corsHeaders(req));
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
      const auth = authenticate(state, configuredToken, req.headers.authorization);
      if (!auth) {
        send(res, 401, JSON.stringify({ error: "Unauthorized" }), undefined, headers);
        return;
      }
      if (req.method === "GET") {
        // A personal token sees categories, projects, and only the tasks
        // they own or that are shared with them. Unowned legacy tasks are
        // the admin's and are not visible to user tokens.
        const tasks = auth.kind === "admin" ? state.tasks : state.tasks.filter((task) => visibleToUser(task, auth.user.id));
        send(res, 200, JSON.stringify({ tasks, categories: state.categories, projects: state.projects }), undefined, { ...headers, ETag: etag(state.revision) });
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
      if (parsed.projects !== undefined && !Array.isArray(parsed.projects)) {
        send(res, 400, JSON.stringify({ error: "Expected projects to be an array when present" }), undefined, headers);
        return;
      }
      if (parsed.tasks.length > 5000 || parsed.categories.length > 200 || (parsed.projects?.length ?? 0) > 200) {
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
        // A client that predates projects (e.g. the Android app) omits the
        // array; keep the stored projects instead of wiping them.
        // The admin token keeps whole-state semantics; a personal token's
        // payload is merged in scoped to that user (see mergeUserState).
        const nextState =
          auth.kind === "admin"
            ? {
                revision: state.revision + 1,
                tasks: parsed.tasks,
                categories: parsed.categories,
                projects: parsed.projects ?? state.projects,
                users: state.users,
              }
            : mergeUserState(state, parsed, auth.user.id);
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
  const allowedOrigins = String(process.env.TODUCK_ALLOWED_ORIGINS || "").split(",").map((origin) => origin.trim()).filter(Boolean);
  const server = createToduckServer({ token: process.env.TODUCK_TOKEN, dataPath: process.env.DATA_PATH || "/data/state.json", staticDir: process.env.STATIC_DIR || "/app/static", allowedOrigins });
  const port = Number(process.env.PORT || 8787);
  server.listen(port, "0.0.0.0", () => console.log(`Toduck server listening on ${port}`));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    runFromEnvironment();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
