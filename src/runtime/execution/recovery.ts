import {
  acknowledgeMutationPreview,
  mutationExpectationTokenMatches,
  type AcknowledgedMutationExpectation,
  type MutationExpectation,
} from "../../workspace/expectation";
import {
  createCanonicalPreviewToken,
  mutationPlanIsValid,
  type MutationPlan,
} from "../../workspace/mutations";
import type { ExecutionClockIndexState } from "./clock-index";

export interface TimingRepairTarget {
  readonly path: string;
  readonly fromOffset: number;
  readonly toOffset: number;
  readonly expectedText: string;
  readonly replacementText: string;
}

export interface TimingRepairPreview {
  readonly plan: MutationPlan;
  readonly expectation: MutationExpectation;
  readonly targets: readonly TimingRepairTarget[];
  readonly confirmationToken: string;
}

declare const timingRepairAcknowledgmentBrand: unique symbol;
export type AcknowledgedTimingRepair = Omit<TimingRepairPreview, "expectation"> & {
  readonly expectation: AcknowledgedMutationExpectation;
  readonly [timingRepairAcknowledgmentBrand]: true;
};

const acknowledgments = new WeakSet<TimingRepairPreview>();
const TIMING_REPAIR_ACTIONS = new Set<MutationPlan["action"]>([
  "repair-plan-item-identity",
  "repair-clock-identity",
  "normalize-legacy-clock",
  "repair-overlap",
  "repair-done-owner-clock",
]);

function validTarget(target: TimingRepairTarget): boolean {
  return target.path.length > 0
    && Number.isSafeInteger(target.fromOffset)
    && Number.isSafeInteger(target.toOffset)
    && target.fromOffset >= 0
    && target.toOffset >= target.fromOffset
    && target.expectedText.length === target.toOffset - target.fromOffset
    && target.expectedText !== target.replacementText;
}

export function createTimingRepairPreview(
  state: ExecutionClockIndexState,
  plan: MutationPlan,
  expectation: MutationExpectation,
  targets: readonly TimingRepairTarget[],
): TimingRepairPreview {
  if (state.kind !== "degraded") throw new Error("Timing Repair requires a degraded CLOCK state");
  if (!mutationPlanIsValid(plan) || !mutationExpectationTokenMatches(expectation)) {
    throw new TypeError("Timing Repair requires a valid plan and expectation");
  }
  if (!TIMING_REPAIR_ACTIONS.has(plan.action) || plan.stages.length === 0) {
    throw new TypeError("Timing Repair requires a supported nonempty repair plan");
  }
  if (targets.length === 0 || !targets.every(validTarget)) {
    throw new TypeError("Timing Repair targets must bind every exact changed span");
  }
  if (plan.action !== expectation.action
    || plan.intentId !== expectation.intentId
    || plan.previewToken !== expectation.previewToken
    || plan.settingsVersion !== expectation.settingsVersion
    || plan.zoneId !== expectation.zoneId) {
    throw new TypeError("Timing Repair plan and expectation must identify the same action");
  }
  if (plan.stages.some((stage) => !stage.confirmationRequired)) {
    throw new TypeError("Every Timing Repair stage must require confirmation");
  }
  const stagePaths = new Set(plan.stages.map((stage) => stage.path));
  if ([...stagePaths].some((path) => !targets.some((target) => target.path === path))
    || targets.some((target) => !stagePaths.has(target.path))) {
    throw new TypeError("Timing Repair targets must cover exactly the planned files");
  }
  const orderedTargets = [...targets].sort((left, right) =>
    left.path.localeCompare(right.path)
      || left.fromOffset - right.fromOffset
      || left.toOffset - right.toOffset);
  for (let index = 1; index < orderedTargets.length; index += 1) {
    const previous = orderedTargets[index - 1]!;
    const current = orderedTargets[index]!;
    if (previous.path === current.path && current.fromOffset < previous.toOffset) {
      throw new TypeError("Timing Repair target spans must not overlap");
    }
  }
  const frozenTargets = Object.freeze(orderedTargets.map((target) => Object.freeze({ ...target })));
  return Object.freeze({
    plan,
    expectation,
    targets: frozenTargets,
    confirmationToken: createCanonicalPreviewToken({
      planPreviewToken: plan.previewToken,
      expectationToken: expectation.expectationToken,
      targets: frozenTargets,
    }),
  });
}

export function acknowledgeTimingRepair(
  preview: TimingRepairPreview,
  confirmationToken: string,
): AcknowledgedTimingRepair {
  if (confirmationToken !== preview.confirmationToken) {
    throw new Error("Timing Repair confirmation does not match the current preview");
  }
  const acknowledged = Object.freeze({
    ...preview,
    expectation: acknowledgeMutationPreview(preview.plan, preview.expectation),
  }) as AcknowledgedTimingRepair;
  acknowledgments.add(acknowledged);
  return acknowledged;
}

export function timingRepairIsAcknowledged(
  preview: TimingRepairPreview,
): preview is AcknowledgedTimingRepair {
  return acknowledgments.has(preview);
}
