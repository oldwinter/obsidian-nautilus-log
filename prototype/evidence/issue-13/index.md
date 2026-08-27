# Issue 13 prototype evidence

> Ticket claim: validate that a dockable Obsidian planner can preserve the accepted planning hierarchy and complete a conflict-safe Markdown round trip before any production architecture is chosen.

This is throwaway evidence for [issue 13](https://github.com/oldwinter/obsidian-nautilus-log/issues/13), not production architecture. The human explicitly delegated the variant choice, so the prototype compares A/B/C against the accepted decisions and research and recommends the best-supported result without a preference checkpoint.

## Result

**Approve variant A, Spiral first.** It is the only variant that preserves the accepted spiral time geometry, fixed/flexible/urgent semantics, parity-led capacity header, wide outside labels, compact disclosures, and an unframed overflow region in one dockable view.

- **A approved:** strongest at-a-glance time/capacity model; corrected wide labels stay outside the arc exclusion zone, and compact mode gives the spiral the available width.
- **B rejected as the default:** the chronological rail scans well but loses the distinctive spiral/capacity model and makes gaps more linear than comparable.
- **C rejected as the default:** operations columns help backlog triage but weaken time geometry and make the day feel like a generic task board. It could inform a secondary backlog view.

## Review findings resolved

The read-only visual review is retained in the release bundle as `prototype-review-a.md`.

| Finding | Resolution | Evidence |
| --- | --- | --- |
| Wide bilingual labels and leaders collided | Removed leaders; placed shortened visible labels in fixed side tracks while retaining full bilingual SVG title/ARIA text. All seven label boxes are inside the `0..600` viewBox, outside `x=132..468`, with zero pair intersections. | `variant-a-wide-light.png`, `variant-a-wide-dark.png`, `boundary-521-dark.png` in bundle |
| Compact contract was inverted | At `<=520px`, Overview and Schedule both initialize folded. Overview owns metrics/legend; Schedule owns the item list. Their open choices survive compact -> wide -> compact rerenders. | `variant-a-compact-300-dark.png`, `compact-overview-open-dark.png` |
| Parity header/control state was missing | Variant A now uses the accepted flat 2x2 metrics header, legend, and three functional 32px icon controls for collapse, completed visibility, and six-second playback. | `variant-a-wide-*.png`, `parity-controls-collapsed-dark.png`, `reduced-motion-state-dark.png` |
| Compact spiral underused 300px | Compact viewBox and container sizing now produce a 252x252 spiral in a 300px dock (276px content root), without outside labels. | `variant-a-compact-300-dark.png` |
| Focus replaced semantic hue | Focus uses a separate accent halo path behind the unchanged semantic segment. Dark: halo `rgb(138,92,245)` at `0.92`, fixed segment `rgb(231,184,75)` at `1`. Light: halo `rgb(152,115,247)`, fixed segment `rgb(211,155,24)`. | `focus-visible-spiral-dark.png`, `focus-visible-spiral-light.png` |
| Bottom switcher overlapped scroll content | The switcher is a separate grid row after the planner scroll container. At scrollTop `0`, `161.5`, and `323`, root bottom equals rail top, overlap is `0`, and hit-testing selects the rail rather than planner content. | `switcher-{top,middle,bottom}-scroll-dark.png` |
| Disclosure focus was not visible | Compact disclosures and state/source summaries now receive a 2px Obsidian-accent focus outline with `-2px` offset. | `focus-visible-compact-summary-dark.png` |

## Renderer QA

- Real renderer: Obsidian `1.13.7`, isolated CDP port `9344`, disposable vault `/tmp/wayfinder-obsidian-isolated.POAjNk/vault`.
- Isolation command: `/Applications/Obsidian.app/Contents/MacOS/Obsidian --user-data-dir=/tmp/wayfinder-obsidian-isolated.POAjNk/profile --remote-debugging-port=9344 --enable-logging=file --log-file=/tmp/wayfinder-obsidian-isolated.POAjNk/evidence/electron.log`.
- Safety: the ambiguous PID `97338` was command-line checked and gracefully stopped; its `/tmp/wayfinder-obsidian.wm0rZP` root was preserved. Existing Obsidian PID `970` was never clicked, written, or stopped.
- Exact responsive boundary: root `519px` -> compact, `520px` -> compact, `521px` -> wide; each had `clientWidth == scrollWidth == measured width`.
- Exact 200% zoom: renderer zoom factor `2`, expanded isolated window `1651x1074`, compact root `276px`, no horizontal overflow; full dock remained visible and readable.
- Keyboard: ArrowRight moved A -> B; while B's bilingual filter input was focused, ArrowRight left B selected; after blur, ArrowRight moved B -> C.
- Reduced motion: media query matched; sampled segment/control animation and transition durations were `1e-06s` with `0s` delay during visible playback.
- Parity controls: completed-item toggle changed spiral item count `7 -> 6 -> 7`; collapse left only `Expand planner` and reduced variant-host height to `0`; playback changed center time and returned to `11:42` after six seconds.
- Theme: stock Obsidian light and dark renderer classes were captured and reviewed.
- Diagnostics after the full flow: agent-browser console empty, page errors empty, Electron log empty.

Committed contact sheets:

- [Baseline without plugin](./baseline-contact-sheet.png)
- [Planner controls, exact preview, conflict, safe rejection](./changed-behavior-contact-sheet.png)
- [Fresh intent, applied write, re-read recovery](./write-success-recovery-contact-sheet.png)
- [Plugin reload, Markdown-derived recovery](./reload-derived-recovery-contact-sheet.png)

## Markdown round trip

The single shared demonstration operated only on the disposable `2026-08-28.md` fixture.

1. Preview captured the exact 852-character source and SHA-256 expectation.
2. Conflict injection changed only unowned watched text before terminal ID `^demo-release`.
3. The stale `Vault.process()` transform reparsed current Markdown, rejected the changed watched line, returned current bytes, and proved the before/after conflict digest stayed `ef21715e073490bb6152289470b09a670abac6e1566c38ea02b0d79cef9398c2` with zero plugin-write bytes.
4. Refresh revalidated one region, one unique open target ID, and the current target line.
5. One `Vault.process()` transform inserted one `LOGBOOK::` and one running `CLOCK`; an authoritative read-after-write confirmed terminal CLOCK ID `^nl-clock-6ddc5db3-249f-4ce3-b9be-03554ce504bd`.
6. Re-read and a real plugin disable/enable/reopen both recovered active CLOCK state from Markdown without a hidden receipt or startup write.

Semantic revalidation after the write: one open marker, one close marker, one `^demo-release`, target still open, conflict retained, nested context retained, ordinary `## Notes` byte-equal, one LOGBOOK, one CLOCK, LF endings retained.

| Fixture | Bytes | SHA-256 |
| --- | ---: | --- |
| [Before](./markdown-before.md) | 968 | `fef39a0fac14c94fae0bce390bccca57eb792695605b75c1c948c24c820ec376` |
| [After](./markdown-after.md) | 1097 | `115d097db60274578874037611d7e9b8f96ea9e0847febd0e420aa9a7d104d25` |

The diff contains only the deliberate human conflict token plus the plugin's `LOGBOOK::`/`CLOCK` pair; nested context and ordinary prose are unchanged.

## Durable assets

Release: [issue-13-prototype-evidence](https://github.com/oldwinter/obsidian-nautilus-log/releases/tag/issue-13-prototype-evidence)

| Asset | Exact URL | Bytes | SHA-256 | ffprobe |
| --- | --- | ---: | --- | --- |
| Baseline recording | [baseline-no-plugin.webm](https://github.com/oldwinter/obsidian-nautilus-log/releases/download/issue-13-prototype-evidence/baseline-no-plugin.webm) | 220106 | `8f6d977ce9e3c4db2ccb0c16ef5adfe7b2cd92b334c4fb65f59a9070ce21601b` | VP9, 2048x1600, yuv420p, 8 fps, 14.000s |
| Changed behavior: controls/conflict/rejection | [changed-behavior.webm](https://github.com/oldwinter/obsidian-nautilus-log/releases/download/issue-13-prototype-evidence/changed-behavior.webm) | 301171 | `d338d3862c195f62921736b535defe0fabe2b4517f807127d2d4c805e5252a1c` | VP9, 2048x1600, yuv420p, 5 fps, 44.000s |
| Successful write and re-read | [write-success-recovery.webm](https://github.com/oldwinter/obsidian-nautilus-log/releases/download/issue-13-prototype-evidence/write-success-recovery.webm) | 156394 | `d3da6401a241ffc0d595e4737160a7e2751ad8f47927787ad554e9ec81c65c7e` | VP9, 2048x1600, yuv420p, 5 fps, 24.000s |
| Reload-derived recovery | [reload-derived-recovery.webm](https://github.com/oldwinter/obsidian-nautilus-log/releases/download/issue-13-prototype-evidence/reload-derived-recovery.webm) | 147626 | `4c847d1416d290e0004b0aab0edb981d0bf33f010033e7d0d1676c51220c76ac` | VP9, 2048x1600, yuv420p, 5 fps, 16.000s |
| Complete reviewed bundle | [issue-13-evidence.zip](https://github.com/oldwinter/obsidian-nautilus-log/releases/download/issue-13-prototype-evidence/issue-13-evidence.zip) | 5958810 | `401f923de51ea7362fffc6e13486f60ff78ba383ec5356450623885bfaaa27c7` | 33 entries; `unzip -t` passed |

Every published video was probed, every recording was reviewed through a contact sheet, every included image was opened and reviewed, and the bundle passed `unzip -t`. The 119MB renderer frame directories remain only under the guarded `/tmp` root and are not in Git or the Release.

## Remaining gaps

- This prototype intentionally does not choose production persistence, scheduling, parser, state-management, or migration architecture.
- Stock light/dark and the bilingual stress fixture were tested; third-party Obsidian themes were not exhaustively sampled.
- CDP renderer capture proves the actual Obsidian surface and interactions, but does not include OS-level pointer chrome.

Map gist: **Issue 13 proves `dockable ItemView -> variant A parity surface -> guarded Vault.process Markdown round trip`; parent map issue 1 is unchanged.**
