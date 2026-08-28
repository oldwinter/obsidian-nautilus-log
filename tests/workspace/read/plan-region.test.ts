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
  const source = `${OPEN}\n- [ ] first 15m ^first\nlazy continuation 75m\n  wrapped 90m\n  * * *\n  - [ ] nested 60m\n1. ordered\n   ordered continuation\n   - [ ] ordered child\n> - [ ] quoted\n\n- - -\n\n- parent\n\n      \`\`\`md\n- [ ] after indented code fence 35m\n\n\`\`\`md\n- [ ] fenced\n\`\`\`\n\n<div>\n- [ ] html\n</div>\n\n<custom-element data-kind="block">\n- [ ] custom html\n</custom-element>\n\n<div>\nunclosed type-six HTML ends at blank\n\n- [ ] after html 25m\n\n| column |\n| --- |\n| - [ ] table |\n\n  + plain 20m\n* [x] done 30m\n- [-] foreign\n${CLOSE}`;
  const result = await resolve(source);
  assert.deepEqual(result.candidates.map(({ source: item }) => item.firstLineText), [
    "- [ ] first 15m ^first",
    "- parent",
    "- [ ] after indented code fence 35m",
    "- [ ] after html 25m",
    "  + plain 20m",
    "* [x] done 30m",
  ]);
  assert.deepEqual(result.candidates.map(({ sourceOrder, status }) => [sourceOrder, status]), [
    [0, "open"],
    [1, "plain"],
    [2, "open"],
    [3, "open"],
    [4, "plain"],
    [5, "done"],
  ]);
  assert.deepEqual(result.candidates.map(({ source }) => source.blockId), [
    "first",
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
  ]);
  assert.equal(result.candidates[0]!.source.firstLineText, "- [ ] first 15m ^first");
  assert.match(
    source.slice(
      result.candidates[0]!.source.itemSpan.fromOffset,
      result.candidates[0]!.source.itemSpan.toOffset,
    ),
    /^- \[ \] first 15m \^first\nlazy continuation 75m\n  wrapped 90m\n  \* \* \*\n  - \[ \] nested 60m$/,
  );
});

test("GRI-05 indented code that looks like HTML cannot hide later direct items", async () => {
  const source = `${OPEN}\n- parent\n\n      <div>\n- [ ] after list code 30m\n- \`\`\`md\n  literal 90m\n  \`\`\`\n# reset\n\n    <div>\n- [ ] after top-level code 45m\n${CLOSE}`;
  const result = await resolve(source);
  assert.deepEqual(result.candidates.map(({ status, segments }) => [
    status,
    segments.filter(({ kind }) => kind === "semantic").map(({ text }) => text).join(""),
  ]), [
    ["plain", "parent"],
    ["open", "after list code 30m"],
    ["open", "after top-level code 45m"],
  ]);
});

test("GRI-08 escaped image punctuation leaves the following link label semantic", async () => {
  const source = `${OPEN}\n- [ ] escaped \\![45m](image.png) ^escaped\n${CLOSE}`;
  const result = await resolve(source);
  assert.deepEqual(result.candidates[0]!.segments
    .filter(({ kind }) => kind !== "hidden")
    .map(({ kind, text }) => [kind, text]), [
    ["semantic", "escaped \\!"],
    ["semantic", "45m"],
  ]);
});

test("GRI-08 CommonMark intraword underscores and balanced link destinations stay structural", async () => {
  const source = `${OPEN}\n- [ ] foo_30m_bar _45m_baz [label](foo(and)99m) [name\\\\](120m) [label [inner]](target/180m) 15m\n${CLOSE}`;
  const result = await resolve(source);
  const candidate = result.candidates[0]!;
  assert.deepEqual(candidate.segments.filter(({ kind }) => kind !== "hidden").map(({ text }) => text), [
    "foo_30m_bar _45m_baz ",
    "label",
    " ",
    "name\\\\",
    " ",
    "label [inner]",
    " 15m",
  ]);
  assert.equal(candidate.segments.some(({ kind, text }) => kind === "hidden" && text.includes("120m")), true);
  assert.equal(candidate.segments.some(({ kind, text }) => kind === "hidden" && text.includes("180m")), true);
});

test("GRI-08 multiline comments stay hidden and escaped backticks stay semantic", async () => {
  const source = [
    OPEN,
    "- [ ] comment 15m <!-- hidden 90m",
    "  still hidden -->",
    "- [ ] escaped \\`30m\\` 45m",
    CLOSE,
  ].join("\n");
  const result = await resolve(source);
  assert.equal(result.candidates[0]!.segments.some(({ kind, text }) =>
    kind !== "hidden" && text.includes("90m")), false);
  assert.equal(result.candidates[1]!.segments.some(({ kind, text }) =>
    kind === "semantic" && text.includes("30m")), true);
  assert.equal(result.candidates[1]!.segments.some(({ kind }) => kind === "display-only"), false);
});

test("GRI-08 preserves visible angle text, autolink labels, and triple emphasis", async () => {
  const source = `${OPEN}\n- [ ] compare < 30m > ***45m*** ___60m___ <user@example.com> <https://example.com/75m>\n${CLOSE}`;
  const result = await resolve(source);
  const visible = result.candidates[0]!.segments
    .filter(({ kind }) => kind !== "hidden")
    .map(({ text }) => text)
    .join("");
  assert.equal(visible, "compare < 30m > 45m 60m user@example.com https://example.com/75m");
});

test("GRI-08/12 read-side contribution preserves bytes and never dereferences", async () => {
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
  const linkToken = await tokenSourceSpan(source, candidate.source, {
    segmentIndex: linkSegmentIndex,
    fromOffset: 0,
    toOffset: 3,
  });
  assert.equal(source.slice(linkToken.fromOffset, linkToken.toOffset), "30m");

  const sameLengthEdit = source.replace("Plan", "Edit");
  assert.equal(sameLengthEdit.length, source.length);
  await assert.rejects(
    tokenSourceSpan(sameLengthEdit, candidate.source, {
      segmentIndex: linkSegmentIndex,
      fromOffset: 0,
      toOffset: 3,
    }),
    /snapshot|digest/i,
  );
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
