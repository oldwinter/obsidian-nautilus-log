# Execution — Review tab

Compare planned time against recorded time for a chosen date.

## Sub-features

- **Today** is writable; past and future dates are read-only.
- Date navigation with keyboard focus retention and a visible focus outline.
- **Search task titles** (case-insensitive, trims, survives date/tab changes,
  cleared with `Escape`, returns focus sensibly when the filtered row vanishes).
- **Only completed overruns** filter; the day summary still covers the day.
- Row states: no record, positive variance, negative variance, zero variance,
  untracked; past-day recorded metrics (the fixture's prior 12-minute CLOCK).
- Empty states: missing note, missing markers, no list items, invalid markers,
  ambiguous block ID — each names the next step.
- **Insert into today's Daily Note** / **Copy sample task** shortcuts.

## How to get to it (user POV)

Ribbon **Execution** → tab **Review**. Only exists with Execution Layer on.

## Driving it — browser lane (fast, primary)

The Review surface renders from the same production modules in a standalone
Chromium page, with no Obsidian and no vault writes:

```bash
PLAYWRIGHT_MODULE=$(node -p "require.resolve('playwright')") \
mise exec node@24.20.0 -- node tests/ui/review/run.mjs \
  --report .codex/runtime/verify/<run>/review-browser/report.json
```

It builds the harness with the repo's esbuild, walks 13 scenarios, asserts 109
`review.*` ids, and writes `report.json`, `screenshots/` (11 PNGs) and the
`limitations` list. Exit code is nonzero on any failed assertion. This lane does
not run under `npm test` (there is no `tests/ui/review/*.test.ts`), so call it
explicitly.

What the ids prove, by area: rendering (`review.all-five-row-states`,
`review.seven-fixture-rows`), variance math (`review.positive-variance`,
`review.negative-variance`, `review.zero-variance`,
`review.untracked-metrics-use-dash`), summary (`review.summary-counts`,
`review.summary-compared-only`), search/filter focus
(`review.search-keeps-input-focus`,
`review.search-escape-keeps-overrun-filter-and-focus`,
`review.search-removed-row-recovers-focus`,
`review.filter-keyboard-restores-all-and-focus`), pending/recovery states
(`review.focused-owner-disables-clock-in`, `review.pending-complete-focuses-date`,
`review.invalidated-list-focuses-refresh`), and keyboard flow
(`review.completed-flow-keeps-visible-focus`).

## Driving it — real host lane

```bash
.claude/skills/verify/scripts/host-lane.sh review    # ~5 min, includes a real elapsed minute
```

This is the same surface inside a real isolated Obsidian, with vault writes:

- `review-read-only-preserves-all-markdown`, `review-writes-only-today` — past
  and future navigation never writes; only today is writable.
- `review-date-button-keeps-keyboard-focus`, `review-date-button-visible-focus`,
  `review-escape-restores-trigger` — the keyboard contract inside the host.
- `review-past-recorded-metrics` — the prior day's 12-minute CLOCK is rendered.
- `review-clock-in-persists-one-record`, `review-clock-in-renders-live`,
  `review-live-first-whole-minute`, `review-live-used-real-elapsed-minute` —
  the CLOCK really advances (rounded `Actual` appears only at the whole minute).
- `review-complete-renders-compared`, `review-complete-closes-same-record`,
  `review-complete-preserves-other-bytes` — completion compares plan vs actual
  and leaves the rest of the note untouched.
- `review-reload-preserves-completed-task`, `review-reload-preserves-completed-source`,
  `review-reload-resets-selection-to-today` — reload restores the write and
  resets only the in-memory date selection.

## Gotchas

- The host lane needs a real minute of wall clock. Do not replace it with a fake
  timer: the point is that the host saves a real elapsed minute.
- `--review` cannot be combined with `--planner-tooltip-only`, and the runner
  deadline grows to 300 s.
- The browser lane's own `limitations` field is the honest scope: Chromium DOM
  and adapter evidence with deterministic snapshots — not native Electron,
  VoiceOver, or a written vault. Use both lanes when the change touches time
  math or persistence.
- Host results are written before the separate active-CLOCK reload scenario, so
  a later failure cannot erase completed Review checks — read `report.json`
  before assuming nothing was verified.
