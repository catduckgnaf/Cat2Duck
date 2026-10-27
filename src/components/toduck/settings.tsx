import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { Button, Modal, SectionLabel } from "@/components/toduck/ui";
import { activeCategories, activeProjects } from "@/lib/toduck/model";
import { useToduck } from "@/lib/toduck/store";
import {
  checkServer,
  createUser,
  deleteUser,
  fetchMe,
  listUsers,
  normalizeServerUrl,
  readDoc,
  type DirectoryUser,
} from "@/lib/toduck/sync";
import { syncNow } from "@/lib/toduck/store";

/**
 * Admin-only panel: registered users on the connected server. Rendered
 * only when the saved connection token turns out to be the admin token —
 * a personal token never sees it.
 */
export function UsersPanel({ url, token }: { url: string; token: string }) {
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [users, setUsers] = useState<DirectoryUser[]>([]);
  const [name, setName] = useState("");
  const [created, setCreated] = useState<{ name: string; token: string } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function refresh() {
    try {
      setUsers(await listUsers(url, token));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not load users.");
    }
  }

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const me = await fetchMe(url, token);
      if (cancelled) return;
      setIsAdmin(me.kind === "admin");
      if (me.kind === "admin") await refresh();
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, token]);

  if (!isAdmin) return null;

  async function addUser() {
    const trimmed = name.trim();
    if (!trimmed) return;
    try {
      const user = await createUser(url, token, trimmed);
      setCreated({ name: user.name, token: user.token });
      setCopied(false);
      setName("");
      setMessage(null);
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not create the user.");
    }
  }

  async function removeUser(user: DirectoryUser) {
    try {
      await deleteUser(url, token, user.id);
      setMessage(`${user.name} removed. Their access is revoked and toducks shared with them are unshared.`);
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not remove the user.");
    }
  }

  return (
    <section className="mt-6 border-t border-line pt-5">
      <SectionLabel>Users on this server</SectionLabel>
      <p className="mt-2 text-sm text-pretty text-muted">
        You are connected with the admin token. Create a user for each person, then hand them their personal token to
        connect with. People only see their own toducks and ones shared with them.
      </p>
      {users.length ? (
        <ul className="mt-3 space-y-2">
          {users.map((user) => (
            <li key={user.id} className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{user.name}</span>
              <button
                type="button"
                className="grid size-11 shrink-0 place-items-center rounded-full text-danger"
                aria-label={`Delete user ${user.name}`}
                onClick={() => void removeUser(user)}
              >
                <Trash2 className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-sm text-muted">No registered users yet.</p>
      )}
      <form
        className="mt-3 flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void addUser();
        }}
      >
        <input
          className="field"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="New user's name"
          aria-label="New user's name"
          maxLength={80}
        />
        <Button type="submit" variant="primary" disabled={!name.trim()}>
          Create user
        </Button>
      </form>
      {created ? (
        <div className="mt-3 rounded-2xl bg-paper-2 px-4 py-3">
          <p className="text-sm font-medium">Personal token for {created.name}</p>
          <p className="mt-1 text-sm text-danger">Shown once — copy it now. It can't be shown again.</p>
          <div className="mt-2 flex gap-2">
            <input className="field" readOnly value={created.token} aria-label="New user token" onFocus={(event) => event.target.select()} />
            <Button
              onClick={() => {
                void navigator.clipboard?.writeText(created.token).then(() => setCopied(true));
              }}
            >
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
        </div>
      ) : null}
      {message ? (
        <p className="mt-2 text-sm text-muted" role="status" aria-live="polite">
          {message}
        </p>
      ) : null}
    </section>
  );
}

export function CategoriesDialog({ onClose }: { onClose: () => void }) {
  const categories = useToduck((s) => s.categories);
  const addCategory = useToduck((s) => s.addCategory);
  const renameCategory = useToduck((s) => s.renameCategory);
  const deleteCategory = useToduck((s) => s.deleteCategory);
  const [draft, setDraft] = useState("");
  const items = activeCategories(categories);

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title="Categories"
      description="A toduck sits in one category. Filter the list with the chips in the sidebar."
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

export function ProjectsDialog({ onClose }: { onClose: () => void }) {
  const projects = useToduck((s) => s.projects);
  const addProject = useToduck((s) => s.addProject);
  const renameProject = useToduck((s) => s.renameProject);
  const deleteProject = useToduck((s) => s.deleteProject);
  const [draft, setDraft] = useState("");
  const items = activeProjects(projects);

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title="Projects"
      description="A toduck can belong to one project, alongside its category. Removing a project keeps its toducks."
    >
      <ul className="space-y-2">
        {items.map((project) => (
          <CategoryRow
            key={project.id}
            name={project.name}
            onRename={(name) => renameProject(project.id, name)}
            onDelete={() => deleteProject(project.id)}
          />
        ))}
      </ul>
      {items.length === 0 ? <p className="text-sm text-muted">No projects yet.</p> : null}
      <form
        className="mt-4 flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (addProject(draft)) setDraft("");
        }}
      >
        <input
          className="field"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="New project"
          aria-label="New project"
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
  const serverUrl = useToduck((s) => s.serverUrl);
  const serverToken = useToduck((s) => s.serverToken);
  const syncStatus = useToduck((s) => s.syncStatus);
  const syncError = useToduck((s) => s.syncError);
  const lastSyncedAt = useToduck((s) => s.lastSyncedAt);
  const setServer = useToduck((s) => s.setServer);
  const importDoc = useToduck((s) => s.importDoc);
  const resetSamples = useToduck((s) => s.resetSamples);
  const clearDone = useToduck((s) => s.clearDone);
  const tasks = useToduck((s) => s.tasks);
  const categories = useToduck((s) => s.categories);
  const projects = useToduck((s) => s.projects);
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
      setMessage("Server cleared. Toducks stay on this device.");
      return;
    }
    setMessage("Checking the server…");
    try {
      await checkServer(next, token.trim());
      await syncNow();
      setMessage("Connected. Notes, categories, projects, and toducks will stay in sync.");
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
            projects: projects.filter((project) => !project.deleted),
          },
          null,
          2,
        ),
      ],
      { type: "application/json" },
    );
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "toduck.json";
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
              setMessage("Disconnected. Local toducks were not changed.");
            }}
          >
            Disconnect
          </Button>
          <a className="inline-flex min-h-11 items-center rounded-full bg-paper-2 px-4 text-sm font-medium text-ink" href="/toduck-pack.zip" download>
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
        {serverUrl && serverToken ? <UsersPanel url={serverUrl} token={serverToken} /> : null}
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
