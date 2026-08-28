import { createHash } from "node:crypto";
import {
  lstatSync,
  readFileSync,
  readdirSync,
  realpathSync,
} from "node:fs";
import { isDeepStrictEqual } from "node:util";
import { resolve, sep } from "node:path";

import {
  expectEvidenceIds,
  expectRequirementIds,
  expectSafeRelativePath,
  expectTestIds,
  evidenceKindFromId,
  parseJson,
  validateEvidenceRecord,
  validateIndexShape,
  validateManifestShape,
} from "./evidence-schema.mjs";

function fail(message) {
  throw new Error(message);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function sorted(values) {
  return [...values].sort();
}

function sameJson(actual, expected, message) {
  if (!isDeepStrictEqual(actual, expected)) fail(message);
}

function resolveBundleFile(bundleRoot, relativePath) {
  expectSafeRelativePath(relativePath, "bundle path");
  const root = realpathSync(bundleRoot);
  let cursor = root;
  for (const segment of relativePath.split("/")) {
    cursor = resolve(cursor, segment);
    const stat = lstatSync(cursor);
    if (stat.isSymbolicLink()) fail(`${relativePath}: symbolic links are forbidden in evidence bundles`);
  }
  const actual = realpathSync(cursor);
  if (actual !== root && !actual.startsWith(root + sep)) fail(`${relativePath}: resolves outside the evidence bundle`);
  if (!lstatSync(actual).isFile()) fail(`${relativePath}: must resolve to a regular file`);
  return actual;
}

function readBundleFile(bundleRoot, relativePath) {
  try {
    return readFileSync(resolveBundleFile(bundleRoot, relativePath));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    fail(`${relativePath}: cannot read bundle file: ${message}`);
  }
}

function readBundleJson(bundleRoot, relativePath) {
  return parseJson(readBundleFile(bundleRoot, relativePath).toString("utf8"), relativePath);
}

function listBundleFiles(bundleRoot) {
  const root = realpathSync(bundleRoot);
  const files = [];
  function visit(directory, prefix) {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0)) {
      const relativePath = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isSymbolicLink()) fail(`${relativePath}: symbolic links are forbidden in evidence bundles`);
      if (entry.isDirectory()) visit(resolve(directory, entry.name), relativePath);
      else if (entry.isFile()) files.push(relativePath);
      else fail(`${relativePath}: only regular files and directories are allowed in evidence bundles`);
    }
  }
  visit(root, "");
  return files;
}

function manifestEntryByPath(manifest) {
  return new Map(manifest.files.map((entry) => [entry.path, entry]));
}

function assertManifestRoles(manifest) {
  const expectedSingletons = [
    ["index", manifest.index.path, manifest.index.sha256],
    ["requirements", manifest.requirements.path, manifest.requirements.sha256],
    ["package", manifest.package.path, manifest.package.sha256],
  ];
  for (const [role, path, hash] of expectedSingletons) {
    const matches = manifest.files.filter((entry) => entry.role === role);
    if (matches.length !== 1) fail(`manifest.files: must contain exactly one ${role} entry`);
    if (matches[0].path !== path || matches[0].sha256 !== hash) {
      fail(`manifest.${role}: path and SHA-256 must match its files entry`);
    }
  }
}

function validateManifestBytes(bundleRoot, manifest, manifestPath) {
  assertManifestRoles(manifest);
  const declared = new Set(manifest.files.map((entry) => entry.path));
  if (declared.has(manifestPath)) fail(`manifest.files: must not include self-referential ${manifestPath}`);
  const actual = listBundleFiles(bundleRoot);
  sameJson(actual, sorted([manifestPath, ...declared]), "manifest.files: must exhaustively list every bundle file except the manifest itself");
  for (const file of manifest.files) {
    const actualHash = sha256(readBundleFile(bundleRoot, file.path));
    if (actualHash !== file.sha256) fail(`${file.path}: SHA-256 mismatch; expected ${file.sha256}, found ${actualHash}`);
  }
}

function computedIndexEntry(recordPath, recordHash, record) {
  return {
    evidence_id: record.evidence_id,
    path: recordPath,
    sha256: recordHash,
    record_type: record.record_type,
    requirement_ids: record.requirement_ids,
    test_ids: record.test_ids,
    artifacts: record.artifacts,
  };
}

function buildReverseProjections(records) {
  const requirements = new Map();
  const tests = new Map();
  for (const record of records) {
    for (const requirementId of record.requirement_ids) {
      const projection = requirements.get(requirementId) ?? { tests: new Set(), evidence: new Set() };
      record.test_ids.forEach((testId) => projection.tests.add(testId));
      projection.evidence.add(record.evidence_id);
      requirements.set(requirementId, projection);
    }
    for (const testId of record.test_ids) {
      const projection = tests.get(testId) ?? { requirements: new Set(), evidence: new Set() };
      record.requirement_ids.forEach((requirementId) => projection.requirements.add(requirementId));
      projection.evidence.add(record.evidence_id);
      tests.set(testId, projection);
    }
  }
  return {
    requirements: sorted(requirements.keys()).map((requirementId) => ({
      requirement_id: requirementId,
      test_ids: sorted(requirements.get(requirementId).tests),
      evidence_ids: sorted(requirements.get(requirementId).evidence),
    })),
    tests: sorted(tests.keys()).map((testId) => ({
      test_id: testId,
      requirement_ids: sorted(tests.get(testId).requirements),
      evidence_ids: sorted(tests.get(testId).evidence),
    })),
  };
}

function validateRecords(bundleRoot, manifest, index, candidateSha, packageSha256, freshness) {
  const fileEntries = manifestEntryByPath(manifest);
  const records = [];
  const seenEvidenceIds = new Set();
  for (const indexEntry of index.records) {
    const fileEntry = fileEntries.get(indexEntry.path);
    if (!fileEntry || fileEntry.role !== "record") fail(`${indexEntry.path}: index record is absent from manifest with role record`);
    if (fileEntry.sha256 !== indexEntry.sha256) fail(`${indexEntry.path}: index and manifest record hashes differ`);
    const record = validateEvidenceRecord(readBundleJson(bundleRoot, indexEntry.path), indexEntry.path, freshness);
    if (seenEvidenceIds.has(record.evidence_id)) fail(`${indexEntry.path}: duplicate evidence ID ${record.evidence_id}`);
    seenEvidenceIds.add(record.evidence_id);
    if (record.candidate_sha !== candidateSha) fail(`${record.evidence_id}: stale candidate SHA ${record.candidate_sha}`);
    if (record.package_sha256 !== packageSha256) fail(`${record.evidence_id}: stale package SHA-256 ${record.package_sha256}`);
    sameJson(indexEntry, computedIndexEntry(indexEntry.path, fileEntry.sha256, record), `${record.evidence_id}: index entry does not exactly match record bytes`);
    for (const artifact of record.artifacts) {
      const artifactEntry = fileEntries.get(artifact.path);
      if (!artifactEntry || artifactEntry.role !== "artifact") fail(`${record.evidence_id}: artifact ${artifact.path} is absent from manifest with role artifact`);
      if (artifactEntry.sha256 !== artifact.sha256) fail(`${record.evidence_id}: artifact ${artifact.path} hash differs from manifest`);
    }
    records.push(record);
  }
  const projections = buildReverseProjections(records);
  sameJson(index.requirements, projections.requirements, "evidence-index.requirements: reverse projection does not match records");
  sameJson(index.tests, projections.tests, "evidence-index.tests: reverse projection does not match records");
  return records;
}

function validateManifestCoverage(manifest, index) {
  const expectedRoles = new Map([
    [manifest.index.path, "index"],
    [manifest.requirements.path, "requirements"],
    [manifest.package.path, "package"],
  ]);
  for (const record of index.records) {
    if (expectedRoles.has(record.path)) fail(`${record.path}: reused under multiple manifest meanings`);
    expectedRoles.set(record.path, "record");
    for (const artifact of record.artifacts) {
      const prior = expectedRoles.get(artifact.path);
      if (prior && prior !== "artifact") fail(`${artifact.path}: reused under multiple manifest meanings`);
      expectedRoles.set(artifact.path, "artifact");
    }
  }
  const actualRoles = new Map(manifest.files.map((entry) => [entry.path, entry.role]));
  sameJson(actualRoles, expectedRoles, "manifest.files: contains an unreferenced file or incorrect role");
}

function activeRequirements(requirements, path) {
  if (!requirements || !Array.isArray(requirements.requirements)) fail(`${path}.requirements: must be an array`);
  const seen = new Set();
  const active = [];
  for (const [index, row] of requirements.requirements.entries()) {
    const rowPath = `${path}.requirements[${index}]`;
    if (!row || typeof row !== "object" || Array.isArray(row)) fail(`${rowPath}: must be an object`);
    expectRequirementIds([row.id], `${rowPath}.id`);
    if (seen.has(row.id)) fail(`${rowPath}.id: duplicate requirement ID ${row.id}`);
    seen.add(row.id);
    if (!Array.isArray(row.evidence)) fail(`${rowPath}.evidence: must be an array`);
    if (row.status === "active") active.push(row);
    else if (row.status !== "retired") fail(`${rowPath}.status: must be active or retired`);
  }
  return active;
}

function validateResolvedRequirements(
  candidateRequirements,
  resolvedRequirements,
  records,
  index,
  requiredRequirementIds,
  requiredEnvironmentIds,
) {
  const candidateActive = activeRequirements(candidateRequirements, "candidate requirements");
  for (const row of candidateRequirements.requirements) {
    if (row.evidence.length !== 0) fail(`candidate requirement ${row.id}: repository template evidence must be empty`);
  }
  const resolvedActive = activeRequirements(resolvedRequirements, "resolved requirements");
  for (const row of resolvedRequirements.requirements) {
    if (row.status === "retired" && row.evidence.length !== 0) {
      fail(`resolved requirement ${row.id}.evidence: retired requirements cannot receive candidate evidence`);
    }
  }
  const normalized = structuredClone(resolvedRequirements);
  normalized.requirements.forEach((row) => { row.evidence = []; });
  sameJson(normalized, candidateRequirements, "resolved requirements may differ from the exact candidate object only in evidence arrays");
  if (candidateActive.length !== resolvedActive.length) fail("resolved requirements changed the active requirement universe");

  const activeById = new Map(candidateActive.map((row) => [row.id, row]));
  const testById = new Map(candidateRequirements.test_catalog.map((entry) => [entry.id, entry]));
  const requiredIds = requiredRequirementIds === undefined
    ? new Set(activeById.keys())
    : new Set(requiredRequirementIds);
  if (requiredIds.size === 0) fail("requiredRequirementIds: must include at least one active requirement");
  for (const requirementId of requiredIds) {
    if (!activeById.has(requirementId)) {
      fail(`requiredRequirementIds: unknown or retired requirement ${requirementId}`);
    }
  }

  const indexByRequirement = new Map(index.requirements.map((entry) => [entry.requirement_id, entry]));
  const recordByEvidence = new Map(records.map((record) => [record.evidence_id, record]));
  for (const row of resolvedActive) {
    const label = `resolved requirement ${row.id}`;
    expectTestIds(row.tests, `${label}.tests`);
    if (!Array.isArray(row.environments) || row.environments.length === 0 || new Set(row.environments).size !== row.environments.length) {
      fail(`${label}.environments: must be a non-empty unique array`);
    }
    row.environments.forEach((environmentId) => {
      if (typeof environmentId !== "string" || !/^ENV-[A-Z0-9]+(?:-[A-Z0-9]+)*$/.test(environmentId)) {
        fail(`${label}.environments: contains an invalid environment ID`);
      }
    });
    const projection = indexByRequirement.get(row.id);
    if (!requiredIds.has(row.id)) {
      if (row.evidence.length !== 0) fail(`${label}.evidence: excluded active requirements must remain empty`);
      if (projection) fail(`${label}: excluded active requirements cannot have an Evidence Index row`);
      continue;
    }
    expectEvidenceIds(row.evidence, `${label}.evidence`);
    if (!projection) fail(`${label}: has no Evidence Index reverse link`);
    sameJson(row.evidence, projection.evidence_ids, `${label}.evidence: does not match Evidence Index`);
    sameJson(row.tests, projection.test_ids, `${label}.tests: each declared test must have exact-candidate evidence`);
    const evidencedEnvironments = new Set();
    const themeClasses = new Set();
    for (const evidenceId of row.evidence) {
      const record = recordByEvidence.get(evidenceId);
      if (!record) fail(`${label}: dangling evidence ID ${evidenceId}`);
      if (!record.requirement_ids.includes(row.id)) fail(`${label}: evidence ${evidenceId} lacks its reverse requirement link`);
      for (const testId of record.test_ids) {
        if (!row.tests.includes(testId)) fail(`${label}: evidence ${evidenceId} links undeclared test ${testId}`);
        const test = testById.get(testId);
        if (!test || test.requirement_id !== row.id) fail(`${label}: evidence ${evidenceId} links a misprojected test ${testId}`);
        if (evidenceKindFromId(evidenceId) !== test.evidence_kind) {
          fail(`${label}: evidence ${evidenceId} kind does not match ${testId} kind ${test.evidence_kind}`);
        }
      }
      if (!row.environments.includes(record.environment.profile_id)) {
        fail(`${label}: evidence ${evidenceId} uses undeclared environment ${record.environment.profile_id}`);
      }
      evidencedEnvironments.add(record.environment.profile_id);
      if (record.environment.profile_id === "ENV-THEME") {
        themeClasses.add(record.environment.parameters["theme-class"]);
      }
    }
    const expectedEnvironments = requiredEnvironmentIds === undefined
      ? row.environments
      : row.environments.filter((id) => new Set(requiredEnvironmentIds).has(id));
    if (expectedEnvironments.length === 0) fail(`${label}.environments: candidate scope has no applicable evidence profile`);
    if (expectedEnvironments.some((id) => !evidencedEnvironments.has(id))) {
      fail(`${label}.environments: each applicable environment must have evidence`);
    }
    if (expectedEnvironments.includes("ENV-THEME")) {
      sameJson(sorted(themeClasses), ["community-customized", "high-contrast"], `${label}.environments: ENV-THEME requires high-contrast and community-customized evidence`);
    }
  }
  if (indexByRequirement.size !== requiredIds.size) {
    fail("Evidence Index contains an excluded, unknown, retired, or duplicate requirement projection");
  }
}

export function validateEvidenceBundle({
  bundleDir,
  manifestPath = "manifest.json",
  candidateSha,
  packageSha256,
  candidateRequirements,
  candidateRequirementsBlobOid,
  candidateRequirementsSourcePath,
  requiredRequirementIds,
  requiredEnvironmentIds,
  nowMs,
  maxAgeMs,
  maxFutureSkewMs,
}) {
  expectSafeRelativePath(manifestPath, "manifest path");
  const manifestBytes = readBundleFile(bundleDir, manifestPath);
  const manifest = validateManifestShape(parseJson(manifestBytes.toString("utf8"), manifestPath));
  if (manifest.candidate_sha !== candidateSha) fail(`manifest.candidate_sha: expected exact candidate ${candidateSha}, found ${manifest.candidate_sha}`);
  const expectedPackageSha256 = packageSha256 ?? manifest.package.sha256;
  if (manifest.package.sha256 !== expectedPackageSha256) fail(`manifest.package.sha256: expected exact package ${expectedPackageSha256}, found ${manifest.package.sha256}`);
  if (manifest.requirements.source_blob_oid !== candidateRequirementsBlobOid) {
    fail(`manifest.requirements.source_blob_oid: stale candidate object ${manifest.requirements.source_blob_oid}`);
  }
  if (manifest.requirements.source_path !== candidateRequirementsSourcePath) {
    fail(`manifest.requirements.source_path: expected exact candidate path ${candidateRequirementsSourcePath}, found ${manifest.requirements.source_path}`);
  }
  validateManifestBytes(bundleDir, manifest, manifestPath);
  const index = validateIndexShape(readBundleJson(bundleDir, manifest.index.path), manifest.index.path);
  if (index.candidate_sha !== candidateSha) fail(`evidence-index.candidate_sha: stale candidate SHA ${index.candidate_sha}`);
  if (index.package_sha256 !== expectedPackageSha256) fail(`evidence-index.package_sha256: stale package SHA-256 ${index.package_sha256}`);
  const records = validateRecords(bundleDir, manifest, index, candidateSha, expectedPackageSha256, {
    nowMs,
    maxAgeMs,
    maxFutureSkewMs,
  });
  validateManifestCoverage(manifest, index);
  const resolvedRequirements = readBundleJson(bundleDir, manifest.requirements.path);
  validateResolvedRequirements(
    candidateRequirements,
    resolvedRequirements,
    records,
    index,
    requiredRequirementIds,
    requiredEnvironmentIds,
  );
  return {
    candidateSha,
    packageSha256: expectedPackageSha256,
    manifest,
    manifestSha256: sha256(manifestBytes),
    index,
    indexSha256: manifest.index.sha256,
    records,
    resolvedRequirements,
    bundleDir: realpathSync(bundleDir),
    scope: {
      release_scope: requiredRequirementIds === undefined ? "public" : "private",
      included_requirement_ids: Array.from(requiredRequirementIds ?? resolvedRequirements.requirements.filter((row) => row.status === "active").map((row) => row.id)),
      excluded_requirement_ids: resolvedRequirements.requirements
        .filter((row) => row.status === "active" && !new Set(requiredRequirementIds ?? resolvedRequirements.requirements.map((entry) => entry.id)).has(row.id))
        .map((row) => row.id),
    },
  };
}

export function hashFile(path) {
  return sha256(readFileSync(path));
}
