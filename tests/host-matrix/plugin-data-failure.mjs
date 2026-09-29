// --plugin-data-failure scenario: plugin-data persistence faults under a real
// OS-level fault (data.json replaced by a directory), covering both documented
// paths.
//
// Why a directory instead of chmod 444 on the file: Obsidian's plugin-data
// write path is not guaranteed to honor the file's POSIX mode — an atomic
// temp+rename is governed by directory permission, and a deferred/queued write
// resolves before bytes land so the read-back leg can race. A directory at the
// data path is deterministic under every write model: the save leg fails
// (EISDIR/ENOTDIR) and the load leg fails identically, so a failed update is a
// real persistence failure, not a read-back artifact.
//
// Phase A — session block + retry recovery: standalone POMO start under the
// fault fails into sessionBlocked; the degraded empty-state offers the retry
// affordance and a retried refresh stays blocked while saves still fail. After
// the fault is removed, the same refresh gesture re-proves writability (save +
// read-back of the last confirmed data), unblocks the session, and a retried
// Start POMO succeeds — the documented "retry the setting/session action"
// recovery.
//
// Phase B — postcondition warning: a Clock In under the fault still persists
// the Markdown CLOCK (Markdown authority) but warns plugin-data-failed;
// session mutations stay actionable (warning, not hard block) so Clock Out
// composes the close after restore.
//
// Each faulted section is wrapped in try/finally so a mid-assertion failure
// cannot leave the data path blocked.

import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

// Obsidian's own JSON loader logs "failed to read JSON <path>" to the console
// when the data path is unreadable — the honest symptom of the injected fault.
// The runner subtracts these declared patterns from no-renderer-console-errors;
// every event is still preserved in report.console.
export const expectedConsoleErrorPatterns = [
  /failed to read JSON [^\n]*plugins\/[^/]+\/data\.json[^\n]*EISDIR/,
];

async function readPluginData(vault, pluginId) {
  return JSON.parse(await readFile(join(vault, ".obsidian", "plugins", pluginId, "data.json"), "utf8"));
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

// Replaces the plugin data file with an empty directory and returns a restore
// closure that puts back the exact captured bytes.
async function installDataFault(dataPath) {
  const bytes = await readFile(dataPath);
  await rm(dataPath);
  await mkdir(dataPath);
  return async () => {
    await rm(dataPath, { recursive: true, force: true });
    await writeFile(dataPath, bytes);
  };
}

export async function runPluginDataFailure({ page, fixture, vault, pluginId, openExecution, check, screenshot }) {
  const report = {};
  const dataPath = join(vault, ".obsidian", "plugins", pluginId, "data.json");
  const todayPath = join(vault, fixture.today.path);
  await openExecution();
  const timingTab = page.getByRole("tabpanel", { name: "Timing" });
  const retryButton = timingTab.locator(".spiral-day-execution__empty button");
  const timingSurface = () => page.evaluate(() => {
    const root = document.querySelector(".spiral-day-execution");
    const empty = root?.querySelector(".spiral-day-execution__empty");
    const buttons = [...(root?.querySelectorAll("button") ?? [])];
    return {
      currentPresent: Boolean(root?.querySelector(".spiral-day-execution__current")),
      emptyHeading: empty?.querySelector("strong")?.textContent ?? null,
      emptyDetail: empty?.querySelector("p")?.textContent ?? null,
      retryLabel: empty?.querySelector("button")?.getAttribute("aria-label") ?? null,
      clockOut: buttons.find((button) => button.getAttribute("aria-label") === "Clock out")?.disabled ?? null,
      startPomoVisible: Boolean(buttons.find((button) => button.getAttribute("aria-label") === "Start POMO")),
      standaloneTimer: Boolean(root?.querySelector(".spiral-day-execution__standalone")),
      busyButtons: root?.querySelectorAll("button[aria-busy=true]").length ?? 0,
    };
  });
  const activeTaskSurface = async () => {
    await page.evaluate(async () => {
      const leaf = app.workspace.getLeavesOfType("spiral-day-active-task")[0] ?? app.workspace.getLeaf("tab");
      await leaf.setViewState({ type: "spiral-day-active-task", active: true });
      await app.workspace.revealLeaf(leaf);
    });
    await page.locator(".spiral-day-active-task").waitFor();
    return page.evaluate(() => ({
      state: document.querySelector(".spiral-day-active-task")?.dataset?.state ?? null,
      detailText: document.querySelector(".spiral-day-active-task__details p")?.textContent ?? null,
    }));
  };
  const degradedSurface = () => poll(10_000, async () => {
    const surface = await timingSurface();
    return surface.retryLabel === "Try again" ? surface : null;
  });

  report.adapterMechanism = await page.evaluate(() => {
    const plugin = app.plugins.plugins["spiral-day"];
    return {
      saveDataSource: plugin?.saveData?.toString().slice(0, 400) ?? null,
      adapterWriteSource: app.vault.adapter.write?.toString().slice(0, 600) ?? null,
    };
  });

  // Phase A — standalone POMO under the fault: session block.
  const restoreA = await installDataFault(dataPath);
  try {
    await timingTab.getByRole("button", { name: "Start POMO" }).click();
    report.blockedTiming = await degradedSurface();
    check("pdf-pomo-block-surface", report.blockedTiming !== null
      && report.blockedTiming.standaloneTimer === false, report.blockedTiming);
    report.blockedActiveTask = await poll(10_000, async () => {
      const surface = await activeTaskSurface();
      return surface.state === "unavailable" ? surface : null;
    });
    check("pdf-pomo-honest-unavailable", report.blockedActiveTask !== null
      && /could not save plugin settings/.test(report.blockedActiveTask.detailText ?? ""),
      report.blockedActiveTask);
    check("pdf-no-stuck-pending", report.blockedTiming?.busyButtons === 0, report.blockedTiming?.busyButtons);

    // Retried refresh while the data path is still faulted must stay blocked.
    await retryButton.click();
    report.stillBlocked = await degradedSurface();
    check("pdf-retry-stays-blocked-while-locked", report.stillBlocked !== null
      && report.stillBlocked.startPomoVisible === false
      && report.stillBlocked.standaloneTimer === false, report.stillBlocked);
    await screenshot("execution-plugin-data-blocked");
  } finally {
    await restoreA();
  }

  // Recovery: the same refresh gesture re-proves writability and unblocks.
  await retryButton.click();
  report.recoveredTiming = await poll(10_000, async () => {
    const surface = await timingSurface();
    return surface.emptyHeading === "Idle"
      && surface.startPomoVisible === true
      && surface.standaloneTimer === false ? surface : null;
  });
  check("pdf-recovery-unblocks-session", report.recoveredTiming !== null, report.recoveredTiming);
  report.recoveredActiveTask = await poll(10_000, async () => {
    const surface = await activeTaskSurface();
    return surface.state === "idle" ? surface : null;
  });
  check("pdf-active-task-recovers", report.recoveredActiveTask?.state === "idle",
    report.recoveredActiveTask);

  // Phase A tail: the retried session action itself now succeeds.
  await timingTab.getByRole("button", { name: "Start POMO" }).click();
  await timingTab.locator(".spiral-day-execution__standalone").waitFor();
  report.pomoData = await poll(10_000, async () => {
    const data = await readPluginData(vault, pluginId);
    return typeof data.standalonePomoStartEpochMs === "number" ? data : null;
  });
  check("pdf-pomo-start-succeeds-after-unlock",
    report.pomoData !== null && report.pomoData.standalonePomoStartEpochMs > 0,
    { standalone: report.pomoData?.standalonePomoStartEpochMs });
  await timingTab.getByRole("button", { name: "Stop POMO" }).click();
  await timingTab.getByRole("button", { name: "Start POMO" }).waitFor();

  // Phase B — Clock In under the fault: markdown persists, warning not block
  // (the next action retries the postcondition).
  await page.getByRole("tab", { name: "Plan", exact: true }).click();
  const planTab = page.getByRole("tabpanel", { name: "Plan" });
  const alphaRow = planTab.locator("li.spiral-day-execution__plan-row", { hasText: "Host fixture Alpha" }).first();
  const restoreB = await installDataFault(dataPath);
  try {
    await alphaRow.getByRole("button", { name: /clock in/i }).click();
    const clocked = await poll(10_000, async () => {
      const source = await readFile(todayPath, "utf8");
      return /CLOCK: \[[^\]]+\]\s*\^nl-clock-/.test(source) ? source : null;
    });
    report.clockLine = clocked?.split("\n").find((line) => line.includes("CLOCK")) ?? null;
    check("pdf-clock-persists-markdown", report.clockLine !== null, report.clockLine);
    await page.getByRole("tab", { name: "Timing", exact: true }).click();
    report.warningTiming = await poll(10_000, async () => {
      const surface = await timingSurface();
      return surface.currentPresent ? surface : null;
    });
    check("pdf-clock-warning-keeps-focus", report.warningTiming?.currentPresent === true, report.warningTiming);
    check("pdf-clock-out-actionable-under-warning", report.warningTiming?.clockOut === false,
      report.warningTiming);
    report.warningActiveTask = await poll(10_000, async () => {
      const surface = await activeTaskSurface();
      return surface.state === "unavailable" ? surface : null;
    });
    check("pdf-clock-honest-unavailable", report.warningActiveTask !== null
      && /could not save plugin settings/.test(report.warningActiveTask.detailText ?? ""),
      report.warningActiveTask);
    await screenshot("execution-plugin-data-warning");
  } finally {
    await restoreB();
  }

  // Retried session action completes: Clock Out composes the close and the
  // postcondition clears — the surface heals.
  await page.getByRole("tab", { name: "Timing", exact: true }).click();
  const clockOut = timingTab.getByRole("button", { name: "Clock out" });
  await clockOut.click();
  const closed = await poll(10_000, async () => {
    const source = await readFile(todayPath, "utf8");
    return source.split("\n").some((line) => line.includes("CLOCK") && /--\[/.test(line)) ? source : null;
  });
  report.closeLine = closed?.split("\n").find((line) => line.includes("CLOCK") && line.includes("--[")) ?? null;
  check("pdf-clock-out-completes-after-unlock", report.closeLine !== null
    && /--\[[^\]]+\]\s*=>\s*\d/.test(report.closeLine ?? ""), report.closeLine);
  check("pdf-clock-id-preserved", report.closeLine !== null && report.clockLine !== null
    && report.closeLine.includes(report.clockLine.match(/\^nl-clock-[0-9a-f-]+/)?.[0] ?? "\0"),
    { clock: report.clockLine, close: report.closeLine });
  report.healedActiveTask = await poll(10_000, async () => {
    const surface = await activeTaskSurface();
    return surface.state !== "unavailable" ? surface : null;
  });
  check("pdf-active-task-heals-after-retry", report.healedActiveTask !== null
    && report.healedActiveTask?.state !== "unavailable", report.healedActiveTask);
  await screenshot("execution-plugin-data-recovered");
  return report;
}
