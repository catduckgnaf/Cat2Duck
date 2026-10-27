import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, type Page } from "playwright/test";

/** The nav lives in the sidebar: pinned open on desktop, a drawer on mobile. */
async function openSidebarIfNeeded(page: Page) {
  const nav = page.getByRole("navigation", { name: "Views" });
  if (!(await nav.isVisible().catch(() => false))) {
    await page.getByRole("button", { name: "Toggle navigation" }).click();
    await expect(nav).toBeVisible();
  }
}

async function clickNav(page: Page, pattern: RegExp) {
  await openSidebarIfNeeded(page);
  await page.getByRole("button", { name: pattern }).click();
}

async function closeSidebarIfOpen(page: Page) {
  // The X inside the sidebar (the backdrop's center is covered by the drawer).
  const close = page.locator("aside").getByRole("button", { name: "Close navigation" });
  if (await close.isVisible().catch(() => false)) await close.click();
}

const title = "QA task that survives the feed";
const token = "qa-token-that-is-longer-than-thirty-two-characters";

async function startSyncServer(
  port: number,
  staticDir: string = join(process.cwd(), ".vercel/output/static"),
): Promise<{ child: ChildProcess; directory: string }> {
  const directory = await mkdtemp(join(tmpdir(), "toduck-e2e-"));
  const processEnv = { ...process.env };
  delete processEnv.HTTP_PROXY;
  delete processEnv.HTTPS_PROXY;
  delete processEnv.ALL_PROXY;
  const child = spawn(process.execPath, ["selfhost/server.mjs"], {
    cwd: process.cwd(),
    env: {
      ...processEnv,
      TODUCK_TOKEN: token,
      TODUCK_ALLOWED_ORIGINS: "http://127.0.0.1:4173,http://127.0.0.1:8080",
      DATA_PATH: join(directory, "state.json"),
      PORT: String(port),
      STATIC_DIR: staticDir,
    },
    stdio: "ignore",
  });

  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Sync server exited with ${child.exitCode}`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      if (response.ok) return { child, directory };
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  child.kill();
  await rm(directory, { recursive: true, force: true });
  throw new Error("Sync server did not become ready");
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.clear());
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Feed" })).toBeVisible({ timeout: 30_000 });
});

test("add, edit, complete, repeat, filter, export, import, settings, and composer placement", async ({ page }, testInfo) => {
  const browserErrors: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });

  const composer = page.locator("form").filter({ has: page.getByLabel("New toduck") });
  await expect(composer).toBeVisible();
  await expect(page.locator("main")).toHaveCount(1);
  const placement = await page.evaluate(() => {
    const main = document.querySelector("main");
    const input = document.querySelector<HTMLInputElement>("#new-task");
    const form = input?.closest("form");
    return !!main && !!form && main.compareDocumentPosition(form) === Node.DOCUMENT_POSITION_FOLLOWING;
  });
  expect(placement).toBe(true);

  await page.getByLabel("New toduck").fill(title);
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByText(title, { exact: true })).toBeVisible();

  await page.getByRole("button", { name: `Details for ${title}` }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Toduck name").fill(`${title} edited`);
  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(page.getByText(`${title} edited`, { exact: true })).toBeVisible();

  await page.getByRole("checkbox", { name: `Complete ${title} edited` }).click();
  await clickNav(page, /^Done/);
  await expect(page.getByText(`${title} edited`, { exact: true })).toBeVisible();

  await clickNav(page, /^Feed \d+$/);
  await page.getByLabel("New toduck").fill("Repeating QA task");
  await page.getByRole("button", { name: "Once" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Every day" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Close" }).click();
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await clickNav(page, /^Repeats/);
  await expect(page.getByText("Repeating QA task", { exact: true })).toBeVisible();

  await openSidebarIfNeeded(page);
  await page.getByLabel("Filter toducks").fill("Repeating QA");
  await expect(page.getByText("Repeating QA task", { exact: true })).toBeVisible();
  await page.getByLabel("Filter toducks").fill("does not exist");
  await expect(page.getByText("Nothing matches")).toBeVisible();
  await closeSidebarIfOpen(page);
  await page.getByRole("main").getByRole("button", { name: "Clear filters" }).click();

  await openSidebarIfNeeded(page);
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByText("Not connected.")).toBeVisible();
  await page.getByLabel("Address").fill("not-a-url");
  await page.getByRole("button", { name: "Save and sync" }).click();
  await expect(page.getByText(/full address/)).toBeVisible();

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export" }).click();
  const exportDownload = await downloadPromise;
  expect(exportDownload.suggestedFilename()).toBe("toduck.json");
  const exportPath = await exportDownload.path();
  if (!exportPath) throw new Error("Export did not produce a file");

  await page.getByText("Import", { exact: true }).locator("input[type=file]").setInputFiles(exportPath);
  await expect(page.getByText("Imported.")).toBeVisible();

  const port = 18793 + testInfo.workerIndex;
  const server = await startSyncServer(port);
  try {
    await page.getByLabel("Address").fill(`http://127.0.0.1:${port}`);
    await page.getByLabel("Token").fill(token);
    await page.getByRole("button", { name: "Save and sync" }).click();
    await expect(page.getByText(/Connected\./)).toBeVisible();
    const remote = await fetch(`http://127.0.0.1:${port}/v1/state`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(remote.status).toBe(200);
    const remoteBody = (await remote.json()) as { tasks?: Array<{ title?: string }> };
    expect(remoteBody.tasks?.some((task) => task.title === "Repeating QA task")).toBe(true);
  } finally {
    server.child.kill();
    await rm(server.directory, { recursive: true, force: true });
  }

  await page.getByRole("button", { name: "Disconnect" }).click();
  await expect(page.getByText(/Local toducks were not changed/)).toBeVisible();
  await page.keyboard.press("Escape");
  await closeSidebarIfOpen(page);

  const main = page.getByRole("main");
  const lastTask = main.getByRole("listitem").last();
  await lastTask.scrollIntoViewIfNeeded();
  await expect(lastTask).toBeInViewport();
  const unobscured = await lastTask.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const points = [
      [rect.left + 4, rect.top + 4],
      [rect.right - 4, rect.bottom - 4],
    ];
    return points.every(([x, y]) => {
      const hit = document.elementFromPoint(x, y);
      return hit === element || element.contains(hit);
    });
  });
  expect(unobscured).toBe(true);

  await main.evaluate((element) => element.scrollTo({ top: 0 }));
  const firstTask = main.getByRole("listitem").first();
  await expect(firstTask).toBeInViewport();
  const firstTaskUnobscured = await firstTask.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.left + 4, rect.top + 4);
    return hit === element || element.contains(hit);
  });
  expect(firstTaskUnobscured).toBe(true);

  const screenshot = `docs/qa/screenshots/${testInfo.project.name}.png`;
  await page.screenshot({ path: screenshot, fullPage: true });
  expect(browserErrors).toEqual([]);
});

test("row controls: one-click date picker, category picker, and repeat checkbox advancing", async ({ page }) => {
  const key = (date: Date) => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  };
  const inFiveDays = key(new Date(Date.now() + 5 * 86_400_000));
  const tomorrow = key(new Date(Date.now() + 86_400_000));

  // The date on the row is the picker: fill it and the task moves, no dialog.
  await page.getByLabel("New toduck").fill("Quick date task");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  const quickRow = page.getByRole("listitem").filter({ hasText: "Quick date task" });
  await expect(quickRow).toBeVisible();
  const dateInput = quickRow.getByLabel(/Change date for Quick date task/);
  await dateInput.fill(inFiveDays);
  await expect(dateInput).toHaveValue(inFiveDays);
  await expect(page.getByText(/Moved to/)).toBeVisible();

  // The category can be set from the row, without opening the details.
  await quickRow.locator('button[aria-label^="Change category"]:visible').click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Home", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(quickRow).toContainText("Home");

  // Checking off a repeating task moves it to its next date; it is not "done".
  await page.getByLabel("New toduck").fill("Daily quick task");
  await page.getByRole("button", { name: "Once" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Every day" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Close" }).click();
  await page.getByRole("button", { name: "Add", exact: true }).click();
  const dailyRow = page.getByRole("listitem").filter({ hasText: "Daily quick task" });
  await expect(dailyRow).toBeVisible();
  await dailyRow.getByRole("checkbox", { name: /Done\. Move Daily quick task/ }).click();
  await expect(page.getByText("Moved repeating toduck to Tomorrow")).toBeVisible();
  await expect(dailyRow.getByLabel(/Change date for Daily quick task/)).toHaveValue(tomorrow);
  await clickNav(page, /^Done/);
  await expect(page.getByText("Daily quick task", { exact: true })).toHaveCount(0);
});

test("self-host server serves a page whose inline scripts run", async ({ page }, testInfo) => {
  // Regression: the self-host server's Content-Security-Policy must not block
  // the inline bootstrap scripts in the Web UI it serves, or the deployed app
  // renders blank even though the API works. The main flow test cannot catch
  // this - it loads the UI from the Vite dev server, not the self-host server.
  const staticDir = await mkdtemp(join(tmpdir(), "toduck-e2e-static-"));
  await writeFile(
    join(staticDir, "index.html"),
    '<!doctype html><title>selfhost</title><p id="app">waiting</p>' +
      '<script>document.getElementById("app").textContent = "inline script ran";</script>',
  );
  const port = 18793 + testInfo.workerIndex;
  const server = await startSyncServer(port, staticDir);
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));
  try {
    await page.goto(`http://127.0.0.1:${port}/`);
    await expect(page.getByText("inline script ran")).toBeVisible();
    expect(consoleErrors.filter((text) => text.includes("Content Security Policy"))).toEqual([]);
  } finally {
    server.child.kill();
    await rm(server.directory, { recursive: true, force: true });
    await rm(staticDir, { recursive: true, force: true });
  }
});

test("sidebar hosts All Tasks, Workflow, and Projects", async ({ page }, testInfo) => {
  const nav = page.getByRole("navigation", { name: "Views" });
  if (testInfo.project.name === "desktop-chromium") {
    // Pinned open by default on desktop, and the choice to collapse sticks.
    await expect(nav).toBeVisible();
    await page.getByRole("button", { name: "Toggle navigation" }).click();
    await expect(nav).toBeHidden();
    await page.getByRole("button", { name: "Toggle navigation" }).click();
    await expect(nav).toBeVisible();
  } else {
    // Narrow screens start unpinned; the sidebar is a drawer.
    await expect(nav).toBeHidden();
    await openSidebarIfNeeded(page);
  }
  await expect(page.getByRole("button", { name: /^All Tasks/ })).toBeVisible();
  await closeSidebarIfOpen(page);

  const composer = page.locator("form").filter({ has: page.getByLabel("New toduck") });
  await page.getByLabel("New toduck").fill("Sidebar QA toduck");
  await composer.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByText("Sidebar QA toduck", { exact: true })).toBeVisible();
  await page.getByRole("checkbox", { name: "Complete Sidebar QA toduck" }).click();

  // All Tasks shows it even though it is done (the Feed no longer does).
  await clickNav(page, /^All Tasks/);
  await expect(page.getByText("Sidebar QA toduck", { exact: true })).toBeVisible();

  // The Workflow board renders its five columns, done toduck in Done.
  await clickNav(page, /^Workflow/);
  for (const column of ["Overdue", "Today", "Upcoming", "Later", "Done"]) {
    await expect(page.getByRole("heading", { name: new RegExp(`^${column}`) })).toBeVisible();
  }
  await expect(page.getByText("Sidebar QA toduck", { exact: true })).toBeVisible();

  // Projects: create one, assign a toduck from the composer, filter to it.
  await clickNav(page, /^Projects/);
  const main = page.getByRole("main");
  await main.getByLabel("New project").fill("QA Project");
  await main.locator("form").getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByRole("button", { name: /Show toducks in QA Project/ })).toBeVisible();

  await page.getByLabel("New toduck").fill("Project QA toduck");
  await composer.getByRole("button", { name: "Project", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "QA Project" }).click();
  await composer.getByRole("button", { name: "Add", exact: true }).click();

  await page.getByRole("button", { name: /Show toducks in QA Project/ }).click();
  await expect(page.getByText("Project QA toduck", { exact: true })).toBeVisible();
  await expect(page.getByText("Sidebar QA toduck", { exact: true })).toHaveCount(0);
});

test("multi-user: admin creates a user, shares a toduck, and the user's token sees only the shared one", async ({ page }, testInfo) => {
  const port = 18793 + testInfo.workerIndex;
  const server = await startSyncServer(port);
  try {
    // Connect as admin.
    await openSidebarIfNeeded(page);
    await page.getByRole("button", { name: "Settings" }).click();
    await page.getByLabel("Address").fill(`http://127.0.0.1:${port}`);
    await page.getByLabel("Token").fill(token);
    await page.getByRole("button", { name: "Save and sync" }).click();
    await expect(page.getByText(/Connected\./)).toBeVisible();

    // Create a user from the admin Users panel and capture the one-time token.
    await page.getByLabel("New user's name").fill("Teammate");
    await page.getByRole("button", { name: "Create user" }).click();
    const tokenField = page.getByLabel("New user token");
    await expect(tokenField).toBeVisible();
    await expect(page.getByText(/Shown once/)).toBeVisible();
    const userToken = await tokenField.inputValue();
    expect(userToken.length).toBeGreaterThanOrEqual(32);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    // On mobile the drawer the Settings button lived in is still open.
    await closeSidebarIfOpen(page);

    // Two toducks as admin (they sync to the server).
    for (const name of ["Shared QA toduck", "Private QA toduck"]) {
      await page.getByLabel("New toduck").fill(name);
      await page.getByRole("button", { name: "Add", exact: true }).click();
      await expect(page.getByText(name, { exact: true })).toBeVisible();
    }

    // Wait until the server holds both, then share one with Teammate.
    const adminHeaders = { authorization: `Bearer ${token}` };
    await expect
      .poll(async () => {
        const remote = await fetch(`http://127.0.0.1:${port}/v1/state`, { headers: adminHeaders });
        const body = (await remote.json()) as { tasks?: Array<{ title?: string }> };
        return body.tasks?.filter((task) => task.title?.endsWith("QA toduck")).length ?? 0;
      })
      .toBe(2);

    await page.getByRole("button", { name: "Details for Shared QA toduck" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel(/Share with Teammate/).check();
    await page.waitForTimeout(300);
    await dialog.getByRole("button", { name: "Close" }).click();

    // The directory gives Teammate's id; the share must reach the server.
    const directory = (await (await fetch(`http://127.0.0.1:${port}/v1/users`, { headers: adminHeaders })).json()) as Array<{ id: string; name: string }>;
    const teammate = directory.find((user) => user.name === "Teammate");
    if (!teammate) throw new Error("Teammate missing from the directory");
    await expect
      .poll(async () => {
        const remote = await fetch(`http://127.0.0.1:${port}/v1/state`, { headers: adminHeaders });
        const body = (await remote.json()) as { tasks?: Array<{ title?: string; sharedWith?: string[] }> };
        return body.tasks?.find((task) => task.title === "Shared QA toduck")?.sharedWith ?? [];
      })
      .toEqual([teammate.id]);

    // The user's own token sees the shared toduck — and not the private one.
    const asUser = await fetch(`http://127.0.0.1:${port}/v1/state`, {
      headers: { authorization: `Bearer ${userToken}` },
    });
    expect(asUser.status).toBe(200);
    const userBody = (await asUser.json()) as { tasks?: Array<{ title?: string }> };
    const titles = (userBody.tasks ?? []).map((task) => task.title);
    expect(titles).toContain("Shared QA toduck");
    expect(titles).not.toContain("Private QA toduck");
  } finally {
    server.child.kill();
    await rm(server.directory, { recursive: true, force: true });
  }
});
