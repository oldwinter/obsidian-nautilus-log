export function syntheticFixture(now = new Date()) {
  const days = [-1, 0, 1].map((offset) => {
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset, 12);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    const relation = offset < 0 ? "past" : offset > 0 ? "future" : "today";
    const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][date.getDay()];
    const timezoneMinutes = -new Date(date.getFullYear(), date.getMonth(), date.getDate(), 9).getTimezoneOffset();
    const timezone = `${timezoneMinutes < 0 ? "-" : "+"}${String(Math.floor(Math.abs(timezoneMinutes) / 60)).padStart(2, "0")}:${String(Math.abs(timezoneMinutes) % 60).padStart(2, "0")}`;
    const source = [
      `# Public synthetic host fixture ${key}`,
      "",
      "This note contains generated test data only.",
      "",
      "<!-- nautilus-log:plan/v1 -->",
      `- [ ] Host fixture Alpha 30m ^nl-11111111-1111-4111-8111-${String(offset + 2).padStart(12, "0")}`,
      `- [ ] Host fixture Beta 15m ^nl-22222222-2222-4222-8222-${String(offset + 2).padStart(12, "0")}`,
      `- [x] Host fixture Complete 10m ^nl-33333333-3333-4333-8333-${String(offset + 2).padStart(12, "0")}`,
      ...(offset === -1 ? [
        "  - LOGBOOK::",
        `    - CLOCK: [${key} ${weekday} 09:00:00.000 ${timezone}]--[${key} ${weekday} 09:12:00.000 ${timezone}] => 0:12 ^nl-clock-44444444-4444-4444-8444-000000000001`,
      ] : []),
      `- [ ] Host fixture Review ${relation} 20m ^nl-55555555-5555-4555-8555-${String(offset + 2).padStart(12, "0")}`,
      "<!-- /nautilus-log:plan -->",
      "",
      "Outside-region sentinel. Preserve these bytes.",
      "",
    ].join("\n");
    return { path: `${key}.md`, source, relation, logicalDate: { year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate() } };
  });
  return {
    days,
    today: days[1],
    pluginData: {
      schemaVersion: 1,
      settings: {
        language: "en", chartStartHour: 5, chartEndHour: 24,
        componentPrefix: "[[Nautilus Log]]", legendMaxLength: 22,
        defaultDurationMinutes: 15, urgentTrigger: "", executionEnabled: true,
        keepTimingFirst: true, pomoThresholdMinutes: 45, recentRetentionMinutes: 45,
        forgottenWarningMinutes: 120, dailyNoteFolder: "", dailyNoteFormat: "YYYY-MM-DD",
      },
      taskPomoStartEpochMs: null,
      standalonePomoStartEpochMs: null,
    },
  };
}
