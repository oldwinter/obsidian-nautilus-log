import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import process from "node:process";

import { build } from "esbuild";

const port = Number(process.env.SPIRAL_DAY_ISSUE24_HARNESS_PORT ?? 43125);
const obsidianBrowserStub = {
  name: "issue24-browser-obsidian-stub",
  setup(build) {
    build.onResolve({ filter: /^obsidian$/ }, () => ({
      path: "obsidian",
      namespace: "issue24-browser-obsidian",
    }));
    build.onLoad({ filter: /.*/, namespace: "issue24-browser-obsidian" }, () => ({
      contents: `
        import {
          Bug, ChevronDown, ChevronUp, Copy, Eye, EyeOff, Play, RefreshCw,
          createElement as createLucideElement,
        } from "lucide";

        export class ItemView {
          constructor(leaf) {
            this.leaf = leaf;
            this.contentEl = leaf.contentEl;
          }
        }
        export function setIcon(element, icon) {
          element.dataset.obsidianIcon = icon;
          const iconNode = ({
            "chevron-down": ChevronDown,
            "chevron-up": ChevronUp,
            "bug": Bug,
            "eye": Eye,
            "eye-off": EyeOff,
            "copy": Copy,
            "play": Play,
            "refresh-cw": RefreshCw,
          })[icon];
          if (!iconNode) throw new Error("Unknown Obsidian icon: " + icon);
          const svg = createLucideElement(iconNode, {
            "aria-hidden": "true",
            "class": "svg-icon lucide planner-icon",
            "height": "16",
            "stroke-width": "2",
            "width": "16",
          });
          element.replaceChildren(svg);
        }
      `,
      loader: "js",
      resolveDir: process.cwd(),
    }));
  },
};
const [bundle, patternProbeBundle, html, plannerCss, themeCss, a11yCss] = await Promise.all([
  build({
    absWorkingDir: process.cwd(),
    bundle: true,
    entryPoints: ["tests/ui/planner-controls/visual-harness.ts"],
    format: "esm",
    logLevel: "silent",
    platform: "browser",
    plugins: [obsidianBrowserStub],
    target: "es2021",
    write: false,
  }),
  build({
    absWorkingDir: process.cwd(),
    bundle: true,
    entryPoints: ["tests/ui/planner-controls/pattern-probe.ts"],
    format: "esm",
    logLevel: "silent",
    platform: "browser",
    target: "es2021",
    write: false,
  }),
  readFile("tests/ui/planner-controls/visual-harness.html"),
  readFile("styles/planner.css"),
  readFile("styles/theme.css"),
  readFile("styles/a11y.css"),
]);
const javascript = bundle.outputFiles[0]?.contents;
if (!javascript) throw new Error("Issue #24 visual harness bundle was empty");
const patternProbeJavascript = patternProbeBundle.outputFiles[0]?.contents;
if (!patternProbeJavascript) throw new Error("Issue #24 pattern probe bundle was empty");
const css = Buffer.concat([plannerCss, Buffer.from("\n"), themeCss, Buffer.from("\n"), a11yCss]);

const server = createServer((request, response) => {
  if (request.url === "/harness.js") {
    response.writeHead(200, { "content-type": "text/javascript; charset=utf-8" });
    response.end(javascript);
    return;
  }
  if (request.url === "/pattern-probe-a.js" || request.url === "/pattern-probe-b.js") {
    response.writeHead(200, { "content-type": "text/javascript; charset=utf-8" });
    response.end(patternProbeJavascript);
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
  console.log(`issue #24 planner controls harness: http://127.0.0.1:${port}`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
