import { PLAN_CLOSE_MARKER, PLAN_OPEN_MARKER_V1, scanPrimaryPlanRegion } from "./plan-region";

export const ENGLISH_SAMPLE_FLEXIBLE_TASK = "- [ ] Write the release note 45m";
export const CHINESE_SAMPLE_FLEXIBLE_TASK = "- [ ] 写发布说明 45m";

export type PrimaryPlanInsertion =
  | { readonly kind: "create"; readonly nextText: string }
  | { readonly kind: "append"; readonly nextText: string }
  | { readonly kind: "already-present" }
  | { readonly kind: "blocked"; readonly reason: "malformed-region" };

export function sampleFlexibleTask(locale: string): string {
  return locale === "zh" || locale === "zh-CN" || locale.startsWith("zh-")
    ? CHINESE_SAMPLE_FLEXIBLE_TASK
    : ENGLISH_SAMPLE_FLEXIBLE_TASK;
}

export function primaryPlanSeed(locale = "en"): string {
  return `${PLAN_OPEN_MARKER_V1}\n${sampleFlexibleTask(locale)}\n${PLAN_CLOSE_MARKER}\n`;
}

function appendBlock(existing: string, block: string): string {
  const prefix = existing.endsWith("\n") ? existing : `${existing}\n`;
  const separated = prefix.length === 0 || prefix.endsWith("\n\n") ? prefix : `${prefix}\n`;
  return `${separated}${block}`;
}

export function preparePrimaryPlanInsertion(
  existingText: string | undefined,
  locale = "en",
): PrimaryPlanInsertion {
  const seed = primaryPlanSeed(locale);
  if (existingText === undefined || existingText.length === 0) {
    return Object.freeze({ kind: "create", nextText: seed });
  }
  const scan = scanPrimaryPlanRegion(existingText);
  if (scan.region) return Object.freeze({ kind: "already-present" });
  if (scan.diagnostics.length > 0) return Object.freeze({ kind: "blocked", reason: "malformed-region" });
  return Object.freeze({ kind: "append", nextText: appendBlock(existingText, seed) });
}
