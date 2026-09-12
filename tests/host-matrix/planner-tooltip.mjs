export async function observePlannerTooltip({ page, pageErrors, screenshot }) {
  const target = page.locator(".spiral-day-planner__external-label")
    .filter({ hasText: "Host fixture Alpha" }).first();
  await target.waitFor();
  const before = await target.evaluate((element) => ({
    tag: element.tagName, namespace: element.namespaceURI,
    ariaLabel: element.getAttribute("aria-label"),
    title: element.querySelector("title")?.textContent ?? null,
    role: element.getAttribute("role"),
    box: element.getBoundingClientRect().toJSON(),
    isShownType: typeof element.isShown,
  }));
  const accessibleTree = await target.ariaSnapshot();
  const priorErrorCount = pageErrors.length;
  await target.hover();
  const hovered = await page.evaluate(() => [...document.querySelectorAll(":hover")]
    .filter((element) => element.closest(".spiral-day-planner__spiral"))
    .map((element) => ({ tag: element.tagName, namespace: element.namespaceURI,
      class: element.getAttribute("class"), ariaLabel: element.getAttribute("aria-label"),
      title: element.querySelector(":scope > title")?.textContent ?? null,
      isShownType: typeof element.isShown })));
  const started = Date.now();
  await new Promise((resolve) => setTimeout(resolve, 900));
  const elapsedMilliseconds = Date.now() - started;
  await screenshot("planner-svg-tooltip-hover");
  const result = { target: before, accessibleTree, hovered, elapsedMilliseconds,
    newPageErrors: pageErrors.slice(priorErrorCount),
    hostTooltips: await page.locator(".tooltip").allTextContents(),
    plannerTooltips: await page.locator(".spiral-day-planner__tooltip:visible").allTextContents() };
  await page.mouse.move(1, 1);
  return result;
}
