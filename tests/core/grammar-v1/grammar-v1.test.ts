import assert from "node:assert/strict";
import test from "node:test";

import { parseGrammar, parseGrammarV1 } from "../../../src/core/grammar-v1.ts";
import type {
  InlineSegment,
  PlanItem,
  PlanItemCandidate,
  PlanItemStatus,
} from "../../../src/core/model.ts";

const semantic = (text: string): InlineSegment => ({ kind: "semantic", text });
const displayOnly = (text: string): InlineSegment => ({ kind: "display-only", text });
const hidden = (text: string): InlineSegment => ({ kind: "hidden", text });

function candidate(
  sourceOrder: number,
  status: PlanItemStatus | "foreign",
  ...segments: readonly InlineSegment[]
): PlanItemCandidate<{ readonly id: string }> {
  return {
    source: { id: `item-${sourceOrder}` },
    sourceOrder,
    status,
    segments,
  };
}

function onlyItem(
  text: string,
  status: PlanItemStatus = "open",
  settings: { readonly defaultDurationMinutes?: unknown; readonly urgentTrigger?: string } = {},
): PlanItem<{ readonly id: string }> {
  const result = parseGrammarV1([candidate(0, status, semantic(text))], settings);
  assert.equal(result.items.length, 1, JSON.stringify(result.diagnostics));
  return result.items[0]!;
}

test("UP-PAR-01/02/10 and UP-DRF-02 preserve order and canonical status", () => {
  const result = parseGrammarV1([
    candidate(8, "plain", semantic("Plain row {{TODO}} {{DONE}} {{[[TODO]]}} {{[[DONE]]}} 15m")),
    candidate(3, "open", semantic("Open row 20m")),
    candidate(5, "done", semantic("Done row 25m")),
    candidate(1, "foreign", semantic("Foreign row 30m")),
  ]);

  assert.deepEqual(result.items.map((item) => item.sourceOrder), [8, 3, 5]);
  assert.deepEqual(result.items.map((item) => item.status), ["plain", "open", "done"]);
  assert.deepEqual(result.items.map((item) => item.executionEligible), [false, true, false]);
  assert.equal(result.items[0]!.label, "Plain row {{TODO}} {{DONE}} {{[[TODO]]}} {{[[DONE]]}}");
  assert.equal(result.items[0]!.kind, "flexible-task");
});

test("UP-PAR-03/04 parses duration forms, validated fallback, and zero", () => {
  const cases = [
    ["Write 30m", 30, "Write"],
    ["Write 30min", 30, "Write"],
    ["Write 1h", 60, "Write"],
    ["Write 1H30MIN", 90, "Write"],
    ["Write 1h90m", 150, "Write"],
    ["Write 1h 30m", 60, "Write 30m"],
    ["Write 30m then 45m", 30, "Write then 45m"],
    ["Write 0m", 0, "Write"],
  ] as const;

  for (const [text, duration, label] of cases) {
    const item = onlyItem(text);
    assert.equal(item.durationMinutes, duration, text);
    assert.equal(item.label, label, text);
  }

  for (const fallback of [undefined, null, 4, 61, 12.5, "30"]) {
    assert.equal(onlyItem("Fallback", "open", { defaultDurationMinutes: fallback }).durationMinutes, 15);
  }
  assert.equal(onlyItem("Fallback", "open", { defaultDurationMinutes: 17 }).durationMinutes, 17);

  for (const text of ["Write (30m)", "Write x30m", "Write 30m,", "Write 1.5h"]) {
    const item = onlyItem(text);
    assert.equal(item.durationMinutes, 15, text);
    assert.equal(item.label, text, text);
  }
});

test("UP-PAR-03 uses node or whitespace boundaries and no backslash escape", () => {
  const split = parseGrammarV1([
    candidate(0, "open", semantic("Split 30"), semantic("m")),
  ]).items[0]!;
  assert.equal(split.durationMinutes, 15);
  assert.equal(split.label, "Split 30m");

  const escaped = onlyItem("Keep \\30m");
  assert.equal(escaped.durationMinutes, 15);
  assert.equal(escaped.label, "Keep \\30m");

  const ordinaryBoundary = onlyItem("Keep \\ 30m");
  assert.equal(ordinaryBoundary.durationMinutes, 30);
  assert.equal(ordinaryBoundary.label, "Keep \\");
});

test("UP-PAR-05 parses all range forms and inheritance rules", () => {
  const cases = [
    ["Event 9-10", 540, 600],
    ["Event 9 to 10", 540, 600],
    ["Event 9–10", 540, 600],
    ["Event 9 až 10", 540, 600],
    ["Event 9-10pm", 1260, 1320],
    ["Event 12-1am", 0, 60],
    ["Event 9:5-10:07", 545, 607],
    ["Event 9\u0085-\u008510", 540, 600],
  ] as const;

  for (const [text, start, end] of cases) {
    const item = onlyItem(text);
    assert.equal(item.kind, "fixed-event", text);
    if (item.kind === "fixed-event") {
      assert.equal(item.startMinutes, start, text);
      assert.equal(item.endMinutes, end, text);
    }
    assert.equal(item.label, "Event", text);
  }

  const noForwardInheritance = onlyItem("Late 9pm-10");
  assert.equal(noForwardInheritance.kind, "fixed-event");
  if (noForwardInheritance.kind === "fixed-event") {
    assert.deepEqual([noForwardInheritance.startMinutes, noForwardInheritance.endMinutes], [1260, 1440]);
  }
});

test("UP-PAR-05 keeps invalid-first authoritative and rejects non-boundaries", () => {
  const invalidInputs = ["Bad 24:00-01:00 then 9-10", "Bad 09:60-10:00 then 9-10", "Bad 0am-1am then 9-10", "Bad 13pm-2pm then 9-10"];
  for (const text of invalidInputs) {
    const result = parseGrammarV1([candidate(0, "open", semantic(text))]);
    assert.equal(result.items[0]!.kind, "flexible-task", text);
    assert.equal(result.items[0]!.label, text, text);
    assert.deepEqual(result.diagnostics.map((diagnostic) => diagnostic.code), ["invalid-time-range"], text);
  }

  const invalidWithDuration = parseGrammarV1([
    candidate(0, "open", semantic("Bad 24:00-01:00 30m then 9-10")),
  ]);
  assert.equal(invalidWithDuration.items[0]!.kind, "flexible-task");
  assert.equal(invalidWithDuration.items[0]!.durationMinutes, 30);
  assert.equal(invalidWithDuration.items[0]!.label, "Bad 24:00-01:00 then 9-10");
  assert.deepEqual(invalidWithDuration.diagnostics.map((entry) => entry.code), [
    "invalid-time-range",
  ]);

  for (const text of ["Plain x09:00-10:00", "Plain (9-10)", "Plain 9 az 10"]) {
    const result = parseGrammarV1([candidate(0, "open", semantic(text))]);
    assert.equal(result.items[0]!.kind, "flexible-task", text);
    assert.deepEqual(result.diagnostics, [], text);
  }

  const splitRange = parseGrammarV1([
    candidate(0, "open", semantic("Split 9-"), semantic("10")),
  ]).items[0]!;
  assert.equal(splitRange.kind, "flexible-task");
  assert.equal(splitRange.label, "Split 9-10");
});

test("UP-PAR-06, UP-ERR-01, and UP-DRF-05 preserve v1 same-day truncation", () => {
  const same = parseGrammarV1([candidate(0, "open", semantic("Zero 09:00-09:00"))]);
  assert.equal(same.items[0]!.kind, "fixed-event");
  assert.deepEqual(same.diagnostics.map((diagnostic) => diagnostic.code), ["same-time"]);

  const overnight = parseGrammarV1([candidate(0, "open", semantic("Late 23:00-01:00"))]);
  assert.equal(overnight.items[0]!.kind, "fixed-event");
  if (overnight.items[0]!.kind === "fixed-event") {
    assert.deepEqual([overnight.items[0]!.startMinutes, overnight.items[0]!.endMinutes], [1380, 1440]);
  }
  assert.deepEqual(overnight.diagnostics.map((diagnostic) => diagnostic.code), ["overnight-truncated"]);

  const afterMidnight = parseGrammarV1([
    candidate(0, "open", semantic("Late 23:00-00:30")),
  ]);
  assert.equal(afterMidnight.items[0]!.kind, "fixed-event");
  if (afterMidnight.items[0]!.kind === "fixed-event") {
    assert.deepEqual(
      [afterMidnight.items[0]!.startMinutes, afterMidnight.items[0]!.endMinutes],
      [1380, 1440],
    );
  }
  assert.deepEqual(afterMidnight.diagnostics.map((entry) => entry.code), [
    "overnight-truncated",
  ]);

  for (const text of ["Boundary 23:00-00:00", "Boundary 23-0"]) {
    const result = parseGrammarV1([candidate(0, "open", semantic(text))]);
    assert.equal(result.items[0]!.kind, "fixed-event");
    assert.deepEqual(result.diagnostics, []);
    if (result.items[0]!.kind === "fixed-event") {
      assert.equal(result.items[0]!.endMinutes, 1440);
    }
  }
});

test("UP-PAR-07 applies progress once with shared half-up rounding", () => {
  const cases = [
    ["Task 10m d0%", 0, 10],
    ["Task 10m d33%", 33, 7],
    ["Task 90m d25%", 25, 68],
    ["Task 10m d100%", 100, 0],
    ["Task 10m d101%", 100, 0],
    ["Task 10m d999%", 100, 0],
  ] as const;
  for (const [text, progress, remaining] of cases) {
    const item = onlyItem(text);
    assert.equal(item.progressPercent, progress, text);
    assert.equal(item.remainingDurationMinutes, remaining, text);
    assert.equal(item.label, "Task", text);
  }

  for (const text of ["Task 10m d1000%", "Task 10m (d50%)", "Task 10m xd50%", "Task 10m d5.5%"] ) {
    const item = onlyItem(text);
    assert.equal(item.progressPercent, 0, text);
    assert.notEqual(item.label, "Task", text);
  }

  assert.equal(onlyItem("Task 10m D50%").progressPercent, 50);

  const first = onlyItem("Task 20m d25% then d75%");
  assert.equal(first.progressPercent, 25);
  assert.equal(first.remainingDurationMinutes, 15);
  assert.equal(first.label, "Task then d75%");
});

test("UP-PAR-08 recognizes completion anchors only for done flexible tasks", () => {
  const done = onlyItem("Finished 45m note-ad9:5-tail", "done");
  assert.equal(done.kind, "flexible-task");
  if (done.kind === "flexible-task") assert.equal(done.completionAnchorMinutes, 545);
  assert.equal(done.label, "Finished note-a-tail");

  const permissive = onlyItem("Finished 45m d99:99", "done");
  if (permissive.kind === "flexible-task") assert.equal(permissive.completionAnchorMinutes, 6039);

  const first = onlyItem("Finished 45m d9 then d10", "done");
  if (first.kind === "flexible-task") assert.equal(first.completionAnchorMinutes, 540);
  assert.equal(first.label, "Finished then d10");

  const progressOnly = onlyItem("Finished 60m d50%", "done");
  assert.equal(progressOnly.progressPercent, 50);
  assert.equal(progressOnly.label, "Finished");
  if (progressOnly.kind === "flexible-task") {
    assert.equal(progressOnly.completionAnchorMinutes, undefined);
  }

  for (const status of ["plain", "open"] as const) {
    const item = onlyItem("Pending 45m d9:5", status);
    assert.equal(item.label, "Pending d9:5");
    if (item.kind === "flexible-task") assert.equal(item.completionAnchorMinutes, undefined);
  }

  const fixed = onlyItem("Finished 9-10 d9:5", "done");
  assert.equal(fixed.kind, "fixed-event");
  assert.equal(fixed.label, "Finished d9:5");

  const uppercase = onlyItem("Finished 45m D9:5", "done");
  assert.equal(uppercase.label, "Finished D9:5");
  if (uppercase.kind === "flexible-task") assert.equal(uppercase.completionAnchorMinutes, undefined);
});

test("UP-PAR-05/07/10 keeps range classification authoritative for every status", () => {
  for (const status of ["plain", "open", "done"] as const) {
    const item = onlyItem("Meeting 9-10 30m d50%", status);
    assert.equal(item.kind, "fixed-event", status);
    assert.equal(item.status, status);
    assert.equal(item.durationMinutes, 30);
    assert.equal(item.progressPercent, 50);
    assert.equal(item.remainingDurationMinutes, 15);
    assert.equal(item.executionEligible, false);
    assert.equal(item.label, "Meeting");
  }
});

test("UP-PAR-09/11 and FX-04 respect inline participation and labels", () => {
  const result = parseGrammarV1([
    candidate(
      0,
      "open",
      semantic("Thirty label "),
      hidden("https://example.test/30m"),
      semantic("20m "),
      displayOnly("code 45m "),
      displayOnly("embed 60m "),
      hidden("<!-- 90m -->"),
      semantic("#tag [due:: 2026-08-29] ---"),
    ),
    candidate(1, "open", semantic("30m"), hidden("https://example.test")),
    candidate(2, "open", semantic("深度工作 30m")),
  ]);

  assert.deepEqual(result.items.map((item) => item.durationMinutes), [20, 30]);
  assert.deepEqual(result.items.map((item) => item.label), [
    "Thirty label code 45m embed 60m #tag [due:: 2026-08-29]",
    "",
    "深度工作",
  ].filter(Boolean));
  assert.deepEqual(result.diagnostics.map((diagnostic) => diagnostic.code), ["empty-plan-item"]);

  const nativeLinks = parseGrammarV1([
    candidate(3, "open", semantic("Wiki alias 45m"), hidden("Wiki target 90m")),
    candidate(4, "plain", displayOnly("Embed alias 60m"), hidden("Embed target 90m")),
  ]);
  assert.deepEqual(nativeLinks.items.map((item) => [item.label, item.durationMinutes]), [
    ["Wiki alias", 45],
    ["Embed alias 60m", 15],
  ]);
  assert.equal(nativeLinks.items[1]!.executionEligible, false);
});

test("UP-PAR-09 preserves English and Chinese label semantics", () => {
  const result = parseGrammarV1([
    candidate(0, "open", semantic("Deep work 30m")),
    candidate(1, "open", semantic("深度工作 30m")),
  ]);
  assert.deepEqual(result.items.map((item) => item.label), ["Deep work", "深度工作"]);
  assert.deepEqual(result.items.map((item) => item.durationMinutes), [30, 30]);
});

test("UP-PAR-12 detects urgent locally without changing action eligibility", () => {
  const urgent = onlyItem("Ship NOW 30m", "open", { urgentTrigger: " N O W " });
  assert.equal(urgent.urgent, true);
  assert.equal(urgent.label, "Ship NOW");
  assert.equal(urgent.executionEligible, true);
  assert.equal("urgentTrigger" in urgent.tokens, false);

  for (const text of ["Ship xNOW 30m", "Ship NOW! 30m"]) {
    assert.equal(onlyItem(text, "open", { urgentTrigger: "NOW" }).urgent, false, text);
  }
  assert.equal(onlyItem("Meeting NOW 9-10", "open", { urgentTrigger: "NOW" }).urgent, false);
  assert.equal(onlyItem("Ship now 30m", "open", { urgentTrigger: "NOW" }).urgent, false);
  assert.equal(onlyItem("Wrapper link", "plain").executionEligible, false);

  const unicodeWhitespace = onlyItem("Ship\u0085NOW\u008530m", "open", {
    urgentTrigger: "N\u0085O\u0085W",
  });
  assert.equal(unicodeWhitespace.urgent, true);
  assert.equal(unicodeWhitespace.durationMinutes, 30);
  assert.equal(unicodeWhitespace.label, "Ship NOW");
});

test("UP-PAR-01 emits only the canonical empty diagnostic for cleaned-empty rows", () => {
  const result = parseGrammarV1([
    candidate(0, "open", semantic("30m")),
    candidate(1, "plain", semantic("---")),
  ]);
  assert.deepEqual(result.items, []);
  assert.deepEqual(result.diagnostics.map((entry) => [entry.code, entry.sourceOrder]), [
    ["empty-plan-item", 0],
    ["empty-plan-item", 1],
  ]);
});

test("FX-03 excludes continuation/nested/code/embed segments from token scans", () => {
  const item = parseGrammarV1([
    candidate(0, "open", semantic("Visible 20m "), displayOnly("inline 30m "), hidden("nested 9-10 45m")),
  ]).items[0]!;
  assert.equal(item.kind, "flexible-task");
  assert.equal(item.durationMinutes, 20);
  assert.equal(item.label, "Visible inline 30m");
});

test("FX-05 supplies stable parser-domain order without scheduling", () => {
  const result = parseGrammarV1([
    candidate(0, "open", semantic("Event A 9-11")),
    candidate(1, "open", semantic("Event B 10-12")),
    candidate(2, "open", semantic("Event C 12-13")),
    candidate(3, "open", semantic("Large 90m")),
    candidate(4, "open", semantic("Small 15m")),
  ]);
  assert.deepEqual(result.items.map((item) => [item.kind, item.label, item.durationMinutes]), [
    ["fixed-event", "Event A", 15],
    ["fixed-event", "Event B", 15],
    ["fixed-event", "Event C", 15],
    ["flexible-task", "Large", 90],
    ["flexible-task", "Small", 15],
  ]);
});

test("FX-06 is deterministic, pure, immutable, and version dispatched", () => {
  const candidates = Object.freeze([
    Object.freeze({
      ...candidate(0, "open", semantic("Plan 10m d33%")),
      segments: Object.freeze([Object.freeze(semantic("Plan 10m d33%"))]),
    }),
    Object.freeze({
      ...candidate(1, "open", semantic("计划 10m d33%")),
      segments: Object.freeze([Object.freeze(semantic("计划 10m d33%"))]),
    }),
  ]);
  const before = structuredClone(candidates);
  const first = parseGrammar({ version: "v1", candidates });
  const second = parseGrammar({ version: "v1", candidates });

  assert.deepEqual(first, second);
  assert.deepEqual(candidates, before);
  assert.deepEqual(first.items.map((item) => [item.label, item.remainingDurationMinutes]), [
    ["Plan", 7],
    ["计划", 7],
  ]);
  assert.doesNotMatch(JSON.stringify(first), /"(?:date|now|timer)"/i);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.items), true);
  assert.equal(Object.isFrozen(first.items[0]), true);
  assert.equal(Object.isFrozen(first.items[0]!.tokens), true);

  const unsupported = parseGrammar({ version: "v2", candidates });
  assert.equal(unsupported.supported, false);
  assert.deepEqual(unsupported.items, []);
  assert.deepEqual(unsupported.diagnostics, []);
});
