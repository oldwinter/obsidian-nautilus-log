import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_DAILY_NOTE_CONFIGURATION,
  parseDailyNotePath,
  resolveDailyNotePath,
  type DailyNoteConfiguration,
  type LogicalDate,
} from "../../../src/workspace/daily-notes.ts";

const date = (year: number, month: number, day: number): LogicalDate => ({
  year,
  month,
  day,
});

function resolvedPath(logicalDate: LogicalDate, configuration: DailyNoteConfiguration): string {
  const result = resolveDailyNotePath(logicalDate, configuration);
  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) throw new Error(result.message);
  return result.path;
}

test("WSR-DN-001 requires explicit configuration and exposes defaults explicitly", () => {
  const missing = resolveDailyNotePath(date(2026, 8, 28), undefined);
  assert.deepEqual(missing, {
    ok: false,
    reason: "missing-config",
    message: "Daily Note configuration is required",
  });

  assert.deepEqual(DEFAULT_DAILY_NOTE_CONFIGURATION, {
    folder: "",
    format: "YYYY-MM-DD",
  });
  assert.equal(Object.isFrozen(DEFAULT_DAILY_NOTE_CONFIGURATION), true);
  assert.equal(
    resolvedPath(date(2026, 8, 28), DEFAULT_DAILY_NOTE_CONFIGURATION),
    "2026-08-28.md",
  );
});

test("WSR-DN-002 normalizes one vault-relative md path and supports nested formats", () => {
  assert.equal(
    resolvedPath(date(2026, 8, 28), {
      folder: "Journal\\Daily//",
      format: "YYYY/MM/DD",
    }),
    "Journal/Daily/2026/08/28.md",
  );
  assert.equal(
    resolvedPath(date(2026, 1, 2), {
      folder: "",
      format: "YYYY/MM/[day-]DD",
    }),
    "2026/01/day-02.md",
  );
});

test("WSR-DN-003 round-trips root and nested logical dates across month/year rollover", () => {
  const configurations: readonly DailyNoteConfiguration[] = [
    DEFAULT_DAILY_NOTE_CONFIGURATION,
    { folder: "Calendar", format: "YYYY/MM/DD" },
    { folder: "Calendar", format: "YYYY/M/D" },
  ];
  const dates = [date(2024, 2, 29), date(2026, 12, 31), date(2027, 1, 1)];

  for (const configuration of configurations) {
    for (const logicalDate of dates) {
      const path = resolvedPath(logicalDate, configuration);
      const parsed = parseDailyNotePath(path, configuration);
      assert.equal(parsed.ok, true, JSON.stringify({ configuration, logicalDate, parsed }));
      if (parsed.ok) assert.deepEqual(parsed.logicalDate, logicalDate);
    }
  }
});

test("WSR-DN-004 rejects invalid dates, paths, formats, and duplicate extensions", () => {
  const invalidCases = [
    [date(2025, 2, 29), DEFAULT_DAILY_NOTE_CONFIGURATION],
    [date(2026, 13, 1), DEFAULT_DAILY_NOTE_CONFIGURATION],
    [date(2026, 8, 28), null as unknown as DailyNoteConfiguration],
    [date(2026, 8, 28), { folder: "../Daily", format: "YYYY-MM-DD" }],
    [date(2026, 8, 28), { folder: "/Daily", format: "YYYY-MM-DD" }],
    [date(2026, 8, 28), { folder: "Daily", format: "YYYY:MM:DD" }],
    [date(2026, 8, 28), { folder: "Daily", format: "YYYY-MM-DD[.md]" }],
    [date(2026, 8, 28), { folder: "Daily", format: "YYYY-MM-dd" }],
    [date(2026, 8, 28), { folder: "Daily", format: "YYYY//MM/DD" }],
  ] as const;

  for (const [logicalDate, configuration] of invalidCases) {
    const result = resolveDailyNotePath(logicalDate, configuration);
    assert.equal(result.ok, false, JSON.stringify({ logicalDate, configuration, result }));
    if (!result.ok) assert.equal(result.reason, "invalid-config");
  }
});

test("WSR-DN-005 rejects ambiguous or colliding date formats", () => {
  const formats = [
    "MM-DD",
    "YYYY-DD",
    "YYYY-MM",
    "YY-MM-DD",
    "YYYY-MD",
    "M[1]D-YYYY",
    "YYYY-[2]M-D",
  ];

  for (const format of formats) {
    const result = resolveDailyNotePath(date(2026, 8, 28), { folder: "Daily", format });
    assert.equal(result.ok, false, JSON.stringify(result));
    if (!result.ok) assert.equal(result.reason, "ambiguous-config", format);
  }
});

test("WSR-DN-006 parsing rejects noncanonical and unrelated paths", () => {
  const configuration = { folder: "Daily", format: "YYYY/MM/DD" };

  for (const path of [
    "Other/2026/08/28.md",
    "Daily/2026/8/28.md",
    "Daily/2026/08/28.txt",
    "Daily//2026/08/28.md",
  ]) {
    const result = parseDailyNotePath(path, configuration);
    assert.equal(result.ok, false, path);
  }

  const anotherDate = parseDailyNotePath("Daily/2026/08/29.md", configuration);
  assert.equal(anotherDate.ok, true);
  if (anotherDate.ok) assert.deepEqual(anotherDate.logicalDate, date(2026, 8, 29));
});
