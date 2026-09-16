import assert from "node:assert/strict";
import test from "node:test";

import {
  CHINESE_SAMPLE_FLEXIBLE_TASK,
  ENGLISH_SAMPLE_FLEXIBLE_TASK,
  preparePrimaryPlanInsertion,
  primaryPlanSeed,
} from "../../../src/workspace/insert-primary-plan.ts";

const OPEN = "<!-- nautilus-log:plan/v1 -->";
const CLOSE = "<!-- /nautilus-log:plan -->";

test("missing or empty notes receive markers plus a localized sample task", () => {
  const created = preparePrimaryPlanInsertion(undefined, "en");
  assert.equal(created.kind, "create");
  if (created.kind !== "create") return;
  assert.equal(created.nextText, `${OPEN}\n${ENGLISH_SAMPLE_FLEXIBLE_TASK}\n${CLOSE}\n`);
  assert.equal(created.nextText, primaryPlanSeed("en"));

  const empty = preparePrimaryPlanInsertion("", "zh-CN");
  assert.equal(empty.kind, "create");
  if (empty.kind !== "create") return;
  assert.equal(empty.nextText, `${OPEN}\n${CHINESE_SAMPLE_FLEXIBLE_TASK}\n${CLOSE}\n`);
});

test("existing notes without a region append a separated Primary Plan", () => {
  const appended = preparePrimaryPlanInsertion("# Daily\nNotes", "en");
  assert.equal(appended.kind, "append");
  if (appended.kind !== "append") return;
  assert.equal(appended.nextText, `# Daily\nNotes\n\n${OPEN}\n${ENGLISH_SAMPLE_FLEXIBLE_TASK}\n${CLOSE}\n`);
});

test("a valid Primary Plan is left unchanged", () => {
  const source = `${OPEN}\n- [ ] Existing 30m\n${CLOSE}\n`;
  assert.deepEqual(preparePrimaryPlanInsertion(source, "en"), { kind: "already-present" });
});

test("malformed regions fail closed and fenced examples do not block insert", () => {
  const unclosed = `${OPEN}\n- [ ] unfinished`;
  assert.deepEqual(preparePrimaryPlanInsertion(unclosed, "en"), {
    kind: "blocked",
    reason: "malformed-region",
  });
  const nested = `${OPEN}\n${OPEN}\n${CLOSE}\n${CLOSE}`;
  assert.equal(preparePrimaryPlanInsertion(nested, "en").kind, "blocked");

  const fenced = `\`\`\`md\n${OPEN}\n${CLOSE}\n\`\`\`\n`;
  const inserted = preparePrimaryPlanInsertion(fenced, "en");
  assert.equal(inserted.kind, "append");
  if (inserted.kind !== "append") return;
  assert.equal(
    inserted.nextText.endsWith(`\n${OPEN}\n${ENGLISH_SAMPLE_FLEXIBLE_TASK}\n${CLOSE}\n`),
    true,
  );
});
