import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_PLUGIN_DATA,
  DEFAULT_PLUGIN_SETTINGS,
  InMemoryPluginDataPort,
  PLUGIN_DATA_SCHEMA_VERSION,
  PluginDataReadbackError,
  PluginDataStoppedError,
  PluginDataStore,
  type PluginDataDocument,
  type PluginDataPort,
  type PluginSettings,
  validatePluginData,
} from "../../../src/runtime/plugin-data.ts";

function pluginData(
  settings: Partial<PluginSettings> = {},
  data: Partial<Omit<PluginDataDocument, "settings" | "schemaVersion">> = {},
): PluginDataDocument {
  return {
    schemaVersion: PLUGIN_DATA_SCHEMA_VERSION,
    settings: { ...DEFAULT_PLUGIN_SETTINGS, ...settings },
    taskPomoStartEpochMs: data.taskPomoStartEpochMs ?? null,
    standalonePomoStartEpochMs: data.standalonePomoStartEpochMs ?? null,
  };
}

function nextTurn(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

test("issue 21 plugin-data defaults and validated results are deeply immutable", () => {
  const fresh = validatePluginData(undefined);

  assert.strictEqual(fresh.data, DEFAULT_PLUGIN_DATA);
  assert.strictEqual(fresh.data.settings, DEFAULT_PLUGIN_SETTINGS);
  assert.deepEqual(fresh.diagnostics, []);
  assert.equal(Object.isFrozen(DEFAULT_PLUGIN_SETTINGS), true);
  assert.equal(Object.isFrozen(DEFAULT_PLUGIN_DATA), true);
  assert.equal(Object.isFrozen(fresh), true);
  assert.equal(Object.isFrozen(fresh.diagnostics), true);
});

test("issue 21 validation repairs fields independently and ignores unowned data", () => {
  const result = validatePluginData({
    schemaVersion: 1,
    settings: {
      ...DEFAULT_PLUGIN_SETTINGS,
      language: "zh",
      chartStartHour: 4,
      urgentTrigger: " N\tO\nW ",
      recentRetentionMinutes: -1,
      dailyNoteFolder: "Journal\\Daily//",
      dailyNoteFormat: "YYYY/MM/DD",
      projectionCache: { source: "must not survive" },
    },
    taskPomoStartEpochMs: 1_777_777_777_777,
    standalonePomoStartEpochMs: Number.MAX_SAFE_INTEGER,
    activeTask: { id: "must not survive" },
  });

  assert.equal(result.data.settings.language, "zh");
  assert.equal(result.data.settings.chartStartHour, 5);
  assert.equal(result.data.settings.urgentTrigger, "NOW");
  assert.equal(result.data.settings.recentRetentionMinutes, 45);
  assert.equal(result.data.settings.dailyNoteFolder, "Journal/Daily");
  assert.equal(result.data.settings.dailyNoteFormat, "YYYY/MM/DD");
  assert.equal(result.data.taskPomoStartEpochMs, 1_777_777_777_777);
  assert.equal(result.data.standalonePomoStartEpochMs, null);
  assert.deepEqual(Object.keys(result.data).sort(), [
    "schemaVersion",
    "settings",
    "standalonePomoStartEpochMs",
    "taskPomoStartEpochMs",
  ]);
  assert.equal("projectionCache" in result.data.settings, false);
  assert.equal("activeTask" in result.data, false);
  assert.deepEqual(
    result.diagnostics.map(({ code, path, reason }) => [code, path, reason]),
    [
      ["field-ignored", "activeTask", "unknown"],
      ["field-ignored", "settings.projectionCache", "unknown"],
      ["field-repaired", "settings.dailyNoteFolder", "normalized"],
      ["field-repaired", "settings.urgentTrigger", "normalized"],
      ["field-repaired", "settings.chartStartHour", "invalid"],
      ["field-repaired", "settings.recentRetentionMinutes", "invalid"],
      ["field-repaired", "standalonePomoStartEpochMs", "invalid"],
    ],
  );
  assert.equal(Object.isFrozen(result.data), true);
  assert.equal(Object.isFrozen(result.data.settings), true);
  assert.equal(result.diagnostics.every(Object.isFrozen), true);
});

test("issue 21 rejects unsupported versions instead of interpreting future data", () => {
  const result = validatePluginData({
    schemaVersion: 2,
    settings: { ...DEFAULT_PLUGIN_SETTINGS, language: "zh" },
    taskPomoStartEpochMs: 100,
    standalonePomoStartEpochMs: 200,
    futureState: true,
  });

  assert.strictEqual(result.data, DEFAULT_PLUGIN_DATA);
  assert.deepEqual(result.diagnostics, [
    { code: "field-ignored", path: "futureState", reason: "unknown" },
    { code: "field-repaired", path: "schemaVersion", reason: "unsupported-schema" },
  ]);
});

test("issue 21 store publishes only confirmed saves and preserves concurrent updates", async () => {
  class RecordingPort extends InMemoryPluginDataPort {
    readonly saved: PluginDataDocument[] = [];
    activeSaves = 0;
    maximumActiveSaves = 0;

    override async save(data: PluginDataDocument): Promise<void> {
      this.activeSaves += 1;
      this.maximumActiveSaves = Math.max(this.maximumActiveSaves, this.activeSaves);
      this.saved.push(structuredClone(data));
      await nextTurn();
      await super.save(data);
      this.activeSaves -= 1;
    }
  }

  const port = new RecordingPort(pluginData());
  const store = new PluginDataStore(port);
  const loaded = await store.load();
  const first = store.update((current) => pluginData({
    ...current.settings,
    language: "zh",
  }, current));
  const second = store.update((current) => pluginData({
    ...current.settings,
    executionEnabled: true,
  }, current));

  assert.equal(store.revision, loaded.revision);
  assert.equal(store.data.settings.language, "en");
  const [firstResult, secondResult] = await Promise.all([first, second]);

  assert.equal(port.maximumActiveSaves, 1);
  assert.equal(port.saved.length, 2);
  assert.equal(port.saved[0]!.settings.language, "zh");
  assert.equal(port.saved[0]!.settings.executionEnabled, false);
  assert.equal(port.saved[1]!.settings.language, "zh");
  assert.equal(port.saved[1]!.settings.executionEnabled, true);
  assert.equal(firstResult.revision, 2);
  assert.equal(secondResult.revision, 3);
  assert.strictEqual(store.snapshot, secondResult);
  assert.equal(Object.isFrozen(secondResult), true);
});

test("issue 21 save rejection retains the confirmed revision and does not poison the tail", async () => {
  class RejectOncePort extends InMemoryPluginDataPort {
    rejectNext = true;

    override async save(data: PluginDataDocument): Promise<void> {
      if (this.rejectNext) {
        this.rejectNext = false;
        throw new Error("injected save rejection");
      }
      await super.save(data);
    }
  }

  const port = new RejectOncePort(pluginData());
  const store = new PluginDataStore(port);
  await store.load();
  const failed = store.update((current) => pluginData({
    ...current.settings,
    language: "zh",
  }, current));
  const succeeding = store.update((current) => pluginData({
    ...current.settings,
    executionEnabled: true,
  }, current));

  await assert.rejects(failed, /injected save rejection/);
  const result = await succeeding;

  assert.equal(result.revision, 2);
  assert.equal(result.data.settings.language, "en");
  assert.equal(result.data.settings.executionEnabled, true);
  assert.equal(port.saveCount, 1);
});

test("issue 21 read-back mismatch is a failed save and cannot publish", async () => {
  class NonDurablePort implements PluginDataPort {
    readonly value = pluginData();

    async load(): Promise<unknown> {
      return structuredClone(this.value);
    }

    async save(_data: PluginDataDocument): Promise<void> {}
  }

  const store = new PluginDataStore(new NonDurablePort());
  const loaded = await store.load();

  await assert.rejects(
    store.update((current) => pluginData({ ...current.settings, language: "zh" }, current)),
    PluginDataReadbackError,
  );
  assert.strictEqual(store.snapshot, loaded);
  assert.equal(store.data.settings.language, "en");
});

test("OBS-LIFE-001 stop rejects new saves, drains admitted work, and is idempotent", async () => {
  let releaseSave: (() => void) | undefined;
  let reportSaveStarted: (() => void) | undefined;
  const saveStarted = new Promise<void>((resolve) => {
    reportSaveStarted = resolve;
  });
  const saveGate = new Promise<void>((resolve) => {
    releaseSave = resolve;
  });

  class BlockingPort extends InMemoryPluginDataPort {
    override async save(data: PluginDataDocument): Promise<void> {
      reportSaveStarted?.();
      await saveGate;
      await super.save(data);
    }
  }

  const port = new BlockingPort(pluginData());
  const store = new PluginDataStore(port);
  await store.load();
  const loaded = store.snapshot;
  const admitted = store.update((current) => pluginData({
    ...current.settings,
    language: "zh",
  }, current));
  await saveStarted;

  let stopSettled = false;
  const stopping = store.stop();
  void stopping.then(() => {
    stopSettled = true;
  });
  assert.strictEqual(store.stop(), stopping);
  await assert.rejects(
    store.update((current) => current),
    PluginDataStoppedError,
  );
  await assert.rejects(store.load(), PluginDataStoppedError);
  await nextTurn();
  assert.equal(stopSettled, false);

  releaseSave?.();
  await assert.rejects(admitted, PluginDataStoppedError);
  await stopping;
  assert.strictEqual(store.snapshot, loaded);
  const durable = validatePluginData(await port.load());
  assert.equal(durable.data.settings.language, "zh");
  assert.equal(stopSettled, true);
});
