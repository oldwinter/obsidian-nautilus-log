// --forgotten scenario: a running CLOCK left in a prior-day Daily Note under an
// open task must project `forgotten` on both the Timing tab and the Active
// Task view, and Clock Out must compose the close in the CLOCK's owner note
// only — every other note stays byte-identical (attempt-now-write).
//
// Seeded by seedForgottenClock before the vault is written; driven by
// runForgottenClock after plugin enablement. Assertions go through the
// runner's `check`, which records and throws.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const RUNNING_CLOCK_ID = "nl-clock-66666666-6666-4666-8666-666666666666";
const ALPHA_LINE = "- [ ] Host fixture Alpha 30m ^nl-11111111-1111-4111-8111-000000000001";

// Mutates fixture.days[0] (yesterday): the OPEN Alpha task gains a LOGBOOK
// holding one running CLOCK started at 09:30 local — ~24h stale, beyond the
// fixture's forgottenWarningMinutes. The fixture's existing LOGBOOK belongs
// to the DONE "Complete" task; a running CLOCK there degrades as
// clock-owner-invalid by contract, so the seed targets Alpha explicitly.
export function seedForgottenClock(fixture) {
  const yesterday = fixture.days[0];
  const startLocal = new Date(yesterday.logicalDate.year, yesterday.logicalDate.month - 1,
    yesterday.logicalDate.day, 9, 30, 0);
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][startLocal.getDay()];
  const pad = (value, width = 2) => String(value).padStart(width, "0");
  const offsetMinutes = -startLocal.getTimezoneOffset();
  const zone = `${offsetMinutes < 0 ? "-" : "+"}${pad(Math.floor(Math.abs(offsetMinutes) / 60))}:${pad(Math.abs(offsetMinutes) % 60)}`;
  const startStamp = `${yesterday.path.slice(0, 10)} ${weekday} 09:30:00.000 ${zone}`;
  const runningLine = `    - CLOCK: [${startStamp}] ^${RUNNING_CLOCK_ID}`;
  yesterday.source = yesterday.source.replace(ALPHA_LINE, `${ALPHA_LINE}\n  - LOGBOOK::\n${runningLine}`);
  assert(yesterday.source.includes(runningLine), "running CLOCK injected under yesterday's Alpha task");
  return Object.freeze({ ownerPath: yesterday.path, clockId: RUNNING_CLOCK_ID, startStamp });
}

export async function runForgottenClock({ page, seed, vault, openExecution, check, screenshot, markdownHashes }) {
  const report = { seed };
  await openExecution();
  await screenshot("execution-forgotten");
  const panel = await page.evaluate(() => {
    const root = document.querySelector(".spiral-day-execution");
    const current = root?.querySelector(".spiral-day-execution__current");
    const elapsed = root?.querySelector(".spiral-day-execution__elapsed");
    const warning = root?.querySelector(".spiral-day-execution__warning");
    return {
      forgotten: current?.dataset?.forgotten ?? null,
      warningText: warning?.textContent ?? null,
      elapsedText: elapsed?.textContent ?? null,
      elapsedDatetime: elapsed?.dateTime ?? null,
      headingText: current?.querySelector(".spiral-day-execution__current-heading")?.textContent ?? null,
      buttons: [...(root?.querySelectorAll("button") ?? [])].map((button) => button.getAttribute("aria-label") ?? button.textContent?.trim()),
    };
  });
  report.panel = panel;
  check("forgotten-flag-projected", panel.forgotten === "true", panel.forgotten);
  check("forgotten-warning-actionable", Boolean(panel.warningText), panel.warningText);
  check("forgotten-elapsed-day-scale", /^\d{2,}:\d{2}:\d{2}/.test(panel.elapsedText ?? "")
    && /^PT\d+S$/.test(panel.elapsedDatetime ?? ""), { text: panel.elapsedText, datetime: panel.elapsedDatetime });
  check("forgotten-heading-names-task", Boolean(panel.headingText?.includes("Alpha")), panel.headingText);

  // The Active Task view maps the same projection.
  await page.evaluate(async () => {
    const leaf = app.workspace.getLeavesOfType("spiral-day-active-task")[0] ?? app.workspace.getLeaf("tab");
    await leaf.setViewState({ type: "spiral-day-active-task", active: true });
    await app.workspace.revealLeaf(leaf);
  });
  await page.locator(".spiral-day-active-task").waitFor();
  report.activeSurface = await page.evaluate(() => {
    const root = document.querySelector(".spiral-day-active-task");
    return { state: root?.dataset?.state ?? null,
      detailText: root?.querySelector(".spiral-day-active-task__details p")?.textContent ?? null };
  });
  check("forgotten-active-task-surface", report.activeSurface.state === "forgotten", report.activeSurface);

  // Clock Out composes the close inside the CLOCK's owner note, not today.
  const beforeClockOut = await markdownHashes();
  const clockOut = page.getByRole("tabpanel", { name: "Timing" }).getByRole("button", { name: "Clock out" });
  check("forgotten-clock-out-available", await clockOut.isVisible(), panel.buttons);
  await clockOut.click();
  let closedSource = null;
  for (let attempt = 0; attempt < 100 && closedSource === null; attempt += 1) {
    const source = await readFile(join(vault, seed.ownerPath), "utf8");
    if (source.split("\n").some((line) => line.includes(seed.clockId) && /--\[/.test(line))) closedSource = source;
    else await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  check("forgotten-close-persisted-in-owner-note", closedSource !== null, seed.ownerPath);
  const afterClockOut = await markdownHashes();
  report.sourceDiff = Object.fromEntries(Object.entries(beforeClockOut)
    .filter(([path, value]) => JSON.stringify(value) !== JSON.stringify(afterClockOut[path])).map(([path]) => [path, { before: beforeClockOut[path], after: afterClockOut[path] }]));
  check("forgotten-close-writes-only-owner-note", JSON.stringify(Object.keys(report.sourceDiff)) === JSON.stringify([seed.ownerPath]), report.sourceDiff);
  const closedLine = closedSource?.split("\n").find((line) => line.includes(seed.clockId)) ?? "";
  report.closedLine = closedLine;
  check("forgotten-close-record-formed", closedLine.includes(seed.startStamp)
    && /--\[.+\] => \d/.test(closedLine), closedLine);
  await screenshot("execution-forgotten-closed");
  report.panelAfter = await page.evaluate(() => {
    const current = document.querySelector(".spiral-day-execution__current");
    return { forgotten: current?.dataset?.forgotten ?? null,
      text: document.querySelector(".spiral-day-execution")?.textContent?.slice(0, 300) ?? null };
  });
  check("forgotten-clears-after-close", report.panelAfter.forgotten !== "true", report.panelAfter);
  return report;
}
