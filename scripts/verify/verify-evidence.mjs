#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { validateEvidenceBundle } from "./evidence-bundle.mjs";
import { expectSafeRelativePath, expectSha256, expectSha40, parseJson } from "./evidence-schema.mjs";
import { validateCandidateScope, validateRequirementManifest } from "./candidate-g0.mjs";

function fail(message) {
  throw new Error(message);
}

function git(repoRoot, args) {
  try {
    return execFileSync("git", ["-C", repoRoot, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trimEnd();
  } catch (error) {
    const stderr = error && typeof error === "object" && "stderr" in error ? String(error.stderr).trim() : "";
    fail(`git ${args.join(" ")} failed${stderr ? `: ${stderr}` : ""}`);
  }
}

function gitBytes(repoRoot, args) {
  try {
    return execFileSync("git", ["-C", repoRoot, ...args], { stdio: ["ignore", "pipe", "pipe"] });
  } catch (error) {
    const stderr = error && typeof error === "object" && "stderr" in error ? String(error.stderr).trim() : "";
    fail(`git ${args.join(" ")} failed${stderr ? `: ${stderr}` : ""}`);
  }
}

export function loadCandidateRequirements(repoRoot, candidateSha, requirementsPath) {
  const root = realpathSync(repoRoot);
  expectSha40(candidateSha, "candidate SHA");
  expectSafeRelativePath(requirementsPath, "requirements path");
  const resolved = git(root, ["rev-parse", "--verify", `${candidateSha}^{commit}`]);
  if (resolved !== candidateSha) fail(`candidate SHA must resolve to the exact commit object ${candidateSha}`);
  if (git(root, ["cat-file", "-t", candidateSha]) !== "commit") fail(`${candidateSha}: candidate object is not a commit`);
  const objectSpec = `${candidateSha}:${requirementsPath}`;
  const blobOid = git(root, ["rev-parse", objectSpec]);
  const bytes = gitBytes(root, ["show", objectSpec]);
  return {
    requirements: parseJson(bytes.toString("utf8"), objectSpec),
    bytes,
    blobOid,
    sourcePath: requirementsPath,
  };
}

function parseArguments(args) {
  const allowed = new Set([
    "--bundle",
    "--manifest",
    "--candidate-sha",
    "--package-sha256",
    "--repo",
    "--requirements-path",
    "--scope",
  ]);
  const values = new Map();
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1];
    if (!allowed.has(name)) fail(`unknown argument ${String(name)}`);
    if (values.has(name)) fail(`duplicate argument ${name}`);
    if (typeof value !== "string" || value.startsWith("--")) fail(`${name} requires one value`);
    values.set(name, value);
  }
  for (const name of ["--bundle", "--candidate-sha", "--package-sha256"]) {
    if (!values.has(name)) fail(`${name} is required`);
  }
  return {
    bundleDir: resolve(values.get("--bundle")),
    manifestPath: values.get("--manifest") ?? "manifest.json",
    candidateSha: values.get("--candidate-sha"),
    packageSha256: values.get("--package-sha256"),
    repoRoot: resolve(values.get("--repo") ?? process.cwd()),
    requirementsPath: values.get("--requirements-path") ?? "docs/parity/requirements.json",
    scopePath: values.has("--scope") ? resolve(values.get("--scope")) : null,
  };
}

function evidenceScope(scopePath, candidateSha, requirements, repoRoot, requirementBytes) {
  if (!scopePath) return {
    release_scope: "public",
    included_requirement_ids: requirements.requirements.filter((row) => row.status === "active").map((row) => row.id),
    excluded_requirement_ids: [],
    environment_ids: undefined,
  };
  const scope = parseJson(readFileSync(scopePath, "utf8"), scopePath);
  const deviationSpec = `${candidateSha}:docs/parity/deviations.json`;
  const deviationBytes = gitBytes(repoRoot, ["show", deviationSpec]);
  const deviations = parseJson(deviationBytes.toString("utf8"), deviationSpec);
  const rows = validateRequirementManifest(requirements, deviations);
  const partition = validateCandidateScope(scope, candidateSha, rows, {
    requirementsSha256: createHash("sha256").update(requirementBytes).digest("hex"),
    deviationsSha256: createHash("sha256").update(deviationBytes).digest("hex"),
  });
  const requiredDeviationIds = [...rows.values()]
    .filter((row) => row.disposition === "host-adapted" || row.disposition === "approved-improvement")
    .map((row) => row.deviation_id)
    .sort();
  if (JSON.stringify([...scope.approved_deviation_ids].sort()) !== JSON.stringify(requiredDeviationIds)) {
    fail("--scope approved deviations do not match the exact candidate requirements");
  }
  return {
    release_scope: scope.release_scope,
    included_requirement_ids: [...partition.included],
    excluded_requirement_ids: [...partition.excluded],
    environment_ids: scope.release_scope === "private" ? ["ENV-PURE", "ENV-VIS", "ENV-HOST-PRIVATE"] : undefined,
  };
}

export function verifyEvidenceFromCliArguments(args, runtimeOptions = {}) {
  const options = parseArguments(args);
  expectSha40(options.candidateSha, "--candidate-sha");
  expectSha256(options.packageSha256, "--package-sha256");
  const candidate = loadCandidateRequirements(options.repoRoot, options.candidateSha, options.requirementsPath);
  const scope = evidenceScope(
    options.scopePath,
    options.candidateSha,
    candidate.requirements,
    options.repoRoot,
    candidate.bytes,
  );
  return {
    ...validateEvidenceBundle({
    bundleDir: options.bundleDir,
    manifestPath: options.manifestPath,
    candidateSha: options.candidateSha,
    packageSha256: options.packageSha256,
    candidateRequirements: candidate.requirements,
    candidateRequirementsBlobOid: candidate.blobOid,
    candidateRequirementsSourcePath: candidate.sourcePath,
    requiredRequirementIds: scope.included_requirement_ids,
    requiredEnvironmentIds: scope.environment_ids,
    nowMs: runtimeOptions.nowMs,
    }),
    scope,
  };
}

function summary(result) {
  return {
    result: "PASS",
    candidate_sha: result.candidateSha,
    package_sha256: result.packageSha256,
    requirement_count: result.index.requirements.length,
    test_count: result.index.tests.length,
    evidence_count: result.records.length,
    manifest_sha256: result.manifestSha256,
    index_sha256: result.indexSha256,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    console.log(JSON.stringify(summary(verifyEvidenceFromCliArguments(process.argv.slice(2))), null, 2));
  } catch (error) {
    console.error(`evidence verification failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
