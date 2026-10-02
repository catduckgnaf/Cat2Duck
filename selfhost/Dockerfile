# Multi-stage build to compile Web UI and package standalone server
FROM node:22-alpine AS builder

WORKDIR /app
COPY package*.json ./
RUN npm ci

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
FROM golang:1.22-alpine AS go-builder
WORKDIR /src
COPY selfhost/go/go.mod selfhost/go/*.go ./
RUN CGO_ENABLED=0 go build -o /cat2duck-server .

FROM node:22-alpine AS runner

WORKDIR /app

RUN adduser -D -u 1000 cadence && mkdir -p /data /app/static && chown -R cadence:cadence /data /app

COPY --from=go-builder /cat2duck-server /app/cat2duck-server
COPY --from=builder /app/.vercel/output/static /app/static

USER cadence

ENV PORT=8787
ENV DATA_PATH=/data/state.json
ENV STATIC_DIR=/app/static

VOLUME /data
EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD /app/cat2duck-server --healthcheck http://127.0.0.1:8787/health

CMD ["/app/cat2duck-server"]
