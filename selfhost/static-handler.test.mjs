import test from "node:test";
import assert from "node:assert/strict";
import { resolveStaticPath, contentTypeFor } from "./static-handler.mjs";

test("contentTypeFor returns proper MIME types", () => {
  assert.equal(contentTypeFor("index.html"), "text/html; charset=utf-8");
  assert.equal(contentTypeFor("bundle.js"), "application/javascript; charset=utf-8");
  assert.equal(contentTypeFor("bundle.mjs"), "application/javascript; charset=utf-8");
  assert.equal(contentTypeFor("styles.css"), "text/css; charset=utf-8");
  assert.equal(contentTypeFor("logo.svg"), "image/svg+xml");
  assert.equal(contentTypeFor("image.png"), "image/png");
  assert.equal(contentTypeFor("icon.ico"), "image/x-icon");
  assert.equal(contentTypeFor("data.json"), "application/json; charset=utf-8");
  assert.equal(contentTypeFor("unknown.bin"), "application/octet-stream");
});

test("resolveStaticPath prevents directory traversal", () => {
  const root = "/app/static";
  assert.equal(resolveStaticPath(root, "/index.html"), "/app/static/index.html");
  assert.equal(resolveStaticPath(root, "/assets/app.js"), "/app/static/assets/app.js");
  assert.equal(resolveStaticPath(root, "/../secret.txt"), null);
  assert.equal(resolveStaticPath(root, "/../../etc/passwd"), null);
  assert.equal(resolveStaticPath(root, "/sub/../../secret.txt"), null);
});
