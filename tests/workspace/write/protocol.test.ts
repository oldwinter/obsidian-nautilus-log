import assert from "node:assert/strict";
import test from "node:test";

import {
  ObsidianAtomicTextAccess,
  WorkspaceCommitter,
  legacyRunningClockKey,
} from "../../../src/workspace/commit.ts";
import { parseClockText } from "../../../src/workspace/clock-parser.ts";
import {
  WRITE_RESULT_CODES,
  createCommitConflict,
  isWriteResult,
} from "../../../src/workspace/conflicts.ts";
import { formatCanonicalClosedClock, formatCanonicalRunningClock } from "../../../src/workspace/logbook-clock.ts";
import {
  createClockExpectation,
  createMutationExpectation,
  revalidateClockExpectation,
} from "../../../src/workspace/expectation.ts";
import { WorkspaceIndex } from "../../../src/workspace/identity-index.ts";
import { createMutationPlan, type MutationPlan } from "../../../src/workspace/mutations.ts";
import { createCommitReceipt, isCommitReceipt } from "../../../src/workspace/receipt.ts";
import { createSourceVersion } from "../../../src/workspace/source-version.ts";
import { MemoryTextAccess } from "../../../src/workspace/text-access.ts";
import { MemoryAtomicTextAccess } from "./adapters.ts";
import {
  CLOCK_A,
  CLOCK_B,
  CLOCK_NEW,
  CLOSE,
  CONTEXT,
  NOW,
  OPEN,
  PLAN_A,
  PLAN_B,
  mutationExpectation,
} from "./fixtures.ts";

const PATH = "Daily/Protocol.md";

function clockInPlanAt(
  path: string,
  intentId: string,
  expectedRunningClockIds: readonly string[] = [],
) {
  return createMutationPlan({
    intentId,
    action: "clock-in",
    stages: [{
      path,
      confirmationRequired: false,
      operations: [{
        kind: "clock-in",
        target: { kind: "plan-item", id: PLAN_B },
        clock: { clockId: CLOCK_NEW, startEpochMs: NOW, offsetMinutes: 480 },
      }],
    }],
    expectedRunningClockIds,
    settingsVersion: CONTEXT.settingsVersion,
    zoneId: CONTEXT.zoneId,
  });
}

function clockInPlan(expectedRunningClockIds: readonly string[] = []) {
  return clockInPlanAt(PATH, "protocol-clock-in", expectedRunningClockIds);
}

function anonymousLegacyClockOutPlan(path: string, runningKey: string, intentId: string) {
  return createMutationPlan({
    intentId,
    action: "clock-out",
    stages: [{
      path,
      confirmationRequired: false,
      operations: [{
        kind: "clock-out",
        target: { kind: "clock" },
        close: {
          clockId: CLOCK_NEW,
          assignedClockId: CLOCK_NEW,
          endEpochMs: NOW,
          offsetMinutes: 480,
          legacyStartOffsetMinutes: 480,
        },
      }],
    }],
    expectedRunningClockIds: [runningKey],
    settingsVersion: CONTEXT.settingsVersion,
    zoneId: CONTEXT.zoneId,
  });
}

test("all stable result codes expose only bounded redacted context", () => {
  assert.equal(WRITE_RESULT_CODES.length, 19);
  for (const code of WRITE_RESULT_CODES) {
    const result = createCommitConflict(code, {
      action: "clock-in",
      sources: [{ path: PATH, line: 4, identitySuffix: "cccccccccccc" }],
      count: 1,
    });
    assert.equal(result.code, code);
    assert.deepEqual(Object.keys(result.context).sort(), ["action", "count", "sources"]);
    assert.equal(JSON.stringify(result).includes("note contents"), false);
  }
  assert.throws(() => createCommitConflict("source-conflict", {
    sources: [{ path: PATH, identitySuffix: PLAN_A }],
  }), /identitySuffix/);
});

test("write-result and receipt guards reject malformed nested fields", async () => {
  const result = createCommitConflict("source-conflict", {
    action: "clock-in",
    sources: [{ path: PATH, line: 2, identitySuffix: "cccccccccccc" }],
    stage: 0,
  });
  assert.equal(isWriteResult(result), true);
  for (const malformed of [
    { ...result, context: { ...result.context, action: "not-an-action" } },
    { ...result, context: { ...result.context, sources: [{ path: "" }] } },
    { ...result, context: { ...result.context, sources: [{ path: PATH, line: -1 }] } },
    { ...result, context: { ...result.context, sources: [{ path: PATH, identitySuffix: "unsafe/value" }] } },
    { ...result, context: { ...result.context, sources: [{ path: "../note contents.md" }] } },
    { ...result, context: { ...result.context, sources: [{ path: "Daily/note contents\nleak.md" }] } },
    { ...result, context: { ...result.context, sources: Array.from({ length: 17 }, () => ({ path: PATH })) } },
    { ...result, context: { ...result.context, count: 1.5 } },
    { ...result, context: { ...result.context, secret: "note contents" } },
  ]) assert.equal(isWriteResult(malformed), false);

  const version = await createSourceVersion(PATH, "unchanged");
  const receipt = createCommitReceipt({
    intentId: "guard-valid",
    action: "clock-in",
    outcome: "already-applied",
    sources: [{ path: PATH, primitive: "editor", before: version, after: version, locations: [] }],
    confirmation: "confirmed",
    globalCheck: { status: "confirmed", runningClockIds: [] },
    result,
  });
  assert.equal(isCommitReceipt(receipt), true);
  const source = receipt.sources[0]!;
  for (const malformed of [
    { ...receipt, action: "not-an-action" },
    { ...receipt, sources: [{ ...source, before: { ...source.before, contentDigest: "bad" } }] },
    { ...receipt, sources: [{ ...source, changed: true }] },
    { ...receipt, sources: [{ ...source, undo: "not-guaranteed" }] },
    { ...receipt, sources: [{ ...source, locations: [{ line: -1 }] }] },
    { ...receipt, sources: [{ ...source, locations: [{ line: 0, secret: "note contents" }] }] },
    { ...receipt, semanticChanges: ["not-a-semantic-change"] },
    { ...receipt, resultingIdentities: [{ kind: "clock", id: CLOCK_A, path: PATH, line: -1 }] },
    { ...receipt, globalCheck: { status: "confirmed", runningClockIds: [""] } },
    { ...receipt, result: { ...result, context: { ...result.context, stage: -1 } } },
    { ...receipt, leakedSource: "note contents" },
  ]) assert.equal(isCommitReceipt(malformed), false);

  assert.throws(() => createCommitConflict("source-conflict", {
    sources: [{ path: "../note contents.md" }],
  }), /vault-relative path/);
  assert.throws(() => createCommitConflict("source-conflict", {
    sources: [{ path: `${"a".repeat(1_025)}.md` }],
  }), /bounded normalized vault-relative path/);
  assert.throws(() => createCommitConflict("source-conflict", {
    sources: Array.from({ length: 17 }, () => ({ path: PATH })),
  }), /at most 16 sources/);
  assert.throws(() => createCommitReceipt({
    ...receipt,
    action: "not-an-action" as never,
  }), /Unsupported receipt action/);
  assert.throws(() => createCommitReceipt({
    ...receipt,
    semanticChanges: ["not-a-semantic-change" as never],
  }), /unsupported semantic change/);
});

test("receipt constructors reject false zero-change and false Undo claims", async () => {
  const before = await createSourceVersion(PATH, "before");
  const after = await createSourceVersion(PATH, "after");
  assert.throws(() => createCommitReceipt({
    intentId: "false-conflict",
    action: "clock-in",
    outcome: "conflict",
    sources: [{ path: PATH, primitive: "vault-process", before, after, locations: [{ line: 0 }] }],
    semanticChanges: [],
    confirmation: "confirmed-no-change",
    globalCheck: { status: "confirmed", runningClockIds: [] },
  }), /zero source changes/);
  assert.throws(() => createCommitReceipt({
    intentId: "false-undo",
    action: "clock-in",
    outcome: "applied",
    sources: [{ path: PATH, primitive: "vault-process", before, after, undo: "single-native-step", locations: [{ line: 0 }] }],
    semanticChanges: ["clock-opened"],
    confirmation: "confirmed",
    globalCheck: { status: "confirmed", runningClockIds: [CLOCK_NEW] },
  }), /not-guaranteed/);
  assert.throws(() => createCommitReceipt({
    intentId: "false-applied",
    action: "clock-in",
    outcome: "applied",
    sources: [{ path: PATH, primitive: "vault-process", before, after: before, locations: [] }],
    confirmation: "confirmed",
    globalCheck: { status: "confirmed", runningClockIds: [] },
  }), /at least one changed source/);

  const leakedVersion = { ...before, leakedSource: "note contents" };
  const sanitized = createCommitReceipt({
    intentId: "sanitized-version",
    action: "clock-in",
    outcome: "already-applied",
    sources: [{ path: PATH, primitive: "vault-process", before: leakedVersion, after: leakedVersion, locations: [] }],
    confirmation: "confirmed",
    globalCheck: { status: "confirmed", runningClockIds: [] },
  });
  assert.equal(isCommitReceipt(sanitized), true);
  assert.equal(JSON.stringify(sanitized).includes("note contents"), false);
});

test("multiple and potential running CLOCKs block before any host transform", async () => {
  const runningA = formatCanonicalRunningClock(NOW - 60_000, 480, CLOCK_A);
  const runningB = formatCanonicalRunningClock(NOW - 30_000, 480, CLOCK_B);
  const multipleSource = `${OPEN}\n- [ ] A ^${PLAN_A}\n  - LOGBOOK::\n    - ${runningA}\n- [ ] B ^${PLAN_B}\n  - LOGBOOK::\n    - ${runningB}\n${CLOSE}\n`;
  const multipleAccess = new MemoryAtomicTextAccess({ [PATH]: multipleSource });
  const multiplePlan = clockInPlan([CLOCK_A, CLOCK_B]);
  const multipleExpectation = await mutationExpectation(multipleAccess, multiplePlan, { planIds: [PLAN_B], expectedRunningClockIds: [CLOCK_A, CLOCK_B] });
  const multipleWriter = new WorkspaceCommitter(multipleAccess, { readContext: () => CONTEXT });
  const multiple = await multipleWriter.commit(multiplePlan, multipleExpectation);
  assert.equal(multiple.result?.code, "multiple-running-clocks");
  assert.equal(multipleAccess.transactionCounts.size, 0);
  multipleWriter.dispose();

  const potentialSource = `${OPEN}\n- [ ] B ^${PLAN_B}\n  - LOGBOOK::\n    - CLOCK: [broken]\n${CLOSE}\n`;
  const potentialAccess = new MemoryAtomicTextAccess({ [PATH]: potentialSource });
  const potentialPlan = clockInPlan();
  const potentialExpectation = await mutationExpectation(potentialAccess, potentialPlan, { planIds: [PLAN_B] });
  const potentialWriter = new WorkspaceCommitter(potentialAccess, { readContext: () => CONTEXT });
  const potential = await potentialWriter.commit(potentialPlan, potentialExpectation);
  assert.equal(potential.result?.code, "potential-running-clock");
  assert.equal(potentialAccess.transactionCounts.size, 0);
  potentialWriter.dispose();
});

test("anonymous eligible ID-less legacy running CLOCK blocks cross-file Clock In", async () => {
  const anonymousPath = "Daily/Anonymous.md";
  const targetPath = "Daily/Target.md";
  const legacyText = "CLOCK: [2026-08-28 08:10]";
  const anonymousSource = `${OPEN}\n- [ ] Anonymous task d30m\n  - LOGBOOK::\n    - ${legacyText}\n${CLOSE}\n`;
  const targetSource = `${OPEN}\n- [ ] Identified task d30m ^${PLAN_B}\n${CLOSE}\n`;
  const access = new MemoryAtomicTextAccess({
    [anonymousPath]: anonymousSource,
    [targetPath]: targetSource,
  });
  const resolveLocalTime = () => ({ kind: "unique" as const, epochMs: NOW - 60_000 });
  const parsedIndex = new WorkspaceIndex(access, { clockParsing: { resolveLocalTime } });
  const parsedSnapshot = await parsedIndex.rebuild();
  assert.equal(parsedSnapshot.running.length, 1);
  const parsedClock = parsedSnapshot.running[0]!;
  const runningKey = legacyRunningClockKey(
    parsedClock.path,
    parsedClock.fromOffset,
    parsedClock.text,
  );
  parsedIndex.dispose();
  const mutation = clockInPlanAt(targetPath, "anonymous-legacy-global-clock", [runningKey]);
  const expectation = await mutationExpectation(access, mutation, {
    planIds: [PLAN_B],
    expectedRunningClockIds: [runningKey],
  });
  assert.deepEqual(expectation.expectedRunningClockIds, [runningKey]);
  const writer = new WorkspaceCommitter(access, {
    readContext: () => CONTEXT,
    index: { clockParsing: { resolveLocalTime } },
    logbook: { resolveLocalTime },
  });

  const receipt = await writer.commit(mutation, expectation);

  assert.equal(receipt.outcome, "conflict");
  assert.equal(receipt.result?.code, "clock-owner-invalid");
  assert.equal(receipt.globalCheck.status, "violated");
  assert.equal(receipt.globalCheck.runningClockIds.length, 1);
  assert.ok(receipt.globalCheck.runningClockIds[0]?.startsWith(
    `legacy:${parsedClock.path}:${parsedClock.fromOffset}:`,
  ));
  assert.match(receipt.globalCheck.runningClockIds[0]!, /:[0-9a-f]{8}$/);
  assert.equal(receipt.globalCheck.runningClockIds[0]?.includes(parsedClock.text), false);
  assert.equal(access.transactionCounts.size, 0);
  assert.equal(await access.readText(anonymousPath), anonymousSource);
  assert.equal(await access.readText(targetPath), targetSource);
  writer.dispose();
});

test("anonymous eligible malformed potential CLOCK blocks cross-file Clock In", async () => {
  const anonymousPath = "Daily/Anonymous-Potential.md";
  const targetPath = "Daily/Potential-Target.md";
  const anonymousSource = `${OPEN}\n- [ ] Anonymous task d30m\n  - LOGBOOK::\n    - CLOCK: [broken]\n${CLOSE}\n`;
  const targetSource = `${OPEN}\n- [ ] Identified task d30m ^${PLAN_B}\n${CLOSE}\n`;
  const access = new MemoryAtomicTextAccess({
    [anonymousPath]: anonymousSource,
    [targetPath]: targetSource,
  });
  const mutation = clockInPlanAt(targetPath, "anonymous-potential-global-clock");
  const expectation = await mutationExpectation(access, mutation, { planIds: [PLAN_B] });
  const writer = new WorkspaceCommitter(access, { readContext: () => CONTEXT });

  const receipt = await writer.commit(mutation, expectation);

  assert.equal(receipt.outcome, "conflict");
  assert.equal(receipt.result?.code, "potential-running-clock");
  assert.equal(receipt.globalCheck.status, "violated");
  assert.equal(access.transactionCounts.size, 0);
  assert.equal(await access.readText(anonymousPath), anonymousSource);
  assert.equal(await access.readText(targetPath), targetSource);
  writer.dispose();
});

test("unsaved active Editor anonymous legacy CLOCK blocks before any host mutation", async () => {
  const anonymousPath = "Daily/Unsaved-Anonymous.md";
  const targetPath = "Daily/Unsaved-Target.md";
  const vaultAnonymous = `${OPEN}\n- [ ] Anonymous task d30m\n${CLOSE}\n`;
  const editorAnonymous = `${OPEN}\n- [ ] Anonymous task d30m\n  - LOGBOOK::\n    - CLOCK: [2026-08-28 08:10]\n${CLOSE}\n`;
  const targetSource = `${OPEN}\n- [ ] Identified task d30m ^${PLAN_B}\n${CLOSE}\n`;
  const text = new MemoryTextAccess({
    [anonymousPath]: vaultAnonymous,
    [targetPath]: targetSource,
  });
  let editorTransactions = 0;
  let vaultProcesses = 0;
  const buffers = new Map([[anonymousPath, editorAnonymous], [targetPath, targetSource]]);
  const access = new ObsidianAtomicTextAccess({
    text,
    editorForPath: (path) => buffers.has(path) ? {
      getValue: () => buffers.get(path)!,
      transaction: () => { editorTransactions += 1; },
    } as never : undefined,
    fileForPath: (path) => ({ path }) as never,
    vault: {
      process: async () => { vaultProcesses += 1; },
    } as never,
  });
  const mutation = clockInPlanAt(targetPath, "unsaved-anonymous-global-clock");
  const expectation = await mutationExpectation(access, mutation, { planIds: [PLAN_B] });
  const resolveLocalTime = () => ({ kind: "unique" as const, epochMs: NOW - 60_000 });
  const writer = new WorkspaceCommitter(access, {
    readContext: () => CONTEXT,
    index: { clockParsing: { resolveLocalTime } },
    logbook: { resolveLocalTime },
  });

  const receipt = await writer.commit(mutation, expectation);

  assert.equal(receipt.result?.code, "clock-owner-invalid");
  assert.equal(receipt.globalCheck.status, "violated");
  assert.equal(editorTransactions, 0);
  assert.equal(vaultProcesses, 0);
  assert.equal(await text.readText(anonymousPath), vaultAnonymous);
  assert.equal(buffers.get(anonymousPath), editorAnonymous);
  assert.equal(buffers.get(targetPath), targetSource);
  writer.dispose();
});

test("anonymous non-execution-eligible CLOCK-looking text stays outside global running facts", async () => {
  const noneligiblePath = "Daily/Anonymous-Noneligible.md";
  const source = [
    OPEN,
    "- [x] Done task",
    "  - LOGBOOK::",
    "    - CLOCK: [2026-08-28 08:01]",
    "- [ ] Fixed event 08:00-09:00",
    "  - LOGBOOK::",
    "    - CLOCK: [2026-08-28 08:02]",
    "- Plain item",
    "  - LOGBOOK::",
    "    - CLOCK: [2026-08-28 08:03]",
    "- [-] Foreign task",
    "  - LOGBOOK::",
    "    - CLOCK: [2026-08-28 08:04]",
    `- [ ] Eligible task d30m ^${PLAN_B}`,
    CLOSE,
    "",
  ].join("\n");
  const access = new MemoryAtomicTextAccess({ [noneligiblePath]: source });
  const resolveLocalTime = () => ({ kind: "unique" as const, epochMs: NOW - 60_000 });
  const index = new WorkspaceIndex(access, { clockParsing: { resolveLocalTime } });

  const snapshot = await index.rebuild();

  assert.equal(snapshot.complete, true);
  assert.deepEqual(snapshot.clocks.filter((clock) => clock.path === noneligiblePath), []);
  assert.deepEqual(snapshot.running, []);
  assert.deepEqual(snapshot.potentialRunning, []);
  const target = index.identity(PLAN_B);
  assert.equal(target.kind, "unique");
  if (target.kind === "unique") assert.equal(target.location.path, noneligiblePath);
  index.dispose();

  const mutation = clockInPlanAt(noneligiblePath, "noneligible-anonymous-clock-text");
  const expectation = await mutationExpectation(access, mutation, { planIds: [PLAN_B] });
  const writer = new WorkspaceCommitter(access, {
    readContext: () => CONTEXT,
    index: { clockParsing: { resolveLocalTime } },
    logbook: { resolveLocalTime },
  });
  const receipt = await writer.commit(mutation, expectation);
  assert.equal(receipt.outcome, "applied");
  assert.deepEqual(receipt.globalCheck, { status: "confirmed", runningClockIds: [CLOCK_NEW] });
  assert.equal(access.transactionCounts.get(noneligiblePath), 1);
  const after = await access.readText(noneligiblePath);
  for (const clockText of ["08:01", "08:02", "08:03", "08:04"]) {
    assert.equal(after?.match(new RegExp(`CLOCK: \\[2026-08-28 ${clockText}\\]`, "g"))?.length, 1);
  }
  writer.dispose();

  const confirmedIndex = new WorkspaceIndex(access, { clockParsing: { resolveLocalTime } });
  const confirmed = await confirmedIndex.rebuild();
  assert.equal(confirmed.clocks.length, 1);
  assert.equal(confirmed.running.length, 1);
  assert.equal(confirmed.running[0]?.clockId, CLOCK_NEW);
  assert.equal(confirmed.running[0]?.ownerId, PLAN_B);
  const confirmedTarget = confirmedIndex.identity(PLAN_B);
  assert.equal(confirmedTarget.kind, "unique");
  if (confirmedTarget.kind === "unique") assert.equal(confirmedTarget.location.path, noneligiblePath);
  confirmedIndex.dispose();
});

test("callback scan rejects newly inserted anonymous eligible CLOCK facts without plugin bytes", async () => {
  const path = "Daily/Anonymous-Callback.md";
  const source = `${OPEN}\n- [ ] Eligible task d30m ^${PLAN_B}\n${CLOSE}\n`;
  const resolveLocalTime = () => ({ kind: "unique" as const, epochMs: NOW - 60_000 });
  for (const fixture of [
    {
      intentId: "anonymous-callback-legacy",
      clockText: "CLOCK: [2026-08-28 08:10]",
      code: "source-conflict",
      globalStatus: "unavailable",
    },
    {
      intentId: "anonymous-callback-potential",
      clockText: "CLOCK: [broken]",
      code: "potential-running-clock",
      globalStatus: "unavailable",
    },
  ] as const) {
    const access = new MemoryAtomicTextAccess({ [path]: source });
    const mutation = clockInPlanAt(path, fixture.intentId);
    const expectation = await mutationExpectation(access, mutation, { planIds: [PLAN_B] });
    const externallyChanged = source.replace(
      `- [ ] Eligible task d30m ^${PLAN_B}`,
      `- [ ] Anonymous task d30m\n  - LOGBOOK::\n    - ${fixture.clockText}\n- [ ] Eligible task d30m ^${PLAN_B}`,
    );
    access.raceBeforeCallback(path, () => externallyChanged);
    const writer = new WorkspaceCommitter(access, {
      readContext: () => CONTEXT,
      index: { clockParsing: { resolveLocalTime } },
      logbook: { resolveLocalTime },
    });

    const receipt = await writer.commit(mutation, expectation);

    assert.equal(receipt.outcome, "conflict");
    assert.equal(receipt.result?.code, fixture.code);
    assert.equal(receipt.globalCheck.status, fixture.globalStatus);
    assert.equal(access.transactionCounts.get(path), 1);
    assert.equal(access.callbackCounts.get(path), 1);
    assert.equal(await access.readText(path), externallyChanged);
    assert.equal((await access.readText(path))?.includes(CLOCK_NEW), false);
    writer.dispose();
  }
});

test("anonymous eligible ID-less legacy running CLOCK permits only exact locator recovery", async () => {
  const anonymousPath = "Daily/Anonymous-Recovery.md";
  const legacyText = "CLOCK: [2026-08-28 08:10]";
  const source = `${OPEN}\n- [ ] Anonymous task d30m\n  - LOGBOOK::\n    - ${legacyText}\n${CLOSE}\n`;
  const access = new MemoryAtomicTextAccess({ [anonymousPath]: source });
  const legacyStart = Date.UTC(2026, 7, 28, 0, 10);
  const resolveLocalTime = () => ({ kind: "unique" as const, epochMs: legacyStart });
  const parsedIndex = new WorkspaceIndex(access, { clockParsing: { resolveLocalTime } });
  const parsed = await parsedIndex.rebuild();
  assert.equal(parsed.running.length, 1);
  const parsedClock = parsed.running[0]!;
  const runningKey = legacyRunningClockKey(parsedClock.path, parsedClock.fromOffset, parsedClock.text);
  parsedIndex.dispose();
  const mutation = anonymousLegacyClockOutPlan(
    anonymousPath,
    runningKey,
    "anonymous-legacy-exact-recovery",
  );
  const expectation = await mutationExpectation(access, mutation, {
    clockIds: [undefined],
    expectedRunningClockIds: [runningKey],
    logbookOptions: { resolveLocalTime },
  });
  const writer = new WorkspaceCommitter(access, {
    readContext: () => CONTEXT,
    index: { clockParsing: { resolveLocalTime } },
    logbook: { resolveLocalTime },
  });

  const receipt = await writer.commit(mutation, expectation);

  assert.equal(receipt.outcome, "applied");
  const expected = source.replace(
    legacyText,
    formatCanonicalClosedClock(legacyStart, 480, NOW, 480, CLOCK_NEW),
  );
  assert.equal(access.transactionCounts.get(anonymousPath), 1);
  assert.equal(access.callbackCounts.get(anonymousPath), 1);
  assert.equal(await access.readText(anonymousPath), expected);
  const primitive = process.env.OBS_SAFE_ADAPTER_PASS === "disposable-editor" ? "editor" : "vault-process";
  assert.deepEqual(receipt.sources, [{
    path: anonymousPath,
    primitive,
    before: await createSourceVersion(anonymousPath, source),
    after: await createSourceVersion(anonymousPath, expected),
    changed: true,
    undo: primitive === "editor" ? "single-native-step" : "not-guaranteed",
    locations: [{ line: 3 }],
  }]);
  assert.ok(receipt.semanticChanges.includes("clock-closed"));
  assert.deepEqual(receipt.resultingIdentities, [{
    kind: "clock",
    id: CLOCK_NEW,
    path: anonymousPath,
  }]);
  assert.deepEqual(receipt.globalCheck, { status: "confirmed", runningClockIds: [] });
  writer.dispose();

  const drifted = source.replace(`${OPEN}\n`, `${OPEN}\n<!-- external offset shift -->\n`);
  const driftAccess = new MemoryAtomicTextAccess({ [anonymousPath]: source });
  const driftExpectation = await mutationExpectation(driftAccess, mutation, {
    clockIds: [undefined],
    expectedRunningClockIds: [runningKey],
    logbookOptions: { resolveLocalTime },
  });
  driftAccess.raceBeforeCallback(anonymousPath, () => drifted);
  const driftWriter = new WorkspaceCommitter(driftAccess, {
    readContext: () => CONTEXT,
    index: { clockParsing: { resolveLocalTime } },
    logbook: { resolveLocalTime },
  });
  const rejected = await driftWriter.commit(mutation, driftExpectation);
  assert.equal(rejected.outcome, "conflict");
  assert.equal(rejected.result?.code, "source-conflict");
  assert.equal(driftAccess.transactionCounts.get(anonymousPath), 1);
  assert.equal(driftAccess.callbackCounts.get(anonymousPath), 1);
  assert.equal(await driftAccess.readText(anonymousPath), drifted);
  assert.equal((await driftAccess.readText(anonymousPath))?.includes(CLOCK_NEW), false);
  driftWriter.dispose();
});

test("over-limit and settings-version drift fail closed without sampling or writes", async () => {
  const source = `${OPEN}\n- [ ] B ^${PLAN_B}\n${CLOSE}\n`;
  const access = new MemoryAtomicTextAccess({ [PATH]: source });
  const mutation = clockInPlan();
  const expectation = await mutationExpectation(access, mutation, { planIds: [PLAN_B] });
  const limited = new WorkspaceCommitter(access, {
    readContext: () => CONTEXT,
    index: { limits: { maxMarkdownFiles: 0 } },
  });
  const limitReceipt = await limited.commit(mutation, expectation);
  assert.equal(limitReceipt.result?.code, "source-over-limit");
  assert.equal(access.transactionCounts.size, 0);
  limited.dispose();

  const drifted = new WorkspaceCommitter(access, {
    readContext: () => ({ ...CONTEXT, settingsVersion: CONTEXT.settingsVersion + 1 }),
  });
  const driftReceipt = await drifted.commit(mutation, expectation);
  assert.equal(driftReceipt.outcome, "rejected");
  assert.equal(access.transactionCounts.size, 0);
  drifted.dispose();

  const { expectationToken: _expectationToken, ...expectationInput } = expectation;
  const dirtyExpectation = createMutationExpectation({ ...expectationInput, indexComplete: false });
  const dirty = new WorkspaceCommitter(access, { readContext: () => CONTEXT });
  const dirtyReceipt = await dirty.commit(mutation, dirtyExpectation);
  assert.equal(dirtyReceipt.outcome, "conflict");
  assert.equal(dirtyReceipt.result?.code, "source-over-limit");
  assert.equal(access.transactionCounts.size, 0);
  assert.equal(await access.readText(PATH), source);
  dirty.dispose();
});

test("unrelated bytes may change inside the optimistic window and remain preserved", async () => {
  const source = `frontmatter: old\n${OPEN}\n- [ ] B ^${PLAN_B}\n${CLOSE}\n`;
  const access = new MemoryAtomicTextAccess({ [PATH]: source });
  const mutation = clockInPlan();
  const expectation = await mutationExpectation(access, mutation, { planIds: [PLAN_B] });
  access.raceBeforeCallback(PATH, (current) => current.replace("frontmatter: old", "frontmatter: external"));
  const writer = new WorkspaceCommitter(access, { readContext: () => CONTEXT });
  const receipt = await writer.commit(mutation, expectation);
  assert.equal(receipt.outcome, "applied");
  const after = await access.readText(PATH);
  assert.ok(after?.startsWith("frontmatter: external"));
  assert.ok(after?.includes(CLOCK_NEW));
  writer.dispose();
});

test("a vault change after the final post-scan invalidates success instead of publishing stale global facts", async () => {
  const otherPath = "Daily/Other.md";
  const source = `${OPEN}\n- [ ] B ^${PLAN_B}\n${CLOSE}\n`;
  const access = new MemoryAtomicTextAccess({ [PATH]: source, [otherPath]: "other\n" });
  const mutation = clockInPlan();
  const expectation = await mutationExpectation(access, mutation, { planIds: [PLAN_B] });
  access.raceAfterTransformReads(4, () => access.modify(otherPath, "external\n"));
  const writer = new WorkspaceCommitter(access, { readContext: () => CONTEXT });
  const receipt = await writer.commit(mutation, expectation);
  assert.equal(receipt.outcome, "invariant-broken");
  assert.equal(receipt.result?.code, "write-invariant-broken");
  assert.equal(await access.readText(otherPath), "external\n");
  assert.ok((await access.readText(PATH))?.includes(CLOCK_NEW));
  writer.dispose();
});

test("transaction callback rejects newly inserted structured or canonical-global running CLOCKs", async () => {
  for (const [name, inject] of [
    ["structured", (source: string) => source.replace(`${CLOSE}\n`, `- [ ] External ^${PLAN_A}\n  - LOGBOOK::\n    - ${formatCanonicalRunningClock(NOW - 1, 480, CLOCK_A)}\n${CLOSE}\n`)],
    ["canonical-global", (source: string) => `${formatCanonicalRunningClock(NOW - 1, 480, CLOCK_A)}\n${source}`],
  ] as const) {
    const source = `${OPEN}\n- [ ] B ^${PLAN_B}\n${CLOSE}\n`;
    const access = new MemoryAtomicTextAccess({ [PATH]: source });
    const mutation = clockInPlan();
    const expectation = await mutationExpectation(access, mutation, { planIds: [PLAN_B] });
    access.raceBeforeCallback(PATH, inject);
    const writer = new WorkspaceCommitter(access, { readContext: () => CONTEXT });
    const receipt = await writer.commit(mutation, expectation);
    assert.equal(receipt.outcome, "conflict", name);
    assert.equal((await access.readText(PATH))?.includes(CLOCK_NEW), false, name);
    assert.equal((await access.readText(PATH))?.includes(CLOCK_A), true, name);
    writer.dispose();
  }
});

test("cross-file running and identity races signaled before callback change zero target bytes", async () => {
  const otherPath = "Daily/Race-Other.md";
  const target = `${OPEN}\n- [ ] B ^${PLAN_B}\n${CLOSE}\n`;
  for (const [name, initialOther, changedOther] of [
    [
      "running",
      `${OPEN}\n- [ ] External ^${PLAN_A}\n${CLOSE}\n`,
      `${OPEN}\n- [ ] External ^${PLAN_A}\n  - LOGBOOK::\n    - ${formatCanonicalRunningClock(NOW - 1, 480, CLOCK_A)}\n${CLOSE}\n`,
    ],
    ["identity", "external\n", `external ^${CLOCK_NEW}\n`],
  ] as const) {
    const access = new MemoryAtomicTextAccess({ [PATH]: target, [otherPath]: initialOther });
    const mutation = clockInPlan();
    const expectation = await mutationExpectation(access, mutation, { planIds: [PLAN_B] });
    access.raceBeforeCallback(PATH, (current) => {
      access.modify(otherPath, changedOther);
      return current;
    });
    const writer = new WorkspaceCommitter(access, { readContext: () => CONTEXT });
    const receipt = await writer.commit(mutation, expectation);
    assert.equal(receipt.outcome, "conflict", name);
    assert.equal(receipt.result?.code, "source-conflict", name);
    assert.equal(await access.readText(PATH), target, name);
    assert.equal(await access.readText(otherPath), changedOther, name);
    writer.dispose();
  }
});

test("ignored fenced CLOCK examples stay writable and callback ID collisions reject before plugin bytes", async () => {
  const example = formatCanonicalRunningClock(NOW - 1, 480, CLOCK_A);
  const source = `\`\`\`text\n${example}\n\`\`\`\n${OPEN}\n- [ ] B ^${PLAN_B}\n${CLOSE}\n`;
  const access = new MemoryAtomicTextAccess({ [PATH]: source });
  const mutation = clockInPlan();
  const expectation = await mutationExpectation(access, mutation, { planIds: [PLAN_B] });
  const writer = new WorkspaceCommitter(access, { readContext: () => CONTEXT });
  const applied = await writer.commit(mutation, expectation);
  assert.equal(applied.outcome, "applied");
  assert.ok((await access.readText(PATH))?.includes(example));
  writer.dispose();

  const collisionAccess = new MemoryAtomicTextAccess({ [PATH]: `${OPEN}\n- [ ] B ^${PLAN_B}\n${CLOSE}\n` });
  const collisionPlan = clockInPlan();
  const collisionExpectation = await mutationExpectation(collisionAccess, collisionPlan, { planIds: [PLAN_B] });
  collisionAccess.raceBeforeCallback(PATH, (current) => current.replace(CLOSE, `- external ^${CLOCK_NEW}\n${CLOSE}`));
  const collisionWriter = new WorkspaceCommitter(collisionAccess, { readContext: () => CONTEXT });
  const collision = await collisionWriter.commit(collisionPlan, collisionExpectation);
  assert.equal(collision.outcome, "conflict");
  assert.equal(collision.result?.code, "identity-collision");
  assert.equal((await collisionAccess.readText(PATH))?.includes("CLOCK:"), false);
  assert.ok((await collisionAccess.readText(PATH))?.includes(`external ^${CLOCK_NEW}`));
  collisionWriter.dispose();

  const targetCollisionAccess = new MemoryAtomicTextAccess({ [PATH]: `${OPEN}\n- [ ] B ^${PLAN_B}\n${CLOSE}\n` });
  const targetCollisionPlan = clockInPlan();
  const targetCollisionExpectation = await mutationExpectation(targetCollisionAccess, targetCollisionPlan, { planIds: [PLAN_B] });
  targetCollisionAccess.raceBeforeCallback(PATH, (current) => current.replace(CLOSE, `external ^${PLAN_B}\n${CLOSE}`));
  const targetCollisionWriter = new WorkspaceCommitter(targetCollisionAccess, { readContext: () => CONTEXT });
  const targetCollision = await targetCollisionWriter.commit(targetCollisionPlan, targetCollisionExpectation);
  assert.equal(targetCollision.outcome, "conflict");
  assert.equal(targetCollision.result?.code, "identity-collision");
  assert.equal((await targetCollisionAccess.readText(PATH))?.includes("CLOCK:"), false);
  assert.ok((await targetCollisionAccess.readText(PATH))?.includes(`external ^${PLAN_B}`));
  targetCollisionWriter.dispose();
});

test("Clock expectation binds the observed owner even when the operation selector omits it", async () => {
  const running = formatCanonicalRunningClock(NOW - 60_000, 480, CLOCK_A);
  const source = `${OPEN}\n- [ ] A ^${PLAN_A}\n  - LOGBOOK::\n    - ${running}\n- [ ] B ^${PLAN_B}\n${CLOSE}\n`;
  const access = new MemoryAtomicTextAccess({ [PATH]: source });
  const mutation = createMutationPlan({
    intentId: "owner-watch",
    action: "clock-out",
    stages: [{
      path: PATH,
      confirmationRequired: false,
      operations: [{ kind: "clock-out", target: { kind: "clock", id: CLOCK_A }, close: { clockId: CLOCK_A, endEpochMs: NOW, offsetMinutes: 480 } }],
    }],
    expectedRunningClockIds: [CLOCK_A],
    settingsVersion: CONTEXT.settingsVersion,
    zoneId: CONTEXT.zoneId,
  });
  const expectation = await mutationExpectation(access, mutation, { clockIds: [CLOCK_A], expectedRunningClockIds: [CLOCK_A] });
  access.raceBeforeCallback(PATH, (current) => current
    .replace(`    - ${running}\n- [ ] B`, "- [ ] B")
    .replace(`- [ ] B ^${PLAN_B}`, `- [ ] B ^${PLAN_B}\n  - LOGBOOK::\n    - ${running}`));
  const writer = new WorkspaceCommitter(access, { readContext: () => CONTEXT });
  const receipt = await writer.commit(mutation, expectation);
  assert.equal(receipt.outcome, "conflict");
  assert.equal(receipt.result?.code, "source-conflict");
  assert.equal((await access.readText(PATH))?.includes(formatCanonicalRunningClock(NOW - 60_000, 480, CLOCK_A)), true);
  writer.dispose();
});

test("exact canonical orphan CLOCKs revalidate only for owner recovery actions", () => {
  const running = formatCanonicalRunningClock(NOW - 60_000, 480, CLOCK_A);
  const source = `# Orphan recovery\n${running}\n`;
  const fromOffset = source.indexOf(running);
  const parsed = parseClockText(running);
  assert.equal(parsed.kind, "record");
  const expectation = createClockExpectation({
    target: { kind: "clock", id: CLOCK_A },
    path: PATH,
    sourceText: source,
    clock: {
      path: PATH,
      fromOffset,
      toOffset: fromOffset + running.length,
      text: running,
      parsed,
    },
  });
  const caretOffset = source.indexOf(`^${CLOCK_A}`);
  const identity = Object.freeze({
    kind: "unique" as const,
    location: Object.freeze({
      id: CLOCK_A,
      path: PATH,
      fromOffset: caretOffset,
      toOffset: caretOffset + CLOCK_A.length + 1,
      line: 1,
      column: caretOffset - source.lastIndexOf("\n", caretOffset) - 1,
    }),
  });

  const recovered = revalidateClockExpectation(PATH, source, expectation, "clock-out", identity);
  assert.equal(recovered.ok, true);
  if (recovered.ok) {
    assert.equal(recovered.value.owner, undefined);
    assert.equal(recovered.value.clock.text, running);
  }
  assert.equal(revalidateClockExpectation(PATH, source, expectation, "complete", identity).ok, false);
  assert.equal(revalidateClockExpectation(PATH, source.replace("Orphan", "Changed"), expectation, "clock-out", identity).ok, true);
  assert.equal(revalidateClockExpectation(PATH, source.replace("CLOCK", "Clock"), expectation, "clock-out", identity).ok, false);
  const prose = source.replace(running, `Narrative prefix ${running}`);
  const proseCaret = prose.indexOf(`^${CLOCK_A}`);
  const proseIdentity = Object.freeze({
    kind: "unique" as const,
    location: Object.freeze({
      ...identity.location,
      fromOffset: proseCaret,
      toOffset: proseCaret + CLOCK_A.length + 1,
      column: proseCaret - prose.lastIndexOf("\n", proseCaret) - 1,
    }),
  });
  assert.equal(revalidateClockExpectation(PATH, prose, expectation, "clock-out", proseIdentity).ok, false);
});

test("unique canonical orphan CLOCK recovery is reachable by exact ID and watched bytes", async () => {
  const running = formatCanonicalRunningClock(NOW - 60_000, 480, CLOCK_A);
  const source = `# Orphan recovery\n- ${running}\n`;
  for (const action of ["clock-out", "delete-clock"] as const) {
    const access = new MemoryAtomicTextAccess({ [PATH]: source });
    const plan = createMutationPlan({
      intentId: `orphan-${action}`,
      action,
      stages: [{
        path: PATH,
        confirmationRequired: false,
        operations: action === "clock-out"
          ? [{
              kind: "clock-out",
              target: { kind: "clock", id: CLOCK_A },
              close: { clockId: CLOCK_A, endEpochMs: NOW, offsetMinutes: 480 },
            }]
          : [{
              kind: "delete-clock",
              target: { kind: "clock", id: CLOCK_A },
              confirmation: {
                firstActivationEpochMs: NOW - 100,
                secondActivationEpochMs: NOW,
                firstTargetKey: CLOCK_A,
                secondTargetKey: CLOCK_A,
              },
            }],
      }],
      expectedRunningClockIds: [CLOCK_A],
      settingsVersion: CONTEXT.settingsVersion,
      zoneId: CONTEXT.zoneId,
    });
    const fromOffset = source.indexOf(running);
    const parsed = parseClockText(running);
    assert.equal(parsed.kind, "record");
    const clock = createClockExpectation({
      target: { kind: "clock", id: CLOCK_A },
      path: PATH,
      sourceText: source,
      clock: { path: PATH, fromOffset, toOffset: fromOffset + running.length, text: running, parsed },
    });
    const expectation = createMutationExpectation({
      intentId: plan.intentId,
      action: plan.action,
      planItems: [],
      clocks: [clock],
      expectedRunningClockIds: [CLOCK_A],
      settingsVersion: CONTEXT.settingsVersion,
      zoneId: CONTEXT.zoneId,
      indexComplete: true,
      time: {
        wallEpochMs: CONTEXT.wallEpochMs,
        monotonicMs: CONTEXT.monotonicMs,
        maximumDriftMs: 1_000,
        maximumQueueDelayMs: 1_000,
        discontinuity: false,
      },
      previewToken: plan.previewToken,
    });
    const writer = new WorkspaceCommitter(access, { readContext: () => CONTEXT });
    const receipt = await writer.commit(plan, expectation);
    assert.equal(receipt.outcome, "applied", `${action}: ${JSON.stringify(receipt)}`);
    assert.equal(receipt.sources[0]?.path, PATH);
    assert.equal(
      await access.readText(PATH),
      action === "clock-out"
        ? source.replace(running, formatCanonicalClosedClock(NOW - 60_000, 480, NOW, 480, CLOCK_A))
        : "# Orphan recovery\n",
    );
    writer.dispose();
  }
});

test("unique canonical orphan CLOCK recovery relocates by exact ID after a file rename", async () => {
  const renamedPath = "Archive/Renamed-Orphan.md";
  const running = formatCanonicalRunningClock(NOW - 60_000, 480, CLOCK_A);
  const source = `# Orphan recovery\n- ${running}\n`;
  const access = new MemoryAtomicTextAccess({ [PATH]: source });
  const plan = createMutationPlan({
    intentId: "orphan-clock-out-after-rename",
    action: "clock-out",
    stages: [{
      path: PATH,
      confirmationRequired: false,
      operations: [{
        kind: "clock-out",
        target: { kind: "clock", id: CLOCK_A },
        close: { clockId: CLOCK_A, endEpochMs: NOW, offsetMinutes: 480 },
      }],
    }],
    expectedRunningClockIds: [CLOCK_A],
    settingsVersion: CONTEXT.settingsVersion,
    zoneId: CONTEXT.zoneId,
  });
  const fromOffset = source.indexOf(running);
  const parsed = parseClockText(running);
  assert.equal(parsed.kind, "record");
  const expectation = createMutationExpectation({
    intentId: plan.intentId,
    action: plan.action,
    planItems: [],
    clocks: [createClockExpectation({
      target: { kind: "clock", id: CLOCK_A },
      path: PATH,
      sourceText: source,
      clock: { path: PATH, fromOffset, toOffset: fromOffset + running.length, text: running, parsed },
    })],
    expectedRunningClockIds: [CLOCK_A],
    settingsVersion: CONTEXT.settingsVersion,
    zoneId: CONTEXT.zoneId,
    indexComplete: true,
    time: {
      wallEpochMs: CONTEXT.wallEpochMs,
      monotonicMs: CONTEXT.monotonicMs,
      maximumDriftMs: 1_000,
      maximumQueueDelayMs: 1_000,
      discontinuity: false,
    },
    previewToken: plan.previewToken,
  });
  access.rename(PATH, renamedPath);

  const writer = new WorkspaceCommitter(access, { readContext: () => CONTEXT });
  const receipt = await writer.commit(plan, expectation);
  assert.equal(receipt.outcome, "applied", JSON.stringify(receipt));
  assert.equal(receipt.sources[0]?.path, renamedPath);
  assert.equal(await access.readText(PATH), undefined);
  assert.equal(
    await access.readText(renamedPath),
    source.replace(running, formatCanonicalClosedClock(NOW - 60_000, 480, NOW, 480, CLOCK_A)),
  );
  writer.dispose();
});

test("dispose blocks later commits and read-only recovery choice enters no host primitive", async () => {
  const source = `${OPEN}\n- [ ] B ^${PLAN_B}\n${CLOSE}\n`;
  const access = new MemoryAtomicTextAccess({ [PATH]: source });
  const mutation = clockInPlan();
  const expectation = await mutationExpectation(access, mutation, { planIds: [PLAN_B] });
  const writer = new WorkspaceCommitter(access, { readContext: () => CONTEXT });
  writer.dispose();
  const blocked = await writer.commit(mutation, expectation);
  assert.equal(blocked.outcome, "rejected");
  assert.equal(blocked.result?.code, "action-no-longer-applicable");
  assert.equal(access.transactionCounts.size, 0);

  const noWritePlan = createMutationPlan({
    intentId: "use-system-time",
    action: "use-system-time",
    stages: [],
    expectedRunningClockIds: [],
    settingsVersion: CONTEXT.settingsVersion,
    zoneId: CONTEXT.zoneId,
  });
  const noWriteExpectation = await mutationExpectation(access, noWritePlan, {});
  const recoveryWriter = new WorkspaceCommitter(access, { readContext: () => CONTEXT });
  const noWrite = await recoveryWriter.commit(noWritePlan, noWriteExpectation);
  assert.equal(noWrite.outcome, "already-applied");
  assert.equal(noWrite.globalCheck.status, "not-required");
  assert.equal(access.transactionCounts.size, 0);
  recoveryWriter.dispose();
});

test("action-operation mismatch and non-shared switch instants are not admissible plans", () => {
  assert.throws(() => createMutationPlan({
    intentId: "smuggled-write",
    action: "initialize-plan",
    stages: [{
      path: PATH,
      confirmationRequired: false,
      operations: [{ kind: "clock-in", target: { kind: "plan-item", id: PLAN_B }, clock: { clockId: CLOCK_NEW, startEpochMs: NOW, offsetMinutes: 480 } }],
    }],
    expectedRunningClockIds: [],
    settingsVersion: CONTEXT.settingsVersion,
    zoneId: CONTEXT.zoneId,
  }), /cannot carry/);
  assert.throws(() => createMutationPlan({
    intentId: "split-instant",
    action: "switch-task",
    stages: [{
      path: PATH,
      confirmationRequired: false,
      operations: [
        { kind: "clock-out", target: { kind: "clock", id: CLOCK_A }, close: { clockId: CLOCK_A, endEpochMs: NOW, offsetMinutes: 480 } },
        { kind: "clock-in", target: { kind: "plan-item", id: PLAN_B }, clock: { clockId: CLOCK_NEW, startEpochMs: NOW + 1, offsetMinutes: 480 } },
      ],
    }],
    expectedRunningClockIds: [CLOCK_A],
    settingsVersion: CONTEXT.settingsVersion,
    zoneId: CONTEXT.zoneId,
    transitionEpochMs: NOW,
  }), /shared transition/);
});

test("preview-required mutations reject an unconfirmed plan before host entry", async () => {
  const source = "# Daily\n";
  const access = new MemoryAtomicTextAccess({ [PATH]: source });
  const unconfirmed = {
    intentId: "unconfirmed-initialize",
    action: "initialize-plan",
    stages: [{
      path: PATH,
      confirmationRequired: false,
      operations: [{
        kind: "initialize-plan",
        insertionOffset: source.length,
        lineEnding: "\n",
        expectedSource: source,
      }],
    }],
    expectedRunningClockIds: [],
    settingsVersion: CONTEXT.settingsVersion,
    zoneId: CONTEXT.zoneId,
    previewToken: `sha256:${"0".repeat(64)}`,
  } as const satisfies MutationPlan;
  const expectation = await mutationExpectation(access, unconfirmed, {});
  const writer = new WorkspaceCommitter(access, { readContext: () => CONTEXT });
  const receipt = await writer.commit(unconfirmed, expectation);
  assert.equal(receipt.outcome, "rejected");
  assert.equal(receipt.result?.code, "source-conflict");
  assert.equal(access.transactionCounts.size, 0);
  assert.equal(await access.readText(PATH), source);
  writer.dispose();
});

test("post-preview plan or expected-byte mutation is rejected before host entry", async () => {
  const source = `${OPEN}\n- [ ] B ^${PLAN_B}\n${CLOSE}\n`;
  const access = new MemoryAtomicTextAccess({ [PATH]: source });
  const plan = clockInPlan();
  const expectation = await mutationExpectation(access, plan, { planIds: [PLAN_B] });
  const operation = plan.stages[0]!.operations[0];
  assert.equal(operation.kind, "clock-in");
  const mutated = {
    ...plan,
    stages: [{
      ...plan.stages[0]!,
      operations: [{ ...operation, clock: { ...operation.clock, startEpochMs: NOW + 1 } }],
    }],
  } as MutationPlan;
  const writer = new WorkspaceCommitter(access, { readContext: () => CONTEXT });
  const receipt = await writer.commit(mutated, expectation);
  assert.equal(receipt.outcome, "rejected");
  assert.equal(access.transactionCounts.size, 0);
  assert.equal(await access.readText(PATH), source);

  const target = expectation.planItems[0]!;
  const mutatedExpectation = {
    ...expectation,
    planItems: [{ ...target, watchedText: `${target.watchedText} changed` }],
  } as typeof expectation;
  const expectedByteMutation = await writer.commit(plan, mutatedExpectation);
  assert.equal(expectedByteMutation.outcome, "rejected");
  assert.equal(access.transactionCounts.size, 0);
  assert.equal(await access.readText(PATH), source);
  writer.dispose();
});

test("unsafe intent IDs are rejected before host entry with a safe authoritative receipt", async () => {
  const source = `${OPEN}\n- [ ] B ^${PLAN_B}\n${CLOSE}\n`;
  const access = new MemoryAtomicTextAccess({ [PATH]: source });
  const valid = clockInPlan();
  const expectation = await mutationExpectation(access, valid, { planIds: [PLAN_B] });
  const unsafe = { ...valid, intentId: "unsafe\0intent" } as MutationPlan;
  const writer = new WorkspaceCommitter(access, { readContext: () => CONTEXT });
  const receipt = await writer.commit(unsafe, expectation);
  assert.equal(receipt.outcome, "rejected");
  assert.equal(receipt.intentId, "invalid-intent");
  assert.equal(access.transactionCounts.size, 0);
  assert.equal(await access.readText(PATH), source);
  writer.dispose();
});

test("callback-time context drift rejects before mutation bytes are applied", async () => {
  const source = `${OPEN}\n- [ ] B ^${PLAN_B}\n${CLOSE}\n`;
  const drifts = [
    ["settings", { ...CONTEXT, settingsVersion: CONTEXT.settingsVersion + 1 }],
    ["zone", { ...CONTEXT, zoneId: "UTC" }],
    ["wall", { ...CONTEXT, wallEpochMs: CONTEXT.wallEpochMs + 1_001 }],
    ["monotonic", { ...CONTEXT, monotonicMs: CONTEXT.monotonicMs + 1_001 }],
  ] as const;

  for (const [name, driftedContext] of drifts) {
    const access = new MemoryAtomicTextAccess({ [PATH]: source });
    const mutation = clockInPlan();
    const expectation = await mutationExpectation(access, mutation, { planIds: [PLAN_B] });
    let context = CONTEXT;
    const writer = new WorkspaceCommitter(access, { readContext: () => context });
    const gate = access.pauseBeforeCallback(PATH);
    const pending = writer.commit(mutation, expectation);
    await gate.entered;
    context = driftedContext;
    gate.release();

    const receipt = await pending;
    assert.equal(receipt.outcome, "conflict", name);
    assert.equal(receipt.result?.code, "clock-discontinuity", name);
    assert.equal(await access.readText(PATH), source, name);
    assert.equal(access.callbackCounts.get(PATH), 1, name);
    writer.dispose();
  }
});

test("a stale normal-action queue endpoint rejects before host entry", async () => {
  const source = `${OPEN}\n- [ ] B ^${PLAN_B}\n${CLOSE}\n`;
  const access = new MemoryAtomicTextAccess({ [PATH]: source });
  const mutation = clockInPlan();
  const expectation = await mutationExpectation(access, mutation, { planIds: [PLAN_B] });
  const staleContext = {
    ...CONTEXT,
    wallEpochMs: CONTEXT.wallEpochMs + expectation.time.maximumQueueDelayMs + 1,
    monotonicMs: CONTEXT.monotonicMs + expectation.time.maximumQueueDelayMs + 1,
  };
  const writer = new WorkspaceCommitter(access, { readContext: () => staleContext });

  const receipt = await writer.commit(mutation, expectation);
  assert.equal(receipt.outcome, "rejected");
  assert.equal(receipt.result?.code, "clock-discontinuity");
  assert.equal(access.transactionCounts.size, 0);
  assert.equal(await access.readText(PATH), source);
  writer.dispose();
});

test("change tracking remains bounded in behavior and counts rename oldPath races", async () => {
  const source = `${OPEN}\n- [ ] B ^${PLAN_B}\n${CLOSE}\n`;
  const busyAccess = new MemoryAtomicTextAccess({ [PATH]: source });
  const busyMutation = clockInPlan();
  const busyExpectation = await mutationExpectation(busyAccess, busyMutation, { planIds: [PLAN_B] });
  const busyWriter = new WorkspaceCommitter(busyAccess, { readContext: () => CONTEXT });
  for (let index = 0; index < 4_096; index += 1) {
    busyAccess.emitSyntheticChange({ kind: "cache", path: `Synthetic/${index}.md` });
  }
  busyAccess.raceBeforeCallback(PATH, (current) => {
    for (let index = 0; index < 4_096; index += 1) {
      busyAccess.emitSyntheticChange({ kind: "editor", path: PATH });
    }
    return current;
  });

  const applied = await busyWriter.commit(busyMutation, busyExpectation);
  assert.equal(applied.outcome, "applied");
  assert.ok((await busyAccess.readText(PATH))?.includes(CLOCK_NEW));
  busyWriter.dispose();

  const renameAccess = new MemoryAtomicTextAccess({ [PATH]: source });
  const renameMutation = clockInPlan();
  const renameExpectation = await mutationExpectation(renameAccess, renameMutation, { planIds: [PLAN_B] });
  const renameWriter = new WorkspaceCommitter(renameAccess, { readContext: () => CONTEXT });
  renameAccess.raceBeforeCallback(PATH, (current) => {
    renameAccess.emitSyntheticChange({
      kind: "rename",
      path: PATH,
      oldPath: "Daily/Renamed-Elsewhere.md",
    });
    return current;
  });

  const rejected = await renameWriter.commit(renameMutation, renameExpectation);
  assert.equal(rejected.outcome, "conflict");
  assert.equal(rejected.result?.code, "source-conflict");
  assert.equal(await renameAccess.readText(PATH), source);
  renameWriter.dispose();
});
