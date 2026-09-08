const OPEN = "<!-- nautilus-log:plan/v1 -->";
const CLOSE = "<!-- /nautilus-log:plan -->";
const MINUTE = 60_000;
const DAY_START = Date.UTC(2026, 7, 29);

function identity(prefix, value) {
  return `${prefix}00000000-0000-4000-8000-${value.toString(16).padStart(12, "0")}`;
}

export function schedulerFixture(count) {
  const items = Array.from({ length: count }, (_, sourceOrder) => {
    const status = sourceOrder % 13 === 0 ? "done" : sourceOrder % 17 === 0 ? "plain" : "open";
    const durationMinutes = sourceOrder % 7 === 0 ? 0 : 5 + sourceOrder % 4 * 5;
    const base = {
      source: Object.freeze({ id: `item-${sourceOrder}` }), sourceOrder, status,
      label: sourceOrder === count - 1 ? "Long label ".repeat(count === 1_000 ? 1_200 : 180) : `Task ${sourceOrder}`,
      durationMinutes, remainingDurationMinutes: durationMinutes,
      progressPercent: sourceOrder % 4 * 25, urgent: sourceOrder % 11 === 0,
      tokens: Object.freeze({}),
    };
    if (sourceOrder % 10 === 0) {
      const startMinutes = 300 + sourceOrder % 900;
      return Object.freeze({ ...base, kind: "fixed-event", executionEligible: false,
        startMinutes, endMinutes: startMinutes + 30 });
    }
    return Object.freeze({ ...base, kind: "flexible-task", executionEligible: status === "open" });
  });
  return Object.freeze({ startMinutes: 300, endMinutes: 1_440, nowMinutes: 360,
    items: Object.freeze(items) });
}

export function historyFixture(clockCount, formatClosed, formatRunning) {
  const taskCount = clockCount === 25_000 ? 4_000 : 1_000;
  const files = new Map();
  let clockNumber = 0;
  for (let day = 0; day < 5; day += 1) {
    const rows = [];
    for (let item = 0; item < taskCount / 5; item += 1) {
      const owner = day * taskCount / 5 + item;
      const done = owner % 3 !== 0;
      const fixed = owner % 19 === 0;
      const label = owner === 0 ? "Synthetic long label ".repeat(80) : `Synthetic task ${owner}`;
      rows.push(`- [${done ? "x" : " "}] ${label} ${fixed ? "9:00-9:30" : "30m"} ^${identity("nl-", owner)}`);
      if (owner % 17 === 0) rows.push("  - Nested description with **formatting** and [a local link](ordinary.md).");
      rows.push("  - LOGBOOK::");
      const count = Math.floor(clockCount / taskCount) + (owner < clockCount % taskCount ? 1 : 0);
      for (let index = 0; index < count; index += 1) {
        const id = identity("nl-clock-", clockNumber);
        const start = DAY_START + (clockNumber % 23 === 0 ? -30 : 60 + index * 20) * MINUTE;
        const clock = clockNumber === clockCount - 1
          ? formatRunning(DAY_START + 600 * MINUTE, 0, id)
          : clockNumber % 97 === 0
            ? `CLOCK: [malformed]--[malformed] ^${id}`
            : formatClosed(start, 0, start + (10 + clockNumber % 5) * MINUTE, 0, id);
        rows.push(`    - ${clock}`);
        clockNumber += 1;
      }
    }
    files.set(`2026-08-${String(27 + day)}`, rows);
  }
  const notes = new Map([...files].map(([date, rows]) => [
    `${date}.md`, `# Synthetic benchmark ${date}\n\n${OPEN}\n${rows.join("\n")}\n${CLOSE}\n\nPreserved outside-region text.\n`,
  ]));
  notes.set("ordinary.md", "# Synthetic ordinary note\n\nNo eligible Plan Region.\n");
  return { files: notes, clockCount, taskCount,
    configuration: Object.freeze({ folder: "", format: "YYYY-MM-DD" }),
    dimensions: {
      markdownFiles: notes.size, markdownBytes: [...notes.values()].reduce((sum, text) => sum + Buffer.byteLength(text), 0),
      dailyNotes: 5, tasks: taskCount, recognizedClockRecords: clockNumber,
      scope: "CLOCK-count scale only. Not the full 20,000-file, 2 GiB vault envelope.",
      contents: ["open and completed tasks", "fixed events", "nested descriptions", "long label", "cross-midnight CLOCK", "malformed CLOCK", "one running CLOCK"],
    } };
}
