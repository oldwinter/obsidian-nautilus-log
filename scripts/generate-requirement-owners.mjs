#!/usr/bin/env node

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(join(root, path), "utf8");
const readJson = (path) => JSON.parse(read(path));
const inventory = read("docs/research/behavior-inventory.md");
const boundaries = readJson("docs/parity/ticket-boundaries.json");
const upstreamIdPattern = /^(INS|SET|PAR|SCH|DAY|HIS|VIS|CTL|CMP|EXE|CLK|CMD|PER|ERR|ERX|DRF)-\d{2}$/;
const upstreamIds = [...inventory.matchAll(/^\| ((?:INS|SET|PAR|SCH|DAY|HIS|VIS|CTL|CMP|EXE|CLK|CMD|PER|ERR|ERX|DRF)-\d{2}) \|/gm)]
  .map((match) => `UP-${match[1]}`);
const initialRequirementStatements = new Map([
  ["OBS-TRACE-001", "All 114 upstream IDs have exactly one current disposition and no dangling source, fixture, test, environment, evidence, or deviation reference."],
  ["OBS-HOST-001", "Obsidian-owned chrome may differ visually, but command availability, conditional actions, notice meaning, navigation result, and plugin state match the linked upstream workflow."],
  ["OBS-VIS-001", "The planner switches to compact at content widths 520 px and below and to wide above 520 px; 519, 520, and 521 px are explicit gates."],
  ["OBS-VIS-002", "Plugin-owned surfaces preserve semantic hierarchy and distinguish every required state in default light and dark themes without overlap, clipping, or inaccessible reliance on color alone."],
  ["OBS-A11Y-001", "Pointer actions have keyboard equivalents, focus is visible and deterministic, the Execution dialog/tab pattern is complete, status changes are announced, and reduced motion removes nonessential delay and animation."],
  ["OBS-SAFE-001", "Visual planning performs no write. Every vault write follows an explicit user action, revalidates the exact target, preserves unowned Markdown, and fails closed on conflict."],
  ["OBS-LIFE-001", "Repeated enable, disable, open, close, reload, and unload leave no duplicate command, view, listener, timer, or post-unload mutation."],
  ["OBS-I18N-001", "English and Simplified Chinese have identical stable message-key sets and expose the same actions, states, and geometry."],
  ["OBS-LOCAL-001", "The plugin initiates no network request and emits no telemetry in any acceptance fixture."],
  ["REL-001", "A Release Candidate is one clean, pushed 40-character Git commit plus deterministic package assets whose SHA-256 values are recorded."],
  ["REL-002", "A private package declares its included requirement IDs and may not claim full v1.0.2 parity."],
  ["REL-003", "The first public package includes every active requirement, every approved deviation, Community Plugins policy evidence, and final human sign-off on the exact candidate commit."],
]);
const initialIds = [...initialRequirementStatements.keys()];
const expectedIds = [...upstreamIds, ...initialIds];
const decisionRef = "https://github.com/oldwinter/obsidian-nautilus-log/blob/278b3e68c0db50c65b33d572a1a14ec4d8d1e05b/docs/decisions/parity-acceptance-matrix-and-release-gates.md";
const fixtureRef = "https://github.com/oldwinter/obsidian-nautilus-log/blob/f3dcf1a000624a705b8c868a4f681339fcd6bedd/docs/research/behavior-inventory.md#minimal-fixture-corpus-for-obsidian-parity-tests";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function range(prefix, first, last) {
  return Array.from({ length: last - first + 1 }, (_, index) => `${prefix}-${String(first + index).padStart(2, "0")}`);
}

function parseInventoryRows(markdown) {
  const rows = new Map();
  let headers = [];
  for (const line of markdown.split("\n")) {
    if (!line.startsWith("| ")) continue;
    const cells = line.slice(2, -2).split(" | ");
    if (cells[0] === "ID") {
      headers = cells;
      continue;
    }
    if (!upstreamIdPattern.test(cells[0] ?? "")) continue;
    assert(headers.length === cells.length, `${cells[0]} does not match its inventory table header`);
    const row = Object.fromEntries(headers.map((header, index) => [header, cells[index]]));
    assert(!rows.has(cells[0]), `duplicate inventory row ${cells[0]}`);
    rows.set(cells[0], row);
  }
  return rows;
}

function statementFor(row) {
  const prerequisite = row.Prerequisite;
  const trigger = row["Input or trigger"] ?? row.Trigger ?? row["Failure class"];
  const output = row["Observable output"] ?? row["User-visible result"] ?? row["Exact v1.0.2 copy"] ?? row["v1.0.2 baseline decision"];
  const edge = row["Edge cases / parity requirement"] ?? row["Edge / unknown"] ?? row["Surface / effect"] ?? row["Parity handling"];
  const parts = [];
  if (prerequisite) parts.push(`Given ${prerequisite}`);
  if (trigger) parts.push(`when ${trigger}`);
  if (output) parts.push(`the observable result is ${output}`);
  if (edge) parts.push(`Acceptance also requires ${edge}`);
  assert(parts.length >= 2, `cannot derive observable statement for ${row.ID}`);
  return `${parts.join("; ")}.`;
}

function sourceRefsFor(row) {
  const evidence = row["Primary evidence"] ?? row.Evidence;
  const refs = [...(evidence ?? "").matchAll(/\[[^\]]+\]\((https:\/\/[^)]+)\)/g)].map((match) => match[1]);
  assert(refs.length > 0, `${row.ID} has no immutable source reference`);
  for (const ref of refs) assert(/\/blob\/[0-9a-f]{40}\//.test(ref), `${row.ID} has a non-immutable source reference: ${ref}`);
  return refs;
}

const inventoryRows = parseInventoryRows(inventory);
assert(inventoryRows.size === 114, `behavior inventory must contain 114 requirement rows; found ${inventoryRows.size}`);
assert(upstreamIds.length === 114, `behavior inventory must expose 114 IDs; found ${upstreamIds.length}`);
assert(new Set(expectedIds).size === 126, "expected requirement universe is not 126 unique IDs");

assert(boundaries.schema_version === 1, "ticket-boundary schema_version must be 1");
assert(boundaries.tickets.length === 15, "ticket-boundary manifest must contain #17-#31");
const ticketForRequirement = new Map();
const allowedBoundaryByTicket = new Map();
for (const entry of boundaries.tickets) {
  assert(entry.ticket >= 17 && entry.ticket <= 31, `invalid ticket #${entry.ticket}`);
  assert(!allowedBoundaryByTicket.has(entry.ticket), `duplicate ticket #${entry.ticket}`);
  allowedBoundaryByTicket.set(entry.ticket, new Set([...entry.allowed_module_boundaries, ...entry.allowed_external_boundaries]));
  for (const id of entry.primary_requirement_ids) {
    assert(!ticketForRequirement.has(id), `${id} has multiple primary tickets`);
    ticketForRequirement.set(id, entry.ticket);
  }
}
assert(ticketForRequirement.size === 126, `ticket-boundary manifest must own 126 requirements; found ${ticketForRequirement.size}`);
assert(expectedIds.every((id) => ticketForRequirement.has(id)), "ticket-boundary manifest is missing an expected requirement");
assert([...ticketForRequirement].every(([id]) => expectedIds.includes(id)), "ticket-boundary manifest contains an unknown requirement");

const ownershipById = new Map();
function own(ids, ownerModule, evidenceContributors = []) {
  for (const id of ids) {
    const requirementId = /^(UP-|OBS-|REL-)/.test(id) ? id : `UP-${id}`;
    assert(!ownershipById.has(requirementId), `duplicate owner-module assignment for ${requirementId}`);
    ownershipById.set(requirementId, { ownerModule, evidenceContributors });
  }
}

own(["INS-01"], "README.md", [22, 30]);
own(["INS-02"], "src/main.ts", [22, 30]);
own(["INS-03"], "src/ui/planner/view.ts", [17, 21, 30]);
own(["INS-04", "INS-05"], "src/runtime/lifecycle.ts", [17, 23, 30]);
own(range("SET", 1, 13), "src/adapters/settings.ts", [21, 24, 26, 30]);
own(range("PAR", 1, 12), "src/core/grammar-v1.ts", [20, 22]);
own(range("SCH", 1, 7), "src/core/scheduler.ts", [22, 23]);
own(range("DAY", 1, 4), "src/core/day.ts", [21, 23]);
own(range("HIS", 1, 5), "src/workspace/history-index.ts", [19, 20, 29]);
own(range("VIS", 1, 7), "src/ui/planner/spiral.ts", [22, 24, 30]);
own(range("CTL", 1, 5), "src/ui/planner/controls.ts", [23, 25, 30]);
own(range("CMP", 1, 3), "src/ui/planner/responsive-layout.ts", [24, 30]);
own(["EXE-01"], "src/runtime/projection-runtime.ts", [19, 20, 27]);
own(["EXE-02", "EXE-09"], "src/core/review.ts", [19, 26, 27, 29]);
own(range("EXE", 3, 7), "src/ui/execution/panel.ts", [23, 24, 26, 30]);
own(["EXE-08"], "src/ui/execution/review-view.ts", [28, 30]);
own(["EXE-10", "EXE-11"], "src/runtime/execution/pomo.ts", [27, 30]);
own(["EXE-12"], "src/adapters/source-navigation.ts", [20, 30]);
own(["EXE-13"], "src/ui/execution/panel.ts", [26, 30]);
own(range("CLK", 1, 9), "src/runtime/execution/execution-state.ts", [20, 25, 27, 30]);
own(["CLK-10"], "src/ui/execution/active-task-view.ts", [20, 21, 26, 30]);
own(range("CMD", 1, 2), "src/adapters/commands.ts", [24, 26, 30]);
own(["PER-01"], "src/workspace/logbook-reader.ts", [25, 26, 28]);
own(["PER-02"], "src/runtime/execution/time-continuity.ts", [21, 27, 30]);
own(["ERR-01", "ERR-02"], "src/ui/planner/diagnostics.ts", [18, 19, 24, 30]);
own(range("ERR", 3, 8), "src/adapters/notices.ts", [21, 25, 26, 30]);
own(["ERR-09"], "src/ui/planner/focus.ts", [23, 27, 29, 30]);
own(range("ERX", 1, 8), "src/i18n/locales/en/execution.ts", [25, 26, 30]);
own(["DRF-01"], "README.md", [22, 31]);
own(["DRF-02", "DRF-05"], "src/core/grammar-v1.ts", [19, 22]);
own(["DRF-03", "DRF-04"], "src/workspace/primary-plan-resolver.ts", [18, 22, 26]);
own(["DRF-06"], "src/ui/planner/controls.ts", [22, 23]);
own(["DRF-07"], "src/adapters/execution-entry.ts", [22, 24]);
own(["DRF-08"], "src/i18n/locales/en/execution.ts", [22, 24]);
own(["DRF-09"], "docs/parity/source-ledger.json", [23, 30]);
own(["OBS-TRACE-001"], "docs/parity/requirements.json", [17, 18, 19, 20, 21, 23, 24, 25, 26, 27, 28, 29, 30, 31]);
own(["OBS-HOST-001"], "src/ui/execution/active-task-view.ts", [21, 23, 24, 29, 30]);
own(["OBS-VIS-001"], "src/ui/planner/responsive-layout.ts", [24, 30]);
own(["OBS-VIS-002"], "styles/theme.css", [23, 27, 29, 30]);
own(["OBS-A11Y-001"], "styles/a11y.css", [27, 29, 30]);
own(["OBS-SAFE-001"], "src/workspace/commit.ts", [20, 26, 30]);
own(["OBS-LIFE-001"], "src/runtime/lifecycle.ts", [17, 23, 27, 29, 30]);
own(["OBS-I18N-001"], "src/i18n/resolver.ts", [27, 29, 30]);
own(["OBS-LOCAL-001"], "src/main.ts", [22, 30, 31]);
own(["REL-001"], "scripts/release/", [17, 30, 31]);
own(["REL-002"], "docs/parity/scope.schema.json", [30, 31]);
own(["REL-003"], "external:g7-g9-sign-off", [22, 30]);

assert(ownershipById.size === 126, `owner-module assignments must contain 126 requirements; found ${ownershipById.size}`);
const ownershipRequirements = expectedIds.map((id) => {
  const ownerTicket = ticketForRequirement.get(id);
  const assignment = ownershipById.get(id);
  assert(assignment, `no owner-module assignment for ${id}`);
  assert(allowedBoundaryByTicket.get(ownerTicket).has(assignment.ownerModule), `${id} module ${assignment.ownerModule} is outside #${ownerTicket}`);
  assert(!assignment.evidenceContributors.includes(ownerTicket), `${id} repeats #${ownerTicket} as evidence contributor`);
  return { id, owner_ticket: ownerTicket, owner_module: assignment.ownerModule, evidence_contributors: assignment.evidenceContributors };
});

const fixtureByRequirement = new Map(expectedIds.map((id) => [id, new Set()]));
function cover(fixture, ids) {
  for (const id of ids) {
    const requirementId = /^(UP-|OBS-|REL-)/.test(id) ? id : `UP-${id}`;
    assert(fixtureByRequirement.has(requirementId), `${fixture} references unknown requirement ${requirementId}`);
    fixtureByRequirement.get(requirementId).add(fixture);
  }
}

cover("FX-01", ["INS-01", ...range("INS", 2, 5), "SET-01", "SET-13", "DRF-01"]);
cover("FX-02", [...range("SET", 1, 12), "DRF-05"]);
cover("FX-03", range("PAR", 1, 10));
cover("FX-04", [...range("PAR", 11, 12), "DRF-04"]);
cover("FX-05", range("SCH", 1, 7));
cover("FX-06", range("DAY", 1, 4));
cover("FX-07", ["CTL-01", "CTL-04", "HIS-04"]);
cover("FX-08", range("HIS", 1, 5));
cover("FX-09", [...range("VIS", 1, 7), "CTL-02", "CTL-03", "CTL-05", ...range("CMP", 1, 3), "DRF-06", "DRF-09"]);
cover("FX-10", ["EXE-01", "EXE-02", "DRF-02", "DRF-03"]);
cover("FX-11", [...range("CLK", 1, 4), "PER-01"]);
cover("FX-12", range("CLK", 7, 9));
cover("FX-13", ["EXE-03", "EXE-10", "EXE-11", "PER-02"]);
cover("FX-14", [...range("EXE", 4, 9), "EXE-12", "EXE-13", "CLK-05", "CLK-06"]);
cover("FX-15", [...range("CMD", 1, 2), "CLK-10", ...range("ERR", 4, 7), "DRF-07"]);
cover("FX-16", [...range("ERR", 1, 9), ...range("ERX", 1, 8), "DRF-08"]);
const portFixtureById = {
  "OBS-TRACE-001": "OFX-001", "OBS-HOST-001": "OFX-002", "OBS-VIS-001": "OFX-003", "OBS-VIS-002": "OFX-003",
  "OBS-A11Y-001": "OFX-004", "OBS-SAFE-001": "OFX-005", "OBS-LIFE-001": "OFX-006", "OBS-I18N-001": "OFX-007",
  "OBS-LOCAL-001": "OFX-008", "REL-001": "OFX-009", "REL-002": "OFX-009", "REL-003": "OFX-009",
};
for (const [id, fixture] of Object.entries(portFixtureById)) cover(fixture, [id]);
for (const [id, fixtures] of fixtureByRequirement) assert(fixtures.size > 0, `${id} has no fixture`);

const fixtureDescriptions = new Map([
  ["FX-01", "Fresh lifecycle: empty vault, first load, reload, and unload with an active timing record."],
  ["FX-02", "Settings and migrations: saved preview defaults followed by manual Chinese and custom values."],
  ["FX-03", "Parser grammar spanning valid, invalid, zero, progress, completion, formatting, marker, empty, and nested forms."],
  ["FX-04", "Reference ownership with direct and nested block references plus source mutation."],
  ["FX-05", "Greedy capacity with overlaps, touching events, fragmented gaps, overload, and fit-fragmentation."],
  ["FX-06", "Day relation and playback across dates and controlled workday clock phases."],
  ["FX-07", "Spiral progress, completion, reopen, cleanup, and fixed-event retention."],
  ["FX-08", "Historical Planned and Actual anchors, sessions, open clocks, cross-midnight records, and over-plan actuals."],
  ["FX-09", "Responsive surfaces at canonical widths plus sidebar, themes, reduced motion, and debug state."],
  ["FX-10", "Primary selection with multiple renderers, prefixes, and direct versus nested tasks."],
  ["FX-11", "CLOCK lifecycle across Clock In, reselection, switch, Clock Out, restart, overlap, and completed owner."],
  ["FX-12", "Timing retention and alarms around Recent, POMO, and forgotten thresholds."],
  ["FX-13", "Standalone POMO across reload, threshold, stop, and same-tick CLOCK precedence."],
  ["FX-14", "Execution views and actions across running, paused, completed, tracked, untracked, scheduled, and overflow states."],
  ["FX-15", "Commands and navigation across setting, focus, context menu, sidebar, and failure states."],
  ["FX-16", "Failures and localization across writer conflict, injected API failures, locales, and unavailable command API."],
  ["OFX-001", "Traceability manifest and exact-candidate Evidence Index linkage."],
  ["OFX-002", "Obsidian host command, menu, notice, navigation, and singleton view workflows."],
  ["OFX-003", "Canonical visual geometry, breakpoint, theme, state, and text-fit matrix."],
  ["OFX-004", "Keyboard, focus, screen-reader, reduced-motion, and 200 percent zoom matrix."],
  ["OFX-005", "Vault write allowlist, stale target, conflict, malformed input, and failure-injection matrix."],
  ["OFX-006", "Repeated enable, disable, open, close, reload, and unload lifecycle matrix."],
  ["OFX-007", "English and Simplified Chinese key equality and canonical surface matrix."],
  ["OFX-008", "Network interception and telemetry persistence matrix for every acceptance fixture."],
  ["OFX-009", "Deterministic package, scope declaration, policy, install, upgrade, uninstall, and sign-off matrix."],
]);
const fixtureCatalog = [...fixtureDescriptions].map(([id, statement]) => ({ id, statement, source_refs: [id.startsWith("FX-") ? fixtureRef : decisionRef] }));

const environmentDescriptions = new Map([
  ["ENV-PURE", "Pinned repository toolchain and lockfile on CI Linux, fake clock, en and zh-CN locales, UTC, Asia/Shanghai, and America/New_York time zones, including DST transitions."],
  ["ENV-VIS", "Pinned Playwright Chromium on Ubuntu 24.04 LTS, DPR 1, 100 percent zoom, 1440x1000 viewport, controlled fonts and clock, canonical widths, themes, and reduced motion."],
  ["ENV-HOST-PRIVATE", "Exact Obsidian, Electron, Chromium, OS, locale, and theme versions for the intended private-vault installation."],
  ["ENV-HOST-MIN", "Resolved minimum-supported Obsidian on one supported desktop OS with exact app, Electron, Chromium, and OS versions."],
  ["ENV-HOST-MAC", "Resolved current-stable Obsidian on the supported macOS major version across themes, locales, and zoom levels."],
  ["ENV-HOST-WIN", "Resolved current-stable Obsidian on Windows 11 across themes, locales, and zoom levels."],
  ["ENV-HOST-LINUX", "Resolved current-stable Obsidian on Ubuntu 24.04 LTS across themes, locales, and zoom levels."],
  ["ENV-THEME", "Canonical current-stable host plus versioned high-contrast and heavily customized community themes."],
  ["ENV-A11Y", "Current macOS with VoiceOver plus automated accessibility checks in ENV-VIS, reduced motion, and 200 percent zoom."],
]);
const environmentCatalog = [...environmentDescriptions].map(([id, statement]) => ({ id, statement, source_refs: [decisionRef] }));
const hostEnvironments = ["ENV-PURE", "ENV-HOST-PRIVATE", "ENV-HOST-MIN", "ENV-HOST-MAC", "ENV-HOST-WIN", "ENV-HOST-LINUX"];
const visualEnvironments = ["ENV-VIS", "ENV-HOST-PRIVATE", "ENV-HOST-MAC", "ENV-HOST-WIN", "ENV-HOST-LINUX"];
function environmentsFor(id) {
  if (id === "OBS-TRACE-001") return ["ENV-PURE"];
  if (["OBS-HOST-001", "OBS-LIFE-001", "OBS-LOCAL-001", "OBS-SAFE-001", "REL-001"].includes(id)) return hostEnvironments;
  if (id === "OBS-VIS-001" || id === "OBS-I18N-001") return ["ENV-PURE", ...visualEnvironments];
  if (id === "OBS-VIS-002") return ["ENV-PURE", ...visualEnvironments, "ENV-THEME"];
  if (id === "OBS-A11Y-001") return ["ENV-VIS", "ENV-A11Y"];
  if (id === "REL-002") return ["ENV-PURE", "ENV-HOST-PRIVATE"];
  if (id === "REL-003") return hostEnvironments;
  const family = id.split("-")[1];
  if (["PAR", "SCH", "DAY", "HIS", "DRF"].includes(family)) {
    return ["ENV-PURE"];
  }
  if (["VIS", "CMP"].includes(family)) return ["ENV-PURE", ...visualEnvironments];
  if (family === "CTL") return ["ENV-PURE", ...visualEnvironments, "ENV-A11Y"];
  if (family === "EXE") return ["ENV-PURE", "ENV-VIS", ...hostEnvironments.slice(1)];
  if (["ERR", "ERX"].includes(family)) return [...hostEnvironments, "ENV-A11Y"];
  if (id === "UP-ERR-09") return ["ENV-VIS", "ENV-A11Y"];
  return hostEnvironments;
}

function matrixFor(id) {
  if (id.startsWith("REL-")) {
    return { kinds: ["PACKAGE"], gates: ["G0", "G7", id === "REL-003" ? "G9" : "G8"] };
  }
  if (id.startsWith("UP-DRF-")) return { kinds: ["CONTRACT"], gates: ["G0", "G2", "G8"] };
  if (id === "OBS-TRACE-001") return { kinds: ["CONTRACT"], gates: ["G0"] };
  if (id === "OBS-A11Y-001") return { kinds: ["KEYBOARD", "A11Y", "MANUAL"], gates: ["G5", "G6"] };
  if (id === "OBS-I18N-001") return { kinds: ["CONTRACT", "SCREENSHOT", "MANUAL"], gates: ["G1", "G5", "G6"] };
  if (id === "OBS-LOCAL-001") return { kinds: ["INTEGRATION"], gates: ["G4", "G7", "G8"] };
  const family = id.split("-")[1];
  if (["INS", "SET"].includes(family) || id === "OBS-LIFE-001") {
    return { kinds: ["UNIT", "INTEGRATION", "LIFECYCLE", "PACKAGE", "MANUAL"], gates: id === "OBS-LIFE-001" ? ["G1", "G4", "G7", "G8"] : ["G1", "G4", "G7", "G8"] };
  }
  if (["PAR", "SCH", "DAY"].includes(family)) return { kinds: ["UNIT", "CONTRACT"], gates: ["G1", "G2"] };
  if (family === "HIS") return { kinds: ["UNIT", "VAULT", "INTEGRATION"], gates: ["G2", "G3"] };
  if (["VIS", "CTL", "CMP"].includes(family) || id.startsWith("OBS-VIS")) {
    return { kinds: ["CONTRACT", "INTEGRATION", "SCREENSHOT", "MANUAL"], gates: ["G4", "G5", "G6"] };
  }
  if (family === "EXE") return { kinds: ["CONTRACT", "INTEGRATION", "KEYBOARD", "SCREENSHOT", "LIFECYCLE"], gates: ["G2", "G4", "G5", "G6"] };
  if (["CLK", "PER"].includes(family) || id === "OBS-SAFE-001") {
    return { kinds: ["UNIT", "CONTRACT", "VAULT", "INTEGRATION", "LIFECYCLE"], gates: id === "OBS-SAFE-001" ? ["G2", "G3", "G4", "G8"] : ["G2", "G3", "G4"] };
  }
  if (family === "CMD" || id === "OBS-HOST-001") return { kinds: ["INTEGRATION", "KEYBOARD", "MANUAL"], gates: ["G4", "G5"] };
  if (["ERR", "ERX"].includes(family)) return { kinds: ["CONTRACT", "VAULT", "INTEGRATION", "A11Y"], gates: ["G2", "G3", "G4", "G5"] };
  throw new Error(`no evidence matrix for ${id}`);
}

const testsByRequirement = new Map(expectedIds.map((id) => {
  const matrix = matrixFor(id);
  return [id, matrix.kinds.map((evidenceKind, index) => ({
    id: `TC-${id}-${String(index + 1).padStart(3, "0")}`,
    requirement_id: id,
    evidence_kind: evidenceKind,
    gates: matrix.gates,
  }))];
}));
const testCatalog = expectedIds.flatMap((id) => testsByRequirement.get(id));
const ownershipByRequirementId = new Map(ownershipRequirements.map((row) => [row.id, row]));
const requirements = expectedIds.map((id) => {
  const inventoryRow = id.startsWith("UP-") ? inventoryRows.get(id.slice(3)) : undefined;
  const isNotApplicable = id === "UP-INS-01";
  return {
    ...ownershipByRequirementId.get(id),
    statement: inventoryRow ? statementFor(inventoryRow) : initialRequirementStatements.get(id),
    source_refs: inventoryRow ? sourceRefsFor(inventoryRow) : [decisionRef],
    disposition: isNotApplicable ? "not-applicable" : "exact",
    fixtures: [...fixtureByRequirement.get(id)],
    tests: testsByRequirement.get(id).map((entry) => entry.id),
    environments: environmentsFor(id),
    evidence: [],
    ...(isNotApplicable ? { not_applicable_approval_id: "NA-001" } : {}),
    status: "active",
  };
});

const requirementOwners = {
  $schema: "./requirement-owners.schema.json",
  schema_version: 1,
  requirement_set: "UPSTREAM-MATRIX-v1+INITIAL-OBS-REL-v1",
  row_count: ownershipRequirements.length,
  requirements: ownershipRequirements,
};
const requirementManifest = {
  $schema: "../../scripts/release/schemas/requirements.schema.json",
  schema_version: 1,
  requirement_set: "UPSTREAM-MATRIX-v1+INITIAL-OBS-REL-v1",
  upstream_baseline_sha: "973a041aa2f59f3b05bf31db8187efbfea07017a",
  row_count: requirements.length,
  counts: { upstream: 114, obsidian: 9, release: 3 },
  evidence_binding: "candidate-evidence-index",
  fixture_catalog: fixtureCatalog,
  test_catalog: testCatalog,
  environment_catalog: environmentCatalog,
  requirements,
};

const allIds = requirements.map((row) => row.id);
const mandatoryPrivateIds = ["OBS-SAFE-001", "OBS-LIFE-001", "OBS-LOCAL-001", "REL-001", "REL-002"];
const scopeFixtureBase = {
  schema_version: 1,
  candidate_sha: "1111111111111111111111111111111111111111",
  requirements_sha256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  deviations_sha256: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  approved_deviation_ids: [],
};
const privateExcluded = allIds.filter((id) => !mandatoryPrivateIds.includes(id));
const fixtures = {
  "tests/fixtures/contracts/scope-public-valid.json": { ...scopeFixtureBase, release_scope: "public", parity_claim: "v1.0.2-parity", included_requirement_ids: allIds, excluded_requirement_ids: [] },
  "tests/fixtures/contracts/scope-public-exclusion-invalid.json": { ...scopeFixtureBase, release_scope: "public", parity_claim: "v1.0.2-parity", included_requirement_ids: allIds.slice(1), excluded_requirement_ids: [allIds[0]] },
  "tests/fixtures/contracts/scope-private-valid.json": { ...scopeFixtureBase, release_scope: "private", parity_claim: "private-preview", included_requirement_ids: mandatoryPrivateIds, excluded_requirement_ids: privateExcluded },
  "tests/fixtures/contracts/scope-private-missing-mandatory-invalid.json": { ...scopeFixtureBase, release_scope: "private", parity_claim: "private-preview", included_requirement_ids: mandatoryPrivateIds.slice(1), excluded_requirement_ids: privateExcluded },
  "tests/fixtures/contracts/scope-private-excludes-mandatory-invalid.json": { ...scopeFixtureBase, release_scope: "private", parity_claim: "private-preview", included_requirement_ids: mandatoryPrivateIds.slice(1), excluded_requirement_ids: [mandatoryPrivateIds[0], ...privateExcluded] },
};
const requirementIdDefinition = { type: "string", enum: allIds };
const requirementOwnersSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://github.com/oldwinter/obsidian-nautilus-log/blob/main/docs/parity/requirement-owners.schema.json",
  title: "Spiral Day parity requirement ownership map",
  type: "object",
  additionalProperties: false,
  required: ["$schema", "schema_version", "requirement_set", "row_count", "requirements"],
  properties: {
    $schema: { const: "./requirement-owners.schema.json" },
    schema_version: { const: 1 },
    requirement_set: { const: "UPSTREAM-MATRIX-v1+INITIAL-OBS-REL-v1" },
    row_count: { const: 126 },
    requirements: { type: "array", minItems: 126, maxItems: 126, items: { $ref: "#/$defs/ownership" } },
  },
  $defs: {
    requirementId: requirementIdDefinition,
    ownership: {
      type: "object",
      additionalProperties: false,
      required: ["id", "owner_ticket", "owner_module", "evidence_contributors"],
      properties: {
        id: { $ref: "#/$defs/requirementId" },
        owner_ticket: { type: "integer", minimum: 17, maximum: 31 },
        owner_module: { type: "string", minLength: 1 },
        evidence_contributors: {
          type: "array",
          minItems: 1,
          uniqueItems: true,
          items: { type: "integer", minimum: 17, maximum: 31 },
        },
      },
    },
  },
};
const ticketBoundariesSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://github.com/oldwinter/obsidian-nautilus-log/blob/main/docs/parity/ticket-boundaries.schema.json",
  title: "Spiral Day implementation ticket boundaries",
  type: "object",
  additionalProperties: false,
  required: ["$schema", "schema_version", "requirement_set", "tickets"],
  properties: {
    $schema: { const: "./ticket-boundaries.schema.json" },
    schema_version: { const: 1 },
    requirement_set: { const: "UPSTREAM-MATRIX-v1+INITIAL-OBS-REL-v1" },
    tickets: { type: "array", minItems: 15, maxItems: 15, items: { $ref: "#/$defs/ticketBoundary" } },
  },
  $defs: {
    requirementId: requirementIdDefinition,
    ticketBoundary: {
      type: "object",
      additionalProperties: false,
      required: ["ticket", "allowed_module_boundaries", "allowed_external_boundaries", "primary_requirement_ids"],
      properties: {
        ticket: { type: "integer", minimum: 17, maximum: 31 },
        allowed_module_boundaries: { type: "array", uniqueItems: true, items: { type: "string", minLength: 1 } },
        allowed_external_boundaries: { type: "array", uniqueItems: true, items: { type: "string", pattern: "^external:[a-z0-9-]+$" } },
        primary_requirement_ids: { type: "array", uniqueItems: true, items: { $ref: "#/$defs/requirementId" } },
      },
    },
  },
};
const partitionRules = allIds.map((id) => ({
  oneOf: [
    {
      properties: {
        included_requirement_ids: { type: "array", contains: { const: id } },
        excluded_requirement_ids: { type: "array", not: { type: "array", contains: { const: id } } },
      },
    },
    {
      properties: {
        included_requirement_ids: { type: "array", not: { type: "array", contains: { const: id } } },
        excluded_requirement_ids: { type: "array", contains: { const: id } },
      },
    },
  ],
}));
const mandatoryPrivateRules = mandatoryPrivateIds.map((id) => ({
  properties: {
    included_requirement_ids: { type: "array", contains: { const: id } },
    excluded_requirement_ids: { type: "array", not: { type: "array", contains: { const: id } } },
  },
}));
const scopeSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://github.com/oldwinter/obsidian-nautilus-log/blob/main/docs/parity/scope.schema.json",
  title: "Spiral Day release candidate requirement scope",
  type: "object",
  additionalProperties: false,
  required: [
    "schema_version", "candidate_sha", "requirements_sha256", "deviations_sha256", "release_scope", "parity_claim",
    "included_requirement_ids", "excluded_requirement_ids", "approved_deviation_ids",
  ],
  properties: {
    schema_version: { const: 1 },
    candidate_sha: { type: "string", pattern: "^[0-9a-f]{40}$" },
    requirements_sha256: { type: "string", pattern: "^[0-9a-f]{64}$" },
    deviations_sha256: { type: "string", pattern: "^[0-9a-f]{64}$" },
    release_scope: { enum: ["private", "public"] },
    parity_claim: { enum: ["private-preview", "v1.0.2-parity"] },
    included_requirement_ids: { type: "array", uniqueItems: true, items: { $ref: "#/$defs/requirementId" } },
    excluded_requirement_ids: { type: "array", uniqueItems: true, items: { $ref: "#/$defs/requirementId" } },
    approved_deviation_ids: { type: "array", uniqueItems: true, items: { type: "string", pattern: "^DEV-[0-9]{3}$" } },
  },
  allOf: [
    ...partitionRules,
    {
      if: { properties: { release_scope: { const: "public" } }, required: ["release_scope"] },
      then: {
        properties: {
          parity_claim: { const: "v1.0.2-parity" },
          included_requirement_ids: { type: "array", minItems: 126, maxItems: 126 },
          excluded_requirement_ids: { type: "array", maxItems: 0 },
        },
      },
    },
    {
      if: { properties: { release_scope: { const: "private" } }, required: ["release_scope"] },
      then: { properties: { parity_claim: { const: "private-preview" } }, allOf: mandatoryPrivateRules },
    },
  ],
  $defs: { requirementId: requirementIdDefinition },
};
const outputs = new Map([
  ["docs/parity/requirement-owners.json", `${JSON.stringify(requirementOwners, null, 2)}\n`],
  ["docs/parity/requirement-owners.schema.json", `${JSON.stringify(requirementOwnersSchema, null, 2)}\n`],
  ["docs/parity/requirements.json", `${JSON.stringify(requirementManifest, null, 2)}\n`],
  ["docs/parity/scope.schema.json", `${JSON.stringify(scopeSchema, null, 2)}\n`],
  ["docs/parity/ticket-boundaries.schema.json", `${JSON.stringify(ticketBoundariesSchema, null, 2)}\n`],
  ...Object.entries(fixtures).map(([path, contents]) => [path, `${JSON.stringify(contents, null, 2)}\n`]),
]);

if (process.argv.includes("--check")) {
  for (const [path, expected] of outputs) assert(read(path) === expected, `${path} is stale; run node scripts/generate-requirement-owners.mjs`);
} else {
  for (const [path, contents] of outputs) writeFileSync(join(root, path), contents);
}
