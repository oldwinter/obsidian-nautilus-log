// --write-failure scenario: the uncertain-write path under a real OS fault.
// Today's note is made read-only via chmod; a Clock In then cannot persist —
// the file must stay byte-identical, the panel must surface the honest
// "could not be confirmed" uncertainty (no false success), no partial CLOCK
// record may land, and no pending state may stick. After permissions are
// restored, a retry Clock In must compose the record cleanly.

import { chmod, readFile } from "node:fs/promises";
import { join } from "node:path";

export async function runWriteFailure({ page, fixture, vault, openExecution, check, screenshot }) {
  const report = {};
  const todayPath = join(vault, fixture.today.path);
  await openExecution();
  await page.getByRole("tab", { name: "Plan", exact: true }).click();
  const planTab = page.getByRole("tabpanel", { name: "Plan" });
  await planTab.getByRole("button", { name: "Clock in" }).first().waitFor();
  const alphaRow = planTab.locator("li.spiral-day-execution__plan-row", { hasText: "Host fixture Alpha" }).first();

  const beforeAttempt = await readFile(todayPath, "utf8");
  await chmod(todayPath, 0o444);
  try {
    await alphaRow.getByRole("button", { name: /clock in/i }).click();
    // The mutation pipeline needs a moment to attempt the write and surface
    // the outcome.
    await new Promise((resolveWait) => setTimeout(resolveWait, 4000));
    const duringLocked = await readFile(todayPath, "utf8");
    report.lockedPanel = await page.evaluate(() => {
      const root = document.querySelector(".spiral-day-execution");
      const feedback = root?.querySelector(".spiral-day-execution__feedback");
      return {
        feedbackText: feedback?.textContent ?? null,
        feedbackHidden: feedback?.hidden ?? null,
        currentPresent: Boolean(root?.querySelector(".spiral-day-execution__current")),
        busyButtons: root?.querySelectorAll("button[aria-busy=true]").length ?? 0,
      };
    });
    check("write-failure-file-byte-identical", duringLocked === beforeAttempt, { bytes: duringLocked.length });
    check("write-failure-no-partial-clock", !/CLOCK: \[/.test(duringLocked),
      duringLocked.split("\n").filter((line) => line.includes("CLOCK")));
    check("write-failure-honest-surface", report.lockedPanel.feedbackHidden === false
      && /could not be confirmed/.test(report.lockedPanel.feedbackText ?? ""), report.lockedPanel);
    check("write-failure-no-stuck-pending", report.lockedPanel.busyButtons === 0, report.lockedPanel.busyButtons);
    await screenshot("execution-write-failure");
  } finally {
    await chmod(todayPath, 0o644);
  }

  // Recovery: the panel returns to an actionable state and a retry composes
  // the record.
  await alphaRow.getByRole("button", { name: /clock in/i }).click();
  let clocked = null;
  for (let attempt = 0; attempt < 100 && clocked === null; attempt += 1) {
    const source = await readFile(todayPath, "utf8");
    if (/CLOCK: \[[^\]]+\]\s*\^nl-clock-/.test(source)) clocked = source;
    else await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  report.retryClockLine = clocked?.split("\n").find((line) => line.includes("CLOCK")) ?? null;
  check("write-failure-retry-persists", report.retryClockLine !== null, report.retryClockLine);
  await screenshot("execution-write-failure-recovered");
  return report;
}
