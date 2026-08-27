#!/usr/bin/env node

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const inventory = readFileSync(join(root, "docs/research/behavior-inventory.md"), "utf8");
const upstreamIds = [...inventory.matchAll(/^\| ((?:INS|SET|PAR|SCH|DAY|HIS|VIS|CTL|CMP|EXE|CLK|CMD|PER|ERR|ERX|DRF)-\d{2}) \|/gm)]
  .map((match) => `UP-${match[1]}`);

const familyOwners = new Map([
  ["PAR", [18, "src/core/parser.ts and src/core/plan-item.ts", [20, 22]]],
  ["SCH", [19, "src/core/scheduler.ts and src/core/capacity.ts", [22, 23]]],
  ["DAY", [19, "src/core/day-projection.ts", [21, 23]]],
  ["HIS", [28, "src/core/history-index.ts and src/core/review.ts", [19, 20, 29]]],
  ["VIS", [23, "src/ui/planner/spiral-view.ts and styles/planner.css", [22, 24, 30]]],
  ["CTL", [24, "src/ui/planner/controls.ts and src/ui/planner/planner-a11y.ts", [23, 25, 30]]],
  ["CMP", [23, "src/ui/planner/responsive-layout.ts and styles/planner.css", [24, 30]]],
  ["CMD", [27, "src/adapters/execution-commands.ts", [24, 26, 30]]],
  ["ERX", [27, "src/i18n/locales/{en,zh-CN}/execution.ts and src/adapters/execution-notices.ts", [25, 26, 30]]],
]);

const exactOwners = new Map();
function own(ids, ticket, module, contributors = []) {
  for (const id of ids) exactOwners.set(`UP-${id}`, [ticket, module, contributors]);
}
function range(prefix, first, last) {
  return Array.from({ length: last - first + 1 }, (_, index) => `${prefix}-${String(first + index).padStart(2, "0")}`);
}

own(["INS-01", "INS-02"], 17, "manifest.json, package.json, and src/main.ts bootstrap", [22, 30]);
own(["INS-03"], 23, "src/ui/planner/planner-view.ts", [17, 21, 30]);
own(["INS-04", "INS-05"], 21, "src/runtime/nautilus-runtime.ts and src/runtime/lifecycle.ts", [17, 23, 30]);
own(range("SET", 1, 13), 27, "src/settings/spiral-day-settings.ts and src/adapters/settings-tab.ts", [21, 24, 26, 30]);

own(["EXE-01"], 21, "src/runtime/nautilus-runtime.ts Primary Plan projection", [19, 20, 27]);
own(["EXE-02"], 28, "src/core/review.ts and src/core/execution-projection.ts", [19, 27, 29]);
own(range("EXE", 3, 7), 27, "src/ui/execution/execution-panel.ts and src/ui/execution/plan-surface.ts", [23, 24, 26, 30]);
own(["EXE-08"], 29, "src/ui/review/review-view.ts", [28, 30]);
own(["EXE-09"], 28, "src/core/review.ts Actual projection", [26, 29, 30]);
own(["EXE-10", "EXE-11"], 26, "src/runtime/execution-runtime.ts Standalone POMO state machine", [27, 30]);
own(["EXE-12"], 27, "src/adapters/source-navigation.ts", [20, 30]);
own(["EXE-13"], 27, "src/ui/execution/execution-panel.ts pending-mutation state", [26, 30]);

own(range("CLK", 1, 9), 26, "src/runtime/execution-runtime.ts CLOCK and Task POMO state machines", [20, 25, 27, 30]);
own(["CLK-10"], 27, "src/ui/execution/active-task-view.ts (ActiveTaskView)", [20, 21, 26, 30]);
own(["PER-01"], 20, "src/markdown/logbook-reader.ts and src/markdown/clock-parser.ts", [25, 26, 28]);
own(["PER-02"], 26, "src/runtime/execution-runtime.ts refresh and display ticks", [21, 27, 30]);

own(["ERR-01", "ERR-02"], 23, "src/ui/planner/diagnostics.ts", [18, 19, 24, 30]);
own(range("ERR", 3, 8), 27, "src/adapters/execution-notices.ts", [21, 25, 26, 30]);
own(["ERR-09"], 24, "src/ui/planner/planner-a11y.ts and shared accessibility contract", [23, 27, 29, 30]);

own(["DRF-01"], 17, "README.md and package/install contract", [22, 31]);
own(["DRF-02", "DRF-05"], 18, "src/core/parser.ts compatibility fixtures", [19, 22]);
own(["DRF-03", "DRF-04"], 20, "src/markdown/primary-plan-resolver.ts and identity index", [18, 22, 26]);
own(["DRF-06"], 24, "src/ui/planner/controls.ts scope boundary", [22, 23]);
own(["DRF-07", "DRF-08"], 27, "src/ui/execution entry points and execution locale namespace", [22, 24]);
own(["DRF-09"], 22, "test/evidence/provenance and golden-source ledger", [23, 30]);

const ownershipRows = upstreamIds.map((id) => {
  const sourceId = id.slice(3);
  const family = sourceId.slice(0, 3);
  const owner = exactOwners.get(id) ?? familyOwners.get(family);
  if (!owner) throw new Error(`No owner declared for ${id}`);
  const [ownerTicket, ownerModule, evidenceContributors] = owner;
  return {
    id,
    owner_ticket: ownerTicket,
    owner_module: ownerModule,
    ...(evidenceContributors.length > 0 ? { evidence_contributors: evidenceContributors } : {}),
  };
});

ownershipRows.push(
  { id: "OBS-TRACE-001", owner_ticket: 22, owner_module: "docs/parity/requirements.json, schemas, and traceability tooling", evidence_contributors: [17, 18, 19, 20, 21, 23, 24, 25, 26, 27, 28, 29, 30, 31] },
  { id: "OBS-HOST-001", owner_ticket: 27, owner_module: "src/ui/execution/active-task-view.ts (ActiveTaskView) and public host adapters", evidence_contributors: [21, 23, 24, 29, 30] },
  { id: "OBS-VIS-001", owner_ticket: 23, owner_module: "src/ui/planner/responsive-layout.ts breakpoint contract", evidence_contributors: [24, 30] },
  { id: "OBS-VIS-002", owner_ticket: 24, owner_module: "styles/theme.css and shared visual accessibility tokens", evidence_contributors: [23, 27, 29, 30] },
  { id: "OBS-A11Y-001", owner_ticket: 24, owner_module: "src/ui/planner/planner-a11y.ts and shared accessibility primitives", evidence_contributors: [27, 29, 30] },
  { id: "OBS-SAFE-001", owner_ticket: 25, owner_module: "src/markdown/commit.ts and src/markdown/semantic-cas.ts", evidence_contributors: [20, 26, 30] },
  { id: "OBS-LIFE-001", owner_ticket: 21, owner_module: "src/runtime/lifecycle.ts", evidence_contributors: [17, 23, 27, 29, 30] },
  { id: "OBS-I18N-001", owner_ticket: 24, owner_module: "src/i18n/resolver.ts and src/i18n/locales/{en,zh-CN}/shared.ts", evidence_contributors: [27, 29, 30] },
  { id: "OBS-LOCAL-001", owner_ticket: 17, owner_module: "package.json, src/main.ts, and local-only bootstrap boundary", evidence_contributors: [22, 30, 31] },
  { id: "REL-001", owner_ticket: 22, owner_module: "scripts/release, test/release, schemas, fixtures, scanners, and evidence templates", evidence_contributors: [17, 30, 31] },
  { id: "REL-002", owner_ticket: 22, owner_module: "docs/parity/scope schema and deterministic package manifest tooling", evidence_contributors: [30, 31] },
  { id: "REL-003", owner_ticket: 31, owner_module: "G7-G9 execution and sign-off on the frozen candidate; no repository files", evidence_contributors: [22, 30] },
);

const output = {
  $schema: "./requirement-owners.schema.json",
  schema_version: 1,
  requirement_set: "UPSTREAM-MATRIX-v1+INITIAL-OBS-REL-v1",
  row_count: ownershipRows.length,
  requirements: ownershipRows,
};

writeFileSync(join(root, "docs/parity/requirement-owners.json"), `${JSON.stringify(output, null, 2)}\n`);
