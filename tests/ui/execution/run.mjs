import { build } from "esbuild";
import { readdir } from "node:fs/promises";

const directory = "tests/ui/execution";
const entryPoints = (await readdir(directory))
  .filter((file) => file.endsWith(".test.ts"))
  .sort()
  .map((file) => `${directory}/${file}`);

if (entryPoints.length === 0) throw new Error("execution UI test runner found no tests");

const result = await build({
  absWorkingDir: process.cwd(),
  bundle: true,
  entryPoints,
  format: "esm",
  logLevel: "silent",
  outdir: "focused-execution-ui-tests",
  platform: "node",
  plugins: [{
    name: "execution-obsidian-stub",
    setup(build) {
      build.onResolve({ filter: /^obsidian$/ }, () => ({ path: "obsidian", namespace: "execution-test" }));
      build.onLoad({ filter: /.*/, namespace: "execution-test" }, () => ({
        contents: `
          export class ItemView {
            constructor(leaf) { this.leaf = leaf; this.contentEl = {}; }
          }
          export class MarkdownView {}
          export class TFile {}
          export class Notice {
            constructor(message, duration) {
              this.message = message;
              this.duration = duration;
              this.noticeEl = { dataset: {}, classList: { add() {} } };
            }
          }
          export function setIcon() {}
        `,
        loader: "js",
      }));
    },
  }],
  target: "node22",
  write: false,
});

for (const output of result.outputFiles) {
  await import(`data:text/javascript;base64,${Buffer.from(output.contents).toString("base64")}`);
}
