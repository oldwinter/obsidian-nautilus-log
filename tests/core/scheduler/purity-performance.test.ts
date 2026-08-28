import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import test from "node:test";

import { calculateCapacity } from "../../../src/core/capacity.ts";
import { projectDay } from "../../../src/core/day.ts";
import { schedulePlan } from "../../../src/core/scheduler.ts";
import { event, frozenItems, task } from "./fixtures.ts";

function stableHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

test("scheduler projections are deterministic, immutable, clock-free, and non-mutating", () => {
  const items = frozenItems([
    event(0, 360, 390),
    task(1, 30, "open", "Deep work"),
    task(2, 15, "plain", "Read"),
  ]);
  const before = structuredClone(items);
  const input = Object.freeze({
    startMinutes: 300,
    endMinutes: 420,
    nowMinutes: 330,
    items,
  });
  const originalNow = Date.now;
  const originalRandom = Math.random;
  Date.now = () => { throw new Error("global clock read"); };
  Math.random = () => { throw new Error("global randomness read"); };
  try {
    const hashes = new Set<string>();
    for (let index = 0; index < 100; index += 1) {
      hashes.add(stableHash({
        schedule: schedulePlan(input),
        capacity: calculateCapacity(input),
        day: projectDay({
          displayedDate: { year: 2026, month: 8, day: 28 },
          today: { year: 2026, month: 8, day: 28 },
          startMinutes: 300,
          endMinutes: 420,
          nowMinutes: 330,
        }),
      }));
    }
    assert.equal(hashes.size, 1);
  } finally {
    Date.now = originalNow;
    Math.random = originalRandom;
  }

  const output = schedulePlan(input);
  assert.equal(Object.isFrozen(output), true);
  assert.equal(Object.isFrozen(output.plannedSlots), true);
  assert.equal(Object.isFrozen(output.plannedSlots[0]), true);
  assert.equal(Object.isFrozen(output.plannedSlots[0]!.task), true);
  assert.deepEqual(items, before);
  assert.doesNotMatch(JSON.stringify(output), /(?:locale|translated|random|timestamp)/i);
});

test("calendar boundaries contain no fixed-24-hour boundary arithmetic", async () => {
  const sources = await Promise.all([
    readFile("src/core/day.ts", "utf8"),
    readFile("src/core/history.ts", "utf8"),
  ]);
  assert.doesNotMatch(sources.join("\n"), /86_?400_?000|24\s*\*\s*60\s*\*\s*60\s*\*\s*1000/);
  assert.doesNotMatch(sources.join("\n"), /Intl\.|Date\.now|new Date\(\s*\)/);
});

test("maximum 1,000-item pure scheduling remains feasible under the 50 ms p95 boundary", (context) => {
  const items = [];
  for (let index = 0; index < 1_000; index += 1) {
    if (index % 10 === 0) {
      const start = 300 + (index % 900);
      items.push(event(index, start, Math.min(1_440, start + 15)));
    } else {
      items.push(task(index, index % 7 === 0 ? 0 : 5, "open", index === 999 ? "x".repeat(16_384) : `Task ${index}`));
    }
  }
  const input = Object.freeze({
    startMinutes: 300,
    endMinutes: 1_440,
    nowMinutes: 360,
    items: frozenItems(items),
  });

  for (let warmup = 0; warmup < 10; warmup += 1) schedulePlan(input);
  const samples: number[] = [];
  for (let run = 0; run < 100; run += 1) {
    const started = performance.now();
    const output = schedulePlan(input);
    samples.push(performance.now() - started);
    assert.equal(output.plannedSlots.length + output.overflowTasks.length > 0, true);
  }
  samples.sort((left, right) => left - right);
  const p95 = samples[Math.ceil(samples.length * 0.95) - 1]!;
  context.diagnostic(`pure scheduler 1,000-item p95: ${p95.toFixed(3)} ms over 100 samples`);
  assert.ok(p95 < 50, `pure scheduler p95 ${p95.toFixed(3)} ms exceeded 50 ms`);
});
