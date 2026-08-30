# Planner UX and visual-system audit

## Accepted

### P0 - Put the collapsed expand affordance back at the inline end

**Observed:** The collapsed branch renders only `.spiral-day-planner__collapsed-control`, but that button inherits `display: inline-flex`; its `margin-left: auto` therefore does not push it to the end of a normal block formatting context. The current `topbar-collapsed` golden shows the only recovery action at the inline start of an otherwise empty surface, even though the documented contract describes a top-right affordance.

**Visual-only direction:** Make the collapsed button a block-level flex box and use logical auto margin (or an equivalent CSS-only end alignment), retaining the existing 32 x 32 hit area and zero planner content. Do not alter collapse persistence, focus restoration, or the render branch.

**Evidence:**

- `styles/planner.css:76-89` - `.spiral-day-planner__icon-button` is `inline-flex` with a stable 32 px box.
- `styles/planner.css:124-128` - `.spiral-day-planner__collapsed-control` supplies only `margin-left: auto`, positioning, and z-index.
- `src/ui/planner/view.ts:1135-1149` - the collapsed branch appends only the expand control.
- `tests/ui/planner-controls/run-visual-evidence-container.mjs:224-227` - the acceptance check proves presence only, not end alignment.
- `tests/ui/planner-controls/goldens/canonical-day/topbar-collapsed/en/light/width-900/r9.png` - current rendered placement is at the inline start.

### P1 - Give every actionable planner target the same discoverable interaction feedback

**Observed:** Icon buttons have hover/focus treatment, but compact schedule actions and actionable wide SVG targets do not share a coherent pointer/hover/active vocabulary. `.spiral-day-planner__interactive-item` has a static heavy border and no role-qualified hover rule; `.spiral-day-planner__target` and `.spiral-day-planner__external-label` explicitly remove outlines but do not distinguish `role="button"` from preview-only `role="img"` with a cursor or hover transition.

**Visual-only direction:** Add a role-qualified state layer:

- `.spiral-day-planner__interactive-item[role="button"]` gets `cursor: pointer`, a restrained Obsidian hover surface, and a 120 ms border/background transition.
- `.spiral-day-planner__target[role="button"]` and any actionable label get a pointer cursor; preview-only `[role="img"]` remains neutral.
- Preserve the existing four-pixel semantic rail, focus ring/drop shadow, current inset rail, conflict dash, and reduced-motion overrides.

This communicates clickability without creating new actions or changing keyboard behavior.

**Evidence:**

- `styles/theme.css:38-55` - only icon buttons currently receive a theme-aware hover/pressed surface.
- `styles/theme.css:81-102` - compact rows define current/conflict/border layout but no pointer or hover state.
- `styles/planner.css:295-312` - wide SVG targets expose hover/focus emphasis but no actionable-role distinction or cursor.
- `styles/planner.css:327-344` - external labels similarly rely on weight changes only.
- `src/ui/planner/controls.ts:243-256` - the existing controller assigns `role="button"` only when progress activation is valid, providing a safe CSS selector boundary.
- `src/ui/planner/view.ts:1327-1345` and `src/ui/planner/view.ts:1584-1666` - compact rows and wide slices use the same progress binding.

### P1 - Reduce compact schedule chrome so semantic state, not rectangles, carries the hierarchy

**Observed:** Compact schedule rows use `--spiral-day-control-border`, which is sourced from `--text-faint`, for a full rectangle around every row. Adjacent rows have no list gap, while conflict rows add an outside dashed outline. At 320-520 px this creates stacked high-contrast boxes and overlapping dashed edges that compete with the spiral and the semantic left rails.

**Visual-only direction:** Introduce separate row tokens backed by Obsidian's border and hover variables, instead of reusing the control-border token. Keep the list flat and dense: use a subtle row boundary, 2-4 px vertical separation, the existing 4 px radius maximum, and the semantic left rail as the primary state cue. Keep the conflict dash inside the row boundary (or otherwise prevent it colliding with neighbors). Do not turn rows into elevated cards and do not remove any non-color cue.

**Evidence:**

- `styles/planner.css:397-424` - `.spiral-day-planner__disclosure-list` has no layout gap and rows are directly adjacent.
- `styles/theme.css:2-4` - control border/hover tokens currently cover both controls and rows.
- `styles/theme.css:85-102` - conflict uses an outside outline and every interactive row uses the strong control border.
- `styles/a11y.css:60-64` - rows already have the correct 4 px radius and CJK/long-word handling.
- `tests/ui/planner-controls/goldens/canonical-day/dense/zh-CN/light/width-520/r9.png`, `tests/ui/planner-controls/goldens/canonical-day/dense/zh-CN/dark/width-519/r9.png`, and `tests/ui/planner-controls/goldens/canonical-day/dense/en/light/width-360/r9.png` - the dense fixtures show the stacked-border and conflict-outline competition in both themes and languages.

### P1 - Make the wide-mode tooltip compact enough to preserve chart context near 521 px

**Observed:** Wide mode begins at 521 px and must retain tooltips, but `.spiral-day-planner__tooltip` allows a 320 px content width. In the 521 px golden the tooltip spans most of the chart and covers the center, nearby labels, and several schedule bands. Its shadow is also stronger than any other planner surface.

**Visual-only direction:** Cap the tooltip around 240-260 px while preserving the 12 px viewport clamp and `overflow-wrap: anywhere`; use a restrained Obsidian popover shadow/border fallback and the current 6 px radius. Keep it body-mounted, fixed-positioned, content-complete, and available only in wide mode. This is wrapping/elevation polish, not a change to trigger or placement behavior.

**Evidence:**

- `styles/planner.css:456-472` - the body-level tooltip uses `max-width: min(320px, calc(100vw - 24px))`, fixed positioning, and a 20 px blur shadow.
- `src/ui/planner/view.ts:1669-1700` - tooltip mounting, trigger lifecycle, and companion emphasis are behaviorally separate from its CSS dimensions.
- `src/ui/planner/responsive-layout.ts:29-42` - 521 px remains wide with hover surfaces mounted; 520 px remains compact with them absent.
- `tests/ui/planner-controls/goldens/canonical-day/tooltip/zh-CN/light/width-521/r9.png` - the boundary capture demonstrates the chart occlusion.
- `docs/research/visual-interaction.md:145-147` - the upstream visual reference used a 240 px tooltip maximum.

### P2 - Clarify capacity hierarchy without making the header larger

**Observed:** Metric values, labels, and percentages are all rendered in nearly the same color and tight two-row grid. The visual hierarchy depends mostly on a one-pixel font-size difference, while warning metrics color the entire metric equally. The wide header consequently reads as a dense text block rather than a quick capacity scan.

**Visual-only direction:** Keep the current header height and two-column metric grid, but make tabular values the first scan target, labels/percentages consistently muted, and amber limited to the warning value plus the minimum text needed to identify its meaning. Normalize vertical rhythm to the existing 4/8 px system. Do not add a heading, badge, progress ring, card, or new capacity information.

**Evidence:**

- `styles/planner.css:47-74` - the header and control dimensions establish the fixed compact/wide envelope.
- `styles/planner.css:130-166` - metrics use a 2 px row gap; label/percent inherit `currentColor`, so warning and neutral text lack an internal emphasis hierarchy.
- `src/ui/planner/view.ts:1164-1170` and `src/ui/planner/view.ts:1228-1234` - wide hierarchy is fixed as metrics plus controls/legend.
- `src/ui/planner/view.ts:1296-1313` - compact Overview reuses the exact same metrics, so the token adjustment can remain consistent across layouts.
- `tests/ui/planner-controls/goldens/canonical-day/temporal/en/light/width-900/r9.png` and `tests/ui/planner-controls/goldens/canonical-day/topbar/zh-CN/dark/width-900/r9.png` - both themes show the current low-differentiation text block.

### P2 - Improve disclosure and status scanning with state-aware, non-card treatment

**Observed:** All disclosure summaries use the same muted text treatment, including overflow and warning summaries, and only get feedback on focus. Status surfaces are a left border plus text, with no theme-layer differentiation between loading, missing, and errors beyond border/heading color. The result is technically legible but visually easy to skip in a long compact planner.

**Visual-only direction:** Add a quiet hover/open state to `.spiral-day-planner__disclosure-summary`; keep normal Overview/Schedule summaries neutral while applying the existing warning token to overflow/warning summary marker/count. For `.spiral-day-planner__status`, add a very subtle tokenized background tint keyed by existing `data-state`, retaining the left rail and flat geometry. No toast, modal, new icon, or change to live-region severity.

**Evidence:**

- `styles/planner.css:367-395` - disclosures are correctly flat but summaries have no hover/open styling.
- `styles/planner.css:426-454` - diagnostic rows and status rails already expose semantic state tokens; summaries remain uniformly muted.
- `src/ui/planner/view.ts:1096-1108` - status `data-state`, role, and live behavior are already encoded and must remain untouched.
- `src/ui/planner/view.ts:1352-1409` - overflow and warnings have stable class/summary boundaries suitable for CSS-only state emphasis.
- `styles/a11y.css:20-37` and `styles/a11y.css:106-117` - existing focus-visible and forced-colors rules remain authoritative.

### P2 - Consolidate the icon-control visual state instead of relying on contradictory opacity layers

**Observed:** `styles/planner.css` defines controls at `opacity: 0.38` and reveals them on planner hover/focus, while the later theme layer forces `opacity: 1`. The combined surface therefore behaves differently from the base stylesheet, and opacity is doing work that the Obsidian muted/normal text tokens already express more predictably.

**Visual-only direction:** Keep all three primary controls visibly present using full-opacity muted color, use background/border/color for hover and pressed states, and reserve opacity reduction for `aria-disabled="true"`. Remove the contradictory reveal model while retaining the 32 px box and current Lucide/fallback icon sizes.

**Evidence:**

- `styles/planner.css:76-115` - base opacity, reveal selectors, disabled opacity, and icon dimensions.
- `styles/theme.css:38-55` - the loaded theme layer resets opacity to one and supplies the more Obsidian-native border/background states.
- `styles/a11y.css:1-7` and `styles/a11y.css:39-42` - stable hit-area and disabled-state constraints.
- `src/ui/planner/view.ts:1111-1133` - control labels and actions are independent from the CSS state model.

## Rejected

- **No breakpoint or responsive-content changes.** Keep compact at `<=520px`, wide at `>=521px`, and narrow adjustments at `<=360px` (`src/ui/planner/responsive-layout.ts:1-44`, `styles/planner.css:474-489`).
- **No geometry, label-truncation, or information-hierarchy changes.** Keep the Spiral-first SVG, wide rails/labels, compact Overview/Schedule, measured label fit, and all disclosures (`src/ui/planner/spiral.ts:308-379`, `src/ui/planner/view.ts:1235-1244`).
- **No behavior changes disguised as polish.** Do not change collapse persistence, completed visibility, playback, disclosure defaults, progress activation, tooltip triggers, focus restoration, live announcements, or planner runtime state handling.
- **No new controls or secondary workflows.** Tidy, Undo, filters, modes, edit actions, or settings shortcuts are out of scope; the production test explicitly forbids Tidy/Undo (`tests/ui/planner-controls/styles.test.ts:168-176`).
- **No card dashboard treatment.** Do not wrap Overview, Schedule, diagnostics, or the SVG in cards; the flat hierarchy is a parity requirement (`styles/planner.css:367-373`, `tests/ui/planner/styles.test.ts:38-44`, `docs/research/visual-interaction.md:287-302`).
- **No decorative gradients, oversized type, or palette replacement.** Preserve the semantic task/urgent/event/completed/warning hues and existing non-color cues in both themes (`styles/theme.css:1-36`, `styles/theme.css:57-88`).
- **No custom tooltip interaction or portal rewrite.** Only wrapping, tokens, border, and elevation are accepted; mounting and placement logic stay unchanged.

## Decisions

### Proposed visual direction: Obsidian-native analytical surface

- Use Obsidian surface, border, muted-text, hover, and focus tokens for chrome; reserve custom hues for semantic schedule state.
- Keep the planner flat. Dividers, left rails, hatching, shapes, weight, and text decoration express hierarchy; shadows are limited to the detached tooltip.
- Use one compact spacing rhythm: 4 px inside controls/row separations, 8 px for text groups, and existing 6-10 px section padding. Keep radius at 4 px for rows and 6 px for controls/tooltip.
- Make affordance states consistent across icon buttons, compact rows, SVG slices, and external labels: visible neutral baseline, obvious hover, existing strong focus, explicit disabled state.
- Treat the spiral as the primary visualization. Header text becomes easier to scan, compact rows become quieter, and the tooltip becomes smaller so none of those surfaces compete with the chart.
- Keep light/dark parity and community-theme resilience by adding semantic aliases such as row border/hover and tooltip shadow instead of adding more fixed colors.

### Implementation ordering

1. Correct collapsed-control alignment and add missing role-qualified affordance states.
2. Separate row/control tokens and refine compact row boundaries/conflict treatment.
3. Tighten tooltip width/elevation.
4. Refine metric hierarchy and disclosure/status states.
5. Consolidate duplicated control opacity rules, then regenerate visual evidence.

All accepted changes are CSS-first. A production TypeScript change is unnecessary unless implementation discovers that the current DOM lacks a stable state selector; if so, only a presentation-only `data-*` hook is acceptable and must not alter state transitions.

## Risks

- Every accepted CSS change will intentionally invalidate pixel goldens. Regenerate only after semantic/layout assertions still pass; do not treat a blanket golden refresh as verification.
- Collapsed alignment is not currently asserted geometrically. Add an inline-end bounding-box assertion so the current regression cannot recur.
- Row-border softening must preserve the minimum contrast checked for semantic left rails, and conflict/current/completed states must remain distinguishable without color.
- Tooltip narrowing increases line count. Recheck long English, CJK, 200% zoom, viewport edges, and short-height windows for clipping.
- New token aliases must have safe Obsidian fallbacks and be checked in default light/dark, high contrast, forced colors, and at least one strongly customized community theme.
- Hover/active transitions must remain fully disabled by both `prefers-reduced-motion` and `data-reduced-motion="true"` (`styles/a11y.css:73-103`).
- `:has()` should not be required for the collapsed fix; prefer a selector that works on the existing `.spiral-day-planner__collapsed-control` node to minimize host-version risk.
- Real Obsidian plus VoiceOver remains separate acceptance evidence. Browser goldens and source inspection do not close that gap.

## Verification

- Read-only source audit completed for `styles/planner.css`, `styles/theme.css`, `styles/a11y.css`, `src/ui/planner/view.ts`, `src/ui/planner/controls.ts`, `src/ui/planner/disclosures.ts`, `src/ui/planner/responsive-layout.ts`, `src/ui/planner/spiral.ts`, and `docs/research/visual-interaction.md`.
- Read-only visual audit completed against current r9 goldens at widths 900, 521, 520, 519, 360, and 320 across light/dark and English/Simplified Chinese, including temporal, tooltip, dense, topbar, collapsed, playback, and reduced-motion states.
- Existing test contracts inspected: `tests/ui/planner/styles.test.ts` preserves semantic tokens, exact container breakpoints, reduced motion, and flat disclosures; `tests/ui/planner-controls/styles.test.ts` preserves theme/a11y variants and the bounded visual matrix.
- No production code, tests, screenshots, or behavior were changed. This packet is a design/audit result only.
