# Cadence server

A small API for the Cadence web app and the Android app. Tasks, notes, and categories are stored in one JSON file.

## Run

From this folder, set a private token and start the server:

```sh
CADENCE_TOKEN=choose-a-long-secret docker compose up -d --build
```

The API listens on port 8787. In Cadence settings, and in the Android app, use:

- Address: `http://YOUR_SERVER:8787` (the machine running Docker)
- Token: the same secret

Change `change-me` before anyone else can reach the port. The token is the only lock, and the browser is allowed to call the API from any site that has it.

## API

- `GET /health`
- `GET /v1/state`
- `PUT /v1/state` with `{ "tasks": [], "categories": [] }`

Send `Authorization: Bearer YOUR_TOKEN` on every request.
