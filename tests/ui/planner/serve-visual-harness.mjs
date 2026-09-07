import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import process from "node:process";

import { build } from "esbuild";

const port = Number(process.env.SPIRAL_DAY_HARNESS_PORT ?? 4173);
const [bundle, html, ...styles] = await Promise.all([
  build({
    absWorkingDir: process.cwd(),
    bundle: true,
    entryPoints: ["tests/ui/planner/visual-harness.ts"],
    format: "esm",
    logLevel: "silent",
    platform: "browser",
    target: "es2021",
    write: false,
  }),
  readFile("tests/ui/planner/visual-harness.html"),
  readFile("styles/a11y.css", "utf8"),
  readFile("styles/execution.css", "utf8"),
  readFile("styles/planner.css", "utf8"),
  readFile("styles/theme.css", "utf8"),
]);
const javascript = bundle.outputFiles[0]?.contents;
if (!javascript) throw new Error("Visual harness bundle was empty");
const css = styles.join("\n");

const server = createServer((request, response) => {
  if (request.url === "/harness.js") {
    response.writeHead(200, { "content-type": "text/javascript; charset=utf-8" });
    response.end(javascript);
    return;
  }
  if (request.url === "/planner.css") {
    response.writeHead(200, { "content-type": "text/css; charset=utf-8" });
    response.end(css);
    return;
  }
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  response.end(html);
});

server.listen(port, "127.0.0.1", () => {
  console.log(`planner visual harness: http://127.0.0.1:${port}`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
