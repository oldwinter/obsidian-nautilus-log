import { build } from "esbuild";

const entryPoints = [
  "tests/runtime/projection/lifecycle.test.ts",
  "tests/runtime/projection/plugin-data.test.ts",
  "tests/runtime/projection/projection-runtime.test.ts",
  "tests/runtime/projection/refresh-clock.test.ts",
  "tests/runtime/projection/snapshots-cache.test.ts",
];

const result = await build({
  absWorkingDir: process.cwd(),
  bundle: true,
  entryPoints,
  format: "esm",
  logLevel: "silent",
  outdir: "focused-runtime-tests",
  platform: "node",
  target: "node22",
  write: false,
});

for (const output of result.outputFiles) {
  await import(`data:text/javascript;base64,${Buffer.from(output.contents).toString("base64")}`);
}
