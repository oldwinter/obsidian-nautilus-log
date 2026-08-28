#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import process from "node:process";

import { validateCandidateEvidenceBundle } from "../verify/candidate-evidence.mjs";
import { validateG0 } from "../verify/candidate-g0.mjs";
import { readCandidateFile, readCandidateJson } from "../verify/candidate-object.mjs";
import {
  validateG7Package,
  validateG9Signoff,
  validateGateResults,
} from "../verify/candidate-release.mjs";

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag?.startsWith("--") || value === undefined) throw new Error(`invalid argument ${String(flag)}`);
    args[flag.slice(2)] = value;
  }
  for (const required of ["gate", "candidate", "branch", "bundle", "input-dir"]) {
    if (!args[required]) throw new Error(`missing --${required}`);
  }
  if (!/^G[0-9]$/.test(args.gate)) throw new Error("--gate must be G0 through G9");
  return args;
}

async function readJson(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    throw new Error(`${filePath}: ${error.message}`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const repository = path.resolve(args.repository ?? ".");
  const inputRoot = path.resolve(args["input-dir"]);
  const scopePath = path.join(inputRoot, "g8-scope.json");
  const [requirements, g0] = await Promise.all([
    readCandidateJson(repository, args.candidate, "docs/parity/requirements.json"),
    validateG0({
      repository,
      candidateSha: args.candidate,
      branch: args.branch,
      scopePath,
      bundleRoot: path.resolve(args.bundle),
    }),
  ]);
  if (args.gate === "G0") {
    process.stdout.write(`${JSON.stringify(g0)}\n`);
    return;
  }

  const scope = await readJson(scopePath);
  const evidence = await validateCandidateEvidenceBundle({
    repository,
    candidateSha: args.candidate,
    bundleRoot: path.resolve(args.bundle),
    candidateRequirements: requirements,
    requiredRequirementIds: scope.included_requirement_ids,
    requiredEnvironmentIds: scope.release_scope === "private"
      ? ["ENV-PURE", "ENV-VIS", "ENV-HOST-PRIVATE"]
      : undefined,
  });
  const gateResults = await readJson(path.join(inputRoot, "gate-results.json"));
  const throughGate = args.gate === "G9" ? "G8" : args.gate;
  const gates = validateGateResults(
    gateResults,
    args.candidate,
    evidence.package_sha256,
    evidence.index,
    throughGate,
    requirements.test_catalog,
  );
  let g7;
  if (Number(args.gate.slice(1)) >= 7) {
    g7 = await readJson(path.join(inputRoot, "g7-package.json"));
    await validateG7Package(g7, args.candidate, evidence.package_sha256, inputRoot, { repository });
  }
  if (args.gate === "G8" && scope.release_scope === "private" && scope.excluded_requirement_ids.length === 0) {
    throw new Error("G8 private scope must disclose open requirements");
  }
  if (args.gate === "G8" && scope.release_scope === "private"
    && g7.release_label !== "private preview" && g7.release_label !== "private milestone") {
    throw new Error("G8 private package must be labelled private preview or private milestone");
  }
  if (args.gate === "G9") {
    const signoff = await readJson(path.join(inputRoot, "g9-signoff.json"));
    const requirementsBytes = await readCandidateFile(
      repository,
      args.candidate,
      "docs/parity/requirements.json",
    );
    const requirementsHash = createHash("sha256").update(requirementsBytes).digest("hex");
    validateG9Signoff(
      signoff,
      args.candidate,
      evidence.package_sha256,
      scope,
      gates,
      requirementsHash,
      {
        bundle_sha256: evidence.manifestSha256,
        index_sha256: evidence.indexSha256,
        g9_test_ids: requirements.test_catalog.filter((entry) => entry.gates.includes("G9")).map((entry) => entry.id).sort(),
        g9_evidence_ids: [...new Set(requirements.test_catalog
          .filter((entry) => entry.gates.includes("G9"))
          .flatMap((entry) => evidence.index.tests.find((row) => row.test_id === entry.id)?.evidence_ids ?? []))].sort(),
      },
    );
  }
  process.stdout.write(`${JSON.stringify({ gate: args.gate, result: "PASS", candidate_sha: args.candidate })}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
