import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import {
  MANDATORY_PRIVATE_REQUIREMENT_IDS,
  REQUIRED_REQUIREMENT_IDS,
} from "../../../scripts/verify/candidate-g0.mjs";
import { buildDeterministicCandidatePackage } from "../../../scripts/verify/candidate-package.mjs";

const execFileAsync = promisify(execFile);
const PASS_EXECUTION = {
  attempts: 1,
  retries: 0,
  skipped: false,
  quarantined: false,
  expected_failure: false,
};
const ENVIRONMENT_IDS = [
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
export const FIXTURE_VALIDATION_NOW_MS = Date.parse("2026-08-29T00:00:00.000Z");

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function json(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function git(repository, ...args) {
  return (await execFileAsync("git", args, { cwd: repository })).stdout.trim();
}

function gatesForRequirement(id) {
  if (id.startsWith("UP-DRF-")) return ["G0", "G2", "G8"];
  const mappings = {
    "OBS-LOCAL-001": ["G4", "G7", "G8"],
    "OBS-LIFE-001": ["G1", "G4", "G7", "G8"],
    "OBS-SAFE-001": ["G2", "G3", "G4", "G8"],
    "OBS-I18N-001": ["G1", "G5", "G6"],
    "OBS-HOST-001": ["G4", "G5"],
    "OBS-VIS-001": ["G4", "G5", "G6"],
    "OBS-VIS-002": ["G4", "G5", "G6"],
  };
  return mappings[id] ?? ["G0"];
}

function requirementManifest() {
  const tests = REQUIRED_REQUIREMENT_IDS.map((id) => `TEST-${id}`);
  return {
    $schema: "../../scripts/release/schemas/requirements.schema.json",
    schema_version: 1,
    requirement_set: "spiral-day-v1.0.2",
    upstream_baseline_sha: "973a041aa2f59f3b05bf31db8187efbfea07017a",
    row_count: 126,
    counts: { upstream: 114, obsidian: 9, release: 3 },
    fixture_catalog: Array.from({ length: 16 }, (_, index) => ({
      id: `FX-${String(index + 1).padStart(2, "0")}`,
      path: "tests/fixtures/release/synthetic",
    })),
    test_catalog: tests.map((id) => ({
      id,
      requirement_id: id.slice("TEST-".length),
      evidence_kind: id === "TEST-OBS-LOCAL-001" ? "INTEGRATION" : "CONTRACT",
      gates: gatesForRequirement(id.slice("TEST-".length)),
    })),
    environment_catalog: ENVIRONMENT_IDS.map((id) => ({
      id,
      description: `${id} exact synthetic dry-run values`,
    })),
    requirements: REQUIRED_REQUIREMENT_IDS.map((id, index) => ({
      id,
      owner_ticket: id === "OBS-TRACE-001" || id === "REL-001" || id === "REL-002" ? 22 : 18,
      owner_module: id === "OBS-TRACE-001" ? "scripts/verify/" : "src/domain/",
      statement: `Synthetic observable statement for ${id}.`,
      source_refs: [
        "https://github.com/oldwinter/obsidian-nautilus-log/blob/f3dcf1a000624a705b8c868a4f681339fcd6bedd/docs/implementation-dossier.md",
      ],
      disposition: id === "UP-INS-01" ? "not-applicable" : "exact",
      fixtures: [`FX-${String((index % 16) + 1).padStart(2, "0")}`],
      tests: [`TEST-${id}`],
      environments: [id === "UP-PER-01" ? "ENV-PURE" : ENVIRONMENT_IDS[index % ENVIRONMENT_IDS.length]],
      evidence: [],
      ...(id === "UP-INS-01" ? { not_applicable_approval_id: "NA-001" } : {}),
      status: "active",
    })),
  };
}

function deviationsManifest() {
  return {
    schema_version: 1,
    requirement_set: "spiral-day-v1.0.2",
    deviations: [],
    not_applicable_approvals: [{
      id: "NA-001",
      requirement_ids: ["UP-INS-01"],
      status: "approved",
      reason: "The conflicting Roam Depot installation route does not apply to an Obsidian package.",
      reviewer: "dry-run parity reviewer",
      approved_at: "2026-08-28T00:00:00.000Z",
      source_refs: [
        "https://github.com/oldwinter/obsidian-nautilus-log/blob/f3dcf1a000624a705b8c868a4f681339fcd6bedd/docs/implementation-dossier.md",
      ],
    }],
  };
}

async function createCandidateRepository(root, sourceRoot) {
  const repository = path.join(root, "candidate");
  const remote = path.join(root, "remote.git");
  await mkdir(repository, { recursive: true });
  await json(path.join(repository, "manifest.json"), {
    id: "spiral-day",
    name: "Spiral Day",
    version: "1.0.2",
    minAppVersion: "1.7.7",
    isDesktopOnly: true,
  });
  await json(path.join(repository, "package.json"), {
    name: "spiral-day",
    version: "1.0.2",
    scripts: { build: "node build.mjs" },
  });
  await json(path.join(repository, "package-lock.json"), {
    name: "spiral-day",
    version: "1.0.2",
    lockfileVersion: 3,
    requires: true,
    packages: { "": { name: "spiral-day", version: "1.0.2" } },
  });
  await writeFile(path.join(repository, "build.mjs"), "import { copyFileSync } from 'node:fs';\ncopyFileSync('source-main.js', 'main.js');\n");
  await writeFile(path.join(repository, "source-main.js"), "export const synthetic = true;\n");
  const releaseInputs = JSON.parse(
    await readFile(path.join(sourceRoot, "scripts/release/release-inputs.json"), "utf8"),
  );
  for (const relativePath of [...releaseInputs.candidate_owned, ...releaseInputs.transitive_inputs]) {
    const destination = path.join(repository, relativePath);
    await mkdir(path.dirname(destination), { recursive: true });
    await cp(path.join(sourceRoot, relativePath), destination);
  }
  await git(repository, "init", "-q");
  await git(repository, "config", "user.name", "Spiral Day Dry Run");
  await git(repository, "config", "user.email", "dry-run@example.invalid");
  await git(repository, "add", ".");
  await git(repository, "commit", "-qm", "synthetic exact candidate");
  await git(repository, "branch", "-M", "candidate");
  await execFileAsync("git", ["init", "--bare", "-q", remote]);
  await git(repository, "remote", "add", "origin", remote);
  await git(repository, "push", "-qu", "origin", "candidate");
  return { repository, remote, candidateSha: await git(repository, "rev-parse", "HEAD") };
}

function environmentFor(profileId, themeClass = "high-contrast") {
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
        "theme-class": themeClass,
        "theme-name": themeClass === "high-contrast" ? "Synthetic Contrast" : "Synthetic Customized",
        "theme-sha256": sha256(themeClass),
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

function evidenceShape(requirementId, profileId, evidenceKind) {
  if (profileId === "ENV-PURE") {
    if (requirementId === "UP-PER-01" && evidenceKind === "CONTRACT") return ["performance", "CONTRACT"];
    if (requirementId === "OBS-LOCAL-001") return ["network/privacy", "INTEGRATION"];
    if (evidenceKind === "PACKAGE") return ["package", "PACKAGE"];
    if (evidenceKind === "VAULT") return ["vault", "VAULT"];
    return ["pure", evidenceKind];
  }
  if (profileId === "ENV-VIS") {
    if (evidenceKind === "A11Y") return ["accessibility", "A11Y"];
    if (evidenceKind === "KEYBOARD") return ["keyboard", "KEYBOARD"];
    return ["screenshot", "SCREENSHOT"];
  }
  if (profileId === "ENV-A11Y") {
    if (evidenceKind === "MANUAL") return ["manual", "MANUAL"];
    if (evidenceKind === "KEYBOARD") return ["keyboard", "KEYBOARD"];
    return ["accessibility", "A11Y"];
  }
  if (requirementId === "OBS-LOCAL-001") return ["network/privacy", "INTEGRATION"];
  if (evidenceKind === "LIFECYCLE") return ["lifecycle", "LIFECYCLE"];
  if (evidenceKind === "PACKAGE") return ["package", "PACKAGE"];
  if (evidenceKind === "MANUAL") return ["manual", "MANUAL"];
  if (evidenceKind === "KEYBOARD") return ["keyboard", "KEYBOARD"];
  if (evidenceKind === "VAULT") return ["vault", "VAULT"];
  return ["host", "INTEGRATION"];
}

function compatibleProfiles(evidenceKind, requirementId) {
  if (["UNIT", "CONTRACT"].includes(evidenceKind)) return ["ENV-PURE"];
  if (evidenceKind === "SCREENSHOT") return ["ENV-VIS"];
  if (evidenceKind === "A11Y") return ["ENV-VIS", "ENV-A11Y"];
  if (evidenceKind === "KEYBOARD") return ["ENV-VIS", "ENV-A11Y", "ENV-HOST-PRIVATE", "ENV-HOST-MIN", "ENV-HOST-MAC", "ENV-HOST-WIN", "ENV-HOST-LINUX"];
  if (evidenceKind === "LIFECYCLE") return ["ENV-HOST-PRIVATE", "ENV-HOST-MIN", "ENV-HOST-MAC", "ENV-HOST-WIN", "ENV-HOST-LINUX"];
  if (evidenceKind === "MANUAL") return ["ENV-A11Y", "ENV-THEME", "ENV-HOST-PRIVATE", "ENV-HOST-MIN", "ENV-HOST-MAC", "ENV-HOST-WIN", "ENV-HOST-LINUX"];
  if (evidenceKind === "INTEGRATION") return [
    "ENV-PURE",
    "ENV-THEME", "ENV-HOST-PRIVATE", "ENV-HOST-MIN", "ENV-HOST-MAC", "ENV-HOST-WIN", "ENV-HOST-LINUX",
  ];
  return ["ENV-PURE", "ENV-HOST-PRIVATE", "ENV-HOST-MIN", "ENV-HOST-MAC", "ENV-HOST-WIN", "ENV-HOST-LINUX"];
}

async function createEvidenceBundle(root, repository, candidateSha, options = {}) {
  const bundleRoot = path.join(root, "evidence-bundle");
  await mkdir(path.join(bundleRoot, "records"), { recursive: true });
  await mkdir(path.join(bundleRoot, "artifacts"), { recursive: true });
  const rebuiltPath = path.join(root, "rebuilt-package.zip");
  const rebuilt = await buildDeterministicCandidatePackage({ repository, candidateSha, outputPath: rebuiltPath });
  rebuilt.package_filename = `spiral-day-${rebuilt.version}.zip`;
  const packageBytes = await readFile(rebuiltPath);
  await unlink(rebuiltPath);
  const packageHash = rebuilt.package_sha256;
  const packageBundlePath = "artifacts/spiral-day.zip";
  await writeFile(path.join(bundleRoot, packageBundlePath), packageBytes);
  const requirementsBytes = await readFile(path.join(repository, "docs/parity/requirements.json"));
  const candidateRequirements = JSON.parse(requirementsBytes);
  const testById = new Map(candidateRequirements.test_catalog.map((entry) => [entry.id, entry]));
  const resolvedRequirements = structuredClone(candidateRequirements);
  const includedRequirementIds = new Set(options.includedRequirementIds ?? REQUIRED_REQUIREMENT_IDS);
  const requiredEnvironmentIds = new Set(options.requiredEnvironmentIds ?? ENVIRONMENT_IDS);
  const records = [];
  const fileDescriptors = [
    { path: packageBundlePath, sha256: packageHash, role: "package" },
  ];
  let sequence = 0;

  for (const [rowIndex, row] of candidateRequirements.requirements.entries()) {
    if (!includedRequirementIds.has(row.id)) continue;
    const applicableEnvironments = row.environments.filter((profileId) => requiredEnvironmentIds.has(profileId));
    const assignments = row.tests.map((testId) => {
      const testEntry = testById.get(testId);
      const profileId = applicableEnvironments.find((candidate) => compatibleProfiles(testEntry.evidence_kind, row.id).includes(candidate));
      if (!profileId) throw new Error(`${testId} has no compatible declared environment`);
      return { testId, testEntry, profileId, themeClass: null };
    });
    const coveredProfiles = new Set(assignments.map((entry) => entry.profileId));
    for (const profileId of applicableEnvironments) {
      if (coveredProfiles.has(profileId)) continue;
      const testEntry = row.tests.map((id) => testById.get(id))
        .find((entry) => compatibleProfiles(entry.evidence_kind, row.id).includes(profileId));
      if (!testEntry) throw new Error(`${row.id} has no evidence modality compatible with ${profileId}`);
      assignments.push({ testId: testEntry.id, testEntry, profileId, themeClass: null });
    }
    if (applicableEnvironments.includes("ENV-THEME")) {
      const themeTest = assignments.find((entry) => entry.profileId === "ENV-THEME");
      themeTest.themeClass = "community-customized";
      assignments.push({ ...themeTest, themeClass: "high-contrast" });
    }
    const evidenceIds = [];
    for (const { testId, testEntry, profileId, themeClass } of assignments) {
      sequence += 1;
      const [recordType, kind] = evidenceShape(row.id, profileId, testEntry.evidence_kind);
      const ordinal = String(sequence).padStart(3, "0");
      const evidenceId = `E-${candidateSha.slice(0, 12)}-${profileId}-${kind}-${ordinal}`;
      const artifactPath = `artifacts/${ordinal}.txt`;
      const artifactBytes = Buffer.from(`synthetic ${row.id} ${profileId} ${themeClass ?? "default"}\n`);
      await writeFile(path.join(bundleRoot, artifactPath), artifactBytes);
      const record = {
        schema_version: 1,
        evidence_id: evidenceId,
        record_type: recordType,
        candidate_sha: candidateSha,
        package_sha256: packageHash,
        environment: environmentFor(profileId, themeClass ?? "high-contrast"),
        started_at: "2026-08-28T00:00:00.000Z",
        ended_at: "2026-08-28T00:00:01.000Z",
        result: "PASS",
        execution: PASS_EXECUTION,
        requirement_ids: [row.id],
        test_ids: [testId],
        artifacts: [{ path: artifactPath, sha256: sha256(artifactBytes) }],
      };
      const recordPath = `records/${ordinal}.json`;
      const recordBytes = Buffer.from(`${JSON.stringify(record, null, 2)}\n`);
      await writeFile(path.join(bundleRoot, recordPath), recordBytes);
      fileDescriptors.push(
        { path: artifactPath, sha256: sha256(artifactBytes), role: "artifact" },
        { path: recordPath, sha256: sha256(recordBytes), role: "record" },
      );
      records.push({ record, recordPath, recordHash: sha256(recordBytes) });
      evidenceIds.push(evidenceId);
    }
    resolvedRequirements.requirements[rowIndex].evidence = evidenceIds.sort();
  }

  const recordDescriptors = records
    .map(({ record, recordPath, recordHash }) => ({
      evidence_id: record.evidence_id,
      path: recordPath,
      sha256: recordHash,
      record_type: record.record_type,
      requirement_ids: record.requirement_ids,
      test_ids: record.test_ids,
      artifacts: record.artifacts,
    }))
    .sort((left, right) => left.evidence_id.localeCompare(right.evidence_id));
  const requirementIndex = resolvedRequirements.requirements
    .filter((row) => includedRequirementIds.has(row.id))
    .map((row) => ({ requirement_id: row.id, test_ids: row.tests, evidence_ids: row.evidence }))
    .sort((left, right) => left.requirement_id.localeCompare(right.requirement_id));
  const testIndex = candidateRequirements.test_catalog
    .filter((testEntry) => includedRequirementIds.has(testEntry.requirement_id))
    .map((testEntry) => ({
    test_id: testEntry.id,
    requirement_ids: [testEntry.requirement_id],
    evidence_ids: recordDescriptors.filter((record) => record.test_ids.includes(testEntry.id)).map((record) => record.evidence_id).sort(),
  })).sort((left, right) => left.test_id.localeCompare(right.test_id));
  const resolvedPath = "resolved-requirements.json";
  const resolvedBytes = Buffer.from(`${JSON.stringify(resolvedRequirements, null, 2)}\n`);
  await writeFile(path.join(bundleRoot, resolvedPath), resolvedBytes);
  fileDescriptors.push({ path: resolvedPath, sha256: sha256(resolvedBytes), role: "requirements" });
  const indexValue = {
    schema_version: 1,
    candidate_sha: candidateSha,
    package_sha256: packageHash,
    records: recordDescriptors,
    requirements: requirementIndex,
    tests: testIndex,
  };
  const indexPath = "evidence-index.json";
  const indexBytes = Buffer.from(`${JSON.stringify(indexValue, null, 2)}\n`);
  await writeFile(path.join(bundleRoot, indexPath), indexBytes);
  fileDescriptors.push({ path: indexPath, sha256: sha256(indexBytes), role: "index" });
  const sourceBlobOid = await git(repository, "rev-parse", `${candidateSha}:docs/parity/requirements.json`);
  const manifest = {
    schema_version: 1,
    candidate_sha: candidateSha,
    package: { path: packageBundlePath, sha256: packageHash },
    index: { path: indexPath, sha256: sha256(indexBytes) },
    requirements: {
      path: resolvedPath,
      sha256: sha256(resolvedBytes),
      source_path: "docs/parity/requirements.json",
      source_blob_oid: sourceBlobOid,
    },
    files: fileDescriptors.sort((left, right) => left.path.localeCompare(right.path)),
  };
  await json(path.join(bundleRoot, "manifest.json"), manifest);
  return {
    bundleRoot,
    packageBytes,
    packageHash,
    indexValue,
    candidateRequirements,
    requirementsSha256: sha256(requirementsBytes),
    deviationsSha256: sha256(await readFile(path.join(repository, "docs/parity/deviations.json"))),
    rebuilt,
    manifestSha256: sha256(await readFile(path.join(bundleRoot, "manifest.json"))),
    indexSha256: sha256(indexBytes),
  };
}

async function createReleaseInputs(root, repository, candidateSha, evidence, options = {}) {
  const inputRoot = path.join(root, "release-inputs");
  await mkdir(path.join(inputRoot, "artifacts"), { recursive: true });
  const packagePath = path.join(inputRoot, "artifacts/spiral-day-1.0.2.zip");
  await writeFile(packagePath, evidence.packageBytes);
  const releaseScope = options.releaseScope ?? "public";
  const includedRequirementIds = options.includedRequirementIds ?? REQUIRED_REQUIREMENT_IDS;
  const included = new Set(includedRequirementIds);
  const scope = {
    schema_version: 1,
    candidate_sha: candidateSha,
    requirements_sha256: evidence.requirementsSha256,
    deviations_sha256: evidence.deviationsSha256,
    release_scope: releaseScope,
    parity_claim: releaseScope === "public" ? "v1.0.2-parity" : "private-preview",
    included_requirement_ids: includedRequirementIds,
    excluded_requirement_ids: REQUIRED_REQUIREMENT_IDS.filter((id) => !included.has(id)),
    approved_deviation_ids: [],
  };
  await json(path.join(inputRoot, "g8-scope.json"), scope);
  const build = evidence.rebuilt.builds[0];
  const g7 = {
    schema_version: 1,
    gate: "G7",
    result: "PASS",
    candidate_sha: candidateSha,
    version: "1.0.2",
    release_label: releaseScope === "public" ? "public parity candidate" : "private preview",
    package_filename: "spiral-day-1.0.2.zip",
    package_path: "artifacts/spiral-day-1.0.2.zip",
    package_sha256: evidence.packageHash,
    builds: evidence.rebuilt.builds,
    smoke_workflows: ["clean-install", "upgrade", "disable", "uninstall"].map((id) => ({
      id,
      result: "PASS",
      exact_package: true,
      candidate_sha: candidateSha,
      package_sha256: evidence.packageHash,
      execution: PASS_EXECUTION,
    })),
    policy: {
      checked_at: new Date(FIXTURE_VALIDATION_NOW_MS).toISOString(),
      official_policy_url: "https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines",
      name_available: true,
      fork_policy_status: releaseScope === "public" ? "approved" : "not-applicable-private",
      license_present: true,
      notices_present: true,
      provenance_passed: true,
      sbom_present: true,
      banner_passed: true,
    },
    release_assets: [
      { path: "LICENSE", sha256: sha256(await readFile(path.join(repository, "LICENSE"))) },
      { path: "THIRD_PARTY_NOTICES.md", sha256: sha256(await readFile(path.join(repository, "THIRD_PARTY_NOTICES.md"))) },
    ],
  };
  await json(path.join(inputRoot, "g7-package.json"), g7);
  const indexTestById = new Map(evidence.indexValue.tests.map((entry) => [entry.test_id, entry]));
  const gateRow = (index) => {
    const id = `G${index}`;
    const testIds = evidence.candidateRequirements.test_catalog
      .filter((entry) => included.has(entry.requirement_id) && entry.gates.includes(id)).map((entry) => entry.id).sort();
    const evidenceIds = [...new Set(testIds.flatMap((testId) => indexTestById.get(testId).evidence_ids))].sort();
    return {
    id,
    result: "PASS",
    candidate_sha: candidateSha,
    package_sha256: evidence.packageHash,
    command: ["node", "scripts/release/run-gate.mjs", "--gate", id],
    test_ids: testIds,
    evidence_ids: evidenceIds,
    result_url: `https://github.com/oldwinter/obsidian-nautilus-log/issues/31#gate-g${index}`,
    started_at: `2026-08-28T00:00:${String(index).padStart(2, "0")}.000Z`,
    ended_at: `2026-08-28T00:00:${String(index + 1).padStart(2, "0")}.000Z`,
    execution: PASS_EXECUTION,
    };
  };
  const gates = Array.from({ length: 9 }, (_, index) => gateRow(index));
  await json(path.join(inputRoot, "gate-results.json"), {
    schema_version: 1,
    candidate_sha: candidateSha,
    package_sha256: evidence.packageHash,
    gates,
  });
  const repositoryState = {
    local_head: candidateSha,
    tracking_head: candidateSha,
    remote_head: candidateSha,
    worktree: "clean",
  };
  const workflowIds = [
    "first-install-settings",
    "planning-overflow-progress",
    "clock-switch-complete-reload",
    "standalone-pomo-warnings",
    "review-date-rollover",
  ];
  const signoff = {
    schema_version: 1,
    gate: "G9",
    decision: releaseScope === "public" ? "GO" : "HOLD",
    release_type: releaseScope,
    version: "1.0.2",
    candidate_sha: candidateSha,
    remote_head: candidateSha,
    package_filename: "spiral-day-1.0.2.zip",
    package_sha256: evidence.packageHash,
    requirements: {
      revision_sha256: evidence.requirementsSha256,
      upstream_count: "114/114",
      active_count: 126,
    },
    gate_results: gates.map(({ id, result, result_url, candidate_sha, package_sha256, test_ids, evidence_ids }) => ({
      id, result, result_url,
      candidate_sha, package_sha256, test_ids, evidence_ids,
    })),
    evidence_bundle: {
      index_url: "https://github.com/oldwinter/obsidian-nautilus-log/issues/31#evidence-index",
      index_sha256: evidence.indexSha256,
      sha256: evidence.manifestSha256,
    },
    release: {
      url: "https://github.com/oldwinter/obsidian-nautilus-log/releases/tag/1.0.2",
      tag: "1.0.2",
      draft: false,
      published: true,
      target_sha: candidateSha,
    },
    approved_deviation_ids: [],
    scope_exclusions: [],
    manual_workflows: workflowIds.map((id, index) => ({
      id,
      result: "PASS",
      candidate_sha: candidateSha,
      package_sha256: evidence.packageHash,
      local_date: index < 3 ? "2026-08-28" : "2026-08-29",
    })),
    attestations: [
      "candidate-owner",
      "ci-evidence-controller",
      "data-safety-reviewer",
      "parity-reviewer",
      "release-owner",
    ].map((role) => ({
      role,
      name: `dry-run ${role}`,
      timestamp: "2026-08-29T00:00:00.000Z",
      attested: true,
    })),
    repository_state: { before: repositoryState, after: structuredClone(repositoryState) },
  };
  await json(path.join(inputRoot, "g9-signoff.json"), signoff);
  return { inputRoot, scope, g7, gates, signoff };
}

export async function createDryRunFixture(sourceRoot, options = {}) {
  const root = await mkdtemp(path.join(tmpdir(), "spiral-day-release-dry-run-"));
  const candidate = await createCandidateRepository(root, sourceRoot);
  const releaseScope = options.releaseScope ?? "public";
  const includedRequirementIds = options.includedRequirementIds
    ?? (releaseScope === "private" ? MANDATORY_PRIVATE_REQUIREMENT_IDS : REQUIRED_REQUIREMENT_IDS);
  const requiredEnvironmentIds = releaseScope === "private"
    ? ["ENV-PURE", "ENV-VIS", "ENV-HOST-PRIVATE"]
    : ENVIRONMENT_IDS;
  const evidence = await createEvidenceBundle(root, candidate.repository, candidate.candidateSha, {
    includedRequirementIds,
    requiredEnvironmentIds,
  });
  const release = await createReleaseInputs(root, candidate.repository, candidate.candidateSha, evidence, {
    releaseScope,
    includedRequirementIds,
  });
  return {
    root,
    ...candidate,
    ...evidence,
    ...release,
    validationNowMs: FIXTURE_VALIDATION_NOW_MS,
    async writeGateResultsThrough(gate) {
      const gateIndex = gate === "G9" ? 8 : Number(gate.slice(1));
      await json(path.join(release.inputRoot, "gate-results.json"), {
        schema_version: 1,
        candidate_sha: candidate.candidateSha,
        package_sha256: evidence.packageHash,
        gates: release.gates.slice(0, gateIndex + 1),
      });
    },
    async cleanup() {
      await rm(root, { recursive: true, force: true });
    },
  };
}

export async function rewriteBundleJson(fixture, relativePath, mutate) {
  const filePath = path.join(fixture.bundleRoot, relativePath);
  const value = JSON.parse(await readFile(filePath, "utf8"));
  mutate(value);
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
  await writeFile(filePath, bytes);
  if (relativePath !== "manifest.json") {
    const manifestPath = path.join(fixture.bundleRoot, "manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    const descriptor = manifest.files.find((file) => file.path === relativePath);
    if (descriptor) descriptor.sha256 = sha256(bytes);
    if (manifest.index.path === relativePath) manifest.index.sha256 = sha256(bytes);
    if (manifest.requirements.path === relativePath) manifest.requirements.sha256 = sha256(bytes);
    await json(manifestPath, manifest);
  }
}
