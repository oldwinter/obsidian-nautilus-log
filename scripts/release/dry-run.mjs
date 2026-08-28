#!/usr/bin/env node
import { execFile } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import { createDryRunFixture } from "../../tests/fixtures/release/create-dry-run-fixture.mjs";

const execFileAsync = promisify(execFile);
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

async function main() {
  const fixture = await createDryRunFixture(repositoryRoot);
  try {
    const results = [];
    for (let index = 0; index <= 9; index += 1) {
      const gate = `G${index}`;
      if (gate !== "G0") await fixture.writeGateResultsThrough(gate);
      const { stdout } = await execFileAsync(process.execPath, [
        path.join(repositoryRoot, "scripts/release/run-gate.mjs"),
        "--gate", gate,
        "--candidate", fixture.candidateSha,
        "--branch", "candidate",
        "--bundle", fixture.bundleRoot,
        "--input-dir", fixture.inputRoot,
        "--repository", fixture.repository,
      ], { maxBuffer: 64 * 1024 * 1024 });
      const result = JSON.parse(stdout);
      if (result.gate !== gate || result.result !== "PASS") {
        throw new Error(`${gate} dry-run did not pass`);
      }
      results.push(result);
    }
    process.stdout.write(`${JSON.stringify({
      result: "PASS",
      candidate_sha: fixture.candidateSha,
      gates: results.map((result) => result.gate),
      dry_run_only: true,
      product_implementation_executed: false,
      issue_31_repository_changes_required: false,
    })}\n`);
  } finally {
    await fixture.cleanup();
  }
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
