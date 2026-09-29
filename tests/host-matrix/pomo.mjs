// --pomo scenario: standalone-POMO lifecycle and CLOCK-wins arbitration.
// With no CLOCK, Start POMO writes standalonePomoStartEpochMs into plugin
// data and the Timing tab renders the elapsed timer with a Stop affordance.
// Clocking in a task destroys the standalone epoch (CLOCK wins — not masked)
// and sets taskPomoStartEpochMs; Clocking out clears the task epoch and the
// standalone timer does NOT resurrect. Plugin-data field-level assertions pin
// the arbitration, not just the render.

import { readFile } from "node:fs/promises";
import { join } from "node:path";

async function readPluginData(vault, pluginId) {
  return JSON.parse(await readFile(join(vault, ".obsidian", "plugins", pluginId, "data.json"), "utf8"));
}

// The markdown commit lands before #applyPomoPostcondition writes plugin
// data — poll until the field-level postcondition converges (or give up, and
// let the caller assert on the last sample).
async function pollPluginData(vault, pluginId, accept) {
  let latest = null;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    latest = await readPluginData(vault, pluginId);
    if (accept(latest)) return { converged: true, data: latest };
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  return { converged: false, data: latest };
}

export async function runPomo({ page, fixture, vault, pluginId, openExecution, check, screenshot }) {
  const report = {};
  await openExecution();
  const timingTab = page.getByRole("tabpanel", { name: "Timing" });

  // Idle empty-state exposes the standalone POMO affordance.
  const startPomo = timingTab.getByRole("button", { name: "Start POMO" });
  check("pomo-start-affordance-idle", await startPomo.isVisible(), null);
  await startPomo.click();

  // Elapsed renders with the POMO suffix + Stop affordance; plugin data holds
  // the standalone epoch.
  await timingTab.locator(".spiral-day-execution__standalone").waitFor();
  report.running = await timingTab.evaluate(() => ({
    elapsed: document.querySelector(".spiral-day-execution__standalone .spiral-day-execution__elapsed")?.textContent ?? null,
    suffix: document.querySelector(".spiral-day-execution__standalone .spiral-day-execution__elapsed")?.dataset?.suffix ?? null,
    stopVisible: Boolean([...document.querySelectorAll(".spiral-day-execution__standalone button")]
      .find((button) => button.getAttribute("aria-label") === "Stop POMO")),
  }));
  check("pomo-elapsed-projects", /POMO/.test(report.running.elapsed ?? "") && report.running.stopVisible === true, report.running);
  report.dataAfterStart = await readPluginData(vault, pluginId);
  check("pomo-start-persisted", typeof report.dataAfterStart.standalonePomoStartEpochMs === "number"
    && report.dataAfterStart.standalonePomoStartEpochMs > 0,
    { standalone: report.dataAfterStart.standalonePomoStartEpochMs, task: report.dataAfterStart.taskPomoStartEpochMs });
  await screenshot("execution-pomo-running");

  // CLOCK wins: clocking in destroys the standalone epoch and starts the
  // task epoch; the standalone surface leaves the Timing tab.
  await page.getByRole("tab", { name: "Plan", exact: true }).click();
  const planTab = page.getByRole("tabpanel", { name: "Plan" });
  const alphaRow = planTab.locator("li.spiral-day-execution__plan-row", { hasText: "Host fixture Alpha" }).first();
  await alphaRow.getByRole("button", { name: /clock in/i }).click();
  let clocked = null;
  for (let attempt = 0; attempt < 100 && clocked === null; attempt += 1) {
    const source = await readFile(join(vault, fixture.today.path), "utf8");
    if (/CLOCK: \[[^\]]+\]\s*\^nl-clock-/.test(source)) clocked = source;
    else await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  check("pomo-clock-in-persisted", clocked !== null, fixture.today.path);
  report.dataAfterClockIn = await pollPluginData(vault, pluginId,
    (data) => data.standalonePomoStartEpochMs === null && typeof data.taskPomoStartEpochMs === "number");
  check("clock-wins-clears-standalone", report.dataAfterClockIn.converged === true,
    { converged: report.dataAfterClockIn.converged,
      standalone: report.dataAfterClockIn.data?.standalonePomoStartEpochMs,
      task: report.dataAfterClockIn.data?.taskPomoStartEpochMs });
  await page.getByRole("tab", { name: "Timing", exact: true }).click();
  report.panelDuringClock = await page.evaluate(() => ({
    currentPresent: Boolean(document.querySelector(".spiral-day-execution__current")),
    standalonePresent: Boolean(document.querySelector(".spiral-day-execution__standalone")),
  }));
  check("pomo-surface-masked-during-clock", report.panelDuringClock.currentPresent === true
    && report.panelDuringClock.standalonePresent === false, report.panelDuringClock);

  // Clock out: idle returns with the Start POMO affordance; the standalone
  // epoch does not resurrect (destroyed, not masked).
  await timingTab.getByRole("button", { name: "Clock out" }).click();
  let closed = null;
  for (let attempt = 0; attempt < 100 && closed === null; attempt += 1) {
    const source = await readFile(join(vault, fixture.today.path), "utf8");
    if (source.split("\n").some((line) => line.includes("CLOCK") && /--\[/.test(line))) closed = source;
    else await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  check("pomo-clock-out-persisted", closed !== null, fixture.today.path);
  report.dataAfterClockOut = await pollPluginData(vault, pluginId,
    (data) => data.standalonePomoStartEpochMs === null && data.taskPomoStartEpochMs === null);
  check("pomo-not-resurrected", report.dataAfterClockOut.converged === true,
    { converged: report.dataAfterClockOut.converged,
      standalone: report.dataAfterClockOut.data?.standalonePomoStartEpochMs,
      task: report.dataAfterClockOut.data?.taskPomoStartEpochMs });
  await timingTab.getByRole("button", { name: "Start POMO" }).waitFor();
  report.idleAfter = await page.evaluate(() => ({
    standalonePresent: Boolean(document.querySelector(".spiral-day-execution__standalone")),
    startAffordance: [...document.querySelectorAll(".spiral-day-execution button")]
      .map((button) => button.getAttribute("aria-label")).includes("Start POMO"),
  }));
  check("pomo-idle-restored", report.idleAfter.standalonePresent === false && report.idleAfter.startAffordance === true, report.idleAfter);
  await screenshot("execution-pomo-closed");
  return report;
}
