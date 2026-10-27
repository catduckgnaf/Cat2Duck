# Toduck

Toduck is a local first task manager with a responsive Web UI, repeating tasks, categories, search, import and export, optional self hosted synchronization, and an Android companion app.

> **Renamed from Cat2Duck.** The GitHub repository, the app brand, and the container image were renamed to Toduck in October 2026, and the old internal name (Cadence) was retired with it — including the Android app id, the server environment variables, and the browser storage keys. The old repository URL redirects here, and the old image `ghcr.io/catduckgnaf/cat2duck` is superseded by `ghcr.io/catduckgnaf/toduck`. Existing installs need a few one-time steps: Web browser data migrates automatically on first load, and old `cadence.json` exports still import (new exports are `toduck.json`); server installs must rename their environment variables (see the upgrade note in the self hosting guide); and the Android app is a **new app identity** — uninstall the old app and install Toduck fresh (see the Android guide).

## Features

* Local first task storage in the browser
* Feed, day, upcoming, overdue, later, repeats, and completed views
* Repeating schedules and category filters
* JSON backup and restore
* Optional conflict safe synchronization through the bundled Node server
* Docker and Unraid packaging
* Android client and home screen widget

## Development

Requirements: Node.js 22 or newer and npm.

```sh
npm ci
npm run dev
```

The development app listens on `http://localhost:8080`.

## Quality checks

```sh
npm test
npm run lint
npm run typecheck
npm run build
npm run test:e2e
```

Playwright browser tests exercise the core task flow at desktop and 390 by 844 mobile viewports.

## Self hosting

The bundled container serves both the compiled Web UI and synchronization API from one origin.

```sh
export TODUCK_TOKEN="$(openssl rand -hex 32)"
docker compose -f selfhost/docker-compose.yml up --build -d
```

Open `http://localhost:8793`. The host address and port can be changed with `TODUCK_BIND` and `TODUCK_PORT`.

A prebuilt image is published to `ghcr.io/catduckgnaf/toduck` (amd64 and arm64); `docker compose -f selfhost/docker-compose.yml pull` uses it instead of building locally.

See [the self hosting guide](selfhost/README.md) for authentication, CORS, backups, API behavior, Docker, and Unraid instructions.

## Android

See [the Android guide](android/README.md) for build and connection instructions.

## Repository layout

* `src/components/toduck`: task manager UI
* `src/lib/toduck`: task model, state, persistence, and sync client
* `selfhost`: standalone server, Docker image, Compose file, and Unraid template
* `android`: Android client
* `e2e`: Playwright browser tests

## Data and security

Tasks remain in browser storage unless synchronization is configured. The server address may be remembered, but the bearer token is kept only in the current browser session and is cleared when disconnected. Use a unique token of at least 32 characters and put TLS or a trusted private network in front of any remote deployment.

## License

Toduck is open source software licensed under the [MIT License](LICENSE).
