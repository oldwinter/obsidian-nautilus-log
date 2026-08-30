# Packet 03: Accessibility and verification audit

The current Planner verification is unusually strong for rendered layout, but the
same confidence does not extend to Execution, native assistive technology, or the
machine-readable evidence map. The polish should preserve the Planner contracts,
add bounded browser assertions for the changed Execution/Active Task surfaces,
and report real Obsidian plus VoiceOver as separate evidence.

## Accepted

### Must-preserve contracts

| Area | Contract to preserve | Current authority |
| --- | --- | --- |
| Responsive | Compact at `<=520px`, wide at `>=521px`; `519/520/521px` are exact gates; `320/360px` remain reachable with no overlap or clipping. | `OBS-VIS-001`; `src/ui/planner/responsive-layout.ts`; `TC-OBS-VIS-001-001/002`; parity decision lines 125 and 210. |
| Layout source | Planner layout follows measured content width, not viewport width. | `plannerContainerWidth()` and `observePlannerContainer()`; `tests/ui/planner/responsive-layout.test.ts`; adapter wrapper checks at `320/519/520/521`. |
| Zoom and locale | `en` and `zh-CN` expose the same actions, states, and geometry at 100% and 200% zoom; no missing/fallback/raw key is releasable. | `OBS-I18N-001`; parity decision lines 130, 198, 214, and 236-240. |
| Keyboard and focus | Pointer actions have keyboard equivalents; focus is visible and deterministic; Execution uses a complete non-modal dialog/tab pattern; Escape restores trigger focus. | `OBS-A11Y-001`; `TC-OBS-A11Y-001-001`; `TC-UP-ERR-09-001`; `src/ui/planner/focus.ts`; `src/ui/execution/shared-controls.ts`. |
| Announcements | Status and write outcomes have named live/status semantics; non-loading planner failures are assertive. | Parity decision lines 127 and 213; `src/ui/planner/view.ts:1097`; `src/ui/planner/focus.ts`; `src/ui/execution/shared-controls.ts:67`. |
| Motion | Reduced motion removes nonessential animation and delay while preserving immediate state feedback. | `OBS-A11Y-001`; `tests/ui/planner-controls/playback.test.ts`; `styles/a11y.css`; `styles/execution.css`. |
| Theme | Light/dark, high-contrast/custom theme, and non-color state cues retain at least 4.5:1 text and 3:1 control/state/focus contrast. | `OBS-VIS-002`; parity decision lines 212 and 239; `TC-OBS-VIS-002-001`; `styles/theme.css`. |
| Visual evidence | Golden crops are plugin-owned, DPR 1, 100% zoom, controlled font/fake clock, delta 16, and at most 0.2% changed pixels. A semantic state, clipping, or overlap failure cannot be waived by the pixel threshold. | Parity decision lines 211 and 219-223; `tests/ui/planner-controls/env-vis-profile.json`; `comparePng()` in the ENV-VIS runner. |

### Existing coverage worth retaining

- `tests/ui/planner-controls/visual-harness.ts::runMatrix()` evaluates 168 semantic combinations: seven content widths (`300/320/360/519/520/521/900`) x two locales x four themes x three zoom levels (`0.8/1/2`). `assertAcceptance()` checks overflow, clipping, control overlap, tooltip viewport fit, unique focus keys, contrast, compact defaults, accessible targets, and localized control labels.
- `tests/ui/planner-controls/env-vis-profile.json` defines 11 reviewed Planner goldens spanning all required widths, both locales, both default themes, temporal/playback/tooltip/dense/topbar states, and one reduced-motion capture.
- Planner focus tests cover Enter/Space parity, roving tabs, Home/End/wrap behavior, focus restoration across the 520/521 transition, tooltip focus/zoom positioning, and teardown (`TC-OBS-A11Y-001-001`, `TC-UP-ERR-09-001`, and the browser interaction checks in `run-visual-evidence-container.mjs`).
- Planner localization has exact `shared`/`planner` key-set checks and fail-closed namespace registration. Execution has an exact catalog-key check and runtime locale switch (`tests/ui/execution/contracts.test.ts:9`).
- CSS already declares visible focus, reduced-motion, and forced-color branches for Planner, Execution, and Active Task. These declarations should remain, even though some branches still lack rendered proof.

## Rejected

- Reject `npm test` as a comprehensive UI gate. `esbuild.config.mjs:891-908` invokes only `tests/ui/execution/run.mjs`; Planner and Planner Controls pass only when their focused runners are called separately.
- Reject source-regex checks as proof of working Execution accessibility. `tests/ui/execution/contracts.test.ts` confirms strings such as `role="button"` and `trigger.focus()` exist, but it never mounts `mountExecutionPanel()` in a browser or exercises tab arrows, Escape, live announcements, focus return, clipping, or localized text fit.
- Reject the custom `high-contrast` class as proof of `@media (forced-colors: active)`. The ENV-VIS browser context never sets Playwright `forcedColors: "active"`; current forced-color tests only match CSS source.
- Reject `setReducedMotion(true)` alone as proof of the operating-system preference. It proves the Planner runtime seam, while the actual media query and the Execution/Active Task branch remain unexercised by a real emulated `prefers-reduced-motion` context.
- Reject blind use of `node tests/ui/planner-controls/run-visual-evidence.mjs --update` to make a visual change pass. The parity contract requires reviewed before/after images and a stated reason for every golden revision.
- Reject a universal 44px target gate as an undocumented parity requirement. The plugin is desktop-only and its current dense geometry is based on 32px controls. Preserve at least the current 32px hit boxes, then use a reviewed narrow/coarse-pointer enhancement (preferably 40-44px) if the visual implementation can retain the 320px and 519/520/521 contracts.
- Reject a full Cartesian screenshot explosion. Keep semantic assertions broad and goldens bounded; add representative screenshots only for states where visual hierarchy, clipping, or localization can regress.

## Decisions

### Required before calling this polish verified

1. Add browser-level Execution and Active Task assertions. The existing `tests/ui/execution/visual-harness.ts` mounts production surfaces, but `serve-visual-harness.mjs` is only a server. A bounded runner must prove:
   - open places focus on the selected tab;
   - ArrowLeft/ArrowRight/Home/End move selection and focus;
   - Escape and the close button restore trigger focus;
   - `aria-expanded`, dialog accessible name, tab/panel relationships, and localized accessible names are correct;
   - idle, active, forgotten, standalone POMO, stale/degraded, pending/disabled, delete-confirmation, success/failure feedback, long-list, Plan empty/unscheduled, Review placeholder, and Active Task unavailable states fit without viewport or horizontal clipping;
   - light/dark, `en`/`zh-CN`, narrow/wide, and 200% zoom are represented by a bounded pairwise matrix.
2. Add actual media emulation. Run one Planner and one Execution/Active Task case with Playwright `reducedMotion: "reduce"`, and one with `forcedColors: "active"`. Assert computed transition/animation delay and duration are zero, controls remain visible, focus outlines remain present, disabled state remains distinguishable, and text/actions do not disappear.
3. Add rendered target-size checks. Measure every visible button, summary, tab, and generic interactive target. No existing desktop target may fall below 32x32 CSS px; narrow/coarse-pointer controls should use the reviewed larger target without creating overlap. Current risks are the 32px Planner icons (`styles/a11y.css:1-7`), 32px disclosure summaries (`styles/planner.css:375-384`), 32px Execution actions (`styles/execution.css:240-253`), and 36px Execution tabs (`styles/execution.css:64-85`).
4. Add text-fit checks to the Execution runner. Planner already checks `scrollWidth`, bounding boxes, long Latin/CJK rails, and 200% zoom. Execution tabs currently ellipsize and its visual harness has no automated locale/zoom/overflow gate.
5. Repair evidence-ID drift before using the release matrix:
   - `TC-OBS-A11Y-001-003` is declared `MANUAL` in `docs/parity/requirements.json:4671`, but the same ID labels an automated tooltip-coordinate unit test in `focus.test.ts:150`.
   - `TC-OBS-I18N-001-002` is declared `SCREENSHOT` at `requirements.json:4800`, but labels three message-function unit tests at `i18n.test.ts:153/165/180`.
   - `TC-OBS-A11Y-001-004/005` exist in tests but are absent from the `OBS-A11Y-001` test list.
   - `UP-ERR-09` declares `TC-UP-ERR-09-001..004`; only `-001` appears in current UI tests. Browser, vault/integration, and manual/a11y evidence must not be inferred from the contract test.
6. Keep real Obsidian plus VoiceOver separate. `ENV-A11Y` requires current macOS, an exact VoiceOver version, reduced motion, and 200% zoom. Harness success is not a substitute. This can remain an explicit residual risk for a local polish run, but it blocks claiming G5/G6 release acceptance.

### Accessibility implementation risks to assert after the parent edits

- The Execution trigger has `aria-expanded` but no stable `aria-controls` or `aria-haspopup="dialog"`; add the relationship if the panel markup is touched and assert it in the browser runner.
- `renderActiveTaskSurface()` makes an `<article>` focusable and Enter/Space-activated while also nesting a real Open Source button. A generic article does not expose an actionable role, and assigning `role="button"` would create nested interactive controls. Prefer one explicit semantic action and assert one unambiguous tab stop.
- Execution action feedback reaches the polite live region, but passive runtime transitions to `starting`, `stale`, or `degraded` only rerender visible copy. Add an announcement assertion for those status changes; the parity contract requires every status/notice to have an accessible name or announcement.
- Planner controls are `opacity: 0.38` until hover/focus. Keyboard focus recovers visibility, but coarse-pointer users have no hover discovery. If retained, rendered QA must prove sufficient at-rest discoverability and contrast; otherwise raise the resting opacity without altering the control set.

### Bounded post-change matrix

| Surface | State coverage | Required axes | Evidence |
| --- | --- | --- | --- |
| Planner confirmed | temporal, playback, tooltip, dense, completed-hidden, collapsed, debug | Preserve current 168 semantic combinations; preserve the 11 goldens unless a reviewed visual change intentionally revises them. | Focused unit tests + ENV-VIS semantics + reviewed goldens. |
| Planner non-confirmed | loading, missing, hidden, stale, over-limit, unavailable, error | Both locales; 320, 520, 521; light/dark; 200% on at least the longest localized state. | DOM role/live assertions + clipping/text-fit checks; representative captures only. |
| Execution panel | idle, active, forgotten, POMO, stale/degraded, pending, confirmation, success/error, long list | Pairwise `en`/`zh-CN`, light/dark, 280/420px panel width, short viewport, 100/200% zoom. | Browser interaction/geometry assertions + a small golden set. |
| Active Task | active, forgotten/warning, unavailable, long title, narrow dock | Both locales; light/dark; <=260px container; 100/200% zoom. | Browser semantics, target size, clipping, keyboard path, and representative captures. |
| Media/a11y | reduced motion, forced colors, focus-visible, announcements | Planner + Execution + Active Task. | Actual media emulation, automated accessibility scan if an approved existing tool is available, then manual VoiceOver in real Obsidian. |

No automated accessibility engine such as axe is present in `package.json` or the current ENV-VIS runner. Under this workflow's no-dependency-upgrade constraint, add deterministic DOM/accessibility assertions now and report the missing critical/serious-violation scan. Adding an accessibility dependency requires the approval gate defined in the workflow.

## Risks

| Priority | Risk | Consequence |
| --- | --- | --- |
| P0 | Execution/Active Task has no automated browser/golden runner. | A CSS or markup change can pass all current tests while breaking focus, localized fit, short-height placement, or visual hierarchy. |
| P0 | Evidence IDs do not match actual evidence kinds. | G5/G6 can appear mapped while manual, screenshot, integration, or a11y evidence is absent. |
| P0 | No automated critical/serious accessibility scan and no current VoiceOver evidence. | `OBS-A11Y-001` and `ENV-A11Y` cannot be claimed complete. |
| P1 | Forced-color and OS reduced-motion CSS is source-checked, not rendered under the actual media features. | A syntactically present branch may be visually unusable or overridden. |
| P1 | Execution status transitions are not demonstrably announced. | Screen-reader users may miss stale/degraded/write outcome state changes. |
| P1 | Execution locale equality is tested, but rendered Chinese expansion and 200% zoom are not. | Tabs/actions can truncate, hide, or overlap even though key sets are equal. |
| P1 | 32px controls and low at-rest Planner opacity have no coarse-pointer usability gate. | Touch and touchpad users get smaller, less discoverable targets than the polish goal implies. |
| P1 | Planner's 168-case matrix primarily validates the confirmed surface; non-confirmed states lack equivalent rendered cross-axis coverage. | Loading/error/over-limit/stale polish can regress without a golden or semantic failure. |
| P2 | `npm test` excludes the two Planner runners. | A developer can report a green repository test while missing most changed UI code. |

## Verification

### Commands executed in this read-only audit

| Command | Result |
| --- | --- |
| `npm run check` | Pass: TypeScript plus manifest/package/requirement/provenance/local-only validation. |
| `node tests/ui/planner/run.mjs` | Pass: 34/34, zero skipped/todo. |
| `node tests/ui/planner-controls/run.mjs` | Pass: 49/49, zero skipped/todo. |
| `node tests/ui/execution/run.mjs` | Pass: 27/27, zero skipped/todo. |
| `npm test` | Pass, but it re-runs only the 27 Execution UI tests plus foundation/lifecycle/bundle checks; it does not include either Planner runner. |

### Smallest reliable post-edit command set

Run in this order after the integrated UI edit:

```bash
npm run check
node tests/ui/planner/run.mjs
node tests/ui/planner-controls/run.mjs
node tests/ui/execution/run.mjs
npm test
node tests/ui/planner-controls/run-visual-evidence.mjs
npm run verify
```

Notes:

- Run the pinned Planner ENV-VIS command without `--update`. Use `--update` only for an intentional, reviewed golden revision with before/after inspection.
- `npm run verify` invokes `clean` and `build`, so it was not run by this read-only packet; the parent should run it after production edits are integrated.
- The Planner ENV-VIS command was not run here because it bootstraps Docker dependencies over the network. Its code and profile were audited, but no fresh pixel result is claimed.
- Until an automated Execution visual runner exists, use the current harness only as bounded manual evidence:

```bash
SPIRAL_DAY_EXECUTION_HARNESS_PORT=43128 node tests/ui/execution/serve-visual-harness.mjs
```

- Real Obsidian keyboard, 200% zoom, reduced motion, and VoiceOver checks were not run in this packet and must remain explicitly unverified.
