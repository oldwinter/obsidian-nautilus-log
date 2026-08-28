import assert from "node:assert/strict";
import test from "node:test";

import {
  InMemoryPluginDataPort,
  PluginDataStore,
} from "../../../src/runtime/plugin-data.ts";
import {
  NautilusProjectionRuntime,
  type RuntimeConnection,
  type RuntimePlanProjection,
} from "../../../src/runtime/projection-runtime.ts";
import type { RuntimeSnapshot } from "../../../src/runtime/snapshots.ts";
import { ManualSystemClock } from "../../../src/runtime/system-clock.ts";
import type {
  SourceChange,
  SourceChangeListener,
  TextAccess,
} from "../../../src/workspace/text-access.ts";

const OPEN = "<!-- nautilus-log:plan/v1 -->";
const CLOSE = "<!-- /nautilus-log:plan -->";
const DAY_28 = Object.freeze({ year: 2026, month: 8, day: 28 });
const DAY_29 = Object.freeze({ year: 2026, month: 8, day: 29 });

function plan(...rows: string[]): string {
  return `${OPEN}\n${rows.join("\n")}\n${CLOSE}`;
}

interface PendingRead {
  readonly content: string | undefined;
  readonly resolve: (content: string | undefined) => void;
}

class InstrumentedTextAccess implements TextAccess {
  readonly files = new Map<string, string>();
  readonly listeners = new Set<SourceChangeListener>();
  readonly pendingReads: PendingRead[] = [];
  readCount = 0;
  writeCount = 0;
  blockReads = false;
  failReads = false;

  constructor(files: Readonly<Record<string, string>> = {}) {
    for (const [path, content] of Object.entries(files)) this.files.set(path, content);
  }

  async listMarkdownPaths(): Promise<readonly string[]> {
    return Object.freeze([...this.files.keys()].sort());
  }

  readText(path: string): Promise<string | undefined> {
    this.readCount += 1;
    if (this.failReads) return Promise.reject(new Error("read failed"));
    const content = this.files.get(path);
    if (!this.blockReads) return Promise.resolve(content);
    return new Promise((resolve) => this.pendingReads.push({ content, resolve }));
  }

  onChange(listener: SourceChangeListener): () => void {
    this.listeners.add(listener);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      this.listeners.delete(listener);
    };
  }

  emit(change: SourceChange): void {
    for (const listener of [...this.listeners]) listener(Object.freeze({ ...change }));
  }

  setEditorText(path: string, content: string): void {
    this.files.set(path, content);
    this.emit({ kind: "editor", path });
  }

  releaseNextRead(): void {
    const pending = this.pendingReads.shift();
    assert.ok(pending, "expected a pending read");
    pending.resolve(pending.content);
  }
}

interface RuntimeFixture {
  readonly runtime: NautilusProjectionRuntime;
  readonly clock: ManualSystemClock;
  readonly dataPort: InMemoryPluginDataPort;
}

async function runtimeFixture(
  access: InstrumentedTextAccess,
  epochMilliseconds = Date.parse("2026-08-28T08:00:00+08:00"),
): Promise<RuntimeFixture> {
  const clock = new ManualSystemClock(epochMilliseconds, "Asia/Shanghai");
  const dataPort = new InMemoryPluginDataPort();
  const runtime = new NautilusProjectionRuntime({
    access,
    pluginData: new PluginDataStore(dataPort),
    clock,
  });
  await runtime.start();
  return { runtime, clock, dataPort };
}

async function settle(): Promise<void> {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
}

async function waitFor(
  predicate: () => boolean,
  description: string,
): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (predicate()) return;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  assert.fail(`timed out waiting for ${description}`);
}

function confirmed(
  snapshots: readonly RuntimeSnapshot<RuntimePlanProjection>[],
): Extract<RuntimeSnapshot<RuntimePlanProjection>, { readonly state: "confirmed" }> | undefined {
  return snapshots.findLast((snapshot) => snapshot.state === "confirmed") as
    | Extract<RuntimeSnapshot<RuntimePlanProjection>, { readonly state: "confirmed" }>
    | undefined;
}

async function connectConfirmed(
  runtime: NautilusProjectionRuntime,
  context = { logicalDate: DAY_28 },
): Promise<{
  readonly connection: RuntimeConnection;
  readonly snapshots: RuntimeSnapshot<RuntimePlanProjection>[];
}> {
  const snapshots: RuntimeSnapshot<RuntimePlanProjection>[] = [];
  const connection = runtime.connect(context, (snapshot) => snapshots.push(snapshot));
  await waitFor(() => confirmed(snapshots) !== undefined, "confirmed projection");
  return { connection, snapshots };
}

test("TC-UP-EXE-01-001 projects only the first exact Primary Plan marker pair", async () => {
  const access = new InstrumentedTextAccess({
    "2026-08-28.md": `${plan("- [ ] First task 30m ^first")}\n${plan("- [ ] Later task 45m ^later")}`,
  });
  const { runtime, clock } = await runtimeFixture(access);
  const { connection, snapshots } = await connectConfirmed(runtime);
  const snapshot = confirmed(snapshots)!;

  assert.deepEqual(snapshot.projection.items.map(({ label }) => label), ["First task"]);
  assert.equal(snapshot.projection.diagnostics[0]?.code, "duplicate-plan-region");
  assert.equal(snapshot.mutationCapability, null);
  assert.equal(Object.isFrozen(snapshot), true);
  assert.equal(Object.isFrozen(snapshot.projection.items), true);
  assert.doesNotMatch(
    JSON.stringify(snapshot),
    /sourceText|firstLineText|itemSpan|segmentIndex|fromOffset|toOffset/,
  );

  connection.disconnect();
  await runtime.stop();
  assert.equal(access.listeners.size, 0);
  assert.equal(clock.pendingTimerCount(), 0);
  assert.equal(access.writeCount, 0);
});

test("TC-UP-EXE-01-002 four logical connections share one read and confirmed object", async () => {
  const access = new InstrumentedTextAccess({
    "2026-08-28.md": plan("- [ ] Shared 30m ^shared"),
  });
  const { runtime, clock } = await runtimeFixture(access);
  const received = Array.from({ length: 4 }, () => [] as RuntimeSnapshot<RuntimePlanProjection>[]);
  const connections = received.map((snapshots) => runtime.connect(
    { logicalDate: DAY_28 },
    (snapshot) => snapshots.push(snapshot),
  ));
  await waitFor(
    () => received.every((snapshots) => confirmed(snapshots) !== undefined),
    "four confirmed connections",
  );

  assert.equal(access.readCount, 1);
  const shared = confirmed(received[0]!)!;
  assert.ok(received.every((snapshots) => confirmed(snapshots) === shared));

  const callbackCounts = received.map(({ length }) => length);
  connections[0]!.disconnect();
  connections[1]!.disconnect();
  connections[2]!.disconnect();
  access.setEditorText("2026-08-28.md", plan("- [ ] Remaining listener 45m ^shared"));
  clock.advanceBy(150);
  await waitFor(
    () => confirmed(received[3]!)?.projection.items[0]?.label === "Remaining listener",
    "remaining connection refresh",
  );
  assert.deepEqual(received.slice(0, 3).map(({ length }) => length), callbackCounts.slice(0, 3));

  connections[3]!.disconnect();
  await runtime.stop();
  assert.equal(clock.pendingTimerCount(), 0);
});

test("TC-UP-EXE-01-004 late connections receive confirmed cache before refresh and source clear", async () => {
  const access = new InstrumentedTextAccess({
    "2026-08-28.md": plan("- [ ] Cached 30m ^cached"),
  });
  const { runtime, clock } = await runtimeFixture(access);
  const first = await connectConfirmed(runtime);
  const cached = confirmed(first.snapshots)!;
  first.connection.disconnect();

  const lateSnapshots: RuntimeSnapshot<RuntimePlanProjection>[] = [];
  const readsBeforeLateConnect = access.readCount;
  const late = runtime.connect(
    { logicalDate: DAY_28 },
    (snapshot) => lateSnapshots.push(snapshot),
  );
  assert.equal(lateSnapshots[0], cached);
  await waitFor(
    () => (confirmed(lateSnapshots)?.revision.generation ?? 0) > cached.revision.generation,
    "late connection refresh",
  );
  assert.equal(access.readCount, readsBeforeLateConnect + 1);
  late.disconnect();

  access.emit({ kind: "modify", path: "2026-08-28.md" });
  const afterClearSnapshots: RuntimeSnapshot<RuntimePlanProjection>[] = [];
  const afterClear = runtime.connect(
    { logicalDate: DAY_28 },
    (snapshot) => afterClearSnapshots.push(snapshot),
  );
  assert.equal(afterClearSnapshots[0]?.state, "loading");
  assert.notEqual(afterClearSnapshots[0], cached);
  await waitFor(() => confirmed(afterClearSnapshots) !== undefined, "post-clear refresh");
  afterClear.disconnect();

  clock.setTimeZone("UTC");
  const afterZoneSnapshots: RuntimeSnapshot<RuntimePlanProjection>[] = [];
  const afterZone = runtime.connect(
    { logicalDate: DAY_28 },
    (snapshot) => afterZoneSnapshots.push(snapshot),
  );
  assert.equal(afterZoneSnapshots[0]?.state, "loading");
  await waitFor(
    () => confirmed(afterZoneSnapshots)?.revision.timeZone === "UTC",
    "pre-timer timezone cache rejection",
  );

  afterZone.disconnect();
  await runtime.stop();
});

test("TC-UP-INS-04-001 editor text wins over a later MetadataCache hint", async () => {
  const access = new InstrumentedTextAccess({
    "2026-08-28.md": plan("- [ ] Saved text 15m ^task"),
  });
  const { runtime, clock } = await runtimeFixture(access);
  const { connection, snapshots } = await connectConfirmed(runtime);
  const initialGeneration = confirmed(snapshots)!.revision.generation;

  access.setEditorText("2026-08-28.md", plan("- [ ] Unsaved editor text 45m ^task"));
  clock.advanceBy(100);
  access.emit({ kind: "cache", path: "2026-08-28.md" });
  clock.advanceBy(149);
  assert.equal(confirmed(snapshots)!.revision.generation, initialGeneration);
  clock.advanceBy(1);
  await waitFor(
    () => confirmed(snapshots)?.projection.items[0]?.label === "Unsaved editor text",
    "editor-authoritative projection",
  );
  assert.equal(access.readCount, 2);

  connection.disconnect();
  await runtime.stop();
});

test("TC-UP-INS-04-002 a non-abortable old read cannot publish over its dirty follow-up", async () => {
  const access = new InstrumentedTextAccess({
    "2026-08-28.md": plan("- [ ] Old revision 15m ^task"),
  });
  access.blockReads = true;
  const { runtime, clock } = await runtimeFixture(access);
  const snapshots: RuntimeSnapshot<RuntimePlanProjection>[] = [];
  const connection = runtime.connect(
    { logicalDate: DAY_28 },
    (snapshot) => snapshots.push(snapshot),
  );
  assert.equal(access.pendingReads.length, 1);

  access.setEditorText("2026-08-28.md", plan("- [ ] New revision 60m ^task"));
  clock.advanceBy(150);
  const scheduledBeforeSettlement = clock.totalScheduledTimerCount;
  access.releaseNextRead();
  await waitFor(
    () => clock.totalScheduledTimerCount > scheduledBeforeSettlement,
    "dirty follow-up timer",
  );
  clock.advanceBy(0);
  await waitFor(() => access.pendingReads.length === 1, "dirty follow-up read");
  access.releaseNextRead();
  await waitFor(() => confirmed(snapshots) !== undefined, "newest revision");

  const labels = snapshots
    .filter((snapshot) => snapshot.state === "confirmed")
    .flatMap((snapshot) => snapshot.projection.items.map(({ label }) => label));
  assert.deepEqual(labels, ["New revision"]);
  assert.equal(access.readCount, 2);

  connection.disconnect();
  await runtime.stop();
});

test("TC-UP-INS-04-005 timed-out non-abortable reads fail closed and retry safely", async () => {
  const access = new InstrumentedTextAccess({
    "2026-08-28.md": plan("- [ ] Eventually fresh 20m ^task"),
  });
  access.blockReads = true;
  const { runtime, clock } = await runtimeFixture(access);
  const snapshots: RuntimeSnapshot<RuntimePlanProjection>[] = [];
  const connection = runtime.connect(
    { logicalDate: DAY_28 },
    (snapshot) => snapshots.push(snapshot),
  );
  assert.equal(access.pendingReads.length, 1);

  clock.advanceBy(1_000);
  assert.equal(snapshots.at(-1)?.state, "error");
  assert.equal(snapshots.at(-1)?.diagnostic?.code, "refresh-timeout");
  assert.equal(snapshots.at(-1)?.mutationCapability, null);
  assert.equal("projection" in snapshots.at(-1)!, false);

  connection.refresh();
  assert.equal(access.pendingReads.length, 2);
  access.releaseNextRead();
  await settle();
  assert.equal(confirmed(snapshots), undefined);
  access.releaseNextRead();
  await waitFor(() => confirmed(snapshots) !== undefined, "explicit timeout retry");

  connection.refresh();
  assert.equal(access.pendingReads.length, 1);
  clock.advanceBy(1_000);
  assert.equal(snapshots.at(-1)?.diagnostic?.code, "refresh-timeout");
  connection.disconnect();

  access.blockReads = false;
  const reconnectSnapshots: RuntimeSnapshot<RuntimePlanProjection>[] = [];
  const reconnect = runtime.connect(
    { logicalDate: DAY_28 },
    (snapshot) => reconnectSnapshots.push(snapshot),
  );
  assert.equal(reconnectSnapshots[0]?.state, "loading");
  await waitFor(() => confirmed(reconnectSnapshots) !== undefined, "post-timeout reconnect");
  access.releaseNextRead();
  await settle();
  assert.equal(reconnectSnapshots.filter(({ state }) => state === "confirmed").length, 1);

  reconnect.disconnect();
  await runtime.stop();
  assert.equal(clock.pendingTimerCount(), 0);
});

test("TC-UP-INS-04-003 hidden views stay dirty without reads and restore authoritatively", async () => {
  const access = new InstrumentedTextAccess({
    "2026-08-28.md": plan("- [ ] Visible 15m ^task"),
  });
  const start = Date.parse("2026-08-28T23:59:30+08:00");
  const { runtime, clock } = await runtimeFixture(access, start);
  const { connection, snapshots } = await connectConfirmed(runtime);
  const readsBeforeHide = access.readCount;
  connection.setVisible(false);
  access.setEditorText("2026-08-28.md", plan("- [ ] Changed while hidden 30m ^task"));
  clock.advanceBy(30_000);
  clock.setTimeZone("UTC");
  clock.advanceBy(60_000);
  assert.equal(access.readCount, readsBeforeHide);

  connection.setVisible(true);
  assert.notEqual(snapshots.at(-1)?.state, "confirmed");
  await waitFor(
    () => confirmed(snapshots)?.projection.items[0]?.label === "Changed while hidden",
    "visibility restoration refresh",
  );
  const restored = confirmed(snapshots)!;
  assert.equal(restored.projection.today.day, 28);
  assert.equal(restored.revision.timeZone, "UTC");
  assert.equal(access.readCount, readsBeforeHide + 1);

  connection.disconnect();
  await runtime.stop();
  assert.equal(clock.pendingTimerCount(), 0);
});

test("TC-UP-INS-04-004 minute, local-day, timezone, date switch, and settings save invalidate", async () => {
  const access = new InstrumentedTextAccess({
    "2026-08-28.md": plan("- [ ] Day 28 15m ^a"),
    "2026-08-29.md": plan("- [ ] Day 29 30m ^b"),
  });
  const start = Date.parse("2026-08-28T23:59:30+08:00");
  const { runtime, clock, dataPort } = await runtimeFixture(access, start);
  const { connection, snapshots } = await connectConfirmed(runtime);
  const initialReads = access.readCount;

  clock.advanceBy(30_000);
  await waitFor(
    () => confirmed(snapshots)?.projection.today.day === 29,
    "local-day rollover",
  );
  assert.equal(access.readCount, initialReads + 1);

  connection.setContext({ logicalDate: DAY_29 });
  await waitFor(
    () => confirmed(snapshots)?.projection.items[0]?.label === "Day 29",
    "logical date switch",
  );

  const beforeSettingsGeneration = confirmed(snapshots)!.revision.generation;
  await runtime.updateSettings({ chartStartHour: 6 });
  await waitFor(
    () => (confirmed(snapshots)?.revision.generation ?? 0) > beforeSettingsGeneration,
    "settings refresh",
  );
  assert.equal(dataPort.saveCount, 1);
  assert.equal(confirmed(snapshots)!.projection.schedule.cursorMinutes, 6 * 60);

  const beforeZoneGeneration = confirmed(snapshots)!.revision.generation;
  clock.setTimeZone("UTC");
  clock.advanceBy(60_000);
  await waitFor(
    () => (confirmed(snapshots)?.revision.generation ?? 0) > beforeZoneGeneration,
    "timezone refresh",
  );
  assert.equal(confirmed(snapshots)!.revision.timeZone, "UTC");

  connection.disconnect();
  await runtime.stop();
});

test("TC-UP-EXE-01-003 missing, over-limit, read error, and stale states fail closed", async () => {
  const missingAccess = new InstrumentedTextAccess();
  const missingFixture = await runtimeFixture(missingAccess);
  const missingSnapshots: RuntimeSnapshot<RuntimePlanProjection>[] = [];
  const missingConnection = missingFixture.runtime.connect(
    { logicalDate: DAY_28 },
    (snapshot) => missingSnapshots.push(snapshot),
  );
  await waitFor(() => missingSnapshots.at(-1)?.state === "missing", "missing snapshot");
  assert.ok(missingSnapshots.every(({ mutationCapability }) => mutationCapability === null));
  missingConnection.disconnect();
  await missingFixture.runtime.stop();

  const overLimitAccess = new InstrumentedTextAccess({
    "2026-08-28.md": "x".repeat(2 * 1024 * 1024 + 1),
  });
  const overLimitFixture = await runtimeFixture(overLimitAccess);
  const overLimitSnapshots: RuntimeSnapshot<RuntimePlanProjection>[] = [];
  const overLimitConnection = overLimitFixture.runtime.connect(
    { logicalDate: DAY_28 },
    (snapshot) => overLimitSnapshots.push(snapshot),
  );
  await waitFor(
    () => overLimitSnapshots.at(-1)?.state === "over-limit",
    "over-limit snapshot",
  );
  assert.equal(overLimitSnapshots.at(-1)?.mutationCapability, null);
  assert.equal("projection" in overLimitSnapshots.at(-1)!, false);
  if (overLimitSnapshots.at(-1)?.state === "over-limit") {
    assert.equal(overLimitSnapshots.at(-1)!.overLimit.kind, "active-note-bytes");
    assert.equal(overLimitSnapshots.at(-1)!.overLimit.limit, 2 * 1024 * 1024);
  }
  overLimitConnection.disconnect();
  await overLimitFixture.runtime.stop();

  const errorAccess = new InstrumentedTextAccess();
  errorAccess.failReads = true;
  const errorFixture = await runtimeFixture(errorAccess);
  const errorSnapshots: RuntimeSnapshot<RuntimePlanProjection>[] = [];
  const errorConnection = errorFixture.runtime.connect(
    { logicalDate: DAY_28 },
    (snapshot) => errorSnapshots.push(snapshot),
  );
  await waitFor(() => errorSnapshots.at(-1)?.state === "error", "initial read error");
  assert.equal(errorSnapshots.at(-1)?.diagnostic?.code, "source-read-failed");
  assert.equal(errorSnapshots.at(-1)?.mutationCapability, null);
  assert.equal("projection" in errorSnapshots.at(-1)!, false);
  errorConnection.disconnect();
  await errorFixture.runtime.stop();

  const access = new InstrumentedTextAccess({
    "2026-08-28.md": plan("- [ ] Confirmed 15m ^task"),
  });
  const { runtime, clock } = await runtimeFixture(access);
  const { connection, snapshots } = await connectConfirmed(runtime);
  access.failReads = true;
  access.emit({ kind: "modify", path: "2026-08-28.md" });
  clock.advanceBy(250);
  await waitFor(() => snapshots.at(-1)?.state === "stale", "stale read failure");
  assert.equal(snapshots.at(-1)?.mutationCapability, null);
  assert.equal("projection" in snapshots.at(-1)!, false);
  connection.disconnect();
  await runtime.stop();
});

test("TC-OBS-LIFE-001-005 stop cancels pending work and publishes nothing later", async () => {
  const access = new InstrumentedTextAccess({
    "2026-08-28.md": plan("- [ ] Late 15m ^task"),
  });
  access.blockReads = true;
  const { runtime, clock } = await runtimeFixture(access);
  const snapshots: RuntimeSnapshot<RuntimePlanProjection>[] = [];
  runtime.connect({ logicalDate: DAY_28 }, (snapshot) => snapshots.push(snapshot));
  assert.equal(access.pendingReads.length, 1);
  const beforeStop = snapshots.length;
  await runtime.stop();
  access.releaseNextRead();
  await settle();

  assert.equal(snapshots.length, beforeStop);
  assert.equal(access.listeners.size, 0);
  assert.equal(clock.pendingTimerCount(), 0);
  assert.equal(access.writeCount, 0);
});

test("TC-UP-INS-05-005 runs 100 connect-disconnect-refresh cycles without retained work", async () => {
  const access = new InstrumentedTextAccess({
    "2026-08-28.md": plan("- [ ] Cycle 15m ^task"),
  });
  const { runtime, clock, dataPort } = await runtimeFixture(access);

  for (let cycle = 0; cycle < 100; cycle += 1) {
    const { connection, snapshots } = await connectConfirmed(runtime);
    const generation = confirmed(snapshots)!.revision.generation;
    connection.refresh();
    await waitFor(
      () => (confirmed(snapshots)?.revision.generation ?? 0) > generation,
      `cycle ${cycle + 1} refresh`,
    );
    connection.disconnect();
    assert.equal(clock.pendingTimerCount(), 1);
    assert.equal(access.listeners.size, 1);
  }

  assert.equal(dataPort.saveCount, 0);
  assert.equal(access.writeCount, 0);
  await runtime.stop();
  assert.equal(clock.pendingTimerCount(), 0);
  assert.equal(access.listeners.size, 0);
});
