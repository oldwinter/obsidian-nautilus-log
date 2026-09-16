import assert from "node:assert/strict";
import test from "node:test";

import { settingsOnboardingKind } from "../../../src/adapters/settings-onboarding";
import type { RuntimePlanProjection } from "../../../src/runtime/projection-runtime";
import type { RuntimeSnapshot } from "../../../src/runtime/snapshots";

test("Settings onboarding offers Insert only while the Primary Plan is missing", () => {
  assert.equal(settingsOnboardingKind(undefined), "missing");
  assert.equal(settingsOnboardingKind({ state: "missing" } as RuntimeSnapshot<RuntimePlanProjection>), "missing");
  assert.equal(settingsOnboardingKind({ state: "loading" } as RuntimeSnapshot<RuntimePlanProjection>), "missing");
  assert.equal(
    settingsOnboardingKind({
      state: "confirmed",
      projection: { items: [] },
    } as RuntimeSnapshot<RuntimePlanProjection>),
    "empty",
  );
  assert.equal(
    settingsOnboardingKind({
      state: "confirmed",
      projection: { items: [{}] },
    } as RuntimeSnapshot<RuntimePlanProjection>),
    "ready",
  );
});
