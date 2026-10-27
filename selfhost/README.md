# Cat2Duck self hosting

The Cat2Duck container serves the compiled Web UI and the `/v1/state` synchronization API from one origin.

## Prebuilt image

CI publishes the container to the GitHub Container Registry on every push to
`main` (tag `latest` plus the short commit SHA) and on every `v*` release tag
(tagged with the version), for both `linux/amd64` and `linux/arm64`:

```sh
docker pull ghcr.io/catduckgnaf/cat2duck:latest
```

With Compose, `docker compose -f selfhost/docker-compose.yml pull` fetches
that image instead of building; `up --build` still builds locally. On Unraid,
the image name `ghcr.io/catduckgnaf/cat2duck:latest` can be used directly as
the repository. If a pull is denied right after the first publish, open the
package settings on GitHub and make the package public (or link it to this
repository) — first-time GHCR packages are not always public by default.

## Security model

* `CADENCE_TOKEN` is required and must contain at least 32 characters. Startup fails without it.
* API clients send `Authorization: Bearer <token>`.
* The browser stores the server address, but keeps the token only in the current in memory session. Disconnecting clears it without deleting local tasks.
* Cross origin API calls are rejected unless their origin appears in `CADENCE_ALLOWED_ORIGINS`.
* The container runs as the unprivileged `cadence` user and exposes a public `/health` endpoint.
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

## Users and sharing

A server can host several registered users alongside the admin:

* `CADENCE_TOKEN` stays the **admin** credential. It keeps whole-state
  `GET`/`PUT /v1/state` semantics exactly as before, so existing Web and
  Android clients keep working unchanged. Accounts are admin-created —
  there is no open self-registration.
* **Create a user (admin only):** `POST /v1/users` with `{"name": "…"}` →
  `201 {"id", "name", "token"}`. The personal token is returned **once**;
  the server stores only its SHA-256 hash in the state file. In the Web
  UI, connect with the admin token and use the Users panel in Settings.
* **Directory (any authenticated token):** `GET /v1/users` → `[{id, name}]`.
* **Who am I:** `GET /v1/me` → `{"kind": "admin"}` or `{"kind": "user", "id", "name"}`.
* **Delete a user (admin only):** `DELETE /v1/users/:id` revokes their
  access and removes them from every task's sharing list.

Each task carries `ownerId` (a user id, or `null` for legacy tasks not
owned by any user) and `sharedWith` (user ids). With a **personal token**:

* `GET /v1/state` returns categories, projects, and only the tasks the
  user owns or that are shared with them. Unowned legacy tasks belong to
  the admin and are **not** visible to personal tokens.
* `PUT /v1/state` merges scoped to that user: new tasks are stamped with
  the user as owner, tasks they cannot see are preserved exactly, their
  own omitted tasks are deleted, and shared tasks stay editable by them —
  but a shared user cannot delete the owner's task, change its owner, or
  change who it is shared with (only the owner or the admin can share and
  unshare).

Users connect from the Web UI with the server address and their personal
token, exactly like the admin flow. Per-user sign-in in the Android app is
not included; Android keeps using the admin token.

## Data and recovery

The container stores state at `/data/state.json` and retains `/data/state.json.bak` as the last known good copy. Writes use a temporary file followed by an atomic rename. On startup, an invalid primary file is restored from the backup when possible. The runtime server is a Go binary; the Node implementation remains in this directory as the behavioral reference and its tests remain part of `npm test`.

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

