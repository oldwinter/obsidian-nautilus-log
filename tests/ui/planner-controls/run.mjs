import { execFileSync } from "node:child_process";
import process from "node:process";

import { build } from "esbuild";

execFileSync(process.execPath, [
  "node_modules/typescript/bin/tsc",
  "--project",
  "tests/ui/planner-controls/tsconfig.json",
], { cwd: process.cwd(), stdio: "inherit" });

const entryPoints = [
  "tests/ui/planner-controls/adapter-seam.test.ts",
  "tests/ui/planner-controls/controls.test.ts",
  "tests/ui/planner-controls/disclosures.test.ts",
  "tests/ui/planner-controls/focus.test.ts",
  "tests/ui/planner-controls/i18n.test.ts",
  "tests/ui/planner-controls/playback.test.ts",
  "tests/ui/planner-controls/styles.test.ts",
];

const obsidianStub = {
  name: "planner-controls-obsidian-stub",
  setup(build) {
    build.onResolve({ filter: /^obsidian$/ }, () => ({
      path: "obsidian",
      namespace: "planner-controls-obsidian-test",
    }));
    build.onLoad({ filter: /.*/, namespace: "planner-controls-obsidian-test" }, () => ({
      contents: `
        class FakeClassList {
          values = new Set();
          add(value) { this.values.add(value); }
          contains(value) { return this.values.has(value); }
          remove(value) { this.values.delete(value); }
        }
        class FakeStorage {
          values = new Map();
          failReads = false;
          failWrites = false;
          getItem(key) {
            if (this.failReads) throw new Error("storage read failed");
            return this.values.get(key) ?? null;
          }
          setItem(key, value) {
            if (this.failWrites) throw new Error("storage write failed");
            this.values.set(key, String(value));
          }
        }
        export class ItemView {
          constructor(leaf) {
            this.leaf = leaf;
            this.contentEl = {
              classList: new FakeClassList(),
              ownerDocument: { defaultView: { localStorage: new FakeStorage() } },
              replaceChildren() {},
            };
          }
        }
        export function setIcon(element, icon) {
          globalThis.__issue24PlannerAdapterSeam.iconCalls.push(icon);
          element.icon = icon;
        }
      `,
      loader: "js",
    }));
  },
};

const plannerViewSeamStub = {
  name: "planner-controls-view-seam-stub",
  setup(build) {
    build.onResolve({ filter: /^\.\.\/ui\/planner\/view$/ }, (args) => {
      if (!args.importer.endsWith("/src/adapters/planner-view.ts")) return undefined;
      return { path: "planner-view", namespace: "planner-controls-view-test" };
    });
    build.onLoad({ filter: /^planner-view$/, namespace: "planner-controls-view-test" }, () => ({
      contents: `
        export function validatePlannerViewContext(context) { return context; }
        export function mountPlannerSurface(root, runtime, context, options) {
          const seam = globalThis.__issue24PlannerAdapterSeam;
          seam.mounts.push({ context, options, root, runtime });
          return seam.surface;
        }
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
  outdir: "focused-planner-controls-tests",
  platform: "node",
  plugins: [obsidianStub, plannerViewSeamStub],
  target: "node22",
  write: false,
});

for (const output of result.outputFiles) {
  await import(`data:text/javascript;base64,${Buffer.from(output.contents).toString("base64")}`);
}
