export const PLANNER_TYPE = "spiral-day-planner";

export async function ownershipCounts(page, pluginId) {
  return page.evaluate(({ pluginId, plannerType }) => ({
    loaded: Boolean(app.plugins.plugins[pluginId]),
    commands: Object.keys(app.commands.commands).filter((id) => id.startsWith(`${pluginId}:`)).sort(),
    executionTriggers: document.querySelectorAll(".spiral-day-execution-trigger").length,
    executionPanels: document.querySelectorAll(".spiral-day-execution").length,
    plannerRoots: document.querySelectorAll(".spiral-day-planner-view").length,
    plannerLeaves: app.workspace.getLeavesOfType(plannerType).length,
  }), { pluginId, plannerType: PLANNER_TYPE });
}

export async function runLifecycleCycles({ page, pluginId, openPlanner, openExecution, check, screenshot }) {
  const cycles = [];
  for (let cycle = 1; cycle <= 10; cycle += 1) {
    await openPlanner();
    await openExecution();
    const loaded = await ownershipCounts(page, pluginId);
    check(`lifecycle-${cycle}-loaded`, loaded.loaded && loaded.executionTriggers === 1
      && loaded.executionPanels === 1 && loaded.commands.length === 3
      && loaded.plannerLeaves === 1 && loaded.plannerRoots === 1, loaded);
    await page.keyboard.press("Escape");
    await page.evaluate(async ({ pluginId, plannerType }) => {
      app.workspace.detachLeavesOfType(plannerType);
      await app.plugins.disablePluginAndSave(pluginId);
    }, { pluginId, plannerType: PLANNER_TYPE });
    await page.waitForFunction((pluginId) => !app.plugins.plugins[pluginId]
      && !document.querySelector(".spiral-day-execution-trigger"), pluginId);
    const unloaded = await ownershipCounts(page, pluginId);
    check(`lifecycle-${cycle}-unloaded`, !unloaded.loaded && unloaded.commands.length === 0
      && unloaded.executionTriggers === 0 && unloaded.executionPanels === 0
      && unloaded.plannerLeaves === 0 && unloaded.plannerRoots === 0, unloaded);
    if (cycle === 10) await screenshot("lifecycle-unloaded");
    await page.evaluate((pluginId) => app.plugins.enablePluginAndSave(pluginId), pluginId);
    await page.locator(".spiral-day-execution-trigger").waitFor();
    cycles.push({ cycle, loaded, unloaded });
  }
  return cycles;
}

export async function runClockReload({ page, fixture, openExecution, check, screenshot, readSource, verifyIsolation }) {
  const beforeSource = await readSource(() => true);
  const clockOut = page.getByRole("tabpanel", { name: "Timing", exact: true })
    .getByRole("button", { name: "Clock out", exact: true });
  await openExecution();
  await page.getByRole("tab", { name: "Plan", exact: true }).click();
  const alpha = page.locator(".spiral-day-execution__plan-row").filter({
    has: page.getByRole("button", { name: "Host fixture Alpha", exact: true }),
  });
  await alpha.getByRole("button", { name: "Clock in", exact: true }).click();
  await page.getByRole("tab", { name: "Timing", exact: true }).click();
  await clockOut.waitFor();
  const clockInSource = await readSource((source) => source.split("CLOCK:").length === beforeSource.split("CLOCK:").length + 1);
  const clockLines = clockInSource.split("\n").filter((line) => line.includes("CLOCK:") && !beforeSource.includes(line));
  check("clock-in-one-open-record", clockLines.length === 1 && !clockLines[0].includes("]--["), clockLines);
  await screenshot("clock-active");
  await page.keyboard.press("Escape");
  await page.reload();
  await page.waitForFunction(() => globalThis.app?.workspace?.layoutReady === true);
  await verifyIsolation();
  await page.locator(".spiral-day-execution-trigger").waitFor();
  await openExecution();
  await page.getByRole("tab", { name: "Timing", exact: true }).click();
  await clockOut.waitFor();
  const reloadSource = await readSource((source) => source.includes("CLOCK:"));
  check("active-clock-reload-preserves-source", reloadSource === clockInSource, { path: fixture.today.path });
  check("active-clock-reload-restores-task", await page.locator(".spiral-day-execution-trigger").getAttribute("aria-label")
    .then((label) => label.includes("Host fixture Alpha")), "Host fixture Alpha");
  await screenshot("clock-restored-after-reload");
  await clockOut.click();
  await clockOut.waitFor({ state: "hidden" });
  const clockOutSource = await readSource((source) => source.split("\n")
    .some((line) => line.includes("CLOCK:") && !beforeSource.includes(line) && line.includes("]--[")));
  const closed = clockOutSource.split("\n").filter((line) => line.includes("CLOCK:") && !beforeSource.includes(line));
  check("clock-out-closes-same-record", closed.length === 1 && closed[0].includes("]--[")
    && closed[0].split("^").at(-1) === clockLines[0].split("^").at(-1), closed);
  await screenshot("clock-stopped");
  return { beforeSource, clockInSource, reloadSource, clockOutSource };
}
