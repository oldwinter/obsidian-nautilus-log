import { parseGrammar } from "../../../src/core/grammar-v1.ts";
import { isCanonicalClockId } from "../../../src/workspace/clock-parser.ts";
import {
  acknowledgeMutationPreview,
  createClockExpectation,
  createMutationExpectation,
  createPlanItemExpectation,
  type ClockExpectation,
  type MutationExpectation,
  type PlanItemExpectation,
} from "../../../src/workspace/expectation.ts";
import { readLogbook } from "../../../src/workspace/logbook-reader.ts";
import type { LogbookReadOptions } from "../../../src/workspace/logbook-reader.ts";
import { WorkspaceIndex } from "../../../src/workspace/identity-index.ts";
import type { MutationPlan } from "../../../src/workspace/mutations.ts";
import { mutationActionRequiresPreviewConfirmation } from "../../../src/workspace/mutations.ts";
import { resolvePrimaryPlan } from "../../../src/workspace/primary-plan-resolver.ts";
import { createSourceVersion } from "../../../src/workspace/source-version.ts";
import type { TextAccess } from "../../../src/workspace/text-access.ts";

export const OPEN = "<!-- nautilus-log:plan/v1 -->";
export const CLOSE = "<!-- /nautilus-log:plan -->";
export const PLAN_A = "nl-11111111-1111-4111-8111-111111111111";
export const PLAN_B = "nl-22222222-2222-4222-8222-222222222222";
export const PLAN_NEW = "nl-33333333-3333-4333-8333-333333333333";
export const CLOCK_A = "nl-clock-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
export const CLOCK_B = "nl-clock-bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
export const CLOCK_NEW = "nl-clock-cccccccc-cccc-4ccc-8ccc-cccccccccccc";
export const NOW = Date.UTC(2026, 7, 28, 1, 30, 0, 0);

export const CONTEXT = Object.freeze({
  settingsVersion: 7,
  zoneId: "Asia/Shanghai",
  wallEpochMs: NOW,
  monotonicMs: 50_000,
  discontinuity: false,
});

export interface ExpectationTargets {
  readonly planIds?: readonly (string | undefined)[];
  readonly clockIds?: readonly (string | undefined)[];
  readonly expectedRunningClockIds?: readonly string[];
  readonly logbookOptions?: LogbookReadOptions;
  readonly acknowledgePreview?: boolean;
}

export async function mutationExpectation(
  access: TextAccess,
  plan: MutationPlan,
  targets: ExpectationTargets,
): Promise<MutationExpectation> {
  const planItems: PlanItemExpectation[] = [];
  const clocks: ClockExpectation[] = [];
  const wantedPlans = [...(targets.planIds ?? [])];
  const wantedClocks = [...(targets.clockIds ?? [])];
  for (const path of await access.listMarkdownPaths()) {
    const sourceText = await access.readText(path);
    if (sourceText === undefined) continue;
    const sourceVersion = await createSourceVersion(path, sourceText);
    const resolved = resolvePrimaryPlan(sourceVersion, sourceText);
    const parsed = parseGrammar({ version: resolved.region?.version ?? "unsupported", candidates: resolved.candidates });
    for (const item of parsed.items) {
      const wantedIndex = wantedPlans.findIndex((id) => id === item.source.blockId);
      if (wantedIndex >= 0) {
        const logbook = readLogbook(sourceText, {
          path,
          itemFromOffset: item.source.itemSpan.fromOffset,
          itemToOffset: item.source.itemSpan.toOffset,
          ...(item.source.blockId ? { ownerId: item.source.blockId } : {}),
        }, targets.logbookOptions);
        planItems.push(createPlanItemExpectation({
          target: { kind: "plan-item", ...(item.source.blockId ? { id: item.source.blockId } : {}) },
          path,
          sourceText,
          item,
          drawerCount: logbook.drawers.length,
          watch: "complete-item",
        }));
        wantedPlans.splice(wantedIndex, 1);
      }
      const logbook = readLogbook(sourceText, {
        path,
        itemFromOffset: item.source.itemSpan.fromOffset,
        itemToOffset: item.source.itemSpan.toOffset,
        ...(item.source.blockId ? { ownerId: item.source.blockId } : {}),
      }, targets.logbookOptions);
      for (const clock of logbook.clocks) {
        const rawIdMatch = /(?:^|[ \t])\^([A-Za-z0-9-]+)[ \t]*$/.exec(clock.text);
        const rawId = rawIdMatch && isCanonicalClockId(rawIdMatch[1]!) ? rawIdMatch[1]! : undefined;
        const clockId = clock.parsed.kind === "record" ? clock.parsed.record.clockId : rawId;
        const wantedIndex = wantedClocks.findIndex((id) => id === clockId);
        if (wantedIndex < 0) continue;
        clocks.push(createClockExpectation({
          target: {
            kind: "clock",
            ...(clockId ? { id: clockId } : {}),
            ...(item.source.blockId ? { ownerId: item.source.blockId } : {}),
          },
          path,
          sourceText,
          clock,
        }));
        wantedClocks.splice(wantedIndex, 1);
      }
    }
  }
  if (wantedPlans.length > 0 || wantedClocks.length > 0) {
    throw new Error(`fixture targets not found: ${String(wantedPlans)} ${String(wantedClocks)}`);
  }
  const selectedOperation = plan.action === "repair-plan-item-identity" || plan.action === "repair-clock-identity"
    ? plan.stages[0]?.operations[0]
    : undefined;
  let selectedRepair: MutationExpectation["selectedRepair"];
  if (selectedOperation?.kind === "repair-plan-item-identity" || selectedOperation?.kind === "repair-clock-identity") {
    const index = new WorkspaceIndex(access);
    try {
      const snapshot = await index.rebuild();
      const identity = index.identity(selectedOperation.target.id);
      const selected = selectedOperation.kind === "repair-plan-item-identity"
        ? planItems.find((item) => item.target.id === selectedOperation.target.id)
        : clocks.find((clock) => clock.target.id === selectedOperation.target.id);
      const span = selected && "itemSpan" in selected ? selected.itemSpan : selected?.span;
      if (!snapshot.complete || !selected || !span) {
        throw new Error("fixture selected repair target is unavailable");
      }
      if (identity.kind === "collision") {
        selectedRepair = Object.freeze({
          id: selectedOperation.target.id,
          locations: identity.locations,
          selectedSpan: Object.freeze({ path: selected.path, fromOffset: span.fromOffset, toOffset: span.toOffset }),
        });
      }
    } finally {
      index.dispose();
    }
  }
  const expectation = createMutationExpectation({
    intentId: plan.intentId,
    action: plan.action,
    planItems,
    clocks,
    expectedRunningClockIds: targets.expectedRunningClockIds ?? [],
    settingsVersion: plan.settingsVersion,
    zoneId: plan.zoneId,
    indexComplete: true,
    time: {
      wallEpochMs: CONTEXT.wallEpochMs,
      monotonicMs: CONTEXT.monotonicMs,
      maximumDriftMs: 1_000,
      maximumQueueDelayMs: 1_000,
      discontinuity: false,
    },
    previewToken: plan.previewToken,
    ...(selectedRepair ? { selectedRepair } : {}),
  });
  return mutationActionRequiresPreviewConfirmation(plan.action) && targets.acknowledgePreview !== false
    ? acknowledgeMutationPreview(plan, expectation)
    : expectation;
}
