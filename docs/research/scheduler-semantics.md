# Nautilus Log v1.0.2 scheduler and parser semantics

## Research question

What exact deterministic rules turn v1.0.2 Daily Note inputs into Fixed Events,
Flexible Tasks, Planned Slots, and Overflow?

This document is an implementation contract for the Obsidian port. The functional
baseline is upstream `v1.0.2` at commit
[`973a041aa2f59f3b05bf31db8187efbfea07017a`](https://github.com/404KSG/roam-nautilus-log/tree/973a041aa2f59f3b05bf31db8187efbfea07017a).
Unless a section is explicitly labelled **main drift**, every source and test link
below is pinned to that commit.

## Executive answer

The v1.0.2 planner is a stable, source-order, non-preemptive greedy scheduler:

1. Parse each non-empty direct child of the Nautilus component. The first valid
   time-range token makes the row a Fixed Event; otherwise the chart renderer
   makes it a Flexible Task.
2. Clamp unfinished Fixed Events to the interval from the planning cursor through
   the configured day end, sort them, and merge overlaps or touching ranges.
3. Walk unfinished Flexible Tasks once in source order. Place each complete task
   at the current cursor if it fits before the next merged Fixed Event; otherwise
   advance to the end of that Fixed Event and try the next gap. Never split,
   reorder, or optimize tasks.
4. A task that reaches day end without fitting becomes Overflow. The cursor is not
   reset after failure, so every later positive-duration task also overflows.

The pure parser, normalization, scheduling, and capacity code is portable. Direct
child discovery, Roam block ordering/reference expansion, DONE/progress mutations,
Daily Note identity, and reactive refresh are Roam-specific adapters. The renderer
and optional Execution Plan call the same pure scheduler, but their input adapters
have two observable differences: eligibility and progress rounding.

Primary evidence: the pure core
[`src/log-core.js`](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/log-core.js#L1-L127),
the renderer bridge
[`src/component.cljs`](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/component.cljs#L636-L736),
the Execution Plan projection
[`src/timing-core.js`](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/timing-core.js#L192-L276),
and the core tests
[`test/log-core.test.js`](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/test/log-core.test.js#L35-L72).

## Time and interval model

- All parser-produced times are integer wall-clock minutes after local midnight:
  `09:05 = 545`; the configured end `24:00 = 1440`. The renderer samples local
  time as `hour * 60 + minute`, ignoring seconds
  ([renderer](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/component.cljs#L326-L328)).
- Scheduling intervals are half-open `[start, end)`. A task can end exactly when
  an event starts, and another task can start exactly when an event ends. The
  overlap helper uses the same strict-boundary convention
  ([source](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/log-core.js#L443-L466),
  [test](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/test/log-core.test.js#L362-L385)).
- Parsed rows use integer minutes. The public pure core accepts any finite numeric
  `start`, `end`, and `duration`; it does not round interval boundaries. It rounds
  remaining task duration as described below
  ([source](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/log-core.js#L547-L555)).

## Input selection and classification

There are two upstream adapters. A parity implementation must preserve the
surface-specific behavior or deliberately resolve the discrepancy in a later
decision ticket.

| Concern | Spiral renderer (primary visual plan) | Optional Execution Plan | Evidence |
| --- | --- | --- | --- |
| Plan root | The mounted Nautilus component block | First Nautilus component in Daily Note depth-first tree order | [renderer mount](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/component.cljs#L1686-L1724), [selection](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/timing-core.js#L197-L224), [test](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/test/timing-core.test.js#L18-L28) |
| Eligible rows | Non-empty direct children, sorted by `:block/order` | Direct children only, sorted by numeric `order`, then UID for ties | [renderer](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/component.cljs#L1723-L1737), [execution](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/timing-core.js#L192-L210) |
| Fixed Event | Any row whose first valid time-range token parses, regardless of TODO/DONE marker | Any direct child with a valid time range | [renderer classification](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/component.cljs#L636-L686), [execution projection](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/timing-core.js#L256-L276) |
| Flexible Task | Any remaining non-empty-description row. A TODO marker is not required by code, despite the v1.0.2 guide saying it is. | Must contain `{{[[TODO]]}}`, `{{TODO}}`, or a DONE equivalent; Plan retains TODO only and excludes time-range rows. | [renderer](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/component.cljs#L663-L686), [execution](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/timing-core.js#L11-L13), [guide claim](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/docs/guide.md#L17-L21) |
| Nested rows | Ignored | Ignored | [execution test](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/test/timing-core.test.js#L30-L43); renderer pulls only `:block/children` at the component root |
| Block references | Replaces each direct child's `((uid))` occurrence with the pulled referenced block string before parsing | Resolves direct-child references through cached Roam reads before projection | [renderer replacement](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/component.cljs#L118-L124), [execution helper](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/timing-core.js#L145-L151), [execution adapter](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/timing-roam.js#L185-L224) |
| Empty result | A row whose description is empty after cleaning is filtered out | A marker-only task receives `"(untitled)"` in the execution projection | [renderer filter](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/component.cljs#L1725-L1737), [execution title](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/timing-core.js#L153-L165) |

Fixed Events reserve time regardless of where they occur among task rows. The
renderer computes a `start-after` field from source order, but `scheduleTasks`
never reads that field; it reserves all Fixed Events before task placement
([unused field](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/component.cljs#L1315-L1330),
[scheduler input](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/component.cljs#L690-L710)).

## Parser contract

### Duration token

Equivalent grammar (ASCII case-insensitive):

```ebnf
DIGITS       = digit, { digit };
MINUTE_UNIT  = "m" | "min";
DURATION     = DIGITS, "h", [ DIGITS, MINUTE_UNIT ]
             | DIGITS, MINUTE_UNIT;
TOKEN        = (^ | whitespace), DURATION, (whitespace | $);
```

Rules:

1. Search left-to-right and consume only the first matching token. The token
   must be whitespace-delimited or at a string boundary; punctuation is not a
   boundary. Matching is case-insensitive
   ([regex and parser](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/log-core.js#L10-L55)).
2. `hours * 60 + minutes` is returned without restricting the minute suffix to
   `0..59`; for example `1h90m` means 150 minutes. `0m` is valid and later causes
   the task to be omitted from both Planned Slots and Overflow.
3. Remove the exact first token, collapse every whitespace run to one space, and
   trim. A second duration-looking token remains in the description
   ([cleaner](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/log-core.js#L33-L55)).
4. If no token matches, return the fallback rounded to the nearest integer and
   clamped to at least zero. Non-numeric/empty fallback becomes zero. The renderer
   settings resolver accepts any integer from 5 through 60 and otherwise falls
   back to 15; the settings panel offers `5,10,15,20,25,30,45,60`
   ([resolver](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/log-core.js#L140-L172),
   [settings](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/index.js#L421-L425),
   [tests](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/test/log-core.test.js#L35-L55)).

| Text | Minutes | Token | Cleaned text |
| --- | ---: | --- | --- |
| `Write 30m` | 30 | `30m` | `Write` |
| `Write 30min` | 30 | `30min` | `Write` |
| `Write 1h` | 60 | `1h` | `Write` |
| `Write 1h30m` / `Write 1H30MIN` | 90 | matching suffix | `Write` |
| `Write 1h 30m` | 60 | `1h` only | `Write 30m` |
| `Write 30m then 45m` | 30 | `30m` only | `Write then 45m` |
| `Write (30m)` or `Write 30` | fallback | none | unchanged |
| `Write 0m` | 0 | `0m` | `Write` |

### Time-range token

Equivalent grammar (case-insensitive, with whitespace allowed around parts):

```ebnf
CLOCK       = 1*2DIGIT, [ ":", 1*2DIGIT ], [ "am" | "pm" ];
SEPARATOR   = "-" | "–" | "až" | "to";
TIME_RANGE  = CLOCK, SEPARATOR, CLOCK;
TOKEN       = (^ | whitespace), TIME_RANGE, (whitespace | $);
```

Parsing and normalization are exact:

1. Search left-to-right for the first whitespace-delimited range and split it on
   the separator. A clock without minutes uses `:00`. Minutes must be `0..59`.
   In 24-hour form hours must be `0..23`; with AM/PM they must be `1..12`
   ([regex and clock parser](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/log-core.js#L10-L13),
   [validation](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/log-core.js#L58-L81)).
2. Parse the end first. If the end has an explicit AM/PM and the start does not,
   inherit the end's period backward to the start (`9-10pm` is 21:00-22:00).
   There is no forward inheritance (`9pm-10` treats the end as 10:00 and becomes
   an overnight warning clipped at midnight).
3. If `end > start`, preserve both. If equal, preserve the zero-length interval
   and emit `sameTime`. If `end < start`, return `end = 1440`; emit `overnight`
   except when the written end is exactly 00:00, which also maps to 1440 but has
   no warning
   ([normalization](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/log-core.js#L73-L93),
   [tests](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/test/log-core.test.js#L57-L72)).
4. Remove the matched token using the same whitespace collapse/trim rule as a
   duration. If validation fails, return `null` and leave the row for the caller;
   in the spiral renderer that row is therefore classified as a Flexible Task.
5. A parsed `sameTime` row remains a Fixed Event with a warning, but the scheduler
   ignores it because `end <= start`. It does not turn back into a task
   ([renderer classification](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/component.cljs#L636-L686),
   [interval validation](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/log-core.js#L487-L495)).

| Text | Result `(start,end,warning)` | Important consequence |
| --- | --- | --- |
| `9-10` / `9 to 10` / `9–10` / `9 až 10` | `(540,600,none)` | All four separators work. |
| `9-10pm` | `(1260,1320,none)` | End period inherits backward. |
| `12-1am` | `(0,60,none)` | `12am` normalizes to minute 0. |
| `11pm-1am` | `(1380,1440,overnight)` | Written next-day 01:00 is discarded. |
| `23:00-00:30` | `(1380,1440,overnight)` | Also truncated to midnight, not 90 minutes. |
| `23:00-00:00` / `23-0` | `(1380,1440,none)` | Midnight is a special warning-free case. |
| `09:00-09:00` | `(540,540,sameTime)` | Warning-only Fixed Event; reserves zero. |
| `Meet 9:5-10:07` | `(545,607,none)` | One-digit minutes are valid. |
| `24:00-01:00`, `09:60-10:00`, `x09:00-10:00` | `null` | Invalid; visual renderer treats row as a task. |

`24:00` is valid only as a configured chart end, not as a written CLOCK token.

### Parse order, completion, and progress

For each renderer row the order is: replace Markdown links with their labels;
detect custom color; parse time range; parse duration; parse progress; parse
completion time; parse DONE; clean display markup
([pipeline](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/component.cljs#L607-L686)).
Consequences:

- A duration token inside a Markdown URL is removed with the URL before duration
  parsing; a token in the link label remains eligible.
- The first duration in a resolved reference string can win over a later local
  override because v1.0.2 performs textual reference replacement before taking
  the first token. This is Roam-coupled behavior, not a scheduler rule.
- Renderer progress syntax is a first ` dNNN%` occurrence with 1-3 digits. Values
  above 100 clamp to 100. The renderer calculates `int((100-progress)/100 *
  duration)`, i.e. truncation toward zero, then removes `progress` before calling
  the scheduler
  ([parser and reduction](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/component.cljs#L563-L571),
  [scheduler bridge](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/component.cljs#L669-L703)).
- Execution Plan accepts `dNNN%` at the start or whitespace-delimited, keeps raw
  planned duration plus progress, and lets the scheduler use `Math.round`. Thus
  `10m d33%` schedules as 6 minutes in the spiral but 7 minutes in Execution Plan.
  This is an observed v1.0.2 discrepancy
  ([execution parser](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/timing-core.js#L168-L175),
  [runtime bridge](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/timing-runtime.js#L26-L54)). The
  built-extension test confirms that Execution capacity applies progress exactly
  once
  ([runtime test](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/test/timing-runtime.test.js#L98-L139)).
- Renderer DONE recognition is the exact `{{[[DONE]]}}` token. A flexible DONE is
  excluded from pending scheduling. Fixed DONE events are excluded from future
  reservation but can remain in full-day totals/history
  ([DONE parser](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/component.cljs#L573-L592),
  [capacity bridge](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/component.cljs#L1773-L1784)).
- The completed-task anchor is the first case-sensitive `dH`, `dHH`, `dH:M`, or
  `dHH:MM` substring, with one or two digits in each present field. It has no
  token-boundary or clock-range validation: `d9:5` becomes minute 545 and `d99:99`
  becomes 6039. Progress is parsed and removed first, so ` d50%` is not mistaken
  for an anchor. This timestamp affects only completed historical slices, never
  pending placement
  ([anchor parser](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/component.cljs#L563-L582),
  [historical slice](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/log-core.js#L641-L684)).

## Day-bound settings and current-time cursor

The v1.0.2 settings contract is intentionally narrow:

- Start choices: `05:00, 06:00, 07:00, 08:00`; default `05:00`.
- End choices: `18:00..24:00` by whole hour; default `21:00`.
- Numeric strings are accepted. A value outside its respective list falls back
  independently. If the resulting start is not earlier than end, both reset to
  `05:00-21:00`
  ([normalizer](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/log-core.js#L96-L127),
  [settings UI](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/index.js#L397-L407),
  [tests](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/test/log-core.test.js#L612-L625)).

The scheduling cursor is `clamp(nowMinutes, startMinutes, endMinutes)`. Missing or
non-numeric `nowMinutes` means day start. Before start, tasks begin at start; at or
after end, every positive unfinished task overflows
([source](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/log-core.js#L542-L545)).

The renderer supplies different cursors by displayed Daily Note:

| Displayed note | Schedule from | Capacity from | Available slots |
| --- | ---: | ---: | --- |
| Today | clamped current minute | clamped current minute | yes |
| Past | day start | day end (zero actionable remaining capacity) | no |
| Future or unrecognized date | day start | day start | yes |
| Playback | clamped simulated minute | clamped simulated minute | yes, even for past |

The source and exact past/today assertions are in
[`timelineDayState`](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/log-core.js#L247-L291)
and its
[`tests`](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/test/log-core.test.js#L74-L116).
Fixed Events still render in their full clipped day positions; only flexible work
reflows from today's cursor
([renderer](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/component.cljs#L690-L736)).

## Exact scheduler contract

### Normalization

Given a valid day `[S,E)` and cursor `C`:

1. `C = finite(now) ? clamp(now,S,E) : S`.
2. Keep only Fixed Events with `meeting === true`, not truthy `done`, finite
   `start/end`, and `end > start`.
3. Clip every event to `[max(S,C),E)`, discard empty results, sort by start then
   end, and merge when `next.start <= previous.end`. Therefore overlaps and
   touching event ranges form one reservation and are counted once
   ([normalization and merge](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/log-core.js#L483-L563),
   [capacity test](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/test/log-core.test.js#L651-L698)).
4. For each task, return zero when absent, truthy `done`, non-finite duration, or
   duration `<= 0`. Otherwise clamp numeric progress to `0..100` (invalid means
   zero) and compute `round(duration * (1-progress/100))`
   ([source](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/log-core.js#L547-L555)).

### Placement algorithm

This pseudocode is line-for-line equivalent to
[`scheduleTasks`](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/log-core.js#L570-L639):

```text
if S or E is non-finite, or E <= S:
  return scheduled=[], overflow=shallow_copy(all input tasks), fixedMinutes=0

C = clamp finite now to [S,E], otherwise S
fixed = merged unfinished meeting intervals clipped to [C,E)
cursor = C

for task in input order:
  d = remainingDuration(task)
  if d == 0: continue                 # omitted, not overflow
  placed = false

  while cursor < E and not placed:
    reservation = first fixed interval whose end > cursor
    if no reservation:
      if cursor + d <= E:
        emit Planned Slot [cursor,cursor+d)
        cursor += d
        placed = true
      else:
        cursor = E
    else if reservation.start > cursor and cursor + d <= reservation.start:
      emit Planned Slot [cursor,cursor+d)
      cursor += d
      placed = true
    else:
      cursor = max(cursor,reservation.end)

  if not placed: emit task as Overflow
```

There is one shared cursor for the entire pass. Once an unplaceable task scans to
`E`, the algorithm does not revisit earlier gaps for later tasks. This follows
directly from lines 592-622 but has no dedicated upstream assertion; treat it as
**observed baseline behavior**, not as a claim about product intent.

### Outputs and ordering

- `scheduledTasks`: input task fields plus normalized `duration`, `start`, `end`,
  in task input order.
- `overflowTasks`: input task fields plus normalized `duration`, in input order.
- `fixedMinutes`: size of the merged future Fixed Event union.
- `intervals`: anonymous merged Fixed Event segments (`meeting:true,fixed:true`)
  plus Planned Slots, sorted by `start`. Original Fixed Event UIDs are not retained
  in these merged segments
  ([return shape](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/log-core.js#L625-L638)).
- The visual renderer does not use anonymous `intervals` as its event rows. It
  joins Planned Slots back to tasks by UID, retains original Fixed Events, clips
  them to the full configured day, then synthesizes free-time rows between all
  occupied rows
  ([renderer](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/component.cljs#L704-L736)).

## Capacity and Overflow semantics

For a valid day, let `C` be the effective cursor, `Ffuture` the merged unfinished
Fixed Event minutes in `[C,E)`, `Fall` the merged `allFixedEvents` minutes in
`[S,E)`, and `D` the sum of normalized remaining task durations:

```text
availableMinutes      = max(0, E - C - Ffuture)
demandMinutes         = D
overloadMinutes       = max(0, D - availableMinutes)
slackMinutes          = max(0, availableMinutes - D)
unplacedMinutes       = sum(remainingDuration(task) for task in overflowTasks)
fixedMinutes          = Ffuture
totalFixedMinutes     = Fall
totalAvailableMinutes = max(0, E - S - Fall)
```

These are implemented in
[`calculateCapacity`](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/log-core.js#L721-L779).
`overloadMinutes` is arithmetic excess demand; `unplacedMinutes` is the actual
greedy/atomic placement failure. They can differ:

- Demand 75 in 60 free minutes: overload 15, but the second 30-minute task is the
  actual unplaced amount
  ([test](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/test/log-core.test.js#L751-L772)).
- Demand 45 with two separate 30-minute gaps: overload 0 and slack 15, but
  unplaced 45 because the task is atomic
  ([test](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/test/log-core.test.js#L774-L794)).

The visible **Today won't fit / Unscheduled today** panel is driven by actual
`overflowTasks` and `unplacedMinutes`, not arithmetic overload alone
([renderer](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/component.cljs#L1603-L1616)).

## Boundary matrix

| Boundary | Exact result | Evidence |
| --- | --- | --- |
| `now < S` or missing | Cursor is `S`. | [`effectiveNow`](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/log-core.js#L542-L545) |
| `now == E` or `now > E` | Cursor is `E`; all positive unfinished tasks overflow. | [`scheduleTasks`](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/log-core.js#L583-L623) |
| Task ends exactly at event start/day end | Fits (`<=` checks). | [source](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/log-core.js#L598-L619), [normal test](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/test/log-core.test.js#L627-L649) |
| Event ends at cursor | Ignored by `fixedEnd > cursor`; the minute belongs to free time. | [source](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/log-core.js#L598-L619), [boundary test](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/test/log-core.test.js#L720-L733) |
| Event straddles cursor | Only `[cursor,event.end)` is reserved. | [source](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/log-core.js#L557-L563) |
| Event outside day | Clipped; empty clip discarded. | [source](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/log-core.js#L487-L495) |
| Overlapping/touching events | Merged and counted once. Conflict UI still treats touching as non-conflict. | [merge](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/log-core.js#L527-L539), [conflict rule](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/log-core.js#L443-L466) |
| DONE/zero/invalid-duration task in valid day | Silently omitted, not Overflow. | [`remainingDuration`](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/log-core.js#L547-L555) |
| Invalid day (`E <= S` or non-finite) | No normalization; every raw input task, including DONE/zero, is returned in Overflow. | [guard](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/log-core.js#L577-L581) |
| Same-time parsed event | Classified as Fixed Event and shown in the warning panel, but reserves zero and is omitted from the timeline. | [parser test](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/test/log-core.test.js#L57-L72), [visible clip](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/component.cljs#L712-L719), [warning panel](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/component.cljs#L1618-L1629) |
| Cross-midnight written event | Ends at 1440, never beyond. A nonzero next-day end emits warning. | [parser](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/log-core.js#L82-L93) |
| Task cannot fit one gap but fits a later gap | Advances across reservations and is placed later, intact. | [guide](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/docs/guide.md#L23-L33) |
| Task cannot fit any gap | Overflow; cursor reaches `E`, so later tasks also Overflow. | [source](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/log-core.js#L594-L623) |

## Executable-style examples

The examples below use the public CommonJS functions exactly as tested upstream.
Minutes are retained in output to make equality assertions direct.

### Normal gaps, exact boundaries, and Overflow

```js
scheduleTasks({
  startMinutes: 300, endMinutes: 600, nowMinutes: 300,
  tasks: [
    { uid: "a", duration: 120 },
    { uid: "b", duration: 90 },
    { uid: "c", duration: 60 },
  ],
  fixedEvents: [{ meeting: true, start: 420, end: 480 }],
})
// scheduled: a [300,420), b [480,570)
// overflow:  c (60)
// fixedMinutes: 60
```

This is the upstream asserted fixture
([test](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/test/log-core.test.js#L627-L649)).

```js
scheduleTasks({
  startMinutes: 300, endMinutes: 420, nowMinutes: 300,
  tasks: [{ uid: "a", duration: 60 }, { uid: "b", duration: 30 }],
  fixedEvents: [{ meeting: true, start: 360, end: 390 }],
})
// scheduled: a [300,360), b [390,420)
// overflow: []
```

### Current-time cutoff and event union

```js
scheduleTasks({ startMinutes: 300, endMinutes: 420, nowMinutes: 200,
  tasks: [{ uid: "a", duration: 30 }] })
// a [300,330) -- before-start now clamps upward

scheduleTasks({ startMinutes: 300, endMinutes: 420, nowMinutes: 500,
  tasks: [{ uid: "a", duration: 30 }] })
// scheduled: []; overflow: a -- after-end now clamps downward to 420
```

```js
scheduleTasks({
  startMinutes: 300, endMinutes: 600, nowMinutes: 330,
  tasks: [{ uid: "a", duration: 80 }],
  fixedEvents: [
    { meeting: true, start: 300, end: 360 },
    { meeting: true, start: 350, end: 420 },
    { meeting: true, start: 580, end: 700 },
  ],
})
// merged future reservations: [330,420), [580,600)
// scheduled: a [420,500); fixedMinutes: 110
```

### Atomic fragmentation and persistent cursor

```js
calculateCapacity({
  startMinutes: 300, endMinutes: 420, nowMinutes: 300,
  fixedEvents: [
    { meeting: true, start: 330, end: 360 },
    { meeting: true, start: 390, end: 420 },
  ],
  pendingTasks: [{ uid: "atomic", duration: 45 }],
})
// availableMinutes: 60, demandMinutes: 45, overloadMinutes: 0,
// slackMinutes: 15, unplacedMinutes: 45,
// scheduledTasks: [], overflowTasks: [atomic]
```

```js
scheduleTasks({
  startMinutes: 300, endMinutes: 420, nowMinutes: 300,
  fixedEvents: [
    { meeting: true, start: 330, end: 360 },
    { meeting: true, start: 390, end: 420 },
  ],
  tasks: [
    { uid: "too-big", duration: 45 },
    { uid: "could-fit", duration: 20 },
  ],
})
// scheduled: []
// overflow: too-big, could-fit
// The second task would fit [300,330), but the first failure left cursor at 420.
```

### Arithmetic overload versus actual unplaced duration

```js
calculateCapacity({
  startMinutes: 300, endMinutes: 360, nowMinutes: 300,
  pendingTasks: [{ uid: "a", duration: 45 }, { uid: "b", duration: 30 }],
})
// availableMinutes: 60, demandMinutes: 75, overloadMinutes: 15,
// slackMinutes: 0, unplacedMinutes: 30,
// scheduled: a [300,345); overflow: b
```

The 15-minute arithmetic excess and the 30-minute atomic task that actually fails
are intentionally separate values
([test](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/test/log-core.test.js#L751-L772)).

### Invalid/ignored inputs and progress

```js
scheduleTasks({
  startMinutes: 300, endMinutes: 420, nowMinutes: 300,
  tasks: [
    { uid: "done", duration: 30, done: true },
    { uid: "zero", duration: 0 },
    { uid: "bad", duration: "x" },
    { uid: "partial", duration: 10, progress: 33 },
  ],
  fixedEvents: [
    { meeting: true, done: true, start: 320, end: 350 },
    { meeting: false, start: 350, end: 370 },
    { meeting: true, start: 390, end: 450 },
  ],
})
// scheduled: partial [300,307) -- round(10 * 0.67) = 7
// overflow: []
// only fixed reservation: [390,420), fixedMinutes: 30
```

```js
scheduleTasks({
  startMinutes: 420, endMinutes: 300, nowMinutes: 300,
  tasks: [{ uid: "done", duration: 0, done: true }, { uid: "a", duration: 30 }],
})
// invalid day guard: scheduled: []; overflow: [done, a]
```

## Portable logic versus Roam coupling

| Portable as a pure domain module | Must be adapted for Obsidian |
| --- | --- |
| Duration and time-range token parsing | Finding the Daily Note and planner root |
| Whole-hour setting validation for the v1.0.2 baseline | Reading only direct Markdown list items while preserving source order |
| Current-time clamping and day-relation policy | Stable identity to replace Roam block UIDs |
| Fixed interval validation, clipping, sorting, and union | Roam `((block refs))` expansion and its first-token precedence |
| Remaining-duration normalization | TODO/DONE and `dNN%` syntax mapping to Obsidian Markdown |
| Source-order atomic greedy placement | Reactive refresh after editor/vault changes |
| Capacity, overload, slack, and fragmentation calculations | Roam mutations that remove progress from DONE blocks |

The core explicitly describes itself as dependency-free and shared with the
renderer
([module header](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/log-core.js#L1-L7));
the contract test verifies that the ClojureScript surface delegates parsing,
scheduling, and capacity to it
([test](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/test/log-contract.test.js#L72-L100)).

## Main drift: do not import into the v1.0.2 baseline silently

Current upstream `main` at
[`08892f948c63e4cacd3fc1cc100a600dd38c21f8`](https://github.com/404KSG/roam-nautilus-log/tree/08892f948c63e4cacd3fc1cc100a600dd38c21f8)
contains material scheduler/input changes after v1.0.2:

- Start choices expand to `00:00..23:00`; end choices expand to `01:00..24:00`.
  An end at or before start becomes a next-day end (`+1440`) instead of failing
  back to `05:00-21:00`
  ([main source](https://github.com/404KSG/roam-nautilus-log/blob/08892f948c63e4cacd3fc1cc100a600dd38c21f8/src/log-core.js#L10-L11),
  [normalizer](https://github.com/404KSG/roam-nautilus-log/blob/08892f948c63e4cacd3fc1cc100a600dd38c21f8/src/log-core.js#L149-L165)).
- Cross-midnight written events preserve their explicit next-day end and align to
  overnight windows; `overnight` is no longer emitted merely because end clock
  time is earlier
  ([main parser](https://github.com/404KSG/roam-nautilus-log/blob/08892f948c63e4cacd3fc1cc100a600dd38c21f8/src/log-core.js#L73-L141)).
- Main documentation says a direct child without a range is a Flexible Task,
  formalizes reference ownership/overrides, and adds true overnight chart windows
  ([main guide](https://github.com/404KSG/roam-nautilus-log/blob/08892f948c63e4cacd3fc1cc100a600dd38c21f8/docs/guide.md#L15-L35),
  [settings](https://github.com/404KSG/roam-nautilus-log/blob/08892f948c63e4cacd3fc1cc100a600dd38c21f8/docs/guide.md#L154-L163)).

Therefore the frozen v1.0.2 parity answer is: **there is no true overnight
continuation**. The latest possible boundary is minute 1440, and a written
`23:00-01:00` occupies only `23:00-24:00` with a warning. Supporting a
`21:00-02:00` planning window would adopt post-baseline main behavior and requires
an explicit map decision.

## Inferences, discrepancies, and unresolved decisions

Observed facts are separated from product intent here:

1. **Observed discrepancy: task marker eligibility.** The v1.0.2 guide says an
   unfinished TODO is a Flexible Task, but renderer code accepts any non-range
   child with a non-empty description. Execution Plan still requires TODO. A
   strict observable clone must test both surfaces; an Obsidian-native unified
   grammar is a product decision.
2. **Observed discrepancy: progress rounding.** Spiral truncates after reducing
   progress; Execution Plan rounds in the pure core. No upstream test covers the
   disagreement. Preserve it only if pixel/workflow parity outweighs cross-surface
   consistency.
3. **Observed, not explicitly asserted: failure locks later tasks out.** The
   shared cursor reaches day end when an atomic task cannot fit anywhere. Later
   short tasks are not backfilled into earlier gaps. This is deterministic source
   behavior, but documentation only promises stable order and atomic tasks; it
   does not state whether this cascading Overflow was intentional.
4. **Known baseline boundary: no next-day schedule.** Main has deliberately added
   it. The map must choose frozen v1.0.2 behavior or approve that specific drift;
   it cannot claim both.
5. **Obsidian mapping still unresolved here.** This research establishes source
   semantics but does not choose Markdown eligibility, stable item identity, or
   reference ownership. Those belong to the data-contract and architecture
   decisions blocked on this finding.

## Verification record

- Inspected all scheduler/parser call sites in `src/log-core.js`,
  `src/component.cljs`, `src/timing-core.js`, and `src/timing-runtime.js` at the
  fixed v1.0.2 SHA.
- Ran `npm test` at that SHA. Webpack built the extension and all 113 upstream
  tests passed with 0 failures, including renderer delegation, parser/core,
  settings scaffolding, Execution Plan progress, reference projection, and runtime
  scheduling integration.
- Ran direct Node probes against the exported v1.0.2 functions for parser
  boundaries, cursor clamping, exact fits, overlap merging, atomic fragmentation,
  invalid inputs, progress rounding, and invalid day ranges. The executable-style
  examples above reproduce those outputs.
- Diffed the relevant source, docs, and tests between v1.0.2 and fixed main SHA
  `08892f9`; main has material overnight/input drift and is not used as functional
  evidence above.
