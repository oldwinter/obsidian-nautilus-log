// --degraded scenario: a running CLOCK whose owner resolves done (or
// missing/stale/collided) must fail closed — the Timing tab renders the
// degraded empty-state with a retry affordance, the Active Task view renders
// `unavailable` with the mapped diagnostic, and no surface mutates markdown
// (no silent repair). The seeded owner is the fixture's DONE "Complete" task,
// whose existing LOGBOOK already holds a closed record.
//
// Seeded by seedDegradedOwnerClock before the vault is written; driven by
// runDegradedOwnerClock after plugin enablement.

import assert from "node:assert/strict";

const RUNNING_CLOCK_ID = "nl-clock-77777777-7777-4777-8777-777777777777";

// Mutates fixture.days[0] (yesterday): injects one running CLOCK (started
// 09:30 local) ahead of the existing closed record inside the DONE
// "Complete" task's LOGBOOK — the fixture's only LOGBOOK. Owner resolution
// then yields clock-owner-invalid by contract.
export function seedDegradedOwnerClock(fixture) {
  const yesterday = fixture.days[0];
  const startLocal = new Date(yesterday.logicalDate.year, yesterday.logicalDate.month - 1,
    yesterday.logicalDate.day, 9, 30, 0);
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][startLocal.getDay()];
  const pad = (value, width = 2) => String(value).padStart(width, "0");
  const offsetMinutes = -startLocal.getTimezoneOffset();
  const zone = `${offsetMinutes < 0 ? "-" : "+"}${pad(Math.floor(Math.abs(offsetMinutes) / 60))}:${pad(Math.abs(offsetMinutes) % 60)}`;
  const startStamp = `${yesterday.path.slice(0, 10)} ${weekday} 09:30:00.000 ${zone}`;
  const runningLine = `    - CLOCK: [${startStamp}] ^${RUNNING_CLOCK_ID}`;
  yesterday.source = yesterday.source.replace("    - CLOCK: [", `${runningLine}\n    - CLOCK: [`);
  assert(yesterday.source.includes(runningLine), "running CLOCK injected under the done task's LOGBOOK");
  return Object.freeze({ ownerPath: yesterday.path, clockId: RUNNING_CLOCK_ID, startStamp });
}

export async function runDegradedOwnerClock({ page, seed, openExecution, check, screenshot, markdownHashes }) {
  const report = { seed };
  const beforeSurfaces = await markdownHashes();
  await openExecution();
  await screenshot("execution-degraded");
  const panel = await page.evaluate(() => {
    const root = document.querySelector(".spiral-day-execution");
    const empty = root?.querySelector(".spiral-day-execution__empty");
    return {
      currentPresent: Boolean(root?.querySelector(".spiral-day-execution__current")),
      emptyHeading: empty?.querySelector("strong")?.textContent ?? null,
      emptyDetail: empty?.querySelector("p")?.textContent ?? null,
      clockOutPresent: Boolean([...(root?.querySelectorAll("button") ?? [])]
        .find((button) => button.getAttribute("aria-label") === "Clock out")),
      retryLabel: empty?.querySelector("button")?.getAttribute("aria-label") ?? null,
    };
  });
  report.panel = panel;
  check("degraded-panel-no-current", panel.currentPresent === false && panel.clockOutPresent === false, panel);
  check("degraded-heading-and-detail", Boolean(panel.emptyHeading) && Boolean(panel.emptyDetail), panel);
  check("degraded-retry-affordance", Boolean(panel.retryLabel), panel.retryLabel);

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
  check("degraded-active-task-unavailable", report.activeSurface.state === "unavailable"
    && Boolean(report.activeSurface.detailText), report.activeSurface);
  check("degraded-surface-opens-read-only", JSON.stringify(beforeSurfaces) === JSON.stringify(await markdownHashes()),
    { seed: seed.ownerPath });

  // Retry re-reads and stays degraded — no silent repair, still no write.
  await page.getByRole("button", { name: panel.retryLabel }).click();
  await page.locator(".spiral-day-execution__feedback:not([hidden])").waitFor();
  report.afterRetry = await page.evaluate(() => ({
    feedback: document.querySelector(".spiral-day-execution__feedback")?.textContent ?? null,
    currentPresent: Boolean(document.querySelector(".spiral-day-execution__current")),
    activeState: document.querySelector(".spiral-day-active-task")?.dataset?.state ?? null,
  }));
  check("degraded-persists-after-retry", report.afterRetry.currentPresent === false
    && report.afterRetry.activeState === "unavailable", report.afterRetry);
  check("degraded-fail-closed-no-markdown-write", JSON.stringify(beforeSurfaces) === JSON.stringify(await markdownHashes()),
    { seed: seed.ownerPath });
  return report;
}
