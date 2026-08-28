#!/usr/bin/env node
import { readFile, rename, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { validateCandidateEvidenceBundle } from "../verify/candidate-evidence.mjs";
import { validateG0 } from "../verify/candidate-g0.mjs";
import { readCandidateFile, readCandidateJson } from "../verify/candidate-object.mjs";
import {
  validateG7Package,
  validateG9Signoff,
  validateGateResults,
  verifyPublishedGitHubRelease,
} from "../verify/candidate-release.mjs";

function parseArgs(argv) {
  const args = {};
  const allowed = new Set(["gate", "candidate", "branch", "bundle", "input-dir", "repository"]);
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag?.startsWith("--") || value === undefined) throw new Error(`invalid argument ${String(flag)}`);
    const name = flag.slice(2);
    if (!allowed.has(name)) throw new Error(`unknown argument --${name}`);
    if (Object.hasOwn(args, name)) throw new Error(`duplicate argument --${name}`);
    args[name] = value;
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

function g9Coverage(requirements, evidence, includedRequirementIds) {
  const included = new Set(includedRequirementIds);
  const testIds = requirements.test_catalog
    .filter((entry) => included.has(entry.requirement_id) && entry.gates.includes("G9"))
    .map((entry) => entry.id)
    .sort();
  const evidenceIds = [...new Set(testIds.flatMap((testId) => evidence.index.tests
    .find((row) => row.test_id === testId)?.evidence_ids ?? []))].sort();
  return { testIds, evidenceIds };
}

async function writeDurableG9(inputRoot, gateResults, signoff, coverage, candidateSha, packageSha256, nowMs) {
  const timestamp = new Date(nowMs).toISOString();
  const row = {
    id: "G9",
    result: "PASS",
    candidate_sha: candidateSha,
    package_sha256: packageSha256,
    command: ["node", "scripts/release/run-gate.mjs", "--gate", "G9"],
    test_ids: coverage.testIds,
    evidence_ids: coverage.evidenceIds,
    result_url: signoff.release.url,
    started_at: timestamp,
    ended_at: timestamp,
    execution: { attempts: 1, retries: 0, skipped: false, quarantined: false, expected_failure: false },
  };
  const durable = { ...gateResults, gates: [...gateResults.gates, row] };
  const destination = path.join(inputRoot, "gate-results.json");
  const temporary = path.join(inputRoot, `.gate-results.${process.pid}.tmp`);
  await writeFile(temporary, `${JSON.stringify(durable, null, 2)}\n`, { flag: "wx" });
  await rename(temporary, destination);
  return row;
}

export async function runGate(args, options = {}) {
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
      nowMs: options.validationNowMs,
    }),
  ]);
  if (args.gate === "G0") {
    return g0;
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
    nowMs: options.validationNowMs,
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
    scope.included_requirement_ids,
  );
  let g7;
  if (Number(args.gate.slice(1)) >= 7) {
    g7 = await readJson(path.join(inputRoot, "g7-package.json"));
    await validateG7Package(g7, args.candidate, evidence.package_sha256, inputRoot, {
      repository,
      nowMs: options.validationNowMs,
    });
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
    const coverage = g9Coverage(requirements, evidence, scope.included_requirement_ids);
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
      },
      { version: g7.version, package_filename: g7.package_filename, package_sha256: g7.package_sha256 },
    );
    const releaseVerifier = options.releaseVerifier ?? verifyPublishedGitHubRelease;
    const releaseVerification = await releaseVerifier({
      repository,
      signoff,
      candidateSha: args.candidate,
      packageSha256: evidence.package_sha256,
    });
    const g9 = await writeDurableG9(
      inputRoot,
      gateResults,
      signoff,
      coverage,
      args.candidate,
      evidence.package_sha256,
      options.validationNowMs ?? Date.now(),
    );
    return { gate: "G9", ...g9, release_verification: releaseVerification };
  }
  return { gate: args.gate, result: "PASS", candidate_sha: args.candidate };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runGate(parseArgs(process.argv.slice(2)), { releaseVerifier: verifyPublishedGitHubRelease })
    .then((result) => process.stdout.write(`${JSON.stringify(result)}\n`))
    .catch((error) => {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 1;
    });
}
