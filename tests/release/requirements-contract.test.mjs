import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (path) => readFileSync(join(root, path), "utf8");
const readJson = (path) => JSON.parse(read(path));
const requirements = readJson("docs/parity/requirements.json");
const owners = readJson("docs/parity/requirement-owners.json");
const boundaries = readJson("docs/parity/ticket-boundaries.json");
const deviations = readJson("docs/parity/deviations.json");
const inventory = read("docs/research/behavior-inventory.md");
const expectedUpstreamIds = [...inventory.matchAll(/^\| ((?:INS|SET|PAR|SCH|DAY|HIS|VIS|CTL|CMP|EXE|CLK|CMD|PER|ERR|ERX|DRF)-\d{2}) \|/gm)]
  .map((match) => `UP-${match[1]}`);
const expectedInitialIds = [
  "OBS-TRACE-001", "OBS-HOST-001", "OBS-VIS-001", "OBS-VIS-002",
  "OBS-A11Y-001", "OBS-SAFE-001", "OBS-LIFE-001", "OBS-I18N-001",
  "OBS-LOCAL-001", "REL-001", "REL-002", "REL-003",
];
const expectedIds = [...expectedUpstreamIds, ...expectedInitialIds];
const mandatoryPrivateIds = ["OBS-SAFE-001", "OBS-LIFE-001", "OBS-LOCAL-001", "REL-001", "REL-002"];

function filesBelow(directory) {
  const results = [];
  function visit(relativeDirectory) {
    for (const entry of readdirSync(join(root, relativeDirectory), { withFileTypes: true })) {
      const relativePath = `${relativeDirectory}/${entry.name}`;
      if (entry.isDirectory()) visit(relativePath);
      else if (entry.isFile()) results.push(relativePath);
    }
  }
  visit(directory);
  return results.sort();
}

function unique(values, label) {
  assert.equal(new Set(values).size, values.length, `${label} contains duplicates`);
}

function isOwnedBoundary(path, boundary) {
  return [...boundary.allowed_module_boundaries, ...boundary.allowed_external_boundaries]
    .some((allowed) => allowed.endsWith("/") ? path.startsWith(allowed) : path === allowed);
}

function validateRequirementManifest(manifest) {
  assert.equal(manifest.$schema, "../../scripts/release/schemas/requirements.schema.json");
  assert.equal(manifest.schema_version, 1);
  assert.equal(manifest.requirement_set, "UPSTREAM-MATRIX-v1+INITIAL-OBS-REL-v1");
  assert.equal(manifest.upstream_baseline_sha, "973a041aa2f59f3b05bf31db8187efbfea07017a");
  assert.equal(manifest.row_count, 126);
  assert.deepEqual(manifest.counts, { upstream: 114, obsidian: 9, release: 3 });
  assert.equal(manifest.evidence_binding, "candidate-evidence-index");

  const ids = manifest.requirements.map((row) => row.id);
  unique(ids, "requirement IDs");
  assert.deepEqual(ids, expectedIds);

  const fixtureIds = manifest.fixture_catalog.map((entry) => entry.id);
  const testIds = manifest.test_catalog.map((entry) => entry.id);
  const environmentIds = manifest.environment_catalog.map((entry) => entry.id);
  unique(fixtureIds, "fixture catalog");
  unique(testIds, "test catalog");
  unique(environmentIds, "environment catalog");
  assert.deepEqual(environmentIds, [
    "ENV-PURE", "ENV-VIS", "ENV-HOST-PRIVATE", "ENV-HOST-MIN", "ENV-HOST-MAC",
    "ENV-HOST-WIN", "ENV-HOST-LINUX", "ENV-THEME", "ENV-A11Y",
  ]);
  assert.equal(manifest.fixture_catalog.length, 25);
  assert.ok(manifest.test_catalog.length > 126);

  const fixtureSet = new Set(fixtureIds);
  const testById = new Map(manifest.test_catalog.map((entry) => [entry.id, entry]));
  const environmentSet = new Set(environmentIds);
  const deviationById = new Map(deviations.deviations.map((entry) => [entry.id, entry]));
  const approvalById = new Map(deviations.not_applicable_approvals.map((entry) => [entry.id, entry]));
  const boundaryByTicket = new Map(boundaries.tickets.map((entry) => [entry.ticket, entry]));
  const ownerById = new Map(owners.requirements.map((entry) => [entry.id, entry]));

  for (const row of manifest.requirements) {
    for (const field of [
      "id", "owner_ticket", "owner_module", "evidence_contributors", "statement", "source_refs",
      "disposition", "fixtures", "tests", "environments", "evidence", "status",
    ]) assert.ok(Object.hasOwn(row, field), `${row.id} is missing ${field}`);

    assert.equal(row.status, "active", `${row.id} must be active`);
    assert.match(row.statement, /\S/, `${row.id} needs an observable statement`);
    assert.ok(row.source_refs.length > 0, `${row.id} needs a source reference`);
    unique(row.source_refs, `${row.id} source refs`);
    for (const ref of row.source_refs) assert.match(ref, /^https:\/\/github\.com\/[^/]+\/[^/]+\/blob\/[0-9a-f]{40}\//, `${row.id} source ref is mutable`);

    assert.ok(["exact", "host-adapted", "approved-improvement", "not-applicable"].includes(row.disposition), `${row.id} has invalid disposition`);
    if (["host-adapted", "approved-improvement"].includes(row.disposition)) {
      assert.match(row.deviation_id ?? "", /^DEV-[0-9]{3}$/, `${row.id} needs a deviation`);
      assert.equal(deviationById.get(row.deviation_id)?.status, "approved", `${row.id} deviation is not approved`);
    } else {
      assert.equal(Object.hasOwn(row, "deviation_id"), false, `${row.id} must not carry a deviation`);
    }
    if (row.disposition === "not-applicable") {
      assert.match(row.not_applicable_approval_id ?? "", /^NA-[0-9]{3}$/, `${row.id} needs a not-applicable approval`);
      const approval = approvalById.get(row.not_applicable_approval_id);
      assert.equal(approval?.status, "approved", `${row.id} not-applicable disposition is not approved`);
      assert.ok(approval.requirement_ids.includes(row.id), `${row.id} approval lacks reverse link`);
      assert.match(approval.reason, /\S/);
      assert.match(approval.reviewer, /\S/);
      assert.ok(approval.source_refs.every((ref) => /\/blob\/[0-9a-f]{40}\//.test(ref)));
    } else {
      assert.equal(Object.hasOwn(row, "not_applicable_approval_id"), false, `${row.id} has an unused not-applicable approval`);
    }

    assert.ok(row.fixtures.length > 0, `${row.id} needs a fixture`);
    assert.ok(row.tests.length > 0, `${row.id} needs a stable test ID`);
    assert.ok(row.environments.length > 0, `${row.id} needs an environment`);
    unique(row.fixtures, `${row.id} fixtures`);
    unique(row.tests, `${row.id} tests`);
    unique(row.environments, `${row.id} environments`);
    assert.ok(row.fixtures.every((id) => fixtureSet.has(id)), `${row.id} has a dangling fixture`);
    assert.ok(row.environments.every((id) => environmentSet.has(id)), `${row.id} has a dangling environment`);
    for (const testId of row.tests) {
      assert.equal(testById.get(testId)?.requirement_id, row.id, `${row.id} has a dangling or mislinked test`);
    }
    assert.deepEqual(row.evidence, [], `${row.id} repository template must not contain candidate evidence`);

    const projection = ownerById.get(row.id);
    assert.ok(projection, `${row.id} is missing from owner projection`);
    assert.equal(row.owner_ticket, projection.owner_ticket, `${row.id} ticket differs from owner projection`);
    assert.equal(row.owner_module, projection.owner_module, `${row.id} module differs from owner projection`);
    assert.deepEqual(row.evidence_contributors, projection.evidence_contributors, `${row.id} contributors differ from owner projection`);
    assert.ok(!row.evidence_contributors.includes(row.owner_ticket), `${row.id} owner repeats as contributor`);
    const boundary = boundaryByTicket.get(row.owner_ticket);
    assert.ok(boundary && isOwnedBoundary(row.owner_module, boundary), `${row.id} module lies outside ticket #${row.owner_ticket}`);
    assert.ok(boundary.primary_requirement_ids.includes(row.id), `${row.id} lacks reverse ticket-boundary link`);
  }

  for (const entry of manifest.test_catalog) {
    assert.match(entry.id, /^TC-(UP-[A-Z]{3}-\d{2}|OBS-[A-Z0-9]+-\d{3}|REL-\d{3})-\d{3}$/);
    assert.ok(ids.includes(entry.requirement_id), `${entry.id} points to unknown requirement`);
    assert.match(entry.evidence_kind, /^[A-Z0-9]+$/);
    assert.ok(entry.gates.length > 0);
    assert.ok(entry.gates.every((gate) => /^G[0-9]$/.test(gate)));
  }
}

function validateScope(scope) {
  try {
    assert.equal(scope.schema_version, 1);
    assert.match(scope.candidate_sha, /^[0-9a-f]{40}$/);
    assert.match(scope.requirements_sha256, /^[0-9a-f]{64}$/);
    assert.match(scope.deviations_sha256, /^[0-9a-f]{64}$/);
    assert.ok(["private", "public"].includes(scope.release_scope));
    unique(scope.included_requirement_ids, "included requirements");
    unique(scope.excluded_requirement_ids, "excluded requirements");
    unique(scope.approved_deviation_ids, "approved deviations");
    const included = new Set(scope.included_requirement_ids);
    const excluded = new Set(scope.excluded_requirement_ids);
    assert.ok([...included, ...excluded].every((id) => expectedIds.includes(id)));
    for (const id of expectedIds) assert.notEqual(included.has(id), excluded.has(id), `${id} must be in exactly one scope partition`);
    for (const id of scope.approved_deviation_ids) assert.equal(deviations.deviations.find((entry) => entry.id === id)?.status, "approved");
    if (scope.release_scope === "public") {
      assert.equal(scope.parity_claim, "v1.0.2-parity");
      assert.equal(included.size, 126);
      assert.equal(excluded.size, 0);
    } else {
      assert.equal(scope.parity_claim, "private-preview");
      for (const id of mandatoryPrivateIds) {
        assert.ok(included.has(id), `private scope must include ${id}`);
        assert.ok(!excluded.has(id), `private scope cannot exclude ${id}`);
      }
    }
    return true;
  } catch {
    return false;
  }
}

test("generated requirement contracts are current", () => {
  const result = spawnSync(process.execPath, ["scripts/generate-requirement-owners.mjs", "--check"], { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test("manifest has the exact 114 + 9 + 3 partition and complete trace links", () => {
  validateRequirementManifest(requirements);
});

test("owner projection and ticket boundaries are bidirectionally set-equal", () => {
  const ownerIds = owners.requirements.map((row) => row.id);
  const boundaryIds = boundaries.tickets.flatMap((ticket) => ticket.primary_requirement_ids);
  unique(ownerIds, "owner projection IDs");
  unique(boundaryIds, "ticket-boundary IDs");
  assert.deepEqual(ownerIds, expectedIds);
  assert.deepEqual(new Set(boundaryIds), new Set(expectedIds));
  assert.deepEqual(boundaries.tickets.map((entry) => entry.ticket), Array.from({ length: 15 }, (_, index) => 17 + index));
});

test("no unapproved deviation is invented and the sole not-applicable row is reviewed", () => {
  assert.deepEqual(deviations.deviations, []);
  assert.equal(deviations.not_applicable_approvals.length, 1);
  assert.deepEqual(
    requirements.requirements.filter((row) => row.disposition === "not-applicable").map((row) => row.id),
    ["UP-INS-01"],
  );
  assert.equal(deviations.not_applicable_approvals[0].id, "NA-001");
  assert.deepEqual(deviations.not_applicable_approvals[0].requirement_ids, ["UP-INS-01"]);
});

test("public and private scope fixtures fail closed", () => {
  assert.equal(validateScope(readJson("tests/fixtures/contracts/scope-public-valid.json")), true);
  assert.equal(validateScope(readJson("tests/fixtures/contracts/scope-private-valid.json")), true);
  assert.equal(validateScope(readJson("tests/fixtures/contracts/scope-public-exclusion-invalid.json")), false);
  assert.equal(validateScope(readJson("tests/fixtures/contracts/scope-private-missing-mandatory-invalid.json")), false);
  assert.equal(validateScope(readJson("tests/fixtures/contracts/scope-private-excludes-mandatory-invalid.json")), false);
});

test("scope schema enumerates the exact universe and encodes every partition", () => {
  const schema = readJson("docs/parity/scope.schema.json");
  assert.deepEqual(schema.$defs.requirementId.enum, expectedIds);
  assert.equal(schema.allOf.filter((entry) => entry.oneOf).length, 126);
  assert.equal(schema.allOf.filter((entry) => entry.if).length, 2);
});

test("requirements schema covers catalogs, rows, conditionals, and accepted enums", () => {
  const schema = readJson("scripts/release/schemas/requirements.schema.json");
  assert.equal(schema.$schema, "https://json-schema.org/draft/2020-12/schema");
  assert.equal(schema.additionalProperties, false);
  assert.ok(schema.required.includes("requirements"));
  assert.deepEqual(schema.$defs.testEntry.properties.evidence_kind.enum, [
    "UNIT", "CONTRACT", "VAULT", "INTEGRATION", "SCREENSHOT",
    "KEYBOARD", "A11Y", "LIFECYCLE", "PACKAGE", "MANUAL",
  ]);
  assert.ok(!schema.$defs.testEntry.properties.evidence_kind.enum.includes("NETWORK"));
  assert.equal(schema.$defs.requirement.additionalProperties, false);
  assert.equal(schema.$defs.requirement.allOf.length, 2);
  assert.equal(schema.$defs.requirement.properties.status.enum.includes("active"), true);
});

test("accepted evidence kind and release-gate matrix are exact", () => {
  const testsByRequirement = new Map(expectedIds.map((id) => [id, requirements.test_catalog.filter((entry) => entry.requirement_id === id)]));
  for (let index = 1; index <= 9; index += 1) {
    const rows = testsByRequirement.get(`UP-DRF-${String(index).padStart(2, "0")}`);
    assert.deepEqual(rows.map((entry) => entry.evidence_kind), ["CONTRACT"]);
    assert.deepEqual(rows[0].gates, ["G0", "G2", "G8"]);
  }
  const expected = new Map([
    ["OBS-LOCAL-001", [["INTEGRATION"], ["G4", "G7", "G8"]]],
    ["OBS-LIFE-001", [["UNIT", "INTEGRATION", "LIFECYCLE", "PACKAGE", "MANUAL"], ["G1", "G4", "G7", "G8"]]],
    ["OBS-SAFE-001", [["UNIT", "CONTRACT", "VAULT", "INTEGRATION", "LIFECYCLE"], ["G2", "G3", "G4", "G8"]]],
    ["OBS-I18N-001", [["CONTRACT", "SCREENSHOT", "MANUAL"], ["G1", "G5", "G6"]]],
    ["OBS-HOST-001", [["INTEGRATION", "KEYBOARD", "MANUAL"], ["G4", "G5"]]],
    ["OBS-VIS-001", [["CONTRACT", "INTEGRATION", "SCREENSHOT", "MANUAL"], ["G4", "G5", "G6"]]],
    ["OBS-VIS-002", [["CONTRACT", "INTEGRATION", "SCREENSHOT", "MANUAL"], ["G4", "G5", "G6"]]],
  ]);
  for (const [id, [kinds, gates]] of expected) {
    assert.deepEqual(testsByRequirement.get(id).map((entry) => entry.evidence_kind), kinds);
    for (const entry of testsByRequirement.get(id)) assert.deepEqual(entry.gates, gates);
  }
  for (const id of ["REL-001", "REL-002", "REL-003"]) {
    assert.deepEqual(testsByRequirement.get(id).map((entry) => entry.evidence_kind), ["PACKAGE"]);
  }
});

test("release inventory exhaustively freezes every #31 repository input", () => {
  const releaseInputs = readJson("scripts/release/release-inputs.json");
  const explicit = new Set(["docs/planning-github-graph.json", "docs/planning-local-links.json", "scripts/check-planning-docs.mjs", "scripts/generate-planning-local-links.mjs", "scripts/generate-requirement-owners.mjs"]);
  const owned = [".github/workflows", "docs/parity", "scripts/release", "scripts/verify", "tests/fixtures", "tests/release"]
    .flatMap((directory) => filesBelow(directory));
  assert.deepEqual(
    releaseInputs.candidate_owned,
    [...owned, ...explicit].sort(),
  );
  assert.deepEqual(releaseInputs.transitive_inputs, [
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
  ]);
  assert.deepEqual(
    releaseInputs.gates.map((gate) => gate.id),
    Array.from({ length: 10 }, (_, index) => `G${index}`),
  );
  for (const gate of releaseInputs.gates) {
    assert.deepEqual(gate.command, ["node", "scripts/release/run-gate.mjs", "--gate", gate.id]);
  }
});

test("corrupt requirements are rejected deterministically", () => {
  const corruptions = [
    (manifest) => manifest.requirements.push(structuredClone(manifest.requirements[0])),
    (manifest) => { manifest.requirements[0].owner_module = "src/not-owned.ts"; },
    (manifest) => { manifest.requirements[0].source_refs = ["https://github.com/example/repo/blob/main/file.ts"]; },
    (manifest) => { delete manifest.requirements[0].evidence; },
    (manifest) => { manifest.requirements[1].fixtures = ["FX-DOES-NOT-EXIST"]; },
    (manifest) => { manifest.requirements[1].tests = ["TC-DANGLING-001"]; },
    (manifest) => { manifest.requirements[1].disposition = "deferred"; },
    (manifest) => { manifest.requirements[1].disposition = "host-adapted"; manifest.requirements[1].deviation_id = "DEV-999"; },
  ];
  for (const corrupt of corruptions) {
    const candidate = structuredClone(requirements);
    corrupt(candidate);
    assert.throws(() => validateRequirementManifest(candidate));
  }
});
