import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile, symlink, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import {
  createDryRunFixture,
  rewriteBundleJson,
  sha256,
} from "../fixtures/release/create-dry-run-fixture.mjs";
import { validateCandidateEvidenceBundle } from "../../scripts/verify/candidate-evidence.mjs";
import {
  validateCandidateScope,
  validateG0,
  validateRequirementManifest,
} from "../../scripts/verify/candidate-g0.mjs";
import {
  assertPushedCandidate,
  readCandidateJson,
} from "../../scripts/verify/candidate-object.mjs";
import {
  validateG7Package,
  validateG9Signoff,
  validateGateResults,
} from "../../scripts/verify/candidate-release.mjs";
import { createDeterministicPackage } from "../../scripts/verify/candidate-package.mjs";

const execFileAsync = promisify(execFile);
const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function loadEvidence(fixture) {
  return validateCandidateEvidenceBundle({
    repository: fixture.repository,
    candidateSha: fixture.candidateSha,
    bundleRoot: fixture.bundleRoot,
    candidateRequirements: fixture.candidateRequirements,
  });
}

async function updateRecordDescriptor(fixture, recordPath) {
  const recordBytes = await readFile(path.join(fixture.bundleRoot, recordPath));
  await rewriteBundleJson(fixture, "evidence-index.json", (index) => {
    index.records.find((record) => record.path === recordPath).sha256 = sha256(recordBytes);
  });
}

test("G0 accepts the exact pushed candidate and complete resolved evidence", async (t) => {
  const fixture = await createDryRunFixture(sourceRoot);
  t.after(() => fixture.cleanup());
  const result = await validateG0({
    repository: fixture.repository,
    candidateSha: fixture.candidateSha,
    branch: "candidate",
    scopePath: path.join(fixture.inputRoot, "g8-scope.json"),
    bundleRoot: fixture.bundleRoot,
  });
  assert.deepEqual(
    { result: result.result, requirements: result.requirement_count, upstream: result.upstream_count },
    { result: "PASS", requirements: 126, upstream: 114 },
  );
  assert.equal(result.candidate_state.local_head, fixture.candidateSha);
  assert.equal(result.candidate_state.remote_head, fixture.candidateSha);
});

test("candidate reads use the commit object while dirty and unpushed states fail", async (t) => {
  const fixture = await createDryRunFixture(sourceRoot);
  t.after(() => fixture.cleanup());
  await writeFile(path.join(fixture.repository, "docs/parity/requirements.json"), "{\"broken\":true}\n");
  const candidateManifest = await readCandidateJson(
    fixture.repository,
    fixture.candidateSha,
    "docs/parity/requirements.json",
  );
  assert.equal(candidateManifest.row_count, 126);
  await assert.rejects(
    assertPushedCandidate(fixture.repository, fixture.candidateSha, "candidate"),
    /dirty or has untracked/,
  );
  await execFileAsync("git", ["restore", "docs/parity/requirements.json"], { cwd: fixture.repository });
  await writeFile(path.join(fixture.repository, "local-only.txt"), "unpushed\n");
  await execFileAsync("git", ["add", "local-only.txt"], { cwd: fixture.repository });
  await execFileAsync("git", ["commit", "-qm", "local unpushed candidate"], { cwd: fixture.repository });
  const unpushedSha = (await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: fixture.repository })).stdout.trim();
  await assert.rejects(
    assertPushedCandidate(fixture.repository, unpushedSha, "candidate"),
    /tracking ref .* expected/,
  );
});

test("G0 rejects unknown dispositions, unapproved adaptations, dangling links, and incomplete private scope", async (t) => {
  const fixture = await createDryRunFixture(sourceRoot);
  t.after(() => fixture.cleanup());
  const deviations = await readCandidateJson(fixture.repository, fixture.candidateSha, "docs/parity/deviations.json");

  const unknown = structuredClone(fixture.candidateRequirements);
  unknown.requirements[1].disposition = "deferred";
  assert.throws(() => validateRequirementManifest(unknown, deviations), /failing disposition deferred/);

  const adapted = structuredClone(fixture.candidateRequirements);
  adapted.requirements[1].disposition = "host-adapted";
  adapted.requirements[1].deviation_id = "DEV-999";
  assert.throws(() => validateRequirementManifest(adapted, deviations), /lacks a concrete approved deviation/);

  const dangling = structuredClone(fixture.candidateRequirements);
  dangling.requirements[1].fixtures = ["OFX-MISSING"];
  assert.throws(() => validateRequirementManifest(dangling, deviations), /dangling fixture/);

  const rows = new Map(fixture.candidateRequirements.requirements.map((row) => [row.id, row]));
  const privateScope = structuredClone(fixture.scope);
  const mandatory = new Set(["OBS-SAFE-001", "OBS-LIFE-001", "OBS-LOCAL-001", "REL-001", "REL-002"]);
  privateScope.release_scope = "private";
  privateScope.parity_claim = "private-preview";
  privateScope.included_requirement_ids = privateScope.included_requirement_ids.filter((id) => mandatory.has(id));
  privateScope.excluded_requirement_ids = [...rows.keys()].filter((id) => !mandatory.has(id)).slice(1);
  assert.throws(() => validateCandidateScope(privateScope, fixture.candidateSha, rows), /exact partition/);
});

test("G0 binds canonical scope fields and hashes to exact candidate object bytes", async (t) => {
  const fixture = await createDryRunFixture(sourceRoot);
  t.after(() => fixture.cleanup());
  const scopePath = path.join(fixture.inputRoot, "g8-scope.json");
  const validate = () => validateG0({
    repository: fixture.repository,
    candidateSha: fixture.candidateSha,
    branch: "candidate",
    scopePath,
    bundleRoot: fixture.bundleRoot,
    checkPushedState: false,
  });

  const legacy = { ...fixture.scope, release_kind: fixture.scope.release_scope };
  delete legacy.release_scope;
  await writeFile(scopePath, `${JSON.stringify(legacy, null, 2)}\n`);
  await assert.rejects(validate(), /canonical scope fields/);

  const staleHash = { ...fixture.scope, requirements_sha256: "f".repeat(64) };
  await writeFile(scopePath, `${JSON.stringify(staleHash, null, 2)}\n`);
  await assert.rejects(validate(), /requirements_sha256.*exact candidate Git object bytes/);

  const staleDeviations = { ...fixture.scope, deviations_sha256: "e".repeat(64) };
  await writeFile(scopePath, `${JSON.stringify(staleDeviations, null, 2)}\n`);
  await assert.rejects(validate(), /deviations_sha256.*exact candidate Git object bytes/);

  await writeFile(scopePath, `${JSON.stringify(fixture.scope, null, 2)}\n`);
  await writeFile(path.join(fixture.repository, "docs/parity/requirements.json"), "{\"dirty\":true}\n");
  assert.equal((await validate()).result, "PASS");
});

test("actual G0 rejects extra manifest files and symlinked bundle content", async (t) => {
  await t.test("extra file", async (st) => {
    const fixture = await createDryRunFixture(sourceRoot);
    st.after(() => fixture.cleanup());
    await writeFile(path.join(fixture.bundleRoot, "undeclared.txt"), "undeclared\n");
    await assert.rejects(validateG0({
      repository: fixture.repository,
      candidateSha: fixture.candidateSha,
      branch: "candidate",
      scopePath: path.join(fixture.inputRoot, "g8-scope.json"),
      bundleRoot: fixture.bundleRoot,
      checkPushedState: false,
    }), /exhaustively list every bundle file/);
  });

  await t.test("symlink artifact", async (st) => {
    const fixture = await createDryRunFixture(sourceRoot);
    st.after(() => fixture.cleanup());
    const artifacts = fixture.indexValue.records.flatMap((record) => record.artifacts);
    const linkedPath = path.join(fixture.bundleRoot, artifacts[0].path);
    await unlink(linkedPath);
    await symlink(path.join(fixture.bundleRoot, artifacts[1].path), linkedPath);
    await assert.rejects(validateG0({
      repository: fixture.repository,
      candidateSha: fixture.candidateSha,
      branch: "candidate",
      scopePath: path.join(fixture.inputRoot, "g8-scope.json"),
      bundleRoot: fixture.bundleRoot,
      checkPushedState: false,
    }), /symbolic links are forbidden/);
  });
});

test("evidence validation rejects stale records, retry-only results, and hash corruption", async (t) => {
  await t.test("stale candidate record", async (st) => {
    const fixture = await createDryRunFixture(sourceRoot);
    st.after(() => fixture.cleanup());
    const recordPath = fixture.indexValue.records[0].path;
    await rewriteBundleJson(fixture, recordPath, (record) => {
      record.candidate_sha = "f".repeat(40);
    });
    await updateRecordDescriptor(fixture, recordPath);
    await assert.rejects(loadEvidence(fixture), /candidate prefix|stale candidate/);
  });

  await t.test("retry-only record", async (st) => {
    const fixture = await createDryRunFixture(sourceRoot);
    st.after(() => fixture.cleanup());
    const recordPath = fixture.indexValue.records[0].path;
    await rewriteBundleJson(fixture, recordPath, (record) => {
      record.execution.attempts = 2;
      record.execution.retries = 1;
    });
    await updateRecordDescriptor(fixture, recordPath);
    await assert.rejects(loadEvidence(fixture), /execution\.attempts: must equal 1/);
  });

  await t.test("artifact hash mismatch", async (st) => {
    const fixture = await createDryRunFixture(sourceRoot);
    st.after(() => fixture.cleanup());
    const artifactPath = fixture.indexValue.records[0].artifacts[0].path;
    await writeFile(path.join(fixture.bundleRoot, artifactPath), "corrupt\n");
    await assert.rejects(loadEvidence(fixture), /SHA-256 mismatch/);
  });
});

test("release inputs reject missing, malformed, duplicate, skipped, and corrupt package data", async (t) => {
  const fixture = await createDryRunFixture(sourceRoot);
  t.after(() => fixture.cleanup());
  const evidence = await loadEvidence(fixture);
  const gateResults = await readJson(path.join(fixture.inputRoot, "gate-results.json"));
  const g7 = await readJson(path.join(fixture.inputRoot, "g7-package.json"));

  const duplicate = structuredClone(gateResults);
  duplicate.gates[1].id = "G0";
  assert.throws(
    () => validateGateResults(duplicate, fixture.candidateSha, fixture.packageHash, evidence.index),
    /duplicate id/,
  );

  const skipped = structuredClone(gateResults);
  skipped.gates[2].execution.skipped = true;
  assert.throws(
    () => validateGateResults(skipped, fixture.candidateSha, fixture.packageHash, evidence.index),
    /skipped must be false/,
  );

  const missing = structuredClone(g7);
  delete missing.builds;
  await assert.rejects(
    validateG7Package(missing, fixture.candidateSha, fixture.packageHash, fixture.inputRoot),
    /G7 builds must be an array/,
  );

  const g7Path = path.join(fixture.inputRoot, "g7-package.json");
  await writeFile(g7Path, "{malformed\n");
  await assert.rejects(
    execFileAsync(process.execPath, [
      path.join(sourceRoot, "scripts/release/run-gate.mjs"),
      "--gate", "G7",
      "--candidate", fixture.candidateSha,
      "--branch", "candidate",
      "--bundle", fixture.bundleRoot,
      "--input-dir", fixture.inputRoot,
      "--repository", fixture.repository,
    ]),
    (error) => error.stderr.includes("g7-package.json") && error.stderr.includes("JSON"),
  );
  await writeFile(g7Path, `${JSON.stringify(g7, null, 2)}\n`);

  await writeFile(path.join(fixture.inputRoot, "artifacts/spiral-day-1.0.2.zip"), "corrupt package\n");
  await assert.rejects(
    validateG7Package(g7, fixture.candidateSha, fixture.packageHash, fixture.inputRoot),
    /exact package hash mismatch/,
  );
});

test("deterministic package identity is order-independent and content-sensitive", () => {
  const first = createDeterministicPackage([
    { path: "manifest.json", content: "manifest" },
    { path: "main.js", content: "main" },
  ]);
  const second = createDeterministicPackage([
    { path: "main.js", content: "main" },
    { path: "manifest.json", content: "manifest" },
  ]);
  const corrupt = createDeterministicPackage([
    { path: "main.js", content: "changed" },
    { path: "manifest.json", content: "manifest" },
  ]);
  assert.deepEqual(first, second);
  assert.notEqual(sha256(first), sha256(corrupt));
});

test("G7-G9 validation preserves the repository and enforces the same-SHA invariant", async (t) => {
  const fixture = await createDryRunFixture(sourceRoot);
  t.after(() => fixture.cleanup());
  const before = (await execFileAsync("git", ["status", "--porcelain=v2", "--branch"], {
    cwd: fixture.repository,
  })).stdout;
  const evidence = await loadEvidence(fixture);
  const gateResults = await readJson(path.join(fixture.inputRoot, "gate-results.json"));
  const gates = validateGateResults(gateResults, fixture.candidateSha, fixture.packageHash, evidence.index);
  await validateG7Package(fixture.g7, fixture.candidateSha, fixture.packageHash, fixture.inputRoot);
  validateG9Signoff(fixture.signoff, fixture.candidateSha, fixture.packageHash, fixture.scope, gates);
  const after = (await execFileAsync("git", ["status", "--porcelain=v2", "--branch"], {
    cwd: fixture.repository,
  })).stdout;
  assert.equal(after, before);

  const stale = structuredClone(fixture.signoff);
  stale.repository_state.after.remote_head = "f".repeat(40);
  assert.throws(
    () => validateG9Signoff(stale, fixture.candidateSha, fixture.packageHash, fixture.scope, gates),
    /immutable same-SHA invariant/,
  );
});
