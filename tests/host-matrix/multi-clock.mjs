// --multi-clock scenario: two running CLOCK records anywhere in the vault
// must degrade the whole execution surface honestly — the runtime refuses to
// guess which clock is authoritative — until the vault is unambiguous again.
//
// Contract: snapshot.running.length > 1 -> projectClockIndex degrades
// "multiple-running-clocks" (before any owner resolution) -> error.overlap
// detail, which is distinct from error.taskOwner / error.refresh — the
// overlap wording is the assertion that pins THIS code path. Writes fail
// closed while ambiguous; closing the foreign record by hand restores a
// single running clock and the surface recovers.
//
// Seeded by seedMultiClock before the vault is written: one running CLOCK
// under yesterday's done-task LOGBOOK plus one under today's Alpha via an
// injected LOGBOOK block. Recovery is a manual vault.modify that closes the
// yesterday record, matching the repair the error text itself prescribes.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const YESTERDAY_CLOCK_ID = "nl-clock-88888888-8888-4888-8888-888888888888";
const TODAY_CLOCK_ID = "nl-clock-99999999-9999-4999-8999-999999999999";

function clockStamp(date, hour, minute) {
  const pad = (value) => String(value).padStart(2, "0");
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][date.getDay()];
  const offsetMinutes = -new Date(date.getFullYear(), date.getMonth(), date.getDate(), hour).getTimezoneOffset();
  const zone = `${offsetMinutes < 0 ? "-" : "+"}${pad(Math.floor(Math.abs(offsetMinutes) / 60))}:${pad(Math.abs(offsetMinutes) % 60)}`;
  const key = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  return { key, stamp: `${key} ${weekday} ${pad(hour)}:${pad(minute)}:00.000 ${zone}` };
}

export function seedMultiClock(fixture) {
  const yesterday = fixture.days[0];
  const today = fixture.days[1];
  const todayAlpha = today.source.split("\n").find((line) => line.includes("Host fixture Alpha"));

  const yesterdayStart = clockStamp(new Date(yesterday.logicalDate.year,
    yesterday.logicalDate.month - 1, yesterday.logicalDate.day, 12), 9, 30);
  const yesterdayRunning = `    - CLOCK: [${yesterdayStart.stamp}] ^${YESTERDAY_CLOCK_ID}`;
  yesterday.source = yesterday.source.replace("    - CLOCK: [", `${yesterdayRunning}\n    - CLOCK: [`);
  assert(yesterday.source.includes(yesterdayRunning), "running CLOCK injected under yesterday's done LOGBOOK");

  const todayStart = clockStamp(new Date(today.logicalDate.year,
    today.logicalDate.month - 1, today.logicalDate.day, 12), 10, 15);
  const todayRunning = `    - CLOCK: [${todayStart.stamp}] ^${TODAY_CLOCK_ID}`;
  today.source = today.source.replace(todayAlpha, `${todayAlpha}\n  - LOGBOOK::\n${todayRunning}`);
  assert(today.source.includes(todayRunning), "running CLOCK injected under today's Alpha");

  const yesterdayEnd = clockStamp(new Date(yesterday.logicalDate.year,
    yesterday.logicalDate.month - 1, yesterday.logicalDate.day, 12), 10, 0);
  return Object.freeze({
    yesterdayPath: yesterday.path,
    yesterdayRunning,
    yesterdayClosed: `    - CLOCK: [${yesterdayStart.stamp}]--[${yesterdayEnd.stamp}] => 0:30 ^${YESTERDAY_CLOCK_ID}`,
    todayPath: today.path,
    todayRunning,
  });
}

async function poll(milliseconds, accept) {
  const deadline = Date.now() + milliseconds;
  let latest;
  while (Date.now() < deadline) {
    latest = await accept();
    if (latest) return latest;
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  return latest;
}

export async function runMultiClock({ page, seed, vault, openExecution, check, screenshot, markdownHashes, out: report }) {
  report.seed = seed;
  const beforeFault = await markdownHashes();
  await openExecution();
  const timingTab = page.getByRole("tabpanel", { name: "Timing" });
  const retryButton = timingTab.locator(".spiral-day-execution__empty button");
  const timingSurface = () => page.evaluate(() => {
    const root = document.querySelector(".spiral-day-execution");
    const empty = root?.querySelector(".spiral-day-execution__empty");
    const buttons = [...(root?.querySelectorAll("button") ?? [])];
    return {
      currentPresent: Boolean(root?.querySelector(".spiral-day-execution__current")),
      currentHeading: root?.querySelector(".spiral-day-execution__current-heading")?.textContent ?? null,
      emptyHeading: empty?.querySelector("strong")?.textContent ?? null,
      emptyDetail: empty?.querySelector("p")?.textContent ?? null,
      retryLabel: empty?.querySelector("button")?.getAttribute("aria-label") ?? null,
      clockOutVisible: Boolean(buttons.find((button) => button.getAttribute("aria-label") === "Clock out")),
      busyButtons: root?.querySelectorAll("button[aria-busy=true]").length ?? 0,
    };
  });
  const degradedSurface = () => poll(10_000, async () => {
    const surface = await timingSurface();
    return surface.retryLabel === "Try again" && surface.emptyHeading === "Timing unavailable" ? surface : null;
  });

  // Both seeds are on disk before the first rebuild: the surface must already
  // be degraded with the overlap detail — the multi-clock diagnostic, not a
  // generic owner-invalid one.
  report.degradedTiming = await degradedSurface();
  check("mc-degraded-timing-surface", report.degradedTiming !== null
    && report.degradedTiming.clockOutVisible === false
    && report.degradedTiming.currentPresent === false, report.degradedTiming);

  await page.evaluate(async () => {
    const leaf = app.workspace.getLeavesOfType("spiral-day-active-task")[0] ?? app.workspace.getLeaf("tab");
    await leaf.setViewState({ type: "spiral-day-active-task", active: true });
    await app.workspace.revealLeaf(leaf);
  });
  await page.locator(".spiral-day-active-task").waitFor();
  report.degradedActiveTask = await poll(10_000, () => page.evaluate(() => ({
    state: document.querySelector(".spiral-day-active-task")?.dataset?.state ?? null,
    detailText: document.querySelector(".spiral-day-active-task__details p")?.textContent ?? null,
  })).then((surface) => surface.state === "unavailable" ? surface : null));
  check("mc-degraded-active-task-overlap", report.degradedActiveTask !== null
    && /overlapping|ambiguous/i.test(report.degradedActiveTask.detailText ?? ""),
    report.degradedActiveTask);

  // Fail-closed: while ambiguous, nothing may be written and a retried
  // rebuild stays degraded — the runtime must not pick a clock.
  check("mc-degraded-writes-nothing",
    JSON.stringify(beforeFault) === JSON.stringify(await markdownHashes()), { paths: [seed.yesterdayPath, seed.todayPath] });
  await openExecution();
  await retryButton.click();
  report.stillDegraded = await degradedSurface();
  check("mc-retry-stays-degraded", report.stillDegraded !== null, report.stillDegraded);
  await screenshot("execution-multi-clock");

  // The prescribed repair: close the foreign record by hand. The remaining
  // today-Alpha clock must project again — recovery does not strand it.
  await page.evaluate(async ({ path, running, closed: closedLine }) => {
    const file = app.vault.getAbstractFileByPath(path);
    const text = await app.vault.read(file);
    await app.vault.modify(file, text.replace(running, closedLine));
  }, { path: seed.yesterdayPath, running: seed.yesterdayRunning, closed: seed.yesterdayClosed });

  report.recoveredTiming = await poll(10_000, async () => {
    const surface = await timingSurface();
    return surface.currentPresent === true && surface.currentHeading?.includes("Alpha") ? surface : null;
  });
  check("mc-single-clock-recovers", report.recoveredTiming !== null
    && report.recoveredTiming.clockOutVisible === true, report.recoveredTiming);

  // The active tab is Plan since the degraded empty-state is tab-independent;
  // the current-task row lives in the Timing panel which renders hidden until
  // the tab is selected — verify the selection before the gesture.
  const timingTabButton = page.getByRole("tab", { name: "Timing", exact: true });
  await timingTabButton.click();
  report.timingTabActive = await poll(10_000, async () =>
    (await timingTabButton.getAttribute("aria-selected")) === "true" ? true : null);
  check("mc-timing-tab-active", report.timingTabActive === true, { active: report.timingTabActive });
  // Scope to the popover: the leaf opened earlier renders its own enabled
  // "Clock out" button once the clock recovers, so a page-level locator is a
  // strict-mode violation (isEnabled throws -> observed null).
  const clockOutButton = page.locator(".spiral-day-execution")
    .getByRole("button", { name: "Clock out" });
  report.clockOutEnabled = await poll(10_000, () =>
    clockOutButton.isEnabled().then((enabled) => enabled || null).catch(() => null));
  check("mc-clock-out-actionable", report.clockOutEnabled === true,
    { enabled: report.clockOutEnabled, surface: await timingSurface() });
  await clockOutButton.click();
  report.closedSource = await poll(10_000, async () => {
    const source = await readFile(join(vault, seed.todayPath), "utf8");
    return source.split("\n").some((line) => line.includes(TODAY_CLOCK_ID) && /--\[/.test(line)) ? source : null;
  });
  check("mc-close-composed-today", report.closedSource !== null
    && report.closedSource.includes(`${TODAY_CLOCK_ID}`), seed.todayPath);

  // Yesterday keeps exactly the manual close bytes — the plugin must not
  // rewrite the foreign note while closing today's clock.
  const yesterdayAfter = await readFile(join(vault, seed.yesterdayPath), "utf8");
  check("mc-yesterday-manual-close-only", yesterdayAfter.includes(`]--[`) === true
    && yesterdayAfter.includes(YESTERDAY_CLOCK_ID)
    && !yesterdayAfter.split("\n").some((line) => line.includes(`CLOCK: [`) && line.includes(YESTERDAY_CLOCK_ID) && !line.includes("]--[")),
    { yesterdayPath: seed.yesterdayPath });
  await screenshot("execution-multi-clock-recovered");
}
