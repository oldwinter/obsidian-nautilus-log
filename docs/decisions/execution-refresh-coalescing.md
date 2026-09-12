# Execution refresh coalescing

## Decision

`ExecutionApplication` owns one in-flight refresh and one dirty follow-up. A
source-change event during a scan sets `#refreshAgain`. The first scan may retry
once in the same refresh operation. If the final scan still observes the dirty
flag, `refresh()` clears the current promise and schedules one microtask to start
the follow-up scan.

The follow-up starts only after the current promise is released. It checks the
stopped state and the generation captured when it was queued before entering the
scan. `suspend()` and `stop()` clear the dirty flag and advance the refresh
generation, so a queued microtask does not start a scan while the application is
suspended.

## Why the handoff belongs in `refresh()`

`#runRefresh()` awaits the confirmed publication path. That path can read the
current task owner after the scan completes. A source-change event can arrive in
that window, after the bounded two-attempt loop has already decided to return.
Scheduling the handoff in `refresh()` closes that window without making the scan
loop unbounded.

The returned refresh promise represents the scan that was already in flight. The
queued follow-up is an asynchronous convergence step. Subscribers receive the
follow-up snapshot when it becomes available.

## Invariants

- At most one `#refreshPromise` exists at a time.
- A refresh performs at most one inline retry for a source-change race.
- A dirty final scan schedules at most one follow-up for that refresh promise.
- A stopped or suspended application does not start a queued follow-up.
- A queued follow-up never starts after its generation has been invalidated.
- A follow-up remains read-only until an explicit execution intent reaches the
  queue-head write checks.

## Verification

`tests/ui/execution/application.test.ts` exercises a source change during the
final coalesced scan. One call to `application.refresh()` produces the extra
read-only scan and settles at `ready`; the test fails when the dirty handoff is
removed.

The focused execution runner is:

```sh
node tests/ui/execution/run.mjs
```

The complete local gate is:

```sh
npm run verify
```
