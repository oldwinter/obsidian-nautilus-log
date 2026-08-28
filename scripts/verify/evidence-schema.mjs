import { posix } from "node:path";

export const EVIDENCE_SCHEMA_VERSION = 1;

export const RECORD_KIND_BY_TYPE = Object.freeze({
  pure: Object.freeze(["UNIT", "CONTRACT"]),
  vault: Object.freeze(["VAULT"]),
  host: Object.freeze(["INTEGRATION"]),
  screenshot: Object.freeze(["SCREENSHOT"]),
  keyboard: Object.freeze(["KEYBOARD"]),
  accessibility: Object.freeze(["A11Y"]),
  lifecycle: Object.freeze(["LIFECYCLE"]),
  "network/privacy": Object.freeze(["CONTRACT", "INTEGRATION"]),
  performance: Object.freeze(["CONTRACT", "INTEGRATION"]),
  package: Object.freeze(["PACKAGE"]),
  manual: Object.freeze(["MANUAL"]),
});

export const MANIFEST_ROLES = Object.freeze([
  "index",
  "requirements",
  "record",
  "artifact",
  "package",
]);

const HOST_PROFILES = Object.freeze([
  "ENV-HOST-PRIVATE",
  "ENV-HOST-MIN",
  "ENV-HOST-MAC",
  "ENV-HOST-WIN",
  "ENV-HOST-LINUX",
]);

const RECORD_PROFILES_BY_TYPE = Object.freeze({
  pure: Object.freeze(["ENV-PURE"]),
  vault: Object.freeze(["ENV-PURE", ...HOST_PROFILES]),
  host: Object.freeze([...HOST_PROFILES, "ENV-THEME"]),
  screenshot: Object.freeze(["ENV-VIS"]),
  keyboard: Object.freeze(["ENV-VIS", "ENV-A11Y", ...HOST_PROFILES]),
  accessibility: Object.freeze(["ENV-VIS", "ENV-A11Y"]),
  lifecycle: Object.freeze([...HOST_PROFILES]),
  "network/privacy": Object.freeze(["ENV-PURE", ...HOST_PROFILES]),
  performance: Object.freeze(["ENV-PURE", ...HOST_PROFILES]),
  package: Object.freeze(["ENV-PURE", ...HOST_PROFILES]),
  manual: Object.freeze(["ENV-A11Y", "ENV-THEME", ...HOST_PROFILES]),
});

const SHA40 = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const REQUIREMENT_ID = /^(?:UP-(?:INS|SET|PAR|SCH|DAY|HIS|VIS|CTL|CMP|EXE|CLK|CMD|PER|ERR|ERX|DRF)-[0-9]{2}|OBS-(?:TRACE|HOST|VIS|A11Y|SAFE|LIFE|I18N|LOCAL)-[0-9]{3}|REL-[0-9]{3})$/;
const TEST_ID = /^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+$/;
const ENVIRONMENT_ID = /^ENV-[A-Z0-9]+(?:-[A-Z0-9]+)*$/;
const EVIDENCE_ID = /^E-([0-9a-f]{12})-(ENV-[A-Z0-9]+(?:-[A-Z0-9]+)*)-([A-Z0-9]+)-([0-9]{3})$/;
const GIT_OBJECT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?(?:Z|[+-]\d{2}:\d{2})$/;
const SYMBOLIC_VERSIONS = new Set([
  "latest",
  "current",
  "current-stable",
  "stable",
  "min-supported",
  "minimum-supported",
  "unknown",
  "n/a",
  "na",
  "none",
  "*",
]);

const ENVIRONMENT_PROFILES = Object.freeze({
  "ENV-PURE": Object.freeze({
    tools: Object.freeze(["git", "node", "npm"]),
    parameters: Object.freeze(["ci-image", "dst-boundaries", "fake-clock", "locales", "timezones"]),
  }),
  "ENV-VIS": Object.freeze({
    tools: Object.freeze(["chromium", "playwright"]),
    parameters: Object.freeze(["content-widths", "device-pixel-ratio", "fake-clock", "fonts", "reduced-motion-values", "theme-modes", "viewport", "zoom-percent"]),
  }),
  "ENV-HOST-PRIVATE": Object.freeze({
    tools: Object.freeze(["chromium", "electron", "obsidian"]),
    parameters: Object.freeze(["theme", "zoom-percent"]),
  }),
  "ENV-HOST-MIN": Object.freeze({
    tools: Object.freeze(["chromium", "electron", "obsidian"]),
    parameters: Object.freeze(["theme", "zoom-percent"]),
  }),
  "ENV-HOST-MAC": Object.freeze({
    tools: Object.freeze(["chromium", "electron", "obsidian"]),
    parameters: Object.freeze(["locales", "theme-modes", "zoom-percents"]),
  }),
  "ENV-HOST-WIN": Object.freeze({
    tools: Object.freeze(["chromium", "electron", "obsidian"]),
    parameters: Object.freeze(["locales", "theme-modes", "zoom-percents"]),
  }),
  "ENV-HOST-LINUX": Object.freeze({
    tools: Object.freeze(["chromium", "electron", "obsidian"]),
    parameters: Object.freeze(["locales", "theme-modes", "zoom-percents"]),
  }),
  "ENV-THEME": Object.freeze({
    tools: Object.freeze(["chromium", "electron", "obsidian"]),
    parameters: Object.freeze(["theme-class", "theme-name", "theme-sha256", "theme-version", "zoom-percent"]),
  }),
  "ENV-A11Y": Object.freeze({
    tools: Object.freeze(["chromium", "electron", "obsidian", "screen-reader"]),
    parameters: Object.freeze(["reduced-motion", "zoom-percent"]),
  }),
});

function fail(path, message) {
  throw new Error(`${path}: ${message}`);
}

export function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function expectObject(value, path) {
  if (!isPlainObject(value)) fail(path, "must be an object");
  return value;
}

export function expectExactKeys(value, required, optional, path) {
  expectObject(value, path);
  const allowed = new Set([...required, ...optional]);
  for (const key of required) {
    if (!Object.hasOwn(value, key)) fail(path, `missing required field ${key}`);
  }
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) fail(path, `unexpected field ${key}`);
  }
}

export function expectString(value, path) {
  if (typeof value !== "string" || value.length === 0) fail(path, "must be a non-empty string");
  return value;
}

export function expectInteger(value, path, expected = null) {
  if (!Number.isInteger(value)) fail(path, "must be an integer");
  if (expected !== null && value !== expected) fail(path, `must equal ${expected}`);
  return value;
}

export function expectBoolean(value, path, expected = null) {
  if (typeof value !== "boolean") fail(path, "must be a boolean");
  if (expected !== null && value !== expected) fail(path, `must equal ${String(expected)}`);
  return value;
}

export function expectSha40(value, path) {
  if (typeof value !== "string" || !SHA40.test(value)) {
    fail(path, "must be one full 40-character lowercase Git SHA");
  }
  return value;
}

export function expectSha256(value, path) {
  if (typeof value !== "string" || !SHA256.test(value)) {
    fail(path, "must be one 64-character lowercase SHA-256");
  }
  return value;
}

export function expectSafeRelativePath(value, path) {
  expectString(value, path);
  if (
    value.includes("\\")
    || /[\u0000-\u001f\u007f]/.test(value)
    || value.startsWith("/")
    || /^[A-Za-z]:/.test(value)
    || value.split("/").some((segment) => segment === "" || segment === "." || segment === "..")
    || posix.normalize(value) !== value
  ) {
    fail(path, "must be a normalized relative POSIX path without traversal");
  }
  return value;
}

function expectSortedUniqueStrings(value, path, validator) {
  if (!Array.isArray(value) || value.length === 0) fail(path, "must be a non-empty array");
  value.forEach((entry, index) => validator(entry, `${path}[${index}]`));
  const sorted = [...value].sort();
  if (new Set(value).size !== value.length) fail(path, "must not contain duplicates");
  if (JSON.stringify(value) !== JSON.stringify(sorted)) fail(path, "must be sorted lexicographically");
  return value;
}

export function expectRequirementIds(value, path) {
  return expectSortedUniqueStrings(value, path, (entry, entryPath) => {
    if (typeof entry !== "string" || !REQUIREMENT_ID.test(entry)) {
      fail(entryPath, "must be a stable requirement ID");
    }
  });
}

export function expectTestIds(value, path) {
  return expectSortedUniqueStrings(value, path, (entry, entryPath) => {
    if (typeof entry !== "string" || !TEST_ID.test(entry)) {
      fail(entryPath, "must be a stable test ID");
    }
  });
}

export function expectEvidenceIds(value, path) {
  return expectSortedUniqueStrings(value, path, (entry, entryPath) => {
    if (typeof entry !== "string" || !EVIDENCE_ID.test(entry)) {
      fail(entryPath, "must be a stable evidence ID");
    }
  });
}

function expectExactVersion(value, path) {
  expectString(value, path);
  if (value !== value.trim() || /[\u0000-\u001f\u007f]/.test(value)) {
    fail(path, "must be a non-blank exact value without surrounding whitespace or controls");
  }
  const normalized = value.trim().toLowerCase().replace(/[_\s]+/g, "-");
  if (SYMBOLIC_VERSIONS.has(normalized)) fail(path, "must record an exact value, not a symbolic version");
}

function expectExactParameterValue(value, path) {
  if (typeof value === "string") {
    expectExactVersion(value, path);
    return;
  }
  if (typeof value === "number" && Number.isFinite(value)) return;
  if (typeof value === "boolean") return;
  if (!Array.isArray(value) || value.length === 0) {
    fail(path, "must be an exact scalar or non-empty scalar array");
  }
  const valueType = typeof value[0];
  if (!value.every((entry) => typeof entry === valueType && (typeof entry !== "number" || Number.isFinite(entry)))) {
    fail(path, "array values must be finite scalars of one type");
  }
  value.forEach((entry, index) => expectExactParameterValue(entry, `${path}[${index}]`));
  if (new Set(value.map((entry) => JSON.stringify(entry))).size !== value.length) fail(path, "array values must be unique");
  const expectedOrder = [...value].sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
  if (!isSameArray(value, expectedOrder)) fail(path, "array values must be sorted");
}

function isSameArray(actual, expected) {
  return JSON.stringify(actual) === JSON.stringify(expected);
}

function requireExactArray(actual, expected, path) {
  if (!isSameArray(actual, expected)) fail(path, `must equal ${JSON.stringify(expected)}`);
}

function requireOs(environment, names, versionPattern, path) {
  if (!names.includes(environment.os_name) || !versionPattern.test(environment.os_version)) {
    fail(path, `${environment.profile_id} has the wrong OS identity`);
  }
}

function validateProfileParameterValues(environment, path) {
  const parameters = environment.parameters;
  if (environment.profile_id === "ENV-PURE") {
    validateTimestamp(parameters["fake-clock"], `${path}.parameters.fake-clock`);
    if (parameters["dst-boundaries"] !== true) fail(`${path}.parameters.dst-boundaries`, "ENV-PURE requires DST boundaries");
    requireExactArray(parameters.locales, ["en", "zh-CN"], `${path}.parameters.locales`);
    requireExactArray(parameters.timezones, ["America/New_York", "Asia/Shanghai", "UTC"], `${path}.parameters.timezones`);
    requireOs(environment, ["Linux", "Ubuntu"], /^24\.04(?:\.|$)/, `${path}.os_name`);
  }
  if (environment.profile_id === "ENV-VIS") {
    requireExactArray(parameters["content-widths"], [320, 360, 519, 520, 521, 900], `${path}.parameters.content-widths`);
    if (parameters["device-pixel-ratio"] !== 1) fail(`${path}.parameters.device-pixel-ratio`, "ENV-VIS requires DPR 1");
    validateTimestamp(parameters["fake-clock"], `${path}.parameters.fake-clock`);
    requireExactArray(parameters["reduced-motion-values"], [false, true], `${path}.parameters.reduced-motion-values`);
    requireExactArray(parameters["theme-modes"], ["dark", "light"], `${path}.parameters.theme-modes`);
    if (parameters.viewport !== "1440x1000") fail(`${path}.parameters.viewport`, "ENV-VIS requires viewport 1440x1000");
    if (parameters["zoom-percent"] !== 100) fail(`${path}.parameters.zoom-percent`, "ENV-VIS requires 100 percent zoom");
    requireOs(environment, ["Ubuntu"], /^24\.04(?:\.|$)/, `${path}.os_name`);
  }
  if (["ENV-HOST-PRIVATE", "ENV-HOST-MIN"].includes(environment.profile_id)) {
    if (![80, 100, 200].includes(parameters["zoom-percent"])) {
      fail(`${path}.parameters.zoom-percent`, "host profile zoom must be 80, 100, or 200 percent");
    }
  }
  if (environment.profile_id === "ENV-THEME") {
    if (!["community-customized", "high-contrast"].includes(parameters["theme-class"])) {
      fail(`${path}.parameters.theme-class`, "must be community-customized or high-contrast");
    }
    expectSha256(parameters["theme-sha256"], `${path}.parameters.theme-sha256`);
    if (parameters["zoom-percent"] !== 100) fail(`${path}.parameters.zoom-percent`, "ENV-THEME requires 100 percent zoom");
  }
  if (environment.profile_id === "ENV-A11Y") {
    if (parameters["reduced-motion"] !== true) fail(`${path}.parameters.reduced-motion`, "ENV-A11Y requires reduced motion");
    if (parameters["zoom-percent"] !== 200) fail(`${path}.parameters.zoom-percent`, "ENV-A11Y requires 200 percent zoom");
    requireOs(environment, ["macOS"], /^\d+(?:\.\d+)+$/, `${path}.os_name`);
    if (!/^VoiceOver [0-9]+(?:\.[0-9]+)+$/.test(environment.tool_versions["screen-reader"])) {
      fail(`${path}.tool_versions.screen-reader`, "ENV-A11Y requires an exact VoiceOver version");
    }
  }
  if (["ENV-HOST-MAC", "ENV-HOST-WIN", "ENV-HOST-LINUX"].includes(environment.profile_id)) {
    requireExactArray(parameters.locales, ["en", "zh-CN"], `${path}.parameters.locales`);
    requireExactArray(parameters["theme-modes"], ["dark", "light"], `${path}.parameters.theme-modes`);
    requireExactArray(parameters["zoom-percents"], [80, 100, 200], `${path}.parameters.zoom-percents`);
  }
  if (environment.profile_id === "ENV-HOST-MAC") {
    requireOs(environment, ["macOS"], /^\d+(?:\.\d+)+$/, `${path}.os_name`);
  }
  if (environment.profile_id === "ENV-HOST-WIN") {
    requireOs(environment, ["Windows", "Windows 11"], /^11(?:\.|$)/, `${path}.os_name`);
  }
  if (environment.profile_id === "ENV-HOST-LINUX") {
    requireOs(environment, ["Ubuntu"], /^24\.04(?:\.|$)/, `${path}.os_name`);
  }
}

function validateEnvironment(environment, path) {
  expectExactKeys(
    environment,
    ["profile_id", "os_name", "os_version", "architecture", "locale", "timezone", "tool_versions", "parameters"],
    [],
    path,
  );
  if (!ENVIRONMENT_ID.test(environment.profile_id)) fail(`${path}.profile_id`, "must be an ENV-* ID");
  const profile = ENVIRONMENT_PROFILES[environment.profile_id];
  if (!profile) fail(`${path}.profile_id`, `must be one of ${Object.keys(ENVIRONMENT_PROFILES).join(", ")}`);
  for (const field of ["os_name", "os_version", "architecture", "locale", "timezone"]) {
    expectExactVersion(environment[field], `${path}.${field}`);
  }
  expectObject(environment.tool_versions, `${path}.tool_versions`);
  const tools = Object.entries(environment.tool_versions);
  if (tools.length === 0) fail(`${path}.tool_versions`, "must contain at least one exact tool version");
  if (JSON.stringify(tools.map(([tool]) => tool)) !== JSON.stringify(tools.map(([tool]) => tool).sort())) {
    fail(`${path}.tool_versions`, "tool keys must be sorted lexicographically");
  }
  for (const [tool, version] of tools) {
    if (!/^[a-z][a-z0-9-]*$/.test(tool)) fail(`${path}.tool_versions.${tool}`, "tool key must be lowercase kebab-case");
    expectExactVersion(version, `${path}.tool_versions.${tool}`);
  }
  for (const tool of profile.tools) {
    if (!Object.hasOwn(environment.tool_versions, tool)) {
      fail(`${path}.tool_versions`, `${environment.profile_id} requires exact ${tool} version`);
    }
  }
  expectObject(environment.parameters, `${path}.parameters`);
  const parameters = Object.entries(environment.parameters);
  if (parameters.length === 0) fail(`${path}.parameters`, "must contain exact run parameters");
  if (JSON.stringify(parameters.map(([name]) => name)) !== JSON.stringify(parameters.map(([name]) => name).sort())) {
    fail(`${path}.parameters`, "parameter keys must be sorted lexicographically");
  }
  for (const [name, value] of parameters) {
    const valuePath = `${path}.parameters.${name}`;
    if (!/^[a-z][a-z0-9-]*$/.test(name)) fail(valuePath, "parameter key must be lowercase kebab-case");
    expectExactParameterValue(value, valuePath);
  }
  for (const parameter of profile.parameters) {
    if (!Object.hasOwn(environment.parameters, parameter)) {
      fail(`${path}.parameters`, `${environment.profile_id} requires exact ${parameter}`);
    }
  }
  validateProfileParameterValues(environment, path);
}

function validateTimestamp(value, path) {
  const match = typeof value === "string" ? value.match(ISO_TIMESTAMP) : null;
  if (!match || Number.isNaN(Date.parse(value))) {
    fail(path, "must be an ISO-8601 timestamp with an explicit offset");
  }
  const [year, month, day, hour, minute, second] = value.slice(0, 19).split(/[-T:]/).map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
    || hour > 23
    || minute > 59
    || second > 59
  ) {
    fail(path, "must contain a valid calendar date and time");
  }
}

function validateArtifacts(artifacts, path) {
  if (!Array.isArray(artifacts) || artifacts.length === 0) fail(path, "must be a non-empty array");
  const artifactPaths = [];
  artifacts.forEach((artifact, index) => {
    const itemPath = `${path}[${index}]`;
    expectExactKeys(artifact, ["path", "sha256"], [], itemPath);
    expectSafeRelativePath(artifact.path, `${itemPath}.path`);
    expectSha256(artifact.sha256, `${itemPath}.sha256`);
    artifactPaths.push(artifact.path);
  });
  if (new Set(artifactPaths).size !== artifactPaths.length) fail(path, "must not contain duplicate artifact paths");
  if (JSON.stringify(artifactPaths) !== JSON.stringify([...artifactPaths].sort())) {
    fail(path, "must be sorted by artifact path");
  }
}

export function validateEvidenceRecord(record, path = "record") {
  expectExactKeys(
    record,
    [
      "schema_version",
      "evidence_id",
      "record_type",
      "candidate_sha",
      "package_sha256",
      "environment",
      "started_at",
      "ended_at",
      "result",
      "execution",
      "requirement_ids",
      "test_ids",
      "artifacts",
    ],
    [],
    path,
  );
  expectInteger(record.schema_version, `${path}.schema_version`, EVIDENCE_SCHEMA_VERSION);
  const candidateSha = expectSha40(record.candidate_sha, `${path}.candidate_sha`);
  expectSha256(record.package_sha256, `${path}.package_sha256`);
  const allowedKinds = RECORD_KIND_BY_TYPE[record.record_type];
  if (!allowedKinds) fail(`${path}.record_type`, `must be one of ${Object.keys(RECORD_KIND_BY_TYPE).join(", ")}`);
  validateEnvironment(record.environment, `${path}.environment`);
  if (!RECORD_PROFILES_BY_TYPE[record.record_type].includes(record.environment.profile_id)) {
    fail(`${path}.environment.profile_id`, `${record.record_type} evidence cannot use ${record.environment.profile_id}`);
  }
  const idMatch = typeof record.evidence_id === "string" ? record.evidence_id.match(EVIDENCE_ID) : null;
  if (!idMatch) fail(`${path}.evidence_id`, "must match E-<sha12>-<environment-id>-<kind>-NNN");
  if (idMatch[1] !== candidateSha.slice(0, 12)) fail(`${path}.evidence_id`, "candidate prefix does not match candidate_sha");
  if (idMatch[2] !== record.environment.profile_id) fail(`${path}.evidence_id`, "environment segment does not match environment.profile_id");
  if (!allowedKinds.includes(idMatch[3])) fail(`${path}.evidence_id`, `kind ${idMatch[3]} is invalid for ${record.record_type}`);
  validateTimestamp(record.started_at, `${path}.started_at`);
  validateTimestamp(record.ended_at, `${path}.ended_at`);
  if (Date.parse(record.ended_at) < Date.parse(record.started_at)) fail(`${path}.ended_at`, "must not precede started_at");
  if (record.result !== "PASS") fail(`${path}.result`, "must equal PASS");
  expectExactKeys(record.execution, ["attempts", "retries", "skipped", "quarantined", "expected_failure"], [], `${path}.execution`);
  expectInteger(record.execution.attempts, `${path}.execution.attempts`, 1);
  expectInteger(record.execution.retries, `${path}.execution.retries`, 0);
  expectBoolean(record.execution.skipped, `${path}.execution.skipped`, false);
  expectBoolean(record.execution.quarantined, `${path}.execution.quarantined`, false);
  expectBoolean(record.execution.expected_failure, `${path}.execution.expected_failure`, false);
  expectRequirementIds(record.requirement_ids, `${path}.requirement_ids`);
  expectTestIds(record.test_ids, `${path}.test_ids`);
  validateArtifacts(record.artifacts, `${path}.artifacts`);
  return record;
}

export function validateManifestShape(manifest, path = "manifest") {
  expectExactKeys(manifest, ["schema_version", "candidate_sha", "package", "index", "requirements", "files"], [], path);
  expectInteger(manifest.schema_version, `${path}.schema_version`, EVIDENCE_SCHEMA_VERSION);
  expectSha40(manifest.candidate_sha, `${path}.candidate_sha`);
  for (const field of ["package", "index"]) {
    expectExactKeys(manifest[field], ["path", "sha256"], [], `${path}.${field}`);
    expectSafeRelativePath(manifest[field].path, `${path}.${field}.path`);
    expectSha256(manifest[field].sha256, `${path}.${field}.sha256`);
  }
  expectExactKeys(
    manifest.requirements,
    ["path", "sha256", "source_path", "source_blob_oid"],
    [],
    `${path}.requirements`,
  );
  expectSafeRelativePath(manifest.requirements.path, `${path}.requirements.path`);
  expectSha256(manifest.requirements.sha256, `${path}.requirements.sha256`);
  expectSafeRelativePath(manifest.requirements.source_path, `${path}.requirements.source_path`);
  if (!GIT_OBJECT_ID.test(manifest.requirements.source_blob_oid)) {
    fail(`${path}.requirements.source_blob_oid`, "must be one full lowercase Git object ID");
  }
  if (!Array.isArray(manifest.files) || manifest.files.length === 0) fail(`${path}.files`, "must be a non-empty array");
  const paths = [];
  manifest.files.forEach((file, index) => {
    const itemPath = `${path}.files[${index}]`;
    expectExactKeys(file, ["path", "sha256", "role"], [], itemPath);
    expectSafeRelativePath(file.path, `${itemPath}.path`);
    expectSha256(file.sha256, `${itemPath}.sha256`);
    if (!MANIFEST_ROLES.includes(file.role)) fail(`${itemPath}.role`, `must be one of ${MANIFEST_ROLES.join(", ")}`);
    paths.push(file.path);
  });
  if (new Set(paths).size !== paths.length) fail(`${path}.files`, "must not contain duplicate paths");
  if (JSON.stringify(paths) !== JSON.stringify([...paths].sort())) fail(`${path}.files`, "must be sorted by path");
  return manifest;
}

export function validateIndexShape(index, path = "index") {
  expectExactKeys(index, ["schema_version", "candidate_sha", "package_sha256", "records", "requirements", "tests"], [], path);
  expectInteger(index.schema_version, `${path}.schema_version`, EVIDENCE_SCHEMA_VERSION);
  expectSha40(index.candidate_sha, `${path}.candidate_sha`);
  expectSha256(index.package_sha256, `${path}.package_sha256`);
  for (const field of ["records", "requirements", "tests"]) {
    if (!Array.isArray(index[field]) || index[field].length === 0) fail(`${path}.${field}`, "must be a non-empty array");
  }
  const evidenceIds = [];
  const recordPaths = [];
  index.records.forEach((record, position) => {
    const itemPath = `${path}.records[${position}]`;
    expectExactKeys(record, ["evidence_id", "path", "sha256", "record_type", "requirement_ids", "test_ids", "artifacts"], [], itemPath);
    expectString(record.evidence_id, `${itemPath}.evidence_id`);
    expectSafeRelativePath(record.path, `${itemPath}.path`);
    expectSha256(record.sha256, `${itemPath}.sha256`);
    if (!Object.hasOwn(RECORD_KIND_BY_TYPE, record.record_type)) fail(`${itemPath}.record_type`, "unsupported record type");
    expectRequirementIds(record.requirement_ids, `${itemPath}.requirement_ids`);
    expectTestIds(record.test_ids, `${itemPath}.test_ids`);
    validateArtifacts(record.artifacts, `${itemPath}.artifacts`);
    evidenceIds.push(record.evidence_id);
    recordPaths.push(record.path);
  });
  if (new Set(evidenceIds).size !== evidenceIds.length) fail(`${path}.records`, "contains duplicate evidence IDs");
  if (new Set(recordPaths).size !== recordPaths.length) fail(`${path}.records`, "contains duplicate record paths");
  if (JSON.stringify(evidenceIds) !== JSON.stringify([...evidenceIds].sort())) fail(`${path}.records`, "must be sorted by evidence ID");

  const requirementIds = [];
  index.requirements.forEach((requirement, position) => {
    const itemPath = `${path}.requirements[${position}]`;
    expectExactKeys(requirement, ["requirement_id", "test_ids", "evidence_ids"], [], itemPath);
    expectRequirementIds([requirement.requirement_id], `${itemPath}.requirement_id`);
    expectTestIds(requirement.test_ids, `${itemPath}.test_ids`);
    expectEvidenceIds(requirement.evidence_ids, `${itemPath}.evidence_ids`);
    requirementIds.push(requirement.requirement_id);
  });
  if (new Set(requirementIds).size !== requirementIds.length) fail(`${path}.requirements`, "contains duplicate requirement IDs");
  if (JSON.stringify(requirementIds) !== JSON.stringify([...requirementIds].sort())) fail(`${path}.requirements`, "must be sorted by requirement ID");

  const testIds = [];
  index.tests.forEach((test, position) => {
    const itemPath = `${path}.tests[${position}]`;
    expectExactKeys(test, ["test_id", "requirement_ids", "evidence_ids"], [], itemPath);
    expectTestIds([test.test_id], `${itemPath}.test_id`);
    expectRequirementIds(test.requirement_ids, `${itemPath}.requirement_ids`);
    expectEvidenceIds(test.evidence_ids, `${itemPath}.evidence_ids`);
    testIds.push(test.test_id);
  });
  if (new Set(testIds).size !== testIds.length) fail(`${path}.tests`, "contains duplicate test IDs");
  if (JSON.stringify(testIds) !== JSON.stringify([...testIds].sort())) fail(`${path}.tests`, "must be sorted by test ID");
  return index;
}

export function parseJson(text, path) {
  try {
    return JSON.parse(text);
  } catch (error) {
    fail(path, `malformed JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}
