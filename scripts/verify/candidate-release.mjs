import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";

import { CandidateError, requireFullSha } from "./candidate-object.mjs";
import { validateCandidateScope } from "./candidate-g0.mjs";
import { buildDeterministicCandidatePackage } from "./candidate-package.mjs";

const HASH_PATTERN = /^[0-9a-f]{64}$/;
const GATES = Array.from({ length: 10 }, (_, index) => `G${index}`);
const PACKAGE_ASSETS = new Set(["main.js", "manifest.json", "styles.css"]);
const REQUIRED_PACKAGE_ASSETS = ["main.js", "manifest.json"];
const REQUIRED_SMOKE = ["clean-install", "upgrade", "disable", "uninstall"];
const REQUIRED_WORKFLOWS = [
  "first-install-settings",
  "planning-overflow-progress",
  "clock-switch-complete-reload",
  "standalone-pomo-warnings",
  "review-date-rollover",
];
const REQUIRED_ATTESTATIONS = [
  "candidate-owner",
  "ci-evidence-controller",
  "data-safety-reviewer",
  "parity-reviewer",
  "release-owner",
];

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function requireArray(value, label) {
  if (!Array.isArray(value)) throw new CandidateError(`${label} must be an array`);
  return value;
}

function uniqueMap(rows, key, label) {
  const result = new Map();
  for (const row of requireArray(rows, label)) {
    const value = row?.[key];
    if (typeof value !== "string" || !value || result.has(value)) {
      throw new CandidateError(`${label} contains missing or duplicate ${key}: ${String(value)}`);
    }
    result.set(value, row);
  }
  return result;
}

function validateExecution(value, label) {
  if (value?.attempts !== 1 || value?.retries !== 0) {
    throw new CandidateError(`${label} must use one attempt and zero retries`);
  }
  for (const field of ["skipped", "quarantined", "expected_failure"]) {
    if (value[field] !== false) throw new CandidateError(`${label} ${field} must be false`);
  }
}

function validateTimestampRange(row, label) {
  const started = Date.parse(row.started_at);
  const ended = Date.parse(row.ended_at);
  if (!Number.isFinite(started) || !Number.isFinite(ended) || ended < started) {
    throw new CandidateError(`${label} timestamps are invalid`);
  }
}

export function validateGateResults(
  gateResults,
  candidateSha,
  packageSha256,
  evidenceIndex,
  throughGate = "G9",
  testCatalog = [],
) {
  if (gateResults.schema_version !== 1
    || gateResults.candidate_sha !== candidateSha
    || gateResults.package_sha256 !== packageSha256) {
    throw new CandidateError("gate results schema, candidate SHA, or package hash is stale");
  }
  const results = uniqueMap(gateResults.gates, "id", "gate results");
  const evidenceIds = new Set(evidenceIndex.records.map((record) => record.evidence_id));
  const gateIndex = GATES.indexOf(throughGate);
  if (gateIndex < 0) throw new CandidateError(`unknown release gate ${throughGate}`);
  const requiredGates = GATES.slice(0, gateIndex + 1);
  if (!Array.isArray(testCatalog) || testCatalog.length === 0) {
    throw new CandidateError("gate validation requires the committed test catalog");
  }
  const testsById = uniqueMap(testCatalog, "id", "test catalog");
  const indexTests = uniqueMap(evidenceIndex.tests, "test_id", "Evidence Index tests");
  if ([...results.keys()].some((gate) => !requiredGates.includes(gate))
    || requiredGates.some((gate) => !results.has(gate))) {
    throw new CandidateError(`gate results must contain G0 through ${throughGate} exactly once with no unknown gate`);
  }
  for (const gate of requiredGates) {
    const result = results.get(gate);
    if (result.result !== "PASS" || result.candidate_sha !== candidateSha
      || result.package_sha256 !== packageSha256) {
      throw new CandidateError(`${gate} did not pass on the exact candidate and package`);
    }
    if (JSON.stringify(result.command) !== JSON.stringify([
      "node", "scripts/release/run-gate.mjs", "--gate", gate,
    ])) {
      throw new CandidateError(`${gate} does not use its canonical command`);
    }
    const mandatoryTests = [...testsById.values()]
      .filter((entry) => entry.gates.includes(gate))
      .map((entry) => entry.id)
      .sort();
    const declaredTests = requireArray(result.test_ids, `${gate} test_ids`);
    if (JSON.stringify(declaredTests) !== JSON.stringify(mandatoryTests)) {
      throw new CandidateError(`${gate} test_ids do not exactly cover its mandatory in-scope tests`);
    }
    const mandatoryEvidence = [...new Set(mandatoryTests.flatMap((testId) => {
      const projection = indexTests.get(testId);
      if (!projection) throw new CandidateError(`${gate} mandatory test ${testId} has no Evidence Index row`);
      return projection.evidence_ids;
    }))].sort();
    const linkedEvidence = requireArray(result.evidence_ids, `${gate} evidence_ids`);
    if (JSON.stringify(linkedEvidence) !== JSON.stringify(mandatoryEvidence)
      || linkedEvidence.some((id) => !evidenceIds.has(id))) {
      throw new CandidateError(`${gate} evidence_ids do not exactly cover its mandatory tests`);
    }
    if (typeof result.result_url !== "string" || !/^https:\/\//.test(result.result_url)) {
      throw new CandidateError(`${gate} result URL is missing`);
    }
    validateExecution(result.execution, `${gate} execution`);
    validateTimestampRange(result, gate);
  }
  return results;
}

async function readRegularContainedFile(root, relativePath) {
  const absoluteRoot = await realpath(root);
  let cursor = absoluteRoot;
  for (const segment of relativePath.split(/[\\/]/)) {
    cursor = path.resolve(cursor, segment);
    const stat = await lstat(cursor);
    if (stat.isSymbolicLink()) throw new CandidateError(`G7 package path contains symbolic link ${relativePath}`);
  }
  const resolved = await realpath(cursor);
  if (resolved !== absoluteRoot && !resolved.startsWith(`${absoluteRoot}${path.sep}`)) {
    throw new CandidateError("G7 package path resolves outside the release input directory");
  }
  if (!(await lstat(resolved)).isFile()) throw new CandidateError("G7 package path must resolve to a regular file");
  return readFile(resolved);
}

export async function validateG7Package(g7, candidateSha, packageSha256, inputRoot, options = {}) {
  if (g7.schema_version !== 1 || g7.gate !== "G7" || g7.candidate_sha !== candidateSha
    || g7.package_sha256 !== packageSha256 || g7.result !== "PASS") {
    throw new CandidateError("G7 package/policy input is stale or malformed");
  }
  requireFullSha(candidateSha);
  if (!HASH_PATTERN.test(packageSha256) || typeof g7.package_filename !== "string" || !g7.package_filename
    || typeof g7.release_label !== "string" || !g7.release_label) {
    throw new CandidateError("G7 package identity is incomplete");
  }
  if (typeof g7.package_path !== "string" || path.isAbsolute(g7.package_path)
    || g7.package_path.split(/[\\/]/).includes("..")) {
    throw new CandidateError("G7 package path must stay inside the release input directory");
  }
  const packageBytes = await readRegularContainedFile(inputRoot, g7.package_path);
  if (sha256(packageBytes) !== packageSha256) throw new CandidateError("G7 exact package hash mismatch");

  const builds = requireArray(g7.builds, "G7 builds");
  if (builds.length !== 2) throw new CandidateError("G7 requires exactly two clean builds");
  const canonicalAssets = JSON.stringify(builds[0]?.assets);
  for (const [index, build] of builds.entries()) {
    if (build.candidate_sha !== candidateSha || build.package_sha256 !== packageSha256
      || JSON.stringify(build.assets) !== canonicalAssets) {
      throw new CandidateError(`G7 build ${index + 1} is not byte-identical`);
    }
  }
  const assets = uniqueMap(builds[0].assets, "path", "G7 package assets");
  if (REQUIRED_PACKAGE_ASSETS.some((asset) => !assets.has(asset))
    || [...assets.keys()].some((asset) => !PACKAGE_ASSETS.has(asset))) {
    throw new CandidateError("G7 package assets violate the manifest/main.js/optional styles.css allowlist");
  }
  for (const asset of assets.values()) {
    if (!HASH_PATTERN.test(asset.sha256 ?? "")) throw new CandidateError(`G7 asset ${asset.path} has invalid hash`);
  }
  if (!options.repository) throw new CandidateError("G7 exact-object rebuild requires a candidate repository");
  const rebuilt = await (options.buildCandidate ?? buildDeterministicCandidatePackage)({
    repository: options.repository,
    candidateSha,
  });
  if (rebuilt.package_sha256 !== packageSha256
    || rebuilt.version !== g7.version
    || rebuilt.package_filename !== g7.package_filename
    || JSON.stringify(rebuilt.assets) !== canonicalAssets
    || JSON.stringify(rebuilt.builds) !== JSON.stringify(builds)) {
    throw new CandidateError("G7 package does not match the deterministic exact-Git-object rebuild");
  }

  const smoke = uniqueMap(g7.smoke_workflows, "id", "G7 smoke workflows");
  if (smoke.size !== REQUIRED_SMOKE.length || REQUIRED_SMOKE.some((id) => !smoke.has(id))) {
    throw new CandidateError("G7 must declare install, upgrade, disable, and uninstall smoke workflows");
  }
  for (const [id, result] of smoke) {
    if (result.result !== "PASS" || result.exact_package !== true
      || result.candidate_sha !== candidateSha || result.package_sha256 !== packageSha256) {
      throw new CandidateError(`G7 smoke workflow ${id} did not use the exact package`);
    }
    validateExecution(result.execution, `G7 smoke workflow ${id}`);
  }
  for (const field of ["license_present", "notices_present", "provenance_passed", "sbom_present", "banner_passed"] ) {
    if (g7.policy?.[field] !== true) throw new CandidateError(`G7 policy field ${field} must pass`);
  }
  const policyCheckedAt = Date.parse(g7.policy?.checked_at);
  const policyAge = Date.now() - policyCheckedAt;
  const forkPolicyAccepted = g7.policy?.fork_policy_status === "approved"
    || ((g7.release_label === "private preview" || g7.release_label === "private milestone")
      && g7.policy?.fork_policy_status === "not-applicable-private");
  if (!Number.isFinite(policyCheckedAt) || policyAge < -5 * 60 * 1000
    || policyAge > 7 * 24 * 60 * 60 * 1000
    || !/^https:\/\//.test(g7.policy?.official_policy_url ?? "")
    || g7.policy?.name_available !== true
    || !forkPolicyAccepted) {
    throw new CandidateError("G7 current Community policy/name/fork evidence is incomplete");
  }
  const releaseAssets = uniqueMap(g7.release_assets, "path", "G7 release assets");
  for (const required of ["LICENSE", "THIRD_PARTY_NOTICES.md"]) {
    if (!HASH_PATTERN.test(releaseAssets.get(required)?.sha256 ?? "")) {
      throw new CandidateError(`G7 release assets are missing ${required}`);
    }
  }
  return g7;
}

export function validateG9Signoff(
  signoff,
  candidateSha,
  packageSha256,
  scope,
  gateResults,
  expectedRequirementRevision,
  expectedEvidenceIdentity,
) {
  if (signoff.schema_version !== 1 || signoff.gate !== "G9" || signoff.candidate_sha !== candidateSha
    || signoff.package_sha256 !== packageSha256 || signoff.decision !== "GO") {
    throw new CandidateError("G9 signoff is missing GO on the exact candidate/package");
  }
  if (signoff.release_type !== "public" || scope.release_scope !== "public"
    || scope.excluded_requirement_ids.length !== 0 || signoff.remote_head !== candidateSha) {
    throw new CandidateError("G9 public parity requires a public scope with zero exclusions");
  }
  if (typeof signoff.version !== "string" || !signoff.version
    || typeof signoff.package_filename !== "string" || !signoff.package_filename
    || signoff.requirements?.upstream_count !== "114/114"
    || signoff.requirements?.active_count !== 126
    || !HASH_PATTERN.test(signoff.requirements?.revision_sha256 ?? "")
    || !HASH_PATTERN.test(signoff.evidence_bundle?.sha256 ?? "")
    || !/^https:\/\//.test(signoff.evidence_bundle?.index_url ?? "")) {
    throw new CandidateError("G9 release/package/requirements/evidence identity is incomplete");
  }
  if (!signoff.release || signoff.release.draft !== false || signoff.release.published !== true
    || signoff.release.target_sha !== candidateSha
    || signoff.release.tag !== signoff.version
    || !/^https:\/\/github\.com\/[^/]+\/[^/]+\/releases\/tag\//.test(signoff.release.url ?? "")) {
    throw new CandidateError("G9 requires a published non-draft release URL/tag targeting the exact candidate SHA");
  }
  if (expectedRequirementRevision
    && signoff.requirements.revision_sha256 !== expectedRequirementRevision) {
    throw new CandidateError("G9 requirement revision does not match the exact candidate object");
  }
  if (expectedEvidenceIdentity
    && (signoff.evidence_bundle.sha256 !== expectedEvidenceIdentity.bundle_sha256
      || signoff.evidence_bundle.index_sha256 !== expectedEvidenceIdentity.index_sha256)) {
    throw new CandidateError("G9 evidence bundle/index identities differ from the validated bundle");
  }
  if (JSON.stringify([...signoff.approved_deviation_ids].sort())
      !== JSON.stringify([...scope.approved_deviation_ids].sort())
    || JSON.stringify([...signoff.scope_exclusions].sort())
      !== JSON.stringify([...scope.excluded_requirement_ids].sort())) {
    throw new CandidateError("G9 deviations or exclusions differ from the frozen scope");
  }
  const linkedGates = uniqueMap(signoff.gate_results, "id", "G9 gate links");
  if (linkedGates.size !== GATES.length || GATES.some((gate) => !linkedGates.has(gate)
    || linkedGates.get(gate).result !== "PASS"
    || linkedGates.get(gate).candidate_sha !== candidateSha
    || linkedGates.get(gate).package_sha256 !== packageSha256)) {
    throw new CandidateError("G9 signoff must link passing G0-G9 results");
  }
  for (const gate of GATES.slice(0, 9)) {
    const durable = linkedGates.get(gate);
    const validated = gateResults.get(gate);
    if (!validated || durable.result_url !== validated.result_url
      || JSON.stringify(durable.test_ids) !== JSON.stringify(validated.test_ids)
      || JSON.stringify(durable.evidence_ids) !== JSON.stringify(validated.evidence_ids)) {
      throw new CandidateError(`G9 durable ${gate} link differs from the validated gate result`);
    }
  }
  if (linkedGates.get("G9").result_url !== signoff.release.url) {
    throw new CandidateError("G9 durable result must link the published release");
  }
  if (expectedEvidenceIdentity
    && (JSON.stringify(linkedGates.get("G9").test_ids) !== JSON.stringify(expectedEvidenceIdentity.g9_test_ids)
      || JSON.stringify(linkedGates.get("G9").evidence_ids) !== JSON.stringify(expectedEvidenceIdentity.g9_evidence_ids))) {
    throw new CandidateError("G9 durable result does not exactly cover its mandatory tests/evidence");
  }
  const workflows = uniqueMap(signoff.manual_workflows, "id", "G9 manual workflows");
  if (workflows.size !== REQUIRED_WORKFLOWS.length || REQUIRED_WORKFLOWS.some((id) => !workflows.has(id))) {
    throw new CandidateError("G9 signoff must contain the five representative workflows");
  }
  const dates = new Set();
  for (const [id, workflow] of workflows) {
    if (workflow.result !== "PASS" || workflow.candidate_sha !== candidateSha
      || workflow.package_sha256 !== packageSha256 || !/^\d{4}-\d{2}-\d{2}$/.test(workflow.local_date)) {
      throw new CandidateError(`G9 workflow ${id} is stale or incomplete`);
    }
    dates.add(workflow.local_date);
  }
  if (dates.size < 2) throw new CandidateError("G9 workflows must span at least two local calendar dates");
  const attestations = uniqueMap(signoff.attestations, "role", "G9 attestations");
  if (attestations.size !== REQUIRED_ATTESTATIONS.length
    || REQUIRED_ATTESTATIONS.some((role) => !attestations.has(role))) {
    throw new CandidateError("G9 signoff is missing a named attestation role");
  }
  for (const [role, attestation] of attestations) {
    if (typeof attestation.name !== "string" || !attestation.name.trim()
      || !Number.isFinite(Date.parse(attestation.timestamp)) || attestation.attested !== true) {
      throw new CandidateError(`G9 attestation ${role} is incomplete`);
    }
  }
  for (const phase of ["before", "after"]) {
    const state = signoff.repository_state?.[phase];
    if (!state || state.local_head !== candidateSha || state.tracking_head !== candidateSha
      || state.remote_head !== candidateSha || state.worktree !== "clean") {
      throw new CandidateError(`G9 ${phase} repository state violates the immutable same-SHA invariant`);
    }
  }
  return signoff;
}

export async function validateReleaseInputs({
  candidateSha,
  evidence,
  requirements,
  gateResults,
  g7,
  scope,
  signoff,
  inputRoot,
  repository,
}) {
  const requirementRows = new Map(requirements.requirements.map((row) => [row.id, row]));
  const partition = validateCandidateScope(scope, candidateSha, requirementRows);
  const gates = validateGateResults(gateResults, candidateSha, evidence.package_sha256, evidence.index, "G8", requirements.test_catalog);
  await validateG7Package(g7, candidateSha, evidence.package_sha256, inputRoot, { repository });
  if (scope.release_scope === "private" && partition.excluded.size === 0) {
    throw new CandidateError("G8 private acceptance must explicitly disclose open requirements");
  }
  if (scope.release_scope === "private"
    && g7.release_label !== "private preview" && g7.release_label !== "private milestone") {
    throw new CandidateError("G8 private package has an invalid release label");
  }
  if (scope.release_scope === "public") {
    validateG9Signoff(signoff, candidateSha, evidence.package_sha256, scope, gates, undefined, {
      bundle_sha256: evidence.manifestSha256,
      index_sha256: evidence.indexSha256,
      g9_test_ids: requirements.test_catalog.filter((entry) => entry.gates.includes("G9")).map((entry) => entry.id).sort(),
      g9_evidence_ids: [...new Set(requirements.test_catalog
        .filter((entry) => entry.gates.includes("G9"))
        .flatMap((entry) => evidence.index.tests.find((row) => row.test_id === entry.id)?.evidence_ids ?? []))].sort(),
    });
  } else if (signoff?.decision === "GO") {
    throw new CandidateError("a private candidate cannot receive public parity GO");
  }
  return { result: "PASS", gates: [...gates.keys()], release_scope: scope.release_scope };
}
