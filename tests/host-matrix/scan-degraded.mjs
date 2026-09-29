// --scan-degraded scenario: an unreadable markdown source under a real OS
// fault must degrade the execution surface honestly and fail closed — never
// silent-drop vault content — until the source is readable again.
//
// Contract: WorkspaceIndexIncompleteReason "source-read-failed" marks the
// index incomplete -> clock-index-unavailable degraded snapshot ->
// writeBlocked fail-closed. Vault events publish stale then refresh
// asynchronously, which heals the surface once reads succeed again.
//
// Fault injection: the plugin reads sources through vault.cachedRead, which
// serves Obsidian's content cache (KD map) without touching the filesystem
// on a hit — chmod on an already-indexed note is therefore invisible to the
// scan. The deterministic fault is a file written to disk and chmod 000'd
// before Obsidian ever reads it: the watcher registers the TFile (stat only,
// no content read), so every cachedRead is a cache miss that falls through
// to adapter.read -> deterministic EACCES on every rebuild.
// try/finally restores permissions and removes the scratch files even when
// an assertion fails mid-scenario.

import { chmod, writeFile } from "node:fs/promises";
import { join } from "node:path";

const FAULT_NOTE = "scan-degraded-fault.md";
const TRIGGER_NOTE = "scan-degraded-trigger.md";

// Obsidian's adapter logs "Error: EACCES ... open '<fault path>'" to the
// console when its indexer touches the unreadable file — the honest symptom
// of the injected fault. The runner subtracts these declared patterns from
// no-renderer-console-errors; every event is still preserved in report.console.
export const expectedConsoleErrorPatterns = [
  /EACCES: permission denied, open '[^\n']*scan-degraded-fault\.md'/,
];

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

export async function runScanDegraded({ page, vault, openExecution, check, screenshot, markdownHashes, out: report }) {
  const faultPath = join(vault, FAULT_NOTE);
  await openExecution();
  const timingTab = page.getByRole("tabpanel", { name: "Timing" });
  const retryButton = timingTab.locator(".spiral-day-execution__empty button");
  const timingSurface = () => page.evaluate(() => {
    const root = document.querySelector(".spiral-day-execution");
    const empty = root?.querySelector(".spiral-day-execution__empty");
    const buttons = [...(root?.querySelectorAll("button") ?? [])];
    const feedback = root?.querySelector(".spiral-day-execution__feedback");
    return {
      currentPresent: Boolean(root?.querySelector(".spiral-day-execution__current")),
      emptyHeading: empty?.querySelector("strong")?.textContent ?? null,
      emptyDetail: empty?.querySelector("p")?.textContent ?? null,
      retryLabel: empty?.querySelector("button")?.getAttribute("aria-label") ?? null,
      startPomoVisible: Boolean(buttons.find((button) => button.getAttribute("aria-label") === "Start POMO")),
      busyButtons: root?.querySelectorAll("button[aria-busy=true]").length ?? 0,
      feedback: {
        visible: Boolean(feedback && !feedback.hidden && (feedback.textContent?.length ?? 0) > 0),
        kind: feedback?.dataset?.kind ?? null,
        level: feedback?.dataset?.level ?? null,
      },
    };
  });
  const openActiveTaskLeaf = async () => {
    await page.evaluate(async () => {
      const leaf = app.workspace.getLeavesOfType("spiral-day-active-task")[0] ?? app.workspace.getLeaf("tab");
      await leaf.setViewState({ type: "spiral-day-active-task", active: true });
      await app.workspace.revealLeaf(leaf);
    });
    await page.locator(".spiral-day-active-task").waitFor();
  };
  const activeTaskSurface = () => page.evaluate(() => ({
    state: document.querySelector(".spiral-day-active-task")?.dataset?.state ?? null,
    detailText: document.querySelector(".spiral-day-active-task__details p")?.textContent ?? null,
  }));
  // "Timing unavailable" is the status.degraded heading — status.stale shows
  // "Refreshing" in the same slot, so this discriminates the two states.
  const degradedSurface = () => poll(10_000, async () => {
    const surface = await timingSurface();
    return surface.retryLabel === "Try again" && surface.emptyHeading === "Timing unavailable" ? surface : null;
  });

  const beforeFault = await markdownHashes();

  // The fault file lands on disk unreadable before Obsidian knows it exists.
  await writeFile(faultPath, "- [ ] never-cached source\n");
  await chmod(faultPath, 0o000);
  try {
    // The fs watcher registers the TFile without reading content; a cachedRead
    // on it is a guaranteed cache miss -> adapter.read -> EACCES.
    report.faultDiscovered = await poll(10_000, () =>
      page.evaluate((path) => Boolean(app.vault.getAbstractFileByPath(path)), FAULT_NOTE));
    check("sd-fault-file-discovered", report.faultDiscovered === true, { discovered: report.faultDiscovered });

    // Evidence that the fault actually reaches the filesystem leg of reads.
    report.adapterProbe = await page.evaluate(async (path) => {
      const file = app.vault.getAbstractFileByPath(path);
      const probe = { fileCached: Boolean(file) };
      try { await app.vault.adapter.read(path); probe.adapterRead = "ok"; }
      catch (error) { probe.adapterRead = `${error?.name ?? "Error"}:${error?.code ?? error?.message ?? "unknown"}`; }
      try { probe.cachedRead = file ? `ok:${(await app.vault.cachedRead(file)).length}` : "no-file"; }
      catch (error) { probe.cachedRead = `${error?.name ?? "Error"}:${error?.code ?? error?.message ?? "unknown"}`; }
      return probe;
    }, FAULT_NOTE);
    check("sd-fault-reaches-filesystem", report.adapterProbe.adapterRead === "Error:EACCES"
      && report.adapterProbe.cachedRead === "Error:EACCES", report.adapterProbe);

    // A vault change on an unrelated path schedules a workspace-index rebuild;
    // the unreadable fault file makes the rebuild incomplete -> degraded.
    await page.evaluate(async (path) => {
      await app.vault.create(path, "scratch trigger\n");
    }, TRIGGER_NOTE);
    report.degradedTiming = await degradedSurface();
    check("sd-degraded-timing-surface", report.degradedTiming !== null
      && report.degradedTiming.startPomoVisible === false, report.degradedTiming);
    check("sd-degraded-offers-no-mutations", report.degradedTiming !== null
      && report.degradedTiming.currentPresent === false
      && report.degradedTiming.busyButtons === 0, report.degradedTiming);

    // A second faulted rebuild via the same gesture stays degraded.
    await retryButton.click();
    report.stillDegraded = await degradedSurface();
    check("sd-retry-stays-degraded-while-unreadable", report.stillDegraded !== null
      && report.stillDegraded.startPomoVisible === false, report.stillDegraded);

    // The failed retry leaves refresh-owned feedback asynchronously; pinning
    // it here makes the post-recovery clear assertion non-vacuous.
    report.degradedFeedback = await poll(10_000, async () => {
      const surface = await timingSurface();
      return surface.feedback?.visible === true ? surface.feedback : null;
    });
    check("sd-degraded-refresh-warning-shown", report.degradedFeedback !== null
      && report.degradedFeedback.level === "warning", report.degradedFeedback);
    await screenshot("execution-scan-degraded");

    // Revealing the leaf closes the execution popover, so this runs last in
    // the faulted section. While the app snapshot stays degraded the leaf
    // must render unavailable — an "idle" leaf under degradation would
    // present an empty state the runtime cannot actually confirm.
    await openActiveTaskLeaf();
    const observedStates = [];
    report.degradedActiveTask = await poll(10_000, async () => {
      const surface = await activeTaskSurface();
      if (!observedStates.includes(surface.state)) observedStates.push(surface.state);
      return surface.state === "unavailable" ? surface : null;
    });
    check("sd-degraded-active-task", report.degradedActiveTask !== null
      && typeof report.degradedActiveTask.detailText === "string"
      && report.degradedActiveTask.detailText.length > 0,
      { surface: report.degradedActiveTask, observedStates });
  } finally {
    await chmod(faultPath, 0o644).catch(() => {});
  }

  // Deleting the fault file restores a fully readable vault: the delete event
  // publishes stale then refresh heals the surface back to Idle.
  await page.evaluate(async ({ fault, trigger }) => {
    for (const path of [fault, trigger]) {
      const file = app.vault.getAbstractFileByPath(path);
      if (file) await app.vault.delete(file);
    }
  }, { fault: FAULT_NOTE, trigger: TRIGGER_NOTE });
  await openExecution();
  report.recoveredTiming = await poll(10_000, async () => {
    const surface = await timingSurface();
    return surface.emptyHeading === "Idle" && surface.startPomoVisible === true ? surface : null;
  });
  check("sd-delete-heals-surface", report.recoveredTiming !== null, report.recoveredTiming);

  // The refresh-owned warning from the faulted retry must not survive a
  // confirmed-healthy snapshot — the recovery is driven by vault events, not
  // a panel gesture, so nothing else would clear the banner.
  report.recoveredFeedback = await poll(10_000, async () => {
    const surface = await timingSurface();
    return surface.feedback?.visible === false ? surface.feedback : null;
  });
  check("sd-recovered-warning-cleared", report.recoveredFeedback !== null, report.recoveredFeedback);
  report.recoveredActiveTask = await poll(10_000, async () => {
    const surface = await activeTaskSurface();
    return surface.state === "idle" ? surface : null;
  });
  check("sd-active-task-heals", report.recoveredActiveTask?.state === "idle", report.recoveredActiveTask);

  // The vault was never written by the plugin: fault injection and deletion
  // alone must not alter markdown bytes on any pre-existing note.
  report.afterRecovery = await markdownHashes();
  check("sd-markdown-bytes-unchanged",
    JSON.stringify(beforeFault) === JSON.stringify(report.afterRecovery), report.afterRecovery);

  await screenshot("execution-scan-degraded-recovered");
}
