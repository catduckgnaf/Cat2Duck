# Toduck — project guide

Toduck is a local-first task manager (formerly Cat2Duck) with a
responsive Web UI, repeating tasks, categories, search, import/export,
optional self-hosted sync, and an Android companion app.

## Layout

- `src/components/toduck` — task manager UI
- `src/lib/toduck` — task model, state, persistence, and sync client
- `selfhost` — standalone sync server (Go runtime; the Node implementation is
  the behavioral reference), Docker image, Compose file, and Unraid template
- `android` — Android client and home-screen widget
- `e2e` — Playwright browser tests

## Development

Requirements: Node.js 22 or newer and npm.

```sh
npm ci
npm run dev        # http://localhost:8080
```

Quality checks (all run in CI via `.github/workflows/quality.yml`):

```sh
npm test
npm run lint
npm run typecheck
npm run build
npm run test:e2e
cd selfhost/go && go test ./...
```

## Conventions

- Start Vite only through the npm scripts. They route through
  `scripts/with-app-env.mjs`, which merges `app-env.json` (repo root) into
  the environment; that file ships `VITE_AUTH_ENABLED=false`, and a real
  environment variable always wins over it.
- Tasks stay in browser storage unless sync is configured. The sync token
  (`TODUCK_TOKEN`, at least 32 characters) is kept only in the browser
  session — never commit it. See `selfhost/README.md` for the sync API,
  Docker, and Unraid details.
- Preview/runtime scratch files live under `.preview/` (gitignored). The
  production build output lands in `.vercel/output/` (also gitignored) —
  never commit either.
