# Toduck for Home Assistant

A Home Assistant custom integration for a self-hosted
[Toduck](../../README.md) server. It works in **both directions**:

- **Toduck inside Home Assistant** — your toducks appear as a native
  Home Assistant todo list (usable in the todo dashboard card) plus
  open/overdue count sensors. Adding, checking off, editing, and deleting
  items in Home Assistant writes back to Toduck.
- **Home Assistant creates and completes toducks** — automations can add
  items to the todo entity, complete them, or call the server's REST task
  API directly with `rest_command` (see the examples below).

This is an **in-repo custom integration**: it is not in the HACS default
repository and not in Home Assistant core. Install it by copying files,
as below.

## Requirements

- A running Toduck self-host server (see
  [selfhost/README.md](../../selfhost/README.md)) with the REST task API
  (`/v1/tasks`) — that is, a build with Stage 3 of issue #22 or later.
- A token for that server. **Recommended:** a dedicated registered user
  for Home Assistant — ask the server admin to create one (Web UI
  Settings → Users, or `POST /v1/users`) and use that user's personal
  token here. The integration then sees exactly that user's toducks plus
  any shared with them, and toducks it creates are owned by that user.
  The admin token (`CADENCE_TOKEN`) also works and sees everything.

## Install

1. Copy the integration into your Home Assistant configuration:

   ```sh
   cp -r custom_components/toduck <ha-config>/custom_components/
   ```

   (from this directory — `integrations/home-assistant/` in the repo.)

2. Restart Home Assistant.
3. **Settings → Devices & services → Add integration → Toduck.**
4. Enter the server URL (e.g. `http://192.168.1.20:8793`) and the token.
   The integration validates both by calling `GET /v1/tasks` before
   creating the entry.

The icon ships at `custom_components/toduck/brand/icon.png` (the
current in-integration brand location).

## What you get

| Entity | What it is |
| --- | --- |
| `todo.toduck` | The token's visible toducks: open ones as incomplete items, done ones as completed. Item uid = task id, summary = title, due = the task's date. Creating, updating (rename / check off / set due date), and deleting items map to `POST` / `PATCH` / `DELETE /v1/tasks`. |
| `sensor.toduck_open_toducks` | Count of open toducks. |
| `sensor.toduck_overdue_toducks` | Count of open toducks whose date has passed. |

The integration polls the server every minute by default.

## Example automations

### 1. Home Assistant files a toduck

When the printer finishes, add a toduck — via the todo entity:

```yaml
automation:
  - alias: "Toduck: restock filament reminder"
    triggers:
      - trigger: state
        entity_id: sensor.printer_job_state
        to: "complete"
    actions:
      - action: todo.add_item
        target:
          entity_id: todo.toduck
        data:
          item: "Check the filament stock"
          due_date: "{{ (now() + timedelta(days=1)).date() }}"
```

…or via the REST API directly with a `rest_command`:

```yaml
rest_command:
  toduck_add:
    url: "http://192.168.1.20:8793/v1/tasks"
    method: POST
    headers:
      authorization: "Bearer <personal-token>"
      content-type: "application/json"
    payload: '{"title": "{{ title }}"}'

automation:
  - alias: "Toduck: bin night"
    triggers:
      - trigger: time
        at: "19:00:00"
    conditions:
      - condition: time
        weekday: [tue]
    actions:
      - action: rest_command.toduck_add
        data:
          title: "Put the bins out"
```

Completing a toduck from an automation is
`todo.update_item` with `status: completed` on `todo.toduck`.

### 2. A morning nudge from the overdue sensor

```yaml
automation:
  - alias: "Toduck: morning overdue nudge"
    triggers:
      - trigger: time
        at: "07:30:00"
    conditions:
      - condition: numeric_state
        entity_id: sensor.toduck_overdue_toducks
        above: 0
    actions:
      - action: notify.mobile_app_phone
        data:
          title: "Toduck"
          message: >
            {{ states('sensor.toduck_overdue_toducks') }} overdue
            toduck(s), {{ states('sensor.toduck_open_toducks') }} open
            in total.
```

## Development

The API client (`custom_components/toduck/api.py`) and the mapping
helpers (`mappings.py`) have no Home Assistant imports and are unit
tested without Home Assistant installed:

```sh
python3 -m unittest discover -s integrations/home-assistant/tests -v
# or, where pytest is available:
python3 -m pytest integrations/home-assistant/tests -q
```
