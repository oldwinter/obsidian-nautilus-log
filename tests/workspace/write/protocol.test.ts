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
  acknowledgeMutationPreview,
  createClockExpectation,
  createMutationExpectation,
  revalidateClockExpectation,
} from "../../../src/workspace/expectation.ts";
import { WorkspaceIndex } from "../../../src/workspace/identity-index.ts";
import { readLogbook } from "../../../src/workspace/logbook-reader.ts";
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
  PLAN_NEW,
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

function orphanClockExpectation(
  plan: MutationPlan,
  path: string,
  source: string,
  clockText: string,
  discontinuity = false,
) {
  const fromOffset = source.indexOf(clockText);
  const parsed = parseClockText(clockText);
  assert.equal(parsed.kind, "record");
  return createMutationExpectation({
    intentId: plan.intentId,
    action: plan.action,
    planItems: [],
    clocks: [createClockExpectation({
      target: { kind: "clock", id: CLOCK_A },
      path,
      sourceText: source,
      clock: {
        path,
        fromOffset,
        toOffset: fromOffset + clockText.length,
        text: clockText,
        parsed,
      },
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
      discontinuity,
    },
    previewToken: plan.previewToken,
  });
}

async function orphanClockIdentityRepairExpectation(
  access: MemoryAtomicTextAccess,
  plan: MutationPlan,
  path: string,
  source: string,
  clockText: string,
  expectedRunningClockIds: readonly string[] = [],
) {
  const fromOffset = source.indexOf(clockText);
  const parsed = parseClockText(clockText);
  assert.notEqual(parsed.kind, "not-clock");
  const clock = createClockExpectation({
    target: { kind: "clock", id: CLOCK_A },
    path,
    sourceText: source,
    clock: {
      path,
      fromOffset,
      toOffset: fromOffset + clockText.length,
      text: clockText,
      parsed,
    },
  });
  const index = new WorkspaceIndex(access);
  const snapshot = await index.rebuild();
  assert.equal(snapshot.complete, true);
  const collision = index.identity(CLOCK_A);
  assert.equal(collision.kind, "collision");
  if (collision.kind !== "collision") throw new Error("fixture CLOCK identity must collide");
  index.dispose();
  return acknowledgeMutationPreview(plan, createMutationExpectation({
    intentId: plan.intentId,
    action: plan.action,
    planItems: [],
    clocks: [clock],
    expectedRunningClockIds,
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
    selectedRepair: {
      id: CLOCK_A,
      locations: collision.locations,
      selectedSpan: { path, fromOffset, toOffset: fromOffset + clockText.length },
    },
  }));
}

type ExactOrphanRecoveryAction = "delete-clock" | "clock-out" | "repair-clock-identity";

function exactOrphanRecoveryPlan(
  action: ExactOrphanRecoveryAction,
  path: string,
  intentId: string,
) {
  return createMutationPlan({
    intentId,
    action,
    stages: [{
      path,
      confirmationRequired: action === "repair-clock-identity",
      operations: action === "delete-clock"
        ? [{
            kind: "delete-clock",
            target: { kind: "clock", id: CLOCK_A },
            confirmation: {
              firstActivationEpochMs: NOW - 100,
              secondActivationEpochMs: NOW,
              firstTargetKey: CLOCK_A,
              secondTargetKey: CLOCK_A,
            },
          }]
        : action === "repair-clock-identity"
          ? [{
              kind: "repair-clock-identity",
              target: { kind: "clock", id: CLOCK_A },
              newId: CLOCK_NEW,
            }]
          : [{
              kind: "clock-out",
              target: { kind: "clock", id: CLOCK_A },
              close: { clockId: CLOCK_A, endEpochMs: NOW, offsetMinutes: 480 },
            }],
    }],
    expectedRunningClockIds: [CLOCK_A],
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
  assert.deepEqual(parsedSnapshot.running, []);
  assert.equal(parsedIndex.safetySnapshot.running.length, 1);
  const parsedClock = parsedIndex.safetySnapshot.running[0]!;
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
  const parsedIndex = new WorkspaceIndex(access);
  const parsedSnapshot = await parsedIndex.rebuild();
  assert.deepEqual(parsedSnapshot.potentialRunning, []);
  assert.equal(parsedIndex.safetySnapshot.potentialRunning.length, 1);
  parsedIndex.dispose();
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

test("colliding owner ID cannot hide an ID-less legacy running CLOCK from cross-file Clock In", async () => {
  const factPath = "Daily/A-Colliding-Legacy.md";
  const duplicatePath = "Daily/Z-Colliding-Legacy-Duplicate.md";
  const targetPath = "Daily/Colliding-Legacy-Target.md";
  const legacyText = "CLOCK: [2026-08-28 08:10]";
  const factSource = `${OPEN}\n- [ ] Timed owner d30m ^${PLAN_A}\n  - LOGBOOK::\n    - ${legacyText}\n${CLOSE}\n`;
  const duplicateSource = `${OPEN}\n- [ ] Duplicate owner d30m ^${PLAN_A}\n${CLOSE}\n`;
  const targetSource = `${OPEN}\n- [ ] Unrelated target d30m ^${PLAN_B}\n${CLOSE}\n`;
  const access = new MemoryAtomicTextAccess({
    [factPath]: factSource,
    [duplicatePath]: duplicateSource,
    [targetPath]: targetSource,
  });
  const legacyStart = NOW - 60_000;
  const resolveLocalTime = () => ({ kind: "unique" as const, epochMs: legacyStart });
  const parsedClock = readLogbook(factSource, {
    path: factPath,
    itemFromOffset: factSource.indexOf("- [ ]"),
    itemToOffset: factSource.indexOf(CLOSE),
    ownerId: PLAN_A,
  }, { resolveLocalTime }).clocks[0]!;
  const runningKey = legacyRunningClockKey(parsedClock.path, parsedClock.fromOffset, parsedClock.text);
  const mutation = clockInPlanAt(targetPath, "colliding-owner-idless-legacy", [runningKey]);
  const expectation = await mutationExpectation(access, mutation, {
    planIds: [PLAN_B],
    expectedRunningClockIds: [runningKey],
  });
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
  assert.equal(receipt.globalCheck.runningClockIds[0]?.includes(parsedClock.text), false);
  assert.equal(access.transactionCounts.size, 0);
  assert.equal(await access.readText(factPath), factSource);
  assert.equal(await access.readText(duplicatePath), duplicateSource);
  assert.equal(await access.readText(targetPath), targetSource);
  writer.dispose();
});

test("colliding owner ID cannot hide a malformed potential-running CLOCK from cross-file Clock In", async () => {
  const factPath = "Daily/A-Colliding-Potential.md";
  const duplicatePath = "Daily/Z-Colliding-Potential-Duplicate.md";
  const targetPath = "Daily/Colliding-Potential-Target.md";
  const factSource = `${OPEN}\n- [ ] Timed owner d30m ^${PLAN_A}\n  - LOGBOOK::\n    - CLOCK: [broken]\n${CLOSE}\n`;
  const duplicateSource = `${OPEN}\n- [ ] Duplicate owner d30m ^${PLAN_A}\n${CLOSE}\n`;
  const targetSource = `${OPEN}\n- [ ] Unrelated target d30m ^${PLAN_B}\n${CLOSE}\n`;
  const access = new MemoryAtomicTextAccess({
    [factPath]: factSource,
    [duplicatePath]: duplicateSource,
    [targetPath]: targetSource,
  });
  const mutation = clockInPlanAt(targetPath, "colliding-owner-potential");
  const expectation = await mutationExpectation(access, mutation, { planIds: [PLAN_B] });
  const writer = new WorkspaceCommitter(access, { readContext: () => CONTEXT });

  const receipt = await writer.commit(mutation, expectation);

  assert.equal(receipt.outcome, "conflict");
  assert.equal(receipt.result?.code, "potential-running-clock");
  assert.equal(receipt.globalCheck.status, "violated");
  assert.equal(access.transactionCounts.size, 0);
  assert.equal(await access.readText(factPath), factSource);
  assert.equal(await access.readText(duplicatePath), duplicateSource);
  assert.equal(await access.readText(targetPath), targetSource);
  writer.dispose();
});

test("closed history under colliding owners does not consume the write-safety CLOCK limit", async () => {
  const historyPath = "Daily/Colliding-Closed-History.md";
  const duplicatePath = "Daily/Colliding-Closed-Duplicate.md";
  const targetPath = "Daily/Closed-History-Target.md";
  const canonicalClosed = formatCanonicalClosedClock(NOW - 120_000, 480, NOW - 60_000, 480, CLOCK_A);
  const canonicalMalformedClosed = `CLOCK: [2026-08-28 Fri 09:00:00.000 +08:00]--[2026-08-28 Fri 08:45:00.000 +08:00] => 0:00 ^${CLOCK_B}`;
  const historySource = `${OPEN}\n- [ ] History owner d30m ^${PLAN_A}\n  - LOGBOOK::\n    - CLOCK: [2026-08-28 08:00] -- [2026-08-28 08:30] => 0:30\n    - CLOCK: [2026-08-28 09:00] -- [2026-08-28 08:45]\n    - ${canonicalClosed}\n    - ${canonicalMalformedClosed}\n${CLOSE}\n`;
  const duplicateSource = `${OPEN}\n- [ ] Duplicate owner d30m ^${PLAN_A}\n${CLOSE}\n`;
  const targetSource = `${OPEN}\n- [ ] Unrelated target d30% ^${PLAN_B}\n${CLOSE}\n`;
  const access = new MemoryAtomicTextAccess({
    [historyPath]: historySource,
    [duplicatePath]: duplicateSource,
    [targetPath]: targetSource,
  });
  const resolveLocalTime = (parts: {
    readonly year: number;
    readonly month: number;
    readonly day: number;
    readonly hour: number;
    readonly minute: number;
  }) => ({
    kind: "unique" as const,
    epochMs: Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute),
  });
  const mutation = createMutationPlan({
    intentId: "colliding-closed-history-limit",
    action: "advance-progress",
    stages: [{
      path: targetPath,
      confirmationRequired: false,
      operations: [{
        kind: "advance-progress",
        target: { kind: "plan-item", id: PLAN_B },
        logicalMinute: 570,
      }],
    }],
    expectedRunningClockIds: [],
    settingsVersion: CONTEXT.settingsVersion,
    zoneId: CONTEXT.zoneId,
  });
  const expectation = await mutationExpectation(access, mutation, { planIds: [PLAN_B] });
  const sharedIndex = new WorkspaceIndex(access, {
    limits: { maxMarkdownFiles: 3, maxMarkdownBytes: 10_000, maxBlockIds: 10, maxClockRecords: 0 },
    clockParsing: { resolveLocalTime },
  });
  const publicSnapshot = await sharedIndex.rebuild();
  assert.equal(publicSnapshot.complete, false);
  assert.equal(publicSnapshot.reason, "clock-record-limit");
  assert.equal(sharedIndex.safetySnapshot.complete, true);
  assert.deepEqual(sharedIndex.safetySnapshot.running, []);
  assert.deepEqual(sharedIndex.safetySnapshot.potentialRunning, []);
  const writer = new WorkspaceCommitter(access, {
    readContext: () => CONTEXT,
    workspaceIndex: sharedIndex,
    logbook: { resolveLocalTime },
  });

  const receipt = await writer.commit(mutation, expectation);

  assert.equal(receipt.outcome, "applied", JSON.stringify(receipt));
  assert.equal(access.transactionCounts.get(targetPath), 1);
  assert.equal(access.transactionCounts.has(historyPath), false);
  assert.equal(await access.readText(historyPath), historySource);
  assert.equal(await access.readText(duplicatePath), duplicateSource);
  assert.equal((await access.readText(targetPath))?.includes("d40%"), true);
  writer.dispose();
  assert.equal(sharedIndex.safetySnapshot.complete, true);
  sharedIndex.dispose();
});

test("selected colliding owner repair preserves an ID-less running CLOCK under either occurrence", async () => {
  const legacyText = "CLOCK: [2026-08-28 08:10]";
  const legacyStart = NOW - 60_000;
  const resolveLocalTime = () => ({ kind: "unique" as const, epochMs: legacyStart });
  for (const selectedHasClock of [true, false]) {
    const selectedPath = `Daily/A-Selected-${selectedHasClock ? "Clock" : "No-Clock"}.md`;
    const unselectedPath = `Daily/Z-Unselected-${selectedHasClock ? "No-Clock" : "Clock"}.md`;
    const ownerWithClock = `${OPEN}\n- [ ] Timed owner d30m ^${PLAN_A}\n  - LOGBOOK::\n    - ${legacyText}\n${CLOSE}\n`;
    const ownerWithoutClock = `${OPEN}\n- [ ] Clock-free owner d30m ^${PLAN_A}\n${CLOSE}\n`;
    const selectedSource = selectedHasClock ? ownerWithClock : ownerWithoutClock;
    const unselectedSource = selectedHasClock ? ownerWithoutClock : ownerWithClock;
    const clockPath = selectedHasClock ? selectedPath : unselectedPath;
    const clockSource = selectedHasClock ? selectedSource : unselectedSource;
    const access = new MemoryAtomicTextAccess({
      [selectedPath]: selectedSource,
      [unselectedPath]: unselectedSource,
    });
    const parsedClock = readLogbook(clockSource, {
      path: clockPath,
      itemFromOffset: clockSource.indexOf("- [ ]"),
      itemToOffset: clockSource.indexOf(CLOSE),
      ownerId: PLAN_A,
    }, { resolveLocalTime }).clocks[0]!;
    const runningKey = legacyRunningClockKey(parsedClock.path, parsedClock.fromOffset, parsedClock.text);
    const repair = createMutationPlan({
      intentId: `selected-colliding-owner-${selectedHasClock ? "clock" : "clock-free"}`,
      action: "repair-plan-item-identity",
      stages: [{
        path: selectedPath,
        confirmationRequired: true,
        operations: [{
          kind: "repair-plan-item-identity",
          target: { kind: "plan-item", id: PLAN_A },
          newId: PLAN_NEW,
        }],
      }],
      expectedRunningClockIds: [runningKey],
      settingsVersion: CONTEXT.settingsVersion,
      zoneId: CONTEXT.zoneId,
    });
    const expectation = await mutationExpectation(access, repair, {
      planIds: [PLAN_A],
      expectedRunningClockIds: [runningKey],
    });
    assert.equal(expectation.selectedRepair?.selectedSpan.path, selectedPath);
    const writer = new WorkspaceCommitter(access, {
      readContext: () => CONTEXT,
      index: { clockParsing: { resolveLocalTime } },
      logbook: { resolveLocalTime },
    });

    const receipt = await writer.commit(repair, expectation);

    assert.equal(receipt.outcome, "applied", JSON.stringify(receipt));
    assert.equal(access.transactionCounts.get(selectedPath), 1);
    assert.equal(access.transactionCounts.has(unselectedPath), false);
    assert.equal(
      await access.readText(selectedPath),
      selectedSource.replace(`^${PLAN_A}`, `^${PLAN_NEW}`),
    );
    assert.equal(await access.readText(unselectedPath), unselectedSource);
    assert.equal(receipt.globalCheck.status, "confirmed");
    assert.equal(receipt.globalCheck.runningClockIds.length, 1);
    assert.ok(receipt.globalCheck.runningClockIds[0]?.startsWith(
      `legacy:${parsedClock.path}:${parsedClock.fromOffset}:`,
    ));
    assert.equal(receipt.globalCheck.runningClockIds[0]?.includes(parsedClock.text), false);
    writer.dispose();
  }
});

test("mixed duplicate CLOCK identity repair updates the running set only when the selected CLOCK is running", async () => {
  const closedClock = formatCanonicalClosedClock(NOW - 120_000, 480, NOW - 60_000, 480, CLOCK_A);
  const runningClock = formatCanonicalRunningClock(NOW - 120_000, 480, CLOCK_A);

  for (const selectedState of ["closed", "running"] as const) {
    const selectedPath = `Daily/A-Selected-${selectedState}-Clock.md`;
    const unselectedPath = `Daily/Z-Unselected-${selectedState}-Clock.md`;
    const selectedClock = selectedState === "closed" ? closedClock : runningClock;
    const unselectedClock = selectedState === "closed" ? runningClock : closedClock;
    const selectedSource = `${OPEN}\n- [ ] Selected owner d30m ^${PLAN_A}\n  - LOGBOOK::\n    - ${selectedClock}\n${CLOSE}\n`;
    const unselectedSource = `${OPEN}\n- [ ] Unselected owner d30m ^${PLAN_B}\n  - LOGBOOK::\n    - ${unselectedClock}\n${CLOSE}\n`;
    const access = new MemoryAtomicTextAccess({
      [selectedPath]: selectedSource,
      [unselectedPath]: unselectedSource,
    });
    const repair = createMutationPlan({
      intentId: `mixed-duplicate-clock-${selectedState}`,
      action: "repair-clock-identity",
      stages: [{
        path: selectedPath,
        confirmationRequired: true,
        operations: [{
          kind: "repair-clock-identity",
          target: { kind: "clock", id: CLOCK_A },
          newId: CLOCK_NEW,
        }],
      }],
      expectedRunningClockIds: [CLOCK_A],
      settingsVersion: CONTEXT.settingsVersion,
      zoneId: CONTEXT.zoneId,
    });
    const expectation = await mutationExpectation(access, repair, {
      clockIds: [CLOCK_A],
      expectedRunningClockIds: [CLOCK_A],
    });
    assert.equal(expectation.selectedRepair?.selectedSpan.path, selectedPath);
    assert.equal(expectation.clocks[0]?.state, selectedState);
    const writer = new WorkspaceCommitter(access, { readContext: () => CONTEXT });

    const receipt = await writer.commit(repair, expectation);

    assert.equal(receipt.outcome, "applied", `${selectedState}: ${JSON.stringify(receipt)}`);
    assert.equal(receipt.confirmation, "confirmed", selectedState);
    assert.deepEqual(receipt.globalCheck, {
      status: "confirmed",
      runningClockIds: [selectedState === "running" ? CLOCK_NEW : CLOCK_A],
    }, selectedState);
    assert.equal(access.transactionCounts.get(selectedPath), 1, selectedState);
    assert.equal(access.transactionCounts.has(unselectedPath), false, selectedState);
    assert.equal(
      await access.readText(selectedPath),
      selectedSource.replace(`^${CLOCK_A}`, `^${CLOCK_NEW}`),
      selectedState,
    );
    assert.equal(await access.readText(unselectedPath), unselectedSource, selectedState);

    const retry = await writer.commit(repair, expectation);
    assert.equal(retry.outcome, "already-applied", `${selectedState}: ${JSON.stringify(retry)}`);
    assert.equal(retry.confirmation, "confirmed", selectedState);
    assert.deepEqual(retry.globalCheck, receipt.globalCheck, selectedState);
    assert.equal(access.transactionCounts.get(selectedPath), 1, selectedState);
    assert.equal(await access.readText(unselectedPath), unselectedSource, selectedState);
    writer.dispose();
  }
});

test("selected invalid-owner running CLOCK identity repair remains explicitly degraded after apply and reload", async () => {
  const selectedPath = "Daily/A-Selected-Done-Owner-Running.md";
  const unselectedPath = "Daily/Z-Unselected-Closed-Duplicate.md";
  const runningClock = formatCanonicalRunningClock(NOW - 120_000, 480, CLOCK_A);
  const closedClock = formatCanonicalClosedClock(NOW - 180_000, 480, NOW - 60_000, 480, CLOCK_A);
  const selectedSource = `${OPEN}\n- [x] Selected done owner d30m ^${PLAN_A}\n  - LOGBOOK::\n    - ${runningClock}\n${CLOSE}\n`;
  const repairedSelectedSource = selectedSource.replace(`^${CLOCK_A}`, `^${CLOCK_NEW}`);
  const unselectedSource = `${OPEN}\n- [ ] Unselected owner d30m ^${PLAN_B}\n  - LOGBOOK::\n    - ${closedClock}\n${CLOSE}\n`;
  const access = new MemoryAtomicTextAccess({
    [selectedPath]: selectedSource,
    [unselectedPath]: unselectedSource,
  });
  const repair = createMutationPlan({
    intentId: "selected-invalid-owner-running-clock",
    action: "repair-clock-identity",
    stages: [{
      path: selectedPath,
      confirmationRequired: true,
      operations: [{
        kind: "repair-clock-identity",
        target: { kind: "clock", id: CLOCK_A },
        newId: CLOCK_NEW,
      }],
    }],
    expectedRunningClockIds: [CLOCK_A],
    settingsVersion: CONTEXT.settingsVersion,
    zoneId: CONTEXT.zoneId,
  });
  const expectation = await mutationExpectation(access, repair, {
    clockIds: [CLOCK_A],
    expectedRunningClockIds: [CLOCK_A],
  });
  assert.equal(expectation.selectedRepair?.selectedSpan.path, selectedPath);
  assert.equal(expectation.clocks[0]?.state, "running");
  const writer = new WorkspaceCommitter(access, { readContext: () => CONTEXT });

  const applied = await writer.commit(repair, expectation);

  assert.equal(applied.outcome, "applied", JSON.stringify(applied));
  assert.equal(applied.confirmation, "confirmed");
  assert.deepEqual(applied.globalCheck, { status: "violated", runningClockIds: [CLOCK_NEW] });
  assert.equal(writer.blocked, false);
  assert.equal(access.transactionCounts.get(selectedPath), 1);
  assert.equal(access.transactionCounts.has(unselectedPath), false);
  assert.equal(await access.readText(selectedPath), repairedSelectedSource);
  assert.equal(await access.readText(unselectedPath), unselectedSource);
  writer.dispose();

  const transactionsBeforeRetry = [...access.transactionCounts.entries()];
  const retryWriter = new WorkspaceCommitter(access, { readContext: () => CONTEXT });
  const retry = await retryWriter.commit(repair, expectation);

  assert.equal(retry.outcome, "already-applied", JSON.stringify(retry));
  assert.equal(retry.confirmation, "confirmed");
  assert.deepEqual(retry.globalCheck, { status: "violated", runningClockIds: [CLOCK_NEW] });
  assert.equal(retryWriter.blocked, false);
  assert.deepEqual([...access.transactionCounts.entries()], transactionsBeforeRetry);
  assert.equal(await access.readText(selectedPath), repairedSelectedSource);
  assert.equal(await access.readText(unselectedPath), unselectedSource);
  retryWriter.dispose();
});

test("selected malformed duplicate CLOCK identity repair changes only its terminal ID and stays degraded on retry", async () => {
  const selectedPath = "Daily/A-Selected-Malformed-Clock.md";
  const unselectedPath = "Daily/Z-Unselected-Closed-Duplicate.md";
  const malformedClock = `CLOCK: [broken] ^${CLOCK_A}`;
  const closedClock = formatCanonicalClosedClock(NOW - 180_000, 480, NOW - 60_000, 480, CLOCK_A);
  const selectedSource = `${OPEN}\n- [ ] Selected owner d30m ^${PLAN_A}\n  - LOGBOOK::\n    - ${malformedClock}\n${CLOSE}\n`;
  const repairedSelectedSource = selectedSource.replace(`^${CLOCK_A}`, `^${CLOCK_NEW}`);
  const unselectedSource = `${OPEN}\n- [ ] Unselected owner d30m ^${PLAN_B}\n  - LOGBOOK::\n    - ${closedClock}\n${CLOSE}\n`;
  const access = new MemoryAtomicTextAccess({
    [selectedPath]: selectedSource,
    [unselectedPath]: unselectedSource,
  });
  const repair = createMutationPlan({
    intentId: "selected-malformed-duplicate-clock",
    action: "repair-clock-identity",
    stages: [{
      path: selectedPath,
      confirmationRequired: true,
      operations: [{
        kind: "repair-clock-identity",
        target: { kind: "clock", id: CLOCK_A },
        newId: CLOCK_NEW,
      }],
    }],
    expectedRunningClockIds: [],
    settingsVersion: CONTEXT.settingsVersion,
    zoneId: CONTEXT.zoneId,
  });
  const expectation = await mutationExpectation(access, repair, {
    clockIds: [CLOCK_A],
    expectedRunningClockIds: [],
  });
  assert.equal(expectation.selectedRepair?.selectedSpan.path, selectedPath);
  assert.equal(expectation.clocks[0]?.state, "potential-running");
  const writer = new WorkspaceCommitter(access, { readContext: () => CONTEXT });

  const applied = await writer.commit(repair, expectation);

  assert.equal(applied.outcome, "applied", JSON.stringify(applied));
  assert.equal(applied.confirmation, "confirmed");
  assert.deepEqual(applied.globalCheck, { status: "violated", runningClockIds: [] });
  assert.equal(writer.blocked, false);
  assert.equal(access.transactionCounts.get(selectedPath), 1);
  assert.equal(access.transactionCounts.has(unselectedPath), false);
  assert.equal(await access.readText(selectedPath), repairedSelectedSource);
  assert.equal(await access.readText(unselectedPath), unselectedSource);
  writer.dispose();

  const finalIndex = new WorkspaceIndex(access);
  const finalSnapshot = await finalIndex.rebuild();
  assert.equal(finalSnapshot.complete, true);
  assert.equal(finalSnapshot.potentialRunning.length, 1);
  assert.equal(finalSnapshot.potentialRunning[0]?.path, selectedPath);
  assert.equal(finalIndex.safetyIdentity(CLOCK_NEW).kind, "unique");
  assert.equal(finalIndex.safetyIdentity(CLOCK_A).kind, "unique");
  finalIndex.dispose();

  const transactionsBeforeRetry = [...access.transactionCounts.entries()];
  const retryWriter = new WorkspaceCommitter(access, { readContext: () => CONTEXT });
  const retry = await retryWriter.commit(repair, expectation);

  assert.equal(retry.outcome, "already-applied", JSON.stringify(retry));
  assert.equal(retry.confirmation, "confirmed");
  assert.deepEqual(retry.globalCheck, { status: "violated", runningClockIds: [] });
  assert.equal(retryWriter.blocked, false);
  assert.deepEqual([...access.transactionCounts.entries()], transactionsBeforeRetry);
  assert.equal(await access.readText(selectedPath), repairedSelectedSource);
  assert.equal(await access.readText(unselectedPath), unselectedSource);
  retryWriter.dispose();
});

test("selected malformed closed duplicate CLOCK identity repair changes only its terminal ID and stays degraded on retry", async () => {
  const selectedPath = "Daily/A-Selected-Malformed-Closed-Clock.md";
  const unselectedPath = "Daily/Z-Unselected-Valid-Closed-Duplicate.md";
  const closedClock = formatCanonicalClosedClock(NOW - 180_000, 480, NOW - 60_000, 480, CLOCK_A);
  const malformedClosedClock = closedClock.replace(
    /^(CLOCK: \[\d{4}-\d{2}-\d{2} )([A-Z][a-z]{2})( )/,
    (_match, prefix: string, weekday: string, suffix: string) =>
      `${prefix}${weekday === "Mon" ? "Tue" : "Mon"}${suffix}`,
  );
  const malformed = parseClockText(malformedClosedClock);
  assert.equal(malformed.kind, "malformed");
  assert.equal(malformed.kind === "malformed" && malformed.potentialRunning, false);
  assert.deepEqual(malformed.kind === "malformed" ? malformed.diagnostics.map(({ code }) => code) : [], [
    "weekday-mismatch",
  ]);
  const selectedSource = `${OPEN}\n- [ ] Selected owner d30m ^${PLAN_A}\n  - LOGBOOK::\n    - ${malformedClosedClock}\n${CLOSE}\n`;
  const repairedSelectedSource = selectedSource.replace(`^${CLOCK_A}`, `^${CLOCK_NEW}`);
  const unselectedSource = `${OPEN}\n- [ ] Unselected owner d30m ^${PLAN_B}\n  - LOGBOOK::\n    - ${closedClock}\n${CLOSE}\n`;
  const access = new MemoryAtomicTextAccess({
    [selectedPath]: selectedSource,
    [unselectedPath]: unselectedSource,
  });
  const repair = createMutationPlan({
    intentId: "selected-malformed-closed-duplicate-clock",
    action: "repair-clock-identity",
    stages: [{
      path: selectedPath,
      confirmationRequired: true,
      operations: [{
        kind: "repair-clock-identity",
        target: { kind: "clock", id: CLOCK_A },
        newId: CLOCK_NEW,
      }],
    }],
    expectedRunningClockIds: [],
    settingsVersion: CONTEXT.settingsVersion,
    zoneId: CONTEXT.zoneId,
  });
  const expectation = await mutationExpectation(access, repair, {
    clockIds: [CLOCK_A],
    expectedRunningClockIds: [],
  });
  assert.equal(expectation.selectedRepair?.selectedSpan.path, selectedPath);
  assert.equal(expectation.clocks[0]?.state, "malformed");
  const writer = new WorkspaceCommitter(access, { readContext: () => CONTEXT });

  const applied = await writer.commit(repair, expectation);

  assert.equal(applied.outcome, "applied", JSON.stringify(applied));
  assert.equal(applied.confirmation, "confirmed");
  assert.deepEqual(applied.globalCheck, { status: "violated", runningClockIds: [] });
  assert.equal(writer.blocked, false);
  assert.equal(access.transactionCounts.get(selectedPath), 1);
  assert.equal(access.transactionCounts.has(unselectedPath), false);
  assert.equal(await access.readText(selectedPath), repairedSelectedSource);
  assert.equal(await access.readText(unselectedPath), unselectedSource);
  writer.dispose();

  const finalIndex = new WorkspaceIndex(access);
  const finalSnapshot = await finalIndex.rebuild();
  assert.equal(finalSnapshot.complete, true);
  assert.deepEqual(finalSnapshot.running, []);
  assert.deepEqual(finalSnapshot.potentialRunning, []);
  assert.equal(finalIndex.safetyIdentity(CLOCK_NEW).kind, "unique");
  assert.equal(finalIndex.safetyIdentity(CLOCK_A).kind, "unique");
  finalIndex.dispose();

  const transactionsBeforeRetry = [...access.transactionCounts.entries()];
  const retryWriter = new WorkspaceCommitter(access, { readContext: () => CONTEXT });
  const retry = await retryWriter.commit(repair, expectation);

  assert.equal(retry.outcome, "already-applied", JSON.stringify(retry));
  assert.equal(retry.confirmation, "confirmed");
  assert.deepEqual(retry.globalCheck, { status: "violated", runningClockIds: [] });
  assert.equal(retryWriter.blocked, false);
  assert.deepEqual([...access.transactionCounts.entries()], transactionsBeforeRetry);
  assert.equal(await access.readText(selectedPath), repairedSelectedSource);
  assert.equal(await access.readText(unselectedPath), unselectedSource);
  retryWriter.dispose();
});

test("selected malformed closed orphan CLOCK identity repair is exact across quote containers and reload", async () => {
  const closedClock = formatCanonicalClosedClock(NOW - 180_000, 480, NOW - 60_000, 480, CLOCK_A);
  const malformedClosedClock = closedClock.replace(
    /^(CLOCK: \[\d{4}-\d{2}-\d{2} )([A-Z][a-z]{2})( )/,
    (_match, prefix: string, weekday: string, suffix: string) =>
      `${prefix}${weekday === "Mon" ? "Tue" : "Mon"}${suffix}`,
  );
  const malformed = parseClockText(malformedClosedClock);
  assert.equal(malformed.kind, "malformed");
  assert.equal(malformed.kind === "malformed" && malformed.potentialRunning, false);
  assert.deepEqual(malformed.kind === "malformed" ? malformed.diagnostics.map(({ code }) => code) : [], [
    "weekday-mismatch",
  ]);

  for (const entry of [
    { name: "bare", prefix: "> ", eol: "\n" },
    { name: "nested-bare", prefix: "> > ", eol: "\n" },
    { name: "bare-crlf", prefix: "> ", eol: "\r\n" },
    { name: "bare-tab", prefix: ">\t", eol: "\n" },
  ] as const) {
    const selectedPath = `Daily/A-Selected-Malformed-Closed-Orphan-${entry.name}.md`;
    const unselectedPath = `Daily/Z-Unselected-Valid-Closed-Orphan-${entry.name}.md`;
    const selectedSource = `# Selected orphan${entry.eol}${entry.prefix}${malformedClosedClock}${entry.eol}`;
    const repairedSelectedSource = selectedSource.replace(`^${CLOCK_A}`, `^${CLOCK_NEW}`);
    const unselectedSource = `# Unselected orphan${entry.eol}- ${closedClock}${entry.eol}`;
    const access = new MemoryAtomicTextAccess({
      [selectedPath]: selectedSource,
      [unselectedPath]: unselectedSource,
    });
    const repair = createMutationPlan({
      intentId: `malformed-closed-orphan-${entry.name}`,
      action: "repair-clock-identity",
      stages: [{
        path: selectedPath,
        confirmationRequired: true,
        operations: [{
          kind: "repair-clock-identity",
          target: { kind: "clock", id: CLOCK_A },
          newId: CLOCK_NEW,
        }],
      }],
      expectedRunningClockIds: [],
      settingsVersion: CONTEXT.settingsVersion,
      zoneId: CONTEXT.zoneId,
    });
    const expectation = await orphanClockIdentityRepairExpectation(
      access,
      repair,
      selectedPath,
      selectedSource,
      malformedClosedClock,
    );
    assert.equal(expectation.clocks[0]?.state, "malformed", entry.name);
    const writer = new WorkspaceCommitter(access, { readContext: () => CONTEXT });

    const applied = await writer.commit(repair, expectation);

    assert.equal(applied.outcome, "applied", `${entry.name}: ${JSON.stringify(applied)}`);
    assert.equal(applied.confirmation, "confirmed", entry.name);
    assert.deepEqual(applied.globalCheck, { status: "violated", runningClockIds: [] }, entry.name);
    assert.equal(writer.blocked, false, entry.name);
    assert.equal(access.transactionCounts.get(selectedPath), 1, entry.name);
    assert.equal(access.transactionCounts.has(unselectedPath), false, entry.name);
    assert.equal(await access.readText(selectedPath), repairedSelectedSource, entry.name);
    assert.equal(await access.readText(unselectedPath), unselectedSource, entry.name);
    writer.dispose();

    const finalIndex = new WorkspaceIndex(access);
    const finalSnapshot = await finalIndex.rebuild();
    assert.equal(finalSnapshot.complete, true, entry.name);
    assert.deepEqual(finalSnapshot.running, [], entry.name);
    assert.deepEqual(finalSnapshot.potentialRunning, [], entry.name);
    assert.equal(finalIndex.safetyIdentity(CLOCK_NEW).kind, "unique", entry.name);
    assert.equal(finalIndex.safetyIdentity(CLOCK_A).kind, "unique", entry.name);
    finalIndex.dispose();

    const transactionsAfterApply = [...access.transactionCounts.entries()];
    const retryWriter = new WorkspaceCommitter(access, { readContext: () => CONTEXT });
    const retry = await retryWriter.commit(repair, expectation);
    assert.equal(retry.outcome, "already-applied", `${entry.name}: ${JSON.stringify(retry)}`);
    assert.deepEqual(retry.globalCheck, applied.globalCheck, entry.name);
    assert.deepEqual([...access.transactionCounts.entries()], transactionsAfterApply, entry.name);
    assert.equal(await access.readText(selectedPath), repairedSelectedSource, entry.name);
    assert.equal(await access.readText(unselectedPath), unselectedSource, entry.name);
    retryWriter.dispose();
  }
});

test("malformed closed orphan identity repair rejects attached lazy and narrative CLOCK text", async () => {
  const closedClock = formatCanonicalClosedClock(NOW - 180_000, 480, NOW - 60_000, 480, CLOCK_A);
  const malformedClosedClock = closedClock.replace(
    /^(CLOCK: \[\d{4}-\d{2}-\d{2} )([A-Z][a-z]{2})( )/,
    (_match, prefix: string, weekday: string, suffix: string) =>
      `${prefix}${weekday === "Mon" ? "Tue" : "Mon"}${suffix}`,
  );
  for (const entry of [
    {
      name: "attached",
      selectedSource: `# Selected orphan\n> ${malformedClosedClock}\n> attached continuation\n`,
    },
    {
      name: "lazy",
      selectedSource: `# Selected orphan\n> ${malformedClosedClock}\nlazy continuation\n`,
    },
    {
      name: "narrative",
      selectedSource: `# Selected orphan\n> Narrative ${malformedClosedClock}\n`,
    },
  ] as const) {
    const selectedPath = `Daily/A-Rejected-Malformed-Closed-Orphan-${entry.name}.md`;
    const unselectedPath = `Daily/Z-Unselected-Valid-Closed-Orphan-${entry.name}.md`;
    const unselectedSource = `# Unselected orphan\n- ${closedClock}\n`;
    const access = new MemoryAtomicTextAccess({
      [selectedPath]: entry.selectedSource,
      [unselectedPath]: unselectedSource,
    });
    const repair = createMutationPlan({
      intentId: `rejected-malformed-closed-orphan-${entry.name}`,
      action: "repair-clock-identity",
      stages: [{
        path: selectedPath,
        confirmationRequired: true,
        operations: [{
          kind: "repair-clock-identity",
          target: { kind: "clock", id: CLOCK_A },
          newId: CLOCK_NEW,
        }],
      }],
      expectedRunningClockIds: [],
      settingsVersion: CONTEXT.settingsVersion,
      zoneId: CONTEXT.zoneId,
    });
    const expectation = await orphanClockIdentityRepairExpectation(
      access,
      repair,
      selectedPath,
      entry.selectedSource,
      malformedClosedClock,
    );
    const writer = new WorkspaceCommitter(access, { readContext: () => CONTEXT });

    const rejected = await writer.commit(repair, expectation);

    assert.equal(rejected.outcome, "conflict", `${entry.name}: ${JSON.stringify(rejected)}`);
    assert.equal(rejected.confirmation, "confirmed-no-change", entry.name);
    assert.equal(rejected.result?.code, "source-conflict", entry.name);
    assert.deepEqual(rejected.globalCheck, { status: "violated", runningClockIds: [] }, entry.name);
    assert.equal(writer.blocked, false, entry.name);
    assert.equal(access.transactionCounts.size, 0, entry.name);
    assert.equal(await access.readText(selectedPath), entry.selectedSource, entry.name);
    assert.equal(await access.readText(unselectedPath), unselectedSource, entry.name);
    writer.dispose();
  }
});

test("malformed closed duplicate repair blocks after an unselected potential CLOCK appears post-write", async () => {
  const selectedPath = "Daily/A-Selected-Malformed-Closed-Potential-Race.md";
  const potentialPath = "Daily/M-Unselected-Malformed-Closed-Potential-Race.md";
  const duplicatePath = "Daily/Z-Unselected-Valid-Closed-Potential-Race.md";
  const closedClock = formatCanonicalClosedClock(NOW - 180_000, 480, NOW - 60_000, 480, CLOCK_A);
  const malformedClosedClock = closedClock.replace(
    /^(CLOCK: \[\d{4}-\d{2}-\d{2} )([A-Z][a-z]{2})( )/,
    (_match, prefix: string, weekday: string, suffix: string) =>
      `${prefix}${weekday === "Mon" ? "Tue" : "Mon"}${suffix}`,
  );
  const selectedSource = `${OPEN}\n- [ ] Selected owner d30m ^${PLAN_A}\n  - LOGBOOK::\n    - ${malformedClosedClock}\n${CLOSE}\n`;
  const repairedSelectedSource = selectedSource.replace(`^${CLOCK_A}`, `^${CLOCK_NEW}`);
  const initialPotentialSource = `${OPEN}\n- [ ] Potential owner d30m ^${PLAN_NEW}\n${CLOSE}\n`;
  const insertedPotentialSource = initialPotentialSource.replace(
    CLOSE,
    `  - LOGBOOK::\n    - CLOCK: [broken]\n${CLOSE}`,
  );
  const duplicateSource = `${OPEN}\n- [ ] Duplicate owner d30m ^${PLAN_B}\n  - LOGBOOK::\n    - ${closedClock}\n${CLOSE}\n`;
  const access = new MemoryAtomicTextAccess({
    [selectedPath]: selectedSource,
    [potentialPath]: initialPotentialSource,
    [duplicatePath]: duplicateSource,
  });
  const repair = createMutationPlan({
    intentId: "malformed-closed-duplicate-unselected-potential-race",
    action: "repair-clock-identity",
    stages: [{
      path: selectedPath,
      confirmationRequired: true,
      operations: [{
        kind: "repair-clock-identity",
        target: { kind: "clock", id: CLOCK_A },
        newId: CLOCK_NEW,
      }],
    }],
    expectedRunningClockIds: [],
    settingsVersion: CONTEXT.settingsVersion,
    zoneId: CONTEXT.zoneId,
  });
  const expectation = await mutationExpectation(access, repair, {
    clockIds: [CLOCK_A],
    expectedRunningClockIds: [],
  });
  assert.equal(expectation.clocks[0]?.state, "malformed");
  assert.equal(expectation.selectedRepair?.selectedSpan.path, selectedPath);
  access.raceAfterTransformReads(1, () => access.modify(potentialPath, insertedPotentialSource));
  const writer = new WorkspaceCommitter(access, { readContext: () => CONTEXT });

  const receipt = await writer.commit(repair, expectation);

  assert.equal(receipt.outcome, "invariant-broken", JSON.stringify(receipt));
  assert.equal(receipt.confirmation, "invariant-broken");
  assert.equal(receipt.result?.code, "write-invariant-broken");
  assert.equal(receipt.globalCheck.status, "violated");
  assert.equal(writer.blocked, true);
  assert.equal(access.transactionCounts.get(selectedPath), 1);
  assert.equal(access.transactionCounts.has(potentialPath), false);
  assert.equal(access.transactionCounts.has(duplicatePath), false);
  assert.equal(await access.readText(selectedPath), repairedSelectedSource);
  assert.equal(await access.readText(potentialPath), insertedPotentialSource);
  assert.equal(await access.readText(duplicatePath), duplicateSource);
  writer.dispose();
});

test("selected invalid-owner identity repair cannot absorb a new unselected potential CLOCK", async () => {
  const selectedPath = "Daily/A-Selected-Invalid-Owner-Potential-Race.md";
  const potentialPath = "Daily/M-Unselected-Potential-Race.md";
  const duplicatePath = "Daily/Z-Unselected-Closed-Potential-Race.md";
  const runningClock = formatCanonicalRunningClock(NOW - 120_000, 480, CLOCK_A);
  const closedClock = formatCanonicalClosedClock(NOW - 180_000, 480, NOW - 60_000, 480, CLOCK_A);
  const selectedSource = `${OPEN}\n- [x] Selected done owner d30m ^${PLAN_A}\n  - LOGBOOK::\n    - ${runningClock}\n${CLOSE}\n`;
  const repairedSelectedSource = selectedSource.replace(`^${CLOCK_A}`, `^${CLOCK_NEW}`);
  const duplicateSource = `${OPEN}\n- [ ] Closed duplicate owner d30m ^${PLAN_B}\n  - LOGBOOK::\n    - ${closedClock}\n${CLOSE}\n`;
  const initialPotentialSource = `${OPEN}\n- [ ] Potential owner d30m ^${PLAN_NEW}\n${CLOSE}\n`;
  const insertedPotentialSource = initialPotentialSource.replace(
    CLOSE,
    `  - LOGBOOK::\n    - CLOCK: [broken]\n${CLOSE}`,
  );
  const access = new MemoryAtomicTextAccess({
    [selectedPath]: selectedSource,
    [potentialPath]: initialPotentialSource,
    [duplicatePath]: duplicateSource,
  });
  const repair = createMutationPlan({
    intentId: "selected-invalid-owner-unselected-potential-race",
    action: "repair-clock-identity",
    stages: [{
      path: selectedPath,
      confirmationRequired: true,
      operations: [{
        kind: "repair-clock-identity",
        target: { kind: "clock", id: CLOCK_A },
        newId: CLOCK_NEW,
      }],
    }],
    expectedRunningClockIds: [CLOCK_A],
    settingsVersion: CONTEXT.settingsVersion,
    zoneId: CONTEXT.zoneId,
  });
  const expectation = await mutationExpectation(access, repair, {
    clockIds: [CLOCK_A],
    expectedRunningClockIds: [CLOCK_A],
  });
  assert.equal(expectation.selectedRepair?.selectedSpan.path, selectedPath);
  access.raceAfterTransformReads(1, () => access.modify(potentialPath, insertedPotentialSource));
  const writer = new WorkspaceCommitter(access, { readContext: () => CONTEXT });

  const receipt = await writer.commit(repair, expectation);

  assert.equal(receipt.outcome, "invariant-broken", JSON.stringify(receipt));
  assert.equal(receipt.confirmation, "invariant-broken");
  assert.equal(receipt.result?.code, "write-invariant-broken");
  assert.equal(receipt.globalCheck.status, "violated");
  assert.equal(writer.blocked, true);
  assert.equal(access.transactionCounts.get(selectedPath), 1);
  assert.equal(access.transactionCounts.has(potentialPath), false);
  assert.equal(access.transactionCounts.has(duplicatePath), false);
  assert.equal(await access.readText(selectedPath), repairedSelectedSource);
  assert.equal(await access.readText(potentialPath), insertedPotentialSource);
  assert.equal(await access.readText(duplicatePath), duplicateSource);
  writer.dispose();
});

test("already-applied identity repair rejects a CLOCK added during final owner revalidation", async () => {
  const selectedPath = "Daily/A-Selected-Final-Owner-Race.md";
  const otherPath = "Daily/Z-External-Final-Owner-Race.md";
  const runningClock = formatCanonicalRunningClock(NOW - 120_000, 480, CLOCK_A);
  const closedClock = formatCanonicalClosedClock(NOW - 180_000, 480, NOW - 60_000, 480, CLOCK_A);
  const externalClock = formatCanonicalRunningClock(NOW - 30_000, 480, CLOCK_B);
  const selectedSource = `${OPEN}\n- [ ] Selected owner d30m ^${PLAN_A}\n  - LOGBOOK::\n    - ${runningClock}\n${CLOSE}\n`;
  const repairedSelectedSource = selectedSource.replace(`^${CLOCK_A}`, `^${CLOCK_NEW}`);
  const otherSource = `${OPEN}\n- [ ] Other owner d30m ^${PLAN_B}\n  - LOGBOOK::\n    - ${closedClock}\n${CLOSE}\n`;
  const externallyChangedOther = otherSource.replace(
    `${closedClock}\n`,
    `${closedClock}\n    - ${externalClock}\n`,
  );
  const access = new MemoryAtomicTextAccess({
    [selectedPath]: selectedSource,
    [otherPath]: otherSource,
  });
  const repair = createMutationPlan({
    intentId: "identity-final-owner-generation-race",
    action: "repair-clock-identity",
    stages: [{
      path: selectedPath,
      confirmationRequired: true,
      operations: [{
        kind: "repair-clock-identity",
        target: { kind: "clock", id: CLOCK_A },
        newId: CLOCK_NEW,
      }],
    }],
    expectedRunningClockIds: [CLOCK_A],
    settingsVersion: CONTEXT.settingsVersion,
    zoneId: CONTEXT.zoneId,
  });
  const expectation = await mutationExpectation(access, repair, {
    clockIds: [CLOCK_A],
    expectedRunningClockIds: [CLOCK_A],
  });
  const firstWriter = new WorkspaceCommitter(access, { readContext: () => CONTEXT });
  const applied = await firstWriter.commit(repair, expectation);
  assert.equal(applied.outcome, "applied", JSON.stringify(applied));
  assert.equal(await access.readText(selectedPath), repairedSelectedSource);
  firstWriter.dispose();

  const transactionsBeforeRetry = [...access.transactionCounts.entries()];
  const sharedIndex = new WorkspaceIndex(access);
  const retryWriter = new WorkspaceCommitter(access, {
    readContext: () => CONTEXT,
    workspaceIndex: sharedIndex,
  });
  const finalOwnerGate = access.pauseAfterReads(selectedPath, 5);

  const pendingRetry = retryWriter.commit(repair, expectation);
  await finalOwnerGate.entered;
  const staleGeneration = sharedIndex.safetySnapshot.generation;
  access.modify(otherPath, externallyChangedOther);
  const rebuilt = await sharedIndex.rebuild();
  assert.equal(rebuilt.complete, true);
  assert.ok(rebuilt.generation > staleGeneration);
  finalOwnerGate.release();
  const retry = await pendingRetry;

  assert.equal(retry.outcome, "conflict", JSON.stringify(retry));
  assert.equal(retry.confirmation, "confirmed-no-change");
  assert.equal(retry.result?.code, "source-conflict");
  assert.equal(retryWriter.blocked, false);
  assert.deepEqual([...access.transactionCounts.entries()], transactionsBeforeRetry);
  assert.equal(await access.readText(selectedPath), repairedSelectedSource);
  assert.equal(await access.readText(otherPath), externallyChangedOther);
  retryWriter.dispose();
  assert.equal(sharedIndex.safetySnapshot.complete, true);
  sharedIndex.dispose();
});

test("already-applied switch rejects a CLOCK added while its target owner read is pending", async () => {
  const selectedPath = "Daily/A-Switch-Generation-Race.md";
  const otherPath = "Daily/Z-External-Switch-Generation-Race.md";
  const runningClock = formatCanonicalRunningClock(NOW - 120_000, 480, CLOCK_A);
  const externalClock = formatCanonicalRunningClock(NOW - 30_000, 480, CLOCK_NEW);
  const selectedSource = `${OPEN}\n- [ ] Old owner d30m ^${PLAN_A}\n  - LOGBOOK::\n    - ${runningClock}\n- [ ] New owner d30m ^${PLAN_B}\n${CLOSE}\n`;
  const otherSource = `${OPEN}\n- [ ] External owner d30m ^${PLAN_NEW}\n${CLOSE}\n`;
  const externallyChangedOther = otherSource.replace(
    CLOSE,
    `  - LOGBOOK::\n    - ${externalClock}\n${CLOSE}`,
  );
  const access = new MemoryAtomicTextAccess({
    [selectedPath]: selectedSource,
    [otherPath]: otherSource,
  });
  const switchPlan = createMutationPlan({
    intentId: "switch-already-applied-generation-race",
    action: "switch-task",
    stages: [{
      path: selectedPath,
      confirmationRequired: false,
      operations: [
        {
          kind: "clock-out",
          target: { kind: "clock", id: CLOCK_A, ownerId: PLAN_A },
          close: { clockId: CLOCK_A, endEpochMs: NOW, offsetMinutes: 480 },
        },
        {
          kind: "clock-in",
          target: { kind: "plan-item", id: PLAN_B },
          clock: { clockId: CLOCK_B, startEpochMs: NOW, offsetMinutes: 480 },
        },
      ],
    }],
    expectedRunningClockIds: [CLOCK_A],
    settingsVersion: CONTEXT.settingsVersion,
    zoneId: CONTEXT.zoneId,
    transitionEpochMs: NOW,
  });
  const expectation = await mutationExpectation(access, switchPlan, {
    planIds: [PLAN_B],
    clockIds: [CLOCK_A],
    expectedRunningClockIds: [CLOCK_A],
  });
  const firstWriter = new WorkspaceCommitter(access, { readContext: () => CONTEXT });
  const applied = await firstWriter.commit(switchPlan, expectation);
  assert.equal(applied.outcome, "applied", JSON.stringify(applied));
  const switchedSource = await access.readText(selectedPath);
  firstWriter.dispose();

  const transactionsBeforeRetry = [...access.transactionCounts.entries()];
  const sharedIndex = new WorkspaceIndex(access);
  const retryWriter = new WorkspaceCommitter(access, {
    readContext: () => CONTEXT,
    workspaceIndex: sharedIndex,
  });
  const ownerReadGate = access.pauseAfterReads(selectedPath, 4);

  const pendingRetry = retryWriter.commit(switchPlan, expectation);
  await ownerReadGate.entered;
  const capturedGeneration = sharedIndex.safetySnapshot.generation;
  access.modify(otherPath, externallyChangedOther);
  const rebuilt = await sharedIndex.rebuild();
  assert.equal(rebuilt.complete, true);
  assert.ok(rebuilt.generation > capturedGeneration);
  ownerReadGate.release();
  const retry = await pendingRetry;

  assert.equal(retry.outcome, "conflict", JSON.stringify(retry));
  assert.equal(retry.confirmation, "confirmed-no-change");
  assert.equal(retry.result?.code, "source-conflict");
  assert.equal(retry.globalCheck.status, "violated");
  assert.equal(retryWriter.blocked, false);
  assert.deepEqual([...access.transactionCounts.entries()], transactionsBeforeRetry);
  assert.equal(await access.readText(selectedPath), switchedSource);
  assert.equal(await access.readText(otherPath), externallyChangedOther);
  retryWriter.dispose();
  sharedIndex.dispose();
});

test("already-applied switch reports a running CLOCK whose owner becomes done during target admission", async () => {
  const selectedPath = "Daily/Switch-Invalid-Owner-Generation-Race.md";
  const runningClock = formatCanonicalRunningClock(NOW - 120_000, 480, CLOCK_A);
  const selectedSource = `${OPEN}\n- [ ] Old owner d30m ^${PLAN_A}\n  - LOGBOOK::\n    - ${runningClock}\n- [ ] New owner d30m ^${PLAN_B}\n${CLOSE}\n`;
  const access = new MemoryAtomicTextAccess({ [selectedPath]: selectedSource });
  const switchPlan = createMutationPlan({
    intentId: "switch-already-applied-invalid-owner-generation-race",
    action: "switch-task",
    stages: [{
      path: selectedPath,
      confirmationRequired: false,
      operations: [
        {
          kind: "clock-out",
          target: { kind: "clock", id: CLOCK_A, ownerId: PLAN_A },
          close: { clockId: CLOCK_A, endEpochMs: NOW, offsetMinutes: 480 },
        },
        {
          kind: "clock-in",
          target: { kind: "plan-item", id: PLAN_B },
          clock: { clockId: CLOCK_B, startEpochMs: NOW, offsetMinutes: 480 },
        },
      ],
    }],
    expectedRunningClockIds: [CLOCK_A],
    settingsVersion: CONTEXT.settingsVersion,
    zoneId: CONTEXT.zoneId,
    transitionEpochMs: NOW,
  });
  const expectation = await mutationExpectation(access, switchPlan, {
    planIds: [PLAN_B],
    clockIds: [CLOCK_A],
    expectedRunningClockIds: [CLOCK_A],
  });
  const firstWriter = new WorkspaceCommitter(access, { readContext: () => CONTEXT });
  const applied = await firstWriter.commit(switchPlan, expectation);
  assert.equal(applied.outcome, "applied", JSON.stringify(applied));
  const switchedSource = await access.readText(selectedPath);
  assert.ok(switchedSource);
  firstWriter.dispose();

  const invalidOwnerSource = switchedSource.replace("- [ ] New owner", "- [x] New owner");
  assert.notEqual(invalidOwnerSource, switchedSource);
  const transactionsBeforeRetry = [...access.transactionCounts.entries()];
  const sharedIndex = new WorkspaceIndex(access);
  const retryWriter = new WorkspaceCommitter(access, {
    readContext: () => CONTEXT,
    workspaceIndex: sharedIndex,
  });
  const ownerReadGate = access.pauseAfterReads(selectedPath, 4);

  const pendingRetry = retryWriter.commit(switchPlan, expectation);
  await ownerReadGate.entered;
  const capturedGeneration = sharedIndex.safetySnapshot.generation;
  access.modify(selectedPath, invalidOwnerSource);
  const rebuilt = await sharedIndex.rebuild();
  assert.equal(rebuilt.complete, true);
  assert.ok(rebuilt.generation > capturedGeneration);
  ownerReadGate.release();
  const retry = await pendingRetry;

  assert.equal(retry.outcome, "conflict", JSON.stringify(retry));
  assert.equal(retry.confirmation, "confirmed-no-change");
  assert.equal(retry.result?.code, "source-conflict");
  assert.deepEqual(retry.globalCheck, { status: "violated", runningClockIds: [CLOCK_B] });
  assert.equal(retryWriter.blocked, false);
  assert.deepEqual([...access.transactionCounts.entries()], transactionsBeforeRetry);
  assert.equal(await access.readText(selectedPath), invalidOwnerSource);
  retryWriter.dispose();
  assert.equal(sharedIndex.safetySnapshot.complete, true);
  sharedIndex.dispose();
});

test("reloaded closed CLOCK identity repair rejects a changed final running set", async () => {
  const selectedPath = "Daily/A-Selected-Closed-Retry.md";
  const unselectedPath = "Daily/Z-Unselected-Running-Retry.md";
  const closedClock = formatCanonicalClosedClock(NOW - 120_000, 480, NOW - 60_000, 480, CLOCK_A);
  const runningClock = formatCanonicalRunningClock(NOW - 120_000, 480, CLOCK_A);
  const selectedSource = `${OPEN}\n- [ ] Selected owner d30m ^${PLAN_A}\n  - LOGBOOK::\n    - ${closedClock}\n${CLOSE}\n`;
  const repairedSelectedSource = selectedSource.replace(`^${CLOCK_A}`, `^${CLOCK_NEW}`);
  const unselectedSource = `${OPEN}\n- [ ] Unselected owner d30m ^${PLAN_B}\n  - LOGBOOK::\n    - ${runningClock}\n${CLOSE}\n`;

  for (const externalChange of ["closed", "other"] as const) {
    const access = new MemoryAtomicTextAccess({
      [selectedPath]: selectedSource,
      [unselectedPath]: unselectedSource,
    });
    const repair = createMutationPlan({
      intentId: `closed-clock-retry-${externalChange}`,
      action: "repair-clock-identity",
      stages: [{
        path: selectedPath,
        confirmationRequired: true,
        operations: [{
          kind: "repair-clock-identity",
          target: { kind: "clock", id: CLOCK_A },
          newId: CLOCK_NEW,
        }],
      }],
      expectedRunningClockIds: [CLOCK_A],
      settingsVersion: CONTEXT.settingsVersion,
      zoneId: CONTEXT.zoneId,
    });
    const expectation = await mutationExpectation(access, repair, {
      clockIds: [CLOCK_A],
      expectedRunningClockIds: [CLOCK_A],
    });
    assert.equal(expectation.clocks[0]?.state, "closed");
    assert.equal(expectation.selectedRepair?.selectedSpan.path, selectedPath);
    const firstWriter = new WorkspaceCommitter(access, { readContext: () => CONTEXT });

    const applied = await firstWriter.commit(repair, expectation);

    assert.equal(applied.outcome, "applied", `${externalChange}: ${JSON.stringify(applied)}`);
    assert.equal(applied.confirmation, "confirmed", externalChange);
    assert.deepEqual(applied.globalCheck, { status: "confirmed", runningClockIds: [CLOCK_A] }, externalChange);
    assert.equal(access.transactionCounts.get(selectedPath), 1, externalChange);
    assert.equal(access.transactionCounts.has(unselectedPath), false, externalChange);
    assert.equal(await access.readText(selectedPath), repairedSelectedSource, externalChange);
    assert.equal(await access.readText(unselectedPath), unselectedSource, externalChange);
    firstWriter.dispose();

    const externalClock = externalChange === "closed"
      ? formatCanonicalClosedClock(NOW - 120_000, 480, NOW, 480, CLOCK_A)
      : formatCanonicalRunningClock(NOW - 120_000, 480, CLOCK_B);
    const externallyChangedSource = unselectedSource.replace(runningClock, externalClock);
    access.modify(unselectedPath, externallyChangedSource);
    const transactionsBeforeRetry = [...access.transactionCounts.entries()];
    const retryWriter = new WorkspaceCommitter(access, { readContext: () => CONTEXT });

    const retry = await retryWriter.commit(repair, expectation);

    assert.equal(retry.outcome, "conflict", `${externalChange}: ${JSON.stringify(retry)}`);
    assert.equal(retry.confirmation, "confirmed-no-change", externalChange);
    assert.equal(retry.result?.code, "source-conflict", externalChange);
    assert.deepEqual(retry.globalCheck, {
      status: "confirmed",
      runningClockIds: externalChange === "closed" ? [] : [CLOCK_B],
    }, externalChange);
    assert.equal(retryWriter.blocked, false, externalChange);
    assert.deepEqual([...access.transactionCounts.entries()], transactionsBeforeRetry, externalChange);
    assert.equal(await access.readText(selectedPath), repairedSelectedSource, externalChange);
    assert.equal(await access.readText(unselectedPath), externallyChangedSource, externalChange);
    retryWriter.dispose();
  }
});

test("duplicate running CLOCK identity repair never exempts an invalid unselected occurrence", async () => {
  const selectedPath = "Daily/A-Selected-Running-Owner.md";
  const unselectedPath = "Daily/Z-Unselected-Invalid-Running-Owner.md";
  const runningClock = formatCanonicalRunningClock(NOW - 120_000, 480, CLOCK_A);
  const selectedSource = `${OPEN}\n- [ ] Selected owner d30m ^${PLAN_A}\n  - LOGBOOK::\n    - ${runningClock}\n${CLOSE}\n`;
  const unselectedSource = `${OPEN}\n- [x] Invalid unselected owner d30m ^${PLAN_B}\n  - LOGBOOK::\n    - ${runningClock}\n${CLOSE}\n`;
  const access = new MemoryAtomicTextAccess({
    [selectedPath]: selectedSource,
    [unselectedPath]: unselectedSource,
  });
  const repair = createMutationPlan({
    intentId: "exact-selected-running-clock-owner",
    action: "repair-clock-identity",
    stages: [{
      path: selectedPath,
      confirmationRequired: true,
      operations: [{
        kind: "repair-clock-identity",
        target: { kind: "clock", id: CLOCK_A },
        newId: CLOCK_NEW,
      }],
    }],
    expectedRunningClockIds: [CLOCK_A, CLOCK_A],
    settingsVersion: CONTEXT.settingsVersion,
    zoneId: CONTEXT.zoneId,
  });
  const expectation = await mutationExpectation(access, repair, {
    clockIds: [CLOCK_A],
    expectedRunningClockIds: [CLOCK_A, CLOCK_A],
  });
  assert.deepEqual(expectation.selectedRepair?.selectedSpan, {
    path: selectedPath,
    fromOffset: selectedSource.indexOf(runningClock),
    toOffset: selectedSource.indexOf(runningClock) + runningClock.length,
  });
  const writer = new WorkspaceCommitter(access, { readContext: () => CONTEXT });

  const receipt = await writer.commit(repair, expectation);

  assert.equal(receipt.outcome, "conflict", JSON.stringify(receipt));
  assert.equal(receipt.confirmation, "confirmed-no-change");
  assert.equal(receipt.result?.code, "clock-owner-invalid");
  assert.equal(receipt.globalCheck.status, "violated");
  assert.equal(access.transactionCounts.size, 0);
  assert.equal(await access.readText(selectedPath), selectedSource);
  assert.equal(await access.readText(unselectedPath), unselectedSource);
  writer.dispose();
});

test("same-file duplicate running CLOCK identity repair exempts only the exact selected span", async () => {
  const path = "Daily/Same-File-Selected-Running-Owner.md";
  const runningClock = formatCanonicalRunningClock(NOW - 120_000, 480, CLOCK_A);
  const source = `${OPEN}\n- [ ] Selected owner d30m ^${PLAN_A}\n  - LOGBOOK::\n    - ${runningClock}\n- [x] Invalid unselected owner d30m ^${PLAN_B}\n  - LOGBOOK::\n    - ${runningClock}\n${CLOSE}\n`;
  const access = new MemoryAtomicTextAccess({ [path]: source });
  const repair = createMutationPlan({
    intentId: "same-file-exact-selected-running-clock",
    action: "repair-clock-identity",
    stages: [{
      path,
      confirmationRequired: true,
      operations: [{
        kind: "repair-clock-identity",
        target: { kind: "clock", id: CLOCK_A },
        newId: CLOCK_NEW,
      }],
    }],
    expectedRunningClockIds: [CLOCK_A, CLOCK_A],
    settingsVersion: CONTEXT.settingsVersion,
    zoneId: CONTEXT.zoneId,
  });
  const expectation = await mutationExpectation(access, repair, {
    clockIds: [CLOCK_A],
    expectedRunningClockIds: [CLOCK_A, CLOCK_A],
  });
  assert.equal(expectation.selectedRepair?.selectedSpan.fromOffset, source.indexOf(runningClock));
  assert.notEqual(expectation.selectedRepair?.selectedSpan.fromOffset, source.lastIndexOf(runningClock));
  const writer = new WorkspaceCommitter(access, { readContext: () => CONTEXT });

  const receipt = await writer.commit(repair, expectation);

  assert.equal(receipt.outcome, "conflict", JSON.stringify(receipt));
  assert.equal(receipt.confirmation, "confirmed-no-change");
  assert.equal(receipt.result?.code, "clock-owner-invalid");
  assert.equal(receipt.globalCheck.status, "violated");
  assert.equal(access.transactionCounts.size, 0);
  assert.equal(await access.readText(path), source);
  writer.dispose();
});

test("duplicate running CLOCK identity repair blocks after an unselected owner becomes invalid post-write", async () => {
  const selectedPath = "Daily/A-Selected-Running-Race.md";
  const unselectedPath = "Daily/Z-Unselected-Running-Race.md";
  const runningClock = formatCanonicalRunningClock(NOW - 120_000, 480, CLOCK_A);
  const selectedSource = `${OPEN}\n- [ ] Selected owner d30m ^${PLAN_A}\n  - LOGBOOK::\n    - ${runningClock}\n${CLOSE}\n`;
  const unselectedSource = `${OPEN}\n- [ ] Unselected owner d30m ^${PLAN_B}\n  - LOGBOOK::\n    - ${runningClock}\n${CLOSE}\n`;
  const invalidUnselectedSource = unselectedSource.replace("- [ ] Unselected", "- [x] Unselected");
  const access = new MemoryAtomicTextAccess({
    [selectedPath]: selectedSource,
    [unselectedPath]: unselectedSource,
  });
  const repair = createMutationPlan({
    intentId: "exact-selected-running-clock-race",
    action: "repair-clock-identity",
    stages: [{
      path: selectedPath,
      confirmationRequired: true,
      operations: [{
        kind: "repair-clock-identity",
        target: { kind: "clock", id: CLOCK_A },
        newId: CLOCK_NEW,
      }],
    }],
    expectedRunningClockIds: [CLOCK_A, CLOCK_A],
    settingsVersion: CONTEXT.settingsVersion,
    zoneId: CONTEXT.zoneId,
  });
  const expectation = await mutationExpectation(access, repair, {
    clockIds: [CLOCK_A],
    expectedRunningClockIds: [CLOCK_A, CLOCK_A],
  });
  assert.equal(expectation.selectedRepair?.selectedSpan.path, selectedPath);
  access.raceAfterTransformReads(1, () => access.modify(unselectedPath, invalidUnselectedSource));
  const writer = new WorkspaceCommitter(access, { readContext: () => CONTEXT });

  const receipt = await writer.commit(repair, expectation);

  assert.equal(receipt.outcome, "invariant-broken", JSON.stringify(receipt));
  assert.equal(receipt.confirmation, "invariant-broken");
  assert.equal(receipt.result?.code, "write-invariant-broken");
  assert.equal(receipt.globalCheck.status, "violated");
  assert.equal(writer.blocked, true);
  assert.equal(access.transactionCounts.get(selectedPath), 1);
  assert.equal(access.transactionCounts.has(unselectedPath), false);
  assert.equal(await access.readText(selectedPath), selectedSource.replace(`^${CLOCK_A}`, `^${CLOCK_NEW}`));
  assert.equal(await access.readText(unselectedPath), invalidUnselectedSource);
  assert.equal(invalidUnselectedSource.includes(runningClock), true);
  writer.dispose();
});

test("duplicate running CLOCK identity repair retry rechecks the exact unselected owner without another write", async () => {
  const selectedPath = "Daily/A-Selected-Running-Retry.md";
  const unselectedPath = "Daily/Z-Unselected-Running-Retry.md";
  const runningClock = formatCanonicalRunningClock(NOW - 120_000, 480, CLOCK_A);
  const selectedSource = `${OPEN}\n- [ ] Selected owner d30m ^${PLAN_A}\n  - LOGBOOK::\n    - ${runningClock}\n${CLOSE}\n`;
  const repairedSelectedSource = selectedSource.replace(`^${CLOCK_A}`, `^${CLOCK_NEW}`);
  const unselectedSource = `${OPEN}\n- [ ] Unselected owner d30m ^${PLAN_B}\n  - LOGBOOK::\n    - ${runningClock}\n${CLOSE}\n`;
  const invalidUnselectedSource = unselectedSource.replace("- [ ] Unselected", "- [x] Unselected");
  const access = new MemoryAtomicTextAccess({
    [selectedPath]: selectedSource,
    [unselectedPath]: unselectedSource,
  });
  const repair = createMutationPlan({
    intentId: "exact-selected-running-clock-retry",
    action: "repair-clock-identity",
    stages: [{
      path: selectedPath,
      confirmationRequired: true,
      operations: [{
        kind: "repair-clock-identity",
        target: { kind: "clock", id: CLOCK_A },
        newId: CLOCK_NEW,
      }],
    }],
    expectedRunningClockIds: [CLOCK_A, CLOCK_A],
    settingsVersion: CONTEXT.settingsVersion,
    zoneId: CONTEXT.zoneId,
  });
  const expectation = await mutationExpectation(access, repair, {
    clockIds: [CLOCK_A],
    expectedRunningClockIds: [CLOCK_A, CLOCK_A],
  });
  assert.equal(expectation.selectedRepair?.selectedSpan.path, selectedPath);
  const firstWriter = new WorkspaceCommitter(access, { readContext: () => CONTEXT });
  const applied = await firstWriter.commit(repair, expectation);
  assert.equal(applied.outcome, "applied", JSON.stringify(applied));
  assert.equal(applied.confirmation, "confirmed");
  assert.deepEqual(applied.globalCheck, {
    status: "violated",
    runningClockIds: [CLOCK_A, CLOCK_NEW],
  });
  firstWriter.dispose();

  access.modify(unselectedPath, invalidUnselectedSource);
  const transactionsBeforeRetry = [...access.transactionCounts.entries()];
  const retryWriter = new WorkspaceCommitter(access, { readContext: () => CONTEXT });
  const retry = await retryWriter.commit(repair, expectation);

  assert.equal(retry.outcome, "conflict", JSON.stringify(retry));
  assert.equal(retry.confirmation, "confirmed-no-change");
  assert.equal(retry.result?.code, "clock-owner-invalid");
  assert.equal(retry.globalCheck.status, "violated");
  assert.deepEqual([...access.transactionCounts.entries()], transactionsBeforeRetry);
  assert.equal(await access.readText(selectedPath), repairedSelectedSource);
  assert.equal(await access.readText(unselectedPath), invalidUnselectedSource);
  assert.equal(invalidUnselectedSource.includes(runningClock), true);
  retryWriter.dispose();
});

test("exact selected invalid running CLOCK identity recovery admits old bytes and its repaired retry state", async () => {
  const selectedPath = "Daily/A-Selected-Invalid-Running-Recovery.md";
  const unselectedPath = "Daily/Z-Unselected-Valid-Running-Recovery.md";
  const runningClock = formatCanonicalRunningClock(NOW - 120_000, 480, CLOCK_A);
  const selectedSource = `${OPEN}\n- [x] Invalid selected owner d30m ^${PLAN_A}\n  - LOGBOOK::\n    - ${runningClock}\n${CLOSE}\n`;
  const repairedSelectedSource = selectedSource.replace(`^${CLOCK_A}`, `^${CLOCK_NEW}`);
  const unselectedSource = `${OPEN}\n- [ ] Valid unselected owner d30m ^${PLAN_B}\n  - LOGBOOK::\n    - ${runningClock}\n${CLOSE}\n`;
  const access = new MemoryAtomicTextAccess({
    [selectedPath]: selectedSource,
    [unselectedPath]: unselectedSource,
  });
  const repair = createMutationPlan({
    intentId: "exact-selected-invalid-running-recovery",
    action: "repair-clock-identity",
    stages: [{
      path: selectedPath,
      confirmationRequired: true,
      operations: [{
        kind: "repair-clock-identity",
        target: { kind: "clock", id: CLOCK_A },
        newId: CLOCK_NEW,
      }],
    }],
    expectedRunningClockIds: [CLOCK_A, CLOCK_A],
    settingsVersion: CONTEXT.settingsVersion,
    zoneId: CONTEXT.zoneId,
  });
  const expectation = await mutationExpectation(access, repair, {
    clockIds: [CLOCK_A],
    expectedRunningClockIds: [CLOCK_A, CLOCK_A],
  });
  assert.equal(expectation.selectedRepair?.selectedSpan.path, selectedPath);
  const firstWriter = new WorkspaceCommitter(access, { readContext: () => CONTEXT });

  const applied = await firstWriter.commit(repair, expectation);

  assert.equal(applied.outcome, "applied", JSON.stringify(applied));
  assert.equal(applied.confirmation, "confirmed");
  assert.deepEqual(applied.globalCheck, {
    status: "violated",
    runningClockIds: [CLOCK_A, CLOCK_NEW],
  });
  assert.equal(firstWriter.blocked, false);
  assert.equal(access.transactionCounts.get(selectedPath), 1);
  assert.equal(access.transactionCounts.has(unselectedPath), false);
  assert.equal(await access.readText(selectedPath), repairedSelectedSource);
  assert.equal(await access.readText(unselectedPath), unselectedSource);
  firstWriter.dispose();

  const transactionsBeforeRetry = [...access.transactionCounts.entries()];
  const retryWriter = new WorkspaceCommitter(access, { readContext: () => CONTEXT });
  const retry = await retryWriter.commit(repair, expectation);

  assert.equal(retry.outcome, "already-applied", JSON.stringify(retry));
  assert.equal(retry.confirmation, "confirmed");
  assert.deepEqual(retry.globalCheck, applied.globalCheck);
  assert.equal(retryWriter.blocked, false);
  assert.deepEqual([...access.transactionCounts.entries()], transactionsBeforeRetry);
  assert.equal(await access.readText(selectedPath), repairedSelectedSource);
  assert.equal(await access.readText(unselectedPath), unselectedSource);
  retryWriter.dispose();
});

test("selected duplicate repair cannot confirm a newly invalid unselected CLOCK owner", async () => {
  const selectedPath = "Daily/A-Selected-Final-Owner-Race.md";
  const clockPath = "Daily/B-Unselected-Final-Owner-Race.md";
  const thirdPath = "Daily/C-New-Final-Owner-Collision.md";
  const legacyText = "CLOCK: [2026-08-28 08:10]";
  const clockSource = `${OPEN}\n- [ ] Timed owner d30m ^${PLAN_A}\n  - LOGBOOK::\n    - ${legacyText}\n${CLOSE}\n`;
  const selectedSource = `${OPEN}\n- [ ] Clock-free owner d30m ^${PLAN_A}\n${CLOSE}\n`;
  const thirdSource = `${OPEN}\n- [ ] New duplicate d30m ^${PLAN_A}\n${CLOSE}\n`;
  const legacyStart = NOW - 60_000;
  const resolveLocalTime = () => ({ kind: "unique" as const, epochMs: legacyStart });
  const parsedClock = readLogbook(clockSource, {
    path: clockPath,
    itemFromOffset: clockSource.indexOf("- [ ]"),
    itemToOffset: clockSource.indexOf(CLOSE),
    ownerId: PLAN_A,
  }, { resolveLocalTime }).clocks[0]!;
  const runningKey = legacyRunningClockKey(parsedClock.path, parsedClock.fromOffset, parsedClock.text);

  for (const race of ["owner-done", "new-collision"] as const) {
    const access = new MemoryAtomicTextAccess({
      [clockPath]: clockSource,
      [selectedPath]: selectedSource,
    });
    const repair = createMutationPlan({
      intentId: `selected-owner-final-${race}`,
      action: "repair-plan-item-identity",
      stages: [{
        path: selectedPath,
        confirmationRequired: true,
        operations: [{
          kind: "repair-plan-item-identity",
          target: { kind: "plan-item", id: PLAN_A },
          newId: PLAN_NEW,
        }],
      }],
      expectedRunningClockIds: [runningKey],
      settingsVersion: CONTEXT.settingsVersion,
      zoneId: CONTEXT.zoneId,
    });
    const expectation = await mutationExpectation(access, repair, {
      planIds: [PLAN_A],
      expectedRunningClockIds: [runningKey],
    });
    assert.equal(expectation.selectedRepair?.selectedSpan.path, selectedPath);
    access.raceAfterTransformReads(1, () => {
      if (race === "owner-done") {
        access.modify(clockPath, clockSource.replace("- [ ] Timed", "- [x] Timed"));
      } else {
        access.create(thirdPath, thirdSource);
      }
    });
    const writer = new WorkspaceCommitter(access, {
      readContext: () => CONTEXT,
      index: { clockParsing: { resolveLocalTime } },
      logbook: { resolveLocalTime },
    });

    const receipt = await writer.commit(repair, expectation);

    assert.equal(receipt.outcome, "invariant-broken", `${race}: ${JSON.stringify(receipt)}`);
    assert.equal(receipt.confirmation, "invariant-broken", race);
    assert.equal(receipt.result?.code, "write-invariant-broken", race);
    assert.equal(receipt.globalCheck.status, "violated", race);
    assert.equal(writer.blocked, true, race);
    assert.equal(access.transactionCounts.get(selectedPath), 1, race);
    assert.equal(
      await access.readText(selectedPath),
      selectedSource.replace(`^${PLAN_A}`, `^${PLAN_NEW}`),
      race,
    );
    assert.equal(
      await access.readText(clockPath),
      race === "owner-done" ? clockSource.replace("- [ ] Timed", "- [x] Timed") : clockSource,
      race,
    );
    assert.equal(await access.readText(thirdPath), race === "new-collision" ? thirdSource : undefined, race);
    writer.dispose();
  }
});

test("already-applied duplicate repair revalidates the remaining CLOCK owner after reload", async () => {
  const selectedPath = "Daily/A-Selected-Retry-Owner.md";
  const clockPath = "Daily/B-Unselected-Retry-Owner.md";
  const thirdPath = "Daily/C-New-Retry-Collision.md";
  const legacyText = "CLOCK: [2026-08-28 08:10]";
  const clockSource = `${OPEN}\n- [ ] Timed owner d30m ^${PLAN_A}\n  - LOGBOOK::\n    - ${legacyText}\n${CLOSE}\n`;
  const selectedSource = `${OPEN}\n- [ ] Clock-free owner d30m ^${PLAN_A}\n${CLOSE}\n`;
  const repairedSource = selectedSource.replace(`^${PLAN_A}`, `^${PLAN_NEW}`);
  const thirdSource = `${OPEN}\n- [ ] New duplicate d30m ^${PLAN_A}\n${CLOSE}\n`;
  const legacyStart = NOW - 60_000;
  const resolveLocalTime = () => ({ kind: "unique" as const, epochMs: legacyStart });
  const parsedClock = readLogbook(clockSource, {
    path: clockPath,
    itemFromOffset: clockSource.indexOf("- [ ]"),
    itemToOffset: clockSource.indexOf(CLOSE),
    ownerId: PLAN_A,
  }, { resolveLocalTime }).clocks[0]!;
  const runningKey = legacyRunningClockKey(parsedClock.path, parsedClock.fromOffset, parsedClock.text);

  for (const invalidOwner of ["owner-done", "new-collision"] as const) {
    const access = new MemoryAtomicTextAccess({
      [clockPath]: clockSource,
      [selectedPath]: selectedSource,
    });
    const repair = createMutationPlan({
      intentId: `selected-owner-retry-${invalidOwner}`,
      action: "repair-plan-item-identity",
      stages: [{
        path: selectedPath,
        confirmationRequired: true,
        operations: [{
          kind: "repair-plan-item-identity",
          target: { kind: "plan-item", id: PLAN_A },
          newId: PLAN_NEW,
        }],
      }],
      expectedRunningClockIds: [runningKey],
      settingsVersion: CONTEXT.settingsVersion,
      zoneId: CONTEXT.zoneId,
    });
    const expectation = await mutationExpectation(access, repair, {
      planIds: [PLAN_A],
      expectedRunningClockIds: [runningKey],
    });
    const firstWriter = new WorkspaceCommitter(access, {
      readContext: () => CONTEXT,
      index: { clockParsing: { resolveLocalTime } },
      logbook: { resolveLocalTime },
    });
    const applied = await firstWriter.commit(repair, expectation);
    assert.equal(applied.outcome, "applied", invalidOwner);
    assert.equal(applied.confirmation, "confirmed", invalidOwner);
    firstWriter.dispose();

    if (invalidOwner === "owner-done") {
      access.modify(clockPath, clockSource.replace("- [ ] Timed", "- [x] Timed"));
    } else {
      access.create(thirdPath, thirdSource);
    }
    const transactionsBeforeRetry = access.transactionCounts.size;
    const selectedTransactionsBeforeRetry = access.transactionCounts.get(selectedPath);
    const retryWriter = new WorkspaceCommitter(access, {
      readContext: () => CONTEXT,
      index: { clockParsing: { resolveLocalTime } },
      logbook: { resolveLocalTime },
    });

    const retry = await retryWriter.commit(repair, expectation);

    assert.equal(retry.outcome, "conflict", `${invalidOwner}: ${JSON.stringify(retry)}`);
    assert.equal(retry.confirmation, "confirmed-no-change", invalidOwner);
    assert.equal(retry.result?.code, "clock-owner-invalid", invalidOwner);
    assert.equal(retry.globalCheck.status, "violated", invalidOwner);
    assert.equal(access.transactionCounts.size, transactionsBeforeRetry, invalidOwner);
    assert.equal(access.transactionCounts.get(selectedPath), selectedTransactionsBeforeRetry, invalidOwner);
    assert.equal(await access.readText(selectedPath), repairedSource, invalidOwner);
    assert.equal(
      await access.readText(clockPath),
      invalidOwner === "owner-done" ? clockSource.replace("- [ ] Timed", "- [x] Timed") : clockSource,
      invalidOwner,
    );
    assert.equal(await access.readText(thirdPath), invalidOwner === "new-collision" ? thirdSource : undefined, invalidOwner);
    retryWriter.dispose();
  }
});

test("already-applied duplicate repair rejects a new unselected potential after reload", async () => {
  const selectedPath = "Daily/A-Selected-Retry-Potential.md";
  const unselectedPath = "Daily/B-Unselected-Retry-Potential.md";
  const selectedSource = `${OPEN}\n- [ ] Selected owner d30m ^${PLAN_A}\n${CLOSE}\n`;
  const unselectedSource = `${OPEN}\n- [ ] Remaining owner d30m ^${PLAN_A}\n${CLOSE}\n`;
  const repairedSource = selectedSource.replace(`^${PLAN_A}`, `^${PLAN_NEW}`);
  const potentialSource = unselectedSource.replace(
    CLOSE,
    `  - LOGBOOK::\n    - CLOCK: [broken]\n${CLOSE}`,
  );
  const access = new MemoryAtomicTextAccess({
    [selectedPath]: selectedSource,
    [unselectedPath]: unselectedSource,
  });
  const repair = createMutationPlan({
    intentId: "selected-potential-retry-unselected",
    action: "repair-plan-item-identity",
    stages: [{
      path: selectedPath,
      confirmationRequired: true,
      operations: [{
        kind: "repair-plan-item-identity",
        target: { kind: "plan-item", id: PLAN_A },
        newId: PLAN_NEW,
      }],
    }],
    expectedRunningClockIds: [],
    settingsVersion: CONTEXT.settingsVersion,
    zoneId: CONTEXT.zoneId,
  });
  const expectation = await mutationExpectation(access, repair, { planIds: [PLAN_A] });
  const firstWriter = new WorkspaceCommitter(access, { readContext: () => CONTEXT });
  const applied = await firstWriter.commit(repair, expectation);
  assert.equal(applied.outcome, "applied");
  assert.equal(applied.confirmation, "confirmed");
  firstWriter.dispose();

  access.modify(unselectedPath, potentialSource);
  const selectedTransactionsBeforeRetry = access.transactionCounts.get(selectedPath);
  const retryWriter = new WorkspaceCommitter(access, { readContext: () => CONTEXT });

  const retry = await retryWriter.commit(repair, expectation);

  assert.equal(retry.outcome, "conflict", JSON.stringify(retry));
  assert.equal(retry.confirmation, "confirmed-no-change");
  assert.equal(retry.result?.code, "potential-running-clock");
  assert.equal(retry.globalCheck.status, "violated");
  assert.equal(access.transactionCounts.get(selectedPath), selectedTransactionsBeforeRetry);
  assert.equal(await access.readText(selectedPath), repairedSource);
  assert.equal(await access.readText(unselectedPath), potentialSource);
  retryWriter.dispose();
});

test("selected malformed potential owner repair applies while Clock In and switch remain zero-write", async () => {
  const selectedPath = "Daily/A-Selected-Potential-Owner.md";
  const duplicatePath = "Daily/Z-Unselected-Potential-Owner.md";
  const activePath = "Daily/Active-For-Potential.md";
  const targetPath = "Daily/Target-For-Potential.md";
  const repairedOwner = "nl-44444444-4444-4444-8444-444444444444";
  const selectedSource = `${OPEN}\n- [ ] Selected owner d30m ^${PLAN_A}\n  - LOGBOOK::\n    - CLOCK: [broken]\n${CLOSE}\n`;
  const duplicateSource = `${OPEN}\n- [ ] Duplicate owner d30m ^${PLAN_A}\n${CLOSE}\n`;
  const activeSource = `${OPEN}\n- [ ] Active owner d30m ^${PLAN_NEW}\n  - LOGBOOK::\n    - ${formatCanonicalRunningClock(NOW - 60_000, 480, CLOCK_A)}\n${CLOSE}\n`;
  const targetSource = `${OPEN}\n- [ ] Unrelated target d30m ^${PLAN_B}\n${CLOSE}\n`;
  const initial = {
    [selectedPath]: selectedSource,
    [duplicatePath]: duplicateSource,
    [activePath]: activeSource,
    [targetPath]: targetSource,
  };

  const clockInAccess = new MemoryAtomicTextAccess(initial);
  const clockIn = clockInPlanAt(targetPath, "selected-potential-clock-in", [CLOCK_A]);
  const clockInExpectation = await mutationExpectation(clockInAccess, clockIn, {
    planIds: [PLAN_B],
    expectedRunningClockIds: [CLOCK_A],
  });
  const clockInWriter = new WorkspaceCommitter(clockInAccess, { readContext: () => CONTEXT });
  const blockedClockIn = await clockInWriter.commit(clockIn, clockInExpectation);
  assert.equal(blockedClockIn.result?.code, "potential-running-clock");
  assert.equal(clockInAccess.transactionCounts.size, 0);
  clockInWriter.dispose();

  const switchAccess = new MemoryAtomicTextAccess(initial);
  const switchPlan = createMutationPlan({
    intentId: "selected-potential-switch",
    action: "switch-task",
    stages: [{
      path: activePath,
      confirmationRequired: false,
      operations: [{
        kind: "clock-out",
        target: { kind: "clock", id: CLOCK_A, ownerId: PLAN_NEW },
        close: { clockId: CLOCK_A, endEpochMs: NOW, offsetMinutes: 480 },
      }],
    }, {
      path: targetPath,
      confirmationRequired: false,
      operations: [{
        kind: "clock-in",
        target: { kind: "plan-item", id: PLAN_B },
        clock: { clockId: CLOCK_NEW, startEpochMs: NOW, offsetMinutes: 480 },
      }],
    }],
    expectedRunningClockIds: [CLOCK_A],
    settingsVersion: CONTEXT.settingsVersion,
    zoneId: CONTEXT.zoneId,
    transitionEpochMs: NOW,
  });
  const switchExpectation = await mutationExpectation(switchAccess, switchPlan, {
    planIds: [PLAN_B],
    clockIds: [CLOCK_A],
    expectedRunningClockIds: [CLOCK_A],
  });
  const switchWriter = new WorkspaceCommitter(switchAccess, { readContext: () => CONTEXT });
  const blockedSwitch = await switchWriter.commit(switchPlan, switchExpectation);
  assert.equal(blockedSwitch.result?.code, "potential-running-clock");
  assert.equal(switchAccess.transactionCounts.size, 0);
  switchWriter.dispose();

  const repairAccess = new MemoryAtomicTextAccess(initial);
  const repair = createMutationPlan({
    intentId: "selected-potential-owner-repair",
    action: "repair-plan-item-identity",
    stages: [{
      path: selectedPath,
      confirmationRequired: true,
      operations: [{
        kind: "repair-plan-item-identity",
        target: { kind: "plan-item", id: PLAN_A },
        newId: repairedOwner,
      }],
    }],
    expectedRunningClockIds: [CLOCK_A],
    settingsVersion: CONTEXT.settingsVersion,
    zoneId: CONTEXT.zoneId,
  });
  const repairExpectation = await mutationExpectation(repairAccess, repair, {
    planIds: [PLAN_A],
    expectedRunningClockIds: [CLOCK_A],
  });
  assert.equal(repairExpectation.selectedRepair?.selectedSpan.path, selectedPath);
  const repairWriter = new WorkspaceCommitter(repairAccess, { readContext: () => CONTEXT });

  const receipt = await repairWriter.commit(repair, repairExpectation);

  assert.equal(receipt.outcome, "applied", JSON.stringify(receipt));
  assert.equal(receipt.confirmation, "confirmed");
  assert.deepEqual(receipt.globalCheck, { status: "violated", runningClockIds: [CLOCK_A] });
  assert.equal(repairWriter.blocked, false);
  assert.equal(repairAccess.transactionCounts.get(selectedPath), 1);
  assert.equal(repairAccess.transactionCounts.has(duplicatePath), false);
  assert.equal(await repairAccess.readText(selectedPath), selectedSource.replace(`^${PLAN_A}`, `^${repairedOwner}`));
  assert.equal(await repairAccess.readText(duplicatePath), duplicateSource);
  assert.equal(await repairAccess.readText(activePath), activeSource);
  assert.equal(await repairAccess.readText(targetPath), targetSource);
  repairWriter.dispose();

  const retryWriter = new WorkspaceCommitter(repairAccess, { readContext: () => CONTEXT });
  const retry = await retryWriter.commit(repair, repairExpectation);
  assert.equal(retry.outcome, "already-applied", JSON.stringify(retry));
  assert.equal(retry.confirmation, "confirmed");
  assert.deepEqual(retry.globalCheck, { status: "violated", runningClockIds: [CLOCK_A] });
  assert.equal(retryWriter.blocked, false);
  assert.equal(repairAccess.transactionCounts.get(selectedPath), 1);
  retryWriter.dispose();
});

test("unselected malformed potential remains blocking during selected duplicate owner repair", async () => {
  const selectedPath = "Daily/A-Selected-Clock-Free-Potential.md";
  const potentialPath = "Daily/Z-Unselected-Potential.md";
  const selectedSource = `${OPEN}\n- [ ] Selected clock-free owner d30m ^${PLAN_A}\n${CLOSE}\n`;
  const potentialSource = `${OPEN}\n- [ ] Unselected potential owner d30m ^${PLAN_A}\n  - LOGBOOK::\n    - CLOCK: [broken]\n${CLOSE}\n`;
  const access = new MemoryAtomicTextAccess({
    [selectedPath]: selectedSource,
    [potentialPath]: potentialSource,
  });
  const repair = createMutationPlan({
    intentId: "unselected-potential-owner-repair",
    action: "repair-plan-item-identity",
    stages: [{
      path: selectedPath,
      confirmationRequired: true,
      operations: [{
        kind: "repair-plan-item-identity",
        target: { kind: "plan-item", id: PLAN_A },
        newId: PLAN_NEW,
      }],
    }],
    expectedRunningClockIds: [],
    settingsVersion: CONTEXT.settingsVersion,
    zoneId: CONTEXT.zoneId,
  });
  const expectation = await mutationExpectation(access, repair, { planIds: [PLAN_A] });
  assert.equal(expectation.selectedRepair?.selectedSpan.path, selectedPath);
  const writer = new WorkspaceCommitter(access, { readContext: () => CONTEXT });

  const receipt = await writer.commit(repair, expectation);

  assert.equal(receipt.outcome, "conflict");
  assert.equal(receipt.result?.code, "potential-running-clock");
  assert.equal(access.transactionCounts.size, 0);
  assert.equal(await access.readText(selectedPath), selectedSource);
  assert.equal(await access.readText(potentialPath), potentialSource);
  writer.dispose();
});

test("unselected running CLOCK recovery remains limited to exactly two duplicate owners", async () => {
  const selectedPath = "Daily/A-Selected-Three-Way.md";
  const clockPath = "Daily/M-Clock-Three-Way.md";
  const thirdPath = "Daily/Z-Third-Three-Way.md";
  const legacyText = "CLOCK: [2026-08-28 08:10]";
  const selectedSource = `${OPEN}\n- [ ] Selected clock-free owner d30m ^${PLAN_A}\n${CLOSE}\n`;
  const clockSource = `${OPEN}\n- [ ] Timed owner d30m ^${PLAN_A}\n  - LOGBOOK::\n    - ${legacyText}\n${CLOSE}\n`;
  const thirdSource = `${OPEN}\n- [ ] Third clock-free owner d30m ^${PLAN_A}\n${CLOSE}\n`;
  const access = new MemoryAtomicTextAccess({
    [selectedPath]: selectedSource,
    [clockPath]: clockSource,
    [thirdPath]: thirdSource,
  });
  const resolveLocalTime = () => ({ kind: "unique" as const, epochMs: NOW - 60_000 });
  const parsedClock = readLogbook(clockSource, {
    path: clockPath,
    itemFromOffset: clockSource.indexOf("- [ ]"),
    itemToOffset: clockSource.indexOf(CLOSE),
    ownerId: PLAN_A,
  }, { resolveLocalTime }).clocks[0]!;
  const runningKey = legacyRunningClockKey(parsedClock.path, parsedClock.fromOffset, parsedClock.text);
  const repair = createMutationPlan({
    intentId: "three-way-unselected-running-owner-repair",
    action: "repair-plan-item-identity",
    stages: [{
      path: selectedPath,
      confirmationRequired: true,
      operations: [{
        kind: "repair-plan-item-identity",
        target: { kind: "plan-item", id: PLAN_A },
        newId: PLAN_NEW,
      }],
    }],
    expectedRunningClockIds: [runningKey],
    settingsVersion: CONTEXT.settingsVersion,
    zoneId: CONTEXT.zoneId,
  });
  const expectation = await mutationExpectation(access, repair, {
    planIds: [PLAN_A],
    expectedRunningClockIds: [runningKey],
  });
  assert.equal(expectation.selectedRepair?.selectedSpan.path, selectedPath);
  assert.equal(expectation.selectedRepair?.locations.length, 3);
  const writer = new WorkspaceCommitter(access, {
    readContext: () => CONTEXT,
    index: { clockParsing: { resolveLocalTime } },
    logbook: { resolveLocalTime },
  });

  const receipt = await writer.commit(repair, expectation);

  assert.equal(receipt.outcome, "conflict");
  assert.equal(receipt.result?.code, "clock-owner-invalid");
  assert.equal(access.transactionCounts.size, 0);
  assert.equal(await access.readText(selectedPath), selectedSource);
  assert.equal(await access.readText(clockPath), clockSource);
  assert.equal(await access.readText(thirdPath), thirdSource);
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

test("anonymous done fixed and plain CLOCK facts block unrelated Clock In", async () => {
  const factPath = "Daily/Anonymous-Invalid-Owner.md";
  const targetPath = "Daily/Invalid-Owner-Target.md";
  const targetSource = `${OPEN}\n- [ ] Eligible task d30m ^${PLAN_B}\n${CLOSE}\n`;
  const resolveLocalTime = () => ({ kind: "unique" as const, epochMs: NOW - 60_000 });
  for (const fixture of [
    { name: "done-running", ownerLine: "- [x] Done task", clockText: "CLOCK: [2026-08-28 08:01]", code: "clock-owner-invalid" },
    { name: "fixed-running", ownerLine: "- [ ] Fixed event 08:00-09:00", clockText: "CLOCK: [2026-08-28 08:02]", code: "clock-owner-invalid" },
    { name: "plain-running", ownerLine: "- Plain item", clockText: "CLOCK: [2026-08-28 08:03]", code: "clock-owner-invalid" },
    { name: "done-potential", ownerLine: "- [x] Done task", clockText: "CLOCK: [broken]", code: "potential-running-clock" },
    { name: "fixed-potential", ownerLine: "- [ ] Fixed event 08:00-09:00", clockText: "CLOCK: [broken]", code: "potential-running-clock" },
    { name: "plain-potential", ownerLine: "- Plain item", clockText: "CLOCK: [broken]", code: "potential-running-clock" },
  ] as const) {
    const factSource = `${OPEN}\n${fixture.ownerLine}\n  - LOGBOOK::\n    - ${fixture.clockText}\n${CLOSE}\n`;
    const access = new MemoryAtomicTextAccess({
      [factPath]: factSource,
      [targetPath]: targetSource,
    });
    const index = new WorkspaceIndex(access, { clockParsing: { resolveLocalTime } });
    const snapshot = await index.rebuild();
    assert.equal(snapshot.complete, true, fixture.name);
    assert.equal(snapshot.clocks.length, 0, fixture.name);
    assert.equal(index.safetySnapshot.clocks.length, 1, fixture.name);
    assert.equal(
      index.safetySnapshot.running.length + index.safetySnapshot.potentialRunning.length,
      1,
      fixture.name,
    );
    assert.equal(index.safetySnapshot.clocks[0]?.ownerId, undefined, fixture.name);
    index.dispose();

    const mutation = clockInPlanAt(targetPath, `invalid-owner-${fixture.name}`);
    const expectation = await mutationExpectation(access, mutation, { planIds: [PLAN_B] });
    const writer = new WorkspaceCommitter(access, {
      readContext: () => CONTEXT,
      index: { clockParsing: { resolveLocalTime } },
      logbook: { resolveLocalTime },
    });
    const receipt = await writer.commit(mutation, expectation);
    assert.equal(receipt.outcome, "conflict", fixture.name);
    assert.equal(receipt.result?.code, fixture.code, fixture.name);
    assert.equal(receipt.globalCheck.status, "violated", fixture.name);
    assert.equal(access.transactionCounts.size, 0, fixture.name);
    assert.equal(await access.readText(factPath), factSource, fixture.name);
    assert.equal(await access.readText(targetPath), targetSource, fixture.name);
    writer.dispose();
  }
});

test("ordinary foreign fenced and HTML CLOCK-looking text stays outside global facts", async () => {
  const path = "Daily/Excluded-Clock-Examples.md";
  const source = [
    OPEN,
    "CLOCK: [2026-08-28 08:11]",
    "- [-] Foreign task",
    "  - LOGBOOK::",
    "    - CLOCK: [2026-08-28 08:12]",
    "```md",
    "- [x] Fenced task",
    "  - LOGBOOK::",
    "    - CLOCK: [2026-08-28 08:13]",
    "```",
    "<div>",
    "- Plain HTML item",
    "  - LOGBOOK::",
    "    - CLOCK: [2026-08-28 08:14]",
    "</div>",
    "",
    `- [ ] Eligible task d30m ^${PLAN_B}`,
    CLOSE,
    "",
  ].join("\n");
  const access = new MemoryAtomicTextAccess({ [path]: source });
  const resolveLocalTime = () => ({ kind: "unique" as const, epochMs: NOW - 60_000 });
  const index = new WorkspaceIndex(access, { clockParsing: { resolveLocalTime } });
  const snapshot = await index.rebuild();
  assert.equal(snapshot.complete, true);
  assert.deepEqual(snapshot.clocks, []);
  assert.deepEqual(snapshot.running, []);
  assert.deepEqual(snapshot.potentialRunning, []);
  const target = index.identity(PLAN_B);
  assert.equal(target.kind, "unique");
  if (target.kind === "unique") assert.equal(target.location.path, path);
  index.dispose();

  const mutation = clockInPlanAt(path, "excluded-clock-examples");
  const expectation = await mutationExpectation(access, mutation, { planIds: [PLAN_B] });
  const writer = new WorkspaceCommitter(access, {
    readContext: () => CONTEXT,
    index: { clockParsing: { resolveLocalTime } },
    logbook: { resolveLocalTime },
  });
  const receipt = await writer.commit(mutation, expectation);
  assert.equal(receipt.outcome, "applied");
  assert.deepEqual(receipt.globalCheck, { status: "confirmed", runningClockIds: [CLOCK_NEW] });
  assert.equal(access.transactionCounts.get(path), 1);
  const after = await access.readText(path);
  for (const clockText of ["08:11", "08:12", "08:13", "08:14"]) {
    assert.equal(after?.match(new RegExp(`CLOCK: \\[2026-08-28 ${clockText}\\]`, "g"))?.length, 1);
  }
  writer.dispose();

  const confirmedIndex = new WorkspaceIndex(access, { clockParsing: { resolveLocalTime } });
  const confirmed = await confirmedIndex.rebuild();
  assert.equal(confirmed.clocks.length, 1);
  assert.equal(confirmed.running[0]?.clockId, CLOCK_NEW);
  assert.equal(confirmed.running[0]?.ownerId, PLAN_B);
  confirmedIndex.dispose();
});

test("callback scan rejects newly inserted non-foreign anonymous CLOCK facts without plugin bytes", async () => {
  const path = "Daily/Anonymous-Callback.md";
  const source = `${OPEN}\n- [ ] Eligible task d30m ^${PLAN_B}\n${CLOSE}\n`;
  const resolveLocalTime = () => ({ kind: "unique" as const, epochMs: NOW - 60_000 });
  for (const fixture of [
    {
      intentId: "anonymous-callback-open",
      ownerLine: "- [ ] Anonymous task d30m",
      clockText: "CLOCK: [2026-08-28 08:10]",
      code: "clock-owner-invalid",
      globalStatus: "unavailable",
    },
    {
      intentId: "anonymous-callback-done",
      ownerLine: "- [x] Anonymous task",
      clockText: "CLOCK: [2026-08-28 08:10]",
      code: "clock-owner-invalid",
      globalStatus: "unavailable",
    },
    {
      intentId: "anonymous-callback-fixed",
      ownerLine: "- [ ] Anonymous event 08:00-09:00",
      clockText: "CLOCK: [2026-08-28 08:10]",
      code: "clock-owner-invalid",
      globalStatus: "unavailable",
    },
    {
      intentId: "anonymous-callback-plain",
      ownerLine: "- Anonymous item",
      clockText: "CLOCK: [2026-08-28 08:10]",
      code: "clock-owner-invalid",
      globalStatus: "unavailable",
    },
    {
      intentId: "anonymous-callback-potential",
      ownerLine: "- [x] Anonymous task",
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
      `${fixture.ownerLine}\n  - LOGBOOK::\n    - ${fixture.clockText}\n- [ ] Eligible task d30m ^${PLAN_B}`,
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
  assert.deepEqual(parsed.running, []);
  assert.equal(parsedIndex.safetySnapshot.running.length, 1);
  const parsedClock = parsedIndex.safetySnapshot.running[0]!;
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
  assert.equal(rejected.result?.code, "clock-owner-invalid");
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

test("normalizing an anonymous running CLOCK cannot confirm an invalid final owner", async () => {
  const path = "Daily/Anonymous-Normalize.md";
  const legacyText = "CLOCK: [2026-08-28 08:10]";
  const source = `${OPEN}\n- [ ] Anonymous task d30m\n  - LOGBOOK::\n    - ${legacyText}\n${CLOSE}\n`;
  const legacyStart = Date.UTC(2026, 7, 28, 0, 10);
  const resolveLocalTime = () => ({ kind: "unique" as const, epochMs: legacyStart });
  const access = new MemoryAtomicTextAccess({ [path]: source });
  const parsedIndex = new WorkspaceIndex(access, { clockParsing: { resolveLocalTime } });
  const parsed = await parsedIndex.rebuild();
  assert.deepEqual(parsed.running, []);
  assert.equal(parsedIndex.safetySnapshot.running.length, 1);
  const parsedClock = parsedIndex.safetySnapshot.running[0]!;
  const runningKey = legacyRunningClockKey(parsedClock.path, parsedClock.fromOffset, parsedClock.text);
  parsedIndex.dispose();
  const mutation = createMutationPlan({
    intentId: "anonymous-normalize-final-owner",
    action: "normalize-legacy-clock",
    stages: [{
      path,
      confirmationRequired: true,
      operations: [{
        kind: "normalize-legacy-clock",
        target: { kind: "clock", fromOffset: parsedClock.fromOffset },
        clockId: CLOCK_NEW,
        startEpochMs: legacyStart,
        startOffsetMinutes: 480,
      }],
    }],
    expectedRunningClockIds: [runningKey],
    settingsVersion: CONTEXT.settingsVersion,
    zoneId: CONTEXT.zoneId,
  });
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

  assert.equal(receipt.outcome, "invariant-broken", JSON.stringify(receipt));
  assert.equal(receipt.confirmation, "invariant-broken");
  assert.equal(receipt.result?.code, "write-invariant-broken");
  assert.equal(receipt.globalCheck.status, "violated");
  assert.deepEqual(receipt.globalCheck.runningClockIds, [CLOCK_NEW]);
  assert.equal(writer.blocked, true);
  assert.equal(await access.readText(path), source.replace(
    legacyText,
    formatCanonicalRunningClock(legacyStart, 480, CLOCK_NEW),
  ));
  assert.equal(access.transactionCounts.get(path), 1);
  assert.deepEqual(receipt.sources.map(({ changed }) => changed), [true]);
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

test("same-file owner status race rejects before completing an unrelated task", async () => {
  const running = formatCanonicalRunningClock(NOW - 60_000, 480, CLOCK_A);
  const source = `${OPEN}\n- [ ] Active ^${PLAN_A}\n  - LOGBOOK::\n    - ${running}\n- [ ] Target ^${PLAN_B}\n${CLOSE}\n`;
  const externallyDone = source.replace(`- [ ] Active ^${PLAN_A}`, `- [x] Active ^${PLAN_A}`);
  const access = new MemoryAtomicTextAccess({ [PATH]: source });
  const mutation = createMutationPlan({
    intentId: "owner-status-callback-race",
    action: "complete",
    stages: [{
      path: PATH,
      confirmationRequired: false,
      operations: [{ kind: "complete", target: { kind: "plan-item", id: PLAN_B } }],
    }],
    expectedRunningClockIds: [CLOCK_A],
    settingsVersion: CONTEXT.settingsVersion,
    zoneId: CONTEXT.zoneId,
  });
  const expectation = await mutationExpectation(access, mutation, {
    planIds: [PLAN_B],
    expectedRunningClockIds: [CLOCK_A],
  });
  access.raceBeforeCallback(PATH, () => externallyDone);
  const writer = new WorkspaceCommitter(access, { readContext: () => CONTEXT });

  const receipt = await writer.commit(mutation, expectation);

  assert.equal(receipt.outcome, "conflict");
  assert.equal(receipt.result?.code, "clock-owner-invalid");
  assert.equal(receipt.confirmation, "confirmed-no-change");
  assert.equal(receipt.globalCheck.status, "unavailable");
  assert.equal(await access.readText(PATH), externallyDone);
  assert.equal((await access.readText(PATH))?.includes(`- [ ] Target ^${PLAN_B}`), true);
  assert.equal(access.transactionCounts.get(PATH), 1);
  assert.equal(access.callbackCounts.get(PATH), 1);
  assert.deepEqual(receipt.sources.map(({ changed }) => changed), [false]);
  writer.dispose();
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
  for (const [container, linePrefix] of [
    ["ordinary", "- "],
    ["blockquote-list", "> - "],
    ["blockquote-bare", "> "],
    ["nested-blockquote-bare", "> > "],
  ] as const) for (const action of ["clock-out", "stop-at-trusted-time", "delete-clock"] as const) {
    const source = `# Orphan recovery\n${linePrefix}${running}\n`;
    const access = new MemoryAtomicTextAccess({ [PATH]: source });
    const plan = createMutationPlan({
      intentId: `orphan-${container}-${action}`,
      action,
      stages: [{
        path: PATH,
        confirmationRequired: false,
        operations: action !== "delete-clock"
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
    const isTimingRepair = action === "stop-at-trusted-time";
    const expectation = orphanClockExpectation(plan, PATH, source, running, isTimingRepair);
    const writer = new WorkspaceCommitter(access, {
      readContext: () => isTimingRepair ? { ...CONTEXT, discontinuity: true } : CONTEXT,
    });
    const receipt = await writer.commit(plan, expectation);
    assert.equal(receipt.outcome, "applied", `${container}/${action}: ${JSON.stringify(receipt)}`);
    assert.equal(receipt.sources[0]?.path, PATH);
    assert.equal(
      await access.readText(PATH),
      action !== "delete-clock"
        ? source.replace(running, formatCanonicalClosedClock(NOW - 60_000, 480, NOW, 480, CLOCK_A))
        : "# Orphan recovery\n",
      `${container}/${action}`,
    );
    writer.dispose();

    const transactionsAfterApply = [...access.transactionCounts.entries()];
    const retryWriter = new WorkspaceCommitter(access, {
      readContext: () => isTimingRepair ? { ...CONTEXT, discontinuity: true } : CONTEXT,
    });
    const retry = await retryWriter.commit(plan, expectation);
    assert.equal(
      retry.outcome,
      action === "delete-clock" ? "already-applied" : "rejected",
      `${container}/${action}: ${JSON.stringify(retry)}`,
    );
    assert.deepEqual([...access.transactionCounts.entries()], transactionsAfterApply, `${container}/${action}`);
    assert.equal(
      await access.readText(PATH),
      action !== "delete-clock"
        ? source.replace(running, formatCanonicalClosedClock(NOW - 60_000, 480, NOW, 480, CLOCK_A))
        : "# Orphan recovery\n",
      `${container}/${action}/retry`,
    );
    retryWriter.dispose();
  }
});

test("quoted orphan Delete distinguishes attached content from quote and list boundaries", async () => {
  const running = formatCanonicalRunningClock(NOW - 60_000, 480, CLOCK_A);
  const cases = [
    {
      name: "same-depth-continuation",
      source: `# Quoted orphan\n> - ${running}\n>   continuation\n`,
      expectedCode: "clock-has-attached-content",
    },
    {
      name: "deeper-quote",
      source: `# Quoted orphan\n> - ${running}\n> > nested evidence\n`,
      expectedAfter: "# Quoted orphan\n> > nested evidence\n",
    },
    {
      name: "indented-deeper-quote",
      source: `# Quoted orphan\n> - ${running}\n>   > nested evidence\n`,
      expectedCode: "clock-has-attached-content",
    },
    {
      name: "lazy-continuation",
      source: `# Quoted orphan\n> - ${running}\n  lazy continuation\n`,
      expectedCode: "clock-has-attached-content",
    },
    {
      name: "zero-indent-lazy-continuation",
      source: `# Quoted orphan\n> - ${running}\nlazy continuation\n`,
      expectedCode: "clock-has-attached-content",
    },
    {
      name: "quote-exit",
      source: `# Quoted orphan\n> - ${running}\n\nOutside quote\n`,
      expectedAfter: "# Quoted orphan\n\nOutside quote\n",
    },
    {
      name: "same-depth-sibling",
      source: `# Quoted orphan\n> - ${running}\n> - sibling\n`,
      expectedAfter: "# Quoted orphan\n> - sibling\n",
    },
  ] as const;

  for (const entry of cases) {
    const access = new MemoryAtomicTextAccess({ [PATH]: entry.source });
    const plan = createMutationPlan({
      intentId: `quoted-delete-${entry.name}`,
      action: "delete-clock",
      stages: [{
        path: PATH,
        confirmationRequired: false,
        operations: [{
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
    const expectation = orphanClockExpectation(plan, PATH, entry.source, running);
    const writer = new WorkspaceCommitter(access, { readContext: () => CONTEXT });

    const receipt = await writer.commit(plan, expectation);

    if ("expectedCode" in entry) {
      assert.equal(receipt.outcome, "rejected", `${entry.name}: ${JSON.stringify(receipt)}`);
      assert.equal(receipt.confirmation, "confirmed-no-change", entry.name);
      assert.equal(receipt.result?.code, entry.expectedCode, entry.name);
      assert.equal(receipt.globalCheck.status, "violated", entry.name);
      assert.equal(access.transactionCounts.size, 0, entry.name);
      assert.equal(await access.readText(PATH), entry.source, entry.name);
    } else {
      assert.equal(receipt.outcome, "applied", `${entry.name}: ${JSON.stringify(receipt)}`);
      assert.equal(await access.readText(PATH), entry.expectedAfter, entry.name);
    }
    writer.dispose();
  }
});

test("orphan recovery preserves sibling blocks after list and blank paragraph boundaries", async () => {
  const running = formatCanonicalRunningClock(NOW - 60_000, 480, CLOCK_A);
  const closed = formatCanonicalClosedClock(NOW - 180_000, 480, NOW - 120_000, 480, CLOCK_A);
  const cases: Array<{ readonly name: string; readonly source: string; readonly eol: "\n" | "\r\n" }> = [
    { name: "ordinary-list-sibling-quote", source: `- ${running}\n> nested\n`, eol: "\n" },
    { name: "quoted-list-sibling-quote", source: `> - ${running}\n> > nested\n`, eol: "\n" },
    {
      name: "nested-tab-list-sibling-quote",
      source: `>\t>\t-\t${running}\r\n>\t>\t>\tnested\r\n`,
      eol: "\r\n",
    },
  ];
  for (const container of [
    { name: "ordinary-lf", prefix: "", eol: "\n" as const },
    { name: "quoted-crlf", prefix: "> ", eol: "\r\n" as const },
    { name: "nested-tab-lf", prefix: ">\t>\t", eol: "\n" as const },
  ]) for (const sibling of [
    { name: "list", text: "- sibling" },
    { name: "heading", text: "# sibling" },
    { name: "fence", text: "```" },
    { name: "deeper-quote", text: "> nested" },
  ]) {
    cases.push({
      name: `${container.name}-blank-${sibling.name}`,
      source: `${container.prefix}${running}${container.eol}${container.prefix.trimEnd()}${container.eol}${container.prefix}${sibling.text}${container.eol}`,
      eol: container.eol,
    });
  }

  for (const entry of cases) for (const action of [
    "delete-clock",
    "clock-out",
    "repair-clock-identity",
  ] as const) {
    const caseName = `${entry.name}-${action}`;
    const selectedPath = `Daily/Boundary-${caseName}.md`;
    const duplicatePath = `Daily/Boundary-${caseName}-Duplicate.md`;
    const duplicateSource = `- ${closed}\n`;
    const access = new MemoryAtomicTextAccess({
      [selectedPath]: entry.source,
      ...(action === "repair-clock-identity" ? { [duplicatePath]: duplicateSource } : {}),
    });
    const plan = exactOrphanRecoveryPlan(action, selectedPath, `boundary-${caseName}`);
    const expectation = action === "repair-clock-identity"
      ? await orphanClockIdentityRepairExpectation(
          access,
          plan,
          selectedPath,
          entry.source,
          running,
          [CLOCK_A],
        )
      : orphanClockExpectation(plan, selectedPath, entry.source, running);
    const writer = new WorkspaceCommitter(access, { readContext: () => CONTEXT });

    const applied = await writer.commit(plan, expectation);

    assert.equal(applied.outcome, "applied", `${caseName}: ${JSON.stringify(applied)}`);
    const firstLineEnd = entry.source.indexOf(entry.eol) + entry.eol.length;
    const expectedSelected = action === "delete-clock"
      ? entry.source.slice(firstLineEnd)
      : action === "repair-clock-identity"
        ? entry.source.replace(`^${CLOCK_A}`, `^${CLOCK_NEW}`)
        : entry.source.replace(
            running,
            formatCanonicalClosedClock(NOW - 60_000, 480, NOW, 480, CLOCK_A),
          );
    assert.equal(await access.readText(selectedPath), expectedSelected, caseName);
    assert.equal(access.transactionCounts.get(selectedPath), 1, caseName);
    if (action === "repair-clock-identity") {
      assert.equal(await access.readText(duplicatePath), duplicateSource, caseName);
      assert.equal(access.transactionCounts.has(duplicatePath), false, caseName);
    }
    writer.dispose();

    const transactionsAfterApply = [...access.transactionCounts.entries()];
    const retryWriter = new WorkspaceCommitter(access, { readContext: () => CONTEXT });
    const retry = await retryWriter.commit(plan, expectation);
    assert.equal(
      retry.outcome,
      action === "clock-out" ? "rejected" : "already-applied",
      `${caseName}/retry: ${JSON.stringify(retry)}`,
    );
    assert.equal(await access.readText(selectedPath), expectedSelected, `${caseName}/retry`);
    assert.deepEqual([...access.transactionCounts.entries()], transactionsAfterApply, caseName);
    if (action === "repair-clock-identity") {
      assert.equal(await access.readText(duplicatePath), duplicateSource, `${caseName}/retry`);
    }
    retryWriter.dispose();
  }
});

test("orphan recovery rejects genuinely nested list content and lazy continuations", async () => {
  const running = formatCanonicalRunningClock(NOW - 60_000, 480, CLOCK_A);
  const closed = formatCanonicalClosedClock(NOW - 180_000, 480, NOW - 120_000, 480, CLOCK_A);
  for (const entry of [
    { name: "ordinary-nested", source: `- ${running}\n  > nested\n` },
    { name: "quoted-nested", source: `> - ${running}\n>   > nested\n` },
    { name: "nested-tab", source: `>\t>\t-\t${running}\r\n>\t>\t\t>\tnested\r\n` },
    { name: "lazy", source: `> - ${running}\nlazy continuation\n` },
  ] as const) for (const action of [
    "delete-clock",
    "clock-out",
    "repair-clock-identity",
  ] as const) {
    const caseName = `${entry.name}-${action}`;
    const selectedPath = `Daily/Attached-${caseName}.md`;
    const duplicatePath = `Daily/Attached-${caseName}-Duplicate.md`;
    const duplicateSource = `- ${closed}\n`;
    const access = new MemoryAtomicTextAccess({
      [selectedPath]: entry.source,
      ...(action === "repair-clock-identity" ? { [duplicatePath]: duplicateSource } : {}),
    });
    const plan = exactOrphanRecoveryPlan(action, selectedPath, `attached-${caseName}`);
    const expectation = action === "repair-clock-identity"
      ? await orphanClockIdentityRepairExpectation(
          access,
          plan,
          selectedPath,
          entry.source,
          running,
          [CLOCK_A],
        )
      : orphanClockExpectation(plan, selectedPath, entry.source, running);
    const writer = new WorkspaceCommitter(access, { readContext: () => CONTEXT });

    const rejected = await writer.commit(plan, expectation);

    assert.equal(
      rejected.outcome,
      action === "delete-clock" ? "rejected" : "conflict",
      `${caseName}: ${JSON.stringify(rejected)}`,
    );
    assert.equal(
      rejected.result?.code,
      action === "delete-clock" ? "clock-has-attached-content" : "source-conflict",
      caseName,
    );
    assert.equal(rejected.confirmation, "confirmed-no-change", caseName);
    assert.equal(access.transactionCounts.size, 0, caseName);
    assert.equal(await access.readText(selectedPath), entry.source, caseName);
    if (action === "repair-clock-identity") {
      assert.equal(await access.readText(duplicatePath), duplicateSource, caseName);
    }
    writer.dispose();
  }
});

test("orphan Delete treats same-container dash setext underlines as attached content", async () => {
  const running = formatCanonicalRunningClock(NOW - 60_000, 480, CLOCK_A);
  const cases = [
    {
      name: "ordinary-bare",
      source: `${running}\n---\n`,
    },
    {
      name: "quoted-bare",
      source: `> ${running}\n> ---\n`,
    },
    {
      name: "nested-quoted-bare",
      source: `> > ${running}\n> > ---\n`,
    },
    {
      name: "quoted-bare-crlf",
      source: `> ${running}\r\n> ---\r\n`,
    },
  ] as const;

  for (const entry of cases) {
    const access = new MemoryAtomicTextAccess({ [PATH]: entry.source });
    const plan = createMutationPlan({
      intentId: `setext-delete-${entry.name}`,
      action: "delete-clock",
      stages: [{
        path: PATH,
        confirmationRequired: false,
        operations: [{
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
    const expectation = orphanClockExpectation(plan, PATH, entry.source, running);
    const writer = new WorkspaceCommitter(access, { readContext: () => CONTEXT });

    const receipt = await writer.commit(plan, expectation);

    assert.equal(receipt.outcome, "rejected", `${entry.name}: ${JSON.stringify(receipt)}`);
    assert.equal(receipt.confirmation, "confirmed-no-change", entry.name);
    assert.equal(receipt.result?.code, "clock-has-attached-content", entry.name);
    assert.equal(receipt.globalCheck.status, "violated", entry.name);
    assert.equal(access.transactionCounts.size, 0, entry.name);
    assert.equal(await access.readText(PATH), entry.source, entry.name);
    writer.dispose();
  }

  const quoteExitSource = `> ${running}\n---\n`;
  const quoteExitAccess = new MemoryAtomicTextAccess({ [PATH]: quoteExitSource });
  const quoteExitPlan = createMutationPlan({
    intentId: "setext-delete-lower-quote-exit",
    action: "delete-clock",
    stages: [{
      path: PATH,
      confirmationRequired: false,
      operations: [{
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
  const quoteExitExpectation = orphanClockExpectation(
    quoteExitPlan,
    PATH,
    quoteExitSource,
    running,
  );
  const quoteExitWriter = new WorkspaceCommitter(quoteExitAccess, { readContext: () => CONTEXT });

  const quoteExit = await quoteExitWriter.commit(quoteExitPlan, quoteExitExpectation);

  assert.equal(quoteExit.outcome, "applied", JSON.stringify(quoteExit));
  assert.equal(await quoteExitAccess.readText(PATH), "---\n");
  assert.equal(quoteExitAccess.transactionCounts.get(PATH), 1);
  quoteExitWriter.dispose();
});

test("orphan recovery rejects every same-paragraph continuation across containers and mutations", async () => {
  const running = formatCanonicalRunningClock(NOW - 60_000, 480, CLOCK_A);
  const closed = formatCanonicalClosedClock(NOW - 180_000, 480, NOW - 120_000, 480, CLOCK_A);
  const continuations = [
    { name: "dash-setext", text: "---" },
    { name: "ordered-noninterrupt", text: "2.\tcontinuation" },
    { name: "ordered-empty", text: "1. " },
    { name: "plus-empty", text: "+ " },
    { name: "star-empty", text: "* " },
    { name: "dash-empty", text: "- " },
    { name: "type-seven-open", text: '<x attr="v">' },
    { name: "type-seven-close", text: "</x>" },
  ] as const;
  const containers = [
    { name: "ordinary", clockPrefix: "", continuationPrefix: "", eol: "\n" },
    { name: "quote", clockPrefix: "> ", continuationPrefix: "> ", eol: "\n" },
    { name: "nested-quote", clockPrefix: "> > ", continuationPrefix: "> > ", eol: "\n" },
    { name: "quote-lazy", clockPrefix: "> ", continuationPrefix: "", eol: "\n" },
    { name: "quote-crlf", clockPrefix: "> ", continuationPrefix: "> ", eol: "\r\n" },
  ] as const;

  for (const continuation of continuations) for (const container of containers) {
    if (container.name === "quote-lazy" && continuation.name === "dash-setext") continue;
    for (const action of ["delete-clock", "clock-out", "repair-clock-identity"] as const) {
      const caseName = `${continuation.name}-${container.name}-${action}`;
      const selectedPath = `Daily/Paragraph-${caseName}.md`;
      const duplicatePath = `Daily/Paragraph-${caseName}-Duplicate.md`;
      const selectedSource = `${container.clockPrefix}${running}${container.eol}${container.continuationPrefix}${continuation.text}${container.eol}`;
      const duplicateSource = `- ${closed}\n`;
      const access = new MemoryAtomicTextAccess({
        [selectedPath]: selectedSource,
        ...(action === "repair-clock-identity" ? { [duplicatePath]: duplicateSource } : {}),
      });
      const plan = action === "delete-clock"
        ? createMutationPlan({
            intentId: `paragraph-${caseName}`,
            action,
            stages: [{
              path: selectedPath,
              confirmationRequired: false,
              operations: [{
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
          })
        : action === "clock-out"
          ? createMutationPlan({
              intentId: `paragraph-${caseName}`,
              action,
              stages: [{
                path: selectedPath,
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
            })
          : createMutationPlan({
              intentId: `paragraph-${caseName}`,
              action,
              stages: [{
                path: selectedPath,
                confirmationRequired: true,
                operations: [{
                  kind: "repair-clock-identity",
                  target: { kind: "clock", id: CLOCK_A },
                  newId: CLOCK_NEW,
                }],
              }],
              expectedRunningClockIds: [CLOCK_A],
              settingsVersion: CONTEXT.settingsVersion,
              zoneId: CONTEXT.zoneId,
            });
      const expectation = action === "repair-clock-identity"
        ? await orphanClockIdentityRepairExpectation(
            access,
            plan,
            selectedPath,
            selectedSource,
            running,
            [CLOCK_A],
          )
        : orphanClockExpectation(plan, selectedPath, selectedSource, running);
      const writer = new WorkspaceCommitter(access, { readContext: () => CONTEXT });

      const receipt = await writer.commit(plan, expectation);

      assert.equal(
        receipt.outcome,
        action === "delete-clock" ? "rejected" : "conflict",
        `${caseName}: ${JSON.stringify(receipt)}`,
      );
      assert.equal(receipt.confirmation, "confirmed-no-change", caseName);
      assert.equal(
        receipt.result?.code,
        action === "delete-clock" ? "clock-has-attached-content" : "source-conflict",
        caseName,
      );
      assert.equal(receipt.globalCheck.status, "violated", caseName);
      assert.equal(access.transactionCounts.size, 0, caseName);
      assert.equal(await access.readText(selectedPath), selectedSource, caseName);
      if (action === "repair-clock-identity") {
        assert.equal(await access.readText(duplicatePath), duplicateSource, caseName);
      }
      writer.dispose();
    }
  }
});

test("orphan Delete permits actual paragraph-interrupting list and HTML blocks", async () => {
  const running = formatCanonicalRunningClock(NOW - 60_000, 480, CLOCK_A);
  for (const entry of [
    { name: "ordered-one", text: "1. continuation" },
    { name: "bullet-plus", text: "+ continuation" },
    { name: "bullet-dash", text: "- continuation" },
    { name: "html-type-six", text: "<div>" },
  ] as const) {
    const source = `${running}\n${entry.text}\n`;
    const access = new MemoryAtomicTextAccess({ [PATH]: source });
    const plan = createMutationPlan({
      intentId: `paragraph-interrupt-${entry.name}`,
      action: "delete-clock",
      stages: [{
        path: PATH,
        confirmationRequired: false,
        operations: [{
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
    const expectation = orphanClockExpectation(plan, PATH, source, running);
    const writer = new WorkspaceCommitter(access, { readContext: () => CONTEXT });

    const receipt = await writer.commit(plan, expectation);

    assert.equal(receipt.outcome, "applied", `${entry.name}: ${JSON.stringify(receipt)}`);
    assert.equal(await access.readText(PATH), `${entry.text}\n`, entry.name);
    assert.equal(access.transactionCounts.get(PATH), 1, entry.name);
    writer.dispose();
  }
});

test("bare quoted invalid-owner orphan Delete with attached content keeps the global check violated", async () => {
  const running = formatCanonicalRunningClock(NOW - 60_000, 480, CLOCK_A);
  const source = `# Bare quoted orphan\n> ${running}\n> attached continuation\n`;
  const plan = createMutationPlan({
    intentId: "bare-quoted-orphan-delete-attached",
    action: "delete-clock",
    stages: [{
      path: PATH,
      confirmationRequired: false,
      operations: [{
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
  const expectation = orphanClockExpectation(plan, PATH, source, running);
  const access = new MemoryAtomicTextAccess({ [PATH]: source });
  const writer = new WorkspaceCommitter(access, { readContext: () => CONTEXT });

  const receipt = await writer.commit(plan, expectation);

  assert.equal(receipt.outcome, "rejected", JSON.stringify(receipt));
  assert.equal(receipt.confirmation, "confirmed-no-change");
  assert.equal(receipt.result?.code, "clock-has-attached-content");
  assert.equal(receipt.globalCheck.status, "violated");
  assert.equal(access.transactionCounts.size, 0);
  assert.equal(await access.readText(PATH), source);
  assert.equal(writer.blocked, false);
  writer.dispose();
});

test("Timing Repair changes only the selected quoted orphan CLOCK identity", async () => {
  const selectedPath = "Daily/A-Selected-Quoted-Orphan.md";
  const unselectedPath = "Daily/Z-Unselected-Closed-Orphan.md";
  const running = formatCanonicalRunningClock(NOW - 60_000, 480, CLOCK_A);
  const closed = formatCanonicalClosedClock(NOW - 180_000, 480, NOW - 120_000, 480, CLOCK_A);
  const selectedSource = `# Selected quoted orphan\n> - ${running}\n`;
  const repairedSelectedSource = selectedSource.replace(`^${CLOCK_A}`, `^${CLOCK_NEW}`);
  const unselectedSource = `# Unselected closed orphan\n- ${closed}\n`;
  const access = new MemoryAtomicTextAccess({
    [selectedPath]: selectedSource,
    [unselectedPath]: unselectedSource,
  });
  const repair = createMutationPlan({
    intentId: "quoted-orphan-clock-identity-repair",
    action: "repair-clock-identity",
    stages: [{
      path: selectedPath,
      confirmationRequired: true,
      operations: [{
        kind: "repair-clock-identity",
        target: { kind: "clock", id: CLOCK_A },
        newId: CLOCK_NEW,
      }],
    }],
    expectedRunningClockIds: [CLOCK_A],
    settingsVersion: CONTEXT.settingsVersion,
    zoneId: CONTEXT.zoneId,
  });
  const parsed = parseClockText(running);
  assert.equal(parsed.kind, "record");
  const fromOffset = selectedSource.indexOf(running);
  const selectedClock = createClockExpectation({
    target: { kind: "clock", id: CLOCK_A },
    path: selectedPath,
    sourceText: selectedSource,
    clock: {
      path: selectedPath,
      fromOffset,
      toOffset: fromOffset + running.length,
      text: running,
      parsed,
    },
  });
  const index = new WorkspaceIndex(access);
  const snapshot = await index.rebuild();
  assert.equal(snapshot.complete, true);
  const collision = index.identity(CLOCK_A);
  assert.equal(collision.kind, "collision");
  if (collision.kind !== "collision") throw new Error("fixture CLOCK identity must collide");
  index.dispose();
  const expectation = acknowledgeMutationPreview(repair, createMutationExpectation({
    intentId: repair.intentId,
    action: repair.action,
    planItems: [],
    clocks: [selectedClock],
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
    previewToken: repair.previewToken,
    selectedRepair: {
      id: CLOCK_A,
      locations: collision.locations,
      selectedSpan: { path: selectedPath, fromOffset, toOffset: fromOffset + running.length },
    },
  }));
  const writer = new WorkspaceCommitter(access, { readContext: () => CONTEXT });

  const receipt = await writer.commit(repair, expectation);

  assert.equal(receipt.outcome, "applied", JSON.stringify(receipt));
  assert.equal(receipt.confirmation, "confirmed");
  assert.deepEqual(receipt.globalCheck, { status: "violated", runningClockIds: [CLOCK_NEW] });
  assert.equal(writer.blocked, false);
  assert.equal(access.transactionCounts.get(selectedPath), 1);
  assert.equal(access.transactionCounts.has(unselectedPath), false);
  assert.equal(await access.readText(selectedPath), repairedSelectedSource);
  assert.equal(await access.readText(unselectedPath), unselectedSource);
  writer.dispose();
});

test("Timing Repair changes only a selected bare quoted orphan CLOCK identity and retries without writing", async () => {
  const running = formatCanonicalRunningClock(NOW - 60_000, 480, CLOCK_A);
  const closed = formatCanonicalClosedClock(NOW - 180_000, 480, NOW - 120_000, 480, CLOCK_A);
  for (const [container, linePrefix] of [
    ["bare", "> "],
    ["nested-bare", "> > "],
  ] as const) {
    const selectedPath = `Daily/A-Selected-${container}-Quoted-Orphan.md`;
    const unselectedPath = `Daily/Z-Unselected-${container}-Closed-Orphan.md`;
    const selectedSource = `# Selected quoted orphan\n${linePrefix}${running}\n`;
    const repairedSelectedSource = selectedSource.replace(`^${CLOCK_A}`, `^${CLOCK_NEW}`);
    const unselectedSource = `# Unselected closed orphan\n- ${closed}\n`;
    const access = new MemoryAtomicTextAccess({
      [selectedPath]: selectedSource,
      [unselectedPath]: unselectedSource,
    });
    const repair = createMutationPlan({
      intentId: `${container}-quoted-orphan-clock-identity-repair`,
      action: "repair-clock-identity",
      stages: [{
        path: selectedPath,
        confirmationRequired: true,
        operations: [{
          kind: "repair-clock-identity",
          target: { kind: "clock", id: CLOCK_A },
          newId: CLOCK_NEW,
        }],
      }],
      expectedRunningClockIds: [CLOCK_A],
      settingsVersion: CONTEXT.settingsVersion,
      zoneId: CONTEXT.zoneId,
    });
    const parsed = parseClockText(running);
    assert.equal(parsed.kind, "record");
    const fromOffset = selectedSource.indexOf(running);
    const selectedClock = createClockExpectation({
      target: { kind: "clock", id: CLOCK_A },
      path: selectedPath,
      sourceText: selectedSource,
      clock: {
        path: selectedPath,
        fromOffset,
        toOffset: fromOffset + running.length,
        text: running,
        parsed,
      },
    });
    const index = new WorkspaceIndex(access);
    const snapshot = await index.rebuild();
    assert.equal(snapshot.complete, true);
    const collision = index.identity(CLOCK_A);
    assert.equal(collision.kind, "collision");
    if (collision.kind !== "collision") throw new Error("fixture CLOCK identity must collide");
    index.dispose();
    const expectation = acknowledgeMutationPreview(repair, createMutationExpectation({
      intentId: repair.intentId,
      action: repair.action,
      planItems: [],
      clocks: [selectedClock],
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
      previewToken: repair.previewToken,
      selectedRepair: {
        id: CLOCK_A,
        locations: collision.locations,
        selectedSpan: { path: selectedPath, fromOffset, toOffset: fromOffset + running.length },
      },
    }));
    const writer = new WorkspaceCommitter(access, { readContext: () => CONTEXT });

    const receipt = await writer.commit(repair, expectation);

    assert.equal(receipt.outcome, "applied", `${container}: ${JSON.stringify(receipt)}`);
    assert.equal(receipt.confirmation, "confirmed", container);
    assert.deepEqual(receipt.globalCheck, { status: "violated", runningClockIds: [CLOCK_NEW] }, container);
    assert.equal(writer.blocked, false, container);
    assert.equal(access.transactionCounts.get(selectedPath), 1, container);
    assert.equal(access.transactionCounts.has(unselectedPath), false, container);
    assert.equal(await access.readText(selectedPath), repairedSelectedSource, container);
    assert.equal(await access.readText(unselectedPath), unselectedSource, container);
    writer.dispose();

    const transactionsAfterApply = [...access.transactionCounts.entries()];
    const retryWriter = new WorkspaceCommitter(access, { readContext: () => CONTEXT });
    const retry = await retryWriter.commit(repair, expectation);
    assert.equal(retry.outcome, "already-applied", `${container}: ${JSON.stringify(retry)}`);
    assert.deepEqual(retry.globalCheck, receipt.globalCheck, container);
    assert.deepEqual([...access.transactionCounts.entries()], transactionsAfterApply, container);
    assert.equal(await access.readText(selectedPath), repairedSelectedSource, container);
    assert.equal(await access.readText(unselectedPath), unselectedSource, container);
    retryWriter.dispose();
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

test("preview-required mutations need an opaque exact acknowledgment", async () => {
  const source = "# Daily\n";
  const access = new MemoryAtomicTextAccess({ [PATH]: source });
  const plan = createMutationPlan({
    intentId: "unconfirmed-initialize",
    action: "initialize-plan",
    stages: [{
      path: PATH,
      confirmationRequired: true,
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
  });
  const unacknowledged = await mutationExpectation(access, plan, { acknowledgePreview: false });
  const acknowledged = await mutationExpectation(access, plan, {});
  const writer = new WorkspaceCommitter(access, { readContext: () => CONTEXT });

  const direct = await writer.commit(plan, unacknowledged);
  assert.equal(direct.outcome, "rejected");
  assert.equal(access.transactionCounts.size, 0);
  assert.equal(await access.readText(PATH), source);

  const forged = await writer.commit(plan, { ...acknowledged });
  assert.equal(forged.outcome, "rejected");
  assert.equal(access.transactionCounts.size, 0);
  assert.equal(await access.readText(PATH), source);

  const exact = await writer.commit(plan, acknowledged);
  assert.equal(exact.outcome, "applied", JSON.stringify(exact));
  assert.equal(access.transactionCounts.get(PATH), 1);
  assert.ok((await access.readText(PATH))?.includes(OPEN));
  writer.dispose();
});

test("one acknowledged preview cannot authorize target replacement timestamp or edit mutations", async () => {
  const initializeSource = "# Daily\n";
  const initializeAccess = new MemoryAtomicTextAccess({ [PATH]: initializeSource });
  const initialize = createMutationPlan({
    intentId: "preview-edit-binding",
    action: "initialize-plan",
    stages: [{
      path: PATH,
      confirmationRequired: true,
      operations: [{
        kind: "initialize-plan",
        insertionOffset: initializeSource.length,
        lineEnding: "\n",
        expectedSource: initializeSource,
      }],
    }],
    expectedRunningClockIds: [],
    settingsVersion: CONTEXT.settingsVersion,
    zoneId: CONTEXT.zoneId,
  });
  const initializeExpectation = await mutationExpectation(initializeAccess, initialize, {});
  const { previewToken: _initializeToken, ...initializeInput } = initialize;
  const initializeOperation = initialize.stages[0]!.operations[0];
  assert.equal(initializeOperation.kind, "initialize-plan");
  const initializeVariants = [
    createMutationPlan({ ...initializeInput, stages: [{ ...initialize.stages[0]!, path: "Daily/Other.md" }] }),
    createMutationPlan({
      ...initializeInput,
      stages: [{
        ...initialize.stages[0]!,
        operations: [{ ...initializeOperation, expectedSource: "# Replacement\n" }],
      }],
    }),
    createMutationPlan({
      ...initializeInput,
      stages: [{ ...initialize.stages[0]!, operations: [{ ...initializeOperation, insertionOffset: 0 }] }],
    }),
  ];
  const initializeWriter = new WorkspaceCommitter(initializeAccess, { readContext: () => CONTEXT });
  for (const variant of initializeVariants) {
    const receipt = await initializeWriter.commit(variant, initializeExpectation);
    assert.equal(receipt.outcome, "rejected");
  }
  assert.equal(initializeAccess.transactionCounts.size, 0);
  assert.equal(await initializeAccess.readText(PATH), initializeSource);
  initializeWriter.dispose();

  const legacyText = "CLOCK: [2026-11-01 01:30]";
  const normalizeSource = `${OPEN}\n- [ ] Task ^${PLAN_A}\n  - LOGBOOK::\n    - ${legacyText}\n${CLOSE}\n`;
  const selectedEpoch = Date.UTC(2026, 10, 1, 5, 30);
  const resolveLocalTime = () => ({ kind: "ambiguous" as const });
  const normalizeAccess = new MemoryAtomicTextAccess({ [PATH]: normalizeSource });
  const normalize = createMutationPlan({
    intentId: "preview-timestamp-binding",
    action: "normalize-legacy-clock",
    stages: [{ path: PATH, confirmationRequired: true, operations: [{
      kind: "normalize-legacy-clock",
      target: { kind: "clock", ownerId: PLAN_A },
      clockId: CLOCK_NEW,
      startEpochMs: selectedEpoch,
      startOffsetMinutes: -240,
      foldCandidates: [
        { epochMs: selectedEpoch, offsetMinutes: -240 },
        { epochMs: Date.UTC(2026, 10, 1, 6, 30), offsetMinutes: -300 },
      ],
    }] }],
    expectedRunningClockIds: [],
    settingsVersion: CONTEXT.settingsVersion,
    zoneId: "America/New_York",
  });
  const normalizeExpectation = await mutationExpectation(normalizeAccess, normalize, {
    clockIds: [undefined],
    logbookOptions: { resolveLocalTime },
  });
  const { previewToken: _normalizeToken, ...normalizeInput } = normalize;
  const normalizeOperation = normalize.stages[0]!.operations[0];
  assert.equal(normalizeOperation.kind, "normalize-legacy-clock");
  const normalizeVariants = [
    createMutationPlan({
      ...normalizeInput,
      stages: [{ ...normalize.stages[0]!, operations: [{
        ...normalizeOperation,
        target: { ...normalizeOperation.target, fromOffset: normalizeSource.indexOf(legacyText) + 1 },
      }] }],
    }),
    createMutationPlan({
      ...normalizeInput,
      stages: [{ ...normalize.stages[0]!, operations: [{ ...normalizeOperation, clockId: CLOCK_A }] }],
    }),
    createMutationPlan({
      ...normalizeInput,
      stages: [{ ...normalize.stages[0]!, operations: [{ ...normalizeOperation, startEpochMs: selectedEpoch + 1 }] }],
    }),
  ];
  const normalizeWriter = new WorkspaceCommitter(normalizeAccess, {
    readContext: () => ({ ...CONTEXT, zoneId: "America/New_York" }),
    index: { clockParsing: { resolveLocalTime } },
    logbook: { resolveLocalTime },
  });
  for (const variant of normalizeVariants) {
    const receipt = await normalizeWriter.commit(variant, normalizeExpectation);
    assert.equal(receipt.outcome, "rejected");
  }
  assert.equal(normalizeAccess.transactionCounts.size, 0);
  assert.equal(await normalizeAccess.readText(PATH), normalizeSource);
  normalizeWriter.dispose();
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
