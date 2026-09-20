import { execFileSync } from "node:child_process";
import { readdir } from "node:fs/promises";
import process from "node:process";

import { build } from "esbuild";

execFileSync(process.execPath, [
  "node_modules/typescript/bin/tsc",
  "--project",
  "tests/ui/planner-controls/tsconfig.json",
], { cwd: process.cwd(), stdio: "inherit" });

const directory = "tests/ui/planner-controls";
const entryPoints = (await readdir(directory))
  .filter((file) => file.endsWith(".test.ts"))
  .sort()
  .map((file) => `${directory}/${file}`);

if (entryPoints.length === 0) throw new Error("planner-controls test runner found no tests");

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
        class FakeElement {
          constructor(ownerDocument) {
            this.ownerDocument = ownerDocument;
            this.classList = new FakeClassList();
            this.children = [];
            this.parentElement = null;
            this.style = {
              removeProperty(property) { delete this[property]; },
            };
          }
          append(...children) {
            for (const child of children) {
              child.remove();
              child.parentElement = this;
              this.children.push(child);
            }
          }
          remove() {
            if (!this.parentElement) return;
            const index = this.parentElement.children.indexOf(this);
            if (index >= 0) this.parentElement.children.splice(index, 1);
            this.parentElement = null;
          }
          replaceChildren(...children) {
            for (const child of this.children) child.parentElement = null;
            this.children = [];
            this.append(...children);
          }
        }
        class FakeDocument {
          constructor() {
            this.defaultView = { localStorage: new FakeStorage() };
          }
          createElement() { return new FakeElement(this); }
        }
        export class ItemView {
          constructor(leaf) {
            this.leaf = leaf;
            this.contentEl = new FakeDocument().createElement();
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
        export function validatePlannerViewContext(context) {
          if (!context || !context.bounds || context.bounds.startMinutes < 0
            || context.bounds.endMinutes > 1440
            || context.bounds.endMinutes <= context.bounds.startMinutes) {
            throw new RangeError("Planner view requires valid same-day chart bounds");
          }
          return context;
        }
        export function mountPlannerSurface(root, runtime, context, options) {
          const seam = globalThis.__issue24PlannerAdapterSeam;
          const mount = { context, options, root, runtime };
          seam.mounts.push(mount);
          if (seam.mountFailure) {
            const failure = seam.mountFailure;
            seam.mountFailure = undefined;
            throw failure;
          }
          const surface = seam.createSurface ? seam.createSurface(mount) : seam.surface;
          mount.surface = surface;
          return surface;
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
