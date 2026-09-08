# Pure performance measurements

Run the scheduler and history index against deterministic synthetic data with
Node 24.20.0. The tool retains raw samples and returns a nonzero exit when an
assertion or budget fails.

```sh
node tests/performance/run.mjs \
  --source-root /absolute/path/to/source-checkout \
  --output /absolute/path/to/new-evidence-directory
```

The output parent must exist. The output directory must be new and outside both
the runner checkout and the source checkout. `--source-root` defaults to the
runner checkout. It must resolve the repository's pinned `esbuild` dependency. Set `NODE_PATH`
to an existing dependency directory when a clean source checkout has no
`node_modules`. The runner rejects a different esbuild version.
The tool writes no files into the source checkout and does not require its
current changes to be committed.

An optional `--candidate-sha` accepts exactly 40 lowercase hexadecimal characters.
It is an operator label. The report separately records the source checkout's
actual HEAD and dirty status. It does not verify a remote, freeze a candidate,
or claim that the label identifies the executed source.

The tool bundles the selected production modules into `executed-source.mjs` and
runs that saved bundle. Each source file is hashed from the bytes supplied to
esbuild. The report includes that bundle's SHA-256 and the runner/fixture hashes.
`main.js`, `manifest.json`, and `styles.css` are hashed separately when present.
Those assets are observed only. This tool does not run the plugin package or
establish that the package contains the same source.

| Measurement | Fixture | Samples | Budgets checked |
| --- | --- | --- | --- |
| Pure scheduler reference | 250 mixed Plan Items | 10 warm-ups, 100 measured | p95 at most 10 ms, measured maximum at most 100 ms |
| Pure scheduler boundary | 1,000 mixed Plan Items | 10 warm-ups, 100 measured | p95 at most 50 ms, measured maximum at most 100 ms |
| First history index reference CLOCK count | 5,000 recognized CLOCK records, 1,000 tasks | 5 warm-ups, 30 measured fresh indexes | p95 at most 1,500 ms, measured maximum at most 10,000 ms |
| First history index boundary CLOCK count | 25,000 recognized CLOCK records, 4,000 tasks | 5 warm-ups, 30 measured fresh indexes | p95 at most 5,000 ms, measured maximum at most 10,000 ms |

Both history fixtures use five Daily Notes and one ordinary note. They include
open and completed tasks, fixed events, nested descriptions, a long label,
cross-midnight sessions, malformed records, and one running CLOCK. These are
CLOCK-count scale fixtures. They do not simulate the entire 20,000-file, 2 GiB
vault boundary or every FX-01 through FX-16 scenario.

Every measured scheduler and history result must have one deterministic output
hash. Scheduler input bytes must remain unchanged. Every history sample checks
the full recognized CLOCK/task counts and zero retained subscriptions or reads
after disposal. The history access port has no write operation.

`report.json` retains p50, p95, maximum, every measured sample, and all history
warm-up samples. It also retains the observed scheduler slices and 1 ms timer
gaps through the whole history rebuild, including its identity-index pass. A
scheduler slice ends when the production `HistoryIndexScheduler.yield()` is
called. Its duration excludes the awaited timer. A timer gap records the delay
between event-loop observations. Both maxima are checked against 50 ms. The three longest over-budget scheduler slices retain stacks per sample.
Stack capture happens only when a failed slice enters that retained set and
may add instrumentation overhead to the corresponding timer gap.

Add `--diagnostics` to record main-thread and whole-process CPU deltas for every
history scheduler slice or timer gap exceeding 50 ms. Each diagnostic has the
index of the unchanged raw duration array, its sample-relative start and end
duration, and indexes of overlapping GC entries delivered by Node's
`PerformanceObserver`. The three longest scheduler stacks retain those indexes.
All recorded CPU counters use milliseconds; GC entries retain their numeric
kind and flags. The observer is drained on the next event-loop turn after the
measured rebuild, then disconnected even if the run fails.

A large wall-time interval with little main-thread CPU shows that the interval
was not spent mostly executing on that thread. Wall minus thread CPU includes
waiting and scheduling, and cannot isolate OS preemption. Process CPU includes
other threads and can exceed wall time. GC overlap alone does not establish that
GC caused the delay; its duration is never subtracted from the budget. A yield
stack identifies the interval's end, not a CPU sample inside a parser. The CPU
counters and observer add measurement overhead, so diagnostics are opt-in and
the report records whether they were enabled. Budgets and sample counts remain
the same; failed samples are retained.

History cancellation runs with an actual timer and `AbortController`, after
rebuild starts. The report records how long the abort timer waited and how long
settlement took after abort. The result must be unavailable with reason
`cancelled`, publish no partial/current snapshot, and retain no source
subscriptions or later reads. Cancellation latency is recorded without inventing
a separate numerical acceptance limit.

A failed run retains `report.json` and its available artifacts. Budget failures
do not suppress later measurements. A runner exception retains completed work
and the error. An invalid command or pre-existing output directory is rejected
before the run starts. No retries, baseline replacement, or automatic threshold
adjustment occur.

These results contribute to ENV-PURE review. They do not qualify its full pinned
Linux CI profile when run on macOS. In-memory Node timing does not establish
Obsidian activation, native disk access, paint, interactive views, confirmed
writes, hidden CPU, or heap budgets. Other processes and native-host jobs remain
uncontrolled, so record background load and repeat final qualification while
they are idle. A diagnostic baseline run is not an accepted regression baseline.
The report leaves the 20% regression check unavailable until a separately
reviewed exact-commit baseline exists.

The production limits and sample counts come from
[the compatibility measurement protocol](../docs/decisions/desktop-compatibility-and-performance-envelope.md#measurement-protocol).
The fixtures extend the same supported-count behavior covered by the existing
scheduler and history-index test suites. They add retained measurements rather
than another product implementation.
