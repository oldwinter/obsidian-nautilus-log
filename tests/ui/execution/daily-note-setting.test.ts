import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { ignoredHostDailyNoteFormat, interpretDailyNoteSetting } from "../../../src/adapters/daily-note-setting";
import {
  acceptedDailyNoteFolder,
  acceptedDailyNoteFormat,
  DEFAULT_PLUGIN_DATA,
  DEFAULT_PLUGIN_SETTINGS,
  PLUGIN_DATA_SCHEMA_VERSION,
  validatePluginData,
  type PluginDataDocument,
  type PluginSettings,
} from "../../../src/runtime/plugin-data";
import { enExecution } from "../../../src/i18n/locales/en/execution";
import { zhCNExecution } from "../../../src/i18n/locales/zh-CN/execution";

function pluginData(settings: Partial<PluginSettings> = {}): PluginDataDocument {
  return {
    schemaVersion: PLUGIN_DATA_SCHEMA_VERSION,
    settings: { ...DEFAULT_PLUGIN_SETTINGS, ...settings },
    taskPomoStartEpochMs: null,
    standalonePomoStartEpochMs: null,
  };
}

test("accepted Daily Note folder and format keep valid edits and drop weekday tokens", () => {
  assert.equal(acceptedDailyNoteFolder(""), "");
  assert.equal(acceptedDailyNoteFolder("Journal\\Daily//"), "Journal/Daily");
  assert.equal(acceptedDailyNoteFolder("../outside"), undefined);
  assert.equal(acceptedDailyNoteFolder("/Daily"), undefined);
  assert.equal(acceptedDailyNoteFormat("YYYY/MM/DD"), "YYYY/MM/DD");
  assert.equal(acceptedDailyNoteFormat(" YYYY-MM-DD "), "YYYY-MM-DD");
  assert.equal(acceptedDailyNoteFormat("YYYY-MM-DD dddd"), undefined);
  assert.equal(acceptedDailyNoteFormat("dddd"), undefined);
});

test("Settings Daily Note edits reject unsupported values instead of resetting to defaults", () => {
  assert.deepEqual(interpretDailyNoteSetting("format", "YYYY/MM/DD"), {
    kind: "accept",
    value: "YYYY/MM/DD",
  });
  assert.deepEqual(interpretDailyNoteSetting("format", "YYYY-MM-DD dddd"), {
    kind: "reject",
    notice: "settings.dailyNoteFormatRejected",
  });
  assert.deepEqual(interpretDailyNoteSetting("folder", "日记"), {
    kind: "accept",
    value: "日记",
  });
  assert.deepEqual(interpretDailyNoteSetting("folder", "../outside"), {
    kind: "reject",
    notice: "settings.dailyNoteFolderRejected",
  });

  const current = pluginData({
    dailyNoteFolder: "Daily",
    dailyNoteFormat: "YYYY/MM/DD",
  });
  const rejectedFormat = validatePluginData({
    ...current,
    settings: { ...current.settings, dailyNoteFormat: "YYYY-MM-DD dddd" },
  });
  assert.equal(rejectedFormat.data.settings.dailyNoteFormat, DEFAULT_PLUGIN_SETTINGS.dailyNoteFormat);
  assert.notEqual(rejectedFormat.data.settings.dailyNoteFormat, current.settings.dailyNoteFormat);

  const kept = interpretDailyNoteSetting("format", "YYYY-MM-DD dddd");
  assert.equal(kept.kind, "reject");
  assert.equal(current.settings.dailyNoteFormat, "YYYY/MM/DD");
  assert.notEqual(DEFAULT_PLUGIN_DATA.settings.dailyNoteFormat, current.settings.dailyNoteFormat);
});

test("rejected Daily Note setting notices stay bilingual and distinct", () => {
  assert.match(enExecution["settings.dailyNoteFormatRejected"], /dddd/);
  assert.match(enExecution["settings.dailyNoteFormatRejected"], /last accepted format/);
  assert.match(zhCNExecution["settings.dailyNoteFormatRejected"], /dddd/);
  assert.match(zhCNExecution["settings.dailyNoteFormatRejected"], /上次可用的值/);
  assert.match(enExecution["settings.dailyNoteFolderRejected"], /last accepted folder/);
  assert.match(zhCNExecution["settings.dailyNoteFolderRejected"], /上次可用的值/);
  assert.notEqual(
    enExecution["settings.dailyNoteFormatRejected"],
    enExecution["settings.dailyNoteFormatDesc"],
  );
});

test("Settings explain when the host Daily Notes format was not copied", () => {
  assert.equal(ignoredHostDailyNoteFormat(undefined), undefined);
  assert.equal(ignoredHostDailyNoteFormat({ format: "YYYY/MM/DD" }), undefined);
  assert.equal(ignoredHostDailyNoteFormat({ format: "YYYY-MM-DD dddd" }), "YYYY-MM-DD dddd");
  assert.equal(ignoredHostDailyNoteFormat({ format: "dddd" }), "dddd");
  assert.match(
    enExecution["settings.dailyNoteFormatHostIgnored"]({ format: "YYYY-MM-DD dddd" }),
    /YYYY-MM-DD dddd/,
  );
  assert.match(
    enExecution["settings.dailyNoteFormatHostIgnored"]({ format: "YYYY-MM-DD dddd" }),
    /was not copied/,
  );
  assert.match(
    zhCNExecution["settings.dailyNoteFormatHostIgnored"]({ format: "YYYY-MM-DD dddd" }),
    /YYYY-MM-DD dddd/,
  );
  assert.match(
    zhCNExecution["settings.dailyNoteFormatHostIgnored"]({ format: "YYYY-MM-DD dddd" }),
    /没有复制/,
  );
});

test("Settings display the ignored host Daily Notes format next to the plugin format", async () => {
  const [settings, main] = await Promise.all([
    readFile("src/adapters/settings.ts", "utf8"),
    readFile("src/main.ts", "utf8"),
  ]);
  assert.match(settings, /ignoredHostDailyNoteFormat\(/);
  assert.match(settings, /settings\.dailyNoteFormatHostIgnored/);
  assert.match(main, /hostDailyNote: \(\) => this\.#hostDailyNote/);
});
