import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { REQUIRED_REQUIREMENT_IDS } from "../../../scripts/verify/candidate-g0.mjs";

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

function requirementManifest() {
  const tests = REQUIRED_REQUIREMENT_IDS.map((id) => `TEST-${id}`);
  return {
    schema_version: 1,
    requirement_set: "spiral-day-v1.0.2",
    upstream_baseline_sha: "973a041aa2f59f3b05bf31db8187efbfea07017a",
    row_count: 126,
    counts: { upstream: 114, obsidian: 9, release: 3 },
    fixture_catalog: Array.from({ length: 16 }, (_, index) => ({
      id: `FX-${String(index + 1).padStart(2, "0")}`,
      path: "tests/fixtures/release/synthetic",
    })),
    test_catalog: tests.map((id) => ({ id, path: "tests/release/release-gates.test.mjs" })),
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
      environments: [ENVIRONMENT_IDS[index % ENVIRONMENT_IDS.length]],
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
  await mkdir(path.join(repository, "docs/parity"), { recursive: true });
  await mkdir(path.join(repository, "scripts/release"), { recursive: true });
  await json(path.join(repository, "docs/parity/requirements.json"), requirementManifest());
  await json(path.join(repository, "docs/parity/deviations.json"), deviationsManifest());
  await json(path.join(repository, "docs/parity/scope.schema.json"), { schema_version: 1, type: "object" });
  await json(path.join(repository, "manifest.json"), {
    id: "spiral-day",
    name: "Spiral Day",
    version: "1.0.2",
    minAppVersion: "1.7.7",
    isDesktopOnly: true,
  });
  await json(path.join(repository, "package.json"), { name: "spiral-day", version: "1.0.2" });
  for (const filename of [
    "release-inputs.json",
    "g7-package.template.json",
    "g8-scope.template.json",
    "g9-signoff.template.json",
  ]) {
    await cp(path.join(sourceRoot, "scripts/release", filename), path.join(repository, "scripts/release", filename));
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

async function createEvidenceBundle(root, repository, candidateSha) {
  const bundleRoot = path.join(root, "evidence-bundle");
  const recordsRoot = path.join(bundleRoot, "records");
  const artifactsRoot = path.join(bundleRoot, "artifacts");
  await mkdir(recordsRoot, { recursive: true });
  await mkdir(artifactsRoot, { recursive: true });
  const artifactPath = "artifacts/pass.txt";
  const artifactBytes = Buffer.from("synthetic dry-run pass\n");
  await writeFile(path.join(bundleRoot, artifactPath), artifactBytes);
  const packageBytes = Buffer.from("synthetic deterministic package\n");
  const packageHash = sha256(packageBytes);
  const packageBundlePath = "artifacts/spiral-day.zip";
  await writeFile(path.join(bundleRoot, packageBundlePath), packageBytes);
  const candidateRequirements = JSON.parse(
    await readFile(path.join(repository, "docs/parity/requirements.json"), "utf8"),
  );
  const requirementsSha256 = sha256(await readFile(path.join(repository, "docs/parity/requirements.json")));
  const resolvedRequirements = structuredClone(candidateRequirements);
  const recordDescriptors = [];
  const requirementIndex = [];
  const testIndex = [];
  const fileDescriptors = [
    { path: artifactPath, sha256: sha256(artifactBytes), role: "artifact" },
    { path: packageBundlePath, sha256: packageHash, role: "package" },
  ];

  for (const [index, row] of candidateRequirements.requirements.entries()) {
    const profileId = row.environments[0];
    const evidenceId = `E-${candidateSha.slice(0, 12)}-${profileId}-UNIT-${String(index + 1).padStart(3, "0")}`;
    const recordPath = `records/${evidenceId}.json`;
    const record = {
      schema_version: 1,
      evidence_id: evidenceId,
      record_type: index === 0 ? "performance" : "pure",
      candidate_sha: candidateSha,
      package_sha256: packageHash,
      environment: {
        profile_id: profileId,
        os_name: "Synthetic Linux",
        os_version: "1",
        architecture: "x64",
        locale: "en",
        timezone: "UTC",
        tool_versions: {
          node: process.version,
          obsidian: "1.13.7",
          electron: "43.3.0",
          chromium: "142.0.7444.235",
        },
        parameters: { "fake-clock": true },
      },
      started_at: "2026-08-28T00:00:00.000Z",
      ended_at: "2026-08-28T00:00:01.000Z",
      result: "PASS",
      execution: PASS_EXECUTION,
      requirement_ids: [row.id],
      test_ids: row.tests,
      artifacts: [{ path: artifactPath, sha256: sha256(artifactBytes) }],
    };
    const bytes = Buffer.from(`${JSON.stringify(record, null, 2)}\n`);
    await writeFile(path.join(bundleRoot, recordPath), bytes);
    fileDescriptors.push({ path: recordPath, sha256: sha256(bytes), role: "record" });
    recordDescriptors.push({
      evidence_id: evidenceId,
      path: recordPath,
      sha256: sha256(bytes),
      record_type: record.record_type,
      requirement_ids: [row.id],
      test_ids: row.tests,
      artifacts: record.artifacts,
    });
    resolvedRequirements.requirements[index].evidence = [evidenceId];
    requirementIndex.push({ requirement_id: row.id, test_ids: row.tests, evidence_ids: [evidenceId] });
    testIndex.push({ test_id: row.tests[0], requirement_ids: [row.id], evidence_ids: [evidenceId] });
  }

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
  await json(path.join(bundleRoot, "manifest.json"), {
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
    files: fileDescriptors,
  });
  return {
    bundleRoot,
    packageBytes,
    packageHash,
    indexValue,
    candidateRequirements,
    requirementsSha256,
  };
}

async function createReleaseInputs(root, candidateSha, evidence) {
  const inputRoot = path.join(root, "release-inputs");
  await mkdir(path.join(inputRoot, "artifacts"), { recursive: true });
  const packagePath = path.join(inputRoot, "artifacts/spiral-day-1.0.2.zip");
  await writeFile(packagePath, evidence.packageBytes);
  const scope = {
    schema_version: 1,
    release_kind: "public",
    candidate_sha: candidateSha,
    included_requirement_ids: REQUIRED_REQUIREMENT_IDS,
    excluded_requirement_ids: [],
    approved_deviation_ids: [],
  };
  await json(path.join(inputRoot, "g8-scope.json"), scope);
  const assetRows = [
    { path: "main.js", sha256: sha256("main") },
    { path: "manifest.json", sha256: sha256("manifest") },
  ];
  const build = { candidate_sha: candidateSha, package_sha256: evidence.packageHash, assets: assetRows };
  const g7 = {
    schema_version: 1,
    gate: "G7",
    result: "PASS",
    candidate_sha: candidateSha,
    version: "1.0.2",
    release_label: "public parity candidate",
    package_filename: "spiral-day-1.0.2.zip",
    package_path: "artifacts/spiral-day-1.0.2.zip",
    package_sha256: evidence.packageHash,
    builds: [build, structuredClone(build)],
    smoke_workflows: ["clean-install", "upgrade", "disable", "uninstall"].map((id) => ({
      id,
      result: "PASS",
      exact_package: true,
      candidate_sha: candidateSha,
      package_sha256: evidence.packageHash,
      execution: PASS_EXECUTION,
    })),
    policy: {
      checked_at: new Date().toISOString(),
      official_policy_url: "https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines",
      name_available: true,
      fork_policy_status: "approved",
      license_present: true,
      notices_present: true,
      provenance_passed: true,
      sbom_present: true,
      banner_passed: true,
    },
    release_assets: [
      { path: "LICENSE", sha256: sha256("license") },
      { path: "THIRD_PARTY_NOTICES.md", sha256: sha256("notices") },
    ],
  };
  await json(path.join(inputRoot, "g7-package.json"), g7);
  const gates = Array.from({ length: 10 }, (_, index) => ({
    id: `G${index}`,
    result: "PASS",
    candidate_sha: candidateSha,
    package_sha256: evidence.packageHash,
    command: ["node", "scripts/release/run-gate.mjs", "--gate", `G${index}`],
    evidence_ids: [evidence.indexValue.records[index].evidence_id],
    result_url: `https://github.com/oldwinter/obsidian-nautilus-log/issues/31#gate-g${index}`,
    started_at: `2026-08-28T00:00:${String(index).padStart(2, "0")}.000Z`,
    ended_at: `2026-08-28T00:00:${String(index + 1).padStart(2, "0")}.000Z`,
    execution: PASS_EXECUTION,
  }));
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
    decision: "GO",
    release_type: "public",
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
    gate_results: gates.map(({ id, result, result_url }) => ({ id, result, result_url })),
    evidence_bundle: {
      index_url: "https://github.com/oldwinter/obsidian-nautilus-log/issues/31#evidence-index",
      sha256: sha256("synthetic evidence bundle"),
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

export async function createDryRunFixture(sourceRoot) {
  const root = await mkdtemp(path.join(tmpdir(), "spiral-day-release-dry-run-"));
  const candidate = await createCandidateRepository(root, sourceRoot);
  const evidence = await createEvidenceBundle(root, candidate.repository, candidate.candidateSha);
  const release = await createReleaseInputs(root, candidate.candidateSha, evidence);
  return {
    root,
    ...candidate,
    ...evidence,
    ...release,
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
