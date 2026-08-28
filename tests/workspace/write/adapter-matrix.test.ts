import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  ObsidianAtomicTextAccess,
  WorkspaceCommitter,
  type AtomicTextAccess,
  type CommitContext,
  type WorkspaceCommitterOptions,
} from "../../../src/workspace/commit.ts";
import {
  formatCanonicalRunningClock,
} from "../../../src/workspace/logbook-clock.ts";
import { createMutationPlan, type MutationPlan } from "../../../src/workspace/mutations.ts";
import type { CommitReceipt } from "../../../src/workspace/receipt.ts";
import { MemoryAtomicTextAccess, TempVaultAtomicTextAccess } from "./adapters.ts";
import {
  CLOCK_A,
  CLOCK_NEW,
  CLOSE,
  CONTEXT,
  NOW,
  OPEN,
  PLAN_A,
  PLAN_B,
  PLAN_NEW,
  mutationExpectation,
  type ExpectationTargets,
} from "./fixtures.ts";

const PATH = "Daily/Matrix.md";
const START = NOW - 30 * 60_000;

interface MatrixScenario {
  readonly name: string;
  readonly files: Readonly<Record<string, string>>;
  readonly plan: MutationPlan;
  readonly targets: ExpectationTargets;
  readonly context?: CommitContext;
  readonly options?: Pick<WorkspaceCommitterOptions, "index" | "logbook">;
  readonly discontinuityExpectation?: boolean;
}

function oneStage(
  intentId: string,
  action: MutationPlan["action"],
  operations: MutationPlan["stages"][number]["operations"],
  expectedRunningClockIds: readonly string[] = [],
  zoneId = CONTEXT.zoneId,
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
    stages: [{ path: PATH, confirmationRequired, operations }],
    expectedRunningClockIds,
    settingsVersion: CONTEXT.settingsVersion,
    zoneId,
  });
}

function comparableReceipt(receipt: CommitReceipt): unknown {
  return {
    ...receipt,
    sources: receipt.sources.map(({ path, before, after }) => ({ path, before, after })),
  };
}

async function fileMap(access: AtomicTextAccess, paths: readonly string[]): Promise<Readonly<Record<string, string>>> {
  const entries: [string, string][] = [];
  for (const path of paths) entries.push([path, (await access.readText(path))!]);
  return Object.freeze(Object.fromEntries(entries));
}

const foldEpoch = Date.UTC(2026, 10, 1, 5, 30);
const resolveLocalTime = (parts: { readonly hour: number }) => parts.hour === 1
  ? { kind: "ambiguous" as const }
  : { kind: "nonexistent" as const };
const recoveryContext = Object.freeze({
  ...CONTEXT,
  wallEpochMs: NOW + 60 * 60_000,
  monotonicMs: CONTEXT.monotonicMs + 10_000,
  discontinuity: true,
});
const rebasedStart = recoveryContext.wallEpochMs
  - (NOW + 10_000 - START);

const SCENARIOS: readonly MatrixScenario[] = Object.freeze([
  {
    name: "Progress",
    files: { [PATH]: `${OPEN}\n- [ ] Task d20% ^${PLAN_A}\n${CLOSE}\n` },
    plan: oneStage("matrix-progress", "advance-progress", [{
      kind: "advance-progress", target: { kind: "plan-item", id: PLAN_A }, logicalMinute: 570,
    }]),
    targets: { planIds: [PLAN_A] },
  },
  {
    name: "Complete",
    files: { [PATH]: `${OPEN}\n- [ ] Task d20% ^${PLAN_A}\n  - LOGBOOK::\n    - ${formatCanonicalRunningClock(START, 480, CLOCK_A)}\n${CLOSE}\n` },
    plan: oneStage("matrix-complete", "complete", [{
      kind: "complete",
      target: { kind: "plan-item", id: PLAN_A },
      closeClock: { clockId: CLOCK_A, endEpochMs: NOW, offsetMinutes: 480 },
    }], [CLOCK_A]),
    targets: { planIds: [PLAN_A], clockIds: [CLOCK_A], expectedRunningClockIds: [CLOCK_A] },
  },
  {
    name: "Delete",
    files: { [PATH]: `${OPEN}\n- [ ] Task ^${PLAN_A}\n  - LOGBOOK::\n    - ${formatCanonicalRunningClock(START, 480, CLOCK_A)}\n${CLOSE}\n` },
    plan: oneStage("matrix-delete", "delete-clock", [{
      kind: "delete-clock",
      target: { kind: "clock", id: CLOCK_A, ownerId: PLAN_A },
      confirmation: {
        firstActivationEpochMs: NOW - 100,
        secondActivationEpochMs: NOW,
        firstTargetKey: CLOCK_A,
        secondTargetKey: CLOCK_A,
      },
    }], [CLOCK_A]),
    targets: { clockIds: [CLOCK_A], expectedRunningClockIds: [CLOCK_A] },
  },
  {
    name: "Identity repair",
    files: { [PATH]: `${OPEN}\n- [ ] First ^${PLAN_A}\n- [ ] Second ^${PLAN_A}\n${CLOSE}\n` },
    plan: oneStage("matrix-repair", "repair-plan-item-identity", [{
      kind: "repair-plan-item-identity", target: { kind: "plan-item", id: PLAN_A }, newId: PLAN_NEW,
    }]),
    targets: { planIds: [PLAN_A] },
  },
  {
    name: "Measured recovery",
    files: { [PATH]: `${OPEN}\n- [ ] Task ^${PLAN_A}\n  - LOGBOOK::\n    - ${formatCanonicalRunningClock(START, 480, CLOCK_A)}\n${CLOSE}\n` },
    plan: oneStage("matrix-recovery", "keep-measured-time", [{
      kind: "rebase-clock",
      target: { kind: "clock", id: CLOCK_A, ownerId: PLAN_A },
      startEpochMs: rebasedStart,
      offsetMinutes: 480,
    }], [CLOCK_A]),
    targets: { clockIds: [CLOCK_A], expectedRunningClockIds: [CLOCK_A] },
    context: recoveryContext,
    discontinuityExpectation: true,
  },
  {
    name: "DST fold",
    files: { [PATH]: `${OPEN}\n- [ ] Task ^${PLAN_A}\n  - LOGBOOK::\n    - CLOCK: [2026-11-01 01:30]\n${CLOSE}\n` },
    plan: oneStage("matrix-fold", "normalize-legacy-clock", [{
      kind: "normalize-legacy-clock",
      target: { kind: "clock", ownerId: PLAN_A },
      clockId: CLOCK_NEW,
      startEpochMs: foldEpoch,
      startOffsetMinutes: -240,
      foldCandidates: [
        { epochMs: foldEpoch, offsetMinutes: -240 },
        { epochMs: Date.UTC(2026, 10, 1, 6, 30), offsetMinutes: -300 },
      ],
    }], [], "America/New_York"),
    targets: { clockIds: [undefined], logbookOptions: { resolveLocalTime } },
    context: Object.freeze({ ...CONTEXT, zoneId: "America/New_York" }),
    options: {
      index: { clockParsing: { resolveLocalTime } },
      logbook: { resolveLocalTime },
    },
  },
  {
    name: "Closed malformed history",
    files: { [PATH]: `${OPEN}\n- [ ] History ^${PLAN_A}\n  - LOGBOOK::\n    - CLOCK: [2026-08-28T08:10+08:00]--[broken]\n- [ ] Current ^${PLAN_B}\n${CLOSE}\n` },
    plan: oneStage("matrix-malformed", "clock-in", [{
      kind: "clock-in",
      target: { kind: "plan-item", id: PLAN_B },
      clock: { clockId: CLOCK_NEW, startEpochMs: NOW, offsetMinutes: 480 },
    }]),
    targets: { planIds: [PLAN_B] },
  },
  {
    name: "Backwards failure",
    files: { [PATH]: `${OPEN}\n- [ ] Task ^${PLAN_A}\n  - LOGBOOK::\n    - ${formatCanonicalRunningClock(START, 480, CLOCK_A)}\n${CLOSE}\n` },
    plan: oneStage("matrix-backwards", "clock-out", [{
      kind: "clock-out",
      target: { kind: "clock", id: CLOCK_A, ownerId: PLAN_A },
      close: { clockId: CLOCK_A, endEpochMs: START - 1, offsetMinutes: 480 },
    }], [CLOCK_A]),
    targets: { clockIds: [CLOCK_A], expectedRunningClockIds: [CLOCK_A] },
  },
]);

test("adversarial Markdown actions are byte- and receipt-equivalent in memory and disposable vault adapters", async () => {
  for (const scenario of SCENARIOS) {
    const paths = Object.keys(scenario.files).sort();
    let expectedAfter: Readonly<Record<string, string>> | undefined;
    let expectedReceipt: unknown;
    for (const adapter of ["memory", "disposable-vault"] as const) {
      const root = adapter === "disposable-vault" ? await mkdtemp(join(tmpdir(), "obs-safe-matrix-")) : undefined;
      let vaultProcesses = 0;
      let access: AtomicTextAccess;
      if (adapter === "memory") access = new MemoryAtomicTextAccess(scenario.files);
      else {
        const delegate = new TempVaultAtomicTextAccess(root!);
        await delegate.seed(scenario.files);
        access = new ObsidianAtomicTextAccess({
          text: delegate,
          editorForPath: () => undefined,
          fileForPath: (path) => ({ path }) as never,
          vault: {
            process: async (file: { readonly path: string }, transform: (text: string) => string) => {
              vaultProcesses += 1;
              await delegate.atomicTransform(file.path, (currentText) => ({
                text: transform(currentText),
                edits: Object.freeze([]),
                value: undefined,
              }));
              return (await delegate.readText(file.path))!;
            },
          } as never,
        });
      }
      try {
        assert.deepEqual(await fileMap(access, paths), scenario.files, `${scenario.name} ${adapter} before`);
        let expectation = await mutationExpectation(access, scenario.plan, scenario.targets);
        if (scenario.discontinuityExpectation) {
          expectation = Object.freeze({
            ...expectation,
            time: Object.freeze({ ...expectation.time, discontinuity: true }),
          });
        }
        const writer = new WorkspaceCommitter(access, {
          readContext: () => scenario.context ?? CONTEXT,
          ...scenario.options,
        });
        const receipt = await writer.commit(scenario.plan, expectation);
        const after = await fileMap(access, paths);
        writer.dispose();
        if (adapter === "disposable-vault" && receipt.outcome === "applied") {
          assert.ok(vaultProcesses > 0, `${scenario.name} must enter Vault.process`);
          assert.ok(receipt.sources.every((source) => source.primitive === "vault-process"));
        }
        if (expectedAfter === undefined) {
          expectedAfter = after;
          expectedReceipt = comparableReceipt(receipt);
        } else {
          assert.deepEqual(after, expectedAfter, `${scenario.name} complete after bytes`);
          assert.deepEqual(comparableReceipt(receipt), expectedReceipt, `${scenario.name} receipt`);
        }
        if (scenario.name === "Backwards failure") assert.deepEqual(after, scenario.files);
      } finally {
        if (root) await rm(root, { recursive: true, force: true });
      }
    }
  }
});
