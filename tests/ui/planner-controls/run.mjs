import { build } from "esbuild";

const entryPoints = [
  "tests/ui/planner-controls/controls.test.ts",
  "tests/ui/planner-controls/disclosures.test.ts",
  "tests/ui/planner-controls/focus.test.ts",
  "tests/ui/planner-controls/i18n.test.ts",
  "tests/ui/planner-controls/playback.test.ts",
  "tests/ui/planner-controls/styles.test.ts",
];

const result = await build({
  absWorkingDir: process.cwd(),
  bundle: true,
  entryPoints,
  format: "esm",
  logLevel: "silent",
  outdir: "focused-planner-controls-tests",
  platform: "node",
  target: "node22",
  write: false,
});

for (const output of result.outputFiles) {
  await import(`data:text/javascript;base64,${Buffer.from(output.contents).toString("base64")}`);
}
