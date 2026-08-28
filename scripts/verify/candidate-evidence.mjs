import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import path from "node:path";

import { candidateBlobOid, CandidateError, requireFullSha } from "./candidate-object.mjs";

const HASH_PATTERN = /^[0-9a-f]{64}$/;

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
      throw new CandidateError(`${label} contains a missing or duplicate ${key}: ${String(value)}`);
    }
    result.set(value, row);
  }
  return result;
}

async function bundleFile(bundleRoot, relativePath) {
  if (typeof relativePath !== "string" || !relativePath || path.isAbsolute(relativePath)) {
    throw new CandidateError(`invalid evidence bundle path ${String(relativePath)}`);
  }
  const root = await realpath(bundleRoot);
  let resolved;
  try {
    resolved = await realpath(path.resolve(root, relativePath));
  } catch (error) {
    throw new CandidateError(`missing evidence bundle file ${relativePath}: ${error.message}`);
  }
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new CandidateError(`evidence bundle path escapes bundle root: ${relativePath}`);
  }
  return readFile(resolved);
}

async function bundleJson(bundleRoot, relativePath) {
  const bytes = await bundleFile(bundleRoot, relativePath);
  try {
    return { bytes, value: JSON.parse(bytes) };
  } catch (error) {
    throw new CandidateError(`${relativePath} is malformed JSON: ${error.message}`);
  }
}

function sameStrings(left, right) {
  return JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());
}

function normalizedRequirements(manifest) {
  return {
    ...manifest,
    requirements: manifest.requirements.map((row) => ({ ...row, evidence: [] })),
  };
}

function requirePassExecution(record, label) {
  if (record.result !== "PASS") throw new CandidateError(`${label} result must be PASS`);
  const execution = record.execution;
  if (!execution || execution.attempts !== 1 || execution.retries !== 0) {
    throw new CandidateError(`${label} must use one attempt and zero retries`);
  }
  for (const field of ["skipped", "quarantined", "expected_failure"]) {
    if (execution[field] !== false) throw new CandidateError(`${label} ${field} must be false`);
  }
}

export async function validateCandidateEvidenceBundle({
  repository,
  candidateSha,
  bundleRoot,
  candidateRequirements,
  requirementsPath = "docs/parity/requirements.json",
  requiredRequirementIds,
}) {
  requireFullSha(candidateSha);
  const { value: manifest } = await bundleJson(bundleRoot, "manifest.json");
  if (manifest.schema_version !== 1 || manifest.candidate_sha !== candidateSha) {
    throw new CandidateError("evidence manifest schema or candidate SHA is stale");
  }
  if (!HASH_PATTERN.test(manifest.package?.sha256 ?? "")) {
    throw new CandidateError("evidence manifest package hash is missing or malformed");
  }

  const fileRows = uniqueMap(manifest.files, "path", "evidence manifest files");
  for (const [filePath, descriptor] of fileRows) {
    if (!HASH_PATTERN.test(descriptor.sha256 ?? "")) {
      throw new CandidateError(`evidence manifest file ${filePath} has a malformed hash`);
    }
    const bytes = await bundleFile(bundleRoot, filePath);
    if (sha256(bytes) !== descriptor.sha256) {
      throw new CandidateError(`evidence manifest file ${filePath} hash mismatch`);
    }
  }
  const packageDescriptor = fileRows.get(manifest.package.path);
  if (!packageDescriptor || packageDescriptor.sha256 !== manifest.package.sha256
    || packageDescriptor.role !== "package") {
    throw new CandidateError("evidence manifest package descriptor is missing or inconsistent");
  }

  if (!manifest.index || !fileRows.has(manifest.index.path)) {
    throw new CandidateError("evidence manifest index is missing from files");
  }
  const indexDescriptor = fileRows.get(manifest.index.path);
  if (indexDescriptor.sha256 !== manifest.index.sha256 || indexDescriptor.role !== "index") {
    throw new CandidateError("evidence index descriptor is inconsistent");
  }
  if (!manifest.requirements || !fileRows.has(manifest.requirements.path)) {
    throw new CandidateError("resolved requirements are missing from evidence files");
  }
  const requirementsDescriptor = fileRows.get(manifest.requirements.path);
  if (requirementsDescriptor.sha256 !== manifest.requirements.sha256
    || requirementsDescriptor.role !== "requirements") {
    throw new CandidateError("resolved requirements descriptor is inconsistent");
  }
  if (manifest.requirements.source_path !== requirementsPath) {
    throw new CandidateError("resolved requirements source path is not the candidate manifest path");
  }
  const expectedBlobOid = await candidateBlobOid(repository, candidateSha, requirementsPath);
  if (manifest.requirements.source_blob_oid !== expectedBlobOid) {
    throw new CandidateError("resolved requirements source blob does not belong to the exact candidate");
  }

  const [{ value: index }, { value: resolvedRequirements }] = await Promise.all([
    bundleJson(bundleRoot, manifest.index.path),
    bundleJson(bundleRoot, manifest.requirements.path),
  ]);
  if (index.schema_version !== 1 || index.candidate_sha !== candidateSha) {
    throw new CandidateError("evidence index schema or candidate SHA is stale");
  }
  if (index.package_sha256 !== manifest.package.sha256) {
    throw new CandidateError("evidence index package hash does not match manifest");
  }
  if (JSON.stringify(normalizedRequirements(resolvedRequirements)) !== JSON.stringify(candidateRequirements)) {
    throw new CandidateError("resolved requirements differ from the exact candidate outside evidence arrays");
  }

  const candidateRows = uniqueMap(candidateRequirements.requirements, "id", "candidate requirements");
  const resolvedRows = uniqueMap(resolvedRequirements.requirements, "id", "resolved requirements");
  const recordIndex = uniqueMap(index.records, "evidence_id", "evidence index records");
  const requirementIndex = uniqueMap(index.requirements, "requirement_id", "evidence requirement index");
  const testIndex = uniqueMap(index.tests, "test_id", "evidence test index");
  const records = new Map();

  if ([...requirementIndex.keys()].some((id) => !candidateRows.has(id))) {
    throw new CandidateError("evidence requirement index contains an unknown requirement");
  }

  for (const [evidenceId, descriptor] of recordIndex) {
    if (!fileRows.has(descriptor.path) || fileRows.get(descriptor.path).sha256 !== descriptor.sha256) {
      throw new CandidateError(`evidence record ${evidenceId} has a dangling file reference`);
    }
    const { value: record } = await bundleJson(bundleRoot, descriptor.path);
    if (record.evidence_id !== evidenceId || record.candidate_sha !== candidateSha) {
      throw new CandidateError(`evidence record ${evidenceId} is stale or misidentified`);
    }
    if (record.package_sha256 !== manifest.package.sha256) {
      throw new CandidateError(`evidence record ${evidenceId} package hash is stale`);
    }
    if (!evidenceId.startsWith(`E-${candidateSha.slice(0, 12)}-`)) {
      throw new CandidateError(`evidence record ${evidenceId} does not encode the candidate prefix`);
    }
    if (descriptor.record_type !== record.record_type
      || !sameStrings(descriptor.requirement_ids, record.requirement_ids)
      || !sameStrings(descriptor.test_ids, record.test_ids)) {
      throw new CandidateError(`evidence record ${evidenceId} disagrees with its index descriptor`);
    }
    requirePassExecution(record, `evidence record ${evidenceId}`);
    const started = Date.parse(record.started_at);
    const ended = Date.parse(record.ended_at);
    if (!Number.isFinite(started) || !Number.isFinite(ended) || ended < started) {
      throw new CandidateError(`evidence record ${evidenceId} has invalid timestamps`);
    }
    if (!record.environment?.profile_id || !record.environment?.tool_versions) {
      throw new CandidateError(`evidence record ${evidenceId} has incomplete environment data`);
    }
    if (!record.requirement_ids.every((id) => candidateRows.has(id))) {
      throw new CandidateError(`evidence record ${evidenceId} links an unknown requirement`);
    }
    if (!record.test_ids.every((id) => testIndex.has(id))) {
      throw new CandidateError(`evidence record ${evidenceId} links an unknown test`);
    }
    if (!sameStrings(descriptor.artifacts ?? [], record.artifacts ?? [])) {
      const descriptorArtifacts = JSON.stringify(descriptor.artifacts ?? []);
      const recordArtifacts = JSON.stringify(record.artifacts ?? []);
      if (descriptorArtifacts !== recordArtifacts) {
        throw new CandidateError(`evidence record ${evidenceId} artifact links disagree with its index descriptor`);
      }
    }
    for (const artifact of requireArray(record.artifacts, `evidence record ${evidenceId} artifacts`)) {
      const file = fileRows.get(artifact.path);
      if (!file || file.sha256 !== artifact.sha256) {
        throw new CandidateError(`evidence record ${evidenceId} has dangling artifact ${artifact.path}`);
      }
    }
    records.set(evidenceId, record);
  }

  const requiredIds = new Set(requiredRequirementIds ?? candidateRows.keys());
  for (const requirementId of requiredIds) {
    const row = candidateRows.get(requirementId);
    if (!row) throw new CandidateError(`required evidence references unknown requirement ${requirementId}`);
    const resolved = resolvedRows.get(requirementId);
    const reverse = requirementIndex.get(requirementId);
    if (!resolved || !reverse || !Array.isArray(resolved.evidence) || resolved.evidence.length === 0) {
      throw new CandidateError(`requirement ${requirementId} has no exact-candidate evidence`);
    }
    if (!sameStrings(resolved.evidence, reverse.evidence_ids)) {
      throw new CandidateError(`requirement ${requirementId} evidence links are not bidirectional`);
    }
    if (!sameStrings(row.tests, reverse.test_ids)) {
      throw new CandidateError(`requirement ${requirementId} test links are not bidirectional`);
    }
    for (const evidenceId of resolved.evidence) {
      const record = records.get(evidenceId);
      if (!record || !record.requirement_ids.includes(requirementId)) {
        throw new CandidateError(`requirement ${requirementId} has dangling evidence ${evidenceId}`);
      }
      if (!row.environments.includes(record.environment.profile_id)) {
        throw new CandidateError(`evidence ${evidenceId} uses undeclared environment for ${requirementId}`);
      }
      if (!record.test_ids.some((testId) => row.tests.includes(testId))) {
        throw new CandidateError(`evidence ${evidenceId} has no declared test for ${requirementId}`);
      }
    }
  }

  for (const [testId, reverse] of testIndex) {
    if (!requireArray(reverse.requirement_ids, `${testId} requirement_ids`).every((id) => candidateRows.has(id))) {
      throw new CandidateError(`test ${testId} links an unknown requirement`);
    }
    for (const evidenceId of requireArray(reverse.evidence_ids, `${testId} evidence_ids`)) {
      const record = records.get(evidenceId);
      if (!record || !record.test_ids.includes(testId)) {
        throw new CandidateError(`test ${testId} has dangling evidence ${evidenceId}`);
      }
    }
  }

  return {
    manifest,
    index,
    records,
    package_sha256: manifest.package.sha256,
  };
}
