import { build } from "esbuild";

await build({
  entryPoints: ["prototype/dockable-planner/main.ts"],
  bundle: true,
  external: ["obsidian"],
  format: "cjs",
  platform: "browser",
  target: "es2022",
  sourcemap: "inline",
  outfile: "prototype/dockable-planner/main.js",
  logLevel: "info",
});
