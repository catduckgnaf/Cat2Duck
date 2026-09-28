# Cat2Duck self hosting

The Cat2Duck container serves the compiled Web UI and the `/v1/state` synchronization API from one origin.

## Security model

* `CADENCE_TOKEN` is required and must contain at least 32 characters. Startup fails without it.
* API clients send `Authorization: Bearer <token>`.
* The browser stores the server address, but keeps the token only in the current in memory session. Disconnecting clears it without deleting local tasks.
* Cross origin API calls are rejected unless their origin appears in `CADENCE_ALLOWED_ORIGINS`.
* The container runs as the unprivileged `node` user and exposes a public `/health` endpoint.
* State updates require the current ETag in `If-Match`. Stale writers receive `409 Conflict` and clients pull, merge, and retry.

Use TLS when exposing Cat2Duck beyond a trusted private network.

## Docker Compose

Generate a secret and start the service:

```sh
export CADENCE_TOKEN="$(openssl rand -hex 32)"
docker compose -f selfhost/docker-compose.yml up --build -d
```

Open `http://localhost:8793`. By default Compose publishes container port `8787` on every host interface at port `8793`.

Optional settings:

```sh
export CAT2DUCK_BIND="192.168.1.20"
export CAT2DUCK_PORT="8793"
export CADENCE_ALLOWED_ORIGINS="https://tasks.example.com,https://mobile.example.com"
```

A `.env` file beside the Compose command may hold these values. Do not commit it.

## API

**Health:** `GET /health` returns `200` without authentication.

**Read state:**

```sh
curl -i \
  -H "Authorization: Bearer $CADENCE_TOKEN" \
  http://localhost:8793/v1/state
```

The response includes an `ETag`, such as `"7"`.

**Update state:**

```sh
curl -i -X PUT \
  -H "Authorization: Bearer $CADENCE_TOKEN" \
  -H 'If-Match: "7"' \
  -H "Content-Type: application/json" \
  --data '{"tasks":[],"categories":[]}' \
  http://localhost:8793/v1/state
```

A missing revision returns `428 Precondition Required`. A stale revision returns `409 Conflict`.

## Data and recovery

The container stores state at `/data/state.json` and retains `/data/state.json.bak` as the last known good copy. Writes use a temporary file followed by an atomic rename. On startup, an invalid primary file is restored from the backup when possible.

Back up the entire mounted `/data` directory. To restore manually, stop the container, replace `state.json`, preserve valid JSON with `tasks` and `categories` arrays, then restart.

## Unraid

1. Create `/mnt/user/appdata/cat2duck`.
2. Import `selfhost/unraid-template.xml` or add the container manually.
3. Map host port `8793` to container port `8787`.
4. Map `/mnt/user/appdata/cat2duck` to `/data`.
5. Set `CADENCE_TOKEN` to a unique secret of at least 32 characters.
6. Open `http://<unraid-lan-ip>:8793/health` and confirm a `200` response.

The included template uses `192.168.250.135:8793` in its Web UI link because that is the repository owner's current Unraid address. Change it for other networks.

## Build without Compose

```sh
docker build -f selfhost/Dockerfile -t cat2duck:local .
docker run --rm \
  -p 8793:8787 \
  -e CADENCE_TOKEN="$CADENCE_TOKEN" \
  -v cat2duck-data:/data \
  cat2duck:local
```

