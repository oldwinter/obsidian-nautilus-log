// --ambiguous-owner scenario: a running CLOCK whose owner block-id collides
// in the vault must fail closed — never guess which note is the owner —
// and must recover when the ambiguity is resolved.
//
// Contract: identityLookup reports {kind:"collision"} for a duplicated
// terminal ^block-id; the owner resolver returns non-eligible so
// projectClockIndex degrades "clock-owner-invalid"; any mutation targeting
// the ambiguous owner conflicts with "identity-collision" instead of
// writing. When the decoy's id is rewritten to a different value the same
// running CLOCK projects again and Clock Out composes normally.
//
// The decoy is created via vault.create so the index rebuild sees both
// locations deterministically; the collision is resolved by rewriting the
// decoy note (not deleting it), proving recovery does not depend on file
// removal. try/finally removes the decoy note even on mid-scenario failure.

import { readFile } from "node:fs/promises";
import { join } from "node:path";

const DECOY_NOTE = "ambiguous-owner-decoy.md";
const DECOY_ID = "^nl-99999999-9999-4999-8999-999999999999";

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

export async function runAmbiguousOwner({ page, fixture, vault, openExecution, check, screenshot, out: report }) {
  await openExecution();
  const timingTab = page.getByRole("tabpanel", { name: "Timing" });
  const timingSurface = () => page.evaluate(() => {
    const roots = [...document.querySelectorAll(".spiral-day-execution")];
    const root = roots[0];
    const empty = root?.querySelector(".spiral-day-execution__empty");
    const current = root?.querySelector(".spiral-day-execution__current");
    const buttons = [...(root?.querySelectorAll("button") ?? [])];
    return {
      rootCount: roots.length,
      currentPresent: Boolean(current),
      currentHeading: current?.querySelector(".spiral-day-execution__current-heading")?.textContent ?? null,
      emptyHeading: empty?.querySelector("strong")?.textContent ?? null,
      emptyDetail: empty?.querySelector("p")?.textContent ?? null,
      retryLabel: empty?.querySelector("button")?.getAttribute("aria-label") ?? null,
      clockOutVisible: Boolean(buttons.find((button) => button.getAttribute("aria-label") === "Clock out")),
      clockOutCount: document.querySelectorAll('button[aria-label="Clock out"]').length,
      clockOutA11y: [...document.querySelectorAll('button[aria-label="Clock out"]')].map((button) => ({
        disabled: button.disabled,
        hidden: button.closest("[hidden],[inert],[aria-hidden=true]") !== null,
        rect: button.getBoundingClientRect().width > 0,
      })),
      buttonLabels: buttons.map((button) => button.getAttribute("aria-label")),
      disabledLabels: buttons.filter((button) => button.disabled)
        .map((button) => button.getAttribute("aria-label")),
      busyButtons: root?.querySelectorAll("button[aria-busy=true]").length ?? 0,
    };
  });
  // "Timing unavailable" is the status.degraded heading — status.stale shows
  // "Refreshing" in the same slot, so this discriminates the two states.
  const degradedSurface = () => poll(10_000, async () => {
    const surface = await timingSurface();
    return surface.retryLabel === "Try again" && surface.emptyHeading === "Timing unavailable" ? surface : null;
  });

  // Clock in Alpha and extract its real ^nl- owner id from the persisted note.
  await page.getByRole("tab", { name: "Plan", exact: true }).click();
  const planTab = page.getByRole("tabpanel", { name: "Plan" });
  await planTab.getByRole("button", { name: "Clock in" }).first().waitFor();
  const alphaRow = planTab.locator("li.spiral-day-execution__plan-row", { hasText: "Host fixture Alpha" }).first();
  await alphaRow.getByRole("button", { name: /clock in/i }).click();
  report.runningSource = await poll(10_000, async () => {
    const source = await readFile(join(vault, fixture.today.path), "utf8");
    return /CLOCK: \[[^\]]+\]\s*\^nl-clock-/.test(source) ? source : null;
  });
  check("ao-clock-in-persisted", report.runningSource !== null, fixture.today.path);
  report.ownerId = report.runningSource.split("\n")
    .find((line) => line.includes("Host fixture Alpha"))?.match(/\^(nl-[\w-]+)/)?.[1] ?? null;
  check("ao-owner-id-extracted", report.ownerId !== null, { ownerId: report.ownerId });

  try {
    // Duplicate the owner's block-id in a second note: the identity index now
    // reports the owner as a collision — an ambiguous target.
    await page.evaluate(async ({ path, ownerId }) => {
      await app.vault.create(path, `- [x] Decoy completed elsewhere ^${ownerId}\n`);
    }, { path: DECOY_NOTE, ownerId: report.ownerId });
    report.collisionTiming = await degradedSurface();
    check("ao-collision-degrades-surface", report.collisionTiming !== null
      && report.collisionTiming.clockOutVisible === false
      && report.collisionTiming.currentPresent === false
      && report.collisionTiming.busyButtons === 0, report.collisionTiming);

    // Fail-closed: neither note may be written while the owner is ambiguous —
    // the running CLOCK record stays open, the decoy keeps only my bytes.
    const todayDuring = await readFile(join(vault, fixture.today.path), "utf8");
    const decoyDuring = await readFile(join(vault, DECOY_NOTE), "utf8");
    check("ao-collision-writes-nothing", todayDuring === report.runningSource
      && decoyDuring === `- [x] Decoy completed elsewhere ^${report.ownerId}\n`,
      { todayChanged: todayDuring !== report.runningSource, decoyText: decoyDuring });
    await screenshot("execution-ambiguous-owner");

    // Resolve the ambiguity: the decoy gets a different terminal block-id.
    // The same running CLOCK must project again — recovery from an ambiguous
    // owner does not strand the session.
    await page.evaluate(async ({ path, decoyId }) => {
      const file = app.vault.getAbstractFileByPath(path);
      await app.vault.modify(file, `- [x] Decoy completed elsewhere ${decoyId}\n`);
    }, { path: DECOY_NOTE, decoyId: DECOY_ID });
    report.recoveredTiming = await poll(10_000, async () => {
      const surface = await timingSurface();
      return surface.currentPresent === true && surface.currentHeading?.includes("Alpha") ? surface : null;
    });
    check("ao-resolution-recovers-clock", report.recoveredTiming !== null
      && report.recoveredTiming.clockOutVisible === true, report.recoveredTiming);

    // The active tab is Plan since clock-in — the Timing panel (with the
    // current-task row) is rendered but hidden. Switch to it before the
    // gesture; the accessible Clock Out only exists in the visible panel.
    await page.getByRole("tab", { name: "Timing", exact: true }).click();

    // Clock Out composes the close in today's note only; the decoy is untouched.
    // Poll for an enabled button: the recovered surface renders the current
    // task immediately but the confirmed publish settles asynchronously.
    const clockOutButton = page.getByRole("button", { name: "Clock out" });
    const observedButtons = new Set();
    report.clockOutEnabled = await poll(10_000, async () => {
      const surface = await timingSurface();
      for (const name of surface.buttonLabels ?? []) observedButtons.add(name);
      return clockOutButton.isEnabled().then((enabled) => enabled || null).catch(() => null);
    });
    check("ao-clock-out-actionable", report.clockOutEnabled === true,
      { enabled: report.clockOutEnabled, observedButtons: [...observedButtons],
        roleCount: await clockOutButton.count(), surface: await timingSurface() });
    await clockOutButton.click();
    report.closedSource = await poll(10_000, async () => {
      const source = await readFile(join(vault, fixture.today.path), "utf8");
      return source.split("\n").some((line) => line.includes("CLOCK") && /--\[/.test(line)) ? source : null;
    });
    check("ao-clock-out-composed", report.closedSource !== null, fixture.today.path);
    const closedLine = report.closedSource?.split("\n").find((line) => line.includes("CLOCK")) ?? "";
    const decoyAfter = await readFile(join(vault, DECOY_NOTE), "utf8");
    check("ao-close-preserves-decoy", /--\[.+\] => \d/.test(closedLine)
      && /\^nl-clock-/.test(closedLine)
      && decoyAfter === `- [x] Decoy completed elsewhere ${DECOY_ID}\n`,
      { closedLine, decoyText: decoyAfter });
  } finally {
    await page.evaluate(async (path) => {
      const file = app.vault.getAbstractFileByPath(path);
      if (file) await app.vault.delete(file);
    }, DECOY_NOTE).catch(() => {});
  }
  await screenshot("execution-ambiguous-owner-recovered");
}
