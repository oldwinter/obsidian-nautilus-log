import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import {
  assertPushedCandidate,
  CandidateError,
  listCandidateFiles,
  readCandidateFile,
  readCandidateJson,
  requireFullSha,
} from "./candidate-object.mjs";
import { validateCandidateEvidenceBundle } from "./candidate-evidence.mjs";

const UPSTREAM_BASELINE = "973a041aa2f59f3b05bf31db8187efbfea07017a";
const DISPOSITIONS = new Set(["exact", "host-adapted", "approved-improvement", "not-applicable"]);
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const EVIDENCE_KINDS = new Set([
  "UNIT", "CONTRACT", "VAULT", "INTEGRATION", "SCREENSHOT",
  "KEYBOARD", "A11Y", "LIFECYCLE", "PACKAGE", "MANUAL",
]);
const MANDATORY_PRIVATE_IDS = new Set([
  "OBS-SAFE-001",
  "OBS-LIFE-001",
  "OBS-LOCAL-001",
  "REL-001",
  "REL-002",
]);
const INITIAL_NATIVE_IDS = [
  "OBS-TRACE-001",
  "OBS-HOST-001",
  "OBS-VIS-001",
  "OBS-VIS-002",
  "OBS-A11Y-001",
  "OBS-SAFE-001",
  "OBS-LIFE-001",
  "OBS-I18N-001",
  "OBS-LOCAL-001",
  "REL-001",
  "REL-002",
  "REL-003",
];
const REQUIRED_FIXTURE_IDS = Array.from({ length: 16 }, (_, index) => `FX-${String(index + 1).padStart(2, "0")}`);
const REQUIRED_ENVIRONMENT_IDS = [
  "ENV-PURE",
  "ENV-VIS",
  "ENV-HOST-PRIVATE",
  "ENV-HOST-MIN",
  "ENV-HOST-MAC",
  "ENV-HOST-WIN",
  "ENV-HOST-LINUX",
  "ENV-THEME",
  "ENV-A11Y",
];
export const REQUIRED_RELEASE_INPUT_PATHS = [
  "docs/parity/deviations.json",
  "docs/parity/requirement-owners.json",
  "docs/parity/requirement-owners.schema.json",
  "docs/parity/requirements.json",
  "docs/parity/scope.schema.json",
  "docs/parity/ticket-boundaries.json",
  "docs/parity/ticket-boundaries.schema.json",
  "docs/parity/trace-reports/README.md",
  "scripts/release/build-candidate.mjs",
  "scripts/release/dry-run.mjs",
  "scripts/release/g7-package.template.json",
  "scripts/release/g8-scope.template.json",
  "scripts/release/g9-signoff.template.json",
  "scripts/release/release-inputs.json",
  "scripts/release/run-gate.mjs",
  "scripts/release/schemas/requirements.schema.json",
  "scripts/verify/candidate-evidence.mjs",
  "scripts/verify/candidate-g0.mjs",
  "scripts/verify/candidate-object.mjs",
  "scripts/verify/candidate-package.mjs",
  "scripts/verify/candidate-release.mjs",
  "scripts/verify/evidence-bundle.mjs",
  "scripts/verify/evidence-schema.mjs",
  "scripts/verify/render-trace-report.mjs",
  "scripts/verify/verify-evidence.mjs",
];
const GATE_IDS = Array.from({ length: 10 }, (_, index) => `G${index}`);
const ACCEPTED_GATE_MAPPINGS = new Map([
  ...Array.from({ length: 9 }, (_, index) => [
    `UP-DRF-${String(index + 1).padStart(2, "0")}`,
    ["G0", "G2", "G8"],
  ]),
  ["OBS-LOCAL-001", ["G4", "G7", "G8"]],
  ["OBS-LIFE-001", ["G1", "G4", "G7", "G8"]],
  ["OBS-SAFE-001", ["G2", "G3", "G4", "G8"]],
  ["OBS-I18N-001", ["G1", "G5", "G6"]],
  ["OBS-HOST-001", ["G4", "G5"]],
  ["OBS-VIS-001", ["G4", "G5", "G6"]],
  ["OBS-VIS-002", ["G4", "G5", "G6"]],
]);

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function expand(prefix, count) {
  return Array.from({ length: count }, (_, index) => `UP-${prefix}-${String(index + 1).padStart(2, "0")}`);
}

export const REQUIRED_REQUIREMENT_IDS = [
  ...expand("INS", 5),
  ...expand("SET", 13),
  ...expand("PAR", 12),
  ...expand("SCH", 7),
  ...expand("DAY", 4),
  ...expand("HIS", 5),
  ...expand("VIS", 7),
  ...expand("CTL", 5),
  ...expand("CMP", 3),
  ...expand("EXE", 13),
  ...expand("CLK", 10),
  ...expand("CMD", 2),
  ...expand("PER", 2),
  ...expand("ERR", 9),
  ...expand("ERX", 8),
  ...expand("DRF", 9),
  ...INITIAL_NATIVE_IDS,
];

function requireArray(value, label) {
  if (!Array.isArray(value)) throw new CandidateError(`${label} must be an array`);
  return value;
}

function requireStrings(value, label, allowEmpty = false) {
  const values = requireArray(value, label);
  if ((!allowEmpty && values.length === 0)
    || values.some((entry) => typeof entry !== "string" || entry.trim() === "")) {
    throw new CandidateError(`${label} must contain${allowEmpty ? " only" : " one or more"} non-empty strings`);
  }
  if (new Set(values).size !== values.length) throw new CandidateError(`${label} contains duplicates`);
  return values;
}

function rowMap(rows, key, label) {
  const result = new Map();
  for (const row of requireArray(rows, label)) {
    const value = row?.[key];
    if (typeof value !== "string" || !value || result.has(value)) {
      throw new CandidateError(`${label} contains a missing or duplicate ${key}: ${String(value)}`);
    }
    result.set(value, row);
  }
  return result;
}

function approvalIsComplete(entry) {
  if (!entry || entry.status !== "approved") return false;
  const approvals = Array.isArray(entry.approvals)
    ? entry.approvals
    : Object.entries(entry.approvals ?? {}).map(([role, value]) => ({ role, ...value }));
  const roles = new Set(
    approvals
      .filter((approval) => approval && typeof approval.reviewer === "string"
        && approval.reviewer.trim() && !Number.isNaN(Date.parse(approval.approved_at)))
      .map((approval) => String(approval.role).replaceAll("_", "-").toLowerCase()),
  );
  const parity = [...roles].some((role) => role.includes("parity"));
  const release = [...roles].some((role) => role.includes("release") || role.includes("product"));
  return parity && release;
}

function notApplicableApprovalIsComplete(entry, requirementId) {
  return entry?.status === "approved"
    && Array.isArray(entry.requirement_ids)
    && entry.requirement_ids.length === 1
    && entry.requirement_ids[0] === requirementId
    && typeof entry.reason === "string"
    && entry.reason.trim() !== ""
    && typeof entry.reviewer === "string"
    && entry.reviewer.trim() !== ""
    && !Number.isNaN(Date.parse(entry.approved_at))
    && Array.isArray(entry.source_refs)
    && entry.source_refs.length > 0;
}

export function validateRequirementManifest(manifest, deviations) {
  if (manifest.schema_version !== 1 || manifest.upstream_baseline_sha !== UPSTREAM_BASELINE) {
    throw new CandidateError("requirements manifest schema or upstream baseline is invalid");
  }
  if (manifest.row_count !== 126 || manifest.requirements?.length !== 126) {
    throw new CandidateError("requirements manifest must contain exactly 126 rows");
  }
  if (manifest.$schema !== "../../scripts/release/schemas/requirements.schema.json") {
    throw new CandidateError("requirements manifest must reference the release requirements schema");
  }
  const rows = rowMap(manifest.requirements, "id", "requirements");
  if (rows.size !== REQUIRED_REQUIREMENT_IDS.length
    || REQUIRED_REQUIREMENT_IDS.some((id) => !rows.has(id))) {
    throw new CandidateError("requirements manifest does not contain the exact 114 UP and 12 OBS/REL ID partition");
  }
  const fixtures = rowMap(manifest.fixture_catalog, "id", "fixture catalog");
  const tests = rowMap(manifest.test_catalog, "id", "test catalog");
  const environments = rowMap(manifest.environment_catalog, "id", "environment catalog");
  if (REQUIRED_FIXTURE_IDS.some((id) => !fixtures.has(id))) {
    throw new CandidateError("fixture catalog is missing one or more fixed FX-01 through FX-16 IDs");
  }
  if (REQUIRED_ENVIRONMENT_IDS.some((id) => !environments.has(id))) {
    throw new CandidateError("environment catalog is missing a required release profile");
  }
  const deviationRows = rowMap(deviations.deviations, "id", "deviations");
  const notApplicableRows = rowMap(
    deviations.not_applicable_approvals,
    "id",
    "not-applicable approvals",
  );
  const usedDeviations = new Set();
  const usedNotApplicableApprovals = new Set();

  for (const [testId, entry] of tests) {
    if (!rows.has(entry.requirement_id)) {
      throw new CandidateError(`${testId} links unknown requirement ${String(entry.requirement_id)}`);
    }
    if (!EVIDENCE_KINDS.has(entry.evidence_kind)) {
      throw new CandidateError(`${testId} has unsupported evidence kind ${String(entry.evidence_kind)}`);
    }
    const gates = requireStrings(entry.gates, `${testId} gates`);
    if (gates.some((gate) => !GATE_IDS.includes(gate))) {
      throw new CandidateError(`${testId} has an unknown release gate`);
    }
    const acceptedGates = ACCEPTED_GATE_MAPPINGS.get(entry.requirement_id);
    if (acceptedGates && JSON.stringify(gates) !== JSON.stringify(acceptedGates)) {
      throw new CandidateError(`${testId} differs from the accepted release-gate matrix`);
    }
    if (entry.requirement_id === "OBS-LOCAL-001" && entry.evidence_kind !== "INTEGRATION") {
      throw new CandidateError(`${testId} must use accepted INTEGRATION evidence`);
    }
  }

  for (const [id, row] of rows) {
    for (const field of ["owner_module", "statement"]) {
      if (typeof row[field] !== "string" || !row[field].trim()) {
        throw new CandidateError(`${id} has missing ${field}`);
      }
    }
    if (!Number.isInteger(row.owner_ticket) || row.owner_ticket < 17 || row.owner_ticket > 31) {
      throw new CandidateError(`${id} has invalid owner_ticket`);
    }
    if (row.status !== "active") throw new CandidateError(`${id} must be active in the initial manifest`);
    if (!DISPOSITIONS.has(row.disposition)) {
      throw new CandidateError(`${id} has failing disposition ${String(row.disposition)}`);
    }
    const sourceRefs = requireStrings(row.source_refs, `${id} source_refs`);
    if (sourceRefs.some((sourceRef) => !/^https:\/\/[^\s]+\/blob\/[0-9a-f]{40}\//.test(sourceRef))) {
      throw new CandidateError(`${id} has a non-immutable source reference`);
    }
    const rowFixtures = requireStrings(row.fixtures, `${id} fixtures`);
    const rowTests = requireStrings(row.tests, `${id} tests`);
    const rowEnvironments = requireStrings(row.environments, `${id} environments`);
    requireStrings(row.evidence, `${id} repository evidence`, true);
    if (row.evidence.length !== 0) {
      throw new CandidateError(`${id} repository template must leave evidence empty for exact-candidate resolution`);
    }
    for (const fixtureId of rowFixtures) {
      if (!fixtures.has(fixtureId)) throw new CandidateError(`${id} has dangling fixture ${fixtureId}`);
    }
    for (const testId of rowTests) {
      if (!tests.has(testId) || tests.get(testId).requirement_id !== id) {
        throw new CandidateError(`${id} has dangling or mislinked test ${testId}`);
      }
    }
    for (const environmentId of rowEnvironments) {
      if (!environments.has(environmentId)) throw new CandidateError(`${id} has dangling environment ${environmentId}`);
    }

    if (row.disposition === "host-adapted" || row.disposition === "approved-improvement") {
      const deviation = deviationRows.get(row.deviation_id);
      if (!approvalIsComplete(deviation) || !deviation.requirement_ids?.includes(id)) {
        throw new CandidateError(`${id} lacks a concrete approved deviation`);
      }
      usedDeviations.add(row.deviation_id);
    } else if (row.deviation_id !== undefined) {
      throw new CandidateError(`${id} has an inapplicable deviation_id`);
    }
    if (row.disposition === "not-applicable") {
      const approval = notApplicableRows.get(row.not_applicable_approval_id);
      if (!notApplicableApprovalIsComplete(approval, id)) {
        throw new CandidateError(`${id} lacks a reviewed not-applicable approval`);
      }
      usedNotApplicableApprovals.add(row.not_applicable_approval_id);
    } else if (row.not_applicable_approval_id !== undefined) {
      throw new CandidateError(`${id} has an inapplicable not_applicable_approval_id`);
    }
  }
  if (usedDeviations.size !== deviationRows.size) {
    throw new CandidateError("deviation registry contains an unlinked or unapproved row");
  }
  if (usedNotApplicableApprovals.size !== notApplicableRows.size) {
    throw new CandidateError("not-applicable registry contains an unlinked approval");
  }
  return rows;
}

export function validateCandidateScope(
  scope,
  candidateSha,
  requirementRows,
  expectedHashes = {},
) {
  const expectedKeys = [
    "schema_version",
    "candidate_sha",
    "requirements_sha256",
    "deviations_sha256",
    "release_scope",
    "parity_claim",
    "included_requirement_ids",
    "excluded_requirement_ids",
    "approved_deviation_ids",
  ];
  if (!scope || typeof scope !== "object" || Array.isArray(scope)
    || JSON.stringify(Object.keys(scope).sort()) !== JSON.stringify([...expectedKeys].sort())) {
    throw new CandidateError("scope manifest must contain exactly the canonical scope fields");
  }
  if (scope.schema_version !== 1 || scope.candidate_sha !== candidateSha) {
    throw new CandidateError("scope manifest schema or candidate SHA is stale");
  }
  if (!SHA256_PATTERN.test(scope.requirements_sha256)
    || !SHA256_PATTERN.test(scope.deviations_sha256)) {
    throw new CandidateError("scope requirement and deviation hashes must be full SHA-256 values");
  }
  if (expectedHashes.requirementsSha256
    && scope.requirements_sha256 !== expectedHashes.requirementsSha256) {
    throw new CandidateError("scope requirements_sha256 does not match the exact candidate Git object bytes");
  }
  if (expectedHashes.deviationsSha256
    && scope.deviations_sha256 !== expectedHashes.deviationsSha256) {
    throw new CandidateError("scope deviations_sha256 does not match the exact candidate Git object bytes");
  }
  if (scope.release_scope !== "private" && scope.release_scope !== "public") {
    throw new CandidateError("scope release_scope must be private or public");
  }
  const expectedClaim = scope.release_scope === "public" ? "v1.0.2-parity" : "private-preview";
  if (scope.parity_claim !== expectedClaim) {
    throw new CandidateError(`scope parity_claim must be ${expectedClaim} for ${scope.release_scope}`);
  }
  const included = requireStrings(scope.included_requirement_ids, "scope included IDs");
  const excluded = requireStrings(scope.excluded_requirement_ids, "scope excluded IDs", true);
  requireStrings(scope.approved_deviation_ids, "scope approved deviations", true);
  const includedSet = new Set(included);
  const excludedSet = new Set(excluded);
  for (const id of [...included, ...excluded]) {
    if (!requirementRows.has(id)) throw new CandidateError(`scope contains unknown requirement ${id}`);
  }
  if ([...includedSet].some((id) => excludedSet.has(id))
    || includedSet.size + excludedSet.size !== requirementRows.size
    || [...requirementRows.keys()].some((id) => !includedSet.has(id) && !excludedSet.has(id))) {
    throw new CandidateError("scope included/excluded IDs must be an exact partition of active requirements");
  }
  if (scope.release_scope === "public" && excluded.length !== 0) {
    throw new CandidateError("public scope cannot exclude an active requirement");
  }
  for (const id of MANDATORY_PRIVATE_IDS) {
    if (!includedSet.has(id)) throw new CandidateError(`scope cannot exclude mandatory requirement ${id}`);
  }
  return { included: includedSet, excluded: excludedSet };
}

export async function validateG0({
  repository,
  candidateSha,
  branch,
  scopePath,
  bundleRoot,
  checkPushedState = true,
}) {
  requireFullSha(candidateSha);
  const [requirementsBytes, deviationsBytes, releaseInputs, scopeSource, candidateFiles] = await Promise.all([
    readCandidateFile(repository, candidateSha, "docs/parity/requirements.json"),
    readCandidateFile(repository, candidateSha, "docs/parity/deviations.json"),
    readCandidateJson(repository, candidateSha, "scripts/release/release-inputs.json"),
    readFile(scopePath, "utf8"),
    listCandidateFiles(repository, candidateSha),
  ]);
  let requirements;
  let deviations;
  let scope;
  try {
    requirements = JSON.parse(requirementsBytes);
    deviations = JSON.parse(deviationsBytes);
    scope = JSON.parse(scopeSource);
  } catch (error) {
    throw new CandidateError(`candidate release contract is malformed JSON: ${error.message}`);
  }
  if (releaseInputs.schema_version !== 1
    || JSON.stringify(releaseInputs.candidate_owned) !== JSON.stringify(REQUIRED_RELEASE_INPUT_PATHS)) {
    throw new CandidateError("candidate release input declaration is malformed");
  }
  const gates = rowMap(releaseInputs.gates, "id", "release gates");
  if (gates.size !== GATE_IDS.length || GATE_IDS.some((id) => {
    const gate = gates.get(id);
    return !gate || JSON.stringify(gate.command) !== JSON.stringify([
      "node", "scripts/release/run-gate.mjs", "--gate", id,
    ]);
  })) {
    throw new CandidateError("candidate release gates must declare unique exact G0-G9 commands");
  }
  for (const requiredInput of releaseInputs.candidate_owned) {
    if (!candidateFiles.includes(requiredInput)) {
      throw new CandidateError(`candidate is missing release input ${requiredInput}`);
    }
  }
  const requirementRows = validateRequirementManifest(requirements, deviations);
  const scopePartition = validateCandidateScope(scope, candidateSha, requirementRows, {
    requirementsSha256: sha256(requirementsBytes),
    deviationsSha256: sha256(deviationsBytes),
  });
  const requiredDeviationIds = [...requirementRows.values()]
    .filter((row) => row.disposition === "host-adapted" || row.disposition === "approved-improvement")
    .map((row) => row.deviation_id)
    .sort();
  if (JSON.stringify([...scope.approved_deviation_ids].sort()) !== JSON.stringify(requiredDeviationIds)) {
    throw new CandidateError("scope approved deviations do not match the candidate requirement dispositions");
  }
  const evidence = await validateCandidateEvidenceBundle({
    repository,
    candidateSha,
    bundleRoot,
    candidateRequirements: requirements,
    requiredRequirementIds: scopePartition.included,
  });
  for (const id of scopePartition.included) {
    if (!evidence.index.requirements.some((entry) => entry.requirement_id === id)) {
      throw new CandidateError(`in-scope requirement ${id} has no Evidence Index row`);
    }
  }
  if (scope.release_scope === "public") {
    const serialized = JSON.stringify(requirements);
    if (serialized.includes("MIN_SUPPORTED") || serialized.includes("CURRENT_STABLE")) {
      throw new CandidateError("public candidate contains unresolved environment version tokens");
    }
    const observedProfiles = new Set([...evidence.records.values()].map((record) => record.environment.profile_id));
    if (REQUIRED_ENVIRONMENT_IDS.some((id) => !observedProfiles.has(id))) {
      throw new CandidateError("public candidate lacks exact evidence for a required environment profile");
    }
    const hostProfiles = new Set(["ENV-HOST-MIN", "ENV-HOST-MAC", "ENV-HOST-WIN", "ENV-HOST-LINUX"]);
    for (const record of evidence.records.values()) {
      if (!hostProfiles.has(record.environment.profile_id)) continue;
      for (const tool of ["obsidian", "electron", "chromium"]) {
        const version = record.environment.tool_versions[tool];
        if (typeof version !== "string" || !/\d/.test(version)
          || /latest|current|minimum|stable/i.test(version)) {
          throw new CandidateError(`${record.evidence_id} does not resolve exact ${tool} version`);
        }
      }
    }
    if (![...evidence.records.values()].some((record) => record.record_type === "performance")) {
      throw new CandidateError("public candidate has no exact performance evidence record");
    }
  }
  const candidateState = checkPushedState
    ? await assertPushedCandidate(repository, candidateSha, branch)
    : null;
  return {
    gate: "G0",
    result: "PASS",
    candidate_sha: candidateSha,
    package_sha256: evidence.package_sha256,
    release_scope: scope.release_scope,
    requirement_count: requirementRows.size,
    upstream_count: [...requirementRows].filter(([id]) => id.startsWith("UP-")).length,
    candidate_state: candidateState,
  };
}
