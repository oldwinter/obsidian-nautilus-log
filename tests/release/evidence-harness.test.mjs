import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { FIXTURE_VALIDATION_NOW_MS } from "../fixtures/release/create-dry-run-fixture.mjs";
import { validateEvidenceBundle } from "../../scripts/verify/evidence-bundle.mjs";
import { validateEvidenceRecord } from "../../scripts/verify/evidence-schema.mjs";
import {
  assertTraceOutputOutsideBundle,
  buildTraceReport,
  renderTraceReportJson,
  renderTraceReportMarkdown,
} from "../../scripts/verify/render-trace-report.mjs";
import { verifyEvidenceFromCliArguments } from "../../scripts/verify/verify-evidence.mjs";

const testRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const scenarioCatalog = JSON.parse(readFileSync(resolve(testRoot, "fixtures/evidence/scenarios.json"), "utf8"));
const defaultCandidateSha = "a".repeat(40);
const defaultBlobOid = "b".repeat(40);

function hash(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function fileHash(path) {
  return hash(readFileSync(path));
}

const definitions = [
  ["pure", "CONTRACT", "ENV-PURE", "UP-PAR-01", "EVD-PURE-001"],
  ["vault", "VAULT", "ENV-PURE", "OBS-SAFE-001", "EVD-VAULT-001"],
  ["host", "INTEGRATION", "ENV-HOST-PRIVATE", "OBS-HOST-001", "EVD-HOST-001"],
  ["screenshot", "SCREENSHOT", "ENV-VIS", "OBS-VIS-001", "EVD-SCREENSHOT-001"],
  ["keyboard", "KEYBOARD", "ENV-VIS", "UP-CTL-01", "EVD-KEYBOARD-001"],
  ["accessibility", "A11Y", "ENV-A11Y", "OBS-A11Y-001", "EVD-A11Y-001"],
  ["lifecycle", "LIFECYCLE", "ENV-HOST-PRIVATE", "OBS-LIFE-001", "EVD-LIFECYCLE-001"],
  ["network/privacy", "CONTRACT", "ENV-PURE", "OBS-LOCAL-001", "EVD-LOCAL-001"],
  ["performance", "CONTRACT", "ENV-PURE", "UP-SCH-01", "EVD-PERFORMANCE-001"],
  ["package", "PACKAGE", "ENV-PURE", "REL-001", "EVD-PACKAGE-001"],
  ["manual", "MANUAL", "ENV-HOST-PRIVATE", "REL-002", "EVD-MANUAL-001"],
];

function makeCandidateRequirements() {
  return {
    schema_version: 1,
    test_catalog: definitions.map(([, kind, , requirementId, testId]) => ({
      id: testId,
      requirement_id: requirementId,
      evidence_kind: kind,
      gates: ["G0"],
    })),
    requirements: definitions
      .map(([, , environmentId, requirementId, testId]) => ({
        id: requirementId,
        status: "active",
        tests: [testId],
        environments: [environmentId],
        evidence: [],
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
  };
}

function reverseProjections(records) {
  return {
    requirements: records
      .map((record) => ({
        requirement_id: record.requirement_ids[0],
        test_ids: record.test_ids,
        evidence_ids: [record.evidence_id],
      }))
      .sort((left, right) => left.requirement_id.localeCompare(right.requirement_id)),
    tests: records
      .map((record) => ({
        test_id: record.test_ids[0],
        requirement_ids: record.requirement_ids,
        evidence_ids: [record.evidence_id],
      }))
      .sort((left, right) => left.test_id.localeCompare(right.test_id)),
  };
}

function environmentFor(profileId) {
  const os = profileId === "ENV-A11Y" || profileId === "ENV-HOST-MAC"
    ? ["macOS", "26.0"]
    : profileId === "ENV-HOST-WIN"
      ? ["Windows", "11.0"]
      : ["Ubuntu", "24.04.1"];
  const common = {
    profile_id: profileId,
    os_name: os[0],
    os_version: os[1],
    architecture: "x86_64",
    locale: "en-US",
    timezone: "UTC",
  };
  if (profileId === "ENV-PURE") {
    return {
      ...common,
      tool_versions: { git: "2.54.0", node: "22.23.2", npm: "10.9.8" },
      parameters: {
        "ci-image": "ubuntu-24.04-20260828",
        "dst-boundaries": true,
        "fake-clock": "2026-08-28T00:00:00Z",
        locales: ["en", "zh-CN"],
        timezones: ["America/New_York", "Asia/Shanghai", "UTC"],
      },
    };
  }
  if (profileId === "ENV-VIS") {
    return {
      ...common,
      tool_versions: { chromium: "140.0.7339.16", playwright: "1.55.0" },
      parameters: {
        "content-widths": [320, 360, 519, 520, 521, 900],
        "device-pixel-ratio": 1,
        "fake-clock": "2026-08-28T00:00:00Z",
        fonts: "Noto Sans 2.014",
        "reduced-motion-values": [false, true],
        "theme-modes": ["dark", "light"],
        viewport: "1440x1000",
        "zoom-percent": 100,
      },
    };
  }
  if (profileId === "ENV-A11Y") {
    return {
      ...common,
      tool_versions: {
        chromium: "140.0.7339.16",
        electron: "32.2.5",
        obsidian: "1.13.4",
        "screen-reader": "VoiceOver 26.0",
      },
      parameters: { "reduced-motion": true, "zoom-percent": 200 },
    };
  }
  if (["ENV-HOST-MAC", "ENV-HOST-WIN", "ENV-HOST-LINUX"].includes(profileId)) {
    return {
      ...common,
      tool_versions: { chromium: "140.0.7339.16", electron: "32.2.5", obsidian: "1.13.4" },
      parameters: {
        locales: ["en", "zh-CN"],
        "theme-modes": ["dark", "light"],
        "zoom-percents": [80, 100, 200],
      },
    };
  }
  if (profileId === "ENV-THEME") {
    return {
      ...common,
      tool_versions: { chromium: "140.0.7339.16", electron: "32.2.5", obsidian: "1.13.4" },
      parameters: {
        "theme-class": "high-contrast",
        "theme-name": "Synthetic Contrast",
        "theme-sha256": "d".repeat(64),
        "theme-version": "1.0.0",
        "zoom-percent": 100,
      },
    };
  }
  return {
    ...common,
    tool_versions: { chromium: "140.0.7339.16", electron: "32.2.5", obsidian: "1.13.4" },
    parameters: { theme: "Obsidian Light 1.13.4", "zoom-percent": 100 },
  };
}

function createBundle(root, {
  candidateSha = defaultCandidateSha,
  blobOid = defaultBlobOid,
  candidateRequirements = makeCandidateRequirements(),
} = {}) {
  mkdirSync(root, { recursive: true });
  mkdirSync(resolve(root, "artifacts"), { recursive: true });
  mkdirSync(resolve(root, "records"), { recursive: true });
  writeFileSync(resolve(root, "package.zip"), "synthetic package\n");
  const packageSha256 = fileHash(resolve(root, "package.zip"));
  const records = definitions.map(([recordType, kind, environmentId, requirementId, testId], index) => {
    const sequence = String(index + 1).padStart(3, "0");
    const artifactPath = `artifacts/${sequence}.txt`;
    writeFileSync(resolve(root, artifactPath), `synthetic ${recordType} result\n`);
    const record = {
      schema_version: 1,
      evidence_id: `E-${candidateSha.slice(0, 12)}-${environmentId}-${kind}-${sequence}`,
      record_type: recordType,
      candidate_sha: candidateSha,
      package_sha256: packageSha256,
      environment: environmentFor(environmentId),
      started_at: `2026-08-28T00:00:${String(index).padStart(2, "0")}Z`,
      ended_at: `2026-08-28T00:01:${String(index).padStart(2, "0")}Z`,
      result: "PASS",
      execution: {
        attempts: 1,
        retries: 0,
        skipped: false,
        quarantined: false,
        expected_failure: false,
      },
      requirement_ids: [requirementId],
      test_ids: [testId],
      artifacts: [{ path: artifactPath, sha256: fileHash(resolve(root, artifactPath)) }],
    };
    const recordPath = `records/${sequence}.json`;
    writeJson(resolve(root, recordPath), record);
    return { record, recordPath };
  });

  const orderedRecords = records
    .map(({ record, recordPath }) => ({
      evidence_id: record.evidence_id,
      path: recordPath,
      sha256: fileHash(resolve(root, recordPath)),
      record_type: record.record_type,
      requirement_ids: record.requirement_ids,
      test_ids: record.test_ids,
      artifacts: record.artifacts,
    }))
    .sort((left, right) => left.evidence_id.localeCompare(right.evidence_id));
  const projections = reverseProjections(records.map(({ record }) => record));
  const index = {
    schema_version: 1,
    candidate_sha: candidateSha,
    package_sha256: packageSha256,
    records: orderedRecords,
    requirements: projections.requirements,
    tests: projections.tests,
  };
  writeJson(resolve(root, "evidence-index.json"), index);

  const evidenceByRequirement = new Map(projections.requirements.map((entry) => [entry.requirement_id, entry.evidence_ids]));
  const resolvedRequirements = structuredClone(candidateRequirements);
  resolvedRequirements.requirements.forEach((row) => { row.evidence = evidenceByRequirement.get(row.id); });
  writeJson(resolve(root, "resolved-requirements.json"), resolvedRequirements);

  const fileEntries = [
    { path: "evidence-index.json", role: "index" },
    { path: "package.zip", role: "package" },
    { path: "resolved-requirements.json", role: "requirements" },
    ...records.map(({ recordPath }) => ({ path: recordPath, role: "record" })),
    ...records.map(({ record }) => ({ path: record.artifacts[0].path, role: "artifact" })),
  ]
    .map((entry) => ({ ...entry, sha256: fileHash(resolve(root, entry.path)) }))
    .sort((left, right) => left.path.localeCompare(right.path));
  const manifest = {
    schema_version: 1,
    candidate_sha: candidateSha,
    package: { path: "package.zip", sha256: packageSha256 },
    index: { path: "evidence-index.json", sha256: fileHash(resolve(root, "evidence-index.json")) },
    requirements: {
      path: "resolved-requirements.json",
      sha256: fileHash(resolve(root, "resolved-requirements.json")),
      source_path: "docs/parity/requirements.json",
      source_blob_oid: blobOid,
    },
    files: fileEntries,
  };
  writeJson(resolve(root, "manifest.json"), manifest);
  return { candidateSha, blobOid, candidateRequirements, packageSha256 };
}

function rehashManifest(root) {
  const manifestPath = resolve(root, "manifest.json");
  const manifest = readJson(manifestPath);
  for (const file of manifest.files) file.sha256 = fileHash(resolve(root, file.path));
  manifest.index.sha256 = fileHash(resolve(root, manifest.index.path));
  manifest.requirements.sha256 = fileHash(resolve(root, manifest.requirements.path));
  manifest.package.sha256 = fileHash(resolve(root, manifest.package.path));
  writeJson(manifestPath, manifest);
}

function rehashRecord(root, recordPath, { syncEntry = true } = {}) {
  const indexPath = resolve(root, "evidence-index.json");
  const index = readJson(indexPath);
  const entry = index.records.find((candidate) => candidate.path === recordPath);
  entry.sha256 = fileHash(resolve(root, recordPath));
  if (syncEntry) {
    const record = readJson(resolve(root, recordPath));
    entry.evidence_id = record.evidence_id;
    entry.record_type = record.record_type;
    entry.requirement_ids = record.requirement_ids;
    entry.test_ids = record.test_ids;
    entry.artifacts = record.artifacts;
  }
  writeJson(indexPath, index);
  rehashManifest(root);
}

function validate(root, context, requiredRequirementIds) {
  return validateEvidenceBundle({
    bundleDir: root,
    candidateSha: context.candidateSha,
    packageSha256: context.packageSha256,
    candidateRequirements: context.candidateRequirements,
    candidateRequirementsBlobOid: context.blobOid,
    candidateRequirementsSourcePath: "docs/parity/requirements.json",
    requiredRequirementIds,
    nowMs: FIXTURE_VALIDATION_NOW_MS,
  });
}

function excludeRequirementFromBundle(root, requirementId) {
  const indexPath = resolve(root, "evidence-index.json");
  const index = readJson(indexPath);
  const removedRecords = index.records.filter((record) => record.requirement_ids.includes(requirementId));
  index.records = index.records.filter((record) => !record.requirement_ids.includes(requirementId));
  index.requirements = index.requirements.filter((row) => row.requirement_id !== requirementId);
  index.tests = index.tests.filter((row) => !row.requirement_ids.includes(requirementId));
  for (const record of removedRecords) {
    unlinkSync(resolve(root, record.path));
    for (const artifact of record.artifacts) unlinkSync(resolve(root, artifact.path));
  }
  writeJson(indexPath, index);

  const resolvedPath = resolve(root, "resolved-requirements.json");
  const resolved = readJson(resolvedPath);
  resolved.requirements.find((row) => row.id === requirementId).evidence = [];
  writeJson(resolvedPath, resolved);

  const manifestPath = resolve(root, "manifest.json");
  const manifest = readJson(manifestPath);
  const removedPaths = new Set(removedRecords.flatMap((record) => [
    record.path,
    ...record.artifacts.map((artifact) => artifact.path),
  ]));
  manifest.files = manifest.files.filter((file) => !removedPaths.has(file.path));
  writeJson(manifestPath, manifest);
  rehashManifest(root);
}

function mutateScenario(root, id) {
  const recordPath = "records/001.json";
  const absoluteRecordPath = resolve(root, recordPath);
  if (id === "malformed-record") {
    writeFileSync(absoluteRecordPath, "{\n");
    rehashRecord(root, recordPath, { syncEntry: false });
  } else if (id === "missing-record") {
    unlinkSync(absoluteRecordPath);
  } else if (id === "duplicate-evidence") {
    const index = readJson(resolve(root, "evidence-index.json"));
    index.records.push(structuredClone(index.records[0]));
    writeJson(resolve(root, "evidence-index.json"), index);
    rehashManifest(root);
  } else if (id === "stale-candidate") {
    const record = readJson(absoluteRecordPath);
    const priorEvidenceId = record.evidence_id;
    record.candidate_sha = "c".repeat(40);
    record.evidence_id = record.evidence_id.replace(defaultCandidateSha.slice(0, 12), "c".repeat(12));
    writeJson(absoluteRecordPath, record);
    const index = readJson(resolve(root, "evidence-index.json"));
    const entry = index.records.find((candidate) => candidate.path === recordPath);
    entry.evidence_id = record.evidence_id;
    entry.sha256 = fileHash(absoluteRecordPath);
    for (const projection of [...index.requirements, ...index.tests]) {
      projection.evidence_ids = projection.evidence_ids.map((evidenceId) => evidenceId === priorEvidenceId ? record.evidence_id : evidenceId);
    }
    index.records.sort((left, right) => left.evidence_id.localeCompare(right.evidence_id));
    writeJson(resolve(root, "evidence-index.json"), index);
    const requirements = readJson(resolve(root, "resolved-requirements.json"));
    requirements.requirements.forEach((row) => {
      row.evidence = row.evidence.map((evidenceId) => evidenceId === priorEvidenceId ? record.evidence_id : evidenceId);
    });
    writeJson(resolve(root, "resolved-requirements.json"), requirements);
    rehashManifest(root);
  } else if (id === "stale-package") {
    const record = readJson(absoluteRecordPath);
    record.package_sha256 = "c".repeat(64);
    writeJson(absoluteRecordPath, record);
    rehashRecord(root, recordPath);
  } else if (id === "corrupted-artifact") {
    writeFileSync(resolve(root, "artifacts/001.txt"), "corrupted\n");
  } else if (id === "corrupted-package") {
    writeFileSync(resolve(root, "package.zip"), "corrupted\n");
  } else if (id === "corrupted-owner") {
    const requirements = readJson(resolve(root, "resolved-requirements.json"));
    requirements.requirements[0].owner_ticket = 99;
    writeJson(resolve(root, "resolved-requirements.json"), requirements);
    rehashManifest(root);
  } else if (id === "missing-evidence") {
    const requirements = readJson(resolve(root, "resolved-requirements.json"));
    requirements.requirements[0].evidence = [];
    writeJson(resolve(root, "resolved-requirements.json"), requirements);
    rehashManifest(root);
  } else if (id === "duplicate-test") {
    const record = readJson(absoluteRecordPath);
    record.test_ids.push(record.test_ids[0]);
    writeJson(absoluteRecordPath, record);
    rehashRecord(root, recordPath);
  } else if (id === "path-traversal") {
    const index = readJson(resolve(root, "evidence-index.json"));
    index.records[0].path = "../escape.json";
    writeJson(resolve(root, "evidence-index.json"), index);
    rehashManifest(root);
  } else if (id === "symlink-artifact") {
    unlinkSync(resolve(root, "artifacts/001.txt"));
    symlinkSync(resolve(root, "artifacts/002.txt"), resolve(root, "artifacts/001.txt"));
  } else if (id === "min-supported-token" || id === "current-stable-token" || id === "incomplete-host-profile") {
    const hostRecordPath = "records/003.json";
    const hostRecord = readJson(resolve(root, hostRecordPath));
    if (id === "min-supported-token") hostRecord.environment.tool_versions.obsidian = "MIN_SUPPORTED";
    if (id === "current-stable-token") hostRecord.environment.tool_versions.obsidian = "CURRENT_STABLE";
    if (id === "incomplete-host-profile") delete hostRecord.environment.tool_versions.electron;
    writeJson(resolve(root, hostRecordPath), hostRecord);
    rehashRecord(root, hostRecordPath);
  } else if (id === "invalid-visual-dpr") {
    const visualRecordPath = "records/004.json";
    const visualRecord = readJson(resolve(root, visualRecordPath));
    visualRecord.environment.parameters["device-pixel-ratio"] = 2;
    writeJson(resolve(root, visualRecordPath), visualRecord);
    rehashRecord(root, visualRecordPath);
  } else if (id === "invalid-a11y-zoom") {
    const a11yRecordPath = "records/006.json";
    const a11yRecord = readJson(resolve(root, a11yRecordPath));
    a11yRecord.environment.parameters["zoom-percent"] = 100;
    writeJson(resolve(root, a11yRecordPath), a11yRecord);
    rehashRecord(root, a11yRecordPath);
  } else if (id === "skipped" || id === "quarantined" || id === "retry" || id === "expected-failure" || id === "failed-result" || id === "symbolic-tool-version" || id === "invalid-timestamp") {
    const record = readJson(absoluteRecordPath);
    if (id === "skipped") record.execution.skipped = true;
    if (id === "quarantined") record.execution.quarantined = true;
    if (id === "retry") record.execution.retries = 1;
    if (id === "expected-failure") record.execution.expected_failure = true;
    if (id === "failed-result") record.result = "FAIL";
    if (id === "symbolic-tool-version") record.environment.tool_versions.node = "latest";
    if (id === "invalid-timestamp") record.started_at = "2026-02-30T00:00:00Z";
    writeJson(absoluteRecordPath, record);
    rehashRecord(root, recordPath);
  } else if (id === "stale-requirements-object") {
    const manifest = readJson(resolve(root, "manifest.json"));
    manifest.requirements.source_blob_oid = "c".repeat(40);
    writeJson(resolve(root, "manifest.json"), manifest);
  } else if (id === "invalid-object-id-length") {
    const manifest = readJson(resolve(root, "manifest.json"));
    manifest.requirements.source_blob_oid = "c".repeat(41);
    writeJson(resolve(root, "manifest.json"), manifest);
  } else if (id === "alternate-requirements-path") {
    const manifest = readJson(resolve(root, "manifest.json"));
    manifest.requirements.source_path = "tests/fixtures/alternate-requirements.json";
    writeJson(resolve(root, "manifest.json"), manifest);
  } else if (id === "corrupted-index") {
    const index = readJson(resolve(root, "evidence-index.json"));
    index.package_sha256 = "c".repeat(64);
    writeJson(resolve(root, "evidence-index.json"), index);
  } else {
    throw new Error(`unknown fixture scenario ${id}`);
  }
}

test("validates every supported record type and exact reverse links", () => {
  const root = mkdtempSync(resolve(tmpdir(), "spiral-evidence-pass-"));
  try {
    const context = createBundle(root);
    const result = validate(root, context);
    assert.deepEqual(result.records.map((record) => record.record_type).sort(), definitions.map(([type]) => type).sort());
    assert.equal(result.index.requirements.length, definitions.length);
    assert.equal(result.index.tests.length, definitions.length);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("validates every accepted environment profile with exact matrix values", () => {
  const profiles = [
    ["ENV-PURE", "pure", "CONTRACT"],
    ["ENV-VIS", "screenshot", "SCREENSHOT"],
    ["ENV-HOST-PRIVATE", "host", "INTEGRATION"],
    ["ENV-HOST-MIN", "host", "INTEGRATION"],
    ["ENV-HOST-MAC", "host", "INTEGRATION"],
    ["ENV-HOST-WIN", "host", "INTEGRATION"],
    ["ENV-HOST-LINUX", "host", "INTEGRATION"],
    ["ENV-THEME", "host", "INTEGRATION"],
    ["ENV-A11Y", "accessibility", "A11Y"],
  ];
  for (const [profileId, recordType, kind] of profiles) {
    assert.doesNotThrow(() => validateEvidenceRecord({
      schema_version: 1,
      evidence_id: `E-${defaultCandidateSha.slice(0, 12)}-${profileId}-${kind}-999`,
      record_type: recordType,
      candidate_sha: defaultCandidateSha,
      package_sha256: "e".repeat(64),
      environment: environmentFor(profileId),
      started_at: "2026-08-28T00:00:00Z",
      ended_at: "2026-08-28T00:01:00Z",
      result: "PASS",
      execution: { attempts: 1, retries: 0, skipped: false, quarantined: false, expected_failure: false },
      requirement_ids: ["OBS-TRACE-001"],
      test_ids: ["EVD-ENV-001"],
      artifacts: [{ path: "artifacts/environment.txt", sha256: "f".repeat(64) }],
    }, profileId, { nowMs: FIXTURE_VALIDATION_NOW_MS }));
  }
  const mismatched = {
    schema_version: 1,
    evidence_id: `E-${defaultCandidateSha.slice(0, 12)}-ENV-PURE-SCREENSHOT-998`,
    record_type: "screenshot",
    candidate_sha: defaultCandidateSha,
    package_sha256: "e".repeat(64),
    environment: environmentFor("ENV-PURE"),
    started_at: "2026-08-28T00:00:00Z",
    ended_at: "2026-08-28T00:01:00Z",
    result: "PASS",
    execution: { attempts: 1, retries: 0, skipped: false, quarantined: false, expected_failure: false },
    requirement_ids: ["OBS-VIS-001"],
    test_ids: ["EVD-ENV-002"],
    artifacts: [{ path: "artifacts/environment.txt", sha256: "f".repeat(64) }],
  };
  assert.throws(
    () => validateEvidenceRecord(mismatched, "mismatched", { nowMs: FIXTURE_VALIDATION_NOW_MS }),
    /screenshot evidence cannot use ENV-PURE/,
  );
});

test("binds Evidence ID kind to the committed test catalog", () => {
  const root = mkdtempSync(resolve(tmpdir(), "spiral-evidence-kind-"));
  try {
    const candidateRequirements = makeCandidateRequirements();
    candidateRequirements.test_catalog.find((entry) => entry.id === "EVD-PURE-001").evidence_kind = "UNIT";
    const context = createBundle(root, { candidateRequirements });
    assert.throws(() => validate(root, context), /kind does not match EVD-PURE-001 kind UNIT/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("rejects nonsense numeric versions for known private-host tools", () => {
  const record = {
    schema_version: 1,
    evidence_id: `E-${defaultCandidateSha.slice(0, 12)}-ENV-HOST-PRIVATE-INTEGRATION-997`,
    record_type: "host",
    candidate_sha: defaultCandidateSha,
    package_sha256: "e".repeat(64),
    environment: environmentFor("ENV-HOST-PRIVATE"),
    started_at: "2026-08-28T00:00:00Z",
    ended_at: "2026-08-28T00:01:00Z",
    result: "PASS",
    execution: { attempts: 1, retries: 0, skipped: false, quarantined: false, expected_failure: false },
    requirement_ids: ["OBS-HOST-001"],
    test_ids: ["EVD-ENV-003"],
    artifacts: [{ path: "artifacts/environment.txt", sha256: "f".repeat(64) }],
  };
  record.environment.tool_versions.obsidian = "definitely-version-ish";
  assert.throws(
    () => validateEvidenceRecord(record, "private-host", { nowMs: FIXTURE_VALIDATION_NOW_MS }),
    /numeric dotted version/,
  );
});

test("freshness uses real time by default and honors explicit age and skew boundaries", () => {
  const root = mkdtempSync(resolve(tmpdir(), "spiral-evidence-clock-"));
  try {
    createBundle(root);
    const record = readJson(resolve(root, "records/001.json"));
    const ended = Date.parse(record.ended_at);
    assert.doesNotThrow(() => validateEvidenceRecord(record, "fixture", { nowMs: FIXTURE_VALIDATION_NOW_MS }));
    assert.doesNotThrow(() => validateEvidenceRecord(record, "boundary", { nowMs: ended + 7 * 24 * 60 * 60 * 1000 }));
    assert.throws(() => validateEvidenceRecord(record, "stale", { nowMs: ended + 7 * 24 * 60 * 60 * 1000 + 1 }), /evidence is stale/);
    const defaultStale = structuredClone(record);
    const defaultStaleEndedAt = Date.now() - 7 * 24 * 60 * 60 * 1000 - 1;
    defaultStale.started_at = new Date(defaultStaleEndedAt - 1).toISOString();
    defaultStale.ended_at = new Date(defaultStaleEndedAt).toISOString();
    assert.throws(() => validateEvidenceRecord(defaultStale, "default-real-time"), /evidence is stale/);
    const future = structuredClone(record);
    future.started_at = new Date(ended + 5 * 60 * 1000 + 1).toISOString();
    future.ended_at = future.started_at;
    assert.throws(() => validateEvidenceRecord(future, "future", { nowMs: ended }), /future skew/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("renders deterministic forward and reverse trace paths", () => {
  const root = mkdtempSync(resolve(tmpdir(), "spiral-evidence-trace-"));
  try {
    const result = validate(root, createBundle(root));
    const report = buildTraceReport(result);
    const first = renderTraceReportJson(report);
    assert.equal(first, renderTraceReportJson(buildTraceReport(result)));
    assert.match(renderTraceReportMarkdown(report), /Requirement \| Test \| Evidence \| Artifacts/);
    assert.throws(
      () => assertTraceOutputOutsideBundle(root, resolve(root, "derived-report.json")),
      /outside the immutable evidence bundle/,
    );
    const hostileReport = structuredClone(report);
    hostileReport.reverse.artifacts[0].path = "artifacts/result|`tick`.txt";
    assert.ok(renderTraceReportMarkdown(hostileReport).includes("artifacts/result\\|`tick`.txt"));
    for (const requirement of report.forward.requirements) {
      assert.equal(requirement.tests.length, 1);
      assert.equal(requirement.tests[0].evidence.length, 1);
      const artifactPath = requirement.tests[0].evidence[0].artifacts[0].path;
      const reverse = report.reverse.artifacts.find((artifact) => artifact.path === artifactPath);
      assert.ok(reverse.requirement_ids.includes(requirement.requirement_id));
      assert.ok(reverse.test_ids.includes(requirement.tests[0].test_id));
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("private evidence scopes require complete included rows and empty excluded rows", () => {
  const root = mkdtempSync(resolve(tmpdir(), "spiral-evidence-private-"));
  try {
    const context = createBundle(root);
    const excludedId = definitions.at(-1)[3];
    const requiredIds = definitions.slice(0, -1).map((definition) => definition[3]);
    excludeRequirementFromBundle(root, excludedId);
    const privateResult = validate(root, context, requiredIds);
    assert.equal(privateResult.records.length, requiredIds.length);
    const privateTrace = buildTraceReport(privateResult);
    assert.equal(privateTrace.scope.release_scope, "private");
    assert.deepEqual(privateTrace.scope.included_requirement_ids, [...requiredIds].sort());
    assert.deepEqual(privateTrace.scope.excluded_requirement_ids, [excludedId]);

    const resolvedPath = resolve(root, "resolved-requirements.json");
    const resolved = readJson(resolvedPath);
    resolved.requirements.find((row) => row.id === excludedId).evidence = [
      readJson(resolve(root, "evidence-index.json")).records[0].evidence_id,
    ];
    writeJson(resolvedPath, resolved);
    rehashManifest(root);
    assert.throws(
      () => validate(root, context, requiredIds),
      /excluded active requirements must remain empty/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

for (const scenario of scenarioCatalog.failing) {
  test(`fails closed: ${scenario.id}`, () => {
    const root = mkdtempSync(resolve(tmpdir(), `spiral-evidence-${scenario.id}-`));
    try {
      const context = createBundle(root);
      mutateScenario(root, scenario.id);
      assert.throws(() => validate(root, context), new RegExp(scenario.expected));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}

test("CLI reads requirements from the exact candidate object, not dirty worktree state", () => {
  const repo = mkdtempSync(resolve(tmpdir(), "spiral-evidence-git-"));
  const bundle = mkdtempSync(resolve(tmpdir(), "spiral-evidence-cli-"));
  try {
    execFileSync("git", ["init", "-q", repo]);
    execFileSync("git", ["-C", repo, "config", "user.email", "evidence@example.invalid"]);
    execFileSync("git", ["-C", repo, "config", "user.name", "Evidence Fixture"]);
    const requirementsPath = resolve(repo, "docs/parity/requirements.json");
    writeJson(requirementsPath, makeCandidateRequirements());
    execFileSync("git", ["-C", repo, "add", "docs/parity/requirements.json"]);
    execFileSync("git", ["-C", repo, "commit", "-qm", "candidate"]);
    const candidateSha = execFileSync("git", ["-C", repo, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    const blobOid = execFileSync("git", ["-C", repo, "rev-parse", `${candidateSha}:docs/parity/requirements.json`], { encoding: "utf8" }).trim();
    const context = createBundle(bundle, { candidateSha, blobOid });
    writeJson(requirementsPath, { corrupted_worktree_copy: true });
    const result = verifyEvidenceFromCliArguments([
      "--bundle", bundle,
      "--candidate-sha", candidateSha,
      "--package-sha256", context.packageSha256,
      "--repo", repo,
    ], { nowMs: FIXTURE_VALIDATION_NOW_MS });
    assert.equal(result.candidateSha, candidateSha);
    assert.equal(result.resolvedRequirements.requirements.length, definitions.length);
  } finally {
    rmSync(repo, { recursive: true, force: true });
    rmSync(bundle, { recursive: true, force: true });
  }
});
