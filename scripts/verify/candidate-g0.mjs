import { readFile } from "node:fs/promises";

import {
  assertPushedCandidate,
  CandidateError,
  listCandidateFiles,
  readCandidateJson,
  requireFullSha,
} from "./candidate-object.mjs";
import { validateCandidateEvidenceBundle } from "./candidate-evidence.mjs";

const UPSTREAM_BASELINE = "973a041aa2f59f3b05bf31db8187efbfea07017a";
const DISPOSITIONS = new Set(["exact", "host-adapted", "approved-improvement", "not-applicable"]);
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
      if (!tests.has(testId)) throw new CandidateError(`${id} has dangling test ${testId}`);
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

export function validateCandidateScope(scope, candidateSha, requirementRows) {
  if (scope.schema_version !== 1 || scope.candidate_sha !== candidateSha) {
    throw new CandidateError("scope manifest schema or candidate SHA is stale");
  }
  if (scope.release_kind !== "private" && scope.release_kind !== "public") {
    throw new CandidateError("scope release_kind must be private or public");
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
  if (scope.release_kind === "public" && excluded.length !== 0) {
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
  const [requirements, deviations, releaseInputs, scopeSource, candidateFiles] = await Promise.all([
    readCandidateJson(repository, candidateSha, "docs/parity/requirements.json"),
    readCandidateJson(repository, candidateSha, "docs/parity/deviations.json"),
    readCandidateJson(repository, candidateSha, "scripts/release/release-inputs.json"),
    readFile(scopePath, "utf8"),
    listCandidateFiles(repository, candidateSha),
  ]);
  let scope;
  try {
    scope = JSON.parse(scopeSource);
  } catch (error) {
    throw new CandidateError(`scope manifest is malformed JSON: ${error.message}`);
  }
  if (releaseInputs.schema_version !== 1 || releaseInputs.gates?.length !== 10) {
    throw new CandidateError("candidate release input declaration is malformed");
  }
  for (const requiredInput of ["scripts/release/release-inputs.json", ...releaseInputs.candidate_owned]) {
    if (!candidateFiles.includes(requiredInput)) {
      throw new CandidateError(`candidate is missing release input ${requiredInput}`);
    }
  }
  const requirementRows = validateRequirementManifest(requirements, deviations);
  const scopePartition = validateCandidateScope(scope, candidateSha, requirementRows);
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
  if (scope.release_kind === "public") {
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
    release_kind: scope.release_kind,
    requirement_count: requirementRows.size,
    upstream_count: [...requirementRows].filter(([id]) => id.startsWith("UP-")).length,
    candidate_state: candidateState,
  };
}
