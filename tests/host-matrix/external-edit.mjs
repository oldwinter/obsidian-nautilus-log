// --external-edit scenario: markdown stays authoritative under concurrent
// edits. The scenario clocks in Alpha from the Plan tab, then appends a line
// to today's note externally (a user editing elsewhere) while the CLOCK runs.
// The vault modify event routes through the runtime's re-index — every file
// sample across the window must keep BOTH the running record and the appended
// bytes exactly (no clobber, no rewrite of user text), the panel must still
// project the active clock, and Clock Out must compose the close alongside
// the external bytes.

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const EXTERNAL_LINE = "- [ ] Typed by the user in another pane";

export async function runExternalEdit({ page, fixture, vault, openExecution, check, screenshot }) {
  const report = {};
  await openExecution();
  await page.getByRole("tab", { name: "Plan", exact: true }).click();
  const planTab = page.getByRole("tabpanel", { name: "Plan" });
  await planTab.getByRole("button", { name: "Clock in" }).first().waitFor();
  const alphaRow = planTab.locator("li.spiral-day-execution__plan-row", { hasText: "Host fixture Alpha" }).first();
  await alphaRow.getByRole("button", { name: /clock in/i }).click();

  // Wait for the running CLOCK record to persist in today's note.
  let clockedSource = null;
  for (let attempt = 0; attempt < 100 && clockedSource === null; attempt += 1) {
    const source = await readFile(join(vault, fixture.today.path), "utf8");
    if (/CLOCK: \[[^\]]+\]\s*\^nl-clock-/.test(source)) clockedSource = source;
    else await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  check("external-edit-clock-in-persisted", clockedSource !== null, fixture.today.path);
  report.clockLines = clockedSource.split("\n").filter((line) => line.includes("CLOCK"));

  // External append under the running clock, then sample bytes across the
  // re-index window — any plugin rewrite of user text fails the pin.
  await writeFile(join(vault, fixture.today.path), `${clockedSource.trimEnd()}\n${EXTERNAL_LINE}\n`);
  const expectedSource = await readFile(join(vault, fixture.today.path), "utf8");
  const samples = [];
  for (let sample = 0; sample < 20; sample += 1) {
    await new Promise((resolveWait) => setTimeout(resolveWait, 500));
    samples.push((await readFile(join(vault, fixture.today.path), "utf8")) === expectedSource);
  }
  report.byteSamples = samples;
  check("external-edit-bytes-stable-across-reindex", samples.every(Boolean), samples);

  await page.getByRole("tab", { name: "Timing", exact: true }).click();
  report.panel = await page.evaluate(() => {
    const current = document.querySelector(".spiral-day-execution__current");
    return { currentPresent: Boolean(current),
      headingText: current?.querySelector(".spiral-day-execution__current-heading")?.textContent ?? null };
  });
  check("external-edit-clock-still-active", report.panel.currentPresent === true
    && Boolean(report.panel.headingText?.includes("Alpha")), report.panel);

  const clockOut = page.getByRole("tabpanel", { name: "Timing" }).getByRole("button", { name: "Clock out" });
  await clockOut.waitFor();
  await clockOut.click();
  let closedSource = null;
  for (let attempt = 0; attempt < 100 && closedSource === null; attempt += 1) {
    const source = await readFile(join(vault, fixture.today.path), "utf8");
    if (source.split("\n").some((line) => line.includes("CLOCK") && /--\[/.test(line))) closedSource = source;
    else await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  check("external-edit-close-composed", closedSource !== null, fixture.today.path);
  const closedLine = closedSource.split("\n").find((line) => line.includes("CLOCK")) ?? "";
  report.closedLine = closedLine;
  check("external-edit-close-preserves-user-bytes", closedSource.includes(EXTERNAL_LINE)
    && /--\[.+\] => \d/.test(closedLine), { closedLine, externalKept: closedSource.includes(EXTERNAL_LINE) });
  await screenshot("execution-external-edit-closed");
  return report;
}
