import assert from "node:assert/strict";
import test from "node:test";

import { WorkspaceCommitter, legacyRunningClockKey } from "../../../src/workspace/commit.ts";
import { parseClockText } from "../../../src/workspace/clock-parser.ts";
import { createMutationExpectation, type MutationExpectation } from "../../../src/workspace/expectation.ts";
import {
  createCloseRunningClockEdit,
  createNormalizeLegacyClockEdit,
  formatCanonicalClosedClock,
  formatCanonicalRunningClock,
} from "../../../src/workspace/logbook-clock.ts";
import { readLogbook } from "../../../src/workspace/logbook-reader.ts";
import { applyAllowedByteEdits, createMutationPlan, type MutationPlan } from "../../../src/workspace/mutations.ts";
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

const PATH = "Daily/Actions.md";
const START = NOW - 30 * 60_000;

function writer(access: MemoryAtomicTextAccess, context = CONTEXT): WorkspaceCommitter {
  return new WorkspaceCommitter(access, { readContext: () => context });
}

function expectationWithTime(
  expectation: MutationExpectation,
  time: Partial<MutationExpectation["time"]>,
): MutationExpectation {
  const { expectationToken: _expectationToken, ...input } = expectation;
  return createMutationExpectation({ ...input, time: { ...expectation.time, ...time } });
}

function plan(
  intentId: string,
  action: MutationPlan["action"],
  operations: MutationPlan["stages"][number]["operations"],
  expectedRunningClockIds: readonly string[] = [],
): MutationPlan {
  const confirmationRequired = [
    "initialize-plan",
    "migrate-plan",
    "repair-plan-item-identity",
    "repair-clock-identity",
    "normalize-legacy-clock",
    "repair-overlap",
    "repair-done-owner-clock",
  ].includes(action);
  return createMutationPlan({
    intentId,
    action,
    stages: [{ path: PATH, operations, confirmationRequired }],
    expectedRunningClockIds,
    settingsVersion: CONTEXT.settingsVersion,
    zoneId: CONTEXT.zoneId,
  });
}

test("progress below, exactly, and above 100 plus reopen preserve the frozen v1 branches", async () => {
  for (const [raw, expected] of [
    ["", "d10%"],
    ["d25%", "d35%"],
    ["d95%", ""],
  ] as const) {
    const source = `${OPEN}\n- [ ] Task 30m ${raw} ^${PLAN_A}\n${CLOSE}\n`;
    const access = new MemoryAtomicTextAccess({ [PATH]: source });
    const mutation = plan(`progress-${raw || "absent"}`, "advance-progress", [{
      kind: "advance-progress",
      target: { kind: "plan-item", id: PLAN_A },
      logicalMinute: 570,
    }]);
    const expectation = await mutationExpectation(access, mutation, { planIds: [PLAN_A] });
    const committer = writer(access);
    const receipt = await committer.commit(mutation, expectation);
    const after = await access.readText(PATH);
    assert.equal(receipt.outcome, "applied", raw);
    if (expected.length > 0) assert.equal(after?.includes(expected), true, raw);
    else assert.equal(after?.includes(raw), false, raw);
    assert.ok(after?.includes("- [ ] Task"), raw);
    committer.dispose();
  }

  const exactSource = `${OPEN}\n- [ ] Task d90% ^${PLAN_A}\n${CLOSE}\n`;
  const exactAccess = new MemoryAtomicTextAccess({ [PATH]: exactSource });
  const exactPlan = plan("progress-100", "advance-progress", [{
    kind: "advance-progress",
    target: { kind: "plan-item", id: PLAN_A },
    logicalMinute: 570,
  }]);
  const exactExpectation = await mutationExpectation(exactAccess, exactPlan, { planIds: [PLAN_A] });
  const exactWriter = writer(exactAccess);
  const exactReceipt = await exactWriter.commit(exactPlan, exactExpectation);
  const exactAfter = await exactAccess.readText(PATH);
  assert.equal(exactReceipt.outcome, "applied");
  assert.ok(exactAfter?.includes("- [x] Task d9:30"));
  assert.equal(exactAfter?.includes("d90%"), false);
  assert.ok(exactReceipt.semanticChanges.includes("completion-anchor-inserted"));
  assert.ok(exactReceipt.semanticChanges.includes("progress-removed"));
  exactWriter.dispose();

  const reopenAccess = new MemoryAtomicTextAccess({ [PATH]: exactAfter! });
  const reopenPlan = plan("progress-reopen", "reopen-progress", [{
    kind: "reopen-progress",
    target: { kind: "plan-item", id: PLAN_A },
  }]);
  const reopenExpectation = await mutationExpectation(reopenAccess, reopenPlan, { planIds: [PLAN_A] });
  const reopenWriter = writer(reopenAccess);
  const reopened = await reopenWriter.commit(reopenPlan, reopenExpectation);
  assert.equal(reopened.outcome, "applied");
  assert.ok((await reopenAccess.readText(PATH))?.includes("- [ ] Task d10%"));
  assert.ok(reopened.semanticChanges.includes("completion-anchor-removed"));
  assert.ok(reopened.semanticChanges.includes("progress-inserted"));
  reopenWriter.dispose();
});

test("Complete atomically closes only the owned CLOCK, checks the box, removes Progress, and adds no anchor", async () => {
  const source = `${OPEN}\n- [ ] Task d30% ^${PLAN_A}\n  - LOGBOOK::\n    - ${formatCanonicalRunningClock(START, 480, CLOCK_A)}\n${CLOSE}\n`;
  const access = new MemoryAtomicTextAccess({ [PATH]: source }, "editor");
  const mutation = plan("complete", "complete", [{
    kind: "complete",
    target: { kind: "plan-item", id: PLAN_A },
    closeClock: { clockId: CLOCK_A, endEpochMs: NOW, offsetMinutes: 480 },
  }], [CLOCK_A]);
  const expectation = await mutationExpectation(access, mutation, {
    planIds: [PLAN_A], clockIds: [CLOCK_A], expectedRunningClockIds: [CLOCK_A],
  });
  const committer = writer(access);
  const receipt = await committer.commit(mutation, expectation);
  const after = await access.readText(PATH);
  assert.equal(receipt.outcome, "applied", JSON.stringify(receipt));
  assert.equal(access.transactionCounts.get(PATH), 1);
  assert.ok(after?.includes("- [x] Task  ^"));
  assert.equal(after?.includes("d30%"), false);
  assert.equal(/Task\s+d\d{1,2}:\d{1,2}/.test(after!), false);
  assert.ok(after?.includes(formatCanonicalClosedClock(START, 480, NOW, 480, CLOCK_A)));
  assert.deepEqual(receipt.globalCheck.runningClockIds, []);
  assert.deepEqual(receipt.sources[0]?.locations, [{ line: 1 }, { line: 3 }]);
  committer.dispose();
});

test("Complete on another task leaves the authoritative active CLOCK byte-identical", async () => {
  const running = formatCanonicalRunningClock(START, 480, CLOCK_A);
  const source = `${OPEN}\n- [ ] Active ^${PLAN_A}\n  - LOGBOOK::\n    - ${running}\n- [ ] Other d20% ^${PLAN_B}\n${CLOSE}\n`;
  const access = new MemoryAtomicTextAccess({ [PATH]: source });
  const mutation = plan("complete-other", "complete", [{
    kind: "complete",
    target: { kind: "plan-item", id: PLAN_B },
  }], [CLOCK_A]);
  const expectation = await mutationExpectation(access, mutation, { planIds: [PLAN_B], expectedRunningClockIds: [CLOCK_A] });
  const committer = writer(access);
  const receipt = await committer.commit(mutation, expectation);
  assert.equal(receipt.outcome, "applied", JSON.stringify(receipt));
  assert.ok((await access.readText(PATH))?.includes(`- ${running}`));
  assert.deepEqual(receipt.globalCheck.runningClockIds, [CLOCK_A]);
  committer.dispose();
});

test("latent completion-like text cannot steal Advance or Complete postconditions", async () => {
  const cases = [
    {
      source: `${OPEN}\n- [ ] Task d8:00 d90% ^${PLAN_A}\n${CLOSE}\n`,
      mutation: plan("latent-anchor-progress", "advance-progress", [{
        kind: "advance-progress",
        target: { kind: "plan-item", id: PLAN_A },
        logicalMinute: 570,
      }]),
    },
    {
      source: `${OPEN}\n- [ ] Task d8:00 ^${PLAN_A}\n${CLOSE}\n`,
      mutation: plan("latent-anchor-complete", "complete", [{
        kind: "complete",
        target: { kind: "plan-item", id: PLAN_A },
      }]),
    },
  ] as const;
  for (const { source, mutation } of cases) {
    const access = new MemoryAtomicTextAccess({ [PATH]: source });
    const expectation = await mutationExpectation(access, mutation, { planIds: [PLAN_A] });
    const committer = writer(access);
    const receipt = await committer.commit(mutation, expectation);
    assert.equal(receipt.outcome, "rejected", mutation.action);
    assert.equal(receipt.result?.code, "action-no-longer-applicable", mutation.action);
    assert.equal(access.transactionCounts.size, 0, mutation.action);
    assert.equal(await access.readText(PATH), source, mutation.action);
    committer.dispose();
  }
});

test("delete removes only the exact CLOCK physical line and rejects attached content with zero plugin bytes", async () => {
  const base = `${OPEN}\n- [ ] Task ^${PLAN_A}\n  - LOGBOOK::\n    - ${formatCanonicalRunningClock(START, 480, CLOCK_A)}\n    - sibling\n${CLOSE}\n`;
  const access = new MemoryAtomicTextAccess({ [PATH]: base });
  const mutation = plan("delete-clock", "delete-clock", [{
    kind: "delete-clock",
    target: { kind: "clock", id: CLOCK_A, ownerId: PLAN_A },
    confirmation: { firstActivationEpochMs: NOW - 2_500, secondActivationEpochMs: NOW, firstTargetKey: CLOCK_A, secondTargetKey: CLOCK_A },
  }], [CLOCK_A]);
  const expectation = await mutationExpectation(access, mutation, { clockIds: [CLOCK_A], expectedRunningClockIds: [CLOCK_A] });
  const committer = writer(access);
  const receipt = await committer.commit(mutation, expectation);
  const after = await access.readText(PATH);
  assert.equal(receipt.outcome, "applied");
  assert.equal(after?.includes(CLOCK_A), false);
  assert.ok(after?.includes("- LOGBOOK::"));
  assert.ok(after?.includes("- sibling"));
  assert.deepEqual(receipt.sources[0]?.locations, [{ line: 3 }]);
  committer.dispose();

  const attached = base.replace(`    - sibling`, "      continuation\n    - sibling");
  const attachedAccess = new MemoryAtomicTextAccess({ [PATH]: attached });
  const attachedExpectation = await mutationExpectation(attachedAccess, mutation, { clockIds: [CLOCK_A], expectedRunningClockIds: [CLOCK_A] });
  const attachedWriter = writer(attachedAccess);
  const rejected = await attachedWriter.commit(mutation, attachedExpectation);
  assert.equal(rejected.outcome, "rejected");
  assert.equal(rejected.result?.code, "clock-has-attached-content");
  assert.equal(await attachedAccess.readText(PATH), attached);
  attachedWriter.dispose();
});

test("duplicate identities block ordinary writes while selected repair changes one terminal ID only", async () => {
  const source = `${OPEN}\n- [ ] First ^${PLAN_A}\n- [ ] Second ^${PLAN_A}\n${CLOSE}\n`;
  const access = new MemoryAtomicTextAccess({ [PATH]: source });
  const ordinary = plan("collision", "clock-in", [{
    kind: "clock-in",
    target: { kind: "plan-item", id: PLAN_A },
    clock: { clockId: CLOCK_NEW, startEpochMs: NOW, offsetMinutes: 480 },
  }]);
  const ordinaryExpectation = await mutationExpectation(access, ordinary, { planIds: [PLAN_A] });
  const ordinaryWriter = writer(access);
  const blocked = await ordinaryWriter.commit(ordinary, ordinaryExpectation);
  assert.equal(blocked.result?.code, "identity-collision");
  assert.equal(access.transactionCounts.size, 0);
  ordinaryWriter.dispose();

  const repair = plan("repair", "repair-plan-item-identity", [{
    kind: "repair-plan-item-identity",
    target: { kind: "plan-item", id: PLAN_A },
    newId: PLAN_NEW,
  }]);
  const repairExpectation = await mutationExpectation(access, repair, { planIds: [PLAN_A] });
  const repairWriter = writer(access);
  const receipt = await repairWriter.commit(repair, repairExpectation);
  const after = await access.readText(PATH);
  assert.equal(receipt.outcome, "applied");
  assert.equal(after?.match(new RegExp(PLAN_A, "g"))?.length, 1);
  assert.equal(after?.match(new RegExp(PLAN_NEW, "g"))?.length, 1);
  assert.ok(after?.includes(`- [ ] Second ^${PLAN_A}`));
  const retry = await repairWriter.commit(repair, repairExpectation);
  assert.equal(retry.outcome, "already-applied");
  assert.equal(access.transactionCounts.get(PATH), 1);
  assert.equal(await access.readText(PATH), after);
  repairWriter.dispose();

  const unique = `${OPEN}\n- [ ] Unique ^${PLAN_A}\n${CLOSE}\n`;
  const uniqueAccess = new MemoryAtomicTextAccess({ [PATH]: unique });
  const uniqueExpectation = await mutationExpectation(uniqueAccess, repair, { planIds: [PLAN_A] });
  const uniqueWriter = writer(uniqueAccess);
  const unnecessary = await uniqueWriter.commit(repair, uniqueExpectation);
  assert.equal(unnecessary.outcome, "rejected");
  assert.equal(unnecessary.result?.code, "action-no-longer-applicable");
  assert.equal(uniqueAccess.transactionCounts.size, 0);
  assert.equal(await uniqueAccess.readText(PATH), unique);
  uniqueWriter.dispose();

  const raceAccess = new MemoryAtomicTextAccess({ [PATH]: source });
  const raceExpectation = await mutationExpectation(raceAccess, repair, { planIds: [PLAN_A] });
  raceAccess.raceBeforeCallback(PATH, (current) => current.replace(`- [ ] Second ^${PLAN_A}\n`, ""));
  const raceWriter = writer(raceAccess);
  const staleRepair = await raceWriter.commit(repair, raceExpectation);
  assert.equal(staleRepair.outcome, "rejected");
  assert.equal(staleRepair.result?.code, "action-no-longer-applicable");
  assert.equal((await raceAccess.readText(PATH))?.includes(PLAN_NEW), false);
  assert.equal((await raceAccess.readText(PATH))?.match(new RegExp(PLAN_A, "g"))?.length, 1);
  raceWriter.dispose();
});

test("selected duplicate CLOCK identity repair changes only one exact terminal ID", async () => {
  const first = formatCanonicalClosedClock(START, 480, NOW, 480, CLOCK_A);
  const source = `${OPEN}\n- [ ] First ^${PLAN_A}\n  - LOGBOOK::\n    - ${first}\n- [ ] Second ^${PLAN_B}\n  - LOGBOOK::\n    - ${first}\n${CLOSE}\n`;
  const access = new MemoryAtomicTextAccess({ [PATH]: source });
  const repair = plan("repair-clock-collision", "repair-clock-identity", [{
    kind: "repair-clock-identity",
    target: { kind: "clock", id: CLOCK_A },
    newId: CLOCK_NEW,
  }]);
  const expectation = await mutationExpectation(access, repair, { clockIds: [CLOCK_A] });
  const committer = writer(access);
  const receipt = await committer.commit(repair, expectation);
  const after = await access.readText(PATH);
  assert.equal(receipt.outcome, "applied");
  assert.equal(after?.match(new RegExp(CLOCK_A, "g"))?.length, 1);
  assert.equal(after?.match(new RegExp(CLOCK_NEW, "g"))?.length, 1);
  assert.ok(after?.includes(`- [ ] Second ^${PLAN_B}\n  - LOGBOOK::\n    - ${first}`));
  const retry = await committer.commit(repair, expectation);
  assert.equal(retry.outcome, "already-applied");
  assert.equal(access.transactionCounts.get(PATH), 1);
  assert.equal(await access.readText(PATH), after);
  committer.dispose();
});

test("Assign Plan Item identity retry confirms the exact stable end state without a second write", async () => {
  const source = `${OPEN}\n- [ ] Anonymous task  \n${CLOSE}\n`;
  const access = new MemoryAtomicTextAccess({ [PATH]: source });
  const assign = plan("assign-plan-item-id", "assign-plan-item-identity", [{
    kind: "assign-plan-item-identity",
    target: { kind: "plan-item" },
    newId: PLAN_NEW,
  }]);
  const expectation = await mutationExpectation(access, assign, { planIds: [undefined] });
  const committer = writer(access);
  const first = await committer.commit(assign, expectation);
  const after = await access.readText(PATH);
  assert.equal(first.outcome, "applied");
  assert.equal(after, `${OPEN}\n- [ ] Anonymous task ^${PLAN_NEW}  \n${CLOSE}\n`);
  const retry = await committer.commit(assign, expectation);
  assert.equal(retry.outcome, "already-applied");
  assert.equal(access.transactionCounts.get(PATH), 1);
  assert.equal(await access.readText(PATH), after);
  committer.dispose();
});

test("Clock In inserts newest-first in an existing LOGBOOK and preserves surrounding Markdown bytes", async () => {
  const oldClock = formatCanonicalClosedClock(START - 60_000, 480, START, 480, CLOCK_A);
  const openedClock = formatCanonicalRunningClock(NOW, 480, CLOCK_NEW);
  const source = `${OPEN}\r\n+ [ ] Task opaque-suffix ^${PLAN_A}  \r\n  * LOGBOOK::\r\n    + ${oldClock}\r\n- [ ] Sibling ^${PLAN_B}\r\n${CLOSE}\r\nunowned suffix\r\n`;
  const access = new MemoryAtomicTextAccess({ [PATH]: source });
  const mutation = plan("clock-in-existing-logbook", "clock-in", [{
    kind: "clock-in",
    target: { kind: "plan-item", id: PLAN_A },
    clock: { clockId: CLOCK_NEW, startEpochMs: NOW, offsetMinutes: 480 },
  }]);
  const expectation = await mutationExpectation(access, mutation, { planIds: [PLAN_A] });
  const committer = writer(access);
  const receipt = await committer.commit(mutation, expectation);
  assert.equal(receipt.outcome, "applied", JSON.stringify(receipt));
  assert.equal(await access.readText(PATH), source.replace(
    "  * LOGBOOK::\r\n",
    `  * LOGBOOK::\r\n    - ${openedClock}\r\n`,
  ));
  assert.deepEqual(receipt.sources[0]?.locations, [{ line: 3 }]);
  assert.equal(access.transactionCounts.get(PATH), 1);
  committer.dispose();
});

test("Clock In places a new LOGBOOK after attached content and before the next sibling", async () => {
  const openedClock = formatCanonicalRunningClock(NOW, 480, CLOCK_NEW);
  const beforeSibling = `${OPEN}\r\n+ [ ] Task opaque-suffix ^${PLAN_A}  \r\n  continuation with  preserved spacing  \r\n  * nested alternate bullet\r\n  <!-- attached comment -->`;
  const siblingAndSuffix = `\r\n- [ ] Sibling ^${PLAN_B}\r\n${CLOSE}\r\nunowned suffix\r\n`;
  const source = beforeSibling + siblingAndSuffix;
  const access = new MemoryAtomicTextAccess({ [PATH]: source });
  const mutation = plan("clock-in-new-logbook-after-content", "clock-in", [{
    kind: "clock-in",
    target: { kind: "plan-item", id: PLAN_A },
    clock: { clockId: CLOCK_NEW, startEpochMs: NOW, offsetMinutes: 480 },
  }]);
  const expectation = await mutationExpectation(access, mutation, { planIds: [PLAN_A] });
  const committer = writer(access);
  const receipt = await committer.commit(mutation, expectation);
  assert.equal(receipt.outcome, "applied", JSON.stringify(receipt));
  assert.equal(
    await access.readText(PATH),
    `${beforeSibling}\r\n  - LOGBOOK::\r\n    - ${openedClock}${siblingAndSuffix}`,
  );
  assert.deepEqual(receipt.sources[0]?.locations, [{ line: 5 }, { line: 6 }]);
  assert.equal(access.transactionCounts.get(PATH), 1);
  committer.dispose();
});

test("selected duplicate running CLOCK repair unlocks a fresh overlap repair", async () => {
  const newerStart = START + 10 * 60_000;
  const source = `${OPEN}\n- [ ] First ^${PLAN_A}\n  - LOGBOOK::\n    - ${formatCanonicalRunningClock(START, 480, CLOCK_A)}\n- [ ] Second ^${PLAN_B}\n  - LOGBOOK::\n    - ${formatCanonicalRunningClock(newerStart, 480, CLOCK_A)}\n${CLOSE}\n`;
  const access = new MemoryAtomicTextAccess({ [PATH]: source });
  const identityRepair = plan("repair-running-clock-collision", "repair-clock-identity", [{
    kind: "repair-clock-identity",
    target: { kind: "clock", id: CLOCK_A },
    newId: CLOCK_NEW,
  }], [CLOCK_A, CLOCK_A]);
  const identityExpectation = await mutationExpectation(access, identityRepair, {
    clockIds: [CLOCK_A], expectedRunningClockIds: [CLOCK_A, CLOCK_A],
  });
  const identityWriter = writer(access);
  const identityReceipt = await identityWriter.commit(identityRepair, identityExpectation);
  assert.equal(identityReceipt.outcome, "applied");
  assert.deepEqual([...identityReceipt.globalCheck.runningClockIds].sort(), [CLOCK_A, CLOCK_NEW].sort());
  assert.equal((await access.readText(PATH))?.match(new RegExp(CLOCK_NEW, "g"))?.length, 1);
  const identityRetry = await identityWriter.commit(identityRepair, identityExpectation);
  assert.equal(identityRetry.outcome, "already-applied");
  assert.equal(identityRetry.globalCheck.status, "violated");
  assert.equal(access.transactionCounts.get(PATH), 1);
  identityWriter.dispose();

  const overlap = plan("repair-overlap-after-identity", "repair-overlap", [{
    kind: "clock-out",
    target: { kind: "clock", id: CLOCK_NEW, ownerId: PLAN_A },
    close: { clockId: CLOCK_NEW, endEpochMs: newerStart, offsetMinutes: 480 },
  }], [CLOCK_A, CLOCK_NEW]);
  const overlapExpectation = await mutationExpectation(access, overlap, {
    clockIds: [CLOCK_NEW], expectedRunningClockIds: [CLOCK_A, CLOCK_NEW],
  });
  const overlapWriter = writer(access);
  const overlapReceipt = await overlapWriter.commit(overlap, overlapExpectation);
  assert.equal(overlapReceipt.outcome, "applied");
  assert.deepEqual(overlapReceipt.globalCheck.runningClockIds, [CLOCK_A]);
  assert.ok((await access.readText(PATH))?.includes(
    formatCanonicalClosedClock(START, 480, newerStart, 480, CLOCK_NEW),
  ));
  overlapWriter.dispose();
});

test("same-file overlap repair distinguishes repeated ID-less legacy CLOCKs by exact locator", async () => {
  const firstText = "CLOCK: [2026-08-28 09:00]";
  const secondText = "CLOCK: [2026-08-28 09:10]";
  const newestText = "CLOCK: [2026-08-28 09:30]";
  const firstStart = Date.UTC(2026, 7, 28, 1, 0);
  const secondStart = Date.UTC(2026, 7, 28, 1, 10);
  const source = `${OPEN}\n- [ ] Timed ^${PLAN_A}\n  - LOGBOOK::\n    - ${firstText}\n    - ${secondText}\n    - ${newestText}\n${CLOSE}\n`;
  const firstOffset = source.indexOf(firstText);
  const secondOffset = source.indexOf(secondText);
  const newestOffset = source.indexOf(newestText);
  const firstKey = legacyRunningClockKey(PATH, firstOffset, firstText);
  const secondKey = legacyRunningClockKey(PATH, secondOffset, secondText);
  const newestKey = legacyRunningClockKey(PATH, newestOffset, newestText);
  const resolveLocalTime = (parts: { readonly hour: number; readonly minute: number }) => ({
    kind: "unique" as const,
    epochMs: Date.UTC(2026, 7, 28, parts.hour - 8, parts.minute),
  });
  const access = new MemoryAtomicTextAccess({ [PATH]: source }, "editor");
  const repair = plan("repair-idless-overlap", "repair-overlap", [
    {
      kind: "clock-out",
      target: { kind: "clock", ownerId: PLAN_A, fromOffset: firstOffset },
      close: {
        assignedClockId: CLOCK_A,
        endEpochMs: NOW,
        offsetMinutes: 480,
        legacyStartOffsetMinutes: 480,
      },
    },
    {
      kind: "clock-out",
      target: { kind: "clock", ownerId: PLAN_A, fromOffset: secondOffset },
      close: {
        assignedClockId: CLOCK_NEW,
        endEpochMs: NOW,
        offsetMinutes: 480,
        legacyStartOffsetMinutes: 480,
      },
    },
  ], [firstKey, secondKey, newestKey]);
  const expectation = await mutationExpectation(access, repair, {
    clockIds: [undefined, undefined, undefined],
    expectedRunningClockIds: [firstKey, secondKey, newestKey],
    logbookOptions: { resolveLocalTime },
  });
  const committer = new WorkspaceCommitter(access, {
    readContext: () => CONTEXT,
    index: { clockParsing: { resolveLocalTime } },
    logbook: { resolveLocalTime },
  });
  const receipt = await committer.commit(repair, expectation);
  const after = await access.readText(PATH);
  assert.equal(receipt.outcome, "applied", JSON.stringify(receipt));
  assert.equal(access.transactionCounts.get(PATH), 1);
  assert.ok(after?.includes(formatCanonicalClosedClock(firstStart, 480, NOW, 480, CLOCK_A)));
  assert.ok(after?.includes(formatCanonicalClosedClock(secondStart, 480, NOW, 480, CLOCK_NEW)));
  assert.ok(after?.includes(newestText));
  assert.equal(receipt.globalCheck.runningClockIds.length, 1);
  assert.ok(receipt.globalCheck.runningClockIds[0]?.startsWith(
    `legacy:${PATH}:${after!.indexOf(newestText)}:`,
  ));
  committer.dispose();
});

test("overlap repair validates the exact close offset across a DST fold", async () => {
  const zoneId = "America/New_York";
  const olderStart = Date.UTC(2026, 10, 1, 4, 30);
  const newestStart = Date.UTC(2026, 10, 1, 5, 30);
  const source = `${OPEN}\n- [ ] Older ^${PLAN_A}\n  - LOGBOOK::\n    - ${formatCanonicalRunningClock(olderStart, -240, CLOCK_A)}\n- [ ] Newest ^${PLAN_B}\n  - LOGBOOK::\n    - ${formatCanonicalRunningClock(newestStart, -240, CLOCK_B)}\n${CLOSE}\n`;
  const repair = (intentId: string, offsetMinutes: number) => createMutationPlan({
    intentId,
    action: "repair-overlap",
    stages: [{
      path: PATH,
      confirmationRequired: true,
      operations: [{
        kind: "clock-out",
        target: { kind: "clock", id: CLOCK_A, ownerId: PLAN_A },
        close: { clockId: CLOCK_A, endEpochMs: newestStart, offsetMinutes },
      }],
    }],
    expectedRunningClockIds: [CLOCK_A, CLOCK_B],
    settingsVersion: CONTEXT.settingsVersion,
    zoneId,
  });
  const context = { ...CONTEXT, zoneId };

  const invalidAccess = new MemoryAtomicTextAccess({ [PATH]: source });
  const invalid = repair("repair-fold-wrong-offset", -300);
  const invalidExpectation = await mutationExpectation(invalidAccess, invalid, {
    clockIds: [CLOCK_A, CLOCK_B],
    expectedRunningClockIds: [CLOCK_A, CLOCK_B],
  });
  const invalidWriter = writer(invalidAccess, context);
  const rejected = await invalidWriter.commit(invalid, invalidExpectation);
  assert.equal(rejected.outcome, "rejected");
  assert.equal(rejected.result?.code, "clock-discontinuity");
  assert.equal(invalidAccess.transactionCounts.size, 0);
  assert.equal(await invalidAccess.readText(PATH), source);
  invalidWriter.dispose();

  const validAccess = new MemoryAtomicTextAccess({ [PATH]: source });
  const valid = repair("repair-fold-exact-offset", -240);
  const validExpectation = await mutationExpectation(validAccess, valid, {
    clockIds: [CLOCK_A, CLOCK_B],
    expectedRunningClockIds: [CLOCK_A, CLOCK_B],
  });
  const validWriter = writer(validAccess, context);
  const applied = await validWriter.commit(valid, validExpectation);
  assert.equal(applied.outcome, "applied", JSON.stringify(applied));
  assert.ok((await validAccess.readText(PATH))?.includes(
    formatCanonicalClosedClock(olderStart, -240, newestStart, -240, CLOCK_A),
  ));
  assert.deepEqual(applied.globalCheck.runningClockIds, [CLOCK_B]);
  validWriter.dispose();
});

test("selected duplicate owner identity repair preserves its running CLOCK and is idempotent", async () => {
  const source = `${OPEN}\n- [ ] Timed ^${PLAN_A}\n  - LOGBOOK::\n    - ${formatCanonicalRunningClock(START, 480, CLOCK_A)}\n- [ ] Duplicate ^${PLAN_A}\n${CLOSE}\n`;
  const access = new MemoryAtomicTextAccess({ [PATH]: source });
  const repair = plan("repair-running-owner", "repair-plan-item-identity", [{
    kind: "repair-plan-item-identity",
    target: { kind: "plan-item", id: PLAN_A },
    newId: PLAN_NEW,
  }], [CLOCK_A]);
  const expectation = await mutationExpectation(access, repair, {
    planIds: [PLAN_A],
    expectedRunningClockIds: [CLOCK_A],
  });
  const committer = writer(access);
  const receipt = await committer.commit(repair, expectation);
  const after = await access.readText(PATH);
  assert.equal(receipt.outcome, "applied");
  assert.ok(after?.includes(`- [ ] Timed ^${PLAN_NEW}\n  - LOGBOOK::\n    - ${formatCanonicalRunningClock(START, 480, CLOCK_A)}`));
  assert.deepEqual(receipt.globalCheck.runningClockIds, [CLOCK_A]);
  const retry = await committer.commit(repair, expectation);
  assert.equal(retry.outcome, "already-applied");
  assert.equal(access.transactionCounts.get(PATH), 1);
  assert.equal(await access.readText(PATH), after);
  committer.dispose();
});

test("Initialize is atomic and unsupported old Plan grammars remain zero-write ordinary Markdown", async () => {
  const initial = "\uFEFF# Daily\r\nbody\r\n";
  const initAccess = new MemoryAtomicTextAccess({ [PATH]: initial }, "editor");
  const initialize = plan("initialize", "initialize-plan", [{
    kind: "initialize-plan",
    insertionOffset: initial.length,
    lineEnding: "\r\n",
    expectedSource: initial,
  }]);
  const initExpectation = await mutationExpectation(initAccess, initialize, {});
  const initWriter = writer(initAccess);
  const initialized = await initWriter.commit(initialize, initExpectation);
  assert.equal(initialized.outcome, "applied");
  const initializedText = await initAccess.readText(PATH);
  assert.equal(initializedText, `${initial}${OPEN}\r\n${CLOSE}\r\n`);
  assert.equal(initAccess.transactionCounts.get(PATH), 1);
  initWriter.dispose();

  const fenced = `\`\`\`md\n${OPEN}\n${CLOSE}\n\`\`\`\n`;
  const fencedAccess = new MemoryAtomicTextAccess({ [PATH]: fenced });
  const fencedInitialize = plan("initialize-fenced-example", "initialize-plan", [{
    kind: "initialize-plan",
    insertionOffset: fenced.length,
    lineEnding: "\n",
    expectedSource: fenced,
  }]);
  const fencedExpectation = await mutationExpectation(fencedAccess, fencedInitialize, {});
  const fencedWriter = writer(fencedAccess);
  const fencedReceipt = await fencedWriter.commit(fencedInitialize, fencedExpectation);
  assert.equal(fencedReceipt.outcome, "applied");
  assert.equal(await fencedAccess.readText(PATH), `${fenced}${OPEN}\n${CLOSE}\n`);
  fencedWriter.dispose();

  for (const [name, prose] of [
    ["prefix", `Documentation: ${OPEN}\n`],
    ["suffix", `${OPEN} is the marker example\n`],
  ] as const) {
    const proseAccess = new MemoryAtomicTextAccess({ [PATH]: prose });
    const proseInitialize = plan(`initialize-${name}-prose`, "initialize-plan", [{
      kind: "initialize-plan",
      insertionOffset: prose.length,
      lineEnding: "\n",
      expectedSource: prose,
    }]);
    const proseExpectation = await mutationExpectation(proseAccess, proseInitialize, {});
    const proseWriter = writer(proseAccess);
    const proseReceipt = await proseWriter.commit(proseInitialize, proseExpectation);
    assert.equal(proseReceipt.outcome, "applied", name);
    assert.equal(await proseAccess.readText(PATH), `${prose}${OPEN}\n${CLOSE}\n`, name);
    proseWriter.dispose();
  }

  const old = "<!-- nautilus-log:plan/v0 -->\n- [ ] Old\n<!-- /nautilus-log:plan -->\n";
  const migrateAccess = new MemoryAtomicTextAccess({ [PATH]: old });
  assert.throws(() => plan("migrate", "migrate-plan", [{
      kind: "migrate-plan",
      span: { fromOffset: 0, toOffset: old.length - 1, fromLine: 0, fromColumn: 0, toLine: 2, toColumn: CLOSE.length },
      expectedRegion: old.slice(0, -1),
      replacementRegion: `${OPEN}\n- [ ] Old ^${PLAN_NEW}\n${CLOSE}`,
      expectedOldVersion: "v0",
      expectedPlanItemIds: [PLAN_NEW],
      expectedClassifications: [{ id: PLAN_NEW, kind: "flexible-task", status: "open" }],
    }]), /Unsupported migration source grammar/);
  assert.equal(migrateAccess.transactionCounts.size, 0);
  assert.equal(await migrateAccess.readText(PATH), old);
});

test("Initialize preserves a byte-zero BOM for LF and CRLF and retries its exact end state", async () => {
  for (const [name, lineEnding] of [["lf", "\n"], ["crlf", "\r\n"]] as const) {
    for (const primitive of ["editor", "vault-process"] as const) {
      const label = `${name}/${primitive}`;
      const source = `\uFEFF# Daily${lineEnding}body${lineEnding}`;
      const access = new MemoryAtomicTextAccess({ [PATH]: source }, primitive);
      const initialize = plan(`initialize-bom-${name}-${primitive}`, "initialize-plan", [{
        kind: "initialize-plan",
        insertionOffset: 1,
        lineEnding,
        expectedSource: source,
      }]);
      const expectation = await mutationExpectation(access, initialize, {});
      const firstWriter = writer(access);
      const first = await firstWriter.commit(initialize, expectation);
      const expected = `\uFEFF${OPEN}${lineEnding}${CLOSE}${lineEnding}# Daily${lineEnding}body${lineEnding}`;
      assert.equal(first.outcome, "applied", label);
      assert.equal(first.sources[0]?.primitive, primitive, label);
      assert.equal(await access.readText(PATH), expected, label);
      assert.equal(access.transactionCounts.get(PATH), 1, label);
      const sameWriterRetry = await firstWriter.commit(initialize, expectation);
      assert.equal(sameWriterRetry.outcome, "already-applied", label);
      assert.equal(access.transactionCounts.get(PATH), 1, label);
      firstWriter.dispose();

      const newWriter = writer(access);
      const newWriterRetry = await newWriter.commit(initialize, expectation);
      assert.equal(newWriterRetry.outcome, "already-applied", label);
      assert.equal(access.transactionCounts.get(PATH), 1, label);
      assert.equal(await access.readText(PATH), expected, label);
      const externallyExtended = `${expected}Outside-region edit${lineEnding}`;
      access.modify(PATH, externallyExtended);
      const extendedRetry = await newWriter.commit(initialize, expectation);
      assert.equal(extendedRetry.outcome, "already-applied", label);
      assert.equal(access.transactionCounts.get(PATH), 1, label);
      assert.equal(await access.readText(PATH), externallyExtended, label);
      newWriter.dispose();
    }
  }
});

test("Initialize rejects non-boundaries, mixed EOL, and offsets splitting CRLF with zero changed bytes", async () => {
  const crlf = "# Daily\r\nbody\r\n";
  for (const candidate of [
    { name: "mid-line", source: "# Daily\n", insertionOffset: 2, lineEnding: "\n" as const },
    { name: "mixed-eol", source: "# Daily\r\nbody\n", insertionOffset: 14, lineEnding: "\r\n" as const },
    { name: "split-crlf", source: crlf, insertionOffset: crlf.indexOf("\n"), lineEnding: "\r\n" as const },
  ]) {
    const access = new MemoryAtomicTextAccess({ [PATH]: candidate.source });
    const initialize = plan(`initialize-reject-${candidate.name}`, "initialize-plan", [{
      kind: "initialize-plan",
      insertionOffset: candidate.insertionOffset,
      lineEnding: candidate.lineEnding,
      expectedSource: candidate.source,
    }]);
    const expectation = await mutationExpectation(access, initialize, {});
    const committer = writer(access);
    const receipt = await committer.commit(initialize, expectation);
    assert.equal(receipt.outcome, "rejected", candidate.name);
    assert.equal(receipt.result?.code, "action-no-longer-applicable", candidate.name);
    assert.equal(access.transactionCounts.size, 0, candidate.name);
    assert.equal(await access.readText(PATH), candidate.source, candidate.name);
    committer.dispose();
  }
});

test("Complete rejects zero-byte when its target-owned running CLOCK was not included in the mutation plan", async () => {
  const source = `${OPEN}\n- [ ] Task ^${PLAN_A}\n  - LOGBOOK::\n    - ${formatCanonicalRunningClock(START, 480, CLOCK_A)}\n${CLOSE}\n`;
  const access = new MemoryAtomicTextAccess({ [PATH]: source });
  const mutation = plan("complete-without-close", "complete", [{
    kind: "complete",
    target: { kind: "plan-item", id: PLAN_A },
  }], [CLOCK_A]);
  const expectation = await mutationExpectation(access, mutation, { planIds: [PLAN_A], expectedRunningClockIds: [CLOCK_A] });
  const committer = writer(access);
  const receipt = await committer.commit(mutation, expectation);
  assert.equal(receipt.outcome, "conflict");
  assert.equal(receipt.result?.code, "clock-owner-invalid");
  assert.equal(access.transactionCounts.size, 0);
  assert.equal(await access.readText(PATH), source);
  committer.dispose();
});

test("already-done Complete is idempotent only when its owner has no running CLOCK", async () => {
  const done = `${OPEN}\n- [x] Task ^${PLAN_A}\n${CLOSE}\n`;
  const idleAccess = new MemoryAtomicTextAccess({ [PATH]: done });
  const complete = plan("complete-done-idle", "complete", [{
    kind: "complete",
    target: { kind: "plan-item", id: PLAN_A },
  }]);
  const idleExpectation = await mutationExpectation(idleAccess, complete, { planIds: [PLAN_A] });
  const idleWriter = writer(idleAccess);
  const idleReceipt = await idleWriter.commit(complete, idleExpectation);
  assert.equal(idleReceipt.outcome, "already-applied");
  assert.equal(idleAccess.transactionCounts.size, 0);
  assert.equal(await idleAccess.readText(PATH), done);
  idleWriter.dispose();

  const degraded = `${OPEN}\n- [x] Task ^${PLAN_A}\n  - LOGBOOK::\n    - ${formatCanonicalRunningClock(START, 480, CLOCK_A)}\n${CLOSE}\n`;
  const degradedAccess = new MemoryAtomicTextAccess({ [PATH]: degraded });
  const degradedPlan = plan("complete-done-running", "complete", [{
    kind: "complete",
    target: { kind: "plan-item", id: PLAN_A },
  }], [CLOCK_A]);
  const degradedExpectation = await mutationExpectation(degradedAccess, degradedPlan, {
    planIds: [PLAN_A], expectedRunningClockIds: [CLOCK_A],
  });
  const degradedWriter = writer(degradedAccess);
  const degradedReceipt = await degradedWriter.commit(degradedPlan, degradedExpectation);
  assert.equal(degradedReceipt.outcome, "conflict");
  assert.equal(degradedReceipt.result?.code, "clock-owner-invalid");
  assert.equal(degradedAccess.transactionCounts.size, 0);
  assert.equal(await degradedAccess.readText(PATH), degraded);
  degradedWriter.dispose();
});

test("global idle Clock Out and confirmed absent Delete are authoritative no-host outcomes", async () => {
  const idle = `${OPEN}\n- [ ] Task ^${PLAN_A}\n${CLOSE}\n`;
  const idleAccess = new MemoryAtomicTextAccess({ [PATH]: idle });
  const noActive = createMutationPlan({
    intentId: "clock-out-idle",
    action: "clock-out",
    stages: [],
    expectedRunningClockIds: [],
    settingsVersion: CONTEXT.settingsVersion,
    zoneId: CONTEXT.zoneId,
  });
  const noActiveExpectation = await mutationExpectation(idleAccess, noActive, {});
  const idleWriter = writer(idleAccess);
  const noOp = await idleWriter.commit(noActive, noActiveExpectation);
  assert.equal(noOp.outcome, "already-applied");
  assert.deepEqual(noOp.sources, []);
  assert.equal(idleAccess.transactionCounts.size, 0);
  idleWriter.dispose();

  const running = formatCanonicalRunningClock(START, 480, CLOCK_A);
  const present = `${OPEN}\n- [ ] Task ^${PLAN_A}\n  - LOGBOOK::\n    - ${running}\n${CLOSE}\n`;
  const absent = present.replace(`    - ${running}\n`, "");
  const deleteAccess = new MemoryAtomicTextAccess({ [PATH]: present });
  const deletion = plan("delete-retry", "delete-clock", [{
    kind: "delete-clock",
    target: { kind: "clock", id: CLOCK_A, ownerId: PLAN_A },
    confirmation: {
      firstActivationEpochMs: NOW - 1,
      secondActivationEpochMs: NOW,
      firstTargetKey: CLOCK_A,
      secondTargetKey: CLOCK_A,
    },
  }], [CLOCK_A]);
  const deleteExpectation = await mutationExpectation(deleteAccess, deletion, {
    clockIds: [CLOCK_A], expectedRunningClockIds: [CLOCK_A],
  });
  deleteAccess.modify(PATH, absent);
  const deleteWriter = writer(deleteAccess);
  const alreadyDeleted = await deleteWriter.commit(deletion, deleteExpectation);
  assert.equal(alreadyDeleted.outcome, "already-applied");
  assert.deepEqual(alreadyDeleted.sources, []);
  assert.equal(deleteAccess.transactionCounts.size, 0);
  assert.equal(await deleteAccess.readText(PATH), absent);
  deleteWriter.dispose();
});

test("duplicate Progress and mid-line Initialize candidates reject with zero plugin bytes", async () => {
  const duplicate = `${OPEN}\n- [ ] Task d90% d20% ^${PLAN_A}\n${CLOSE}\n`;
  const duplicateAccess = new MemoryAtomicTextAccess({ [PATH]: duplicate });
  const advance = plan("duplicate-progress", "advance-progress", [{
    kind: "advance-progress",
    target: { kind: "plan-item", id: PLAN_A },
    logicalMinute: 570,
  }]);
  const duplicateExpectation = await mutationExpectation(duplicateAccess, advance, { planIds: [PLAN_A] });
  const duplicateWriter = writer(duplicateAccess);
  const duplicateReceipt = await duplicateWriter.commit(advance, duplicateExpectation);
  assert.equal(duplicateReceipt.outcome, "rejected");
  assert.equal(duplicateAccess.transactionCounts.size, 0);
  assert.equal(await duplicateAccess.readText(PATH), duplicate);
  duplicateWriter.dispose();

  const semanticOnly = `${OPEN}\n- [ ] Task \`d20%\` [reference](https://example.test/d30%) d90% ^${PLAN_A}\n${CLOSE}\n`;
  const semanticAccess = new MemoryAtomicTextAccess({ [PATH]: semanticOnly });
  const semanticAdvance = plan("semantic-progress", "advance-progress", [{
    kind: "advance-progress",
    target: { kind: "plan-item", id: PLAN_A },
    logicalMinute: 570,
  }]);
  const semanticExpectation = await mutationExpectation(semanticAccess, semanticAdvance, { planIds: [PLAN_A] });
  const semanticWriter = writer(semanticAccess);
  const semanticReceipt = await semanticWriter.commit(semanticAdvance, semanticExpectation);
  const semanticAfter = await semanticAccess.readText(PATH);
  assert.equal(semanticReceipt.outcome, "applied");
  assert.ok(semanticAfter?.includes("`d20%`"));
  assert.ok(semanticAfter?.includes("https://example.test/d30%"));
  assert.equal(semanticAfter?.includes(" d90% "), false);
  semanticWriter.dispose();

  const unicodeDuplicate = `${OPEN}\n- [ ] Task d90%\u00a0d20% ^${PLAN_A}\n${CLOSE}\n`;
  const unicodeAccess = new MemoryAtomicTextAccess({ [PATH]: unicodeDuplicate });
  const unicodeAdvance = plan("unicode-duplicate-progress", "advance-progress", [{
    kind: "advance-progress",
    target: { kind: "plan-item", id: PLAN_A },
    logicalMinute: 570,
  }]);
  const unicodeExpectation = await mutationExpectation(unicodeAccess, unicodeAdvance, { planIds: [PLAN_A] });
  const unicodeWriter = writer(unicodeAccess);
  const unicodeReceipt = await unicodeWriter.commit(unicodeAdvance, unicodeExpectation);
  assert.equal(unicodeReceipt.outcome, "rejected");
  assert.equal(unicodeAccess.transactionCounts.size, 0);
  assert.equal(await unicodeAccess.readText(PATH), unicodeDuplicate);
  unicodeWriter.dispose();

  const plain = "body line\n";
  const initAccess = new MemoryAtomicTextAccess({ [PATH]: plain });
  const initialize = plan("mid-line-init", "initialize-plan", [{
    kind: "initialize-plan",
    insertionOffset: 2,
    lineEnding: "\n",
    expectedSource: plain,
  }]);
  const initExpectation = await mutationExpectation(initAccess, initialize, {});
  const initWriter = writer(initAccess);
  const initReceipt = await initWriter.commit(initialize, initExpectation);
  assert.equal(initReceipt.outcome, "rejected");
  assert.equal(initAccess.transactionCounts.size, 0);
  assert.equal(await initAccess.readText(PATH), plain);
  initWriter.dispose();
});

test("same-target Clock In and already-closed Clock Out are confirmed no-byte end states", async () => {
  const running = formatCanonicalRunningClock(START, 480, CLOCK_A);
  const active = `${OPEN}\n- [ ] Task ^${PLAN_A}\n  - LOGBOOK::\n    - ${running}\n${CLOSE}\n`;
  const activeAccess = new MemoryAtomicTextAccess({ [PATH]: active });
  const clockIn = plan("same-target", "clock-in", [{
    kind: "clock-in",
    target: { kind: "plan-item", id: PLAN_A },
    clock: { clockId: CLOCK_NEW, startEpochMs: NOW, offsetMinutes: 480 },
  }], [CLOCK_A]);
  const clockInExpectation = await mutationExpectation(activeAccess, clockIn, { planIds: [PLAN_A], expectedRunningClockIds: [CLOCK_A] });
  const activeWriter = writer(activeAccess);
  const same = await activeWriter.commit(clockIn, clockInExpectation);
  assert.equal(same.outcome, "already-applied");
  assert.deepEqual(same.sources, []);
  assert.equal(activeAccess.transactionCounts.size, 0);
  assert.equal(await activeAccess.readText(PATH), active);
  activeWriter.dispose();

  const closed = active.replace(running, formatCanonicalClosedClock(START, 480, NOW, 480, CLOCK_A));
  const closedAccess = new MemoryAtomicTextAccess({ [PATH]: closed });
  const clockOut = plan("already-out", "clock-out", [{
    kind: "clock-out",
    target: { kind: "clock", id: CLOCK_A, ownerId: PLAN_A },
    close: { clockId: CLOCK_A, endEpochMs: NOW, offsetMinutes: 480 },
  }]);
  const clockOutExpectation = await mutationExpectation(closedAccess, clockOut, { clockIds: [CLOCK_A] });
  const closedWriter = writer(closedAccess);
  const already = await closedWriter.commit(clockOut, clockOutExpectation);
  assert.equal(already.outcome, "already-applied");
  assert.equal(closedAccess.transactionCounts.size, 0);
  assert.equal(await closedAccess.readText(PATH), closed);
  closedWriter.dispose();
});

test("duplicate owner IDs block ordinary writes but exact canonical Clock Out and Delete remain recoverable", async () => {
  const source = `${OPEN}\n- [ ] Timed ^${PLAN_A}\n  - LOGBOOK::\n    - ${formatCanonicalRunningClock(START, 480, CLOCK_A)}\n${CLOSE}\n`;
  const duplicate = `${OPEN}\n- [ ] Duplicate owner ^${PLAN_A}\n${CLOSE}\n`;
  for (const action of ["clock-out", "delete-clock"] as const) {
    const access = new MemoryAtomicTextAccess({ [PATH]: source, "Daily/Duplicate.md": duplicate });
    const mutation = action === "clock-out"
      ? plan("duplicate-owner-out", action, [{
          kind: "clock-out",
          target: { kind: "clock", id: CLOCK_A, ownerId: PLAN_A },
          close: { clockId: CLOCK_A, endEpochMs: NOW, offsetMinutes: 480 },
        }], [CLOCK_A])
      : plan("duplicate-owner-delete", action, [{
          kind: "delete-clock",
          target: { kind: "clock", id: CLOCK_A, ownerId: PLAN_A },
          confirmation: {
            firstActivationEpochMs: NOW - 100,
            secondActivationEpochMs: NOW,
            firstTargetKey: CLOCK_A,
            secondTargetKey: CLOCK_A,
          },
        }], [CLOCK_A]);
    const expectation = await mutationExpectation(access, mutation, {
      clockIds: [CLOCK_A],
      expectedRunningClockIds: [CLOCK_A],
    });
    const committer = writer(access);
    const receipt = await committer.commit(mutation, expectation);
    assert.equal(receipt.outcome, "applied", `${action}: ${JSON.stringify(receipt)}`);
    assert.equal(access.transactionCounts.get(PATH), 1, action);
    const expected = action === "clock-out"
      ? source.replace(
          formatCanonicalRunningClock(START, 480, CLOCK_A),
          formatCanonicalClosedClock(START, 480, NOW, 480, CLOCK_A),
        )
      : source.replace(`    - ${formatCanonicalRunningClock(START, 480, CLOCK_A)}\n`, "");
    assert.equal(await access.readText(PATH), expected, action);
    assert.equal(await access.readText("Daily/Duplicate.md"), duplicate, action);
    committer.dispose();
  }
});

test("legacy folds and gaps are never guessed; explicit offsets normalize and close exact records", () => {
  const resolveLocalTime = (parts: { readonly hour: number; readonly minute: number }) =>
    parts.hour === 1
      ? { kind: "ambiguous" as const }
      : parts.hour === 2
        ? { kind: "nonexistent" as const }
        : { kind: "unique" as const, epochMs: Date.UTC(2026, 7, 28, parts.hour, parts.minute) };
  assert.equal(parseClockText("CLOCK: [2026-08-28 01:10]", { resolveLocalTime }).kind, "malformed");
  assert.equal(parseClockText("CLOCK: [2026-08-28 02:10]", { resolveLocalTime }).kind, "malformed");

  const legacy = `${OPEN}\n- [ ] Task ^${PLAN_A}\n  - LOGBOOK::\n    - CLOCK: [2026-08-28 08:10]\n${CLOSE}\n`;
  const logbook = readLogbook(legacy, {
    path: PATH,
    itemFromOffset: legacy.indexOf("- [ ]"),
    itemToOffset: legacy.indexOf(CLOSE),
    ownerId: PLAN_A,
  }, { resolveLocalTime });
  const clock = logbook.clocks[0]!;
  assert.throws(() => createCloseRunningClockEdit(legacy, clock, {
    endEpochMs: Date.UTC(2026, 7, 28, 9),
    endOffsetMinutes: 480,
    assignedClockId: CLOCK_NEW,
  }), /explicitly resolved start offset/);
  const normalized = applyAllowedByteEdits(legacy, [createNormalizeLegacyClockEdit(legacy, clock, {
    clockId: CLOCK_NEW,
    startOffsetMinutes: 480,
  })]).text;
  assert.ok(normalized.includes(formatCanonicalRunningClock(Date.UTC(2026, 7, 28, 8, 10), 480, CLOCK_NEW)));
});

test("legacy Clock Out rejects a start offset that disagrees with the configured zone", async () => {
  const legacyStart = Date.UTC(2026, 7, 28, 0, 10);
  const source = `${OPEN}\n- [ ] Task ^${PLAN_A}\n  - LOGBOOK::\n    - CLOCK: [2026-08-28 08:10] ^${CLOCK_A}\n${CLOSE}\n`;
  const resolveLocalTime = () => ({ kind: "unique" as const, epochMs: legacyStart });
  const access = new MemoryAtomicTextAccess({ [PATH]: source });
  const mutation = plan("legacy-close-wrong-start-offset", "clock-out", [{
    kind: "clock-out",
    target: { kind: "clock", id: CLOCK_A, ownerId: PLAN_A },
    close: {
      clockId: CLOCK_A,
      endEpochMs: NOW,
      offsetMinutes: 480,
      legacyStartOffsetMinutes: -300,
    },
  }], [CLOCK_A]);
  const expectation = await mutationExpectation(access, mutation, {
    clockIds: [CLOCK_A],
    expectedRunningClockIds: [CLOCK_A],
    logbookOptions: { resolveLocalTime },
  });
  const committer = new WorkspaceCommitter(access, {
    readContext: () => CONTEXT,
    index: { clockParsing: { resolveLocalTime } },
    logbook: { resolveLocalTime },
  });
  const receipt = await committer.commit(mutation, expectation);
  assert.equal(receipt.outcome, "conflict");
  assert.equal(receipt.result?.code, "clock-discontinuity");
  assert.equal(access.transactionCounts.size, 0);
  assert.equal(await access.readText(PATH), source);
  committer.dispose();
});

test("uniquely resolved identified legacy CLOCKs support no-op, unrelated Complete, relocation, and switch", async () => {
  const legacyStart = Date.UTC(2026, 7, 28, 0, 10);
  const source = `${OPEN}\n- [ ] Timed ^${PLAN_A}\n  - LOGBOOK::\n    - CLOCK: [2026-08-28 08:10] ^${CLOCK_A}\n- [ ] Other ^${PLAN_B}\n${CLOSE}\n`;
  const resolveLocalTime = () => ({ kind: "unique" as const, epochMs: legacyStart });
  const options = {
    readContext: () => CONTEXT,
    index: { clockParsing: { resolveLocalTime } },
    logbook: { resolveLocalTime },
  } as const;

  const noOpAccess = new MemoryAtomicTextAccess({ [PATH]: source });
  const clockIn = plan("legacy-same-target", "clock-in", [{
    kind: "clock-in",
    target: { kind: "plan-item", id: PLAN_A },
    clock: { clockId: CLOCK_NEW, startEpochMs: NOW, offsetMinutes: 480 },
  }], [CLOCK_A]);
  const clockInExpectation = await mutationExpectation(noOpAccess, clockIn, {
    planIds: [PLAN_A], clockIds: [CLOCK_A], expectedRunningClockIds: [CLOCK_A],
    logbookOptions: { resolveLocalTime },
  });
  const noOpWriter = new WorkspaceCommitter(noOpAccess, options);
  const noOp = await noOpWriter.commit(clockIn, clockInExpectation);
  assert.equal(noOp.outcome, "already-applied");
  assert.equal(noOpAccess.transactionCounts.size, 0);
  noOpWriter.dispose();

  const completeAccess = new MemoryAtomicTextAccess({ [PATH]: source });
  const complete = plan("complete-other-with-legacy", "complete", [{
    kind: "complete", target: { kind: "plan-item", id: PLAN_B },
  }], [CLOCK_A]);
  const completeExpectation = await mutationExpectation(completeAccess, complete, {
    planIds: [PLAN_B], clockIds: [CLOCK_A], expectedRunningClockIds: [CLOCK_A],
    logbookOptions: { resolveLocalTime },
  });
  const completeWriter = new WorkspaceCommitter(completeAccess, options);
  const completed = await completeWriter.commit(complete, completeExpectation);
  assert.equal(completed.outcome, "applied");
  assert.ok((await completeAccess.readText(PATH))?.includes(`- [x] Other ^${PLAN_B}`));
  assert.equal(completed.globalCheck.status, "confirmed");
  completeWriter.dispose();

  const relocated = "Archive/Relocated.md";
  const switchAccess = new MemoryAtomicTextAccess({ [PATH]: source }, "editor");
  const switchPlan = createMutationPlan({
    intentId: "switch-from-relocated-legacy",
    action: "switch-task",
    stages: [{
      path: PATH,
      confirmationRequired: false,
      operations: [
        {
          kind: "clock-out",
          target: { kind: "clock", id: CLOCK_A, ownerId: PLAN_A },
          close: {
            clockId: CLOCK_A,
            endEpochMs: NOW,
            offsetMinutes: 480,
            legacyStartOffsetMinutes: 480,
          },
        },
        {
          kind: "clock-in",
          target: { kind: "plan-item", id: PLAN_B },
          clock: { clockId: CLOCK_NEW, startEpochMs: NOW, offsetMinutes: 480 },
        },
      ],
    }],
    expectedRunningClockIds: [CLOCK_A],
    settingsVersion: CONTEXT.settingsVersion,
    zoneId: CONTEXT.zoneId,
    transitionEpochMs: NOW,
  });
  const switchExpectation = await mutationExpectation(switchAccess, switchPlan, {
    planIds: [PLAN_B], clockIds: [CLOCK_A], expectedRunningClockIds: [CLOCK_A],
    logbookOptions: { resolveLocalTime },
  });
  switchAccess.rename(PATH, relocated);
  const switchWriter = new WorkspaceCommitter(switchAccess, options);
  const switched = await switchWriter.commit(switchPlan, switchExpectation);
  const switchedText = await switchAccess.readText(relocated);
  assert.equal(switched.outcome, "applied");
  assert.ok(switchedText?.includes(formatCanonicalClosedClock(legacyStart, 480, NOW, 480, CLOCK_A)));
  assert.ok(switchedText?.includes(formatCanonicalRunningClock(NOW, 480, CLOCK_NEW)));
  assert.equal(switchAccess.transactionCounts.get(relocated), 1);
  switchWriter.dispose();

  const reorderedAccess = new MemoryAtomicTextAccess({ [PATH]: source });
  const close = plan("close-reordered-legacy", "clock-out", [{
    kind: "clock-out",
    target: { kind: "clock", id: CLOCK_A, ownerId: PLAN_A },
    close: { clockId: CLOCK_A, endEpochMs: NOW, offsetMinutes: 480, legacyStartOffsetMinutes: 480 },
  }], [CLOCK_A]);
  const closeExpectation = await mutationExpectation(reorderedAccess, close, {
    clockIds: [CLOCK_A], expectedRunningClockIds: [CLOCK_A], logbookOptions: { resolveLocalTime },
  });
  const reordered = `${OPEN}\n- [ ] Other ^${PLAN_B}\n- [ ] Timed ^${PLAN_A}\n  - LOGBOOK::\n    - CLOCK: [2026-08-28 08:10] ^${CLOCK_A}\n${CLOSE}\n`;
  reorderedAccess.modify(PATH, reordered);
  const reorderedWriter = new WorkspaceCommitter(reorderedAccess, options);
  const closed = await reorderedWriter.commit(close, closeExpectation);
  assert.equal(closed.outcome, "applied");
  assert.ok((await reorderedAccess.readText(PATH))?.includes(
    formatCanonicalClosedClock(legacyStart, 480, NOW, 480, CLOCK_A),
  ));
  reorderedWriter.dispose();
});

test("legacy reconciliation rejects duplicate owners and never relocates ID-less equal text", async () => {
  const legacyStart = Date.UTC(2026, 7, 28, 0, 10);
  const identified = `${OPEN}\n- [ ] Timed ^${PLAN_A}\n  - LOGBOOK::\n    - CLOCK: [2026-08-28 08:10] ^${CLOCK_A}\n${CLOSE}\n`;
  const resolveLocalTime = () => ({ kind: "unique" as const, epochMs: legacyStart });
  const access = new MemoryAtomicTextAccess({ [PATH]: identified });
  const close = plan("legacy-duplicate-owner", "clock-out", [{
    kind: "clock-out",
    target: { kind: "clock", id: CLOCK_A, ownerId: PLAN_A },
    close: { clockId: CLOCK_A, endEpochMs: NOW, offsetMinutes: 480, legacyStartOffsetMinutes: 480 },
  }], [CLOCK_A]);
  const expectation = await mutationExpectation(access, close, {
    clockIds: [CLOCK_A], expectedRunningClockIds: [CLOCK_A], logbookOptions: { resolveLocalTime },
  });
  const externallyDuplicated = identified.replace(CLOSE, `- [ ] Duplicate ^${PLAN_A}\n${CLOSE}`);
  access.modify(PATH, externallyDuplicated);
  const committer = new WorkspaceCommitter(access, {
    readContext: () => CONTEXT,
    index: { clockParsing: { resolveLocalTime } },
    logbook: { resolveLocalTime },
  });
  const rejected = await committer.commit(close, expectation);
  assert.equal(rejected.outcome, "conflict");
  assert.equal(access.transactionCounts.size, 0);
  assert.equal(await access.readText(PATH), externallyDuplicated);
  committer.dispose();

  const anonymous = `${OPEN}\n- [ ] Timed ^${PLAN_A}\n  - LOGBOOK::\n    - CLOCK: [2026-08-28 08:10]\n${CLOSE}\n`;
  const anonymousClockText = "CLOCK: [2026-08-28 08:10]";
  const anonymousKey = legacyRunningClockKey(PATH, anonymous.indexOf(anonymousClockText), anonymousClockText);
  const anonymousAccess = new MemoryAtomicTextAccess({ [PATH]: anonymous });
  const anonymousClose = plan("idless-nonrelocation", "clock-out", [{
    kind: "clock-out",
    target: { kind: "clock", ownerId: PLAN_A },
    close: {
      clockId: CLOCK_NEW,
      assignedClockId: CLOCK_NEW,
      endEpochMs: NOW,
      offsetMinutes: 480,
      legacyStartOffsetMinutes: 480,
    },
  }], [anonymousKey]);
  const anonymousExpectation = await mutationExpectation(anonymousAccess, anonymousClose, {
    clockIds: [undefined],
    expectedRunningClockIds: [anonymousKey],
    logbookOptions: { resolveLocalTime },
  });
  anonymousAccess.rename(PATH, "Archive/Anonymous.md");
  const anonymousWriter = new WorkspaceCommitter(anonymousAccess, {
    readContext: () => CONTEXT,
    index: { clockParsing: { resolveLocalTime } },
    logbook: { resolveLocalTime },
  });
  const anonymousRejected = await anonymousWriter.commit(anonymousClose, anonymousExpectation);
  assert.equal(anonymousRejected.outcome, "rejected");
  assert.equal(anonymousAccess.transactionCounts.size, 0);
  assert.equal(await anonymousAccess.readText("Archive/Anonymous.md"), anonymous);
  anonymousWriter.dispose();
});

test("selected DST fold normalizes end-to-end while a nonexistent local time remains non-writable", async () => {
  const selectedEpoch = Date.UTC(2026, 10, 1, 5, 30);
  const resolveLocalTime = (parts: { readonly hour: number }) => parts.hour === 1
    ? { kind: "ambiguous" as const }
    : { kind: "nonexistent" as const };
  const fold = `${OPEN}\n- [ ] Task ^${PLAN_A}\n  - LOGBOOK::\n    - CLOCK: [2026-11-01 01:30]\n${CLOSE}\n`;
  const access = new MemoryAtomicTextAccess({ [PATH]: fold });
  const mutation = createMutationPlan({
    intentId: "normalize-fold",
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
  const expectation = await mutationExpectation(access, mutation, {
    clockIds: [undefined],
    logbookOptions: { resolveLocalTime },
  });
  const committer = new WorkspaceCommitter(access, {
    readContext: () => ({ ...CONTEXT, zoneId: "America/New_York" }),
    index: { clockParsing: { resolveLocalTime } },
    logbook: { resolveLocalTime },
  });
  const receipt = await committer.commit(mutation, expectation);
  assert.equal(receipt.outcome, "applied");
  assert.ok((await access.readText(PATH))?.includes(formatCanonicalRunningClock(selectedEpoch, -240, CLOCK_NEW)));
  committer.dispose();

  const identifiedFold = fold.replace("[2026-11-01 01:30]", `[2026-11-01 01:30] ^${CLOCK_A}`);
  const identifiedAccess = new MemoryAtomicTextAccess({ [PATH]: identifiedFold });
  const { previewToken: _foldPreviewToken, ...foldInput } = mutation;
  const identifiedMutation = createMutationPlan({
    ...foldInput,
    intentId: "normalize-identified-fold",
    stages: [{ path: PATH, confirmationRequired: true, operations: [{
      ...mutation.stages[0]!.operations[0]!,
      target: { kind: "clock", id: CLOCK_A, ownerId: PLAN_A },
      clockId: CLOCK_A,
    }] }],
  });
  const identifiedExpectation = await mutationExpectation(identifiedAccess, identifiedMutation, {
    clockIds: [CLOCK_A],
    logbookOptions: { resolveLocalTime },
  });
  const identifiedCommitter = new WorkspaceCommitter(identifiedAccess, {
    readContext: () => ({ ...CONTEXT, zoneId: "America/New_York" }),
    index: { clockParsing: { resolveLocalTime } },
    logbook: { resolveLocalTime },
  });
  const identifiedReceipt = await identifiedCommitter.commit(identifiedMutation, identifiedExpectation);
  assert.equal(identifiedReceipt.outcome, "applied", JSON.stringify(identifiedReceipt));
  assert.deepEqual(identifiedReceipt.globalCheck.runningClockIds, [CLOCK_A]);
  assert.ok((await identifiedAccess.readText(PATH))?.includes(formatCanonicalRunningClock(selectedEpoch, -240, CLOCK_A)));
  identifiedCommitter.dispose();

  const competingFold = fold.replace(
    `${CLOSE}\n`,
    `- [ ] Other ^${PLAN_B}\n  - LOGBOOK::\n    - CLOCK: [2026-11-01 01:30]\n${CLOSE}\n`,
  );
  const competingAccess = new MemoryAtomicTextAccess({ [PATH]: competingFold });
  const competingExpectation = await mutationExpectation(competingAccess, mutation, {
    clockIds: [undefined],
    logbookOptions: { resolveLocalTime },
  });
  const competingCommitter = new WorkspaceCommitter(competingAccess, {
    readContext: () => ({ ...CONTEXT, zoneId: "America/New_York" }),
    index: { clockParsing: { resolveLocalTime } },
    logbook: { resolveLocalTime },
  });
  const competingReceipt = await competingCommitter.commit(mutation, competingExpectation);
  assert.equal(competingReceipt.outcome, "conflict");
  assert.equal(competingReceipt.result?.code, "potential-running-clock");
  assert.equal(competingAccess.transactionCounts.size, 0);
  assert.equal(await competingAccess.readText(PATH), competingFold);
  competingCommitter.dispose();

  const closedFold = `${OPEN}\n- [ ] Task ^${PLAN_A}\n  - LOGBOOK::\n    - CLOCK: [2026-11-01 01:30]--[2026-11-01 03:30]\n${CLOSE}\n`;
  const closedFoldAccess = new MemoryAtomicTextAccess({ [PATH]: closedFold });
  const closedEndEpoch = Date.UTC(2026, 10, 1, 8, 30);
  const closedMutation = createMutationPlan({
    intentId: "normalize-closed-fold",
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
      endEpochMs: closedEndEpoch,
      endOffsetMinutes: -300,
      endFoldCandidates: [{ epochMs: closedEndEpoch, offsetMinutes: -300 }],
    }] }],
    expectedRunningClockIds: [],
    settingsVersion: CONTEXT.settingsVersion,
    zoneId: "America/New_York",
  });
  const closedExpectation = await mutationExpectation(closedFoldAccess, closedMutation, {
    clockIds: [undefined], logbookOptions: { resolveLocalTime },
  });
  const closedCommitter = new WorkspaceCommitter(closedFoldAccess, {
    readContext: () => ({ ...CONTEXT, zoneId: "America/New_York" }),
    index: { clockParsing: { resolveLocalTime } },
    logbook: { resolveLocalTime },
  });
  const closedReceipt = await closedCommitter.commit(closedMutation, closedExpectation);
  assert.equal(closedReceipt.outcome, "applied");
  assert.ok((await closedFoldAccess.readText(PATH))?.includes(
    formatCanonicalClosedClock(selectedEpoch, -240, closedEndEpoch, -300, CLOCK_NEW),
  ));
  assert.deepEqual(closedReceipt.globalCheck.runningClockIds, []);
  closedCommitter.dispose();

  const gap = fold.replace("01:30", "02:30");
  const gapAccess = new MemoryAtomicTextAccess({ [PATH]: gap });
  await assert.rejects(
    mutationExpectation(gapAccess, mutation, { clockIds: [undefined], logbookOptions: { resolveLocalTime } }),
    /selected DST fold/,
  );
  assert.equal(gapAccess.transactionCounts.size, 0);
});

test("backwards Clock Out is zero-byte while closed malformed history remains preserved and nonblocking", async () => {
  const runningSource = `${OPEN}\n- [ ] Task ^${PLAN_A}\n  - LOGBOOK::\n    - ${formatCanonicalRunningClock(START, 480, CLOCK_A)}\n${CLOSE}\n`;
  const backwardsAccess = new MemoryAtomicTextAccess({ [PATH]: runningSource });
  const backwards = plan("backwards-clock-out", "clock-out", [{
    kind: "clock-out",
    target: { kind: "clock", id: CLOCK_A, ownerId: PLAN_A },
    close: { clockId: CLOCK_A, endEpochMs: START - 1, offsetMinutes: 480 },
  }], [CLOCK_A]);
  const backwardsExpectation = await mutationExpectation(backwardsAccess, backwards, {
    clockIds: [CLOCK_A], expectedRunningClockIds: [CLOCK_A],
  });
  const backwardsWriter = writer(backwardsAccess);
  const backwardsReceipt = await backwardsWriter.commit(backwards, backwardsExpectation);
  assert.equal(backwardsReceipt.outcome, "rejected");
  assert.equal(backwardsReceipt.result?.code, "clock-discontinuity");
  assert.equal(backwardsAccess.transactionCounts.size, 0);
  assert.equal(await backwardsAccess.readText(PATH), runningSource);
  backwardsWriter.dispose();

  const malformed = "CLOCK: [2026-08-28T08:10+08:00]--[broken]";
  const historySource = `${OPEN}\n- [ ] History ^${PLAN_A}\n  - LOGBOOK::\n    - ${malformed}\n- [ ] Current ^${PLAN_B}\n${CLOSE}\n`;
  const historyAccess = new MemoryAtomicTextAccess({ [PATH]: historySource });
  const start = plan("closed-malformed-history", "clock-in", [{
    kind: "clock-in",
    target: { kind: "plan-item", id: PLAN_B },
    clock: { clockId: CLOCK_NEW, startEpochMs: NOW, offsetMinutes: 480 },
  }]);
  const historyExpectation = await mutationExpectation(historyAccess, start, { planIds: [PLAN_B] });
  const historyWriter = writer(historyAccess);
  const historyReceipt = await historyWriter.commit(start, historyExpectation);
  const historyAfter = await historyAccess.readText(PATH);
  assert.equal(historyReceipt.outcome, "applied");
  assert.ok(historyAfter?.includes(malformed));
  assert.ok(historyAfter?.includes(formatCanonicalRunningClock(NOW, 480, CLOCK_NEW)));
  historyWriter.dispose();
});

test("stale click timestamps cannot drive normal timing endpoints or completion anchors", async () => {
  const idle = `${OPEN}\n- [ ] Task ^${PLAN_A}\n${CLOSE}\n`;
  const staleClockIn = plan("stale-clock-in", "clock-in", [{
    kind: "clock-in",
    target: { kind: "plan-item", id: PLAN_A },
    clock: { clockId: CLOCK_NEW, startEpochMs: NOW - 1, offsetMinutes: 480 },
  }]);
  const idleAccess = new MemoryAtomicTextAccess({ [PATH]: idle });
  const idleExpectation = await mutationExpectation(idleAccess, staleClockIn, { planIds: [PLAN_A] });
  const idleWriter = writer(idleAccess);
  const staleOpen = await idleWriter.commit(staleClockIn, idleExpectation);
  assert.equal(staleOpen.outcome, "rejected");
  assert.equal(staleOpen.result?.code, "clock-discontinuity");
  assert.equal(idleAccess.transactionCounts.size, 0);
  assert.equal(await idleAccess.readText(PATH), idle);
  idleWriter.dispose();

  const active = `${OPEN}\n- [ ] Task d90% ^${PLAN_A}\n  - LOGBOOK::\n    - ${formatCanonicalRunningClock(START, 480, CLOCK_A)}\n${CLOSE}\n`;
  for (const mutation of [
    plan("stale-clock-out", "clock-out", [{
      kind: "clock-out",
      target: { kind: "clock", id: CLOCK_A, ownerId: PLAN_A },
      close: { clockId: CLOCK_A, endEpochMs: NOW - 1, offsetMinutes: 480 },
    }], [CLOCK_A]),
    plan("stale-complete", "complete", [{
      kind: "complete",
      target: { kind: "plan-item", id: PLAN_A },
      closeClock: { clockId: CLOCK_A, endEpochMs: NOW - 1, offsetMinutes: 480 },
    }], [CLOCK_A]),
    plan("stale-progress", "advance-progress", [{
      kind: "advance-progress",
      target: { kind: "plan-item", id: PLAN_A },
      logicalMinute: 571,
      closeClock: { clockId: CLOCK_A, endEpochMs: NOW - 1, offsetMinutes: 480 },
    }], [CLOCK_A]),
  ]) {
    const access = new MemoryAtomicTextAccess({ [PATH]: active });
    const targets = mutation.action === "clock-out"
      ? { clockIds: [CLOCK_A], expectedRunningClockIds: [CLOCK_A] }
      : { planIds: [PLAN_A], clockIds: [CLOCK_A], expectedRunningClockIds: [CLOCK_A] };
    const expectation = await mutationExpectation(access, mutation, targets);
    const committer = writer(access);
    const receipt = await committer.commit(mutation, expectation);
    assert.equal(receipt.outcome, "rejected", mutation.action);
    assert.equal(receipt.result?.code, "clock-discontinuity", mutation.action);
    assert.equal(access.transactionCounts.size, 0, mutation.action);
    assert.equal(await access.readText(PATH), active, mutation.action);
    committer.dispose();
  }

  const switchSource = `${OPEN}\n- [ ] Old ^${PLAN_A}\n  - LOGBOOK::\n    - ${formatCanonicalRunningClock(START, 480, CLOCK_A)}\n- [ ] New ^${PLAN_B}\n${CLOSE}\n`;
  const staleSwitch = createMutationPlan({
    intentId: "stale-switch",
    action: "switch-task",
    stages: [{ path: PATH, confirmationRequired: false, operations: [
      { kind: "clock-out", target: { kind: "clock", id: CLOCK_A, ownerId: PLAN_A }, close: { clockId: CLOCK_A, endEpochMs: NOW - 1, offsetMinutes: 480 } },
      { kind: "clock-in", target: { kind: "plan-item", id: PLAN_B }, clock: { clockId: CLOCK_NEW, startEpochMs: NOW - 1, offsetMinutes: 480 } },
    ] }],
    expectedRunningClockIds: [CLOCK_A],
    settingsVersion: CONTEXT.settingsVersion,
    zoneId: CONTEXT.zoneId,
    transitionEpochMs: NOW - 1,
  });
  const switchAccess = new MemoryAtomicTextAccess({ [PATH]: switchSource });
  const switchExpectation = await mutationExpectation(switchAccess, staleSwitch, {
    planIds: [PLAN_B], clockIds: [CLOCK_A], expectedRunningClockIds: [CLOCK_A],
  });
  const switchWriter = writer(switchAccess);
  const switchReceipt = await switchWriter.commit(staleSwitch, switchExpectation);
  assert.equal(switchReceipt.outcome, "rejected");
  assert.equal(switchReceipt.result?.code, "clock-discontinuity");
  assert.equal(switchAccess.transactionCounts.size, 0);
  assert.equal(await switchAccess.readText(PATH), switchSource);
  switchWriter.dispose();

  const { previewToken: _switchPreviewToken, ...switchInput } = staleSwitch;
  const sameOwnerSwitch = createMutationPlan({
    ...switchInput,
    intentId: "same-owner-switch",
    stages: [{ path: PATH, confirmationRequired: false, operations: [
      { kind: "clock-out", target: { kind: "clock", id: CLOCK_A, ownerId: PLAN_A }, close: { clockId: CLOCK_A, endEpochMs: NOW, offsetMinutes: 480 } },
      { kind: "clock-in", target: { kind: "plan-item", id: PLAN_A }, clock: { clockId: CLOCK_NEW, startEpochMs: NOW, offsetMinutes: 480 } },
    ] }],
    transitionEpochMs: NOW,
  });
  const sameOwnerAccess = new MemoryAtomicTextAccess({ [PATH]: active });
  const sameOwnerExpectation = await mutationExpectation(sameOwnerAccess, sameOwnerSwitch, {
    planIds: [PLAN_A], clockIds: [CLOCK_A], expectedRunningClockIds: [CLOCK_A],
  });
  const sameOwnerWriter = writer(sameOwnerAccess);
  const sameOwnerReceipt = await sameOwnerWriter.commit(sameOwnerSwitch, sameOwnerExpectation);
  assert.equal(sameOwnerReceipt.outcome, "rejected");
  assert.equal(sameOwnerReceipt.result?.code, "action-no-longer-applicable");
  assert.equal(sameOwnerAccess.transactionCounts.size, 0);
  assert.equal(await sameOwnerAccess.readText(PATH), active);
  sameOwnerWriter.dispose();
});

test("nonzero-millisecond wall anchors retain an integral zone offset", async () => {
  const source = `${OPEN}\n- [ ] Task ^${PLAN_A}\n${CLOSE}\n`;
  const wallEpochMs = NOW + 123;
  const access = new MemoryAtomicTextAccess({ [PATH]: source });
  const mutation = plan("millisecond-clock-in", "clock-in", [{
    kind: "clock-in",
    target: { kind: "plan-item", id: PLAN_A },
    clock: { clockId: CLOCK_NEW, startEpochMs: wallEpochMs, offsetMinutes: 480 },
  }]);
  const baseline = await mutationExpectation(access, mutation, { planIds: [PLAN_A] });
  const expectation = expectationWithTime(baseline, { wallEpochMs });
  const context = Object.freeze({ ...CONTEXT, wallEpochMs });
  const committer = writer(access, context);
  const receipt = await committer.commit(mutation, expectation);
  assert.equal(receipt.outcome, "applied");
  assert.ok((await access.readText(PATH))?.includes(formatCanonicalRunningClock(wallEpochMs, 480, CLOCK_NEW)));
  committer.dispose();
});

test("wall-clock discontinuity rejects timing before entering a host mutation", async () => {
  const source = `${OPEN}\n- [ ] Task ^${PLAN_A}\n${CLOSE}\n`;
  const access = new MemoryAtomicTextAccess({ [PATH]: source });
  const mutation = plan("discontinuity", "clock-in", [{
    kind: "clock-in",
    target: { kind: "plan-item", id: PLAN_A },
    clock: { clockId: CLOCK_NEW, startEpochMs: NOW, offsetMinutes: 480 },
  }]);
  const expectation = await mutationExpectation(access, mutation, { planIds: [PLAN_A] });
  const committer = writer(access, { ...CONTEXT, discontinuity: true });
  const receipt = await committer.commit(mutation, expectation);
  assert.equal(receipt.outcome, "rejected");
  assert.equal(receipt.result?.code, "clock-discontinuity");
  assert.equal(access.transactionCounts.size, 0);
  assert.equal(await access.readText(PATH), source);
  committer.dispose();
});

test("explicit discontinuity recovery validates measured rebase arithmetic and last-trusted stop", async () => {
  const recoveryContext = Object.freeze({
    ...CONTEXT,
    wallEpochMs: NOW + 60 * 60_000,
    monotonicMs: CONTEXT.monotonicMs + 10_000,
    discontinuity: true,
  });
  const trustedElapsed = NOW + 10_000 - START;
  const rebasedStart = recoveryContext.wallEpochMs - trustedElapsed;
  const source = `${OPEN}\n- [ ] Task ^${PLAN_A}\n  - LOGBOOK::\n    - ${formatCanonicalRunningClock(START, 480, CLOCK_A)}\n${CLOSE}\n`;

  const stableContext = Object.freeze({ ...CONTEXT, discontinuity: true });
  const stableAccess = new MemoryAtomicTextAccess({ [PATH]: source });
  const stable = plan("recovery-keep-stable", "keep-measured-time", [{
    kind: "rebase-clock",
    target: { kind: "clock", id: CLOCK_A, ownerId: PLAN_A },
    startEpochMs: START,
    offsetMinutes: 480,
  }], [CLOCK_A]);
  const stableBase = await mutationExpectation(stableAccess, stable, {
    clockIds: [CLOCK_A], expectedRunningClockIds: [CLOCK_A],
  });
  const stableExpectation = expectationWithTime(stableBase, { discontinuity: true });
  const stableWriter = writer(stableAccess, stableContext);
  const stableReceipt = await stableWriter.commit(stable, stableExpectation);
  assert.equal(stableReceipt.outcome, "already-applied");
  assert.deepEqual(stableReceipt.sources, []);
  assert.deepEqual(stableReceipt.semanticChanges, []);
  assert.equal(stableAccess.transactionCounts.size, 0);
  assert.equal(await stableAccess.readText(PATH), source);
  stableWriter.dispose();

  const keepAccess = new MemoryAtomicTextAccess({ [PATH]: source });
  const keep = plan("recovery-keep", "keep-measured-time", [{
    kind: "rebase-clock",
    target: { kind: "clock", id: CLOCK_A, ownerId: PLAN_A },
    startEpochMs: rebasedStart,
    offsetMinutes: 480,
  }], [CLOCK_A]);
  const keepBase = await mutationExpectation(keepAccess, keep, {
    clockIds: [CLOCK_A], expectedRunningClockIds: [CLOCK_A],
  });
  const keepExpectation = expectationWithTime(keepBase, { discontinuity: true });
  const keepWriter = writer(keepAccess, recoveryContext);
  const keepReceipt = await keepWriter.commit(keep, keepExpectation);
  assert.equal(keepReceipt.outcome, "applied");
  assert.ok((await keepAccess.readText(PATH))?.includes(formatCanonicalRunningClock(rebasedStart, 480, CLOCK_A)));
  keepWriter.dispose();

  const wrongAccess = new MemoryAtomicTextAccess({ [PATH]: source });
  const wrong = plan("recovery-wrong", "keep-measured-time", [{
    kind: "rebase-clock",
    target: { kind: "clock", id: CLOCK_A, ownerId: PLAN_A },
    startEpochMs: rebasedStart + 1,
    offsetMinutes: 480,
  }], [CLOCK_A]);
  const wrongBase = await mutationExpectation(wrongAccess, wrong, {
    clockIds: [CLOCK_A], expectedRunningClockIds: [CLOCK_A],
  });
  const wrongExpectation = expectationWithTime(wrongBase, { discontinuity: true });
  const wrongWriter = writer(wrongAccess, recoveryContext);
  const wrongReceipt = await wrongWriter.commit(wrong, wrongExpectation);
  assert.equal(wrongReceipt.outcome, "conflict");
  assert.equal(wrongReceipt.result?.code, "clock-discontinuity");
  assert.equal(wrongAccess.transactionCounts.size, 0);
  assert.equal(await wrongAccess.readText(PATH), source);
  wrongWriter.dispose();

  const wrongOffsetAccess = new MemoryAtomicTextAccess({ [PATH]: source });
  const wrongOffset = plan("recovery-wrong-offset", "keep-measured-time", [{
    kind: "rebase-clock",
    target: { kind: "clock", id: CLOCK_A, ownerId: PLAN_A },
    startEpochMs: rebasedStart,
    offsetMinutes: -300,
  }], [CLOCK_A]);
  const wrongOffsetBase = await mutationExpectation(wrongOffsetAccess, wrongOffset, {
    clockIds: [CLOCK_A], expectedRunningClockIds: [CLOCK_A],
  });
  const wrongOffsetExpectation = expectationWithTime(wrongOffsetBase, { discontinuity: true });
  const wrongOffsetWriter = writer(wrongOffsetAccess, recoveryContext);
  const wrongOffsetReceipt = await wrongOffsetWriter.commit(wrongOffset, wrongOffsetExpectation);
  assert.equal(wrongOffsetReceipt.outcome, "rejected");
  assert.equal(wrongOffsetReceipt.result?.code, "clock-discontinuity");
  assert.equal(wrongOffsetAccess.transactionCounts.size, 0);
  assert.equal(await wrongOffsetAccess.readText(PATH), source);
  wrongOffsetWriter.dispose();

  const stopAccess = new MemoryAtomicTextAccess({ [PATH]: source });
  const stop = plan("recovery-stop", "stop-at-trusted-time", [{
    kind: "clock-out",
    target: { kind: "clock", id: CLOCK_A, ownerId: PLAN_A },
    close: { clockId: CLOCK_A, endEpochMs: NOW + 10_000, offsetMinutes: 480 },
  }], [CLOCK_A]);
  const stopBase = await mutationExpectation(stopAccess, stop, {
    clockIds: [CLOCK_A], expectedRunningClockIds: [CLOCK_A],
  });
  const stopExpectation = expectationWithTime(stopBase, { discontinuity: true });
  const stopWriter = writer(stopAccess, recoveryContext);
  const stopReceipt = await stopWriter.commit(stop, stopExpectation);
  assert.equal(stopReceipt.outcome, "applied");
  assert.ok((await stopAccess.readText(PATH))?.includes(formatCanonicalClosedClock(START, 480, NOW + 10_000, 480, CLOCK_A)));
  stopWriter.dispose();

  const wrongStopAccess = new MemoryAtomicTextAccess({ [PATH]: source });
  const wrongStop = plan("recovery-stop-wrong-offset", "stop-at-trusted-time", [{
    kind: "clock-out",
    target: { kind: "clock", id: CLOCK_A, ownerId: PLAN_A },
    close: { clockId: CLOCK_A, endEpochMs: NOW + 10_000, offsetMinutes: -300 },
  }], [CLOCK_A]);
  const wrongStopBase = await mutationExpectation(wrongStopAccess, wrongStop, {
    clockIds: [CLOCK_A], expectedRunningClockIds: [CLOCK_A],
  });
  const wrongStopExpectation = expectationWithTime(wrongStopBase, { discontinuity: true });
  const wrongStopWriter = writer(wrongStopAccess, recoveryContext);
  const wrongStopReceipt = await wrongStopWriter.commit(wrongStop, wrongStopExpectation);
  assert.equal(wrongStopReceipt.outcome, "rejected");
  assert.equal(wrongStopReceipt.result?.code, "clock-discontinuity");
  assert.equal(wrongStopAccess.transactionCounts.size, 0);
  assert.equal(await wrongStopAccess.readText(PATH), source);
  wrongStopWriter.dispose();
});
