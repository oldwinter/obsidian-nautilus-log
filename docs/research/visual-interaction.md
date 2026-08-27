# Visual and interaction parity contract

## Scope and evidence rules

This note defines the observable visual and interaction contract of Nautilus Log
`v1.0.2`. The functional baseline is upstream commit
[`973a041aa2f59f3b05bf31db8187efbfea07017a`](https://github.com/404KSG/roam-nautilus-log/tree/973a041aa2f59f3b05bf31db8187efbfea07017a).
The repository's later `main` commit
[`08892f948c63e4cacd3fc1cc100a600dd38c21f8`](https://github.com/404KSG/roam-nautilus-log/tree/08892f948c63e4cacd3fc1cc100a600dd38c21f8)
is used only to identify screenshot/documentation drift.

Statements below use these confidence labels:

- **Observed**: directly encoded in fixed-SHA markup, CSS, tests, or first-party
  media.
- **Permitted adaptation**: an Obsidian-native change that preserves meaning and
  workflow while improving host integration, keyboard access, focus treatment,
  or theme compatibility.
- **Unknown**: not established by the fixed-SHA repository; it requires a live
  Roam fixture or the later human-in-the-loop (HITL) prototype.

The upstream product exposes two visual systems: the always-available spiral
planner and an optional Execution Layer. The latter defaults off and contributes
no topbar, poller, commands, or CLOCK writer while disabled
([guide](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/docs/guide.md#L70-L77),
[entry lifecycle](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/index.js#L170-L233)).

## Surface-by-state matrix

### Planner shell and timeline

| Surface | State or trigger | Observable contract | Interaction and focus contract | Evidence |
| --- | --- | --- | --- | --- |
| Renderer bootstrap | Extension state not resolved | A strong `Loading Nautilus Log...` message is the only planner content. | No local control is exposed. | [markup](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/component.cljs#L1686-L1742) |
| Renderer unavailable | Extension reports not running | A strong red installation error replaces the planner. | No recovery action is embedded in the message. | [markup](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/component.cljs#L1739-L1748) |
| Duplicate render contexts | Zoom breadcrumb or collapsed-path replica | The replica reserves zero visible space; a real right-sidebar render is not suppressed. | None. This is host-context gating, not a user toggle. | [context detector](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/entry-helpers.js#L5-L42), [CSS](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/extension.css#L62-L87) |
| Wide planner header | Container wider than 520 px | A flat, full-width header has a two-column grid: two rows of capacity metrics on the left, 32 px icon controls above the red/yellow/blue legend on the right, and a 1 px bottom separator. It is deliberately uncarded: transparent background, no radius, no shadow. | Controls remain at 38% opacity until planner hover or control focus. Metrics and legend are static but labelled for assistive technology. | [markup](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/component.cljs#L1517-L1556), [layout CSS](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/extension.css#L89-L243), [control reveal CSS](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/extension.css#L552-L607) |
| Compact planner header | Measured container width at or below 520 px | Header metrics and legend disappear from the header; controls align right. A separate folded `Overview` disclosure carries metrics and legend. Warning status is repeated in amber in its summary. | Native `details/summary` toggling controls Overview. The summary has an accessible synthesized label including active capacity and warning state. | [state/markup](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/component.cljs#L1558-L1595), [measurement](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/component.cljs#L1663-L1684), [container CSS](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/extension.css#L678-L734) |
| Spiral frame | Any rendered day | A responsive SVG uses a 600 x 420 desktop base (450 x 315 on Roam mobile). Desktop uses a 50 px inner radius and the blueprint outer radii; Roam mobile multiplies both by 0.7, yielding a 35 px inner radius. Bounds expand dynamically for outside labels. The first part of the Daily Note title is centered; hour sectors form the spiral. | Decorative grid, center date, and current-time needle do not intercept pointers. | [geometry constants](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/component.cljs#L30-L82), [SVG markup](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/component.cljs#L1240-L1313), [grid pointer CSS](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/extension.css#L390-L401), [needle pointer CSS](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/extension.css#L194-L196), [center pointer CSS](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/extension.css#L654-L657) |
| Today, inside configured hours | Relation is today and current minute is inside the chart window | Elapsed sectors are shaded; unrecorded elapsed gaps are hatched; the current minute has a red radial needle and red `HH:MM` below the center date. The Flexible Task whose half-open Planned Slot contains now has a 2 px blue outline and 800-weight outside label. This is not the Execution Layer's CLOCK Active Task. | Task and event hover/focus targets are enabled; TODO slices and labels are clickable for progress. | [day-state rules](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/log-core.js#L247-L291), [current-slot rule](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/log-core.js#L469-L481), [now markup](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/component.cljs#L1261-L1301), [current-task CSS](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/extension.css#L416-L423) |
| Today, outside configured hours | Current minute is before start or at/after end | There is no current-time needle or center time. Capacity and scheduling cursor clamp to the configured boundary. | TODO progress remains a today-only interaction even when the needle is absent. Available slots follow the clamped scheduler state. | [day-state rules](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/log-core.js#L254-L291), [renderer gating](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/component.cljs#L1252-L1281) |
| Historical Daily Note | Display date precedes current date | The complete configured workday is shown as elapsed, unrecorded gaps remain hatched, and neither the now needle nor actionable Available-slot targets are rendered. | TODO progress clicking is disabled because the page is non-interactive; existing task/event hover targets remain available on wide charts. | [state rules](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/log-core.js#L247-L291), [regression test](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/test/log-core.test.js#L74-L115), [changelog](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/CHANGELOG.md#L22-L31) |
| Future/other Daily Note | Display date follows current date or cannot be related | No elapsed overlay or now needle is shown. Full-day Available slots can be previewed on a wide chart, but task progress is not clickable. | Slice/slot hover and keyboard focus remain preview-only. | [state rules](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/log-core.js#L254-L291), [renderer gating](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/component.cljs#L1240-L1281) |
| Playback | Play control activated | Over six seconds, the timeline cursor advances from chart start to end. Slices, labels, and connectors use delayed 350 ms pop-in animation; now/elapsed/available visuals follow the simulated minute even on a past/future page. The play button is disabled until playback ends, then real time is restored. | Play cannot be retriggered while active. Playback does not make a non-today page writable: `interactive` remains today-only. Reduced-motion shortens animation and transitions without changing the six-second simulation state. | [playback handler](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/component.cljs#L1385-L1409), [day-state rules](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/log-core.js#L275-L290), [animation CSS](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/extension.css#L748-L769) |
| Fixed event | Parsed event with a time range | Normal event slices and labels are yellow. Past events use a muted event fill; overlapping fixed events add an amber 1.5 px dashed conflict stroke. Cross-midnight or same-time parse warnings also appear in a separate disclosure below the chart. | Event slice/label is preview-only, never progress-clickable. | [slice state](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/component.cljs#L982-L1040), [conflict CSS](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/extension.css#L410-L414), [warning panel](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/component.cljs#L1597-L1629) |
| Flexible task | Ordinary/urgent/current/completed/progress states | Ordinary task labels/connectors use one semantic blue and translucent blue fill. A configured trigger word produces the hard-coded translucent urgent red. Current Planned Slot is outlined; completed tasks use muted gray, strikethrough, and reduced-opacity labels/connectors. Nonzero progress adds a dot-pattern overlay. | On today's note, clicking a task slice or outside label advances progress by 10%; reaching 100% converts TODO to DONE and appends a completion time. A displayed DONE task is still a task target: clicking it writes 10% and changes it back to TODO. No explicit keyboard activation handler exists on the SVG target. | [colors/constants](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/component.cljs#L8-L82), [slice click/paint](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/component.cljs#L800-L888), [progress mutation](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/component.cljs#L478-L510), [task classification](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/component.cljs#L636-L686) |
| Empty planner | No visible Fixed Events or Flexible Tasks | There is no dedicated empty message. The hour spiral and center date remain; a wide chart exposes the Available interval allowed by the temporal state, while compact Schedule reads `Schedule · 0 items`. | The ordinary controls and disclosures remain usable. | [compact list](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/component.cljs#L1168-L1196), [chart composition](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/component.cljs#L1240-L1313) |
| Slice tooltip | Wide chart; pointer hover or keyboard focus on task/event | One compact tooltip shows title plus `kind · HH:MM–HH:MM · duration`. When `ReactDOM.createPortal` is available it is mounted at body level; otherwise it falls back inline. It prefers the radial outside direction, measures before display, then flips/shifts within a 12 px viewport margin. Hover/focus brightens the slice and strengthens its connector. | The SVG group has `role="img"`, `tabindex=0`, `focusable=true`, and a complete `aria-label`; mouse leave or blur closes the tooltip. | [tooltip geometry/portal](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/component.cljs#L390-L476), [target markup](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/component.cljs#L1025-L1091), [tooltip CSS](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/extension.css#L403-L507) |
| Available-slot tooltip | Wide chart and state allows Available slots | Blank future space becomes transparent SVG hit regions. Hover/focus adds a muted fill plus dashed stroke and shows `Available slot` or `Available now`, exact range, and duration. A multi-hour gap is one accessible target even though it uses multiple paths. | Same hover/focus/blur contract as item slices; it is informational and has no click action. | [slot grouping](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/log-core.js#L362-L410), [markup](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/component.cljs#L1198-L1238), [CSS](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/extension.css#L448-L466) |
| Compact chart | Container at or below 520 px, including right sidebar | Outside spiral labels and all hover surfaces are removed. A below-chart `Schedule · N items` disclosure lists colored dot, tabular time range, and ellipsized title; completed rows are muted and struck through. The compact spiral itself remains visible. | Schedule is user-toggleable. It starts folded in the right sidebar and open in other narrow contexts on first context detection. Width changes clear any active hover tooltip. | [compact list markup](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/component.cljs#L1162-L1196), [context state](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/component.cljs#L1638-L1684), [compact CSS](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/extension.css#L258-L388) |
| Overflow panel | One or more tasks cannot be placed | An unframed, amber, top-separated `Unscheduled today · duration · N item(s)` disclosure appears below the chart; expanded rows pair task title with duration. It remains visible rather than dropping work. | Native disclosure toggle; no task navigation or scheduling action is attached. | [markup](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/component.cljs#L1603-L1616), [CSS](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/extension.css#L609-L647) |
| Warning panel | Parsed items contain warnings | A sibling amber disclosure says `Schedule warnings · N item(s)`; expanded rows pair the item description with localized warning text. | Native disclosure toggle; no corrective action is attached. | [markup](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/component.cljs#L1618-L1629), [CSS](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/extension.css#L609-L652) |
| Collapsed planner | Collapse control activated | The chart/header/panels disappear and reserve zero height. Only the 32 px expand control floats at top right, 26 px above the collapsed origin. State persists per component UID in local storage. | Expand/collapse is a labelled button; hidden eye/play controls are not focusable because they are `display:none`. | [state/markup](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/component.cljs#L1357-L1383), [render branch](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/component.cljs#L1795-L1814), [CSS](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/extension.css#L659-L676) |
| Debug-only render argument | Component receives `:debug` | A fourth text button toggles debug rectangles, center marker, geometry text, and a guide circle. This branch is source-visible but absent from user documentation and first-party media. | Click toggles global debug state. It has no title or ARIA label. | [debug markup](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/component.cljs#L84-L116), [button/render gate](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/component.cljs#L1411-L1417) |

### Execution Layer

| Surface | State or trigger | Observable contract | Interaction and focus contract | Evidence |
| --- | --- | --- | --- | --- |
| Execution disabled | Default setting, or user successfully disables it | No execution trigger, popover, task context commands, or plugin timing surface exists. If a CLOCK was active, disabling first closes it; failure leaves the setting enabled. | The planner remains fully usable. Settings retain only the master Execution Layer switch; dependent controls are hidden. | [entry lifecycle](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/index.js#L170-L233), [settings branch](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/index.js#L324-L451) |
| Execution enable rejected | Roam Logbook is already running | A danger host toast says the two extensions may not both write CLOCK records. Nautilus execution surfaces remain absent and the master setting is rolled back to off. | There is no bypass action; the user must disable the conflicting extension before enabling again. | [conflict guard/toast](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/timing-runtime.js#L442-L447), [setting rollback](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/index.js#L212-L220) |
| Topbar trigger, idle | Execution enabled; no CLOCK or standalone POMO | A 30 px transparent button shows Blueprint `unresolve`; title is `Nautilus Log`. | Click opens a dialog popover. The button exposes `aria-haspopup`, `aria-controls`, and `aria-expanded`. | [mount/trigger](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/timing-topbar.js#L608-L675), [CSS](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/extension.css#L778-L827) |
| Topbar trigger, active CLOCK | One task CLOCK is focused | Trigger becomes a compact tabular `elapsed · N Thread(s)` signal. Its title becomes the focused task title. | Click opens the popover; CLOCK actions occur inside the popover or commands/context menu, not by clicking elapsed text. | [render state](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/timing-topbar.js#L617-L645), [active CSS](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/extension.css#L822-L841) |
| Topbar trigger, POMO threshold reached | Active CLOCK's shared POMO cycle passes threshold | Only elapsed text turns red; timing continues. | No automatic stop or reset. | [state toggle](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/timing-topbar.js#L618-L642), [CSS](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/extension.css#L829-L841) |
| Topbar trigger, forgotten CLOCK | Active CLOCK exceeds configured warning | Trigger gains a faint amber background, amber elapsed text, and a warning-sign icon; accessible label and title begin with `Check CLOCK`. | Warning is informational and never stops or deletes the CLOCK. | [state toggle](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/timing-topbar.js#L622-L642), [CSS](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/extension.css#L874-L902), [guide](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/docs/guide.md#L89-L95) |
| Topbar trigger, standalone POMO | No CLOCK; standalone POMO active | Trigger reads tabular `elapsed · POMO`; a separate 24 px multiplication-sign button appears. After threshold, elapsed and POMO label turn red. | Trigger still opens the panel. The adjacent labelled close button stops POMO and prevents the trigger click from firing. Starting a task CLOCK clears POMO. | [render/actions](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/timing-topbar.js#L574-L606), [mount/close](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/timing-topbar.js#L647-L671), [CSS](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/extension.css#L829-L872) |
| Popover shell | Trigger activated | A body-level fixed dialog is 260-420 px wide, horizontally constrained to a 12 px viewport margin when the viewport can accommodate its 260 px minimum, with max height `min(560px, viewport - 72px)`, 8 px radius, one border, and two shadows. It paints cached state synchronously before requesting a refresh. | Re-clicking the trigger closes it and restores trigger focus. Outside mousedown closes without explicit focus restoration; Escape closes and restores trigger focus. There is no encoded initial-focus or focus-trap behavior. | [open/position](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/timing-topbar.js#L520-L572), [close](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/timing-topbar.js#L86-L100), [shell CSS](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/extension.css#L904-L924) |
| Popover header | Any open view | Left identity contains the Blueprint `unresolve` icon, `Nautilus` text, and chevron, followed by a 20 px divider and `Timing / Plan / Review` tabs. A stopwatch action appears at far right only when no CLOCK and no POMO is active. | Identity locates the Primary Plan and closes the popover. Tabs are buttons with `tablist`, `tab`, `aria-selected`; only click switching is implemented. Stopwatch starts POMO and closes. | [header markup/actions](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/timing-topbar.js#L403-L446), [header CSS](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/extension.css#L917-L1012) |
| Capacity strip | Plan projection exists | A 32 px strip sits under the header on every tab. It keeps `Available` and exactly one of `Remaining`, `Overload`, or `No fitting slot` grouped on the left; warning state is restrained amber. Typography is sampled from the rendered planner metrics. | Static summary with an ARIA label; long metrics ellipsize. | [projection/markup](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/timing-topbar.js#L212-L239), [font sync](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/timing-topbar.js#L530-L536), [CSS](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/extension.css#L1051-L1083) |
| Notice/error strip | Runtime snapshot has notice, including refresh/mutation failure | A pale amber, bottom-bordered status strip appears between header and capacity. | `role="status"`; no local dismiss/retry action. Failed commands may also produce a host toast. | [notice markup](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/timing-topbar.js#L448-L455), [runtime state](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/timing-runtime.js#L152-L210), [CSS](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/extension.css#L1042-L1049) |
| Working/mutation state | Serialized graph mutation is pending | Existing list structure stays in place; all row action buttons become disabled at 38% opacity with default cursor. The panel avoids a full rebuild until confirmed state arrives. | Titles/tabs are not disabled by this state. | [fast path](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/timing-topbar.js#L377-L400), [button state](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/timing-topbar.js#L164-L195), [disabled CSS](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/extension.css#L1014-L1026) |
| Clock In sidebar placement warning | `Keep Timing Line first in right sidebar` is on, but Roam cannot place the task | A host warning toast states that the task started but could not be shown at the top of the sidebar. The sidebar attempt is reversible UI feedback and does not block the authoritative CLOCK mutation. | Clock In proceeds; this branch is partial navigation failure, not a failed timing action. | [non-blocking sidebar path](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/timing-runtime.js#L344-L355) |
| Timing tab, focused row | CLOCK active | Focused row has pale blue fill and blue border. It shows title plus `Timing elapsed · Actual ... · Planned ...`; forgotten state changes row and meta to amber. Actions are Clock Out, Complete, and Trash. | Title click opens the task in main window; Shift-click opens right sidebar. Clock Out stops timing; Complete closes owned CLOCK then completes task. Trash requires a second click within 2.5 seconds and changes title/ARIA plus red confirmation styling. | [row/actions](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/timing-topbar.js#L106-L199), [row CSS](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/extension.css#L1276-L1352) |
| Timing tab, Recent row | Closed entry still within retention | Ordinary row shows `Recent · N left · Actual/Planned`; actions are Clock In and Complete. | Same title navigation and actions as other task rows. | [row projection](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/timing-topbar.js#L132-L172), [tab branch](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/timing-topbar.js#L457-L464) |
| Timing tab, empty | No focused or Recent work | Centered muted copy says `No active work. Open Plan to start a task.` | No embedded action despite the instruction; user changes tab. | [branch](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/timing-topbar.js#L457-L464), [copy](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/timing-core.js#L18-L40) |
| Plan tab, scheduled | Primary Plan and execution projection exist | Upper section is labelled uppercase `Scheduled today`, with count and total duration. Rows show projected `Today HH:MM–HH:MM · remaining/planned duration`; active Timing state does not overwrite these deterministic labels. | Row actions are Clock In/Out and Complete; title navigation follows click/Shift-click behavior. | [branch](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/timing-topbar.js#L465-L479), [row metadata](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/timing-topbar.js#L142-L160), [section CSS](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/extension.css#L1213-L1269) |
| Plan tab, unscheduled | Overflow tasks exist | A lower amber `Unscheduled today` section shows count and duration. It starts folded and adds no card, left rail, or disabled appearance; expanded rows show `Unscheduled · Planned...` in amber metadata. | Header is a button with `aria-expanded`; click toggles rows without changing the focused row's projection. | [branch](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/timing-topbar.js#L480-L497), [CSS](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/extension.css#L1271-L1303) |
| Plan tab, empty variants | No Primary Plan, or Primary Plan has no unfinished direct children | Muted centered text distinguishes `No Nautilus Log was found...` from `The Primary Plan has no unfinished direct-child tasks.` | No embedded action. | [branch](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/timing-topbar.js#L498-L505), [copy](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/timing-core.js#L34-L39) |
| Review tab, populated | Primary Plan has review rows | A summary above the scroll list shows Completed, Compared, and aggregate Planned/Actual/Variance. Rows show title, a pill state (`compared`, `live`, `paused`, `not tracked`, `not started`), then planned/actual and variance where comparable. Positive variance is amber; live state is blue. | Task title click/Shift-click navigates main/sidebar. Review has no timing or completion action column. Live Actual text updates without rebuilding the view. | [summary/row markup](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/timing-topbar.js#L268-L355), [tab branch](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/timing-topbar.js#L506-L516), [CSS](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/extension.css#L1085-L1193) |
| Review tab, empty variants | No Primary Plan, or no reviewable direct children | Muted centered text distinguishes missing plan from no review tasks. Summary is omitted. | No embedded action. | [branch](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/timing-topbar.js#L506-L516), [copy](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/timing-core.js#L34-L39) |
| Long execution lists | Content exceeds panel height | Timing/Plan list scrolls up to 468 px/viewport constraint; Review list uses a smaller 398 px constraint. Native scrollbar chrome is hidden in Firefox, legacy MS, and WebKit. | The CSS proves overflow scrolling, but the repository has no host-level wheel, trackpad, or keyboard-scrolling evidence; keyboard behavior is Unknown pending HITL. | [list CSS](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/extension.css#L1195-L1215) |
| Very narrow popover | Browser viewport at or below 320 px | Identity text `Nautilus` hides, while shell icon, chevron, divider, and all three tabs remain. Header/tab padding tightens. | Interaction set remains unchanged. | [responsive CSS](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/extension.css#L1409-L1430) |

### Host-owned surfaces

| Surface | Observable contract | Evidence and boundary |
| --- | --- | --- |
| Settings panel | Native Roam settings controls: language select; chart start/end selects; component prefix input; legend-length select; default-duration select; urgent-trigger input; Execution Layer switch. When enabled, sidebar switch, POMO threshold select, Recent-retention input, and forgotten-timer input are appended. Changing language rebuilds the panel immediately. | [configuration](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/index.js#L249-L451). **Unknown:** the repository contains no screenshot or CSS for Roam's host-rendered setting rows. Pixel styling is not part of the plugin-owned baseline. |
| Command Palette | Three entries exist only while Execution Layer is enabled: focus current block, Clock Out, and locate Primary Plan. No default hotkeys are installed; users bind them in Roam Settings. Failures produce a host warning toast. | [commands](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/timing-commands.js#L4-L57), [guide](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/docs/guide.md#L136-L145) |
| TODO context menu | `Clock in` appears only for unfinished TODOs; `Clock out` appears only on the task that owns the focused CLOCK. | [registration and conditions](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/timing-commands.js#L43-L84). Menu geometry and styling are host-owned. |
| Native navigation/sidebar | Planner/review title click opens the source task in the main window; Shift-click opens it in the right sidebar. Clock In optionally opens or moves the active task to order zero without disturbing unrelated windows. Locate opens the Primary Plan, scrolls it into view, and adds a 1.2-second ring animation. | [title interaction](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/timing-topbar.js#L123-L130), [runtime routing](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/timing-runtime.js#L507-L520), [locate CSS](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/extension.css#L1362-L1369) |

## Design-token inventory

### Planner semantic colors

These variables are the direct v1.0.2 palette. Obsidian may map them onto
host-aware custom properties, but the semantic relationships must stay stable:
urgent is red, Fixed Event is yellow/amber, Flexible Task is blue, current time
is red, historical/completed content is muted, and warnings are amber.

| Token | Light | Dark | Role |
| --- | --- | --- | --- |
| `--nautilus-log-text-main` | `#555` | `#eee` | Primary planner text |
| `--nautilus-log-text-sub` | `#999` | `#c7c7c7` | Secondary text |
| `--nautilus-log-spiral` | `#888` | `#aaa` | Hour grid |
| `--nautilus-log-line` | `rgba(25,25,25,.09)` | `rgba(255,255,255,.1)` | Flat separators |
| `--nautilus-log-hover` | `rgba(25,25,25,.05)` | `rgba(255,255,255,.08)` | Quiet hover fill |
| `--nautilus-log-warning` | `#c96c00` | `#f4b75d` | Overload, conflict, warnings |
| `--nautilus-log-event` | `#c58a00` | `#f2c14e` | Event labels and metrics |
| `--nautilus-log-event-fill` | `#fee18a` | `#6d570f` | Event slices |
| `--nautilus-log-task` | `#0899c8` | `#47b8df` | Task labels/connectors/current outline |
| `--nautilus-log-task-fill` | `rgba(8,153,200,.28)` | `rgba(71,184,223,.32)` | Task slices |
| `--nautilus-log-control-icon` | `#888` | `#aaa` | Planner controls/flame |
| `--nautilus-log-now` | `#d44b4b` | `#ff8b78` | Center now text |
| `--nautilus-log-past-overlay` | `rgba(86,101,116,.08)` | `rgba(255,255,255,.06)` | Elapsed wash |
| `--nautilus-log-unplanned-stripe` | `rgba(86,101,116,.34)` | `rgba(255,255,255,.24)` | Unrecorded elapsed hatching |
| `--nautilus-log-completed` | `#77818c` | `#aeb8c2` | Completed label |
| `--nautilus-log-completed-fill` | `rgba(86,101,116,.22)` | `rgba(199,207,214,.2)` | Completed task fill |
| `--nautilus-log-past-event-fill` | `rgba(252,194,0,.24)` | `rgba(242,193,78,.23)` | Past event fill |
| `--nautilus-log-slot-hover` | `rgba(86,101,116,.08)` | `rgba(199,207,214,.09)` | Available-slot hover fill |
| `--nautilus-log-slot-stroke` | `rgba(86,101,116,.5)` | `rgba(199,207,214,.54)` | Available-slot dashed stroke |

All values and Roam dark-theme selectors are defined together in
[`extension.css` lines 4-47](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/extension.css#L4-L47).
Two semantic marks are hard-coded outside that table: urgent is
`rgba(234,15,15,.72)` in the renderer
([source](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/component.cljs#L8-L16)),
and legend/compact dots use `#ea0f0f` urgent and `#fcc200` event
([CSS](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/extension.css#L234-L243)).
The needle stroke is hard-coded translucent `#EA0F0F5B`
([source](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/component.cljs#L68-L82)).

### Geometry and typography

| Contract | Value | Evidence |
| --- | --- | --- |
| Base SVG | Desktop 600 x 420; Roam mobile 450 x 315; width 100%, dynamic viewBox may grow for outside labels | [constants](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/component.cljs#L30-L66), [viewBox](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/component.cljs#L1240-L1269) |
| Spiral geometry | Desktop inner radius 50 px; blueprint outer radii `[0 x5, 135,140,145,150,145..70]`; Roam mobile multiplies inner and outer radii by 0.7; 15 px side reserve; 18 px additional label-track radius; maximum three label tracks | [constants/scaler](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/component.cljs#L30-L66), [track placement](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/component.cljs#L1093-L1125) |
| Spiral type | 14 px desktop / 12 px Roam mobile; font stack `FZPingXianYaSong`, `PingFang SC`, `Microsoft YaHei`, sans-serif; center date 0.85x and center time 0.82x; centered title truncated to 16 characters | [constants](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/component.cljs#L50-L66), [center markup](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/component.cljs#L961-L980) |
| Planner header | 54 px minimum; metrics use 12 px values/labels, 11 px totals/percent, 32/16 px two-row tracks; controls 32 x 32, 6 px radius | [header CSS](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/extension.css#L100-L175), [controls](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/extension.css#L567-L592) |
| Compact breakpoint | Both ResizeObserver logic and CSS container query use `<= 520px`; an extra `<= 360px` rule caps SVG height at 48vh | [logic](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/log-core.js#L1233-L1235), [CSS](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/extension.css#L678-L746) |
| Compact list | Rows 30 px minimum, columns 8/78/flexible, 12 px text; summary 30 px minimum, 11 px text | [CSS](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/extension.css#L289-L388) |
| Tooltip | Max 240 px, 6 x 8 px padding, 5 px radius, 11 px, title max 220 px and ellipsized, fixed z-index 10060 | [CSS](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/extension.css#L468-L507) |

The first-party fixed-SHA overview is a 3022 x 1900 light-theme composite. It
shows the wide chart, compact right-sidebar chart, folded compact Schedule,
overflow disclosure, and open Timing popover in one Roam workspace
([baseline image](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/docs/assets/nautilus-log-overview.png)).
It is corroborative media, not a substitute for markup/CSS because it does not
cover every state.

### Execution colors, sizing, and elevation

The Execution Layer references four custom properties (`--nl-exec-surface`,
`--nl-exec-text`, `--nl-exec-muted`, and `--nl-exec-font-family`) plus many
deliberate hard-coded neutrals:

- Default surface/text/muted fallbacks are `#fff`, `#303744`/`#374151`, and
  `#6b7280`; the detached popover samples the planner's computed font family.
  Dark mode changes surface/text/muted to `#242a31`, `#e4e8ee`, and `#a0a8b4`
  ([shell and dark CSS](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/extension.css#L904-L915),
  [dark overrides](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/extension.css#L1371-L1407),
  [font sync](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/timing-topbar.js#L530-L536)).
- Live/focused blue is based on `rgba(20,145,190,...)`; link/focus blue falls
  back to `#137cbd`; warning/overage uses `#ad690f`, `#b96f12`, and related amber
  alpha fills; destructive confirmation uses `#c73737`/`rgba(209,67,67,.1)`
  ([row CSS](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/extension.css#L1276-L1345),
  [delete CSS](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/extension.css#L1023-L1040)).
- Popover radius is 8 px; task-row radius 6 px; controls/tabs/identity are 4 px.
  The panel has a two-layer shadow, while rows and sections remain flat
  ([popover CSS](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/extension.css#L904-L924),
  [row CSS](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/extension.css#L1276-L1289)).
- Header is at least 44 px; row is at least 54 px; icon buttons are 30 x 30;
  main row title is 13 px/600, metadata 11 px; review title is 12 px/600
  ([header/actions](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/extension.css#L917-L1021),
  [row type](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/extension.css#L1276-L1340)).
- Icons are not standalone assets: they depend on Roam's Blueprint 3
  `bp3-icon bp3-icon-*` glyph classes. The planner controls use inline SVGs
  instead
  ([execution icon factory](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/timing-topbar.js#L13-L27),
  [planner controls](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/component.cljs#L1343-L1409)).

### Motion and transition inventory

| Motion | Duration/behavior | Reduced motion | Evidence |
| --- | --- | --- | --- |
| Planner slice fill/stroke | 200 ms ease | Reduced to 0.001 ms | [CSS](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/extension.css#L390-L392) |
| Label weight/filter | 150 ms ease | Reduced | [CSS](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/extension.css#L425-L446) |
| Available-slot fill/stroke | 140 ms ease | Reduced | [CSS](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/extension.css#L448-L466) |
| Tooltip fade | 80 ms ease after measurement | Reduced | [CSS](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/extension.css#L468-L492) |
| Compact chevron | 140 ms rotation | Reduced | [CSS](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/extension.css#L316-L330) |
| Playback reveal | 350 ms pop-in with per-item delay over a six-second simulation | Animations reduced; simulation still runs | [CSS](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/extension.css#L748-L769) |
| Identity chevron | 120 ms opacity/1 px translation | No Execution-specific reduction rule, but this element is outside `.nautilus-log-container` | [CSS](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/extension.css#L974-L984) |
| Locate ring | 1.2 s ease-out | Explicitly disabled | [CSS](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/extension.css#L1362-L1369), [reduction](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/extension.css#L1432-L1434) |

## Complete interaction catalog

| Input/action | Result | State limits and feedback | Evidence |
| --- | --- | --- | --- |
| Click Eye | Toggle completed slices/list rows | Per-mounted-instance state defaults visible and is not persisted; title and ARIA label switch between Show/Hide completed | [markup](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/component.cljs#L1343-L1355), [initial state](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/component.cljs#L1722-L1738) |
| Click Play | Start six-second non-writing replay | Disabled during replay; simulated now/animation | [markup](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/component.cljs#L1385-L1409) |
| Click Collapse/Expand | Persist per-instance collapsed state | Only Expand remains when collapsed | [markup](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/component.cljs#L1357-L1383) |
| Click today's task slice/label | Add 10% progress; 100% converts TODO to DONE with time; clicking displayed DONE reopens it as TODO at 10% | Pointer cursor only when enabled; no confirmation/undo surface | [mutation](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/component.cljs#L478-L510), [targets](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/component.cljs#L836-L865) |
| Hover/focus item or blank slot | Reveal tooltip and emphasis | Wide only; blur/mouseleave hides; no click action on slot | [item target](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/component.cljs#L1050-L1068), [slot target](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/component.cljs#L1215-L1238) |
| Toggle planner native details | Open/close Overview, Schedule, overflow, or warning content | These four surfaces use native `details/summary`. Compact Overview starts folded; compact Schedule starts folded only in right sidebar. | [compact disclosures](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/component.cljs#L1168-L1196), [overflow/warning disclosures](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/component.cljs#L1603-L1629) |
| Click Plan Unscheduled header | Expand/collapse Plan overflow rows | This is a custom button with `aria-expanded`, not native `details`; it starts folded and resets folded when the popover closes. | [execution disclosure](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/timing-topbar.js#L480-L497), [close reset](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/timing-topbar.js#L86-L100) |
| Click execution trigger | Open/close popover | Cached content paints first. Selected Timing/Plan/Review view persists across close/reopen during the controller lifetime, but Unscheduled expansion resets folded on close. Close restores focus only on trigger re-click/Escape. | [controller state/close](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/timing-topbar.js#L47-L100), [open](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/timing-topbar.js#L538-L572) |
| Outside mousedown / Escape | Close popover | Escape restores trigger focus; outside click does not explicitly do so | [handlers](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/timing-topbar.js#L564-L571) |
| Click identity | Close and locate Primary Plan | Opens main window, scrolls into view, pulses ring | [handler](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/timing-topbar.js#L403-L415) |
| Click Timing/Plan/Review | Switch view | Selected button gets active fill and `aria-selected=true`; no graph read on switch | [handler](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/timing-topbar.js#L418-L432) |
| Click stopwatch | Start standalone POMO and close popover | Hidden while CLOCK/POMO exists | [handler](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/timing-topbar.js#L435-L445) |
| Click topbar multiplication sign | Stop standalone POMO | Prevents trigger/open action | [handler](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/timing-topbar.js#L660-L670) |
| Click task/review title | Open task in main window | Shift-click opens right sidebar; popover closes first | [task](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/timing-topbar.js#L123-L131), [review](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/timing-topbar.js#L305-L315) |
| Click Play/Log out action | Clock In inactive row or Clock Out focused row | All row actions disabled during mutation; focused styling updates after confirmation | [actions](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/timing-topbar.js#L164-L172) |
| Click Confirm action | Complete task, closing its running CLOCK first | Disabled during mutation | [action](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/timing-topbar.js#L164-L172), [runtime](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/timing-runtime.js#L404-L412) |
| Click Trash twice | Delete only current open CLOCK | First click enters red confirmation for 2.5 seconds and changes title/ARIA; second disables button and mutates | [handler](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/timing-topbar.js#L173-L195) |
| Enable Execution while Roam Logbook runs | Reject activation, show danger toast, and roll the setting back off | Prevents competing writers; no execution UI is mounted | [guard](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/timing-runtime.js#L442-L447), [rollback](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/index.js#L212-L220) |
| Clock In when sidebar placement fails | Continue CLOCK mutation and show a warning toast | The toast distinguishes navigation failure from timing success | [runtime path](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/timing-runtime.js#L344-L355) |
| Run palette command | Focus current block, global Clock Out, or locate plan | No default hotkey; invalid focus/mutation produces warning toast | [commands](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/timing-commands.js#L31-L69) |
| Choose TODO context command | Clock In unfinished TODO or Clock Out focused task | Conditional visibility is part of the contract | [context commands](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/timing-commands.js#L59-L69) |
| Change setting | Immediately publish settings; planner rerenders; some settings rewrite component template | Execution switch rebuilds panel to reveal/hide dependent controls; disable closes active timing before removing UI | [settings handlers](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/index.js#L307-L451), [enable/disable](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/index.js#L212-L233) |

## Keyboard and accessibility contract

### Observed requirements

- Every planner icon control is a native button with a localized `title` and
  `aria-label`; the collapse icon is decorative
  ([controls](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/component.cljs#L1343-L1409)).
- Wide item slices and Available slots are keyboard focusable SVG groups with
  `role="img"`, complete labels, and the same tooltip/emphasis as hover. The
  current task adds `aria-current=true`
  ([items](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/component.cljs#L1025-L1068),
  [slots](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/component.cljs#L1215-L1238)).
- Capacity metrics, legend, compact Overview summary, burning icon, now needle,
  compact schedule, popover dialog, tabs, notice, and collapsible Plan header all
  expose explicit roles or labels where encoded
  ([planner labels](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/component.cljs#L1291-L1299),
  [metrics/legend](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/component.cljs#L1517-L1556),
  [execution ARIA](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/timing-topbar.js#L403-L455)).
- Execution icon-only buttons always get a title and ARIA label, while glyph
  spans are `aria-hidden`
  ([factory](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/timing-topbar.js#L13-L27)).
- Escape closes the popover and restores trigger focus. Reduced motion is
  supported for the planner and locate ring
  ([keyboard handler](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/timing-topbar.js#L564-L571),
  [planner motion CSS](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/extension.css#L761-L769),
  [locate reduction](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/extension.css#L1432-L1434)).

### Defects that are not parity requirements

The source also establishes gaps. Reproducing these defects is not required for
one-to-one observable parity; Obsidian-native fixes are permitted if they do not
change the action, state, or information hierarchy.

- The tablist has no arrow-key navigation, roving `tabindex`, or associated
  `tabpanel` elements; it implements click only
  ([tabs](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/timing-topbar.js#L418-L432)).
- The dialog does not focus an element on open, trap focus, or explicitly return
  focus after outside click
  ([open/close](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/timing-topbar.js#L86-L100),
  [open handlers](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/timing-topbar.js#L538-L572)).
- Focusable SVG groups use `outline:none`; focus is conveyed through the same
  slice/connector styling as hover, without a conventional focus ring
  ([CSS](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/extension.css#L398-L446)).
- Pointer progress-clicking on TODO slices/labels has no equivalent Enter/Space
  handler on the SVG group. The group is labelled as an image, not a button
  ([target markup](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/component.cljs#L1025-L1091)).
- Urgent state changes the slice color, but the wide slice ARIA label still says
  only `Task`; it does not announce urgency
  ([tone calculation](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/component.cljs#L982-L1040)).
- Several button focus-visible rules remove outline and rely only on color or a
  subtle fill. Identity alone adds an inset focus ring
  ([execution controls](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/extension.css#L811-L820),
  [identity](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/extension.css#L953-L962)).
- `prefers-reduced-motion` for the planner is scoped to
  `.nautilus-log-container`; the body-level execution identity chevron retains
  its 120 ms transition. Only the locate animation has an execution-specific
  reduction rule
  ([planner reduction](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/extension.css#L761-L769),
  [execution reduction](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/extension.css#L1432-L1434)).

## Obsidian parity boundary

### Must remain observable

1. The planner remains a flat work surface, not a collection of decorative
   cards: capacity/controls/legend, spiral, and disclosures keep the same visual
   hierarchy.
2. Semantic color roles and every state in the matrices remain distinguishable
   in both light and dark themes, including current, completed, past event,
   unrecorded past, conflict, overflow, no-slot, active, forgotten, and overdue.
3. Wide mode keeps outside labels and item/slot tooltips; compact mode removes
   them and provides the folded Overview plus structured Schedule list. Compact
   Schedule defaults folded in a sidebar context.
4. Planner interactions preserve their state effects: completed visibility,
   playback, per-render-block-UID collapse, disclosures, hover/focus details,
   and explicit progress advancement.
5. The Execution Layer stays absent while disabled. When enabled, idle/CLOCK/
   forgotten/POMO topbar states, the three views, capacity strip, notices, empty
   variants, row actions, confirmation, and navigation semantics remain present.
6. English and Simplified Chinese must not change geometry or hide actions; copy
   comes from stable message keys in both planner and execution sources
   ([planner copy](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/log-core.js#L778-L872),
   [execution copy](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/timing-core.js#L18-L68)).

### Permitted Obsidian-native adaptations

- Replace Blueprint glyph classes and inline SVG controls with Obsidian/Lucide
  icons while preserving icon meaning, labels, state, and stable hit-area size.
- Map Roam dark selectors to Obsidian theme variables and `.theme-dark`, and
  adjust color values when required for contrast. Preserve semantic hue roles,
  relative emphasis, flatness, and warning/destructive meaning rather than exact
  inaccessible hex values.
- Implement a correct keyboard tab pattern, dialog/modal focus lifecycle,
  visible focus rings, Enter/Space progress activation, and complete reduced
  motion. These are improvements over observed gaps, not behavioral drift.
- Use native Obsidian Settings, commands, notices, workspace leaves, and sidebar
  navigation. Host chrome does not require Roam pixel matching, but command
  availability, conditional actions, and resulting plugin state do.
- Replace the Roam-specific topbar insertion point with the chosen Obsidian
  execution entry surface. The required parity is the idle/active/POMO signal
  and one-step access to the panel, not `.rm-topbar` DOM placement.
- Use Obsidian's inherited UI font for panel chrome while retaining the chart's
  measured-label geometry and CJK-safe fallbacks.

## Light/dark and compact/wide risks

| Risk | Why it matters | Required mitigation/evidence |
| --- | --- | --- |
| Roam-only dark selectors | Planner uses `.bp3-dark`/`.roam-app.rm-dark-theme`; execution uses `.bp3-dark`/`.dark`. These do not map directly to Obsidian and the detached popover may miss ancestor theme selectors. | Define Obsidian theme-scoped semantic tokens at the plugin root/portal host; capture the same fixture in light and dark. [planner CSS](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/extension.css#L26-L47), [execution CSS](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/extension.css#L1371-L1407) |
| Hard-coded execution neutrals | Many text, badge, warning, destructive, border, and hover colors bypass theme variables. Exact porting can produce poor contrast in community themes. | Tokenize them, retain semantic emphasis, run contrast checks across default and high-contrast/custom themes. |
| Hard-coded urgent/event dots | `#ea0f0f` and `#fcc200` do not change in dark mode, and color is not always paired with visible text on the compact spiral. | Keep dot plus text labels/list labels; verify contrast and non-color cues. |
| Dual 520 px switch | JS state and CSS container query must agree. A one-pixel mismatch changes labels, tooltips, Overview, and Schedule simultaneously. | Test exact content widths 519, 520, and 521 px at multiple zoom levels; use one shared breakpoint token/source. [test](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/test/log-core.test.js#L1012-L1015) |
| Leaf width is not viewport width | Obsidian split panes and sidebars frequently make a desktop leaf compact while the window remains wide. | Preserve container-based behavior; do not use only viewport media queries for the planner. |
| Dense/long plans | Wide label placement has three tracks and finite collision attempts; compact titles and execution metadata ellipsize. Chinese/English widths differ. | Fixture needs dense left/right labels, long CJK/Latin titles, 24:00, many overflow rows, and zoom 80-200%. |
| Compact clipping | At <=360 px SVG height caps at 48vh, outside labels are hidden, and tooltips are removed intentionally. | Verify chart remains inspectable with Schedule list as the textual equivalent and no overlap with Overview/overflow. |
| Popover viewport edges | Width is 260-420 px and horizontally clamped, while vertical placement is a simple top value plus max-height. Obsidian titlebars/status bars differ. | Prototype at all screen edges and short-height windows; keep the list scrollable and header/actions visible. |
| Portal token inheritance | The execution panel attaches to `document.body`; the tooltip also portals there when `ReactDOM.createPortal` is available, with an inline fallback otherwise. Component-local custom properties do not naturally inherit across the portal branch. | Put required variables on a stable plugin portal root or pass computed values explicitly, as upstream already does for font family. [tooltip branch](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/component.cljs#L457-L476), [execution mount](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/timing-topbar.js#L538-L545) |
| Reduced motion scope | Upstream does not suppress every execution transition. Playback delays also remain while duration collapses, so delayed elements can stay at opacity zero before appearing instantly. | Remove delay as well as duration in reduced motion, and apply one plugin-wide rule without removing state feedback. [playback/reduction CSS](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/extension.css#L748-L769) |
| Host icons and font metrics | Blueprint icons and the named Chinese chart font may not exist in Obsidian. Glyph width changes can shift 30 px action columns and label placement. | Use Obsidian icons with fixed boxes; test font fallback and label measurement on macOS/Windows/Linux. |

## Evidence gaps and HITL acceptance fixtures

The source suite primarily checks pure geometry/state and source contracts. It
does not include browser screenshots, DOM interaction tests, accessibility-tree
snapshots, or a reproducible Roam graph fixture
([contract test approach](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/test/log-contract.test.js#L1-L17),
[package test command](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/package.json#L1-L17)).
The following evidence is therefore required before declaring visual parity:

| Required fixture | States to capture/test | Current evidence gap |
| --- | --- | --- |
| Canonical wide planner, light and dark | Current task, ordinary/urgent/completed tasks, fixed/past/conflicting events, hatched gaps, flame, now needle, all metrics, overflow and warning disclosures | Only one light composite image; no dark or state-isolated reference |
| Width boundary | 521, 520, 519, 360, and 320 px content widths in main leaf and sidebar | Source/tests establish branches, not rendered clipping or resize transition |
| Temporal matrix | Before workday, inside event, inside Available time, after workday, past note, future note, playback start/middle/end | No first-party recordings or screenshots of these transitions |
| Tooltip edge matrix | All four radial directions, viewport corners, long CJK/Latin title, pointer and keyboard focus | Pure placement tests exist, but no portal/zoom/host-transform rendering evidence |
| Dense plan | Three label tracks, conflicts, 24:00, long titles, many scheduled/overflow/warning rows | No stress screenshot; collision readability is not proven by contract tests |
| Execution topbar | Idle, active, overdue, forgotten, POMO, overdue POMO, and rapid CLOCK/POMO race | One composite Timing screenshot; no isolated topbar states or motion evidence |
| Timing panel | Focused/recent/empty, working-disabled, notice/error, delete confirmation, long scrolled list | Missing screenshots and keyboard interaction traces |
| Plan panel | Scheduled only, folded/expanded Unscheduled, no plan, empty plan, live focused row while Plan projection remains stable | Later `main` image shows Plan but is not the v1.0.2 baseline |
| Review panel | All five row states, no comparison, positive/negative/zero variance, live Actual update, empty states | No fixed-SHA media for Review |
| Settings/host menus | English/Chinese panel with advanced controls hidden/shown; command palette; conditional context commands; notices | All styling is host-owned and absent from repository media |
| Keyboard/a11y | Complete tab order, native disclosure keys, tooltip focus, Escape restoration, dialog containment, tab arrows, screen-reader names/status announcement, 200% zoom | Static ARIA/source checks only; known focus/tab defects need approved Obsidian-native fixes |
| Theme resilience | Obsidian default light/dark plus at least one high-contrast and one heavily customized theme | Upstream hard-coded colors and Roam selectors cannot prove Obsidian compatibility |

Acceptance should use pixel screenshots for stable geometry and state assertions
for semantic behavior. Exact pixel diffs should not compare host-owned chrome;
they should crop the planner leaf and plugin-owned execution surface.

## Fixed-SHA media and drift warning

The `v1.0.2` README embeds its overview through a mutable `raw.../main` URL
([README line 11](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/README.md#L9-L12)).
The asset stored at the baseline commit is therefore the only valid v1.0.2 image
reference. Its Git blob is `0aaf4343b0e1c1d88b066ccd9fa9887dedab73b4`
and dimensions are 3022 x 1900; its SHA-256 is
`d28fb03c452e5936633445e2e290d8350ee271ab166c4f4001848d78b7d2116b`.

At the allowed supplementary `main` SHA, the image is a different 2640 x 1832
asset with Git blob `059407cfc86f749e36a933cd62f605abb83327e4`
and SHA-256
`4e3815053f4826f4066009515748b5dcf5d615f0e4fab13c79da7632d71847cb`
([later image](https://github.com/404KSG/roam-nautilus-log/blob/08892f948c63e4cacd3fc1cc100a600dd38c21f8/docs/assets/nautilus-log-overview.png)).
It depicts a later Plan state, changed capacity/header composition, expanded
compact Schedule, and an additional planner control; it must not override any
v1.0.2 contract above. The two fixed assets and their different blob identities
prove documentation drift; no later `main` CSS or markup was used as baseline
evidence.

## Implementation handoff checklist

- Convert every row in both surface matrices into a named fixture/state story.
- Centralize semantic tokens; do not scatter the upstream hard-coded colors.
- Drive compact rendering from measured leaf width with one 520 px breakpoint.
- Preserve the two-level evidence path: state assertion plus screenshot for every
  visual branch.
- Implement the permitted accessibility corrections explicitly and document
  them as intentional deviations from v1.0.2 defects.
- Treat the fixed-SHA image as composition guidance only; use fixed-SHA markup,
  CSS, and tests as the source of truth for hidden and transient states.
