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
  validateOwnershipProjections,
  validateRequirementManifest,
  validateSchemaContract,
} from "../../scripts/verify/candidate-g0.mjs";
import {
  assertPushedCandidate,
  readCandidateJson,
} from "../../scripts/verify/candidate-object.mjs";
import {
  validateG7Package,
  validateG9Signoff,
  validateGateResults,
  verifyPublishedGitHubRelease,
} from "../../scripts/verify/candidate-release.mjs";
import { createDeterministicPackage } from "../../scripts/verify/candidate-package.mjs";
import { validateJsonAgainstSchema } from "../../scripts/verify/json-schema.mjs";
import { runGate } from "../../scripts/release/run-gate.mjs";
import { verifyEvidenceFromCliArguments } from "../../scripts/verify/verify-evidence.mjs";

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
    nowMs: fixture.validationNowMs,
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
    nowMs: fixture.validationNowMs,
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
    nowMs: fixture.validationNowMs,
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

test("G0 schemas and owner projections fail closed under structural and coordinated corruption", async () => {
  const requirements = await readJson(path.join(sourceRoot, "docs/parity/requirements.json"));
  const owners = await readJson(path.join(sourceRoot, "docs/parity/requirement-owners.json"));
  const boundaries = await readJson(path.join(sourceRoot, "docs/parity/ticket-boundaries.json"));
  const requirementRows = new Map(requirements.requirements.map((row) => [row.id, row]));
  const badOwners = structuredClone(owners);
  badOwners.requirements[0].owner_ticket = 31;
  assert.throws(() => validateOwnershipProjections(requirementRows, badOwners, boundaries), /projection/);
  const schema = await readJson(path.join(sourceRoot, "scripts/release/schemas/requirements.schema.json"));
  schema.properties.test_catalog.maxItems = 126;
  assert.throws(() => validateSchemaContract(schema, "requirements"), /open-test evidence contract/);

  const requirementsSchema = await readJson(path.join(sourceRoot, "scripts/release/schemas/requirements.schema.json"));
  const ownerSchema = await readJson(path.join(sourceRoot, "docs/parity/requirement-owners.schema.json"));
  const boundarySchema = await readJson(path.join(sourceRoot, "docs/parity/ticket-boundaries.schema.json"));
  const corruptions = [
    (value) => { value.counts.upstream = 113; },
    (value) => { delete value.requirements[0].statement; },
    (value) => { value.unexpected = true; },
    (value) => { value.requirements[0].unexpected = true; },
    (value) => { value.test_catalog[0].gates = "G0"; },
  ];
  for (const corrupt of corruptions) {
    const value = structuredClone(requirements);
    corrupt(value);
    assert.throws(() => validateJsonAgainstSchema(value, requirementsSchema, "requirements.json"));
  }
  const missingOwnerField = structuredClone(owners);
  delete missingOwnerField.requirements[0].owner_module;
  assert.throws(() => validateJsonAgainstSchema(missingOwnerField, ownerSchema, "owners.json"), /missing required field/);
  const extraBoundaryField = structuredClone(boundaries);
  extraBoundaryField.tickets[0].unexpected = true;
  assert.throws(() => validateJsonAgainstSchema(extraBoundaryField, boundarySchema, "boundaries.json"), /unexpected field/);

  const coordinatedRequirements = structuredClone(requirements);
  const coordinatedOwners = structuredClone(owners);
  coordinatedRequirements.requirements[0].owner_module = "src/outside-owned-boundary.ts";
  coordinatedOwners.requirements[0].owner_module = "src/outside-owned-boundary.ts";
  assert.throws(
    () => validateOwnershipProjections(
      new Map(coordinatedRequirements.requirements.map((row) => [row.id, row])),
      coordinatedOwners,
      boundaries,
    ),
    /allowed_module_boundaries/,
  );
});

test("actual G0 accepts private profile semantics without requiring public host profiles", async (t) => {
  const fixture = await createDryRunFixture(sourceRoot);
  t.after(() => fixture.cleanup());
  const privateScope = {
    ...fixture.scope,
    release_scope: "private",
    parity_claim: "private-preview",
  };
  const scopePath = path.join(fixture.inputRoot, "private-scope.json");
  await writeFile(scopePath, `${JSON.stringify(privateScope, null, 2)}\n`);
  const result = await validateG0({
    repository: fixture.repository,
    candidateSha: fixture.candidateSha,
    branch: "candidate",
    scopePath,
    bundleRoot: fixture.bundleRoot,
    nowMs: fixture.validationNowMs,
  });
  assert.equal(result.release_scope, "private");
  assert.equal(result.included_requirement_ids.length, 126);
});

test("a genuinely reduced private candidate passes G0 through G8 with scoped gate coverage", async (t) => {
  const fixture = await createDryRunFixture(sourceRoot, { releaseScope: "private" });
  t.after(() => fixture.cleanup());
  assert.equal(fixture.indexValue.requirements.length, 5);
  assert.ok(fixture.indexValue.requirements.every((entry) => fixture.scope.included_requirement_ids.includes(entry.requirement_id)));
  const observedProfiles = new Set(fixture.indexValue.records.map((entry) => entry.evidence_id.split("-").slice(2, -2).join("-")));
  assert.ok([...observedProfiles].every((id) => ["ENV-PURE", "ENV-VIS", "ENV-HOST-PRIVATE"].includes(id)));

  const g0 = await runGate({
    gate: "G0",
    candidate: fixture.candidateSha,
    branch: "candidate",
    bundle: fixture.bundleRoot,
    "input-dir": fixture.inputRoot,
    repository: fixture.repository,
  }, { validationNowMs: fixture.validationNowMs });
  assert.equal(g0.result, "PASS");

  for (let index = 1; index <= 8; index += 1) {
    const gate = `G${index}`;
    await fixture.writeGateResultsThrough(gate);
    const result = await runGate({
      gate,
      candidate: fixture.candidateSha,
      branch: "candidate",
      bundle: fixture.bundleRoot,
      "input-dir": fixture.inputRoot,
      repository: fixture.repository,
    }, {
      validationNowMs: fixture.validationNowMs,
      releaseVerifier: async () => { throw new Error("private G0-G8 must not verify a public release"); },
    });
    assert.equal(result.result, "PASS");
  }
  const traceInput = verifyEvidenceFromCliArguments([
    "--bundle", fixture.bundleRoot,
    "--candidate-sha", fixture.candidateSha,
    "--package-sha256", fixture.packageHash,
    "--repo", fixture.repository,
    "--scope", path.join(fixture.inputRoot, "g8-scope.json"),
  ], { nowMs: fixture.validationNowMs });
  assert.deepEqual(traceInput.scope.included_requirement_ids, fixture.scope.included_requirement_ids);
  assert.deepEqual(traceInput.scope.excluded_requirement_ids, fixture.scope.excluded_requirement_ids);
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
      nowMs: fixture.validationNowMs,
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
      nowMs: fixture.validationNowMs,
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
    () => validateGateResults(duplicate, fixture.candidateSha, fixture.packageHash, evidence.index, "G8", fixture.candidateRequirements.test_catalog),
    /duplicate id/,
  );

  const skipped = structuredClone(gateResults);
  skipped.gates[2].execution.skipped = true;
  assert.throws(
    () => validateGateResults(skipped, fixture.candidateSha, fixture.packageHash, evidence.index, "G8", fixture.candidateRequirements.test_catalog),
    /skipped must be false/,
  );
  const wrongCommand = structuredClone(gateResults);
  wrongCommand.gates[4].command = ["node", "other-script.mjs"];
  assert.throws(
    () => validateGateResults(wrongCommand, fixture.candidateSha, fixture.packageHash, evidence.index, "G8", fixture.candidateRequirements.test_catalog),
    /canonical command/,
  );
  const incompleteCoverage = structuredClone(gateResults);
  incompleteCoverage.gates[4].test_ids = incompleteCoverage.gates[4].test_ids.slice(1);
  assert.throws(
    () => validateGateResults(incompleteCoverage, fixture.candidateSha, fixture.packageHash, evidence.index, "G8", fixture.candidateRequirements.test_catalog),
    /mandatory in-scope tests/,
  );

  const missing = structuredClone(g7);
  delete missing.builds;
  await assert.rejects(
    validateG7Package(missing, fixture.candidateSha, fixture.packageHash, fixture.inputRoot, { repository: fixture.repository, nowMs: fixture.validationNowMs }),
    /G7 builds must be an array/,
  );

  const g7Path = path.join(fixture.inputRoot, "g7-package.json");
  await fixture.writeGateResultsThrough("G7");
  await writeFile(g7Path, "{malformed\n");
  await assert.rejects(
    runGate({
      gate: "G7",
      candidate: fixture.candidateSha,
      branch: "candidate",
      bundle: fixture.bundleRoot,
      "input-dir": fixture.inputRoot,
      repository: fixture.repository,
    }, { validationNowMs: fixture.validationNowMs }),
    (error) => error.message.includes("g7-package.json") && error.message.includes("JSON"),
  );
  await writeFile(g7Path, `${JSON.stringify(g7, null, 2)}\n`);

  for (const [label, mutate] of [
    ["missing", (value) => value.release_assets.pop()],
    ["extra", (value) => value.release_assets.push({ path: "EXTRA", sha256: "a".repeat(64) })],
    ["wrong", (value) => { value.release_assets[0].sha256 = "b".repeat(64); }],
  ]) {
    const corruptAssets = structuredClone(g7);
    mutate(corruptAssets);
    await assert.rejects(
      validateG7Package(corruptAssets, fixture.candidateSha, fixture.packageHash, fixture.inputRoot, {
        repository: fixture.repository,
        nowMs: fixture.validationNowMs,
      }),
      /release assets must be exactly|does not match exact candidate object bytes/,
      `G7 must reject ${label} release assets`,
    );
  }

  await writeFile(path.join(fixture.inputRoot, "artifacts/spiral-day-1.0.2.zip"), "corrupt package\n");
  await assert.rejects(
    validateG7Package(g7, fixture.candidateSha, fixture.packageHash, fixture.inputRoot, { repository: fixture.repository, nowMs: fixture.validationNowMs }),
    /exact package hash mismatch/,
  );

  const counterfeitBytes = createDeterministicPackage([
    { path: "main.js", content: "counterfeit" },
    { path: "manifest.json", content: '{"id":"spiral-day","name":"Spiral Day","version":"1.0.2"}' },
  ]);
  const counterfeitHash = sha256(counterfeitBytes);
  const counterfeit = structuredClone(g7);
  counterfeit.package_sha256 = counterfeitHash;
  counterfeit.builds.forEach((build) => {
    build.package_sha256 = counterfeitHash;
    build.assets = [
      { path: "main.js", sha256: sha256("counterfeit") },
      { path: "manifest.json", sha256: sha256('{"id":"spiral-day","name":"Spiral Day","version":"1.0.2"}') },
    ];
  });
  await writeFile(path.join(fixture.inputRoot, counterfeit.package_path), counterfeitBytes);
  await assert.rejects(
    validateG7Package(counterfeit, fixture.candidateSha, counterfeitHash, fixture.inputRoot, { repository: fixture.repository, nowMs: fixture.validationNowMs }),
    /deterministic exact-Git-object rebuild/,
  );

  const packagePath = path.join(fixture.inputRoot, g7.package_path);
  await unlink(packagePath);
  await symlink(path.join(fixture.bundleRoot, "artifacts/spiral-day.zip"), packagePath);
  await assert.rejects(
    validateG7Package(g7, fixture.candidateSha, fixture.packageHash, fixture.inputRoot, { repository: fixture.repository, nowMs: fixture.validationNowMs }),
    /symbolic link/,
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

test("G9 binds G7 identity, verifies the remote release, and durably produces its own PASS row", async (t) => {
  const fixture = await createDryRunFixture(sourceRoot);
  t.after(() => fixture.cleanup());
  const before = (await execFileAsync("git", ["status", "--porcelain=v2", "--branch"], {
    cwd: fixture.repository,
  })).stdout;
  const evidence = await loadEvidence(fixture);
  const gateResults = await readJson(path.join(fixture.inputRoot, "gate-results.json"));
  const gates = validateGateResults(gateResults, fixture.candidateSha, fixture.packageHash, evidence.index, "G8", fixture.candidateRequirements.test_catalog);
  await validateG7Package(fixture.g7, fixture.candidateSha, fixture.packageHash, fixture.inputRoot, { repository: fixture.repository, nowMs: fixture.validationNowMs });
  const identity = {
    bundle_sha256: evidence.manifestSha256,
    index_sha256: evidence.indexSha256,
  };
  const packageIdentity = {
    version: fixture.g7.version,
    package_filename: fixture.g7.package_filename,
    package_sha256: fixture.g7.package_sha256,
  };
  validateG9Signoff(
    fixture.signoff,
    fixture.candidateSha,
    fixture.packageHash,
    fixture.scope,
    gates,
    undefined,
    identity,
    packageIdentity,
  );
  const wrongVersion = structuredClone(fixture.signoff);
  wrongVersion.version = "1.0.3";
  wrongVersion.release.tag = "1.0.3";
  wrongVersion.release.url = "https://github.com/oldwinter/obsidian-nautilus-log/releases/tag/1.0.3";
  assert.throws(
    () => validateG9Signoff(wrongVersion, fixture.candidateSha, fixture.packageHash, fixture.scope, gates, undefined, identity, packageIdentity),
    /differs from the validated G7 package/,
  );

  const fakeFetch = async (url) => {
    if (url.includes("/releases/tags/")) return {
      ok: true,
      async json() {
        return {
          draft: false,
          published_at: "2026-08-29T00:00:00Z",
          tag_name: "1.0.2",
          html_url: fixture.signoff.release.url,
          target_commitish: fixture.candidateSha,
          assets: [{ name: fixture.g7.package_filename, browser_download_url: "https://downloads.example.invalid/package" }],
        };
      },
    };
    if (url.includes("/git/ref/tags/")) return {
      ok: true,
      async json() { return { object: { type: "commit", sha: fixture.candidateSha } }; },
    };
    if (url === "https://downloads.example.invalid/package") return {
      ok: true,
      async arrayBuffer() { return Uint8Array.from(fixture.packageBytes).buffer; },
    };
    throw new Error(`unexpected fake URL ${url}`);
  };
  const remote = await verifyPublishedGitHubRelease({
    repository: fixture.repository,
    repositorySlug: "oldwinter/obsidian-nautilus-log",
    signoff: fixture.signoff,
    candidateSha: fixture.candidateSha,
    packageSha256: fixture.packageHash,
    fetchImpl: fakeFetch,
  });
  assert.equal(remote.asset_sha256, fixture.packageHash);

  await fixture.writeGateResultsThrough("G9");
  const result = await runGate({
    gate: "G9",
    candidate: fixture.candidateSha,
    branch: "candidate",
    bundle: fixture.bundleRoot,
    "input-dir": fixture.inputRoot,
    repository: fixture.repository,
  }, {
    validationNowMs: fixture.validationNowMs,
    releaseVerifier: async () => remote,
  });
  assert.equal(result.id, "G9");
  const durable = await readJson(path.join(fixture.inputRoot, "gate-results.json"));
  assert.deepEqual(durable.gates.map((entry) => entry.id), Array.from({ length: 10 }, (_, index) => `G${index}`));
  assert.equal(durable.gates.at(-1).result_url, fixture.signoff.release.url);
  await assert.rejects(
    runGate({
      gate: "G9",
      candidate: fixture.candidateSha,
      branch: "candidate",
      bundle: fixture.bundleRoot,
      "input-dir": fixture.inputRoot,
      repository: fixture.repository,
    }, { validationNowMs: fixture.validationNowMs, releaseVerifier: async () => remote }),
    /G0 through G8 exactly once/,
  );
  const after = (await execFileAsync("git", ["status", "--porcelain=v2", "--branch"], {
    cwd: fixture.repository,
  })).stdout;
  assert.equal(after, before);

  const stale = structuredClone(fixture.signoff);
  stale.repository_state.after.remote_head = "f".repeat(40);
  assert.throws(
    () => validateG9Signoff(stale, fixture.candidateSha, fixture.packageHash, fixture.scope, gates, undefined, identity, packageIdentity),
    /immutable same-SHA invariant/,
  );
});
