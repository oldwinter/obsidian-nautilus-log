import assert from "node:assert/strict";
import test from "node:test";

import { WorkspaceCommitter } from "../../../src/workspace/commit.ts";
import { WRITE_RESULT_CODES, createCommitConflict } from "../../../src/workspace/conflicts.ts";
import { formatCanonicalRunningClock } from "../../../src/workspace/logbook-clock.ts";
import { createMutationPlan, type MutationPlan } from "../../../src/workspace/mutations.ts";
import { createCommitReceipt } from "../../../src/workspace/receipt.ts";
import { createSourceVersion } from "../../../src/workspace/source-version.ts";
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

function clockInPlan(expectedRunningClockIds: readonly string[] = []) {
  return createMutationPlan({
    intentId: "protocol-clock-in",
    action: "clock-in",
    stages: [{
      path: PATH,
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

test("receipt constructors reject false zero-change and false Undo claims", async () => {
  const before = await createSourceVersion(PATH, "before");
  const after = await createSourceVersion(PATH, "after");
  assert.throws(() => createCommitReceipt({
    intentId: "false-conflict",
    action: "clock-in",
    outcome: "conflict",
    sources: [{ path: PATH, primitive: "vault-process", before, after }],
    semanticChanges: [],
    confirmation: "confirmed-no-change",
    globalCheck: { status: "confirmed", runningClockIds: [] },
  }), /zero source changes/);
  assert.throws(() => createCommitReceipt({
    intentId: "false-undo",
    action: "clock-in",
    outcome: "applied",
    sources: [{ path: PATH, primitive: "vault-process", before, after, undo: "single-native-step" }],
    semanticChanges: ["clock-opened"],
    confirmation: "confirmed",
    globalCheck: { status: "confirmed", runningClockIds: [CLOCK_NEW] },
  }), /not-guaranteed/);
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

  const dirtyExpectation = Object.freeze({ ...expectation, indexComplete: false });
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

test("dispose blocks later commits and read-only recovery choice enters no host primitive", async () => {
  const source = `${OPEN}\n- [ ] B ^${PLAN_B}\n${CLOSE}\n`;
  const access = new MemoryAtomicTextAccess({ [PATH]: source });
  const mutation = clockInPlan();
  const expectation = await mutationExpectation(access, mutation, { planIds: [PLAN_B] });
  const writer = new WorkspaceCommitter(access, { readContext: () => CONTEXT });
  writer.dispose();
  const blocked = await writer.commit(mutation, expectation);
  assert.equal(blocked.outcome, "uncertain");
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
