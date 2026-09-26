import { build } from "esbuild";
import { readdir } from "node:fs/promises";

const directory = "tests/ui/planner";
const entryPoints = (await readdir(directory))
  .filter((file) => file.endsWith(".test.ts"))
  .sort()
  .map((file) => `${directory}/${file}`);

if (entryPoints.length === 0) throw new Error("planner test runner found no tests");

const obsidianStub = {
  name: "planner-obsidian-stub",
  setup(build) {
    build.onResolve({ filter: /^obsidian$/ }, () => ({ path: "obsidian", namespace: "planner-test" }));
    build.onLoad({ filter: /.*/, namespace: "planner-test" }, () => ({
      contents: `
        export class ItemView {
          constructor(leaf) {
            this.leaf = leaf;
            this.contentEl = {
              classList: { add() {}, remove() {} },
              replaceChildren() {},
            };
          }
        }
        export function setIcon() {}
      `,
      loader: "js",
    }));
  },
};

const result = await build({
  absWorkingDir: process.cwd(),
  bundle: true,
  entryPoints,
  format: "esm",
  logLevel: "silent",
  outdir: "focused-planner-tests",
  platform: "node",
  plugins: [obsidianStub],
  target: "node22",
  write: false,
});

for (const output of result.outputFiles) {
  await import(`data:text/javascript;base64,${Buffer.from(output.contents).toString("base64")}`);
}
