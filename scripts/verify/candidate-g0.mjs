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
import { validateJsonAgainstSchema } from "./json-schema.mjs";

const UPSTREAM_BASELINE = "973a041aa2f59f3b05bf31db8187efbfea07017a";
const DISPOSITIONS = new Set(["exact", "host-adapted", "approved-improvement", "not-applicable"]);
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const EVIDENCE_KINDS = new Set([
  "UNIT", "CONTRACT", "VAULT", "INTEGRATION", "SCREENSHOT",
  "KEYBOARD", "A11Y", "LIFECYCLE", "PACKAGE", "MANUAL",
]);
export const MANDATORY_PRIVATE_REQUIREMENT_IDS = Object.freeze([
  "OBS-SAFE-001",
  "OBS-LIFE-001",
  "OBS-LOCAL-001",
  "REL-001",
  "REL-002",
]);
const MANDATORY_PRIVATE_IDS = new Set(MANDATORY_PRIVATE_REQUIREMENT_IDS);
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
const RELEASE_INPUT_PREFIXES = [
  ".github/workflows/",
  "docs/parity/",
  "scripts/release/",
  "scripts/verify/",
  "tests/fixtures/",
  "tests/release/",
];
const RELEASE_INPUT_FILES = new Set([
  "docs/planning-github-graph.json",
  "docs/planning-local-links.json",
  "scripts/check-planning-docs.mjs",
  "scripts/generate-planning-local-links.mjs",
  "scripts/generate-requirement-owners.mjs",
]);
export const REQUIRED_TRANSITIVE_INPUT_PATHS = [
  "LICENSE",
  "THIRD_PARTY_NOTICES.md",
  "docs/decisions/community-compliant-product-naming-and-attribution.md",
  "docs/decisions/desktop-compatibility-and-performance-envelope.md",
  "docs/decisions/markdown-grammar-and-plan-item-identity.md",
  "docs/decisions/parity-acceptance-matrix-and-release-gates.md",
  "docs/decisions/plugin-architecture-and-state-ownership.md",
  "docs/decisions/timing-write-safety-conflict-handling-and-recovery.md",
  "docs/implementation-dossier.md",
  "docs/research/behavior-inventory.md",
];
export function expectedCandidateOwnedPaths(candidateFiles) {
  return candidateFiles.filter((path) => RELEASE_INPUT_FILES.has(path)
    || RELEASE_INPUT_PREFIXES.some((prefix) => path.startsWith(prefix))).sort();
}
const GATE_IDS = Array.from({ length: 10 }, (_, index) => `G${index}`);
export function acceptedEvidenceMatrix(requirementId) {
  if (requirementId.startsWith("REL-")) return { kinds: ["PACKAGE"], gates: ["G0", "G7", requirementId === "REL-003" ? "G9" : "G8"] };
  if (requirementId.startsWith("UP-DRF-")) return { kinds: ["CONTRACT"], gates: ["G0", "G2", "G8"] };
  if (requirementId === "OBS-TRACE-001") return { kinds: ["CONTRACT"], gates: ["G0"] };
  if (requirementId === "OBS-A11Y-001") return { kinds: ["KEYBOARD", "A11Y", "MANUAL"], gates: ["G5", "G6"] };
  if (requirementId === "OBS-I18N-001") return { kinds: ["CONTRACT", "SCREENSHOT", "MANUAL"], gates: ["G1", "G5", "G6"] };
  if (requirementId === "OBS-LOCAL-001") return { kinds: ["INTEGRATION"], gates: ["G4", "G7", "G8"] };
  const family = requirementId.split("-")[1];
  if (["INS", "SET"].includes(family) || requirementId === "OBS-LIFE-001") return { kinds: ["UNIT", "INTEGRATION", "LIFECYCLE", "PACKAGE", "MANUAL"], gates: ["G1", "G4", "G7", "G8"] };
  if (["PAR", "SCH", "DAY"].includes(family)) return { kinds: ["UNIT", "CONTRACT"], gates: ["G1", "G2"] };
  if (family === "HIS") return { kinds: ["UNIT", "VAULT", "INTEGRATION"], gates: ["G2", "G3"] };
  if (["VIS", "CTL", "CMP"].includes(family) || requirementId.startsWith("OBS-VIS")) return { kinds: ["CONTRACT", "INTEGRATION", "SCREENSHOT", "MANUAL"], gates: ["G4", "G5", "G6"] };
  if (family === "EXE") return { kinds: ["CONTRACT", "INTEGRATION", "KEYBOARD", "SCREENSHOT", "LIFECYCLE"], gates: ["G2", "G4", "G5", "G6"] };
  if (["CLK", "PER"].includes(family) || requirementId === "OBS-SAFE-001") return { kinds: ["UNIT", "CONTRACT", "VAULT", "INTEGRATION", "LIFECYCLE"], gates: requirementId === "OBS-SAFE-001" ? ["G2", "G3", "G4", "G8"] : ["G2", "G3", "G4"] };
  if (family === "CMD" || requirementId === "OBS-HOST-001") return { kinds: ["INTEGRATION", "KEYBOARD", "MANUAL"], gates: ["G4", "G5"] };
  if (["ERR", "ERX"].includes(family)) return { kinds: ["CONTRACT", "VAULT", "INTEGRATION", "A11Y"], gates: ["G2", "G3", "G4", "G5"] };
  throw new CandidateError(`no accepted evidence matrix for ${requirementId}`);
}

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
    if ((typeof value !== "string" && typeof value !== "number") || value === "" || result.has(value)) {
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

  const testsByRequirement = new Map([...rows.keys()].map((id) => [id, []]));
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
    const accepted = acceptedEvidenceMatrix(entry.requirement_id);
    if (JSON.stringify(gates) !== JSON.stringify(accepted.gates)) {
      throw new CandidateError(`${testId} differs from the accepted release-gate matrix`);
    }
    testsByRequirement.get(entry.requirement_id).push(entry);
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
    const expectedTests = testsByRequirement.get(id);
    if (JSON.stringify(rowTests) !== JSON.stringify(expectedTests.map((entry) => entry.id))) {
      throw new CandidateError(`${id} tests must exactly match its test catalog projection`);
    }
    const acceptedKinds = acceptedEvidenceMatrix(id).kinds;
    if (JSON.stringify(expectedTests.map((entry) => entry.evidence_kind)) !== JSON.stringify(acceptedKinds)) {
      throw new CandidateError(`${id} does not declare every accepted evidence modality exactly once`);
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

export function validateSchemaContract(schema, kind) {
  if (schema?.$schema !== "https://json-schema.org/draft/2020-12/schema"
    || schema.type !== "object" || schema.additionalProperties !== false) {
    throw new CandidateError(`${kind} schema is not a strict draft 2020-12 object schema`);
  }
  if (kind === "requirements") {
    const counts = schema.properties?.counts;
    const fixtureCatalog = schema.properties?.fixture_catalog;
    const testCatalog = schema.properties?.test_catalog;
    const environmentCatalog = schema.properties?.environment_catalog;
    const requirement = schema.$defs?.requirement;
    const testEntry = schema.$defs?.testEntry;
    const catalogEntry = schema.$defs?.catalogEntry;
    if (schema.properties?.$schema?.const !== "../../scripts/release/schemas/requirements.schema.json"
      || schema.properties?.schema_version?.const !== 1
      || schema.properties?.requirement_set?.const !== "UPSTREAM-MATRIX-v1+INITIAL-OBS-REL-v1"
      || schema.properties?.upstream_baseline_sha?.const !== UPSTREAM_BASELINE
      || schema.properties?.row_count?.const !== 126
      || counts?.type !== "object" || counts.additionalProperties !== false
      || counts.properties?.upstream?.const !== 114
      || counts.properties?.obsidian?.const !== 9
      || counts.properties?.release?.const !== 3
      || fixtureCatalog?.type !== "array" || fixtureCatalog.minItems !== 16
      || fixtureCatalog.items?.$ref !== "#/$defs/catalogEntry"
      || testCatalog?.type !== "array" || testCatalog.minItems !== 126
      || testCatalog.items?.$ref !== "#/$defs/testEntry"
      || environmentCatalog?.type !== "array" || environmentCatalog.minItems !== 9
      || environmentCatalog.maxItems !== 9 || environmentCatalog.items?.$ref !== "#/$defs/catalogEntry"
      || schema.properties?.requirements?.type !== "array"
      || schema.properties?.requirements?.items?.$ref !== "#/$defs/requirement"
      || schema.properties?.requirements?.minItems !== 126
      || schema.properties?.requirements?.maxItems !== 126
      || Object.hasOwn(testCatalog ?? {}, "maxItems")
      || catalogEntry?.type !== "object" || catalogEntry.additionalProperties !== false
      || testEntry?.type !== "object" || testEntry.additionalProperties !== false
      || requirement?.type !== "object" || requirement.additionalProperties !== false
      || !Array.isArray(testEntry?.properties?.evidence_kind?.enum)
      || JSON.stringify(testEntry.properties.evidence_kind.enum) !== JSON.stringify([...EVIDENCE_KINDS])) {
      throw new CandidateError("requirements schema does not encode the 126-row/open-test evidence contract");
    }
  } else if (kind === "owners") {
    const projection = schema.properties?.requirements;
    const ownership = schema.$defs?.ownership;
    if (schema.properties?.$schema?.const !== "./requirement-owners.schema.json"
      || schema.properties?.schema_version?.const !== 1
      || schema.properties?.requirement_set?.const !== "UPSTREAM-MATRIX-v1+INITIAL-OBS-REL-v1"
      || schema.properties?.row_count?.const !== 126
      || projection?.type !== "array" || projection.minItems !== 126 || projection.maxItems !== 126
      || projection.items?.$ref !== "#/$defs/ownership"
      || ownership?.type !== "object" || ownership.additionalProperties !== false
      || JSON.stringify(ownership.required) !== JSON.stringify([
        "id", "owner_ticket", "owner_module", "evidence_contributors",
      ])) {
      throw new CandidateError("requirement-owner schema does not require the exact owner projection");
    }
  } else if (kind === "boundaries") {
    const tickets = schema.properties?.tickets;
    const boundary = schema.$defs?.ticketBoundary;
    if (schema.properties?.$schema?.const !== "./ticket-boundaries.schema.json"
      || schema.properties?.schema_version?.const !== 1
      || schema.properties?.requirement_set?.const !== "UPSTREAM-MATRIX-v1+INITIAL-OBS-REL-v1"
      || tickets?.type !== "array" || tickets.minItems !== 15 || tickets.maxItems !== 15
      || tickets.items?.$ref !== "#/$defs/ticketBoundary"
      || boundary?.type !== "object" || boundary.additionalProperties !== false
      || JSON.stringify(boundary.required) !== JSON.stringify([
        "ticket", "allowed_module_boundaries", "allowed_external_boundaries", "primary_requirement_ids",
      ])) {
      throw new CandidateError("ticket-boundary schema does not require tickets #17 through #31");
    }
  }
}

function isInsideAllowedBoundary(ownerModule, allowedBoundary) {
  return allowedBoundary.endsWith("/")
    ? ownerModule.startsWith(allowedBoundary)
    : ownerModule === allowedBoundary;
}

export function validateOwnershipProjections(requirementRows, owners, boundaries) {
  const ownerRows = rowMap(owners.requirements, "id", "requirement owners");
  const ticketRows = rowMap(boundaries.tickets, "ticket", "ticket boundaries");
  if (owners.schema_version !== 1 || owners.row_count !== 126 || ownerRows.size !== 126
    || boundaries.schema_version !== 1 || ticketRows.size !== 15) {
    throw new CandidateError("owner or ticket-boundary projection has the wrong shape");
  }
  const reverseOwners = new Map();
  for (const ticket of ticketRows.values()) {
    for (const id of requireStrings(ticket.primary_requirement_ids, `ticket #${ticket.ticket} primary IDs`, true)) {
      if (reverseOwners.has(id)) throw new CandidateError(`${id} has duplicate ticket-boundary ownership`);
      reverseOwners.set(id, ticket.ticket);
    }
  }
  for (const [id, row] of requirementRows) {
    const owner = ownerRows.get(id);
    const ticket = ticketRows.get(row.owner_ticket);
    if (!owner || owner.owner_ticket !== row.owner_ticket || owner.owner_module !== row.owner_module
      || JSON.stringify(owner.evidence_contributors) !== JSON.stringify(row.evidence_contributors)
      || reverseOwners.get(id) !== row.owner_ticket) {
      throw new CandidateError(`${id} differs from its exact owner/ticket-boundary projection`);
    }
    const externalOwner = row.owner_module.startsWith("external:");
    const boundaryField = externalOwner ? "allowed_external_boundaries" : "allowed_module_boundaries";
    const allowedBoundaries = requireStrings(ticket?.[boundaryField], `ticket #${row.owner_ticket} ${boundaryField}`, true);
    const isAllowed = externalOwner
      ? allowedBoundaries.includes(row.owner_module)
      : allowedBoundaries.some((boundary) => isInsideAllowedBoundary(row.owner_module, boundary));
    if (!isAllowed) {
      throw new CandidateError(`${id} owner_module lies outside ticket #${row.owner_ticket} ${boundaryField}`);
    }
  }
  if (ownerRows.size !== requirementRows.size || reverseOwners.size !== requirementRows.size) {
    throw new CandidateError("owner and ticket-boundary projections must be bidirectionally set-equal");
  }
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
  nowMs,
}) {
  requireFullSha(candidateSha);
  const [requirementsBytes, deviationsBytes, releaseInputs, scopeSource, candidateFiles,
    requirementsSchema, owners, ownersSchema, boundaries, boundariesSchema] = await Promise.all([
    readCandidateFile(repository, candidateSha, "docs/parity/requirements.json"),
    readCandidateFile(repository, candidateSha, "docs/parity/deviations.json"),
    readCandidateJson(repository, candidateSha, "scripts/release/release-inputs.json"),
    readFile(scopePath, "utf8"),
    listCandidateFiles(repository, candidateSha),
    readCandidateJson(repository, candidateSha, "scripts/release/schemas/requirements.schema.json"),
    readCandidateJson(repository, candidateSha, "docs/parity/requirement-owners.json"),
    readCandidateJson(repository, candidateSha, "docs/parity/requirement-owners.schema.json"),
    readCandidateJson(repository, candidateSha, "docs/parity/ticket-boundaries.json"),
    readCandidateJson(repository, candidateSha, "docs/parity/ticket-boundaries.schema.json"),
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
  const expectedOwned = expectedCandidateOwnedPaths(candidateFiles);
  if (releaseInputs.schema_version !== 1
    || JSON.stringify(releaseInputs.candidate_owned) !== JSON.stringify(expectedOwned)
    || JSON.stringify(releaseInputs.transitive_inputs) !== JSON.stringify(REQUIRED_TRANSITIVE_INPUT_PATHS)
    || REQUIRED_TRANSITIVE_INPUT_PATHS.some((path) => !candidateFiles.includes(path))) {
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
  validateSchemaContract(requirementsSchema, "requirements");
  validateSchemaContract(ownersSchema, "owners");
  validateSchemaContract(boundariesSchema, "boundaries");
  validateJsonAgainstSchema(requirements, requirementsSchema, "requirements.json");
  validateJsonAgainstSchema(owners, ownersSchema, "requirement-owners.json");
  validateJsonAgainstSchema(boundaries, boundariesSchema, "ticket-boundaries.json");
  const requirementRows = validateRequirementManifest(requirements, deviations);
  validateOwnershipProjections(requirementRows, owners, boundaries);
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
    requiredEnvironmentIds: scope.release_scope === "private"
      ? ["ENV-PURE", "ENV-VIS", "ENV-HOST-PRIVATE"]
      : REQUIRED_ENVIRONMENT_IDS,
    nowMs,
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
    included_requirement_ids: [...scopePartition.included],
    excluded_requirement_ids: [...scopePartition.excluded],
    candidate_state: candidateState,
  };
}
