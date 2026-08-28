import { mkdtemp, readdir, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { build } from "esbuild";

if (!process.env.OBS_SAFE_ADAPTER_PASS) {
  for (const pass of ["memory", "disposable-vault"]) {
    const result = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], {
      env: { ...process.env, OBS_SAFE_ADAPTER_PASS: pass },
      stdio: "inherit",
    });
    if (result.error) throw result.error;
    if (result.status !== 0) process.exit(result.status ?? 1);
  }
  process.exit(0);
}

const directory = path.dirname(new URL(import.meta.url).pathname);
const entries = (await readdir(directory))
  .filter((file) => file.endsWith(".test.ts"))
  .sort();

if (entries.length === 0) throw new Error("workspace write test runner found no tests");

const bundleDirectory = await mkdtemp(path.join(tmpdir(), "obs-safe-write-tests-"));
try {
  for (const entry of entries) {
    const outfile = path.join(bundleDirectory, entry.replace(/\.test\.ts$/, ".test.mjs"));
    await build({
      absWorkingDir: process.cwd(),
      entryPoints: [path.join(directory, entry)],
      bundle: true,
      format: "esm",
      logLevel: "silent",
      outfile,
      platform: "node",
      target: "node22",
      sourcemap: "inline",
    });
    await import(pathToFileURL(outfile).href);
  }
} finally {
  await rm(bundleDirectory, { recursive: true, force: true });
}
