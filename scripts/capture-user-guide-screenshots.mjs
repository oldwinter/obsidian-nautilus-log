import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, copyFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";

import { build } from "esbuild";

const PORT = Number(process.env.SPIRAL_DAY_GUIDE_PORT ?? 4179);
const DEBUG_PORT = Number(process.env.SPIRAL_DAY_GUIDE_DEBUG_PORT ?? 9222);
const ROOT = process.cwd();
const REPO_IMAGES = path.join(ROOT, "docs/user-guide/images");
const STORE_IMAGES = [
  "/cursor/stores/bc-bb53908d-0f8d-4864-807d-e423d159bceb/media/onboarding",
  "/cursor/stores/bc-bb53908d-0f8d-4864-807d-e423d159bceb/media/loop-plugin",
];

const FONTS = Object.freeze({
  "/fonts/Inter-Regular.ttf": "/usr/share/fonts/truetype/macos/Inter-Regular.ttf",
  "/fonts/Inter-Medium.ttf": "/usr/share/fonts/truetype/macos/Inter-Medium.ttf",
  "/fonts/Inter-SemiBold.ttf": "/usr/share/fonts/truetype/macos/Inter-SemiBold.ttf",
  "/fonts/Inter-Bold.ttf": "/usr/share/fonts/truetype/macos/Inter-Bold.ttf",
  "/fonts/JetBrainsMono-Regular.ttf": "/usr/share/fonts/truetype/jetbrains-mono/JetBrainsMono-Regular.ttf",
});

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
const fontFiles = new Map(await Promise.all(Object.entries(FONTS).map(async ([url, file]) =>
  [url, await readFile(file)])));

const server = createServer((request, response) => {
  const url = new URL(request.url ?? "/", `http://127.0.0.1:${PORT}`);
  const font = fontFiles.get(url.pathname);
  if (font) {
    response.writeHead(200, { "content-type": "font/ttf", "cache-control": "no-store" });
    response.end(font);
    return;
  }
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
for (const directory of STORE_IMAGES) await mkdir(directory, { recursive: true });

const chrome = process.env.CHROME_PATH ?? "google-chrome";
const profile = await mkdtemp(path.join(os.tmpdir(), "spiral-day-guide-cdp-"));
const child = spawn(chrome, [
  "--headless=new",
  "--disable-gpu",
  "--disable-dev-shm-usage",
  "--hide-scrollbars",
  "--no-first-run",
  "--no-default-browser-check",
  "--no-sandbox",
  "--font-render-hinting=none",
  "--force-device-scale-factor=1",
  `--remote-debugging-port=${DEBUG_PORT}`,
  `--user-data-dir=${profile}`,
  "--window-size=1280,900",
  "about:blank",
], { stdio: ["ignore", "ignore", "inherit"] });

function createCdp(socket) {
  let nextId = 1;
  const pending = new Map();
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data));
    if (message.id == null) return;
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    if (message.error) waiter.reject(new Error(message.error.message));
    else waiter.resolve(message.result);
  });
  return (method, params, sessionId) => {
    const id = nextId;
    nextId += 1;
    const payload = { id, method };
    if (params !== undefined) payload.params = params;
    if (sessionId) payload.sessionId = sessionId;
    socket.send(JSON.stringify(payload));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`CDP timeout: ${method}`));
      }, 20_000);
      pending.set(id, {
        resolve: (result) => {
          clearTimeout(timer);
          resolve(result);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
    });
  };
}

async function waitForJson(url, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return await response.json();
    } catch {
      // Chrome is still binding the debug port.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Chrome DevTools was not ready at ${url}`);
}

try {
  const version = await waitForJson(`http://127.0.0.1:${DEBUG_PORT}/json/version`);
  const socket = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  const send = createCdp(socket);

  for (const [scene, filename] of SCENES) {
    const output = path.join(REPO_IMAGES, filename);
    const url = `http://127.0.0.1:${PORT}/?scene=${scene}&capture=1`;
    const { targetId } = await send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
    await send("Page.enable", {}, sessionId);
    await send("Runtime.enable", {}, sessionId);
    await send("Emulation.setDeviceMetricsOverride", {
      width: 1280,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    }, sessionId);
    await send("Page.navigate", { url }, sessionId);
    const ready = await send("Runtime.evaluate", {
      expression: `new Promise((resolve) => {
        const settle = () => document.fonts.ready.then(() => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve({
            readyState: document.readyState,
            fontStatus: document.fonts.status,
            fontCount: document.fonts.size,
          })));
        });
        if (document.readyState === "complete") settle();
        else window.addEventListener("load", settle, { once: true });
      })`,
      awaitPromise: true,
      returnByValue: true,
    }, sessionId);
    if (ready.exceptionDetails) {
      throw new Error(`scene ${scene} failed to settle: ${ready.exceptionDetails.text}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
    const shot = await send("Page.captureScreenshot", {
      format: "png",
      fromSurface: true,
      captureBeyondViewport: false,
    }, sessionId);
    const bytes = Buffer.from(shot.data, "base64");
    if (bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") {
      throw new Error(`scene ${scene} did not return a PNG`);
    }
    if (bytes.length <= 1_000) throw new Error(`screenshot missing or empty for ${scene}`);
    await writeFile(output, bytes);
    for (const directory of STORE_IMAGES) {
      await copyFile(output, path.join(directory, filename));
    }
    await send("Target.closeTarget", { targetId });
    console.log(`wrote ${output} (${bytes.length} bytes, fonts=${ready.result?.value?.fontStatus})`);
  }

  socket.close();
  console.log(`captured ${SCENES.length} screenshots`);
} finally {
  child.kill("SIGKILL");
  await rm(profile, { recursive: true, force: true }).catch(() => undefined);
  server.close();
}
