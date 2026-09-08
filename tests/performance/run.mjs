#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";

import { historyFixture, schedulerFixture } from "../../benchmarks/fixtures.mjs";

const runnerRoot = await realpath(path.resolve(import.meta.dirname, "../.."));
const { values } = parseArgs({ options: {
  "source-root": { type: "string", default: runnerRoot }, output: { type: "string" },
  "candidate-sha": { type: "string" }, help: { type: "boolean" },
} });
if (values.help) {
  console.log("node tests/performance/run.mjs --output /new/evidence/directory [--source-root /source/checkout] [--candidate-sha <40 lowercase hex>]");
  process.exit(0);
}
assert.equal(process.versions.node, "24.20.0", "Use the pinned Node 24.20.0 runtime");
assert(values.output, "--output must name a new directory");
assert(!values["candidate-sha"] || /^[a-f0-9]{40}$/.test(values["candidate-sha"]), "--candidate-sha must be 40 lowercase hexadecimal characters");
const sourceRoot = await realpath(path.resolve(values["source-root"]));
const requestedOutput = path.resolve(values.output);
const outputRoot = path.join(await realpath(path.dirname(requestedOutput)), path.basename(requestedOutput));
for (const root of [runnerRoot, sourceRoot]) {
  const relative = path.relative(root, outputRoot);
  assert(relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative), "Keep performance output outside both repository roots");
}
await mkdir(outputRoot);
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const jsonHash = (value) => sha256(JSON.stringify(value));
const persist = (name, value) => writeFile(path.join(outputRoot, name), `${JSON.stringify(value, null, 2)}\n`);
const report = {
  schemaVersion: 1, startedAt: new Date().toISOString(), result: "RUNNING",
  evidenceClass: "ENV-PURE contribution", nativeHostExecuted: false, releaseGateQualified: false,
  candidateSha: values["candidate-sha"] ?? null,
  candidateBinding: "Optional operator label. This run does not verify cleanliness, pushed SHA equality, a release package, or a freeze.",
  sourceRoot, environment: { node: process.versions.node, platform: process.platform,
    architecture: process.arch, osRelease: os.release(), cpu: os.cpus()[0]?.model ?? null,
    cpuCount: os.cpus().length, totalMemoryBytes: os.totalmem(), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone },
  baseline: { result: "UNAVAILABLE", acceptedCandidateSha: null, regressionRuleEvaluated: false },
  limitations: [
    "Node timing with in-memory TextAccess is not Obsidian activation, disk I/O, DOM paint, write, CPU, or heap acceptance.",
    "History fixtures qualify CLOCK-count scaling only, not every reference or boundary vault dimension.",
    "Event-loop gaps include Node and operating-system scheduling. A failed sample is retained; this run never retries it into acceptance.",
    "No accepted exact-commit performance baseline is supplied. The 20 percent regression rule is not evaluated.",
    "This runner does not control other processes or native-host jobs. Record background load when interpreting wall-time gaps.",
  ],
  measurements: [], assertions: [], failures: [],
};
function check(id, condition, actual) {
  report.assertions.push({ id, passed: Boolean(condition), actual });
  if (!condition) report.failures.push({ id, actual });
}
function statistics(samples) {
  assert(samples.length > 0 && samples.every((value) => Number.isFinite(value) && value >= 0));
  const sorted = [...samples].sort((left, right) => left - right);
  return { count: samples.length, p50Ms: sorted[Math.ceil(sorted.length * 0.5) - 1],
    p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1], maxMs: sorted.at(-1) };
}
function git(args) {
  return execFileSync("git", ["-C", sourceRoot, ...args], { encoding: "utf8" }).trim();
}
async function compileSource() {
  const { build, version } = createRequire(path.join(sourceRoot, "package.json"))("esbuild");
  const packageJson = JSON.parse(await readFile(path.join(sourceRoot, "package.json"), "utf8"));
  assert.equal(version, packageJson.devDependencies.esbuild, "Use the source checkout's pinned esbuild version");
  report.environment.esbuild = version;
  const inputs = new Map();
  const result = await build({
    absWorkingDir: sourceRoot, stdin: { contents: [
      'export { schedulePlan } from "./src/core/scheduler.ts";',
      'export { HistoryIndex } from "./src/workspace/history-index.ts";',
      'export { formatCanonicalClosedClock, formatCanonicalRunningClock } from "./src/workspace/logbook-clock.ts";',
    ].join("\n"), resolveDir: sourceRoot, sourcefile: "performance-entry.mjs" },
    bundle: true, format: "esm", platform: "node", target: "node24", write: false, logLevel: "silent",
    plugins: [{ name: "record-executed-source", setup(builder) {
      builder.onLoad({ filter: /\.ts$/ }, async ({ path: absolute }) => {
        const bytes = await readFile(absolute);
        inputs.set(path.relative(sourceRoot, absolute).split(path.sep).join("/"), { sha256: sha256(bytes), bytes: bytes.length });
        return { contents: bytes.toString("utf8"), loader: "ts" };
      });
    } }],
  });
  assert.equal(result.outputFiles.length, 1);
  const bundle = result.outputFiles[0].contents;
  const bundlePath = path.join(outputRoot, "executed-source.mjs");
  await writeFile(bundlePath, bundle);
  report.source = { gitHead: git(["rev-parse", "HEAD"]), gitStatus: git(["status", "--porcelain=v1"]),
    files: [...inputs].sort(([left], [right]) => left.localeCompare(right)).map(([file, detail]) => ({ path: file, ...detail })),
    executedBundle: { path: "executed-source.mjs", sha256: sha256(bundle), bytes: bundle.length } };
  report.source.sourceFilesSha256 = jsonHash(report.source.files);
  report.observedPluginAssets = [];
  for (const asset of ["main.js", "manifest.json", "styles.css"]) {
    try {
      const bytes = await readFile(path.join(sourceRoot, asset));
      report.observedPluginAssets.push({ path: asset, sha256: sha256(bytes), bytes: bytes.length });
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      report.observedPluginAssets.push({ path: asset, missing: true });
    }
  }
  report.pluginAssetBinding = "Observed separately. The hashed ESM source probe is executed; these plugin package assets are not executed or claimed equivalent.";
  await writeFile(path.join(outputRoot, "fixture-generator.mjs"), await readFile(path.join(runnerRoot, "benchmarks/fixtures.mjs")));
  report.runnerFiles = await Promise.all(["tests/performance/run.mjs", "benchmarks/fixtures.mjs"].map(async (file) => {
    const bytes = await readFile(path.join(runnerRoot, file));
    return { path: file, sha256: sha256(bytes) };
  }));
  return import(pathToFileURL(bundlePath).href);
}
async function measuredHistory(production, fixture, cancelFromTimer = false) {
  let reads = 0;
  const listeners = new Set();
  const access = {
    async listMarkdownPaths() { return [...fixture.files.keys()]; },
    async readText(file) { reads += 1; return fixture.files.get(file); },
    onChange(listener) { listeners.add(listener); return () => listeners.delete(listener); },
  };
  const controller = new AbortController();
  const schedulerSlicesMs = [];
  const slowSchedulerSlices = [];
  const eventLoopGapsMs = [];
  let sliceStart;
  const scheduler = {
    now() { const now = performance.now(); sliceStart ??= now; return now; },
    async yield() {
      const durationMs = performance.now() - sliceStart;
      schedulerSlicesMs.push(durationMs);
      if (durationMs > 50 && slowSchedulerSlices.length < 3) {
        slowSchedulerSlices.push({ durationMs, stack: new Error("History scheduler slice exceeded 50 ms").stack });
      }
      await new Promise((resolve) => setTimeout(resolve, 0));
      sliceStart = performance.now();
    },
  };
  const index = new production.HistoryIndex(access, { scheduler });
  const publications = [];
  const unsubscribe = index.subscribe((snapshot) => publications.push(snapshot.state));
  let lastTurn = performance.now();
  const timer = setInterval(() => {
    const now = performance.now();
    eventLoopGapsMs.push(now - lastTurn);
    lastTurn = now;
  }, 1);
  let abortedAt;
  const started = performance.now();
  const abortTimer = cancelFromTimer ? setTimeout(() => {
    abortedAt = performance.now();
    controller.abort();
  }, 0) : undefined;
  try {
    const snapshot = await index.rebuild({ configuration: fixture.configuration, signal: controller.signal });
    const ended = performance.now();
    eventLoopGapsMs.push(ended - lastTurn);
    clearInterval(timer);
    if (abortTimer !== undefined) clearTimeout(abortTimer);
    const result = { elapsedMs: ended - started, schedulerSlicesMs, slowSchedulerSlices, eventLoopGapsMs, reads,
      state: snapshot.state, counts: snapshot.counts, outputSha256: jsonHash(snapshot),
      abortedAfterMs: abortedAt === undefined ? null : abortedAt - started,
      cancellationSettlementMs: abortedAt === undefined ? null : ended - abortedAt,
      ...(snapshot.state === "unavailable" ? { reason: snapshot.reason } : {}),
      partialTasksPublished: "tasks" in snapshot && snapshot.state !== "current" };
    unsubscribe();
    index.dispose();
    const settledReads = reads;
    await new Promise((resolve) => setTimeout(resolve, 0));
    result.postDisposeReads = reads - settledReads;
    result.retainedSubscriptions = listeners.size;
    result.publications = publications;
    return result;
  } finally {
    clearInterval(timer);
    if (abortTimer !== undefined) clearTimeout(abortTimer);
    unsubscribe();
    index.dispose();
  }
}
try {
  const production = await compileSource();
  for (const { count, p95LimitMs } of [{ count: 250, p95LimitMs: 10 }, { count: 1_000, p95LimitMs: 50 }]) {
    const fixture = schedulerFixture(count);
    const fixtureSha256 = jsonHash(fixture);
    await persist(`scheduler-${count}-fixture.json`, fixture);
    let warmupOutput;
    for (let warmup = 0; warmup < 10; warmup += 1) warmupOutput = production.schedulePlan(fixture);
    const expectedHash = jsonHash(warmupOutput);
    const samplesMs = [];
    const outputHashes = new Set();
    for (let sample = 0; sample < 100; sample += 1) {
      const started = performance.now();
      const output = production.schedulePlan(fixture);
      samplesMs.push(performance.now() - started);
      outputHashes.add(jsonHash(output));
    }
    const metrics = statistics(samplesMs);
    const measurement = { id: `scheduler-${count}`, warmups: 10, fixtureSha256,
      dimensions: { planItems: count }, samplesMs, ...metrics,
      outputSha256: expectedHash, distinctOutputHashes: outputHashes.size,
      budgets: { p95LimitMs, hardCapMs: 100 } };
    report.measurements.push(measurement);
    check(`${measurement.id}-deterministic`, outputHashes.size === 1 && outputHashes.has(expectedHash), [...outputHashes]);
    check(`${measurement.id}-fixture-unchanged`, jsonHash(fixture) === fixtureSha256, fixtureSha256);
    check(`${measurement.id}-p95`, metrics.p95Ms <= p95LimitMs, metrics.p95Ms);
    check(`${measurement.id}-hard-cap`, metrics.maxMs <= 100, metrics.maxMs);
    console.log(`${measurement.id}: p95 ${metrics.p95Ms.toFixed(3)} ms, max ${metrics.maxMs.toFixed(3)} ms`);
    await persist("report.json", report);
  }
  for (const { count, p95LimitMs } of [{ count: 5_000, p95LimitMs: 1_500 }, { count: 25_000, p95LimitMs: 5_000 }]) {
    const fixture = historyFixture(count, production.formatCanonicalClosedClock, production.formatCanonicalRunningClock);
    const fixtureFiles = [...fixture.files].map(([file, text]) => ({ path: file, bytes: Buffer.byteLength(text), sha256: sha256(text) }));
    const fixtureSha256 = jsonHash(fixtureFiles);
    await persist(`history-${count}-fixture.json`, { dimensions: fixture.dimensions, files: fixtureFiles, fixtureSha256 });
    const measurement = { id: `history-${count}`, warmups: 5, fixtureSha256,
      dimensions: fixture.dimensions, samples: [], warmupSamples: [],
      budgets: { p95LimitMs, hardCapMs: 10_000, cooperativeYieldLimitMs: 50 } };
    report.measurements.push(measurement);
    for (let sample = -5; sample < 30; sample += 1) {
      const observed = await measuredHistory(production, fixture);
      (sample < 0 ? measurement.warmupSamples : measurement.samples).push(observed);
      check(`${measurement.id}-${sample}-complete`, observed.state === "current"
        && observed.counts.clockRecords === count && observed.counts.tasks === fixture.taskCount, { state: observed.state, counts: observed.counts });
      check(`${measurement.id}-${sample}-teardown`, observed.retainedSubscriptions === 0 && observed.postDisposeReads === 0, observed.retainedSubscriptions);
      await persist("report.json", report);
      if (sample === -1 || sample % 5 === 4) console.log(`${measurement.id}: ${sample < 0 ? "warm-ups complete" : `${sample + 1}/30 samples`}, last ${observed.elapsedMs.toFixed(1)} ms`);
    }
    Object.assign(measurement, statistics(measurement.samples.map((sample) => sample.elapsedMs)));
    measurement.maxSchedulerSliceMs = Math.max(0, ...measurement.samples.flatMap((sample) => sample.schedulerSlicesMs));
    measurement.maxEventLoopGapMs = Math.max(0, ...measurement.samples.flatMap((sample) => sample.eventLoopGapsMs));
    const outputHashes = new Set(measurement.samples.map((sample) => sample.outputSha256));
    measurement.distinctOutputHashes = outputHashes.size;
    check(`${measurement.id}-deterministic`, outputHashes.size === 1, [...outputHashes]);
    check(`${measurement.id}-p95`, measurement.p95Ms <= p95LimitMs, measurement.p95Ms);
    check(`${measurement.id}-hard-cap`, measurement.maxMs <= 10_000, measurement.maxMs);
    check(`${measurement.id}-history-scheduler-yield`, measurement.maxSchedulerSliceMs <= 50, measurement.maxSchedulerSliceMs);
    check(`${measurement.id}-event-loop-gap`, measurement.maxEventLoopGapMs <= 50, measurement.maxEventLoopGapMs);
    const cancellation = await measuredHistory(production, fixture, true);
    measurement.cancellation = cancellation;
    check(`${measurement.id}-cancellation`, cancellation.state === "unavailable" && cancellation.reason === "cancelled"
      && cancellation.abortedAfterMs !== null && !cancellation.partialTasksPublished && !cancellation.publications.includes("current"), cancellation);
    check(`${measurement.id}-cancellation-teardown`, cancellation.retainedSubscriptions === 0 && cancellation.postDisposeReads === 0, cancellation);
    console.log(`${measurement.id}: p95 ${measurement.p95Ms.toFixed(1)} ms, max scheduler slice ${measurement.maxSchedulerSliceMs.toFixed(1)} ms, max event-loop gap ${measurement.maxEventLoopGapMs.toFixed(1)} ms`);
    await persist("report.json", report);
  }
} catch (error) {
  report.failures.push({ id: "runner-error", message: error.message, stack: error.stack });
} finally {
  report.endedAt = new Date().toISOString();
  report.result = report.failures.length === 0 ? "PASS" : "FAIL";
  await persist("report.json", report);
  console.log(`${report.result}: ${path.join(outputRoot, "report.json")}`);
  if (report.result !== "PASS") process.exitCode = 1;
}
