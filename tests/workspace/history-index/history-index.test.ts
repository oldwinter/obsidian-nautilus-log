import assert from "node:assert/strict";
import test from "node:test";

import { ReviewCoordinator } from "../../../src/runtime/review/coordinator.ts";
import { formatCanonicalClosedClock, formatCanonicalRunningClock } from "../../../src/workspace/logbook-clock.ts";
import {
  DEFAULT_HISTORY_INDEX_LIMITS,
  HistoryIndex,
  type HistoryIndexScheduler,
} from "../../../src/workspace/history-index.ts";
import {
  MemoryTextAccess,
  type SourceChangeListener,
  type TextAccess,
} from "../../../src/workspace/text-access.ts";

const OPEN = "<!-- nautilus-log:plan/v1 -->";
const CLOSE = "<!-- /nautilus-log:plan -->";
const OWNER_A = "nl-11111111-1111-4111-8111-111111111111";
const OWNER_B = "nl-22222222-2222-4222-8222-222222222222";
const CLOCK_A = "nl-clock-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CLOCK_B = "nl-clock-bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const DAY_START = Date.UTC(2026, 7, 29);
const MINUTE = 60_000;
const CONFIGURATION = Object.freeze({ folder: "", format: "YYYY-MM-DD" });

function plan(...rows: readonly string[]): string {
  return `${OPEN}\n${rows.join("\n")}\n${CLOSE}\n`;
}

function taskWithClock(input: {
  ownerId: string;
  clock: string;
  done?: boolean;
  label?: string;
  anchor?: string;
}): string {
  return [
    `- [${input.done ? "x" : " "}] ${input.label ?? "Task"} 30m${input.anchor ? ` ${input.anchor}` : ""} ^${input.ownerId}`,
    "  - LOGBOOK::",
    `    - ${input.clock}`,
  ].join("\n");
}

function deterministicId(prefix: "nl-" | "nl-clock-", value: number): string {
  return `${prefix}00000000-0000-4000-8000-${value.toString(16).padStart(12, "0")}`;
}

test("history index derives accepted Daily Note tasks and CLOCK records without a write port", async () => {
  const source = plan(
    taskWithClock({
      ownerId: OWNER_A,
      label: "Open",
      clock: formatCanonicalRunningClock(DAY_START + 60 * MINUTE, 0, CLOCK_A),
    }),
    taskWithClock({
      ownerId: OWNER_B,
      label: "Done",
      done: true,
      anchor: "d12:00",
      clock: formatCanonicalClosedClock(
        DAY_START + 120 * MINUTE,
        0,
        DAY_START + 150 * MINUTE,
        0,
        CLOCK_B,
      ),
    }),
  );
  const access = new MemoryTextAccess({
    "2026-08-29.md": source,
    "ordinary.md": "# Not a Daily Note\n",
    "image.png.md": "ordinary but still counted Markdown\n",
  });
  const index = new HistoryIndex(access);
  const snapshot = await index.rebuild({ configuration: CONFIGURATION });
  assert.equal(snapshot.state, "current");
  if (snapshot.state !== "current") return;
  assert.deepEqual(snapshot.counts, {
    markdownFiles: 3,
    markdownBytes: new TextEncoder().encode(source + "# Not a Daily Note\n" + "ordinary but still counted Markdown\n").length,
    dailyNotes: 1,
    clockRecords: 2,
    tasks: 2,
  });
  assert.deepEqual(snapshot.tasks.map((task) => ({
    label: task.label,
    status: task.status,
    ownerId: task.ownerId,
    clocks: task.clocks.map((clock) => clock.state),
    anchor: task.completionAnchorMinutes,
  })), [
    { label: "Open", status: "open", ownerId: OWNER_A, clocks: ["running"], anchor: undefined },
    { label: "Done", status: "done", ownerId: OWNER_B, clocks: ["closed"], anchor: 720 },
  ]);
  assert.equal(snapshot.diagnostics.length, 0);
  index.dispose();
});

test("ambiguous and malformed LOGBOOK data diagnoses and never fabricates history", async () => {
  const source = plan([
    `- [x] Done ^${OWNER_A}`,
    "  - LOGBOOK::",
    "    - CLOCK: [not-a-time]",
    "  - LOGBOOK::",
    `    - ${formatCanonicalClosedClock(DAY_START, 0, DAY_START + MINUTE, 0, CLOCK_A)}`,
  ].join("\n"));
  const index = new HistoryIndex(new MemoryTextAccess({ "2026-08-29.md": source }));
  const snapshot = await index.rebuild({ configuration: CONFIGURATION });
  assert.equal(snapshot.state, "current");
  if (snapshot.state !== "current") return;
  assert.deepEqual(snapshot.tasks[0]?.clocks, []);
  assert.equal(snapshot.diagnostics.some((diagnostic) => diagnostic.code === "ambiguous-logbook"), true);
  index.dispose();

  const malformedSource = plan(taskWithClock({
    ownerId: OWNER_A,
    done: true,
    clock: "CLOCK: [not-a-time]--[also-not-a-time]",
  }));
  const malformedIndex = new HistoryIndex(new MemoryTextAccess({ "2026-08-29.md": malformedSource }));
  const malformed = await malformedIndex.rebuild({ configuration: CONFIGURATION });
  assert.equal(malformed.state, "current");
  if (malformed.state === "current") {
    assert.equal(malformed.tasks[0]?.clocks[0]?.state, "malformed");
    assert.equal(malformed.diagnostics.some((diagnostic) => diagnostic.code === "malformed-clock"), true);
  }
  malformedIndex.dispose();

  const anonymousSource = plan([
    "- [x] Anonymous 30m",
    "  - LOGBOOK::",
    `    - ${formatCanonicalClosedClock(DAY_START, 0, DAY_START + MINUTE, 0, CLOCK_A)}`,
    "  - Another child",
    "    - CLOCK: [not-a-time]--[also-not-a-time]",
  ].join("\n"));
  const anonymousIndex = new HistoryIndex(new MemoryTextAccess({ "2026-08-29.md": anonymousSource }));
  const anonymous = await anonymousIndex.rebuild({ configuration: CONFIGURATION });
  assert.equal(anonymous.state, "current");
  if (anonymous.state === "current") {
    assert.deepEqual(anonymous.tasks[0]?.clocks, [], "CLOCKs without an owner ID never join Actual");
    assert.equal(anonymous.counts.clockRecords, 1, "unjoinable CLOCKs still count toward the bound");
  }
  anonymousIndex.dispose();
});

test("cross-note owner collisions are explicit and cannot silently merge Actual", async () => {
  const first = plan(taskWithClock({
    ownerId: OWNER_A,
    clock: formatCanonicalClosedClock(DAY_START, 0, DAY_START + MINUTE, 0, CLOCK_A),
  }));
  const second = plan(taskWithClock({
    ownerId: OWNER_A,
    clock: formatCanonicalClosedClock(DAY_START + MINUTE, 0, DAY_START + 2 * MINUTE, 0, CLOCK_B),
  }));
  const index = new HistoryIndex(new MemoryTextAccess({
    "2026-08-29.md": first,
    "2026-08-30.md": second,
  }));
  const snapshot = await index.rebuild({ configuration: CONFIGURATION });
  assert.equal(snapshot.state, "current");
  if (snapshot.state === "current") {
    assert.equal(snapshot.diagnostics.filter((diagnostic) => diagnostic.code === "duplicate-owner-id").length, 2);
  }
  index.dispose();

  const ordinaryCollisionAccess = new MemoryTextAccess({
    "2026-08-29.md": first,
    "ordinary.md": `Ordinary block ^${OWNER_A}\n`,
  });
  const ordinaryCollisionIndex = new HistoryIndex(ordinaryCollisionAccess);
  const ordinaryCollision = await ordinaryCollisionIndex.rebuild({ configuration: CONFIGURATION });
  assert.equal(ordinaryCollision.state, "current");
  if (ordinaryCollision.state === "current") {
    assert.equal(
      ordinaryCollision.diagnostics.filter((diagnostic) => diagnostic.code === "duplicate-owner-id").length,
      1,
      "a non-Plan block ID collision still invalidates the task owner",
    );
  }
  ordinaryCollisionIndex.dispose();
});

test("supported history limits fail closed with no partial task totals", async () => {
  const oneClock = plan(taskWithClock({
    ownerId: OWNER_A,
    clock: formatCanonicalClosedClock(DAY_START, 0, DAY_START + MINUTE, 0, CLOCK_A),
  }));
  const cases = [
    { name: "markdown-files", limits: { maxMarkdownFiles: 0 } },
    { name: "markdown-bytes", limits: { maxMarkdownBytes: 1 } },
    { name: "daily-notes", limits: { maxDailyNotes: 0 } },
    { name: "clock-records", limits: { maxClockRecords: 0 } },
    { name: "active-note-bytes", limits: { maxActiveNoteBytes: 1 } },
  ] as const;
  for (const { name, limits } of cases) {
    const index = new HistoryIndex(new MemoryTextAccess({ "2026-08-29.md": oneClock }), { limits });
    const snapshot = await index.rebuild({ configuration: CONFIGURATION });
    assert.equal(snapshot.state, "over-limit", name);
    if (snapshot.state === "over-limit") assert.equal(snapshot.kind, name, name);
    assert.equal("tasks" in snapshot, false, `${name} exposes no partial tasks`);
    index.dispose();
  }

  const twoTasks = plan(
    `- [ ] First ^${OWNER_A}`,
    `- [ ] Second ^${OWNER_B}`,
  );
  const itemIndex = new HistoryIndex(new MemoryTextAccess({ "2026-08-29.md": twoTasks }), {
    limits: { maxPlanItems: 1 },
  });
  const itemSnapshot = await itemIndex.rebuild({ configuration: CONFIGURATION });
  assert.equal(itemSnapshot.state, "over-limit");
  if (itemSnapshot.state === "over-limit") assert.equal(itemSnapshot.kind, "plan-items");
  itemIndex.dispose();

  const exactClockIndex = new HistoryIndex(new MemoryTextAccess({ "2026-08-29.md": oneClock }), {
    limits: { maxClockRecords: 1 },
  });
  const exactClockSnapshot = await exactClockIndex.rebuild({ configuration: CONFIGURATION });
  assert.equal(exactClockSnapshot.state, "current", "the exact CLOCK boundary remains supported");
  exactClockIndex.dispose();
});

test("the supported default boundary accepts exactly 25,000 CLOCK records", async () => {
  const files: Record<string, string> = {};
  let clockNumber = 0;
  let ownerNumber = 0;
  for (const date of ["2026-08-27", "2026-08-28", "2026-08-29", "2026-08-30", "2026-08-31"]) {
    const tasks: string[] = [];
    for (let item = 0; item < 800; item += 1) {
      const clocksForTask = ownerNumber < 1_000 ? 7 : 6;
      const rows = [
        `- [x] Boundary ${String(ownerNumber)} 30m ^${deterministicId("nl-", ownerNumber)}`,
        "  - LOGBOOK::",
      ];
      for (let clock = 0; clock < clocksForTask; clock += 1) {
        rows.push(`    - ${formatCanonicalClosedClock(
          DAY_START,
          0,
          DAY_START + MINUTE,
          0,
          deterministicId("nl-clock-", clockNumber),
        )}`);
        clockNumber += 1;
      }
      tasks.push(rows.join("\n"));
      ownerNumber += 1;
    }
    files[`${date}.md`] = plan(...tasks);
  }
  assert.equal(clockNumber, 25_000);
  const index = new HistoryIndex(new MemoryTextAccess(files));
  const snapshot = await index.rebuild({ configuration: CONFIGURATION });
  assert.equal(snapshot.state, "current");
  if (snapshot.state === "current") {
    assert.equal(snapshot.counts.clockRecords, DEFAULT_HISTORY_INDEX_LIMITS.maxClockRecords);
    assert.equal(snapshot.counts.tasks, 4_000);
  }
  index.dispose();
});

class FailingAccess implements TextAccess {
  async listMarkdownPaths(): Promise<readonly string[]> {
    return ["2026-08-29.md"];
  }

  async readText(): Promise<string> {
    throw new Error("read failed");
  }

  onChange(): () => void {
    return () => {};
  }
}

test("invalid configuration, cancellation, and source failures expose no partial history", async () => {
  const invalidIndex = new HistoryIndex(new MemoryTextAccess());
  const invalid = await invalidIndex.rebuild({
    configuration: { folder: "", format: "" },
  });
  assert.equal(invalid.state, "unavailable");
  if (invalid.state === "unavailable") assert.equal(invalid.reason, "invalid-configuration");
  assert.equal("tasks" in invalid, false);
  invalidIndex.dispose();

  const controller = new AbortController();
  controller.abort();
  const cancelledIndex = new HistoryIndex(new MemoryTextAccess({
    "2026-08-29.md": plan(`- [ ] A ^${OWNER_A}`),
  }));
  const cancelled = await cancelledIndex.rebuild({
    configuration: CONFIGURATION,
    signal: controller.signal,
  });
  assert.equal(cancelled.state, "unavailable");
  if (cancelled.state === "unavailable") assert.equal(cancelled.reason, "cancelled");
  assert.equal("tasks" in cancelled, false);
  cancelledIndex.dispose();

  const failedIndex = new HistoryIndex(new FailingAccess());
  const failed = await failedIndex.rebuild({ configuration: CONFIGURATION });
  assert.equal(failed.state, "unavailable");
  if (failed.state === "unavailable") assert.equal(failed.reason, "source-read-failed");
  assert.equal("tasks" in failed, false);
  failedIndex.dispose();
});

class YieldScheduler implements HistoryIndexScheduler {
  current = 0;
  yields = 0;

  now(): number {
    this.current += 20;
    return this.current;
  }

  async yield(): Promise<void> {
    this.yields += 1;
  }
}

test("the index yields within the configured 50 ms ceiling and becomes dirty on source change", async () => {
  const access = new MemoryTextAccess({
    "2026-08-29.md": plan(`- [ ] A ^${OWNER_A}`),
    "2026-08-30.md": plan(`- [ ] B ^${OWNER_B}`),
  });
  const scheduler = new YieldScheduler();
  const index = new HistoryIndex(access, { scheduler, maximumContinuousMilliseconds: 40 });
  const snapshot = await index.rebuild({ configuration: CONFIGURATION });
  assert.equal(snapshot.state, "current");
  assert.ok(scheduler.yields > 0);
  access.modify("2026-08-29.md", plan(`- [ ] Updated ^${OWNER_A}`));
  assert.equal(index.snapshot.state, "dirty");
  assert.equal("tasks" in index.snapshot, false, "dirty state never serves stale partial totals");
  index.dispose();
  assert.equal(index.snapshot.state, "absent");
});

class LastInputWinsAccess implements TextAccess {
  readonly #listeners = new Set<SourceChangeListener>();
  readonly entered: Promise<void>;
  #enter!: () => void;
  #release!: () => void;
  #reads = 0;

  constructor() {
    this.entered = new Promise((resolve) => { this.#enter = resolve; });
  }

  async listMarkdownPaths(): Promise<readonly string[]> {
    return ["2026-08-29.md"];
  }

  async readText(): Promise<string> {
    this.#reads += 1;
    if (this.#reads === 1) {
      this.#enter();
      await new Promise<void>((resolve) => { this.#release = resolve; });
      return plan(`- [ ] Stale ^${OWNER_A}`);
    }
    return plan(`- [ ] Latest ^${OWNER_B}`);
  }

  onChange(listener: SourceChangeListener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  release(): void {
    this.#release();
  }
}

test("concurrent rebuilds publish last input only", async () => {
  const access = new LastInputWinsAccess();
  const index = new HistoryIndex(access);
  const stale = index.rebuild({ configuration: CONFIGURATION });
  await access.entered;
  assert.equal(index.snapshot.generation, 1);
  const latest = await index.rebuild({ configuration: CONFIGURATION });
  assert.equal(latest.state, "current");
  assert.equal(latest.generation, 2, "each rebuild receives a distinct generation");
  if (latest.state === "current") assert.equal(latest.tasks[0]?.label, "Latest");
  access.release();
  await stale;
  assert.equal(index.snapshot.state, "current");
  if (index.snapshot.state === "current") assert.equal(index.snapshot.tasks[0]?.label, "Latest");
  index.dispose();
});

test("Review coordinator combines closed history with the complete confirmed running set", async () => {
  const source = plan(
    taskWithClock({
      ownerId: OWNER_A,
      label: "Live",
      clock: formatCanonicalRunningClock(DAY_START + 30 * MINUTE, 0, CLOCK_A),
    }),
    taskWithClock({
      ownerId: OWNER_B,
      label: "Done",
      done: true,
      anchor: "d12:00",
      clock: formatCanonicalClosedClock(DAY_START + 60 * MINUTE, 0, DAY_START + 90 * MINUTE, 0, CLOCK_B),
    }),
  );
  const index = new HistoryIndex(new MemoryTextAccess({ "2026-08-29.md": source }));
  const coordinator = new ReviewCoordinator(index);
  const observed: string[] = [];
  const unsubscribe = coordinator.subscribe((snapshot) => observed.push(snapshot.state));
  const result = await coordinator.refresh({
    logicalDate: { year: 2026, month: 8, day: 29 },
    configuration: CONFIGURATION,
    day: {
      date: { year: 2026, month: 8, day: 29 },
      timeZone: "UTC",
      startEpochMilliseconds: DAY_START,
      endEpochMilliseconds: DAY_START + 24 * 60 * MINUTE,
    },
    nowEpochMilliseconds: DAY_START + 2 * 60 * MINUTE,
    resolveMinuteEpoch: (_date, minute) => DAY_START + minute * MINUTE,
    confirmedExecutionClocks: [{
      state: "running",
      ownerId: OWNER_A,
      startEpochMilliseconds: DAY_START + 60 * MINUTE,
      clockId: CLOCK_A,
    }],
    hourBoundariesEpochMilliseconds: [DAY_START + 60 * MINUTE, DAY_START + 120 * MINUTE],
  });
  assert.equal(result.state, "ready");
  if (result.state === "ready") {
    assert.deepEqual(result.projection.rows.map((row) => row.state), ["live", "compared"]);
    assert.equal(result.projection.rows[0]?.actualMinutes, 60, "confirmed CLOCK replaces stale indexed start");
    assert.equal(result.completedHistory[0]?.source, "actual");
    assert.equal(result.completedHistory[0]?.durationMinutes, 30);
    assert.deepEqual(result.historyDiagnostics, []);
  }
  assert.deepEqual(observed, ["absent", "building", "ready"]);
  const changed = `${source}\nexternal edit\n`;
  const access = new MemoryTextAccess({ "2026-08-29.md": source });
  const invalidatedIndex = new HistoryIndex(access);
  const invalidatedCoordinator = new ReviewCoordinator(invalidatedIndex);
  await invalidatedCoordinator.refresh({
    logicalDate: { year: 2026, month: 8, day: 29 },
    configuration: CONFIGURATION,
    day: {
      date: { year: 2026, month: 8, day: 29 },
      timeZone: "UTC",
      startEpochMilliseconds: DAY_START,
      endEpochMilliseconds: DAY_START + 24 * 60 * MINUTE,
    },
    nowEpochMilliseconds: DAY_START + 2 * 60 * MINUTE,
    resolveMinuteEpoch: (_date, minute) => DAY_START + minute * MINUTE,
  });
  access.modify("2026-08-29.md", changed);
  assert.equal(invalidatedCoordinator.snapshot.state, "unavailable");
  if (invalidatedCoordinator.snapshot.state === "unavailable") {
    assert.equal(invalidatedCoordinator.snapshot.reason, "history-dirty");
  }
  invalidatedCoordinator.dispose();
  unsubscribe();
  coordinator.dispose();
  assert.equal(coordinator.snapshot.state, "absent");
});

test("invalid Daily Note configuration and over-limit history stay unavailable to Review only", async () => {
  const index = new HistoryIndex(new MemoryTextAccess({ "2026-08-29.md": plan(`- [ ] A ^${OWNER_A}`) }), {
    limits: { maxDailyNotes: 0 },
  });
  const coordinator = new ReviewCoordinator(index);
  const result = await coordinator.refresh({
    logicalDate: { year: 2026, month: 8, day: 29 },
    configuration: CONFIGURATION,
    day: {
      date: { year: 2026, month: 8, day: 29 },
      timeZone: "UTC",
      startEpochMilliseconds: DAY_START,
      endEpochMilliseconds: DAY_START + 24 * 60 * MINUTE,
    },
    nowEpochMilliseconds: DAY_START,
    resolveMinuteEpoch: () => undefined,
  });
  assert.equal(result.state, "unavailable");
  if (result.state === "unavailable") assert.equal(result.reason, "history-over-limit");
  coordinator.dispose();
});

test("Review coordinator fails closed for invalid local-day bounds", async () => {
  const index = new HistoryIndex(new MemoryTextAccess({
    "2026-08-29.md": plan(`- [ ] A ^${OWNER_A}`),
  }));
  const coordinator = new ReviewCoordinator(index);
  const result = await coordinator.refresh({
    logicalDate: { year: 2026, month: 8, day: 29 },
    configuration: CONFIGURATION,
    day: {
      date: { year: 2026, month: 8, day: 29 },
      timeZone: "UTC",
      startEpochMilliseconds: DAY_START,
      endEpochMilliseconds: DAY_START,
    },
    nowEpochMilliseconds: DAY_START,
    resolveMinuteEpoch: () => undefined,
  });
  assert.equal(result.state, "unavailable");
  if (result.state === "unavailable") assert.equal(result.reason, "invalid-day");
  coordinator.dispose();
});
