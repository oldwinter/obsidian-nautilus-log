# Integration Checklist: comprehensive-ui-ux-polish

## Accepted

- 02 Execution: 1. **P1 - Give execution semantics dark-theme-safe tokens.** The execution surface defines its own danger and warning fallbacks on `.spiral-day-execution, .spiral-day-active-task`, but the brighter dark values in `styles/theme.css` are scoped only to `.spiral-day-planner`. As rendered in dark mode, `#b42334` and `#805800` have only 2.45:1 and 2.51:1 contrast against `#202226`; this affects `.spiral-day-execution__elapsed[data-warning="true"]`, `.spiral-day-active-task__elapsed[data-warning="true"]`, `.spiral-day-execution__danger-action`, `.spiral-day-execution__feedback[data-level]`, and `.spiral-day-execution-trigger[data-warning="true"]::after`. Define shared light/dark semantic tokens for execution and use more than color alone for warnings. Sources: `styles/execution.css:1-12`, `styles/execution.css:108-123`, `styles/execution.css:215-218`, `styles/execution.css:349-364`, `styles/theme.css:20-35`.
- 02 Execution: 2. **P1 - Separate an intentional idle state from an unavailable Active Task state.** `renderActiveTaskSurface()` routes every `!focused` snapshot through `.spiral-day-active-task__unavailable`, so a healthy ready/idle or standalone-POMO snapshot says that the current task "could not be confirmed" and source navigation is disabled. Render a quiet empty/idle state for ready snapshots without a focused task, reserve unavailable/details for degraded or stopped data, and represent standalone POMO as timing rather than an error. Sources: `src/ui/execution/active-task-view.ts:42-61` (`!focused || status === "degraded" || status === "stopped"`), `styles/execution.css:389-398`; confirmed in the live harness after selecting Idle.
- 02 Execution: 3. **P1 - Keep destructive confirmation feedback synchronized with the 2.5-second contract.** The first delete activation sets `.spiral-day-execution__feedback` to "Activate again", but no timer expires the message or visually arms/disarms `.spiral-day-execution__danger-action`; `deleteActivation` is cleared only by a later request or closing the popover. After the validity window, the notice remains actionable-looking although the next activation merely starts a new window. Preserve the double-activation semantics, but add an explicit armed state on the delete control, auto-clear it and its live feedback at `DELETE_CONFIRMATION_WINDOW_MS`, and retain action order. Sources: `src/ui/execution/panel.ts:64`, `src/ui/execution/panel.ts:163-168`, `src/ui/execution/panel.ts:243-268`, `src/ui/execution/panel.ts:385-395`, `src/ui/execution/timing-view.ts:201-217`; live harness verification showed the notice still visible after 3 seconds.
- 02 Execution: 4. **P1 - Do not offer Clock in on the task already being timed.** `appendTaskRow()` marks the row with `data-current="true"`, but its action condition checks only flexible/open/eligible, so the current row still renders an enabled Clock in button beside Complete. The compact and desktop harness both exposed this contradiction. Keep the existing row action order for other tasks, but omit or disable Clock in for the exact current target and expose the current state in accessible text. Sources: `src/ui/execution/plan-view.ts:65-100`, `src/ui/execution/plan-view.ts:101-130`, selector `.spiral-day-execution__plan-row[data-current="true"]`.
- 02 Execution: 5. **P2 - Preserve simultaneous urgent and current state cues.** The urgent rule for `.spiral-day-execution__plan-row[data-urgent="true"]` is immediately overridden by the later current rule for background and border color. In the harness, the active urgent task therefore looked current but not urgent. Use independent channels, such as a current inset/marker plus an urgent edge or icon, including a compound `[data-current="true"][data-urgent="true"]` rule; do not rely on color alone. Sources: `src/ui/execution/plan-view.ts:65-69`, `styles/execution.css:297-314`.
- 02 Execution: 6. **P2 - Make the forgotten-timer accent actually render.** `.spiral-day-execution__current` declares only a top border, while `.spiral-day-execution__current[data-forgotten="true"]` changes `border-inline-start-color` without declaring an inline-start border width/style. The intended warning edge is therefore absent; only elapsed text and the paragraph carry the state. Add a real warning edge or inset marker and keep `.spiral-day-execution__warning` as the textual explanation. Sources: `src/ui/execution/timing-view.ts:145-162`, `src/ui/execution/timing-view.ts:219-223`, `styles/execution.css:159-184`, selector `.spiral-day-execution__current[data-forgotten="true"]`.
- 02 Execution: 7. **P2 - Visually distinguish pending work from write-blocked controls.** `appendPending()` and plan-row pending handling set `disabled` plus `aria-busy`, while `writeBlocked` sets only `disabled`; CSS renders every disabled button with the same 0.48 opacity and has no `[aria-busy="true"]` treatment. Users cannot tell "working" from "unavailable", and plan-row pending controls do not receive the pending title used by Timing. Add a stable busy glyph/progress treatment for `[aria-busy="true"]`, a distinct blocked treatment/reason for non-busy disabled controls, and keep dimensions fixed to avoid row shift. Sources: `src/ui/execution/timing-view.ts:39-43`, `src/ui/execution/timing-view.ts:209-216`, `src/ui/execution/plan-view.ts:125-130`, `styles/execution.css:240-253`, `styles/execution.css:286-289`.
- 02 Execution: 8. **P2 - Make active context available without pseudo-content or visible usage instructions.** The ribbon trigger displays elapsed/thread state only through `::after`, while `updateTrigger()` leaves its accessible name as generic "Execution"; `data-threads="1"` is also an opaque visible label. Conversely, Active Task makes the whole article a tab stop, nests a separate Open source button, and displays "Press Enter" guidance as page content. Give the trigger a dynamic accessible label with task/timer state, replace the opaque thread count with meaningful compact status, keep one clear source-opening affordance, and move the keyboard hint to accessible naming/tooltip rather than permanent body copy. Sources: `src/ui/execution/panel.ts:170-197`, `styles/execution.css:349-364`, `src/ui/execution/active-task-view.ts:64-90`, selectors `.spiral-day-execution-trigger[data-elapsed]`, `.spiral-day-active-task__content`, and `.spiral-day-active-task__hint`.

## Rejected

- 01 Discovery: **No breakpoint or responsive-content changes.** Keep compact at `<=520px`, wide at `>=521px`, and narrow adjustments at `<=360px` (`src/ui/planner/responsive-layout.ts:1-44`, `styles/planner.css:474-489`).
- 01 Discovery: **No geometry, label-truncation, or information-hierarchy changes.** Keep the Spiral-first SVG, wide rails/labels, compact Overview/Schedule, measured label fit, and all disclosures (`src/ui/planner/spiral.ts:308-379`, `src/ui/planner/view.ts:1235-1244`).
- 01 Discovery: **No behavior changes disguised as polish.** Do not change collapse persistence, completed visibility, playback, disclosure defaults, progress activation, tooltip triggers, focus restoration, live announcements, or planner runtime state handling.
- 01 Discovery: **No new controls or secondary workflows.** Tidy, Undo, filters, modes, edit actions, or settings shortcuts are out of scope; the production test explicitly forbids Tidy/Undo (`tests/ui/planner-controls/styles.test.ts:168-176`).
- 01 Discovery: **No card dashboard treatment.** Do not wrap Overview, Schedule, diagnostics, or the SVG in cards; the flat hierarchy is a parity requirement (`styles/planner.css:367-373`, `tests/ui/planner/styles.test.ts:38-44`, `docs/research/visual-interaction.md:287-302`).
- 01 Discovery: **No decorative gradients, oversized type, or palette replacement.** Preserve the semantic task/urgent/event/completed/warning hues and existing non-color cues in both themes (`styles/theme.css:1-36`, `styles/theme.css:57-88`).
- 01 Discovery: **No custom tooltip interaction or portal rewrite.** Only wrapping, tokens, border, and elevation are accepted; mounting and placement logic stay unchanged.
- 02 Execution: Rejected card-heavy or modal-within-popover redesigns. The appropriate direction is a quiet Obsidian-native command surface with stronger hierarchy, not decorative containers.
- 02 Execution: Rejected changing the Timing action order (`Open active task`, `Clock out`, `Complete`, `Delete`) or replacing the exact double-activation delete safety contract.
- 02 Execution: Rejected removing roving-tab keyboard behavior, Escape-to-close/focus return, Shift-click sidebar navigation, native `details/summary`, live-region announcements, reduced-motion handling, or forced-colors support.
- 02 Execution: Rejected broad dependency, runtime, writer, navigation, or host-adapter changes; all recommendations are achievable within execution DOM state and styling boundaries.
- 03 Verification: Reject `npm test` as a comprehensive UI gate. `esbuild.config.mjs:891-908` invokes only `tests/ui/execution/run.mjs`; Planner and Planner Controls pass only when their focused runners are called separately.
- 03 Verification: Reject source-regex checks as proof of working Execution accessibility. `tests/ui/execution/contracts.test.ts` confirms strings such as `role="button"` and `trigger.focus()` exist, but it never mounts `mountExecutionPanel()` in a browser or exercises tab arrows, Escape, live announcements, focus return, clipping, or localized text fit.
- 03 Verification: Reject the custom `high-contrast` class as proof of `@media (forced-colors: active)`. The ENV-VIS browser context never sets Playwright `forcedColors: "active"`; current forced-color tests only match CSS source.
- 03 Verification: Reject `setReducedMotion(true)` alone as proof of the operating-system preference. It proves the Planner runtime seam, while the actual media query and the Execution/Active Task branch remain unexercised by a real emulated `prefers-reduced-motion` context.
- 03 Verification: Reject blind use of `node tests/ui/planner-controls/run-visual-evidence.mjs --update` to make a visual change pass. The parity contract requires reviewed before/after images and a stated reason for every golden revision.
- 03 Verification: Reject a universal 44px target gate as an undocumented parity requirement. The plugin is desktop-only and its current dense geometry is based on 32px controls. Preserve at least the current 32px hit boxes, then use a reviewed narrow/coarse-pointer enhancement (preferably 40-44px) if the visual implementation can retain the 320px and 519/520/521 contracts.
- 03 Verification: Reject a full Cartesian screenshot explosion. Keep semantic assertions broad and goldens bounded; add representative screenshots only for states where visual hierarchy, clipping, or localization can regress.

## Decisions

- 02 Execution: Treat Timing as the primary status/action surface, Plan as a dense scannable queue, and Active Task as a persistent at-a-glance companion. Keep their visual language consistent through shared semantic tokens, 32px fixed icon controls, tabular timer figures, and the existing 420px popover cap.
- 02 Execution: Use independent visual channels for current, urgent, forgotten, busy, blocked, warning, and destructive states. A state may combine with another, so selector ordering must not erase meaning.
- 02 Execution: Preserve compact responsive behavior. At 320px width, the Chinese Plan rows, expanded unscheduled section, and action buttons fit without horizontal overflow; polish should retain that property.
- 02 Execution: Keep source titles as the dominant click target and icons for familiar commands, with accessible labels and tooltips. Do not add permanent instructional copy solely to explain keyboard behavior.

## Risks

- 01 Discovery: Every accepted CSS change will intentionally invalidate pixel goldens. Regenerate only after semantic/layout assertions still pass; do not treat a blanket golden refresh as verification.
- 01 Discovery: Collapsed alignment is not currently asserted geometrically. Add an inline-end bounding-box assertion so the current regression cannot recur.
- 01 Discovery: Row-border softening must preserve the minimum contrast checked for semantic left rails, and conflict/current/completed states must remain distinguishable without color.
- 01 Discovery: Tooltip narrowing increases line count. Recheck long English, CJK, 200% zoom, viewport edges, and short-height windows for clipping.
- 01 Discovery: New token aliases must have safe Obsidian fallbacks and be checked in default light/dark, high contrast, forced colors, and at least one strongly customized community theme.
- 01 Discovery: Hover/active transitions must remain fully disabled by both `prefers-reduced-motion` and `data-reduced-motion="true"` (`styles/a11y.css:73-103`).
- 01 Discovery: `:has()` should not be required for the collapsed fix; prefer a selector that works on the existing `.spiral-day-planner__collapsed-control` node to minimize host-version risk.
- 01 Discovery: Real Obsidian plus VoiceOver remains separate acceptance evidence. Browser goldens and source inspection do not close that gap.
- 02 Execution: The visual harness does not construct the production Review surface (`createReviewSurface` is absent), so this packet verifies only the panel's `.spiral-day-execution__empty` fallback for Review. Review-specific polish needs its owning packet/surface verification.
- 02 Execution: The harness approximates Obsidian host tokens and icons. Final token contrast, ribbon geometry, popover anchoring, and sidebar chrome still require real Obsidian light/dark/high-contrast validation.
- 02 Execution: Existing tests mostly assert source contracts and selector presence; they do not currently catch the idle/unavailable mapping, expired delete feedback, current-row Clock in action, compound urgent/current styling, or dark-mode contrast regressions.
- 03 Verification: | Priority | Risk | Consequence |
- 03 Verification: | --- | --- | --- |
- 03 Verification: | P0 | Execution/Active Task has no automated browser/golden runner. | A CSS or markup change can pass all current tests while breaking focus, localized fit, short-height placement, or visual hierarchy. |
- 03 Verification: | P0 | Evidence IDs do not match actual evidence kinds. | G5/G6 can appear mapped while manual, screenshot, integration, or a11y evidence is absent. |
- 03 Verification: | P0 | No automated critical/serious accessibility scan and no current VoiceOver evidence. | `OBS-A11Y-001` and `ENV-A11Y` cannot be claimed complete. |
- 03 Verification: | P1 | Forced-color and OS reduced-motion CSS is source-checked, not rendered under the actual media features. | A syntactically present branch may be visually unusable or overridden. |
- 03 Verification: | P1 | Execution status transitions are not demonstrably announced. | Screen-reader users may miss stale/degraded/write outcome state changes. |
- 03 Verification: | P1 | Execution locale equality is tested, but rendered Chinese expansion and 200% zoom are not. | Tabs/actions can truncate, hide, or overlap even though key sets are equal. |
- 03 Verification: | P1 | 32px controls and low at-rest Planner opacity have no coarse-pointer usability gate. | Touch and touchpad users get smaller, less discoverable targets than the polish goal implies. |
- 03 Verification: | P1 | Planner's 168-case matrix primarily validates the confirmed surface; non-confirmed states lack equivalent rendered cross-axis coverage. | Loading/error/over-limit/stale polish can regress without a golden or semantic failure. |
- 03 Verification: | P2 | `npm test` excludes the two Planner runners. | A developer can report a green repository test while missing most changed UI code. |

## Verification Evidence

- 01 Discovery: Read-only source audit completed for `styles/planner.css`, `styles/theme.css`, `styles/a11y.css`, `src/ui/planner/view.ts`, `src/ui/planner/controls.ts`, `src/ui/planner/disclosures.ts`, `src/ui/planner/responsive-layout.ts`, `src/ui/planner/spiral.ts`, and `docs/research/visual-interaction.md`.
- 01 Discovery: Read-only visual audit completed against current r9 goldens at widths 900, 521, 520, 519, 360, and 320 across light/dark and English/Simplified Chinese, including temporal, tooltip, dense, topbar, collapsed, playback, and reduced-motion states.
- 01 Discovery: Existing test contracts inspected: `tests/ui/planner/styles.test.ts` preserves semantic tokens, exact container breakpoints, reduced motion, and flat disclosures; `tests/ui/planner-controls/styles.test.ts` preserves theme/a11y variants and the bounded visual matrix.
- 01 Discovery: No production code, tests, screenshots, or behavior were changed. This packet is a design/audit result only.
- 02 Execution: Read-only source audit covered `styles/execution.css`, `styles/theme.css`, `styles/a11y.css`, all `src/ui/execution/**`, execution locale catalogs, Active Task host adapter, and `tests/ui/execution/**`.
- 02 Execution: Live visual harness checked active Timing, Plan, Review fallback, Idle/unavailable, destructive first activation and expiry, light/dark themes, English/Chinese locale, and 1280x720, 390x844, and 320x640 viewports. The 320px Chinese Plan surface had no horizontal overflow.
- 02 Execution: `node tests/ui/execution/run.mjs`: 27 tests passed, 0 failed.
- 02 Execution: No production code, tests, or screenshots were modified.

## Integration Decisions

Accepted:

- Preserved the flat Spiral-first structure while strengthening header hierarchy, metrics, disclosures, tooltips, empty/error states, visible affordances, and coarse-pointer targets.
- Added dark-safe execution tokens and independent current, urgent, forgotten, pending, warning, and destructive state channels.
- Split Active Task into active, idle, standalone-POMO, and unavailable modes; removed the nested article keyboard shortcut in favor of the explicit source command.
- Added dynamic trigger naming, dialog relationships, delete confirmation expiry, and exact current-task matching so Plan no longer offers a redundant Clock in action.
- Replaced the legacy 4px row side stripe with a 1px semantic boundary plus a restrained bottom state line. This preserved the rendered state-contrast contract without the card-tab treatment flagged by the design detector.
- Updated the bounded r9 golden set only after the 168-state semantic matrix passed and every resulting capture was reviewed.

Rejected:

- Breakpoint, scheduling geometry, label-fitting, navigation, write mutation, action order, and double-activation safety changes.
- Card-heavy dashboards, new controls, palette replacement, decorative gradients, dependency additions, or runtime/host-adapter rewrites.
- Treating `npm test`, source regexes, browser harnesses, or custom high-contrast classes as proof of native Obsidian plus VoiceOver acceptance.

Conflicts:

- The design detector flagged the existing 4px semantic side border, while ENV-VIS requires a sufficiently contrasting left state boundary. Integration retained a 1px semantic left border and added a 2px bottom cue, satisfying both constraints.
- A translucent `color-mix()` header surface rendered correctly but computed as `color(srgb ...)`, which the pinned contrast parser cannot interpret as 0-255 RGB. The implementation uses the existing opaque Obsidian secondary-surface token instead.
- Theme color transitions briefly crossed below contrast thresholds on the first frame. Semantic text and state-border transitions were made immediate; hover/focus geometry remains.

Remaining risks:

- Real Obsidian host chrome, community themes, native screen-reader announcements, and VoiceOver were not validated in this run.
- Execution has manual browser evidence but no pinned browser/golden runner equivalent to Planner Controls.
- Forced-colors CSS remains source-checked; the pinned matrix does not emulate the operating-system forced-colors media feature.

Verification still needed:

- Run the plugin in a real Obsidian vault with VoiceOver and native light/dark/community-theme tokens before claiming native accessibility closure.
- Add a future bounded Execution browser contract for focus return, tab arrows, live feedback, localized fit, and forced-colors/reduced-motion emulation.
