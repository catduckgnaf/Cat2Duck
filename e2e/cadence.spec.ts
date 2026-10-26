import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "playwright/test";

const title = "QA task that survives the feed";
const token = "qa-token-that-is-longer-than-thirty-two-characters";

async function startSyncServer(
  port: number,
  staticDir: string = join(process.cwd(), ".vercel/output/static"),
): Promise<{ child: ChildProcess; directory: string }> {
  const directory = await mkdtemp(join(tmpdir(), "cat2duck-e2e-"));
  const processEnv = { ...process.env };
  delete processEnv.HTTP_PROXY;
  delete processEnv.HTTPS_PROXY;
  delete processEnv.ALL_PROXY;
  const child = spawn(process.execPath, ["selfhost/server.mjs"], {
    cwd: process.cwd(),
    env: {
      ...processEnv,
      CADENCE_TOKEN: token,
      CADENCE_ALLOWED_ORIGINS: "http://127.0.0.1:4173,http://127.0.0.1:8080",
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

  const composer = page.locator("form").filter({ has: page.getByLabel("New task") });
  await expect(composer).toBeVisible();
  await expect(page.locator("main")).toHaveCount(1);
  const placement = await page.evaluate(() => {
    const main = document.querySelector("main");
    const input = document.querySelector<HTMLInputElement>("#new-task");
    const form = input?.closest("form");
    return !!main && !!form && main.compareDocumentPosition(form) === Node.DOCUMENT_POSITION_FOLLOWING;
  });
  expect(placement).toBe(true);

  await page.getByLabel("New task").fill(title);
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByText(title, { exact: true })).toBeVisible();

  await page.getByRole("button", { name: `Details for ${title}` }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Task name").fill(`${title} edited`);
  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(page.getByText(`${title} edited`, { exact: true })).toBeVisible();

  await page.getByRole("checkbox", { name: `Complete ${title} edited` }).click();
  await page.getByRole("button", { name: /^Done/ }).click();
  await expect(page.getByText(`${title} edited`, { exact: true })).toBeVisible();

  await page.getByRole("button", { name: /^Feed \d+$/ }).click();
  await page.getByLabel("New task").fill("Repeating QA task");
  await page.getByRole("button", { name: "Once" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Every day" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Close" }).click();
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.getByRole("button", { name: /^Repeats/ }).click();
  await expect(page.getByText("Repeating QA task", { exact: true })).toBeVisible();

  await page.getByLabel("Filter tasks").fill("Repeating QA");
  await expect(page.getByText("Repeating QA task", { exact: true })).toBeVisible();
  await page.getByLabel("Filter tasks").fill("does not exist");
  await expect(page.getByText("Nothing matches")).toBeVisible();
  await page.getByRole("main").getByRole("button", { name: "Clear filters" }).click();

  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByText("Not connected.")).toBeVisible();
  await page.getByLabel("Address").fill("not-a-url");
  await page.getByRole("button", { name: "Save and sync" }).click();
  await expect(page.getByText(/full address/)).toBeVisible();

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export" }).click();
  const exportDownload = await downloadPromise;
  expect(exportDownload.suggestedFilename()).toBe("cadence.json");
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
  await expect(page.getByText(/Local tasks were not changed/)).toBeVisible();
  await page.keyboard.press("Escape");

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
  await page.getByLabel("New task").fill("Quick date task");
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
  await page.getByLabel("New task").fill("Daily quick task");
  await page.getByRole("button", { name: "Once" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Every day" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Close" }).click();
  await page.getByRole("button", { name: "Add", exact: true }).click();
  const dailyRow = page.getByRole("listitem").filter({ hasText: "Daily quick task" });
  await expect(dailyRow).toBeVisible();
  await dailyRow.getByRole("checkbox", { name: /Done\. Move Daily quick task/ }).click();
  await expect(page.getByText("Moved repeating task to Tomorrow")).toBeVisible();
  await expect(dailyRow.getByLabel(/Change date for Daily quick task/)).toHaveValue(tomorrow);
  await page.getByRole("button", { name: /^Done/ }).click();
  await expect(page.getByText("Daily quick task", { exact: true })).toHaveCount(0);
});

test("self-host server serves a page whose inline scripts run", async ({ page }, testInfo) => {
  // Regression: the self-host server's Content-Security-Policy must not block
  // the inline bootstrap scripts in the Web UI it serves, or the deployed app
  // renders blank even though the API works. The main flow test cannot catch
  // this - it loads the UI from the Vite dev server, not the self-host server.
  const staticDir = await mkdtemp(join(tmpdir(), "cat2duck-e2e-static-"));
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
