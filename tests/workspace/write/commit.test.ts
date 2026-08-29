import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { ObsidianAtomicTextAccess, WorkspaceCommitter } from "../../../src/workspace/commit.ts";
import { WorkspaceIndex } from "../../../src/workspace/identity-index.ts";
import {
  formatCanonicalClosedClock,
  formatCanonicalRunningClock,
} from "../../../src/workspace/logbook-clock.ts";
import { createMutationPlan, type MutationPlan } from "../../../src/workspace/mutations.ts";
import {
  MemoryAtomicTextAccess,
  TempVaultAtomicTextAccess,
  type AtomicFault,
} from "./adapters.ts";
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

const PATH_A = "Daily/A.md";
const PATH_B = "Daily/B.md";
const START = NOW - 30 * 60_000;

function idleSource(id = PLAN_A, title = "Alpha", ending = "\n"): string {
  return `${OPEN}${ending}- [ ] ${title} 30m ^${id}${ending}${CLOSE}${ending}`;
}

function anonymousSource(): string {
  return `${OPEN}\r\n- [ ] Anonymous 30m  \r\n${CLOSE}\r\n`;
}

function activeSource(planId = PLAN_A, clockId = CLOCK_A, title = "Alpha"): string {
  const clock = formatCanonicalRunningClock(START, 480, clockId);
  return `${OPEN}\n- [ ] ${title} 30m ^${planId}\n  - LOGBOOK::\n    - ${clock}\n${CLOSE}\n`;
}

function mutableEditor(initial: string, afterTransaction?: () => void) {
  let text = initial;
  let transactions = 0;
  let reads = 0;
  const offsetAt = (source: string, position: { readonly line: number; readonly ch: number }): number => {
    let line = 0;
    let offset = 0;
    while (line < position.line && offset < source.length) {
      if (source[offset] === "\r" && source[offset + 1] === "\n") offset += 2;
      else if (source[offset] === "\r" || source[offset] === "\n") offset += 1;
      else {
        offset += 1;
        continue;
      }
      line += 1;
    }
    return offset + position.ch;
  };
  return {
    editor: {
      getValue: () => {
        reads += 1;
        return text;
      },
      transaction: ({ changes = [] }: { readonly changes?: readonly {
        readonly from: { readonly line: number; readonly ch: number };
        readonly to: { readonly line: number; readonly ch: number };
        readonly text: string;
      }[] }) => {
        transactions += 1;
        const before = text;
        const withOffsets = changes.map((change) => ({
          change,
          from: offsetAt(before, change.from),
          to: offsetAt(before, change.to),
        })).sort((left, right) => right.from - left.from || right.to - left.to);
        for (const { change, from, to } of withOffsets) {
          text = text.slice(0, from) + change.text + text.slice(to);
        }
        afterTransaction?.();
      },
    },
    text: () => text,
    transactions: () => transactions,
    reads: () => reads,
  };
}

function clockInPlan(
  path: string,
  planId: string | undefined,
  generatedPlanItemId?: string,
  clockId = CLOCK_NEW,
  intentId = `intent-clock-in-${planId ?? "anonymous"}`,
): MutationPlan {
  return createMutationPlan({
    intentId,
    action: "clock-in",
    stages: [{
      path,
      confirmationRequired: false,
      operations: [{
        kind: "clock-in",
        target: { kind: "plan-item", ...(planId ? { id: planId } : {}) },
        ...(generatedPlanItemId ? { generatedPlanItemId } : {}),
        clock: { clockId, startEpochMs: NOW, offsetMinutes: 480 },
      }],
    }],
    expectedRunningClockIds: [],
    settingsVersion: CONTEXT.settingsVersion,
    zoneId: CONTEXT.zoneId,
  });
}

function crossFileSwitchPlan(intentId: string): MutationPlan {
  return createMutationPlan({
    intentId,
    action: "switch-task",
    stages: [
      {
        path: PATH_A,
        confirmationRequired: false,
        operations: [{
          kind: "clock-out",
          target: { kind: "clock", id: CLOCK_A, ownerId: PLAN_A },
          close: { clockId: CLOCK_A, endEpochMs: NOW, offsetMinutes: 480 },
        }],
      },
      {
        path: PATH_B,
        confirmationRequired: false,
        operations: [{
          kind: "clock-in",
          target: { kind: "plan-item", id: PLAN_B },
          clock: { clockId: CLOCK_B, startEpochMs: NOW, offsetMinutes: 480 },
        }],
      },
    ],
    expectedRunningClockIds: [CLOCK_A],
    settingsVersion: CONTEXT.settingsVersion,
    zoneId: CONTEXT.zoneId,
    transitionEpochMs: NOW,
  });
}

async function crossFileExpectation(access: MemoryAtomicTextAccess, plan: MutationPlan) {
  return mutationExpectation(access, plan, {
    planIds: [PLAN_B],
    clockIds: [CLOCK_A],
    expectedRunningClockIds: [CLOCK_A],
  });
}

function committer(access: MemoryAtomicTextAccess | TempVaultAtomicTextAccess): WorkspaceCommitter {
  return new WorkspaceCommitter(access, { readContext: () => CONTEXT });
}

class SubscriptionCountingAccess extends MemoryAtomicTextAccess {
  activeSubscriptions = 0;

  override onChange(listener: Parameters<MemoryAtomicTextAccess["onChange"]>[0]) {
    this.activeSubscriptions += 1;
    const unsubscribe = super.onChange(listener);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      this.activeSubscriptions -= 1;
      unsubscribe();
    };
  }
}

test("WorkspaceCommitter disposes owned indexes and preserves borrowed vault-scoped indexes", async () => {
  const internalAccess = new SubscriptionCountingAccess({ [PATH_A]: idleSource() });
  const internal = new WorkspaceCommitter(internalAccess, { readContext: () => CONTEXT });
  assert.equal(internalAccess.activeSubscriptions, 2);

  internal.dispose();
  internal.dispose();

  assert.equal(internalAccess.activeSubscriptions, 0);

  const sharedAccess = new SubscriptionCountingAccess({ [PATH_A]: idleSource() });
  const sharedIndex = new WorkspaceIndex(sharedAccess);
  const rebuilt = await sharedIndex.rebuild();
  assert.equal(rebuilt.complete, true);
  assert.throws(() => new WorkspaceCommitter(sharedAccess, {
    readContext: () => CONTEXT,
    index: {},
    workspaceIndex: sharedIndex,
  }), /workspaceIndex and index options are mutually exclusive/);
  assert.equal(sharedAccess.activeSubscriptions, 1);
  const first = new WorkspaceCommitter(sharedAccess, {
    readContext: () => CONTEXT,
    workspaceIndex: sharedIndex,
  });
  const second = new WorkspaceCommitter(sharedAccess, {
    readContext: () => CONTEXT,
    workspaceIndex: sharedIndex,
  });
  assert.equal(sharedAccess.activeSubscriptions, 3);

  first.dispose();
  first.dispose();

  assert.equal(sharedAccess.activeSubscriptions, 2);
  assert.equal(sharedIndex.snapshot.complete, true);
  sharedAccess.modify(PATH_A, idleSource(PLAN_A, "Updated"));
  assert.equal(sharedIndex.dirty, true);
  assert.equal(sharedIndex.snapshot.complete, false);

  second.dispose();
  assert.equal(sharedAccess.activeSubscriptions, 1);
  sharedIndex.dispose();
  assert.equal(sharedAccess.activeSubscriptions, 0);
});

test("TC-OBS-SAFE-001-003 active Editor and Vault.process commits are byte-equivalent and authoritative", async () => {
  const source = idleSource();
  const results: { text: string; receipt: Awaited<ReturnType<WorkspaceCommitter["commit"]>> }[] = [];
  for (const primitive of ["editor", "vault-process"] as const) {
    const access = new MemoryAtomicTextAccess({ [PATH_A]: source }, primitive);
    const plan = clockInPlan(PATH_A, PLAN_A);
    const expectation = await mutationExpectation(access, plan, { planIds: [PLAN_A] });
    const writer = committer(access);
    const receipt = await writer.commit(plan, expectation);
    const text = await access.readText(PATH_A);
    assert.equal(receipt.outcome, "applied");
    assert.equal(receipt.confirmation, "confirmed");
    assert.equal(receipt.sources[0]?.primitive, primitive);
    assert.equal(receipt.sources[0]?.undo, primitive === "editor" ? "single-native-step" : "not-guaranteed");
    assert.deepEqual(receipt.globalCheck.runningClockIds, [CLOCK_NEW]);
    assert.equal(access.transactionCounts.get(PATH_A), 1);
    assert.equal(access.callbackCounts.get(PATH_A), 1);
    assert.ok(text?.includes(`^${PLAN_A}\n  - LOGBOOK::\n    - CLOCK:`));
    results.push({ text: text!, receipt });
    writer.dispose();
  }
  assert.equal(results[0]!.text, results[1]!.text);
  assert.deepEqual(results[0]!.receipt.semanticChanges, results[1]!.receipt.semanticChanges);
});

test("production Obsidian adapter enters exactly one Editor transaction or Vault.process callback", async () => {
  const outputs: string[] = [];
  let observedEditorChanges: readonly {
    readonly from: { readonly line: number; readonly ch: number };
    readonly to: { readonly line: number; readonly ch: number };
    readonly text: string;
  }[] = [];
  for (const mode of ["editor", "vault-process"] as const) {
    const source = idleSource();
    const delegate = new MemoryAtomicTextAccess({ [PATH_A]: source });
    let editorText = source;
    let editorTransactions = 0;
    let vaultProcesses = 0;
    const offsetAt = (text: string, position: { readonly line: number; readonly ch: number }): number => {
      let line = 0;
      let offset = 0;
      while (line < position.line && offset < text.length) {
        if (text[offset] === "\r" && text[offset + 1] === "\n") offset += 2;
        else if (text[offset] === "\r" || text[offset] === "\n") offset += 1;
        else {
          offset += 1;
          continue;
        }
        line += 1;
      }
      return offset + position.ch;
    };
    const editor = {
      getValue: () => editorText,
      transaction: (transaction: { readonly changes?: readonly {
        readonly from: { readonly line: number; readonly ch: number };
        readonly to: { readonly line: number; readonly ch: number };
        readonly text: string;
      }[] }) => {
        editorTransactions += 1;
        observedEditorChanges = transaction.changes ?? [];
        const before = editorText;
        const withOffsets = observedEditorChanges.map((change) => ({
          change,
          from: offsetAt(before, change.from),
          to: offsetAt(before, change.to),
        })).sort((left, right) => right.from - left.from || right.to - left.to);
        for (const { change, from, to } of withOffsets) {
          editorText = editorText.slice(0, from) + change.text + editorText.slice(to);
        }
      },
    };
    const vault = {
      process: async (_file: unknown, transform: (text: string) => string) => {
        vaultProcesses += 1;
        const next = transform((await delegate.readText(PATH_A))!);
        delegate.modify(PATH_A, next);
        return next;
      },
    };
    const access = new ObsidianAtomicTextAccess({
      text: delegate,
      vault: vault as never,
      editorForPath: () => mode === "editor" ? editor as never : undefined,
      fileForPath: () => ({ path: PATH_A }) as never,
    });
    const plan = clockInPlan(PATH_A, PLAN_A);
    const expectation = await mutationExpectation(access, plan, { planIds: [PLAN_A] });
    const writer = new WorkspaceCommitter(access, { readContext: () => CONTEXT });
    const receipt = await writer.commit(plan, expectation);
    assert.equal(receipt.outcome, "applied");
    assert.equal(receipt.sources[0]?.primitive, mode);
    assert.equal(editorTransactions, mode === "editor" ? 1 : 0);
    assert.equal(vaultProcesses, mode === "vault-process" ? 1 : 0);
    outputs.push((await access.readText(PATH_A))!);
    writer.dispose();
  }
  assert.equal(outputs[0], outputs[1]);
  assert.ok(observedEditorChanges.length > 0);
  assert.equal(observedEditorChanges.some((change) =>
    change.from.line === 0 && change.from.ch === 0
    && change.to.line === idleSource().split(/\r\n|\r|\n/).length - 1
  ), false, "active Editor writes must carry validated byte ranges, not a whole-buffer replacement");
});

test("production Editor confirmation readers remain scoped to each same-path transform", async () => {
  const delegate = new MemoryAtomicTextAccess({ [PATH_A]: "vault" });
  const first = mutableEditor("A");
  const second = mutableEditor("B");
  let selected = first;
  const access = new ObsidianAtomicTextAccess({
    text: delegate,
    vault: { process: async () => { throw new Error("unexpected Vault.process"); } } as never,
    editorForPath: () => selected.editor as never,
    fileForPath: () => ({ path: PATH_A }) as never,
  });
  const append = (suffix: string) => (current: string) => ({
    text: `${current}${suffix}`,
    edits: [{
      fromOffset: current.length,
      toOffset: current.length,
      expected: "",
      replacement: suffix,
      semanticChange: "progress-updated" as const,
    }],
    value: suffix,
  });

  const firstPending = access.atomicTransform(PATH_A, append("1"));
  selected = second;
  const secondPending = access.atomicTransform(PATH_A, append("2"));
  const [firstResult, secondResult] = await Promise.all([firstPending, secondPending]);

  assert.equal(await secondResult.readConfirmationText(), "B2");
  assert.equal(await firstResult.readConfirmationText(), "A1");
  assert.equal(first.text(), "A1");
  assert.equal(second.text(), "B2");
  assert.equal(first.transactions(), 1);
  assert.equal(second.transactions(), 1);
});

test("disposing after active Editor apply cannot confirm success or leak its handle", async () => {
  const source = idleSource();
  const delegate = new MemoryAtomicTextAccess({ [PATH_A]: source });
  let writer!: WorkspaceCommitter;
  let readsAtApply = 0;
  const appliedEditor = mutableEditor(source, () => {
    readsAtApply = appliedEditor.reads();
    writer.dispose();
  });
  const nextEditor = mutableEditor("next");
  let selected = appliedEditor;
  const access = new ObsidianAtomicTextAccess({
    text: delegate,
    vault: { process: async () => { throw new Error("unexpected Vault.process"); } } as never,
    editorForPath: () => selected.editor as never,
    fileForPath: () => ({ path: PATH_A }) as never,
  });
  const plan = clockInPlan(PATH_A, PLAN_A, undefined, CLOCK_NEW, "dispose-production-editor");
  const expectation = await mutationExpectation(access, plan, { planIds: [PLAN_A] });
  writer = new WorkspaceCommitter(access, { readContext: () => CONTEXT });

  const receipt = await writer.commit(plan, expectation);

  assert.equal(receipt.outcome, "uncertain");
  assert.equal(receipt.confirmation, "unconfirmed");
  assert.equal(receipt.result?.code, "write-outcome-uncertain");
  assert.deepEqual(receipt.sources, []);
  assert.equal(appliedEditor.reads(), readsAtApply);
  assert.ok(appliedEditor.text().includes(CLOCK_NEW));

  selected = nextEditor;
  const next = await access.atomicTransform(PATH_A, (current) => ({
    text: `${current}!`,
    edits: [{
      fromOffset: current.length,
      toOffset: current.length,
      expected: "",
      replacement: "!",
      semanticChange: "progress-updated",
    }],
    value: true,
  }));
  assert.equal(await next.readConfirmationText(), "next!");
  assert.equal(nextEditor.text(), "next!");
});

test("anonymous target materializes Plan Item ID, drawer, and CLOCK in one CRLF-preserving transform", async () => {
  const source = anonymousSource();
  const access = new MemoryAtomicTextAccess({ [PATH_A]: source }, "editor");
  const plan = clockInPlan(PATH_A, undefined, PLAN_NEW);
  const expectation = await mutationExpectation(access, plan, { planIds: [undefined] });
  const writer = committer(access);
  const receipt = await writer.commit(plan, expectation);
  const after = await access.readText(PATH_A);
  assert.equal(receipt.outcome, "applied");
  assert.equal(access.transactionCounts.get(PATH_A), 1);
  assert.match(after!, new RegExp(`- \\[ \\] Anonymous 30m \\^${PLAN_NEW}  \\r\\n  - LOGBOOK::\\r\\n    - CLOCK:`));
  assert.equal(after!.replaceAll("\r\n", "").includes("\n"), false);
  assert.deepEqual(receipt.resultingIdentities.map(({ kind, id }) => [kind, id]), [
    ["plan-item", PLAN_NEW],
    ["clock", CLOCK_NEW],
  ]);
  writer.dispose();
});

test("unique identity relocates after rename but anonymous targets never relocate", async () => {
  const renamed = "Archive/Renamed.md";
  const access = new MemoryAtomicTextAccess({ [PATH_A]: idleSource() });
  const plan = clockInPlan(PATH_A, PLAN_A);
  const expectation = await mutationExpectation(access, plan, { planIds: [PLAN_A] });
  access.rename(PATH_A, renamed);
  const writer = committer(access);
  const receipt = await writer.commit(plan, expectation);
  assert.equal(receipt.outcome, "applied");
  assert.equal(receipt.sources[0]?.path, renamed);
  assert.ok((await access.readText(renamed))?.includes(CLOCK_NEW));
  writer.dispose();

  const anonymous = new MemoryAtomicTextAccess({ [PATH_A]: anonymousSource() });
  const anonymousPlan = clockInPlan(PATH_A, undefined, PLAN_NEW);
  const anonymousExpectation = await mutationExpectation(anonymous, anonymousPlan, { planIds: [undefined] });
  anonymous.rename(PATH_A, renamed);
  const anonymousWriter = committer(anonymous);
  const rejected = await anonymousWriter.commit(anonymousPlan, anonymousExpectation);
  assert.equal(rejected.outcome, "rejected");
  assert.equal(anonymous.transactionCounts.size, 0);
  anonymousWriter.dispose();
});

test("transaction-window source change conflicts without overwriting the external bytes", async () => {
  const access = new MemoryAtomicTextAccess({ [PATH_A]: idleSource() });
  const plan = clockInPlan(PATH_A, PLAN_A);
  const expectation = await mutationExpectation(access, plan, { planIds: [PLAN_A] });
  access.raceBeforeCallback(PATH_A, (source) => source.replace("Alpha", "Externally changed"));
  const writer = committer(access);
  const receipt = await writer.commit(plan, expectation);
  assert.equal(receipt.outcome, "conflict");
  assert.equal(receipt.sources[0]?.changed, false);
  const after = await access.readText(PATH_A);
  assert.ok(after?.includes("Externally changed"));
  assert.equal(after?.includes("CLOCK:"), false);
  writer.dispose();
});

test("dispose while paused before the host callback rejects with zero changed bytes and no retry", async () => {
  for (const primitive of ["editor", "vault-process"] as const) {
    const source = idleSource();
    const access = new MemoryAtomicTextAccess({ [PATH_A]: source }, primitive);
    const plan = clockInPlan(
      PATH_A,
      PLAN_A,
      undefined,
      CLOCK_NEW,
      `dispose-before-host-${primitive}`,
    );
    const expectation = await mutationExpectation(access, plan, { planIds: [PLAN_A] });
    const gate = access.pauseBeforeCallback(PATH_A);
    const writer = committer(access);
    const pending = writer.commit(plan, expectation);
    await gate.entered;
    writer.dispose();
    gate.release();

    const receipt = await pending;
    assert.equal(receipt.outcome, "rejected", primitive);
    assert.equal(receipt.result?.code, "action-no-longer-applicable", primitive);
    assert.deepEqual(receipt.sources, [], primitive);
    assert.equal(await access.readText(PATH_A), source, primitive);
    assert.equal(access.transactionCounts.get(PATH_A), 1, primitive);

    const retry = await writer.commit(plan, expectation);
    assert.equal(retry.outcome, "rejected", primitive);
    assert.equal(access.transactionCounts.get(PATH_A), 1, primitive);
    assert.equal(await access.readText(PATH_A), source, primitive);
  }
});

test("dispose after host entry or during authoritative reread never publishes confirmed success", async () => {
  for (const primitive of ["editor", "vault-process"] as const) {
    for (const point of ["after-apply", "primitive-read"] as const) {
      const source = idleSource();
      const access = new MemoryAtomicTextAccess({ [PATH_A]: source }, primitive);
      const plan = clockInPlan(
        PATH_A,
        PLAN_A,
        undefined,
        CLOCK_NEW,
        `dispose-${point}-${primitive}`,
      );
      const expectation = await mutationExpectation(access, plan, { planIds: [PLAN_A] });
      const gate = point === "after-apply"
        ? access.pauseAfterApply(PATH_A)
        : access.pauseNextPrimitiveRead(PATH_A);
      const writer = committer(access);
      const pending = writer.commit(plan, expectation);
      await gate.entered;
      writer.dispose();
      gate.release();

      const receipt = await pending;
      assert.equal(receipt.outcome, "uncertain", `${primitive}/${point}`);
      assert.equal(receipt.confirmation, "unconfirmed", `${primitive}/${point}`);
      assert.equal(receipt.result?.code, "write-outcome-uncertain", `${primitive}/${point}`);
      assert.equal(writer.blocked, true, `${primitive}/${point}`);
      assert.ok((await access.readText(PATH_A))?.includes(CLOCK_NEW), `${primitive}/${point}`);
      assert.equal(access.transactionCounts.get(PATH_A), 1, `${primitive}/${point}`);
      assert.deepEqual(receipt.sources, [], `${primitive}/${point}`);

      const retry = await writer.commit(plan, expectation);
      assert.equal(retry.outcome, "rejected", `${primitive}/${point}`);
      assert.equal(access.transactionCounts.get(PATH_A), 1, `${primitive}/${point}`);
    }
  }
});

test("host fault matrix preserves exact outcome, bytes, receipts, and writer blocking for both primitives", async () => {
  const cases: readonly {
    readonly fault: AtomicFault;
    readonly outcome: "applied" | "failed-no-change" | "uncertain" | "invariant-broken";
    readonly confirmation: "confirmed" | "confirmed-no-change" | "unconfirmed" | "invariant-broken";
    readonly changed: boolean;
    readonly blocked: boolean;
    readonly code?: "write-failed-no-change" | "write-outcome-uncertain" | "write-invariant-broken";
  }[] = [
    { fault: "before-callback", outcome: "failed-no-change", confirmation: "confirmed-no-change", changed: false, blocked: false, code: "write-failed-no-change" },
    { fault: "before-apply", outcome: "failed-no-change", confirmation: "confirmed-no-change", changed: false, blocked: false, code: "write-failed-no-change" },
    { fault: "apply-then-throw", outcome: "applied", confirmation: "confirmed", changed: true, blocked: false },
    { fault: "partial-prefix", outcome: "uncertain", confirmation: "unconfirmed", changed: true, blocked: true, code: "write-outcome-uncertain" },
    { fault: "divergent-resolve", outcome: "invariant-broken", confirmation: "invariant-broken", changed: true, blocked: true, code: "write-invariant-broken" },
    { fault: "silent-noop", outcome: "failed-no-change", confirmation: "confirmed-no-change", changed: false, blocked: false, code: "write-failed-no-change" },
  ];

  for (const primitive of ["editor", "vault-process"] as const) {
    for (const scenario of cases) {
      const source = idleSource();
      const access = new MemoryAtomicTextAccess({ [PATH_A]: source }, primitive);
      const plan = clockInPlan(
        PATH_A,
        PLAN_A,
        undefined,
        CLOCK_NEW,
        `fault-${primitive}-${scenario.fault}`,
      );
      const expectation = await mutationExpectation(access, plan, { planIds: [PLAN_A] });
      access.fault(PATH_A, scenario.fault);
      const writer = committer(access);
      const receipt = await writer.commit(plan, expectation);
      const after = await access.readText(PATH_A);

      assert.equal(receipt.outcome, scenario.outcome, `${primitive}/${scenario.fault}`);
      assert.equal(receipt.confirmation, scenario.confirmation, `${primitive}/${scenario.fault}`);
      assert.equal(receipt.result?.code, scenario.code, `${primitive}/${scenario.fault}`);
      assert.equal(receipt.sources.length, 1, `${primitive}/${scenario.fault}`);
      assert.deepEqual(receipt.sources.map((entry) => ({
        path: entry.path,
        primitive: entry.primitive,
        changed: entry.changed,
      })), [{ path: PATH_A, primitive, changed: scenario.changed }], `${primitive}/${scenario.fault}`);
      assert.equal(writer.blocked, scenario.blocked, `${primitive}/${scenario.fault}`);
      assert.equal(access.transactionCounts.get(PATH_A), 1, `${primitive}/${scenario.fault}`);
      assert.equal(access.callbackCounts.get(PATH_A) ?? 0, scenario.fault === "before-callback" ? 0 : 1, `${primitive}/${scenario.fault}`);
      if (scenario.changed) assert.notEqual(after, source, `${primitive}/${scenario.fault}`);
      else assert.equal(after, source, `${primitive}/${scenario.fault}`);
      if (scenario.outcome === "applied") assert.ok(after?.includes(CLOCK_NEW), primitive);
      writer.dispose();
    }
  }
});

test("unreadable post-write confirmation is uncertain for Vault.process and active Editor", async () => {
  {
    const source = idleSource();
    const access = new MemoryAtomicTextAccess({ [PATH_A]: source }, "vault-process");
    const plan = clockInPlan(PATH_A, PLAN_A, undefined, CLOCK_NEW, "vault-confirmation-unreadable");
    const expectation = await mutationExpectation(access, plan, { planIds: [PLAN_A] });
    access.failConfirmationAfterNextTransform();
    const writer = committer(access);
    const receipt = await writer.commit(plan, expectation);
    assert.equal(receipt.outcome, "uncertain");
    assert.equal(receipt.confirmation, "unconfirmed");
    assert.equal(receipt.result?.code, "write-outcome-uncertain");
    assert.deepEqual(receipt.sources, []);
    assert.equal(writer.blocked, true);
    assert.ok((await access.readText(PATH_A))?.includes(CLOCK_NEW));
    assert.equal(access.transactionCounts.get(PATH_A), 1);
    writer.dispose();
  }

  {
    const source = idleSource();
    const delegate = new MemoryAtomicTextAccess({ [PATH_A]: source });
    let editorText = source;
    let confirmationUnreadable = false;
    let transactions = 0;
    const offsetAt = (text: string, position: { readonly line: number; readonly ch: number }): number => {
      const lines = text.split(/\r\n|\r|\n/);
      let offset = 0;
      for (let line = 0; line < position.line; line += 1) {
        offset += lines[line]!.length;
        if (text.slice(offset, offset + 2) === "\r\n") offset += 2;
        else offset += 1;
      }
      return offset + position.ch;
    };
    const editor = {
      getValue: () => {
        if (confirmationUnreadable) {
          confirmationUnreadable = false;
          throw new Error("injected Editor confirmation failure");
        }
        return editorText;
      },
      transaction: (transaction: { readonly changes?: readonly {
        readonly from: { readonly line: number; readonly ch: number };
        readonly to: { readonly line: number; readonly ch: number };
        readonly text: string;
      }[] }) => {
        transactions += 1;
        const before = editorText;
        const changes = (transaction.changes ?? []).map((change) => ({
          change,
          from: offsetAt(before, change.from),
          to: offsetAt(before, change.to),
        })).sort((left, right) => right.from - left.from || right.to - left.to);
        for (const { change, from, to } of changes) {
          editorText = editorText.slice(0, from) + change.text + editorText.slice(to);
        }
        confirmationUnreadable = true;
      },
    };
    const access = new ObsidianAtomicTextAccess({
      text: delegate,
      vault: { process: async () => undefined } as never,
      editorForPath: () => editor as never,
      fileForPath: () => ({ path: PATH_A }) as never,
    });
    const plan = clockInPlan(PATH_A, PLAN_A, undefined, CLOCK_NEW, "editor-confirmation-unreadable");
    const expectation = await mutationExpectation(access, plan, { planIds: [PLAN_A] });
    const writer = new WorkspaceCommitter(access, { readContext: () => CONTEXT });
    const receipt = await writer.commit(plan, expectation);
    assert.equal(receipt.outcome, "uncertain");
    assert.equal(receipt.confirmation, "unconfirmed");
    assert.equal(receipt.result?.code, "write-outcome-uncertain");
    assert.deepEqual(receipt.sources, []);
    assert.equal(writer.blocked, true);
    assert.ok(editorText.includes(CLOCK_NEW));
    assert.equal(transactions, 1);
    writer.dispose();
  }
});

test("production Vault.process missing-file and skipped-callback failures are confirmed unchanged and reusable", async () => {
  for (const failure of ["missing-file", "skipped-callback"] as const) {
    const source = idleSource();
    const delegate = new MemoryAtomicTextAccess({ [PATH_A]: source });
    let fileAvailable = failure !== "missing-file";
    let enterTransform = failure !== "skipped-callback";
    let processCalls = 0;
    const access = new ObsidianAtomicTextAccess({
      text: delegate,
      editorForPath: () => undefined,
      fileForPath: () => fileAvailable ? ({ path: PATH_A }) as never : undefined,
      vault: {
        process: async (_file: unknown, transform: (text: string) => string) => {
          processCalls += 1;
          const current = (await delegate.readText(PATH_A))!;
          if (!enterTransform) return current;
          const next = transform(current);
          if (next !== current) delegate.modify(PATH_A, next);
          return next;
        },
      } as never,
    });
    const failedPlan = clockInPlan(
      PATH_A,
      PLAN_A,
      undefined,
      CLOCK_NEW,
      `production-${failure}`,
    );
    const failedExpectation = await mutationExpectation(access, failedPlan, { planIds: [PLAN_A] });
    const writer = new WorkspaceCommitter(access, { readContext: () => CONTEXT });
    const failed = await writer.commit(failedPlan, failedExpectation);

    assert.equal(failed.outcome, "failed-no-change", failure);
    assert.equal(failed.confirmation, "confirmed-no-change", failure);
    assert.equal(failed.result?.code, "write-failed-no-change", failure);
    assert.deepEqual(failed.sources.map((entry) => ({
      path: entry.path,
      primitive: entry.primitive,
      changed: entry.changed,
    })), [{ path: PATH_A, primitive: "vault-process", changed: false }], failure);
    assert.equal(await delegate.readText(PATH_A), source, failure);
    assert.equal(processCalls, failure === "missing-file" ? 0 : 1, failure);
    assert.equal(writer.blocked, false, failure);

    fileAvailable = true;
    enterTransform = true;
    const recoveryPlan = clockInPlan(
      PATH_A,
      PLAN_A,
      undefined,
      CLOCK_B,
      `production-${failure}-next-intent`,
    );
    const recoveryExpectation = await mutationExpectation(access, recoveryPlan, { planIds: [PLAN_A] });
    const recovered = await writer.commit(recoveryPlan, recoveryExpectation);
    assert.equal(recovered.outcome, "applied", failure);
    assert.ok((await delegate.readText(PATH_A))?.includes(CLOCK_B), failure);
    assert.equal(processCalls, failure === "missing-file" ? 1 : 2, failure);
    writer.dispose();
  }
});

test("manual fault injection classifies before-apply, apply-then-throw, and unreadable confirmation", async () => {
  for (const [fault, outcome, changed] of [
    ["before-apply", "failed-no-change", false],
    ["apply-then-throw", "applied", true],
  ] as const) {
    const access = new MemoryAtomicTextAccess({ [PATH_A]: idleSource() });
    access.fault(PATH_A, fault);
    const plan = clockInPlan(PATH_A, PLAN_A);
    const expectation = await mutationExpectation(access, plan, { planIds: [PLAN_A] });
    const writer = committer(access);
    const receipt = await writer.commit(plan, expectation);
    assert.equal(receipt.outcome, outcome, fault);
    assert.equal((await access.readText(PATH_A))?.includes(CLOCK_NEW), changed, fault);
    writer.dispose();
  }

  const access = new MemoryAtomicTextAccess({ [PATH_A]: idleSource() });
  access.failConfirmationAfterNextTransform();
  const plan = clockInPlan(PATH_A, PLAN_A);
  const expectation = await mutationExpectation(access, plan, { planIds: [PLAN_A] });
  const writer = committer(access);
  const uncertain = await writer.commit(plan, expectation);
  assert.equal(uncertain.outcome, "uncertain");
  assert.equal(writer.blocked, true);
  assert.ok((await access.readText(PATH_A))?.includes(CLOCK_NEW));
  const blocked = await writer.commit(plan, expectation);
  assert.equal(blocked.outcome, "uncertain");
  assert.equal(access.transactionCounts.get(PATH_A), 1);
  writer.dispose();
});

test("same-file switch is one transaction at one instant", async () => {
  const source = `${OPEN}\n- [ ] Alpha ^${PLAN_A}\n  - LOGBOOK::\n    - ${formatCanonicalRunningClock(START, 480, CLOCK_A)}\n- [ ] Beta ^${PLAN_B}\n${CLOSE}\n`;
  const access = new MemoryAtomicTextAccess({ [PATH_A]: source }, "editor");
  const plan = createMutationPlan({
    intentId: "intent-same-file-switch",
    action: "switch-task",
    stages: [{
      path: PATH_A,
      confirmationRequired: false,
      operations: [
        { kind: "clock-out", target: { kind: "clock", id: CLOCK_A, ownerId: PLAN_A }, close: { clockId: CLOCK_A, endEpochMs: NOW, offsetMinutes: 480 } },
        { kind: "clock-in", target: { kind: "plan-item", id: PLAN_B }, clock: { clockId: CLOCK_B, startEpochMs: NOW, offsetMinutes: 480 } },
      ],
    }],
    expectedRunningClockIds: [CLOCK_A],
    settingsVersion: CONTEXT.settingsVersion,
    zoneId: CONTEXT.zoneId,
    transitionEpochMs: NOW,
  });
  const expectation = await mutationExpectation(access, plan, {
    planIds: [PLAN_B],
    clockIds: [CLOCK_A],
    expectedRunningClockIds: [CLOCK_A],
  });
  const writer = committer(access);
  const receipt = await writer.commit(plan, expectation);
  const after = await access.readText(PATH_A);
  assert.equal(receipt.outcome, "applied");
  assert.equal(access.transactionCounts.get(PATH_A), 1);
  assert.ok(after?.includes(formatCanonicalClosedClock(START, 480, NOW, 480, CLOCK_A)));
  assert.ok(after?.includes(formatCanonicalRunningClock(NOW, 480, CLOCK_B)));
  assert.deepEqual(receipt.globalCheck.runningClockIds, [CLOCK_B]);
  const retry = await writer.commit(plan, expectation);
  assert.equal(retry.outcome, "already-applied");
  assert.equal(access.transactionCounts.get(PATH_A), 1);
  assert.equal(await access.readText(PATH_A), after);
  const degraded = after!.replace(`- [ ] Beta ^${PLAN_B}`, `- [x] Beta ^${PLAN_B}`);
  access.modify(PATH_A, degraded);
  const invalidRetry = await writer.commit(plan, expectation);
  assert.equal(invalidRetry.outcome, "conflict");
  assert.equal(invalidRetry.result?.code, "clock-owner-invalid");
  assert.equal(access.transactionCounts.get(PATH_A), 1);
  assert.equal(await access.readText(PATH_A), degraded);
  writer.dispose();
});

test("same-file switch rejects a closed planned old CLOCK plus an unrelated running CLOCK before host entry", async () => {
  const source = `${OPEN}\n- [ ] Alpha ^${PLAN_A}\n  - LOGBOOK::\n    - ${formatCanonicalClosedClock(START, 480, NOW, 480, CLOCK_A)}\n- [ ] Beta ^${PLAN_B}\n- [ ] Other ^${PLAN_NEW}\n  - LOGBOOK::\n    - ${formatCanonicalRunningClock(START, 480, CLOCK_NEW)}\n${CLOSE}\n`;
  const access = new MemoryAtomicTextAccess({ [PATH_A]: source }, "editor");
  const plan = createMutationPlan({
    intentId: "closed-old-unrelated-running-switch",
    action: "switch-task",
    stages: [{
      path: PATH_A,
      confirmationRequired: false,
      operations: [
        { kind: "clock-out", target: { kind: "clock", id: CLOCK_A, ownerId: PLAN_A }, close: { clockId: CLOCK_A, endEpochMs: NOW, offsetMinutes: 480 } },
        { kind: "clock-in", target: { kind: "plan-item", id: PLAN_B }, clock: { clockId: CLOCK_B, startEpochMs: NOW, offsetMinutes: 480 } },
      ],
    }],
    expectedRunningClockIds: [CLOCK_NEW],
    settingsVersion: CONTEXT.settingsVersion,
    zoneId: CONTEXT.zoneId,
    transitionEpochMs: NOW,
  });
  const expectation = await mutationExpectation(access, plan, {
    planIds: [PLAN_B],
    clockIds: [CLOCK_A],
    expectedRunningClockIds: [CLOCK_NEW],
  });
  const writer = committer(access);
  const receipt = await writer.commit(plan, expectation);
  assert.equal(receipt.outcome, "rejected");
  assert.equal(receipt.result?.code, "action-no-longer-applicable");
  assert.equal(access.transactionCounts.size, 0);
  assert.equal(await access.readText(PATH_A), source);
  writer.dispose();
});

test("cross-file dispose after confirmed stage A prevents stage B and reports only the changed source", async () => {
  for (const primitive of ["editor", "vault-process"] as const) {
    const sourceA = activeSource();
    const sourceB = idleSource(PLAN_B, "Beta");
    const access = new MemoryAtomicTextAccess({
      [PATH_A]: sourceA,
      [PATH_B]: sourceB,
    }, primitive);
    const plan = crossFileSwitchPlan(`dispose-between-stages-${primitive}`);
    const expectation = await crossFileExpectation(access, plan);
    const gate = access.pauseBeforeCallback(PATH_B);
    const writer = committer(access);
    const pending = writer.commit(plan, expectation);
    await gate.entered;

    const closedA = await access.readText(PATH_A);
    assert.ok(closedA?.includes(formatCanonicalClosedClock(START, 480, NOW, 480, CLOCK_A)), primitive);
    assert.equal(await access.readText(PATH_B), sourceB, primitive);
    writer.dispose();
    gate.release();

    const receipt = await pending;
    assert.equal(receipt.outcome, "partial-safe", primitive);
    assert.equal(receipt.confirmation, "partial", primitive);
    assert.equal(receipt.result?.code, "partial-switch", primitive);
    assert.deepEqual(receipt.sources.map((entry) => ({
      path: entry.path,
      primitive: entry.primitive,
      changed: entry.changed,
    })), [{ path: PATH_A, primitive, changed: true }], primitive);
    assert.equal(await access.readText(PATH_B), sourceB, primitive);
    assert.equal(access.transactionCounts.get(PATH_A), 1, primitive);
    assert.equal(access.transactionCounts.get(PATH_B), 1, primitive);

    const retry = await writer.commit(plan, expectation);
    assert.equal(retry.outcome, "rejected", primitive);
    assert.equal(access.transactionCounts.get(PATH_A), 1, primitive);
    assert.equal(access.transactionCounts.get(PATH_B), 1, primitive);
  }
});

test("cross-file disposal after stage B host entry defers stage B observation until reload", async () => {
  for (const primitive of ["editor", "vault-process"] as const) {
    for (const point of ["after-apply", "primitive-read"] as const) {
      const access = new MemoryAtomicTextAccess({
        [PATH_A]: activeSource(),
        [PATH_B]: idleSource(PLAN_B, "Beta"),
      }, primitive);
      const plan = crossFileSwitchPlan(`dispose-stage-b-${point}-${primitive}`);
      const expectation = await crossFileExpectation(access, plan);
      const gate = point === "after-apply"
        ? access.pauseAfterApply(PATH_B)
        : access.pauseNextPrimitiveRead(PATH_B);
      const writer = committer(access);
      const pending = writer.commit(plan, expectation);
      await gate.entered;
      writer.dispose();
      gate.release();

      const receipt = await pending;
      assert.equal(receipt.outcome, "uncertain", `${primitive}/${point}`);
      assert.equal(receipt.confirmation, "unconfirmed", `${primitive}/${point}`);
      assert.equal(receipt.result?.code, "write-outcome-uncertain", `${primitive}/${point}`);
      assert.deepEqual(receipt.sources.map((source) => ({ path: source.path, changed: source.changed })), [
        { path: PATH_A, changed: true },
      ], `${primitive}/${point}`);
      assert.ok((await access.readText(PATH_A))?.includes(formatCanonicalClosedClock(START, 480, NOW, 480, CLOCK_A)));
      assert.ok((await access.readText(PATH_B))?.includes(CLOCK_B));
      assert.equal(access.transactionCounts.get(PATH_A), 1, `${primitive}/${point}`);
      assert.equal(access.transactionCounts.get(PATH_B), 1, `${primitive}/${point}`);

      const retry = await writer.commit(plan, expectation);
      assert.equal(retry.outcome, "rejected", `${primitive}/${point}`);
      assert.equal(access.transactionCounts.get(PATH_B), 1, `${primitive}/${point}`);
    }
  }
});

test("cross-file disposal during stage-A confirmation remains uncertain and stops before stage B enters", async () => {
  for (const primitive of ["editor", "vault-process"] as const) {
    const sourceB = idleSource(PLAN_B, "Beta");
    const access = new MemoryAtomicTextAccess({
      [PATH_A]: activeSource(),
      [PATH_B]: sourceB,
    }, primitive);
    const plan = crossFileSwitchPlan(`dispose-after-stage-a-${primitive}`);
    const expectation = await crossFileExpectation(access, plan);
    let writer!: WorkspaceCommitter;
    access.raceAfterTransformReads(1, () => writer.dispose());
    writer = committer(access);

    const receipt = await writer.commit(plan, expectation);
    assert.equal(receipt.outcome, "uncertain", primitive);
    assert.equal(receipt.confirmation, "unconfirmed", primitive);
    assert.equal(receipt.result?.code, "write-outcome-uncertain", primitive);
    assert.deepEqual(receipt.sources, [], primitive);
    assert.ok((await access.readText(PATH_A))?.includes(formatCanonicalClosedClock(START, 480, NOW, 480, CLOCK_A)), primitive);
    assert.equal(await access.readText(PATH_B), sourceB, primitive);
    assert.equal(access.transactionCounts.get(PATH_A), 1, primitive);
    assert.equal(access.transactionCounts.get(PATH_B), undefined, primitive);
    assert.equal(access.callbackCounts.get(PATH_B), undefined, primitive);

    const retry = await writer.commit(plan, expectation);
    assert.equal(retry.outcome, "rejected", primitive);
    assert.equal(access.transactionCounts.get(PATH_B), undefined, primitive);
    assert.equal(await access.readText(PATH_B), sourceB, primitive);
  }
});

test("cross-file stage-B classification preserves uncertainty, invariant failure, and confirmed no-apply", async () => {
  const cases: readonly {
    readonly fault: "before-apply" | "partial-prefix" | "divergent-resolve";
    readonly outcome: "partial-safe" | "uncertain" | "invariant-broken";
    readonly confirmation: "partial" | "unconfirmed" | "invariant-broken";
    readonly code: "partial-switch" | "write-outcome-uncertain" | "write-invariant-broken";
    readonly stageBChanged: boolean;
    readonly blocked: boolean;
  }[] = [
    { fault: "before-apply", outcome: "partial-safe", confirmation: "partial", code: "partial-switch", stageBChanged: false, blocked: false },
    { fault: "partial-prefix", outcome: "uncertain", confirmation: "unconfirmed", code: "write-outcome-uncertain", stageBChanged: true, blocked: true },
    { fault: "divergent-resolve", outcome: "invariant-broken", confirmation: "invariant-broken", code: "write-invariant-broken", stageBChanged: true, blocked: true },
  ];

  for (const primitive of ["editor", "vault-process"] as const) {
    for (const scenario of cases) {
      const sourceB = idleSource(PLAN_B, "Beta");
      const access = new MemoryAtomicTextAccess({
        [PATH_A]: activeSource(),
        [PATH_B]: sourceB,
      }, primitive);
      access.fault(PATH_B, scenario.fault);
      const plan = crossFileSwitchPlan(`stage-b-${primitive}-${scenario.fault}`);
      const expectation = await crossFileExpectation(access, plan);
      const writer = committer(access);
      const receipt = await writer.commit(plan, expectation);
      const afterA = await access.readText(PATH_A);
      const afterB = await access.readText(PATH_B);

      assert.equal(receipt.outcome, scenario.outcome, `${primitive}/${scenario.fault}`);
      assert.equal(receipt.confirmation, scenario.confirmation, `${primitive}/${scenario.fault}`);
      assert.equal(receipt.result?.code, scenario.code, `${primitive}/${scenario.fault}`);
      assert.deepEqual(receipt.sources.map((entry) => ({
        path: entry.path,
        primitive: entry.primitive,
        changed: entry.changed,
      })), [
        { path: PATH_A, primitive, changed: true },
        { path: PATH_B, primitive, changed: scenario.stageBChanged },
      ], `${primitive}/${scenario.fault}`);
      assert.ok(afterA?.includes(formatCanonicalClosedClock(START, 480, NOW, 480, CLOCK_A)), `${primitive}/${scenario.fault}`);
      assert.equal(afterB === sourceB, !scenario.stageBChanged, `${primitive}/${scenario.fault}`);
      assert.equal(writer.blocked, scenario.blocked, `${primitive}/${scenario.fault}`);
      assert.equal(access.transactionCounts.get(PATH_A), 1, `${primitive}/${scenario.fault}`);
      assert.equal(access.transactionCounts.get(PATH_B), 1, `${primitive}/${scenario.fault}`);

      const countsBeforeReload = [...access.transactionCounts.entries()];
      const bytesBeforeReload = [afterA, afterB];
      writer.dispose();
      const reloaded = committer(access);
      await Promise.resolve();
      assert.deepEqual([...access.transactionCounts.entries()], countsBeforeReload, `${primitive}/${scenario.fault}`);
      assert.deepEqual([await access.readText(PATH_A), await access.readText(PATH_B)], bytesBeforeReload, `${primitive}/${scenario.fault}`);
      if (scenario.outcome === "uncertain" || scenario.outcome === "invariant-broken") {
        const staleReplay = await reloaded.commit(plan, expectation);
        assert.notEqual(staleReplay.outcome, "applied", `${primitive}/${scenario.fault}`);
        assert.notEqual(staleReplay.outcome, "partial-safe", `${primitive}/${scenario.fault}`);
        assert.deepEqual([...access.transactionCounts.entries()], countsBeforeReload, `${primitive}/${scenario.fault}`);
        assert.deepEqual([await access.readText(PATH_A), await access.readText(PATH_B)], bytesBeforeReload, `${primitive}/${scenario.fault}`);
      }
      reloaded.dispose();
    }
  }
});

test("TC-OBS-SAFE-001-004 cross-file integration confirms close before open and never reopens after stage-B failure", async () => {
  const access = new MemoryAtomicTextAccess({
    [PATH_A]: activeSource(),
    [PATH_B]: idleSource(PLAN_B, "Beta"),
  });
  access.fault(PATH_B, "before-apply");
  const plan = createMutationPlan({
    intentId: "intent-cross-file-switch",
    action: "switch-task",
    stages: [
      { path: PATH_A, confirmationRequired: false, operations: [{ kind: "clock-out", target: { kind: "clock", id: CLOCK_A, ownerId: PLAN_A }, close: { clockId: CLOCK_A, endEpochMs: NOW, offsetMinutes: 480 } }] },
      { path: PATH_B, confirmationRequired: false, operations: [{ kind: "clock-in", target: { kind: "plan-item", id: PLAN_B }, clock: { clockId: CLOCK_B, startEpochMs: NOW, offsetMinutes: 480 } }] },
    ],
    expectedRunningClockIds: [CLOCK_A],
    settingsVersion: CONTEXT.settingsVersion,
    zoneId: CONTEXT.zoneId,
    transitionEpochMs: NOW,
  });
  const expectation = await mutationExpectation(access, plan, {
    planIds: [PLAN_B],
    clockIds: [CLOCK_A],
    expectedRunningClockIds: [CLOCK_A],
  });
  const writer = committer(access);
  const receipt = await writer.commit(plan, expectation);
  assert.equal(receipt.outcome, "partial-safe");
  assert.equal(receipt.result?.code, "partial-switch");
  assert.ok((await access.readText(PATH_A))?.includes(formatCanonicalClosedClock(START, 480, NOW, 480, CLOCK_A)));
  assert.equal((await access.readText(PATH_B))?.includes("CLOCK:"), false);
  assert.deepEqual(receipt.globalCheck.runningClockIds, []);
  assert.equal(access.transactionCounts.get(PATH_A), 1);
  assert.equal(access.transactionCounts.get(PATH_B), 1);
  writer.dispose();
});

test("cross-file switch stops Idle when later target relocation converges on the already-written source", async () => {
  const access = new MemoryAtomicTextAccess({
    [PATH_A]: activeSource(),
    [PATH_B]: idleSource(PLAN_B, "Beta"),
  });
  const transition = NOW;
  const mutation = createMutationPlan({
    intentId: "converging-switch",
    action: "switch-task",
    stages: [
      { path: PATH_A, confirmationRequired: false, operations: [{ kind: "clock-out", target: { kind: "clock", id: CLOCK_A, ownerId: PLAN_A }, close: { clockId: CLOCK_A, endEpochMs: transition, offsetMinutes: 480 } }] },
      { path: PATH_B, confirmationRequired: false, operations: [{ kind: "clock-in", target: { kind: "plan-item", id: PLAN_B }, clock: { clockId: CLOCK_B, startEpochMs: transition, offsetMinutes: 480 } }] },
    ],
    expectedRunningClockIds: [CLOCK_A],
    settingsVersion: CONTEXT.settingsVersion,
    zoneId: CONTEXT.zoneId,
    transitionEpochMs: transition,
  });
  const expectation = await mutationExpectation(access, mutation, {
    planIds: [PLAN_B], clockIds: [CLOCK_A], expectedRunningClockIds: [CLOCK_A],
  });
  const closedA = activeSource().replace(
    formatCanonicalRunningClock(START, 480, CLOCK_A),
    formatCanonicalClosedClock(START, 480, transition, 480, CLOCK_A),
  );
  access.raceAfterTransformReads(1, () => {
    access.modify(PATH_A, closedA.replace(CLOSE, `- [ ] Beta ^${PLAN_B}\n${CLOSE}`));
    access.delete(PATH_B);
  });
  const writer = committer(access);
  const receipt = await writer.commit(mutation, expectation);
  assert.equal(receipt.outcome, "partial-safe");
  assert.equal(receipt.result?.code, "partial-switch");
  assert.equal(access.transactionCounts.get(PATH_A), 1);
  assert.equal(access.transactionCounts.get(PATH_B), undefined);
  assert.equal((await access.readText(PATH_A))?.includes(formatCanonicalRunningClock(transition, 480, CLOCK_B)), false);
  assert.deepEqual(receipt.globalCheck.runningClockIds, []);
  writer.dispose();
});

test("overlap repair closes older CLOCKs in deterministic order, preserves newest, and rejects exact-start ties", async () => {
  const pathC = "Daily/C.md";
  const startA = NOW - 30 * 60_000;
  const startB = NOW - 20 * 60_000;
  const startC = NOW - 10 * 60_000;
  const access = new MemoryAtomicTextAccess({
    [PATH_A]: `${OPEN}\n- [ ] A ^${PLAN_A}\n  - LOGBOOK::\n    - ${formatCanonicalRunningClock(startA, 480, CLOCK_A)}\n${CLOSE}\n`,
    [PATH_B]: `${OPEN}\n- [ ] B ^${PLAN_B}\n  - LOGBOOK::\n    - ${formatCanonicalRunningClock(startB, 480, CLOCK_B)}\n${CLOSE}\n`,
    [pathC]: `${OPEN}\n- [ ] C ^${PLAN_NEW}\n  - LOGBOOK::\n    - ${formatCanonicalRunningClock(startC, 480, CLOCK_NEW)}\n${CLOSE}\n`,
  });
  const repair = createMutationPlan({
    intentId: "repair-overlap",
    action: "repair-overlap",
    stages: [
      { path: PATH_A, confirmationRequired: true, operations: [{ kind: "clock-out", target: { kind: "clock", id: CLOCK_A, ownerId: PLAN_A }, close: { clockId: CLOCK_A, endEpochMs: startC, offsetMinutes: 480 } }] },
      { path: PATH_B, confirmationRequired: true, operations: [{ kind: "clock-out", target: { kind: "clock", id: CLOCK_B, ownerId: PLAN_B }, close: { clockId: CLOCK_B, endEpochMs: startC, offsetMinutes: 480 } }] },
    ],
    expectedRunningClockIds: [CLOCK_A, CLOCK_B, CLOCK_NEW],
    settingsVersion: CONTEXT.settingsVersion,
    zoneId: CONTEXT.zoneId,
  });
  const expectation = await mutationExpectation(access, repair, {
    clockIds: [CLOCK_A, CLOCK_B], expectedRunningClockIds: [CLOCK_A, CLOCK_B, CLOCK_NEW],
  });
  const writer = committer(access);
  const receipt = await writer.commit(repair, expectation);
  assert.equal(receipt.outcome, "applied");
  assert.deepEqual(receipt.sources.map(({ path }) => path), [PATH_A, PATH_B]);
  assert.deepEqual(receipt.globalCheck.runningClockIds, [CLOCK_NEW]);
  writer.dispose();

  const tieAccess = new MemoryAtomicTextAccess({
    [PATH_A]: activeSource(PLAN_A, CLOCK_A),
    [PATH_B]: activeSource(PLAN_B, CLOCK_B, "Beta"),
  });
  const tieRepair = createMutationPlan({
    intentId: "repair-tie",
    action: "repair-overlap",
    stages: [{ path: PATH_A, confirmationRequired: true, operations: [{ kind: "clock-out", target: { kind: "clock", id: CLOCK_A, ownerId: PLAN_A }, close: { clockId: CLOCK_A, endEpochMs: START, offsetMinutes: 480 } }] }],
    expectedRunningClockIds: [CLOCK_A, CLOCK_B],
    settingsVersion: CONTEXT.settingsVersion,
    zoneId: CONTEXT.zoneId,
  });
  const tieExpectation = await mutationExpectation(tieAccess, tieRepair, {
    clockIds: [CLOCK_A], expectedRunningClockIds: [CLOCK_A, CLOCK_B],
  });
  const tieWriter = committer(tieAccess);
  const tied = await tieWriter.commit(tieRepair, tieExpectation);
  assert.equal(tied.outcome, "rejected");
  assert.equal(tieAccess.transactionCounts.size, 0);
  tieWriter.dispose();
});

test("done-owner repair closes only a revalidated done task CLOCK", async () => {
  for (const [checkbox, outcome] of [["x", "applied"], [" ", "rejected"]] as const) {
    const source = `${OPEN}\n- [${checkbox}] Task ^${PLAN_A}\n  - LOGBOOK::\n    - ${formatCanonicalRunningClock(START, 480, CLOCK_A)}\n${CLOSE}\n`;
    const access = new MemoryAtomicTextAccess({ [PATH_A]: source });
    const repair = createMutationPlan({
      intentId: `done-owner-${checkbox}`,
      action: "repair-done-owner-clock",
      stages: [{ path: PATH_A, confirmationRequired: true, operations: [{ kind: "clock-out", target: { kind: "clock", id: CLOCK_A, ownerId: PLAN_A }, close: { clockId: CLOCK_A, endEpochMs: NOW, offsetMinutes: 480 } }] }],
      expectedRunningClockIds: [CLOCK_A],
      settingsVersion: CONTEXT.settingsVersion,
      zoneId: CONTEXT.zoneId,
    });
    const expectation = await mutationExpectation(access, repair, { clockIds: [CLOCK_A], expectedRunningClockIds: [CLOCK_A] });
    const writer = committer(access);
    const receipt = await writer.commit(repair, expectation);
    assert.equal(receipt.outcome, outcome);
    assert.equal(access.transactionCounts.size, checkbox === "x" ? 1 : 0);
    writer.dispose();
  }
});

test("TC-OBS-SAFE-001-005 disposable lifecycle adapter exercises the same background atomic contract", async () => {
  const root = await mkdtemp(join(tmpdir(), "obs-safe-001-"));
  try {
    const access = new TempVaultAtomicTextAccess(root);
    await access.seed({ [PATH_A]: idleSource() });
    const plan = clockInPlan(PATH_A, PLAN_A);
    const expectation = await mutationExpectation(access, plan, { planIds: [PLAN_A] });
    const writer = committer(access);
    const receipt = await writer.commit(plan, expectation);
    assert.equal(receipt.outcome, "applied");
    assert.equal(access.transactionCounts.get(PATH_A), 1);
    assert.ok((await access.readText(PATH_A))?.includes(CLOCK_NEW));
    writer.dispose();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
