const messages = {
  en: { tab: "Review", date: "Review date", previous: "Previous day", next: "Next day", today: "Today",
    refresh: "Refresh review", complete: "Complete", clockIn: "Clock in", planned: "Planned", actual: "Actual", variance: "Variance" },
  zh: { tab: "回顾", date: "回顾日期", previous: "前一天", next: "后一天", today: "今天",
    refresh: "刷新回顾", complete: "完成任务", clockIn: "开始计时", planned: "计划用时", actual: "实际用时", variance: "用时差异" },
};

export async function openReview(page, openExecution, locale = "en") {
  await openExecution();
  await page.getByRole("tab", { name: messages[locale].tab, exact: true }).click();
  await page.locator(".spiral-day-review__list").waitFor();
  await page.locator(".spiral-day-review[aria-busy=false]").waitFor();
}

function reviewRow(page, title) {
  return page.locator(".spiral-day-review__row").filter({
    has: page.locator(".spiral-day-review__title", { hasText: title }),
  });
}

async function changeLanguage(page, locale) {
  await page.keyboard.press("Escape");
  await page.evaluate(async () => { await app.setting.open(); app.setting.openTabById("spiral-day"); });
  let settingsPage;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    for (const candidate of page.context().pages()) {
      if (await candidate.locator(".mod-settings").isVisible()) settingsPage = candidate;
    }
    if (settingsPage) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!settingsPage) throw new Error(`Native settings window unavailable. ${JSON.stringify(await page.evaluate(() => ({
    connected: app.setting.containerEl.isConnected, sameDocument: app.setting.containerEl.ownerDocument === document,
    title: app.setting.containerEl.ownerDocument.title, text: app.setting.containerEl.textContent,
  })))}`);
  const language = settingsPage.locator(".setting-item").filter({
    has: settingsPage.locator(".setting-item-name", { hasText: /^(Language|语言)$/ }),
  }).getByRole("combobox");
  await language.selectOption(locale);
  await page.waitForFunction(({ locale }) => document.querySelector(".spiral-day-execution-trigger")
    ?.getAttribute("aria-label")?.startsWith(locale === "en" ? "Execution" : "执行"), { locale });
  await page.evaluate(() => app.setting.close());
}

async function selectDate(page, day, locale = "en") {
  const input = page.getByLabel(messages[locale].date, { exact: true });
  await input.fill(day.path.slice(0, -3));
  await input.press("Tab");
  await reviewRow(page, `Host fixture Review ${day.relation}`).waitFor();
  await page.locator(".spiral-day-review[aria-busy=false]").waitFor();
}

async function reviewControlsAfterScroll(page) {
  const controls = page.locator(".spiral-day-review button:visible, .spiral-day-review input:visible");
  const observations = [];
  for (const control of await controls.all()) {
    await control.scrollIntoViewIfNeeded();
    observations.push(await control.evaluate((element) => {
      const rect = element.getBoundingClientRect().toJSON();
      const clip = { left: 0, top: 0, right: innerWidth, bottom: innerHeight };
      const ancestors = [];
      for (let ancestor = element.parentElement; ancestor; ancestor = ancestor.parentElement) {
        const style = getComputedStyle(ancestor);
        if (!/(auto|scroll|hidden|clip)/.test(`${style.overflowX} ${style.overflowY}`)) continue;
        const bounds = ancestor.getBoundingClientRect();
        const area = { left: bounds.left + ancestor.clientLeft, top: bounds.top + ancestor.clientTop,
          right: bounds.left + ancestor.clientLeft + ancestor.clientWidth,
          bottom: bounds.top + ancestor.clientTop + ancestor.clientHeight };
        if (/(auto|scroll|hidden|clip)/.test(style.overflowX)) {
          clip.left = Math.max(clip.left, area.left);
          clip.right = Math.min(clip.right, area.right);
        }
        if (/(auto|scroll|hidden|clip)/.test(style.overflowY)) {
          clip.top = Math.max(clip.top, area.top);
          clip.bottom = Math.min(clip.bottom, area.bottom);
        }
        ancestors.push({ className: ancestor.className, scrollTop: ancestor.scrollTop,
          clientHeight: ancestor.clientHeight, scrollHeight: ancestor.scrollHeight, area });
      }
      const centerElement = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
      return { label: element.getAttribute("aria-label") || element.textContent, rect, clip, ancestors,
        fullyVisible: rect.width > 0 && rect.height > 0 && rect.left >= clip.left - 1
          && rect.right <= clip.right + 1 && rect.top >= clip.top - 1 && rect.bottom <= clip.bottom + 1,
        centerExposed: element === centerElement || element.contains(centerElement) };
    }));
  }
  return observations;
}

export async function runReviewReadOnly({ page, fixture, openExecution, check, screenshot, markdownHashes }) {
  const before = await markdownHashes();
  const states = [];
  await openReview(page, openExecution);
  for (const day of fixture.days) {
    await selectDate(page, day);
    const rows = page.locator(".spiral-day-review__row");
    check(`review-${day.relation}-rows`, await rows.count() === 4, await rows.count());
    const actions = page.locator(".spiral-day-review__actions button:not([hidden])");
    const disabled = await actions.evaluateAll((elements) => elements.map((element) => element.disabled));
    check(`review-${day.relation}-action-gate`, disabled.length === 6
      && disabled.every((value) => value === (day.relation !== "today")), disabled);
    if (day.relation === "past") {
      const metrics = await reviewRow(page, "Host fixture Complete").locator("dd[data-metric]").allTextContents();
      check("review-past-recorded-metrics", JSON.stringify(metrics) === JSON.stringify(["10m", "12m", "+2m"]), metrics);
    }
    const title = reviewRow(page, `Host fixture Review ${day.relation}`).locator(".spiral-day-review__title");
    await title.focus();
    await title.press("Enter");
    await page.waitForFunction((path) => app.workspace.getActiveFile()?.path === path, day.path);
    check(`review-${day.relation}-source-target`, true, day.path);
    await openReview(page, openExecution);
    check(`review-${day.relation}-selection-retained`, await page.getByLabel("Review date", { exact: true })
      .inputValue() === day.path.slice(0, -3), day.path);
    await screenshot(`review-${day.relation}`);
  }
  await page.getByRole("button", { name: "Today", exact: true }).click();
  await reviewRow(page, "Host fixture Review today").waitFor();
  const next = page.getByRole("button", { name: "Next day", exact: true });
  await next.focus();
  await next.press("Enter");
  await reviewRow(page, "Host fixture Review future").waitFor();
  check("review-date-button-keeps-keyboard-focus", await next.evaluate((element) => element === document.activeElement), "Next day");
  const focus = await next.evaluate((element) => ({ style: getComputedStyle(element).outlineStyle,
    width: getComputedStyle(element).outlineWidth, visible: element.matches(":focus-visible") }));
  check("review-date-button-visible-focus", focus.visible && focus.style !== "none" && parseFloat(focus.width) > 0, focus);
  await page.getByRole("button", { name: "Previous day", exact: true }).click();
  await reviewRow(page, "Host fixture Review today").waitFor();
  for (const locale of ["en", "zh"]) {
    await changeLanguage(page, locale);
    for (const theme of ["light", "dark"]) {
      await page.evaluate((theme) => app.changeTheme(theme === "light" ? "moonstone" : "obsidian"), theme);
      await page.waitForFunction((theme) => document.body.classList.contains(`theme-${theme}`), theme);
      for (const zoom of [0.8, 1, 2]) {
        await page.evaluate((zoom) => require("electron").webFrame.setZoomFactor(zoom), zoom);
        await openReview(page, openExecution, locale);
        await reviewRow(page, "Host fixture Review today").waitFor();
        await page.getByLabel(messages[locale].date, { exact: true }).scrollIntoViewIfNeeded();
        const observed = await page.evaluate(() => {
          const panel = document.querySelector(".spiral-day-execution");
          const root = document.querySelector(".spiral-day-review");
          const scroll = root.closest(".spiral-day-execution__tabpanel");
          return { zoom: require("electron").webFrame.getZoomFactor(),
            theme: document.body.classList.contains("theme-dark") ? "dark" : "light",
            panelWidth: panel.clientWidth, panelScrollWidth: panel.scrollWidth,
            reviewWidth: root.clientWidth, reviewScrollWidth: root.scrollWidth,
            panelBounds: panel.getBoundingClientRect().toJSON(),
            scrollBounds: scroll.getBoundingClientRect().toJSON(),
            scroll: { top: scroll.scrollTop, clientHeight: scroll.clientHeight, scrollHeight: scroll.scrollHeight },
            dateLabel: root.querySelector("input[type=date]").getAttribute("aria-label"),
            metricLabels: [...root.querySelectorAll(".spiral-day-review__metrics dt")].map((element) => element.textContent),
            text: root.textContent, innerWidth, innerHeight, devicePixelRatio };
        });
        check(`review-${locale}-${theme}-${zoom}-native-settings`, Math.abs(observed.zoom - zoom) < 0.001
          && observed.theme === theme && observed.dateLabel === messages[locale].date, observed);
        check(`review-${locale}-${theme}-${zoom}-localized-metrics`, observed.metricLabels.length === 12
          && [messages[locale].planned, messages[locale].actual, messages[locale].variance]
            .every((label) => observed.metricLabels.includes(label))
          && !/\b(?:state|metric|date|action)\.[a-z]/.test(observed.text), observed.metricLabels);
        check(`review-${locale}-${theme}-${zoom}-horizontal-fit`, observed.panelWidth > 0
          && observed.panelScrollWidth <= observed.panelWidth + 1
          && observed.reviewScrollWidth <= observed.reviewWidth + 1, observed);
        const label = `review-${locale}-${theme}-${Math.round(zoom * 100)}`;
        await screenshot(label);
        check(`review-${locale}-${theme}-${zoom}-popover-inside-viewport`, observed.panelBounds.left >= -1
          && observed.panelBounds.top >= -1 && observed.panelBounds.right <= observed.innerWidth + 1
          && observed.panelBounds.bottom <= observed.innerHeight + 1, observed);
        const controls = await reviewControlsAfterScroll(page);
        await screenshot(`${label}-last-control`);
        check(`review-${locale}-${theme}-${zoom}-controls-reachable-through-scroll`, controls.length > 0
          && controls.every((control) => control.fullyVisible && control.centerExposed)
          && (observed.scroll.scrollHeight <= observed.scroll.clientHeight + 1
            || controls.some((control) => control.ancestors.some((ancestor) => ancestor.scrollTop > 0))), controls);
        states.push({ locale, theme, zoom, observed, controls });
      }
    }
  }
  await page.evaluate(() => require("electron").webFrame.setZoomFactor(1));
  await changeLanguage(page, "en");
  await openReview(page, openExecution);
  await page.getByRole("button", { name: "Refresh review", exact: true }).focus();
  await page.keyboard.press("Escape");
  check("review-escape-restores-trigger", await page.locator(".spiral-day-execution-trigger")
    .evaluate((element) => element === document.activeElement), "Execution ribbon trigger");
  const after = await markdownHashes();
  check("review-read-only-preserves-all-markdown", JSON.stringify(before) === JSON.stringify(after), after);
  return { before, after, states };
}

export async function runReviewWrites({ page, fixture, openExecution, check, screenshot, markdownHashes, readSource, verifyIsolation, saveSources }) {
  const before = await markdownHashes();
  const beforeSource = await readSource(() => true);
  await openReview(page, openExecution);
  await page.getByRole("button", { name: "Today", exact: true }).click();
  const row = reviewRow(page, "Host fixture Review today");
  await row.waitFor();
  const clockIn = row.getByRole("button", { name: "Clock in", exact: true });
  await clockIn.focus();
  const clockActionAt = performance.now();
  await clockIn.press("Enter");
  await page.waitForFunction(() => document.querySelector(".spiral-day-execution-trigger")
    ?.getAttribute("aria-label")?.includes("Host fixture Review today"));
  const activeSource = await readSource((source) => source.split("CLOCK:").length === beforeSource.split("CLOCK:").length + 1);
  check("review-clock-in-persists-one-record", activeSource !== beforeSource, fixture.today.path);
  await openReview(page, openExecution);
  await row.scrollIntoViewIfNeeded();
  check("review-clock-first-minute-has-no-rounded-actual", await row.getAttribute("data-state") === "not-started"
    && await row.locator("dd[data-metric=actual]").textContent() === "—", "Not started, actual unavailable before one whole minute");
  await screenshot("review-clock-before-whole-minute");
  console.log("Review CLOCK is persisted. Waiting for one real elapsed minute before checking Live and Actual 1m.");
  await page.waitForFunction(() => [...document.querySelectorAll(".spiral-day-review__row")]
    .find((element) => element.querySelector(".spiral-day-review__title")?.textContent === "Host fixture Review today")?.dataset.state === "live", undefined, { timeout: 75000 });
  check("review-clock-in-renders-live", await row.getAttribute("data-state") === "live", "Host fixture Review today");
  check("review-live-first-whole-minute", await row.locator("dd[data-metric=actual]").textContent() === "1m", "1m");
  const observedLiveAfterMilliseconds = performance.now() - clockActionAt;
  check("review-live-used-real-elapsed-minute", observedLiveAfterMilliseconds >= 60000, observedLiveAfterMilliseconds);
  await screenshot("review-clock-active");
  await row.getByRole("button", { name: "Complete", exact: true }).click();
  const completeSource = await readSource((source) => source.includes("- [x] Host fixture Review today")
    && !source.split("\n").some((line) => line.includes("CLOCK:") && !line.includes("]--[")));
  await page.waitForFunction(() => [...document.querySelectorAll(".spiral-day-review__row")]
    .find((element) => element.querySelector(".spiral-day-review__title")?.textContent === "Host fixture Review today")?.dataset.state === "compared");
  check("review-complete-renders-compared", await row.getAttribute("data-state") === "compared", await row.locator("dd").allTextContents());
  const newClock = completeSource.split("\n").filter((line) => line.includes("CLOCK:") && !beforeSource.includes(line));
  check("review-complete-closes-same-record", newClock.length === 1 && newClock[0].includes("]--[")
    && activeSource.includes(`^${newClock[0].split("^").at(-1)}`), newClock);
  check("review-complete-preserves-other-bytes", completeSource
    .replace("- [x] Host fixture Review today", "- [ ] Host fixture Review today")
    .replace(`  - LOGBOOK::\n${newClock[0]}\n`, "") === beforeSource, fixture.today.path);
  await screenshot("review-completed");
  const sourceEvidence = { before, beforeSource, activeSource, completeSource, observedLiveAfterMilliseconds };
  await saveSources(sourceEvidence);
  await selectDate(page, fixture.days[0]);
  await page.keyboard.press("Escape");
  await page.reload();
  await page.waitForFunction(() => globalThis.app?.workspace?.layoutReady === true);
  await verifyIsolation();
  await page.locator(".spiral-day-execution-trigger").waitFor();
  await openReview(page, openExecution);
  await row.waitFor();
  check("review-reload-resets-selection-to-today", await page.getByLabel("Review date", { exact: true })
    .inputValue() === fixture.today.path.slice(0, -3), fixture.today.path);
  check("review-reload-restores-completed-task", await row.getAttribute("data-state") === "compared", "Host fixture Review today");
  const afterReloadSource = await readSource(() => true);
  check("review-reload-preserves-completed-source", afterReloadSource === completeSource, fixture.today.path);
  const after = await markdownHashes();
  check("review-writes-only-today", Object.keys(before).length === Object.keys(after).length
    && Object.keys(before).every((path) => path === fixture.today.path || before[path].sha256 === after[path]?.sha256), after);
  await screenshot("review-completed-after-reload");
  await page.keyboard.press("Escape");
  return { ...sourceEvidence, after, afterReloadSource };
}
