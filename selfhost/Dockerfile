# Multi-stage build to compile Web UI and package standalone server
FROM node:22-alpine AS builder

WORKDIR /app
COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build

# Generate static HTML entrypoint
RUN node -e ' \
  const { spawn } = require("node:child_process"); \
  const { writeFileSync } = require("node:fs"); \
  const preview = spawn("node", ["./node_modules/vite/bin/vite.js", "preview", "--port", "8099", "--host", "127.0.0.1"], { stdio: "ignore" }); \
  setTimeout(async () => { \
    try { \
      const res = await fetch("http://127.0.0.1:8099/"); \
      const html = await res.text(); \
      writeFileSync("/app/.vercel/output/static/index.html", html); \
    } finally { \
      preview.kill(); \
      process.exit(0); \
    } \
  }, 3000);'

# Production runtime image
FROM node:22-alpine AS runner

WORKDIR /app

# Run as non-root node user for security
RUN mkdir -p /data /app/static && chown -R node:node /data /app

COPY selfhost/server.mjs selfhost/static-handler.mjs ./
COPY --from=builder /app/.vercel/output/static /app/static

USER node

ENV PORT=8787
ENV DATA_PATH=/data/state.json
ENV STATIC_DIR=/app/static

VOLUME /data
EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e 'require("node:http").get("http://localhost:8787/health", (res) => { process.exit(res.statusCode === 200 || res.statusCode === 401 ? 0 : 1); }).on("error", () => process.exit(1));'

CMD ["node", "server.mjs"]
