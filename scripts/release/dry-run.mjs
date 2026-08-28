#!/usr/bin/env node
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  createDryRunFixture,
  FIXTURE_VALIDATION_NOW_MS,
} from "../../tests/fixtures/release/create-dry-run-fixture.mjs";
import { runGate } from "./run-gate.mjs";
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

async function main() {
  const fixture = await createDryRunFixture(repositoryRoot);
  try {
    const results = [];
    for (let index = 0; index <= 9; index += 1) {
      const gate = `G${index}`;
      if (gate !== "G0") await fixture.writeGateResultsThrough(gate);
      const result = await runGate({
        gate,
        candidate: fixture.candidateSha,
        branch: "candidate",
        bundle: fixture.bundleRoot,
        "input-dir": fixture.inputRoot,
        repository: fixture.repository,
      }, {
        validationNowMs: FIXTURE_VALIDATION_NOW_MS,
        releaseVerifier: async ({ signoff, candidateSha, packageSha256 }) => {
          if (signoff.release.target_sha !== candidateSha || signoff.package_sha256 !== packageSha256) {
            throw new Error("dry-run release verifier received stale identity");
          }
          return { result: "PASS", verifier: "explicit-dry-run-only" };
        },
      });
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
