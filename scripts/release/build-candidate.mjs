#!/usr/bin/env node
import path from "node:path";
import process from "node:process";

import { assertPushedCandidate } from "../verify/candidate-object.mjs";
import { buildDeterministicCandidatePackage } from "../verify/candidate-package.mjs";

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 2) {
    if (!argv[index]?.startsWith("--") || argv[index + 1] === undefined) {
      throw new Error(`invalid argument ${String(argv[index])}`);
    }
    args[argv[index].slice(2)] = argv[index + 1];
  }
  for (const field of ["candidate", "branch", "output"]) {
    if (!args[field]) throw new Error(`missing --${field}`);
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const repository = path.resolve(args.repository ?? ".");
  const outputPath = path.resolve(args.output);
  const state = await assertPushedCandidate(repository, args.candidate, args.branch);
  const packageResult = await buildDeterministicCandidatePackage({
    repository,
    candidateSha: args.candidate,
    outputPath,
  });
  process.stdout.write(`${JSON.stringify({ ...packageResult, candidate_state: state })}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
