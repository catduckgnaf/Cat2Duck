# Cat2Duck Self-Hosted Server & Web UI

Unified container serving the Cat2Duck (Cadence) Web UI and sync API for cross-device synchronization with the Web and Android apps.

## Features
- **Unified Origin**: Serves the compiled Web UI frontend and `/v1/state` sync API from a single container.
- **Persistent Storage**: Stores tasks, categories, and settings in `/data/state.json`.
- **Lightweight & Secure**: Runs unprivileged as `node` user in `node:22-alpine` with healthcheck probes.

## Local Docker Run

Set a secure private token and start the container:

```sh
CADENCE_TOKEN="choose-a-strong-token" docker compose up -d --build
```

The Web UI and API are accessible at:
- Web App: `http://localhost:8793/`
- Healthcheck: `GET http://localhost:8793/health`
- Sync State: `GET /v1/state` / `PUT /v1/state` (with `Authorization: Bearer <CADENCE_TOKEN>`)

*(Note: Host port 8793 is used by default to prevent port conflicts with Readarr on port 8787).*

## Unraid Deployment

1. On Uranium (Unraid), create persistent appdata directory:
   ```sh
   mkdir -p /mnt/user/appdata/cat2duck
   ```
2. Copy `selfhost/unraid-template.xml` to `/boot/config/plugins/dockerMan/templates-user/my-cat2duck.xml` or use the Docker Add Container GUI:
   - **Container Port**: `8787` mapped to Host Port `8793`
   - **Host Path**: `/mnt/user/appdata/cat2duck` mapped to Container Path `/data`
   - **CADENCE_TOKEN**: Set to your generated secret token
3. Verify the container starts and passes healthchecks at `http://192.168.250.135:8793/health`.

## Backup & Recovery

- **Backup**: Copy or snapshot `/mnt/user/appdata/cat2duck/state.json`.
- **Restore**: Stop container, place snapshot into `/mnt/user/appdata/cat2duck/state.json`, and restart container.

