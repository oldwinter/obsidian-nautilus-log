import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import process from "node:process";

import { build } from "esbuild";

const port = Number(process.env.SPIRAL_DAY_EXECUTION_HARNESS_PORT ?? 43127);
const [bundle, html, executionCss, plannerCss, themeCss, a11yCss] = await Promise.all([
  build({
    absWorkingDir: process.cwd(),
    bundle: true,
    entryPoints: ["tests/ui/execution/visual-harness.ts"],
    format: "esm",
    logLevel: "silent",
    platform: "browser",
    target: "es2021",
    write: false,
  }),
  readFile("tests/ui/execution/visual-harness.html"),
  readFile("styles/execution.css"),
  readFile("styles/planner.css"),
  readFile("styles/theme.css"),
  readFile("styles/a11y.css"),
]);
const javascript = bundle.outputFiles[0]?.contents;
if (!javascript) throw new Error("Execution visual harness bundle was empty");
const harnessCss = Buffer.from(`
  :root { --font-interface: Inter, system-ui, sans-serif; --background-primary: #fff; --background-secondary: #f4f5f7; --background-modifier-border: #d5d9df; --background-modifier-hover: #e9edf2; --interactive-accent: #2563b8; --text-normal: #222831; --text-muted: #626b78; --text-faint: #858e9b; --text-on-accent: #fff; }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; background: var(--background-primary); color: var(--text-normal); font-family: var(--font-interface); }
  body.theme-dark { --background-primary: #202226; --background-secondary: #292c31; --background-modifier-border: #444a54; --background-modifier-hover: #343942; --interactive-accent: #72a7ee; --text-normal: #f0f1f3; --text-muted: #b4bbc5; --text-faint: #949eac; --text-on-accent: #111; }
  .harness-toolbar { align-items: center; background: var(--background-secondary); border-bottom: 1px solid var(--background-modifier-border); display: grid; gap: 12px; grid-template-columns: auto minmax(0, 1fr) auto; min-height: 52px; padding: 8px 12px; }
  .harness-controls { display: flex; flex-wrap: wrap; gap: 5px; }
  .harness-controls button, #execution-trigger { background: transparent; border: 1px solid var(--background-modifier-border); border-radius: 5px; color: inherit; min-height: 32px; padding: 5px 9px; }
  #execution-trigger { height: 34px; min-width: 34px; }
  #execution-trigger::before { content: '◷'; }
  .harness-workspace { display: grid; grid-template-columns: minmax(0, 1fr) 310px; min-height: calc(100vh - 52px); }
  .harness-note { max-width: 760px; padding: 36px clamp(20px, 7vw, 80px); }
  .harness-note h1 { font-size: 24px; letter-spacing: 0; }
  .harness-sidebar { background: var(--background-secondary); border-left: 1px solid var(--background-modifier-border); min-width: 0; }
  .harness-icon { font-size: 16px; line-height: 1; }
  body.harness-narrow .harness-workspace { grid-template-columns: minmax(0, 1fr) 220px; }
  @media (max-width: 640px) { .harness-toolbar { grid-template-columns: 1fr auto; } .harness-controls { grid-column: 1 / -1; grid-row: 2; } .harness-workspace { display: block; } .harness-sidebar { border-left: 0; border-top: 1px solid var(--background-modifier-border); } }
`);
const css = Buffer.concat([
  harnessCss,
  Buffer.from("\n"),
  plannerCss,
  Buffer.from("\n"),
  themeCss,
  Buffer.from("\n"),
  a11yCss,
  Buffer.from("\n"),
  executionCss,
]);

const server = createServer((request, response) => {
  if (request.url === "/harness.js") {
    response.writeHead(200, { "content-type": "text/javascript; charset=utf-8" });
    response.end(javascript);
    return;
  }
  if (request.url === "/harness.css") {
    response.writeHead(200, { "content-type": "text/css; charset=utf-8" });
    response.end(css);
    return;
  }
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  response.end(html);
});

server.listen(port, "127.0.0.1", () => {
  console.log(`issue #27 execution harness: http://127.0.0.1:${port}`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
