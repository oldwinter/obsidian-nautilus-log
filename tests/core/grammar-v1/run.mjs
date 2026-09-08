import { build } from "esbuild";
import { readdir } from "node:fs/promises";

const directory = "tests/core/grammar-v1";
const entryPoints = (await readdir(directory))
  .filter((file) => file.endsWith(".test.ts"))
  .sort()
  .map((file) => `${directory}/${file}`);

if (entryPoints.length === 0) throw new Error("core grammar-v1 test runner found no tests");

const result = await build({
  absWorkingDir: process.cwd(),
  bundle: true,
  entryPoints,
  format: "esm",
  logLevel: "silent",
  outdir: "focused-core-grammar-v1-tests",
  platform: "node",
  target: "node22",
  write: false,
});

for (const output of result.outputFiles) {
  await import(`data:text/javascript;base64,${Buffer.from(output.contents).toString("base64")}`);
}
