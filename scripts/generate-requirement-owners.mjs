#!/usr/bin/env node

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const readJson = (path) => JSON.parse(readFileSync(join(root, path), "utf8"));
const inventory = readFileSync(join(root, "docs/research/behavior-inventory.md"), "utf8");
const boundaries = readJson("docs/parity/ticket-boundaries.json");
const upstreamIds = [...inventory.matchAll(/^\| ((?:INS|SET|PAR|SCH|DAY|HIS|VIS|CTL|CMP|EXE|CLK|CMD|PER|ERR|ERX|DRF)-\d{2}) \|/gm)]
  .map((match) => `UP-${match[1]}`);
const initialIds = [
  "OBS-TRACE-001", "OBS-HOST-001", "OBS-VIS-001", "OBS-VIS-002",
  "OBS-A11Y-001", "OBS-SAFE-001", "OBS-LIFE-001", "OBS-I18N-001",
  "OBS-LOCAL-001", "REL-001", "REL-002", "REL-003",
];
const expectedIds = [...upstreamIds, ...initialIds];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function range(prefix, first, last) {
  return Array.from({ length: last - first + 1 }, (_, index) => `${prefix}-${String(first + index).padStart(2, "0")}`);
}

assert(boundaries.schema_version === 1, "ticket-boundary schema_version must be 1");
assert(boundaries.tickets.length === 15, "ticket-boundary manifest must contain #17-#31");
const ticketForRequirement = new Map();
const allowedBoundaryByTicket = new Map();
for (const entry of boundaries.tickets) {
  assert(entry.ticket >= 17 && entry.ticket <= 31, `invalid ticket #${entry.ticket}`);
  assert(!allowedBoundaryByTicket.has(entry.ticket), `duplicate ticket #${entry.ticket}`);
  allowedBoundaryByTicket.set(entry.ticket, new Set([
    ...entry.allowed_module_boundaries,
    ...entry.allowed_external_boundaries,
  ]));
  for (const id of entry.primary_requirement_ids) {
    assert(!ticketForRequirement.has(id), `${id} has multiple primary tickets`);
    ticketForRequirement.set(id, entry.ticket);
  }
}
assert(ticketForRequirement.size === 126, `ticket-boundary manifest must own 126 requirements; found ${ticketForRequirement.size}`);
assert(new Set(expectedIds).size === 126, "expected requirement universe is not 126 unique IDs");
assert(expectedIds.every((id) => ticketForRequirement.has(id)), "ticket-boundary manifest is missing an expected requirement");
assert([...ticketForRequirement].every(([id]) => expectedIds.includes(id)), "ticket-boundary manifest contains an unknown requirement");

const ownershipById = new Map();
function own(ids, ownerModule, evidenceContributors = []) {
  for (const id of ids) {
    const requirementId = id.startsWith("UP-") || id.startsWith("OBS-") || id.startsWith("REL-") ? id : `UP-${id}`;
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
const requirements = expectedIds.map((id) => {
  const ownerTicket = ticketForRequirement.get(id);
  const assignment = ownershipById.get(id);
  assert(assignment, `no owner-module assignment for ${id}`);
  assert(allowedBoundaryByTicket.get(ownerTicket).has(assignment.ownerModule), `${id} module ${assignment.ownerModule} is outside #${ownerTicket}`);
  assert(!assignment.evidenceContributors.includes(ownerTicket), `${id} repeats #${ownerTicket} as evidence contributor`);
  return {
    id,
    owner_ticket: ownerTicket,
    owner_module: assignment.ownerModule,
    ...(assignment.evidenceContributors.length > 0 ? { evidence_contributors: assignment.evidenceContributors } : {}),
  };
});

const output = {
  $schema: "./requirement-owners.schema.json",
  schema_version: 1,
  requirement_set: "UPSTREAM-MATRIX-v1+INITIAL-OBS-REL-v1",
  row_count: requirements.length,
  requirements,
};

writeFileSync(join(root, "docs/parity/requirement-owners.json"), `${JSON.stringify(output, null, 2)}\n`);
