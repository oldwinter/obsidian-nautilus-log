import assert from "node:assert/strict";
import test from "node:test";

import { scanPrimaryPlanRegion } from "../../../src/workspace/plan-region.ts";
import {
  resolvePrimaryPlan,
  tokenSourceSpan,
} from "../../../src/workspace/primary-plan-resolver.ts";
import { createSourceVersion } from "../../../src/workspace/source-version.ts";

const OPEN = "<!-- nautilus-log:plan/v1 -->";
const CLOSE = "<!-- /nautilus-log:plan -->";

async function resolve(content: string) {
  return resolvePrimaryPlan(await createSourceVersion("Daily/2026-08-28.md", content), content);
}

test("GRI-01/02 exact markers are column-zero, outside fences, and fail closed", () => {
  for (const source of [
    "- [ ] no region",
    ` ${OPEN}\n- [ ] indented\n${CLOSE}`,
    `${OPEN.toUpperCase()}\n- [ ] wrong case\n${CLOSE}`,
    `\`\`\`md\n${OPEN}\n- [ ] fenced\n${CLOSE}\n\`\`\``,
  ]) {
    assert.equal(scanPrimaryPlanRegion(source).region, undefined, source);
  }

  const unsupported = `${OPEN.replace("v1", "v2")}\n${CLOSE}\n${OPEN}\n- [ ] fallback forbidden\n${CLOSE}`;
  assert.equal(scanPrimaryPlanRegion(unsupported).region, undefined);
  assert.deepEqual(scanPrimaryPlanRegion(unsupported).diagnostics.map(({ code }) => code), [
    "unsupported-plan-version",
    "duplicate-plan-region",
  ]);

  const nested = `${OPEN}\n${OPEN}\n${CLOSE}\n${CLOSE}`;
  assert.equal(scanPrimaryPlanRegion(nested).region, undefined);
  assert.equal(scanPrimaryPlanRegion(nested).diagnostics[0]?.code, "nested-plan-region");

  const unclosed = `${OPEN}\n- [ ] unfinished`;
  assert.equal(scanPrimaryPlanRegion(unclosed).region, undefined);
  assert.equal(scanPrimaryPlanRegion(unclosed).diagnostics[0]?.code, "unclosed-plan-region");
});

test("GRI-03 first complete region is primary and later complete regions are diagnostic-only", () => {
  const source = `\uFEFF${OPEN}\r\n- [ ] first 15m\r\n${CLOSE}\r\n${OPEN}\n- [ ] duplicate 30m\n${CLOSE}`;
  const scan = scanPrimaryPlanRegion(source);
  assert.equal(source.slice(scan.region!.contentSpan.fromOffset, scan.region!.contentSpan.toOffset), "- [ ] first 15m\r\n");
  assert.equal(scan.region!.openingMarkerSpan.fromOffset, 1);
  assert.deepEqual(scan.diagnostics.map(({ code }) => code), ["duplicate-plan-region"]);
});

test("GRI-05 direct unordered parents retain source order and structural exclusions", async () => {
  const source = `${OPEN}\n- [ ] first 15m ^first\n  wrapped 90m\n  - [ ] nested 60m\n1. ordered\n   - [ ] ordered child\n> - [ ] quoted\n\n\`\`\`md\n- [ ] fenced\n\`\`\`\n\n<div>\n- [ ] html\n</div>\n\n| column |\n| --- |\n| - [ ] table |\n\n  + plain 20m\n* [x] done 30m\n- [-] foreign\n${CLOSE}`;
  const result = await resolve(source);
  assert.deepEqual(result.candidates.map(({ sourceOrder, status }) => [sourceOrder, status]), [
    [0, "open"],
    [1, "plain"],
    [2, "done"],
  ]);
  assert.deepEqual(result.candidates.map(({ source }) => source.blockId), ["first", undefined, undefined]);
  assert.equal(result.candidates[0]!.source.firstLineText, "- [ ] first 15m ^first");
  assert.match(
    source.slice(
      result.candidates[0]!.source.itemSpan.fromOffset,
      result.candidates[0]!.source.itemSpan.toOffset,
    ),
    /^- \[ \] first 15m \^first\n  wrapped 90m\n  - \[ \] nested 60m$/,
  );
});

test("GRI-08/12 inline projection is structural, mapped, and never dereferences", async () => {
  const source = `${OPEN}\n- [ ] **Plan** [30m](99m) [[Target|45m]] ![60m](image.png) ![[Embed|75m]] \`90m\` <!-- 120m --> ==now== #tag ^mapped  \n${CLOSE}`;
  const result = await resolve(source);
  const candidate = result.candidates[0]!;

  assert.deepEqual(candidate.segments.filter(({ kind }) => kind !== "hidden").map(({ kind, text }) => [kind, text]), [
    ["semantic", "Plan"],
    ["semantic", " "],
    ["semantic", "30m"],
    ["semantic", " "],
    ["semantic", "45m"],
    ["semantic", " "],
    ["display-only", "60m"],
    ["semantic", " "],
    ["display-only", "75m"],
    ["semantic", " "],
    ["display-only", "90m"],
    ["semantic", " "],
    ["semantic", " "],
    ["semantic", "now"],
    ["semantic", " #tag"],
  ]);
  const hiddenText = candidate.segments
    .filter(({ kind }) => kind === "hidden")
    .map(({ text }) => text)
    .join("");
  assert.match(hiddenText, /99m/);
  assert.match(hiddenText, /Target\|/);
  assert.match(hiddenText, /Embed\|/);
  assert.match(hiddenText, /120m/);
  assert.equal(candidate.source.blockId, "mapped");
  assert.equal(source.slice(candidate.source.blockIdSpan!.fromOffset, candidate.source.blockIdSpan!.toOffset), "^mapped");
  assert.equal(source.slice(candidate.source.checkboxSpan!.fromOffset, candidate.source.checkboxSpan!.toOffset), "[ ]");

  const linkSegmentIndex = candidate.segments.findIndex(
    ({ kind, text }) => kind === "semantic" && text === "30m",
  );
  const linkToken = tokenSourceSpan(source, candidate.source, {
    segmentIndex: linkSegmentIndex,
    fromOffset: 0,
    toOffset: 3,
  });
  assert.equal(source.slice(linkToken.fromOffset, linkToken.toOffset), "30m");
});

test("GRI-13 spans are half-open UTF-16 positions against one exact snapshot", async () => {
  const source = `before 😀\r\n${OPEN}\r\n- [ ] 😀 task 15m ^id\r\n${CLOSE}\r\n`;
  const result = await resolve(source);
  const item = result.candidates[0]!.source;
  assert.equal(item.version.contentLength, source.length);
  assert.equal(item.firstLineSpan.fromLine, 2);
  assert.equal(item.firstLineSpan.fromColumn, 0);
  assert.equal(item.firstLineSpan.toColumn, "- [ ] 😀 task 15m ^id".length);
  assert.equal(source.slice(item.contentSpan.fromOffset, item.contentSpan.toOffset), "😀 task 15m");
  assert.equal(item.contentSpan.toOffset - item.contentSpan.fromOffset, "😀 task 15m".length);
});

test("GRI-14 terminal block ID grammar is exact", async () => {
  const source = `${OPEN}\n- [ ] yes ^Alpha-09\n- [ ] no-caret^joined\n- [ ] no_underscore ^bad_id\n- [ ] no punctuation ^bad.id\n- [ ] suffix ^good trailing\n- [ ] empty ^\n${CLOSE}`;
  const result = await resolve(source);
  assert.deepEqual(result.candidates.map(({ source: item }) => item.blockId), [
    "Alpha-09",
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
  ]);
});
