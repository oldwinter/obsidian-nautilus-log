import { build } from "esbuild";
import { readdir } from "node:fs/promises";

const directory = "tests/workspace/read";
const entryPoints = (await readdir(directory))
  .filter((file) => file.endsWith(".test.ts"))
  .sort()
  .map((file) => `${directory}/${file}`);

if (entryPoints.length === 0) throw new Error("workspace read test runner found no tests");

const result = await build({
  absWorkingDir: process.cwd(),
  bundle: true,
  entryPoints,
  format: "esm",
  logLevel: "silent",
  outdir: "focused-workspace-read-tests",
  platform: "node",
  target: "node22",
  write: false,
});

for (const output of result.outputFiles) {
  await import(`data:text/javascript;base64,${Buffer.from(output.contents).toString("base64")}`);
}
