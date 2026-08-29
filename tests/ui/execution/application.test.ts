import assert from "node:assert/strict";
import test from "node:test";

import {
  ExecutionApplication,
  type ExecutionTargetReference,
} from "../../../src/runtime/execution/application";
import {
  DEFAULT_PLUGIN_DATA,
  DEFAULT_PLUGIN_SETTINGS,
  InMemoryPluginDataPort,
  PluginDataStore,
} from "../../../src/runtime/plugin-data";
import { ManualSystemClock } from "../../../src/runtime/system-clock";
import { createSourceVersion } from "../../../src/workspace/source-version";
import { MemoryAtomicTextAccess } from "../../workspace/write/adapters";

const PATH = "Daily/2026-08-29.md";
const OPEN = "<!-- nautilus-log:plan/v1 -->";
const CLOSE = "<!-- /nautilus-log:plan -->";
const PLAN_A = "nl-11111111-1111-4111-8111-111111111111";
const PLAN_B = "nl-22222222-2222-4222-8222-222222222222";
const NOW = Date.UTC(2026, 7, 29, 1, 30, 0, 0);

function enabledPluginData(): PluginDataStore {
  return new PluginDataStore(new InMemoryPluginDataPort({
    ...DEFAULT_PLUGIN_DATA,
    settings: { ...DEFAULT_PLUGIN_SETTINGS, executionEnabled: true },
  }));
}

async function reference(
  source: string,
  ownerId: string | null,
  sourceOrder: number,
): Promise<ExecutionTargetReference> {
  const version = await createSourceVersion(PATH, source);
  return Object.freeze({
    path: PATH,
    ownerId,
    sourceOrder,
    sourceFingerprint: version.contentDigest,
  });
}

function source(lines: readonly string[]): string {
  return `${OPEN}\n${lines.join("\n")}\n${CLOSE}\n`;
}

class StartupRaceAccess extends MemoryAtomicTextAccess {
  #remainingSourceChanges: number;

  constructor(files: Record<string, string>, sourceChanges = 1) {
    super(files);
    this.#remainingSourceChanges = sourceChanges;
  }

  override async readText(path: string, signal?: AbortSignal): Promise<string | undefined> {
    const text = await super.readText(path, signal);
    if (this.#remainingSourceChanges > 0) {
      this.#remainingSourceChanges -= 1;
      this.notifyCacheChange(path);
    }
    return text;
  }
}

class CountingAtomicTextAccess extends MemoryAtomicTextAccess {
  reads = 0;

  override async readText(path: string, signal?: AbortSignal): Promise<string | undefined> {
    this.reads += 1;
    return super.readText(path, signal);
  }
}

test("startup re-scans once after a transient source change and restores the running CLOCK", async () => {
  const start = "[2026-08-29 Sat 09:30:00.000 +08:00]";
  const initial = source([
    `- [ ] Alpha 30m ^${PLAN_A}`,
    "  - LOGBOOK::",
    `    - CLOCK: ${start} ^nl-clock-11111111-1111-4111-8111-111111111111`,
  ]);
  const access = new StartupRaceAccess({ [PATH]: initial });
  const pluginData = enabledPluginData();
  const application = new ExecutionApplication({
    access,
    pluginData,
    clock: new ManualSystemClock(NOW, "Asia/Shanghai", 5_000),
  });

  const started = await application.start();
  assert.equal(started.status, "ready");
  assert.equal(started.execution.kind, "active");
  assert.equal(started.focused?.ownerId, PLAN_A);
  assert.equal(access.transactionCounts.get(PATH), undefined);

  await application.stop();
  await pluginData.stop();
});

test("refresh performs at most one extra read-only scan after consecutive host cache races", async () => {
  const start = "[2026-08-29 Sat 09:30:00.000 +08:00]";
  const initial = source([
    `- [ ] Alpha 30m ^${PLAN_A}`,
    "  - LOGBOOK::",
    `    - CLOCK: ${start} ^nl-clock-11111111-1111-4111-8111-111111111111`,
  ]);
  const access = new StartupRaceAccess({ [PATH]: initial }, 2);
  const pluginData = enabledPluginData();
  const application = new ExecutionApplication({
    access,
    pluginData,
    clock: new ManualSystemClock(NOW, "Asia/Shanghai", 7_500),
  });

  const started = await application.start();
  assert.equal(started.status, "ready");
  assert.equal(started.execution.kind, "active");
  assert.equal(started.focused?.ownerId, PLAN_A);
  assert.equal(access.transactionCounts.get(PATH), undefined);

  await application.stop();
  await pluginData.stop();
});

test("resume starts a fresh scan when suspend invalidates an in-flight refresh", async () => {
  const initial = source([`- [ ] Alpha 30m ^${PLAN_A}`]);
  const active = source([
    `- [ ] Alpha 30m ^${PLAN_A}`,
    "  - LOGBOOK::",
    "    - CLOCK: [2026-08-29 Sat 09:30:00.000 +08:00] ^nl-clock-11111111-1111-4111-8111-111111111111",
  ]);
  const access = new MemoryAtomicTextAccess({ [PATH]: initial });
  const pluginData = enabledPluginData();
  const application = new ExecutionApplication({
    access,
    pluginData,
    clock: new ManualSystemClock(NOW, "Asia/Shanghai", 8_000),
  });
  await application.start();

  const gate = access.pauseAfterReads(PATH, 1);
  const refreshing = application.refresh();
  await gate.entered;
  application.suspend();
  access.modify(PATH, active);
  const resuming = application.resume();
  gate.release();

  await refreshing;
  const resumed = await resuming;
  assert.equal(resumed.status, "ready");
  assert.equal(resumed.execution.kind, "active");
  assert.equal(resumed.focused?.ownerId, PLAN_A);
  assert.equal(access.transactionCounts.get(PATH), undefined);

  await application.stop();
  await pluginData.stop();
});

test("dispatch waits for an in-flight read-only refresh before rebuilding the execution index", async () => {
  const initial = source([`- [ ] Alpha 30m ^${PLAN_A}`]);
  const access = new CountingAtomicTextAccess({ [PATH]: initial });
  const pluginData = enabledPluginData();
  const application = new ExecutionApplication({
    access,
    pluginData,
    clock: new ManualSystemClock(NOW, "Asia/Shanghai", 9_000),
  });
  await application.start();
  const alpha = await reference(initial, PLAN_A, 0);

  const gate = access.pauseAfterReads(PATH, 1);
  const refreshing = application.refresh();
  await gate.entered;
  const readsAtGate = access.reads;
  const dispatching = application.dispatch({ type: "clock-in", intentId: "clock-in-after-refresh", target: alpha });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(access.reads, readsAtGate);
  assert.equal(access.transactionCounts.get(PATH), undefined);
  gate.release();

  await refreshing;
  const outcome = await dispatching;
  assert.equal(outcome.outcome, "applied", JSON.stringify(outcome));
  assert.equal(application.snapshot.focused?.ownerId, PLAN_A);
  assert.equal(access.transactionCounts.get(PATH), 1);

  await application.stop();
  await pluginData.stop();
});

test("application serializes Clock In, switch, idempotent Clock In, and Clock Out against fresh Markdown", async () => {
  const initial = source([
    `- [ ] Alpha 30m ^${PLAN_A}`,
    `- [ ] Beta 30m ^${PLAN_B}`,
  ]);
  const access = new MemoryAtomicTextAccess({ [PATH]: initial });
  const pluginData = enabledPluginData();
  const clock = new ManualSystemClock(NOW, "Asia/Shanghai", 10_000);
  const application = new ExecutionApplication({ access, pluginData, clock });

  const started = await application.start();
  assert.equal(started.status, "ready");
  assert.equal(started.execution.kind, "idle");
  assert.equal(started.pomoThresholdMinutes, 45);

  const alpha = await reference(initial, PLAN_A, 0);
  const first = await application.dispatch({ type: "clock-in", intentId: "clock-in-alpha", target: alpha });
  assert.equal(first.outcome, "applied", JSON.stringify(first));
  assert.equal(application.snapshot.focused?.ownerId, PLAN_A);
  assert.equal(application.snapshot.execution.kind, "active");
  assert.equal(pluginData.data.taskPomoStartEpochMs, NOW);
  const afterFirst = await access.readText(PATH);
  assert.match(afterFirst!, /CLOCK: \[2026-08-29 Sat 09:30:00\.000 \+08:00\] \^nl-clock-/);
  assert.equal(access.transactionCounts.get(PATH), 1);

  const duplicate = await application.dispatch({
    type: "clock-in",
    intentId: "clock-in-alpha-again",
    target: alpha,
  });
  assert.equal(duplicate.outcome, "already-applied", JSON.stringify(duplicate));
  assert.equal(access.transactionCounts.get(PATH), 1);
  assert.equal(await access.readText(PATH), afterFirst);

  clock.advanceBy(10 * 60_000);
  const beta = await reference(initial, PLAN_B, 1);
  const switched = await application.dispatch({ type: "clock-in", intentId: "switch-beta", target: beta });
  assert.equal(switched.outcome, "applied", JSON.stringify(switched));
  assert.equal(application.snapshot.focused?.ownerId, PLAN_B);
  const afterSwitch = await access.readText(PATH);
  assert.equal((afterSwitch?.match(/CLOCK:/g) ?? []).length, 2);
  assert.equal((afterSwitch?.match(/--\[/g) ?? []).length, 1);
  assert.equal((afterSwitch?.match(/CLOCK: \[[^\n]+\] \^nl-clock-/g) ?? []).length, 1);

  clock.advanceBy(5 * 60_000);
  const stopped = await application.dispatch({ type: "clock-out", intentId: "clock-out-beta" });
  assert.equal(stopped.outcome, "applied", JSON.stringify(stopped));
  assert.equal(application.snapshot.execution.kind, "idle");
  assert.equal(application.snapshot.focused, undefined);
  assert.equal(pluginData.data.taskPomoStartEpochMs, null);
  assert.equal((await access.readText(PATH))?.match(/CLOCK: \[[^\n]+\] \^nl-clock-/g), null);

  await application.stop();
  await pluginData.stop();
  assert.equal(application.snapshot.status, "stopped");
});

test("complete and progress intents re-resolve identified tasks at queue head", async () => {
  const initial = source([
    `- [ ] Alpha d90% ^${PLAN_A}`,
    `- [ ] Beta d20% ^${PLAN_B}`,
  ]);
  const access = new MemoryAtomicTextAccess({ [PATH]: initial });
  const pluginData = enabledPluginData();
  const application = new ExecutionApplication({
    access,
    pluginData,
    clock: new ManualSystemClock(NOW, "Asia/Shanghai", 20_000),
  });
  await application.start();

  const alpha = await reference(initial, PLAN_A, 0);
  const progressed = await application.dispatch({
    type: "advance-or-reopen-progress",
    intentId: "finish-alpha-progress",
    target: alpha,
  });
  assert.equal(progressed.outcome, "applied", JSON.stringify(progressed));
  assert.match((await access.readText(PATH))!, /- \[x\] Alpha d9:30 \^nl-/);

  const reopened = await application.dispatch({
    type: "advance-or-reopen-progress",
    intentId: "reopen-alpha-progress",
    target: alpha,
  });
  assert.equal(reopened.outcome, "applied", JSON.stringify(reopened));
  assert.match((await access.readText(PATH))!, /- \[ \] Alpha d10% \^nl-/);

  const beta = await reference(initial, PLAN_B, 1);
  const completed = await application.dispatch({ type: "complete", intentId: "complete-beta", target: beta });
  assert.equal(completed.outcome, "applied", JSON.stringify(completed));
  assert.match((await access.readText(PATH))!, /- \[x\] Beta/);

  await application.stop();
  await pluginData.stop();
});

test("deleting the current CLOCK requires an exact double-activation fact", async () => {
  const initial = source([`- [ ] Alpha 30m ^${PLAN_A}`]);
  const access = new MemoryAtomicTextAccess({ [PATH]: initial });
  const pluginData = enabledPluginData();
  const clock = new ManualSystemClock(NOW, "Asia/Shanghai", 30_000);
  const application = new ExecutionApplication({ access, pluginData, clock });
  await application.start();
  const alpha = await reference(initial, PLAN_A, 0);
  await application.dispatch({ type: "clock-in", intentId: "clock-in-before-delete", target: alpha });
  const current = application.snapshot.focused?.clock;
  assert.ok(current);
  const beforeDelete = await access.readText(PATH);

  const unconfirmed = await application.dispatch({
    type: "delete-clock",
    intentId: "delete-unconfirmed",
    target: current,
  });
  assert.equal(unconfirmed.outcome, "rejected");
  assert.equal(await access.readText(PATH), beforeDelete);

  clock.advanceBy(750);
  const deleted = await application.dispatch({
    type: "delete-clock",
    intentId: "delete-confirmed",
    target: current,
    confirmation: {
      firstActivationEpochMs: NOW,
      secondActivationEpochMs: NOW + 750,
      firstTargetKey: current.targetKey,
      secondTargetKey: current.targetKey,
    },
  });
  assert.equal(deleted.outcome, "applied", JSON.stringify(deleted));
  assert.equal(application.snapshot.execution.kind, "idle");
  assert.doesNotMatch((await access.readText(PATH))!, /CLOCK:/);

  await application.stop();
  await pluginData.stop();
});

test("anonymous targets require the exact source fingerprint and never expose source text in snapshots", async () => {
  const initial = source(["- [ ] Anonymous 30m"]);
  const access = new MemoryAtomicTextAccess({ [PATH]: initial });
  const pluginData = enabledPluginData();
  const application = new ExecutionApplication({
    access,
    pluginData,
    clock: new ManualSystemClock(NOW, "UTC", 40_000),
  });
  const snapshots: unknown[] = [];
  application.subscribe((snapshot) => snapshots.push(snapshot));
  await application.start();
  const stale = await reference(initial, null, 0);

  const externallyChanged = initial.replace("Anonymous", "Externally changed");
  access.modify(PATH, externallyChanged);
  const rejected = await application.dispatch({
    type: "clock-in",
    intentId: "stale-anonymous-target",
    target: stale,
  });
  assert.equal(rejected.outcome, "rejected", JSON.stringify(rejected));
  assert.equal(access.transactionCounts.get(PATH), undefined);
  assert.equal(await access.readText(PATH), externallyChanged);
  assert.equal(JSON.stringify(snapshots).includes("Externally changed"), false);
  assert.equal(JSON.stringify(snapshots).includes(OPEN), false);

  await application.stop();
  await pluginData.stop();
});

test("TC-UP-CMD-02 editor position resolution is conditional and reuses queue-head target authority", async () => {
  const initial = source([
    `- [ ] Alpha 30m ^${PLAN_A}`,
    "- [x] Done 15m",
    "- Plain note",
  ]);
  const access = new MemoryAtomicTextAccess({ [PATH]: initial });
  const pluginData = enabledPluginData();
  const application = new ExecutionApplication({
    access,
    pluginData,
    clock: new ManualSystemClock(NOW, "UTC", 50_000),
  });
  await application.start();

  const alphaOffset = initial.indexOf("Alpha");
  const doneOffset = initial.indexOf("Done");
  const plainOffset = initial.indexOf("Plain");
  assert.equal(application.inspectEditorAction(PATH, initial, alphaOffset), "clock-in");
  assert.equal(application.inspectEditorAction(PATH, initial, doneOffset), undefined);
  assert.equal(application.inspectEditorAction(PATH, initial, plainOffset), undefined);
  assert.equal(await application.resolveEditorAction("", initial, alphaOffset), undefined);
  assert.equal(await application.resolveEditorAction(PATH, initial, -1), undefined);
  const action = await application.resolveEditorAction(PATH, initial, alphaOffset);
  assert.equal(action?.kind, "clock-in");
  assert.ok(action);
  await application.dispatch({ type: "clock-in", intentId: "editor-clock-in", target: action.target });
  const current = await access.readText(PATH);
  assert.equal(application.inspectEditorAction(PATH, current!, current!.indexOf("Alpha")), "clock-out");

  await application.stop();
  await pluginData.stop();
});

test("UP-SET-08/09 suspend removes source work without stopping shared settings and can resume", async () => {
  const initial = source([`- [ ] Alpha 30m ^${PLAN_A}`]);
  const access = new MemoryAtomicTextAccess({ [PATH]: initial });
  const pluginData = enabledPluginData();
  const application = new ExecutionApplication({
    access,
    pluginData,
    clock: new ManualSystemClock(NOW, "UTC", 60_000),
  });
  await application.start();

  const disabled = await application.dispatch({ type: "disable-execution", intentId: "disable" });
  assert.equal(disabled.outcome, "applied");
  application.suspend();
  access.modify(PATH, initial.replace("Alpha", "Changed while disabled"));
  assert.notEqual(application.snapshot.status, "stale");
  await pluginData.update((current) => ({
    ...current,
    settings: { ...current.settings, chartStartHour: 6 },
  }));

  await application.resume();
  const enabled = await application.dispatch({ type: "enable-execution", intentId: "enable-again" });
  assert.equal(enabled.outcome, "applied");
  assert.equal(pluginData.data.settings.executionEnabled, true);
  assert.equal(pluginData.data.settings.chartStartHour, 6);

  await application.stop();
  await pluginData.stop();
});
