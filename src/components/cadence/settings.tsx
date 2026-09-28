import { useState } from "react";
import { Trash2 } from "lucide-react";
import { Button, Modal, SectionLabel } from "@/components/cadence/ui";
import { activeCategories } from "@/lib/cadence/model";
import { useCadence } from "@/lib/cadence/store";
import { checkServer, normalizeServerUrl, readDoc } from "@/lib/cadence/sync";
import { syncNow } from "@/lib/cadence/store";

export function CategoriesDialog({ onClose }: { onClose: () => void }) {
  const categories = useCadence((s) => s.categories);
  const addCategory = useCadence((s) => s.addCategory);
  const renameCategory = useCadence((s) => s.renameCategory);
  const deleteCategory = useCadence((s) => s.deleteCategory);
  const [draft, setDraft] = useState("");
  const items = activeCategories(categories);

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title="Categories"
      description="A task sits in one category. Filter the list with the chips under search."
    >
      <ul className="space-y-2">
        {items.map((category) => (
          <CategoryRow
            key={category.id}
            name={category.name}
            onRename={(name) => renameCategory(category.id, name)}
            onDelete={() => deleteCategory(category.id)}
          />
        ))}
      </ul>
      {items.length === 0 ? <p className="text-sm text-muted">No categories yet.</p> : null}
      <form
        className="mt-4 flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (addCategory(draft)) setDraft("");
        }}
      >
        <input
          className="field"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="New category"
          aria-label="New category"
          maxLength={40}
        />
        <Button type="submit" variant="primary" disabled={!draft.trim()}>
          Add
        </Button>
      </form>
    </Modal>
  );
}

function CategoryRow({ name, onRename, onDelete }: { name: string; onRename: (name: string) => void; onDelete: () => void }) {
  const [value, setValue] = useState(name);
  return (
    <li className="flex items-center gap-2">
      <input
        className="field"
        value={value}
        aria-label={`Rename ${name}`}
        maxLength={40}
        onChange={(event) => setValue(event.target.value)}
        onBlur={() => onRename(value)}
      />
      <button
        type="button"
        className="grid size-11 shrink-0 place-items-center rounded-full text-danger"
        aria-label={`Delete ${name}`}
        onClick={onDelete}
      >
        <Trash2 className="size-4" />
      </button>
    </li>
  );
}

export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const serverUrl = useCadence((s) => s.serverUrl);
  const serverToken = useCadence((s) => s.serverToken);
  const syncStatus = useCadence((s) => s.syncStatus);
  const syncError = useCadence((s) => s.syncError);
  const lastSyncedAt = useCadence((s) => s.lastSyncedAt);
  const setServer = useCadence((s) => s.setServer);
  const importDoc = useCadence((s) => s.importDoc);
  const resetSamples = useCadence((s) => s.resetSamples);
  const clearDone = useCadence((s) => s.clearDone);
  const tasks = useCadence((s) => s.tasks);
  const categories = useCadence((s) => s.categories);
  const [url, setUrl] = useState(serverUrl);
  const [token, setToken] = useState(serverToken);
  const [message, setMessage] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);

  async function saveServer() {
    const next = normalizeServerUrl(url);
    if (next === null) {
      setMessage("Enter a full address, including http or https.");
      return;
    }
    setServer(next, token.trim());
    setUrl(next);
    if (!next || !token.trim()) {
      setMessage("Server cleared. Tasks stay on this device.");
      return;
    }
    setMessage("Checking the server…");
    try {
      await checkServer(next, token.trim());
      await syncNow();
      setMessage("Connected. Notes, categories, and tasks will stay in sync.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not reach the server.");
    }
  }

  function exportJson() {
    const blob = new Blob(
      [
        JSON.stringify(
          {
            tasks: tasks.filter((task) => !task.deleted),
            categories: categories.filter((category) => !category.deleted),
          },
          null,
          2,
        ),
      ],
      { type: "application/json" },
    );
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "cadence.json";
    link.click();
    URL.revokeObjectURL(link.href);
  }

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title="Settings"
      description="This device keeps your list. Connect a server when you want the Android app to share it."
    >
      <section>
        <SectionLabel>Your server</SectionLabel>
        <p className="mt-2 text-sm text-pretty text-muted">
          Optional. Leave this blank to keep everything here. The address is remembered, but the token is held only for
          this open browser session. External clients such as Android use the same server token separately.
        </p>
        <label className="mt-3 block text-sm font-medium" htmlFor="server-url">
          Address
        </label>
        <input
          id="server-url"
          className="field mt-1"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="https://tasks.example.com"
          autoComplete="off"
        />
        <label className="mt-3 block text-sm font-medium" htmlFor="server-token">
          Token
        </label>
        <input
          id="server-token"
          className="field mt-1"
          value={token}
          onChange={(event) => setToken(event.target.value)}
          placeholder="Secret from your server"
          type="password"
          autoComplete="off"
        />
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="primary" onClick={() => void saveServer()}>
            Save and sync
          </Button>
          <Button
            onClick={() => {
              setServer("", "");
              setUrl("");
              setToken("");
              setMessage("Disconnected. Local tasks were not changed.");
            }}
          >
            Disconnect
          </Button>
          <a className="inline-flex min-h-11 items-center rounded-full bg-paper-2 px-4 text-sm font-medium text-ink" href="/cadence-pack.zip" download>
            Download server and Android app
          </a>
        </div>
        <p className="mt-2 text-sm text-muted" role="status" aria-live="polite">
          {message ??
            (syncStatus === "ok"
              ? `Synced${lastSyncedAt ? ` ${new Date(lastSyncedAt).toLocaleString()}` : ""}.`
              : syncStatus === "syncing"
                ? "Syncing…"
                : syncStatus === "error"
                  ? `Sync failed: ${syncError ?? "Check the address, token, and server status."}`
                  : "Not connected.")}
        </p>
      </section>

      <section className="mt-6 border-t border-line pt-5">
        <SectionLabel>Backup</SectionLabel>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            onClick={exportJson}
          >
            Export
          </Button>
          <label className="inline-flex min-h-11 cursor-pointer items-center rounded-full bg-paper-2 px-4 text-sm font-medium">
            Import
            <input
              className="sr-only"
              type="file"
              accept="application/json"
              onChange={async (event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (!file) return;
                try {
                  const doc = readDoc(JSON.parse(await file.text()));
                  importDoc(doc);
                  setMessage("Imported.");
                } catch {
                  setMessage("That file could not be read.");
                }
              }}
            />
          </label>
        </div>
      </section>

      <section className="mt-6 border-t border-line pt-5">
        <div className="flex flex-wrap gap-2">
          <Button onClick={clearDone}>Clear finished</Button>
          <Button
            variant="danger"
            onClick={() => {
              if (!confirmReset) {
                setConfirmReset(true);
                return;
              }
              resetSamples();
              setConfirmReset(false);
            }}
          >
            {confirmReset ? "Replace list with samples" : "Restore samples"}
          </Button>
        </div>
      </section>
    </Modal>
  );
}
