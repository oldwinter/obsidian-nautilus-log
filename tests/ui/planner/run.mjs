import { build } from "esbuild";

const entryPoints = [
  "tests/ui/planner/adapter.test.ts",
  "tests/ui/planner/diagnostics.test.ts",
  "tests/ui/planner/geometry.test.ts",
  "tests/ui/planner/planner-state.test.ts",
  "tests/ui/planner/responsive-layout.test.ts",
  "tests/ui/planner/spiral.test.ts",
  "tests/ui/planner/styles.test.ts",
  "tests/ui/planner/view-model.test.ts",
];

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
