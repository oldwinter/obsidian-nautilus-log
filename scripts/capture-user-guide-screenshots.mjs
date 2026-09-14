import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, copyFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";

import { build } from "esbuild";

const PORT = Number(process.env.SPIRAL_DAY_GUIDE_PORT ?? 4179);
const ROOT = process.cwd();
const REPO_IMAGES = path.join(ROOT, "docs/user-guide/images");
const STORE_IMAGES = "/cursor/stores/bc-bb53908d-0f8d-4864-807d-e423d159bceb/media/onboarding";

const SCENES = [
  ["enable-plugin", "01-enable-plugin.png"],
  ["settings-first-run", "02-settings-first-run.png"],
  ["open-planner-ribbon", "03-open-planner-ribbon.png"],
  ["daily-note-markers", "04-daily-note-markers.png"],
  ["planner-empty-guidance", "05-planner-empty-guidance.png"],
  ["planner-scheduled-day", "06-planner-scheduled-day.png"],
  ["enable-execution", "07-enable-execution.png"],
  ["timing-idle", "08-timing-idle.png"],
  ["plan-tab", "09-plan-tab.png"],
  ["review-tab", "10-review-tab.png"],
  ["active-task", "11-active-task.png"],
  ["daily-loop", "12-daily-loop.png"],
];

const [bundle, html, ...styles] = await Promise.all([
  build({
    absWorkingDir: ROOT,
    bundle: true,
    entryPoints: ["scripts/user-guide-preview/main.ts"],
    format: "esm",
    logLevel: "info",
    platform: "browser",
    target: "es2022",
    write: false,
  }),
  readFile("scripts/user-guide-preview/index.html"),
  readFile("styles/a11y.css", "utf8"),
  readFile("styles/execution.css", "utf8"),
  readFile("styles/planner.css", "utf8"),
  readFile("styles/review.css", "utf8"),
  readFile("styles/theme.css", "utf8"),
]);

const javascript = bundle.outputFiles[0]?.contents;
if (!javascript) throw new Error("user-guide preview bundle was empty");
const css = styles.join("\n");

const server = createServer((request, response) => {
  const url = new URL(request.url ?? "/", `http://127.0.0.1:${PORT}`);
  if (url.pathname === "/preview.js") {
    response.writeHead(200, { "content-type": "text/javascript; charset=utf-8" });
    response.end(javascript);
    return;
  }
  if (url.pathname === "/preview.css") {
    response.writeHead(200, { "content-type": "text/css; charset=utf-8" });
    response.end(css);
    return;
  }
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  response.end(html);
});

await new Promise((resolve) => server.listen(PORT, "127.0.0.1", resolve));
await mkdir(REPO_IMAGES, { recursive: true });
await mkdir(STORE_IMAGES, { recursive: true });

const chrome = process.env.CHROME_PATH ?? "google-chrome";

for (const [scene, filename] of SCENES) {
  const output = path.join(REPO_IMAGES, filename);
  const url = `http://127.0.0.1:${PORT}/?scene=${scene}&capture=1`;
  const profile = await mkdtemp(path.join(os.tmpdir(), `spiral-day-guide-${scene}-`));
  await rm(output, { force: true });
  const child = spawn(chrome, [
    "--headless=new",
    "--disable-gpu",
    "--disable-dev-shm-usage",
    "--hide-scrollbars",
    "--no-first-run",
    "--no-default-browser-check",
    "--no-sandbox",
    "--remote-debugging-port=0",
    `--user-data-dir=${profile}`,
    "--window-size=1280,860",
    "--virtual-time-budget=1500",
    `--screenshot=${output}`,
    url,
  ], { stdio: ["ignore", "ignore", "inherit"] });
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      const info = await stat(output);
      if (info.size > 1_000) break;
    } catch {
      // Chrome is still writing the capture.
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  await new Promise((resolve) => setTimeout(resolve, 200));
  child.kill("SIGKILL");
  await new Promise((resolve) => setTimeout(resolve, 200));
  await rm(profile, { recursive: true, force: true }).catch(() => undefined);
  const info = await stat(output);
  if (info.size <= 1_000) throw new Error(`screenshot missing or empty for ${scene}`);
  await copyFile(output, path.join(STORE_IMAGES, filename));
  console.log(`wrote ${output}`);
}

server.close();
console.log(`captured ${SCENES.length} screenshots`);
