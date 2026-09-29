import type { RuntimePlanProjection } from "../runtime/projection-runtime";
import type { RuntimeSnapshot } from "../runtime/snapshots";

export type SettingsOnboardingKind = "loading" | "missing" | "empty" | "ready" | "unavailable";

export function settingsOnboardingKind(
  snapshot: RuntimeSnapshot<RuntimePlanProjection> | undefined,
): SettingsOnboardingKind {
  if (!snapshot || snapshot.state === "loading" || snapshot.state === "stale" || snapshot.state === "hidden") {
    return "loading";
  }
  if (snapshot.state === "missing") return "missing";
  if (snapshot.state === "error" || snapshot.state === "over-limit") return "unavailable";
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
