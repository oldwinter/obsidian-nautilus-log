import { build } from "esbuild";

const entryPoints = [
  "tests/core/scheduler/capacity.test.ts",
  "tests/core/scheduler/day.test.ts",
  "tests/core/scheduler/history.test.ts",
  "tests/core/scheduler/purity-performance.test.ts",
  "tests/core/scheduler/scheduler.test.ts",
];

const result = await build({
  absWorkingDir: process.cwd(),
  bundle: true,
  entryPoints,
  format: "esm",
  logLevel: "silent",
  outdir: "focused-tests",
  platform: "node",
  target: "node22",
  write: false,
});

for (const output of result.outputFiles) {
  await import(`data:text/javascript;base64,${Buffer.from(output.contents).toString("base64")}`);
}
