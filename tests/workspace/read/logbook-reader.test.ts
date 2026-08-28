import assert from "node:assert/strict";
import test from "node:test";

import { parseClockText } from "../../../src/workspace/clock-parser.ts";
import { readLogbook } from "../../../src/workspace/logbook-reader.ts";

const PLAN_ID = "nl-9f4de6a0-4d94-4b44-a7c4-c41127068e83";
const CLOCK_ID = "nl-clock-4d80fd42-ecbd-402f-af68-973fda5cce14";

test("canonical CLOCK requires an offset-bearing millisecond stamp and terminal lowercase UUIDv4 ID", () => {
  const running = parseClockText(
    `CLOCK: [2026-08-28 Fri 09:15:42.137 +08:00] ^${CLOCK_ID}`,
  );
  assert.equal(running.kind, "record");
  if (running.kind !== "record") return;
  assert.equal(running.record.format, "canonical");
  assert.equal(running.record.state, "running");
  assert.equal(running.record.clockId, CLOCK_ID);
  assert.equal(running.record.startEpochMs, Date.UTC(2026, 7, 28, 1, 15, 42, 137));
  assert.deepEqual(running.diagnostics, []);

  for (const invalid of [
    `CLOCK: [2026-08-28 Fri 09:15 +08:00] ^${CLOCK_ID}`,
    `CLOCK: [2026-08-28 Thu 09:15:42.137 +08:00] ^${CLOCK_ID}`,
    `CLOCK: [2026-02-30 Mon 09:15:42.137 +08:00] ^${CLOCK_ID}`,
    `CLOCK: [2026-08-28 Fri 09:15:42.137 +08:00] ^NL-CLOCK-4D80FD42-ECBD-402F-AF68-973FDA5CCE14`,
    `CLOCK: [2026-08-28 Fri 09:15:42.137 +08:00] ^nl-clock-4d80fd42-ecbd-302f-af68-973fda5cce14`,
    `CLOCK: [2026-08-28 Fri 09:15:42.137 +08:00] ^${CLOCK_ID} suffix`,
  ]) {
    const parsed = parseClockText(invalid);
    assert.equal(parsed.kind, "malformed", invalid);
    if (parsed.kind === "malformed") assert.equal(parsed.potentialRunning, true, invalid);
  }
});

test("canonical closed CLOCK derives Actual from endpoints and diagnoses confirmation text", () => {
  const parsed = parseClockText(
    `CLOCK: [2026-08-28 Fri 08:10:03.006 +08:00]--[2026-08-28 Fri 08:45:12.991 +08:00] => 0:34 ^${CLOCK_ID}`,
  );
  assert.equal(parsed.kind, "record");
  if (parsed.kind !== "record") return;
  assert.equal(parsed.record.state, "closed");
  assert.equal(parsed.record.actualMinutes, 35);
  assert.equal(parsed.record.displayedDurationMinutes, 34);
  assert.deepEqual(parsed.diagnostics.map((entry) => entry.code), [
    "displayed-duration-mismatch",
  ]);

  const backwards = parseClockText(
    `CLOCK: [2026-08-28 Fri 08:45:12.991 +08:00]--[2026-08-28 Fri 08:10:03.006 +08:00] => 0:00 ^${CLOCK_ID}`,
  );
  assert.equal(backwards.kind, "malformed");
  if (backwards.kind === "malformed") assert.equal(backwards.potentialRunning, false);
});

test("legacy CLOCK parsing delegates offset-free local time and never guesses gaps or folds", () => {
  const resolveLocalTime = (parts: { readonly hour: number; readonly minute: number }) =>
    parts.hour === 1
      ? { kind: "ambiguous" as const }
      : parts.hour === 2
        ? { kind: "nonexistent" as const }
        : { kind: "unique" as const, epochMs: Date.UTC(2026, 7, 28, parts.hour, parts.minute) };

  const closed = parseClockText(
    "clock:: [2026-08-28 Fri 08:10] -- [2026-08-28 08:45] => 0:01",
    { resolveLocalTime },
  );
  assert.equal(closed.kind, "record");
  if (closed.kind === "record") {
    assert.equal(closed.record.format, "legacy");
    assert.equal(closed.record.actualMinutes, 35);
    assert.deepEqual(closed.diagnostics.map((entry) => entry.code), [
      "displayed-duration-mismatch",
    ]);
  }

  for (const [hour, diagnostic] of [["01", "ambiguous-local-time"], ["02", "nonexistent-local-time"]] as const) {
    const running = parseClockText(`CLOCK: [2026-08-28 ${hour}:10]`, { resolveLocalTime });
    assert.equal(running.kind, "malformed");
    if (running.kind === "malformed") {
      assert.equal(running.potentialRunning, true);
      assert.deepEqual(running.diagnostics.map((entry) => entry.code), [diagnostic]);
    }
  }

  const unresolved = parseClockText("CLOCK: [2026-08-28 08:10]");
  assert.equal(unresolved.kind, "malformed");
  if (unresolved.kind === "malformed") assert.equal(unresolved.potentialRunning, true);

  const incompleteClose = parseClockText("CLOCK: [broken] -- missing-end");
  assert.equal(incompleteClose.kind, "malformed");
  if (incompleteClose.kind === "malformed") assert.equal(incompleteClose.potentialRunning, true);
});

test("UP-PER-01 reads one direct LOGBOOK and only its direct CLOCK children", () => {
  const source = [
    `- [ ] Owner ^${PLAN_ID}`,
    "  continuation",
    "  - Notes",
    "    - LOGBOOK::",
    `      - CLOCK: [2026-08-28 Fri 06:00:00.000 +08:00] ^${CLOCK_ID}`,
    "  ```md",
    "  - LOGBOOK::",
    `    - CLOCK: [2026-08-28 Fri 07:00:00.000 +08:00] ^${CLOCK_ID}`,
    "  ```",
    "  - LOGBOOK::",
    `    - CLOCK: [2026-08-28 Fri 09:15:42.137 +08:00] ^${CLOCK_ID}`,
    "      - CLOCK: [2026-08-28 10:00]",
    "    - ordinary [[CLOCK: [2026-08-28 11:00]]]",
    "- [ ] Next",
  ].join("\r\n");
  const before = source;
  const result = readLogbook(source, {
    path: "Daily/2026-08-28.md",
    itemFromOffset: 0,
    itemToOffset: source.indexOf("- [ ] Next"),
    ownerId: PLAN_ID,
  });

  assert.equal(result.kind, "accepted");
  assert.equal(result.drawers.length, 1);
  assert.equal(result.clocks.length, 1);
  assert.equal(result.clocks[0]!.parsed.kind, "record");
  assert.equal(result.clocks[0]!.text.startsWith("CLOCK:"), true);
  assert.equal(source, before);
  assert.equal(source.slice(result.clocks[0]!.fromOffset, result.clocks[0]!.toOffset), result.clocks[0]!.text);
});

test("LOGBOOK matching is case-insensitive, checkbox-free, exact, and duplicate-aware", () => {
  const source = [
    `- [ ] Owner ^${PLAN_ID}`,
    "  + logbook:",
    "    * CLOCK: [2026-08-28 01:10]",
    "  - LOGBOOK::",
    "    - CLOCK: [broken]",
    "  - [ ] LOGBOOK::",
    "    - CLOCK: [2026-08-28 02:10]",
    "  - [[LOGBOOK::]]",
  ].join("\n");
  const result = readLogbook(source, {
    path: "2026-08-28.md",
    itemFromOffset: 0,
    itemToOffset: source.length,
    ownerId: PLAN_ID,
  });
  assert.equal(result.kind, "ambiguous");
  assert.equal(result.drawers.length, 2);
  assert.equal(result.clocks.length, 2);
  assert.equal(result.clocks.every((clock) => clock.parsed.kind === "malformed"), true);
  assert.equal(result.clocks.every((clock) =>
    clock.parsed.kind === "malformed" && clock.parsed.potentialRunning), true);
});
