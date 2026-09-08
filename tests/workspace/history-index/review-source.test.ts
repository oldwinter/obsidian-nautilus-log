import assert from "node:assert/strict";
import test from "node:test";
import { ReviewCoordinator } from "../../../src/runtime/review/coordinator";
import { createZonedLocalTimeResolver } from "../../../src/runtime/system-clock";
import { HistoryIndex } from "../../../src/workspace/history-index";
import { WorkspaceIndex } from "../../../src/workspace/identity-index";
import { createSourceVersion } from "../../../src/workspace/source-version";
import { MemoryTextAccess } from "../../../src/workspace/text-access";

const OWNER = "nl-11111111-1111-4111-8111-111111111111";
const source = `<!-- nautilus-log:plan/v1 -->\n- [ ] Anonymous 15m\n- [ ] Identified 30m ^${OWNER}\n<!-- /nautilus-log:plan -->\n`;
const path = "Daily/Team/2026-08-29.md";
const request = {
  logicalDate: { year: 2026, month: 8, day: 29 },
  configuration: { folder: "Daily/Team", format: "YYYY-MM-DD" },
  day: {
    date: { year: 2026, month: 8, day: 29 },
    timeZone: "UTC",
    startEpochMilliseconds: Date.UTC(2026, 7, 29),
    endEpochMilliseconds: Date.UTC(2026, 7, 30),
  },
  nowEpochMilliseconds: Date.UTC(2026, 7, 29, 12),
  resolveMinuteEpoch: (_date: unknown, minute: number) => Date.UTC(2026, 7, 29) + minute * 60_000,
};

test("Review carries exact source authority for identified and anonymous actions", async () => {
  const access = new MemoryTextAccess({ [path]: source });
  const coordinator = new ReviewCoordinator(new HistoryIndex(access));
  try {
    const snapshot = await coordinator.refresh(request);
    assert.equal(snapshot.state, "ready");
    if (snapshot.state !== "ready") throw new Error("Review did not become ready");
    const version = await createSourceVersion(path, source);
    assert.deepEqual(snapshot.displayedDate, request.logicalDate);
    assert.equal(snapshot.projectedAtEpochMilliseconds, request.nowEpochMilliseconds);
    assert.deepEqual(snapshot.projection.rows.map((row) => row.task.target), [
      { path, ownerId: null, sourceOrder: 0, sourceFingerprint: version.contentDigest },
      { path, ownerId: OWNER, sourceOrder: 1, sourceFingerprint: version.contentDigest },
    ]);
    assert.ok(Object.isFrozen(snapshot.projection.rows[0]?.task.target));
    const previousDigest = snapshot.projection.rows[0]?.task.target?.sourceFingerprint;
    access.modify(path, source.replace("Anonymous", "Changed"));
    assert.equal(coordinator.snapshot.state, "unavailable");
    const refreshed = await coordinator.refresh(request);
    if (refreshed.state !== "ready") throw new Error("Review did not refresh");
    assert.notEqual(refreshed.projection.rows[0]?.task.target?.sourceFingerprint, previousDigest);
  } finally {
    coordinator.dispose();
  }
});

test("Review projects offset-free legacy CLOCK history with explicit timezone semantics", async () => {
  const legacySource = `<!-- nautilus-log:plan/v1 -->
- [ ] Legacy 30m ^${OWNER}
  - LOGBOOK::
    - CLOCK: [2026-08-29 Sat 08:10] -- [2026-08-29 Sat 08:40] => 0:30
<!-- /nautilus-log:plan -->
`;
  const localTime = createZonedLocalTimeResolver("Asia/Shanghai");
  const coordinator = new ReviewCoordinator(new HistoryIndex(new MemoryTextAccess({ [path]: legacySource })));
  try {
    const snapshot = await coordinator.refresh({
      ...request,
      day: {
        date: request.logicalDate,
        timeZone: localTime.timeZone,
        startEpochMilliseconds: Date.UTC(2026, 7, 28, 16),
        endEpochMilliseconds: Date.UTC(2026, 7, 29, 16),
      },
      nowEpochMilliseconds: Date.UTC(2026, 7, 29, 4),
      clockParsing: { resolveLocalTime: localTime.resolve },
      clockParsingKey: `iana:${localTime.timeZone}`,
    });
    if (snapshot.state !== "ready") throw new Error("Review did not become ready");
    assert.equal(snapshot.projection.rows[0]?.actualMinutes, 30);
    assert.equal(snapshot.projection.rows[0]?.malformedClockCount, 0);
    assert.equal(snapshot.projection.rows[0]?.state, "paused");
  } finally {
    coordinator.dispose();
  }
});

test("host workspace authority recognizes legacy running CLOCKs and reparses after a timezone change", async () => {
  const legacyRunningSource = `<!-- nautilus-log:plan/v1 -->
- [ ] Legacy running 30m ^${OWNER}
  - LOGBOOK::
    - CLOCK: [2026-08-29 Sat 08:10]
<!-- /nautilus-log:plan -->
`;
  const access = new MemoryTextAccess({ [path]: legacyRunningSource });
  const shanghai = createZonedLocalTimeResolver("Asia/Shanghai");
  const index = new WorkspaceIndex(access, {
    clockParsing: { resolveLocalTime: shanghai.resolve },
  });
  try {
    const initial = await index.rebuild();
    assert.equal(initial.complete, true);
    assert.equal(initial.potentialRunning.length, 0);
    assert.equal(initial.running.length, 1);
    assert.equal(
      initial.running[0]?.parsed.kind === "record"
        ? initial.running[0].parsed.record.startEpochMs : undefined,
      Date.UTC(2026, 7, 29, 0, 10),
    );

    const newYork = createZonedLocalTimeResolver("America/New_York");
    index.setClockParsing({ resolveLocalTime: newYork.resolve });
    assert.equal(index.dirty, true);
    const reparsed = await index.rebuild();
    assert.equal(reparsed.potentialRunning.length, 0);
    assert.equal(
      reparsed.running[0]?.parsed.kind === "record"
        ? reparsed.running[0].parsed.record.startEpochMs : undefined,
      Date.UTC(2026, 7, 29, 12, 10),
    );
  } finally {
    index.dispose();
  }
});

test("Review never gives duplicate identities an anonymous mutation fallback", async () => {
  const coordinator = new ReviewCoordinator(new HistoryIndex(new MemoryTextAccess({
    [path]: source,
    "ordinary.md": `Duplicate ^${OWNER}\n`,
  })));
  try {
    const snapshot = await coordinator.refresh(request);
    if (snapshot.state !== "ready") throw new Error("Review did not become ready");
    assert.equal(snapshot.projection.rows[1]?.task.ownerId, undefined);
    assert.equal(snapshot.projection.rows[1]?.task.target, undefined);
    assert.ok(snapshot.projection.rows[0]?.task.target, "genuinely anonymous task retains its digest authority");
  } finally {
    coordinator.dispose();
  }
});

test("Review distinguishes missing notes, missing plans, invalid markers, and a valid empty plan", async () => {
  for (const [contents, availability] of [
    [undefined, "missing-note"],
    ["# Ordinary note\n", "missing-plan"],
    ["<!-- nautilus-log:plan/v1 -->\n- [ ] Unclosed\n", "invalid-plan"],
    ["<!-- nautilus-log:plan/v1 -->\n<!-- /nautilus-log:plan -->\n", "ready"],
  ] as const) {
    const coordinator = new ReviewCoordinator(new HistoryIndex(new MemoryTextAccess(
      contents === undefined ? {} : { [path]: contents },
    )));
    try {
      const snapshot = await coordinator.refresh(request);
      if (snapshot.state !== "ready") throw new Error("Review did not become ready");
      assert.equal(snapshot.availability, availability);
      assert.equal(snapshot.projection.rows.length, 0);
    } finally {
      coordinator.dispose();
    }
  }
});

test("colliding IDs in the same note retain separate Review rows with no write authority", async () => {
  const coordinator = new ReviewCoordinator(new HistoryIndex(new MemoryTextAccess({
    [path]: source.replace("Anonymous 15m", `Anonymous 15m ^${OWNER}`),
  })));
  try {
    const snapshot = await coordinator.refresh(request);
    if (snapshot.state !== "ready") throw new Error("Review did not become ready");
    assert.equal(snapshot.projection.rows.length, 2);
    assert.equal(new Set(snapshot.projection.rows.map((row) => row.task.key)).size, 2);
    assert.ok(snapshot.projection.rows.every((row) => row.task.target === undefined));
  } finally {
    coordinator.dispose();
  }
});

class CountingAccess extends MemoryTextAccess {
  reads = 0;
  override async readText(path: string, signal?: AbortSignal): Promise<string | undefined> {
    this.reads += 1;
    return super.readText(path, signal);
  }
}

test("live Review floors accumulated time once without IO and preserves non-live rows and summary", async () => {
  const access = new CountingAccess({ [path]: source });
  const coordinator = new ReviewCoordinator(new HistoryIndex(access));
  const noon = request.nowEpochMilliseconds;
  try {
    const initial = await coordinator.refresh({
      ...request,
      confirmedExecutionClocks: [
        { state: "closed", ownerId: OWNER, startEpochMilliseconds: noon - 120_000, endEpochMilliseconds: noon - 90_000 },
        { state: "running", ownerId: OWNER, startEpochMilliseconds: noon - 29_999 },
      ],
    });
    if (initial.state !== "ready") throw new Error("Review did not become ready");
    assert.equal(initial.projection.rows[1]?.actualMinutes, null);
    assert.equal(initial.projection.rows[1]?.state, "not-started");
    const reads = access.reads;
    coordinator.advance({
      nowEpochMilliseconds: noon + 1,
      timeZone: "UTC",
      writeBlocked: false,
    });
    const updated = coordinator.snapshot;
    if (updated.state !== "ready") throw new Error("Review lost readiness");
    assert.equal(updated.projection.rows[1]?.actualMinutes, 1);
    assert.equal(updated.projection.rows[1]?.actualMilliseconds, 60_000);
    assert.equal(updated.projection.rows[1]?.state, "live");
    assert.equal(updated.projectedAtEpochMilliseconds, noon + 1);
    assert.strictEqual(updated.projection.rows[0], initial.projection.rows[0]);
    assert.strictEqual(updated.projection.summary, initial.projection.summary);
    coordinator.advance({
      nowEpochMilliseconds: noon + 1_000,
      timeZone: "UTC",
      writeBlocked: false,
    });
    assert.strictEqual(coordinator.snapshot, updated, "sub-minute ticks do not publish unchanged UI");
    assert.equal(access.reads, reads);
    access.modify(path, source.replace("Identified", "Changed"));
    const invalidated = coordinator.snapshot;
    coordinator.advance({
      nowEpochMilliseconds: noon + 120_000,
      timeZone: "UTC",
      writeBlocked: false,
    });
    assert.strictEqual(coordinator.snapshot, invalidated, "dirty history cannot be revived by a clock tick");
  } finally {
    coordinator.dispose();
  }
  const disposed = coordinator.snapshot;
  coordinator.advance({
    nowEpochMilliseconds: noon + 240_000,
    timeZone: "UTC",
    writeBlocked: false,
  });
  assert.strictEqual(coordinator.snapshot, disposed);
});

test("live Review clips at local calendar midnight even when the timer continues", async () => {
  const coordinator = new ReviewCoordinator(new HistoryIndex(new MemoryTextAccess({ [path]: source })));
  const midnight = request.day.endEpochMilliseconds;
  try {
    await coordinator.refresh({
      ...request,
      nowEpochMilliseconds: midnight - 40_000,
      confirmedExecutionClocks: [{ state: "running", ownerId: OWNER, startEpochMilliseconds: midnight - 90_000 }],
    });
    coordinator.advance({
      nowEpochMilliseconds: midnight + 5 * 60_000,
      timeZone: "UTC",
      writeBlocked: false,
    });
    const snapshot = coordinator.snapshot;
    if (snapshot.state !== "ready") throw new Error("Review did not become ready");
    assert.equal(snapshot.projection.rows[1]?.actualMinutes, 1);
    assert.equal(snapshot.projection.rows[1]?.actualMilliseconds, 90_000);
    coordinator.advance({
      nowEpochMilliseconds: midnight + 10 * 60_000,
      timeZone: "UTC",
      writeBlocked: false,
    });
    assert.strictEqual(coordinator.snapshot, snapshot);
  } finally {
    coordinator.dispose();
  }
});

test("same-date confirmed refresh reuses history without building flicker, and settings or source changes invalidate it", async () => {
  const access = new CountingAccess({ [path]: source });
  const coordinator = new ReviewCoordinator(new HistoryIndex(access));
  try {
    await coordinator.refresh(request);
    const reads = access.reads;
    const states: string[] = [];
    const unsubscribe = coordinator.subscribe((snapshot) => states.push(snapshot.state));
    await coordinator.refresh({ ...request, nowEpochMilliseconds: request.nowEpochMilliseconds + 60_000 });
    assert.deepEqual(states, ["ready", "ready"]);
    assert.equal(access.reads, reads, "opening or refreshing a confirmed Review does not rescan the vault");
    const utc = createZonedLocalTimeResolver("UTC");
    await coordinator.refresh({
      ...request,
      clockParsing: { resolveLocalTime: utc.resolve },
      clockParsingKey: `iana:${utc.timeZone}`,
    });
    const afterFirstResolver = access.reads;
    const equivalentUtc = createZonedLocalTimeResolver("Etc/UTC");
    await coordinator.refresh({
      ...request,
      clockParsing: { resolveLocalTime: equivalentUtc.resolve },
      clockParsingKey: `iana:${equivalentUtc.timeZone}`,
    });
    assert.equal(access.reads, afterFirstResolver, "equivalent resolver instances reuse the semantic cache key");
    const shanghai = createZonedLocalTimeResolver("Asia/Shanghai");
    await coordinator.refresh({
      ...request,
      clockParsing: { resolveLocalTime: shanghai.resolve },
      clockParsingKey: `iana:${shanghai.timeZone}`,
    });
    assert.ok(access.reads > afterFirstResolver, "timezone semantics invalidate parsed history");
    await coordinator.refresh({ ...request, grammarSettings: { defaultDurationMinutes: 20, urgentTrigger: "urgent" } });
    assert.ok(access.reads > reads);
    assert.ok(states.includes("building"));
    const afterSettings = access.reads;
    access.modify(path, source.replace("Anonymous", "Updated"));
    await coordinator.refresh(request);
    assert.ok(access.reads > afterSettings);
    unsubscribe();
  } finally {
    coordinator.dispose();
  }
});

test("live Review freezes blocked writes and requests refresh for timezone or backward-clock changes", async () => {
  const access = new CountingAccess({ [path]: source });
  const coordinator = new ReviewCoordinator(new HistoryIndex(access));
  const noon = request.nowEpochMilliseconds;
  try {
    const initial = await coordinator.refresh({
      ...request,
      confirmedExecutionClocks: [{
        state: "running",
        ownerId: OWNER,
        startEpochMilliseconds: noon - 120_000,
      }],
    });
    if (initial.state !== "ready") throw new Error("Review did not become ready");
    const reads = access.reads;
    assert.equal(coordinator.advance({
      nowEpochMilliseconds: noon - 60_000,
      timeZone: "Asia/Shanghai",
      writeBlocked: true,
    }), "frozen");
    assert.strictEqual(coordinator.snapshot, initial);
    assert.equal(coordinator.advance({
      nowEpochMilliseconds: noon + 30_000,
      timeZone: "UTC",
      writeBlocked: false,
    }), "unchanged");
    assert.equal(coordinator.advance({
      nowEpochMilliseconds: noon + 20_000,
      timeZone: "UTC",
      writeBlocked: false,
    }), "refresh-required");
    assert.equal(coordinator.advance({
      nowEpochMilliseconds: noon + 40_000,
      timeZone: "Asia/Shanghai",
      writeBlocked: false,
    }), "refresh-required");
    assert.strictEqual(coordinator.snapshot, initial);
    assert.equal(access.reads, reads);
  } finally {
    coordinator.dispose();
  }
});
