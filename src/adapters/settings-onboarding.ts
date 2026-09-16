import type { RuntimePlanProjection } from "../runtime/projection-runtime";
import type { RuntimeSnapshot } from "../runtime/snapshots";

export type SettingsOnboardingKind = "missing" | "empty" | "ready";

export function settingsOnboardingKind(
  snapshot: RuntimeSnapshot<RuntimePlanProjection> | undefined,
): SettingsOnboardingKind {
  if (snapshot?.state !== "confirmed") return "missing";
  return snapshot.projection.items.length === 0 ? "empty" : "ready";
}

export function settingsOnboardingChanged(
  previous: SettingsOnboardingKind | undefined,
  snapshot: RuntimeSnapshot<RuntimePlanProjection> | undefined,
): boolean {
  return settingsOnboardingKind(snapshot) !== previous;
}

export function settingsOnboardingExecutionKey(
  executionEnabled: boolean,
): "settings.onboardingExecutionOn" | "settings.onboardingExecution" {
  return executionEnabled ? "settings.onboardingExecutionOn" : "settings.onboardingExecution";
}
