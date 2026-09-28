import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const runner = path.join(repo, "scripts", "factory", "run.mjs");

const STATES = ["ready", "claimed", "implemented", "verifying", "verified", "delivered", "failed", "blocked", "cancelled"];

function makeItem(overrides = {}) {
  return {
    id: "IT-001",
    title: "probe item",
    kind: "code-change",
    priority: 1,
    state: "ready",
    attempts: 0,
    max_attempts: 2,
    module_boundary: ["src/"],
    allow_empty_diff: false,
    implementation: "create src/ok.txt",
    acceptance_criteria: [
      { id: "AC1", description: "file exists", check: { type: "file-exists", path: "src/ok.txt" } },
    ],
    verify: [],
    ...overrides,
  };
}

function sandbox(items, { git = false } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "factory-test-"));
  mkdirSync(path.join(dir, "factory"), { recursive: true });
  writeFileSync(
    path.join(dir, "factory", "backlog.json"),
    `${JSON.stringify({ schema_version: 1, states: STATES, transitions: {}, items }, null, 2)}\n`,
  );
  if (git) {
    run(dir, "git", ["init", "-q"]);
    run(dir, "git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init", "--allow-empty"]);
  }
  return {
    dir,
    run: (...args) => {
      const extra = typeof args.at(-1) === "object" && args.at(-1) !== null ? args.pop() : {};
      return spawnSync(process.execPath, [runner, "--root", dir, ...args], { encoding: "utf8", ...extra });
    },
    backlog: () => JSON.parse(readFileSync(path.join(dir, "factory", "backlog.json"), "utf8")),
    item: (id) => JSON.parse(readFileSync(path.join(dir, "factory", "backlog.json"), "utf8")).items.find((i) => i.id === id),
    progress: () => readFileSync(path.join(dir, ".codex", "runtime", "devin-factory", "progress.jsonl"), "utf8").trim().split("\n").map(JSON.parse),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

function run(cwd, cmd, args) {
  const result = spawnSync(cmd, args, { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, `${cmd} ${args.join(" ")}: ${result.stderr}`);
}

function ok(result, context) {
  assert.equal(result.status, 0, `${context}: ${result.stderr || result.stdout}`);
}

function fails(result, context) {
  assert.notEqual(result.status, 0, `${context}: unexpectedly succeeded`);
}

test("repository backlog parses and items are well formed", () => {
  const backlog = JSON.parse(readFileSync(path.join(repo, "factory", "backlog.json"), "utf8"));
  assert.equal(backlog.schema_version, 1);
  const delivered = backlog.states.indexOf("delivered");
  const ready = backlog.states.indexOf("ready");
  assert(ready < delivered, "ready must precede delivered in ordered states");
  assert(new Set(backlog.items.map((i) => i.id)).size === backlog.items.length, "item ids unique");
  for (const item of backlog.items) {
    assert(backlog.states.includes(item.state), `${item.id} unknown state`);
    assert(item.acceptance_criteria.length > 0, `${item.id} needs acceptance criteria`);
    assert(/^FAC-\d+$/.test(item.id), `${item.id} uses FAC-NNN`);
  }
});

test("list and next are read-only and next picks lowest priority", () => {
  const box = sandbox([
    makeItem({ id: "IT-100", priority: 50 }),
    makeItem({ id: "IT-101", priority: 5 }),
  ]);
  try {
    const listed = box.run("list", "--json");
    ok(listed, "list");
    assert.equal(JSON.parse(listed.stdout).length, 2);
    const next = box.run("next");
    ok(next, "next");
    assert.equal(JSON.parse(next.stdout).id, "IT-101");
    assert.equal(box.item("IT-101").state, "ready", "next must not mutate state");
  } finally {
    box.cleanup();
  }
});

test("ordered states reject out-of-order transitions", () => {
  const box = sandbox([makeItem()]);
  try {
    fails(box.run("verify", "IT-001"), "verify before implemented must fail");
    fails(box.run("deliver", "IT-001"), "deliver before verified must fail");
    ok(box.run("claim", "IT-001"), "claim");
    fails(box.run("claim", "IT-001"), "double claim must fail");
    fails(box.run("deliver", "IT-001"), "deliver from claimed must fail");
    assert.equal(box.item("IT-001").state, "claimed");
    assert.equal(box.item("IT-001").attempts, 1);
  } finally {
    box.cleanup();
  }
});

test("verify failure marks item failed and never records success", () => {
  const box = sandbox([makeItem({
    acceptance_criteria: [
      { id: "AC1", description: "fails", check: { type: "command", command: "exit 7" } },
      { id: "AC2", description: "never reached", check: { type: "command", command: "exit 0" } },
    ],
    verify: ["exit 0"],
  })]);
  try {
    ok(box.run("claim", "IT-001"), "claim");
    ok(box.run("implemented", "IT-001"), "implemented");
    const verified = box.run("verify", "IT-001");
    fails(verified, "verify must propagate failing check");
    assert.equal(box.item("IT-001").state, "failed");
    const rows = box.progress();
    const checks = rows.filter((row) => row.event === "check");
    assert.equal(checks.length, 2, "both acceptance checks ran");
    assert(checks.some((row) => row.ok === false), "a failing check row exists");
    assert(!rows.some((row) => row.event === "verify-end" && row.ok === true), "no success recorded");
    assert(!rows.some((row) => row.event === "verify-command"), "verify commands skipped after acceptance failure");
    fails(box.run("deliver", "IT-001"), "failed item cannot deliver");
  } finally {
    box.cleanup();
  }
});

test("retry consumes attempts and rejects claim past max_attempts", () => {
  const box = sandbox([makeItem({
    max_attempts: 2,
    allow_empty_diff: true,
    acceptance_criteria: [{ id: "AC1", description: "fails", check: { type: "command", command: "exit 1" } }],
  })]);
  try {
    ok(box.run("claim", "IT-001"), "claim 1");
    ok(box.run("implemented", "IT-001"), "implemented 1");
    fails(box.run("verify", "IT-001"), "verify 1");
    fails(box.run("claim", "IT-001"), "claim after failure without --retry");
    ok(box.run("claim", "IT-001", "--retry"), "claim --retry");
    assert.equal(box.item("IT-001").attempts, 2);
    ok(box.run("implemented", "IT-001"), "implemented 2");
    fails(box.run("verify", "IT-001"), "verify 2");
    fails(box.run("claim", "IT-001", "--retry"), "retry exhausted at max_attempts");
    assert.equal(box.item("IT-001").state, "failed");
  } finally {
    box.cleanup();
  }
});

test("deliver is idempotent and produces a reviewable bundle", () => {
  const box = sandbox([makeItem({ allow_empty_diff: true, verify: ["exit 0"] })]);
  try {
    ok(box.run("claim", "IT-001"), "claim");
    mkdirSync(path.join(box.dir, "src"), { recursive: true });
    writeFileSync(path.join(box.dir, "src", "ok.txt"), "ok\n");
    ok(box.run("implemented", "IT-001"), "implemented");
    ok(box.run("verify", "IT-001"), "verify");
    ok(box.run("deliver", "IT-001"), "deliver");
    const bundle = path.join(box.dir, ".codex", "runtime", "devin-factory", "deliveries", "IT-001", "attempt-1");
    assert(existsSync(path.join(bundle, "evidence.json")), "evidence.json written");
    assert(existsSync(path.join(bundle, "summary.md")), "summary.md written");
    assert(existsSync(path.join(bundle, "change.patch")), "change.patch written");
    const evidence = JSON.parse(readFileSync(path.join(bundle, "evidence.json"), "utf8"));
    assert(Array.isArray(evidence.checks), "evidence.json embeds check results");
    assert.equal(evidence.checks.length, 2, "one acceptance check + one verify command");
    assert(evidence.checks.every((row) => row.ok === true), "all recorded checks passed");
    assert.equal(evidence.checks[0].criterion, "AC1");
    assert.match(
      readFileSync(path.join(bundle, "summary.md"), "utf8"),
      /PASS AC1/, "summary.md lists per-check results");
    assert(existsSync(path.join(bundle, "bundle.json")), "bundle.json captures diff paths");
    const itemLogPath = path.join(box.dir, ".codex", "runtime", "devin-factory", "items", "IT-001.jsonl");
    const logAtDelivery = readFileSync(itemLogPath).subarray(0, evidence.item_log_bytes);
    assert.equal(
      createHash("sha256").update(logAtDelivery).digest("hex"),
      evidence.item_log_sha256, "item_log_sha256 binds the delivered attempt log prefix");

    rmSync(path.join(bundle, "evidence.json"));
    const rebuilt = box.run("deliver", "IT-001");
    ok(rebuilt, "deliver rebuilds evidence lost to a mid-deliver crash");
    assert.match(rebuilt.stdout, /rebuilt missing evidence/);
    assert(existsSync(path.join(bundle, "evidence.json")), "evidence.json rebuilt");
    assert.deepEqual(
      JSON.parse(readFileSync(path.join(bundle, "evidence.json"), "utf8")).diff_paths,
      evidence.diff_paths, "rebuilt evidence restores bundle.json's captured paths");

    const before = readFileSync(path.join(bundle, "evidence.json"), "utf8");
    const again = box.run("deliver", "IT-001");
    ok(again, "re-deliver is an idempotent no-op");
    assert.match(again.stdout, /already delivered/);
    assert.equal(readFileSync(path.join(bundle, "evidence.json"), "utf8"), before, "bundle unchanged");
    fails(box.run("verify", "IT-001"), "delivered item is terminal");
    fails(box.run("claim", "IT-001"), "delivered item cannot be claimed");
  } finally {
    box.cleanup();
  }
});

test("implemented enforces module_boundary against the real git diff", () => {
  const box = sandbox([makeItem({ module_boundary: ["src/"] })], { git: true });
  try {
    ok(box.run("claim", "IT-001"), "claim");
    mkdirSync(path.join(box.dir, "other"), { recursive: true });
    writeFileSync(path.join(box.dir, "other", "escape.txt"), "x\n");
    const escaped = box.run("implemented", "IT-001");
    fails(escaped, "diff outside boundary must fail");
    assert.match(escaped.stderr + escaped.stdout, /escapes module_boundary/);
    assert.equal(box.item("IT-001").state, "claimed", "state unchanged on boundary rejection");
    rmSync(path.join(box.dir, "other"), { recursive: true });
    mkdirSync(path.join(box.dir, "src"), { recursive: true });
    writeFileSync(path.join(box.dir, "src", "ok.txt"), "ok\n");
    ok(box.run("implemented", "IT-001"), "boundary-conformant diff accepted");
    assert.equal(box.item("IT-001").state, "implemented");
  } finally {
    box.cleanup();
  }
});

test("empty diff requires allow_empty_diff", () => {
  const strict = sandbox([makeItem({ allow_empty_diff: false })], { git: true });
  try {
    ok(strict.run("claim", "IT-001"), "claim");
    fails(strict.run("implemented", "IT-001"), "empty diff rejected when not allowed");
  } finally {
    strict.cleanup();
  }
  const lax = sandbox([makeItem({ allow_empty_diff: true, kind: "verification" })], { git: true });
  try {
    ok(lax.run("claim", "IT-001"), "claim");
    ok(lax.run("implemented", "IT-001"), "empty diff accepted for verification item");
  } finally {
    lax.cleanup();
  }
});

test("release, block, unblock, cancel, and record recover item control", () => {
  const box = sandbox([makeItem({ id: "IT-001" }), makeItem({ id: "IT-002", priority: 2 }), makeItem({ id: "IT-003", priority: 3 })]);
  try {
    ok(box.run("claim", "IT-001"), "claim");
    ok(box.run("release", "IT-001"), "release returns to ready");
    assert.equal(box.item("IT-001").state, "ready");
    ok(box.run("block", "IT-002"), "block");
    ok(box.run("unblock", "IT-002"), "unblock");
    assert.equal(box.item("IT-002").state, "ready");
    ok(box.run("cancel", "IT-003", "--reason", "not-needed"), "cancel");
    assert.equal(box.item("IT-003").state, "cancelled");
    ok(box.run("record", "IT-001", "--note", "checkpointed as abc123"), "record");
    const notes = box.progress().filter((row) => row.event === "note");
    assert.equal(notes.at(-1).note, "checkpointed as abc123");
  } finally {
    box.cleanup();
  }
});

test("status.md and progress.jsonl are maintained", () => {
  const box = sandbox([makeItem()]);
  try {
    ok(box.run("claim", "IT-001"), "claim");
    const status = readFileSync(path.join(box.dir, ".codex", "runtime", "devin-factory", "status.md"), "utf8");
    assert.match(status, /IT-001.*claimed/s, "status.md reflects current state");
    assert.match(status, /## Recent events/, "status.md renders the JSONL tail");
    assert.match(status, /ready->claimed/, "transition rendered from progress rows");
    const rendered = box.run("status");
    ok(rendered, "status");
    assert.match(rendered.stdout, /recent:/, "console status prints recent events");
    const rows = box.progress();
    assert(rows.every((row) => row.ts && row.event && row.item), "progress rows carry ts/event/item");
  } finally {
    box.cleanup();
  }
});

test("add appends a validated ready item and rejects malformed payloads", () => {
  const box = sandbox([makeItem()]);
  try {
    const spec = {
      id: "IT-009", title: "added via CLI", kind: "verification", priority: 9,
      implementation: "run a lane", allow_empty_diff: true,
      acceptance_criteria: [{ id: "AC1", description: "passes", check: { type: "command", command: "exit 0" } }],
    };
    const file = path.join(box.dir, "item.json");
    writeFileSync(file, JSON.stringify(spec));
    ok(box.run("add", "--file", file), "add --file");
    const added = box.item("IT-009");
    assert.equal(added.state, "ready");
    assert.equal(added.attempts, 0);
    assert.equal(added.max_attempts, 3, "default retry budget");
    assert.deepEqual(added.module_boundary, []);
    assert(box.progress().some((row) => row.event === "added" && row.item === "IT-009"), "added event recorded");

    const duplicate = box.run("add", "--file", file);
    fails(duplicate, "duplicate id rejected");
    assert.match(duplicate.stderr + duplicate.stdout, /duplicate/);

    const stdin = box.run("add", "--file", "-", {
      input: JSON.stringify({ ...spec, id: "IT-010", state: "delivered" }),
    });
    fails(stdin, "a non-ready state must not bypass the pipeline");

    writeFileSync(path.join(box.dir, "bad.json"), JSON.stringify({ id: "IT-011", title: "no criteria" }));
    fails(box.run("add", "--file", path.join(box.dir, "bad.json")), "missing acceptance_criteria rejected");
    assert.equal(box.item("IT-011"), undefined, "rejected item not persisted");
    assert.equal(box.item("IT-009").state, "ready", "existing items untouched by failed adds");
  } finally {
    box.cleanup();
  }
});

test("deliver rejects stale verification after contract or source drift", () => {
  const box = sandbox([makeItem({
    allow_empty_diff: true,
    acceptance_criteria: [
      { id: "AC1", description: "flag says pass", check: { type: "command", command: "grep -q ^pass$ src/flag.txt" } },
    ],
  })], { git: true });
  try {
    mkdirSync(path.join(box.dir, "src"), { recursive: true });
    writeFileSync(path.join(box.dir, "src", "flag.txt"), "pass\n");
    ok(box.run("claim", "IT-001"), "claim");
    ok(box.run("implemented", "IT-001"), "implemented");
    ok(box.run("verify", "IT-001"), "verify");

    writeFileSync(path.join(box.dir, "src", "flag.txt"), "fail\n");
    const staleSource = box.run("deliver", "IT-001");
    fails(staleSource, "deliver must reject tested-source drift after verify");
    assert.match(staleSource.stderr + staleSource.stdout, /stale/);
    assert.equal(box.item("IT-001").state, "verified", "item stays verified");

    writeFileSync(path.join(box.dir, "src", "flag.txt"), "pass\n");
    const backlogFile = path.join(box.dir, "factory", "backlog.json");
    const drifted = JSON.parse(readFileSync(backlogFile, "utf8"));
    drifted.items[0].acceptance_criteria[0].check.command = "grep -q ^pass$ src/flag.txt && false";
    writeFileSync(backlogFile, `${JSON.stringify(drifted, null, 2)}\n`);
    const staleContract = box.run("deliver", "IT-001");
    fails(staleContract, "deliver must reject acceptance-contract drift after verify");
    assert.match(staleContract.stderr + staleContract.stdout, /stale/);

    drifted.items[0].acceptance_criteria[0].check.command = "grep -q ^pass$ src/flag.txt";
    writeFileSync(backlogFile, `${JSON.stringify(drifted, null, 2)}\n`);
    ok(box.run("verify", "IT-001"), "reverify recovers after drift is reverted");
    ok(box.run("deliver", "IT-001"), "deliver after clean reverify");
    assert.equal(box.item("IT-001").state, "delivered");
  } finally {
    box.cleanup();
  }
});

test("status surfaces stale verification on verified items", () => {
  const box = sandbox([makeItem({ allow_empty_diff: true })], { git: true });
  try {
    mkdirSync(path.join(box.dir, "src"), { recursive: true });
    writeFileSync(path.join(box.dir, "src", "ok.txt"), "ok\n");
    ok(box.run("claim", "IT-001"), "claim");
    ok(box.run("implemented", "IT-001"), "implemented");
    ok(box.run("verify", "IT-001"), "verify");
    writeFileSync(path.join(box.dir, "src", "ok.txt"), "changed\n");
    const rendered = box.run("status");
    ok(rendered, "status");
    assert.match(rendered.stdout, /IT-001\s+STALE: worktree changed/, "console flags stale stamp");
    const status = readFileSync(path.join(box.dir, ".codex", "runtime", "devin-factory", "status.md"), "utf8");
    assert.match(status, /STALE: worktree changed/, "status.md flags stale stamp");
    writeFileSync(path.join(box.dir, "src", "ok.txt"), "ok\n");
    const clean = box.run("status");
    ok(clean, "status after revert");
    assert.doesNotMatch(clean.stdout, /STALE/, "restored worktree clears the flag");
  } finally {
    box.cleanup();
  }
});

test("stale detection also applies without git (worktree fingerprint walk)", () => {
  const box = sandbox([makeItem({ allow_empty_diff: true })]);
  try {
    mkdirSync(path.join(box.dir, "src"), { recursive: true });
    writeFileSync(path.join(box.dir, "src", "ok.txt"), "ok\n");
    ok(box.run("claim", "IT-001"), "claim");
    ok(box.run("implemented", "IT-001"), "implemented");
    ok(box.run("verify", "IT-001"), "verify");
    writeFileSync(path.join(box.dir, "src", "ok.txt"), "changed\n");
    const stale = box.run("deliver", "IT-001");
    fails(stale, "no-git deliver must reject worktree drift after verify");
    assert.match(stale.stderr + stale.stdout, /stale/);
    writeFileSync(path.join(box.dir, "src", "ok.txt"), "ok\n");
    ok(box.run("deliver", "IT-001"), "restored worktree delivers without reverify");
    assert.equal(box.item("IT-001").state, "delivered");
  } finally {
    box.cleanup();
  }
});

test("verify resumes an item left in verifying state", () => {
  const box = sandbox([makeItem({ allow_empty_diff: true })], { git: true });
  try {
    mkdirSync(path.join(box.dir, "src"), { recursive: true });
    writeFileSync(path.join(box.dir, "src", "ok.txt"), "ok\n");
    ok(box.run("claim", "IT-001"), "claim");
    ok(box.run("implemented", "IT-001"), "implemented");
    const backlogFile = path.join(box.dir, "factory", "backlog.json");
    const crashed = JSON.parse(readFileSync(backlogFile, "utf8"));
    crashed.items[0].state = "verifying";
    writeFileSync(backlogFile, `${JSON.stringify(crashed, null, 2)}\n`);
    ok(box.run("verify", "IT-001"), "verify after mid-verify crash resumes");
    assert.equal(box.item("IT-001").state, "verified");
    assert(box.progress().some((row) => row.event === "verify-start" && row.item === "IT-001"),
      "resumed verify recorded");
  } finally {
    box.cleanup();
  }
});

test("backlog transitions drift fails closed", () => {
  const box = sandbox([makeItem()], { git: false });
  try {
    const backlogFile = path.join(box.dir, "factory", "backlog.json");
    const tampered = JSON.parse(readFileSync(backlogFile, "utf8"));
    tampered.transitions = { release: ["delivered"] };
    writeFileSync(backlogFile, `${JSON.stringify(tampered, null, 2)}\n`);
    const widened = box.run("list");
    fails(widened, "a widened release gate must not load");
    assert.match(widened.stderr + widened.stdout, /transitions\.release diverges/);

    tampered.transitions = { sneak: ["ready"] };
    writeFileSync(backlogFile, `${JSON.stringify(tampered, null, 2)}\n`);
    const unknown = box.run("list");
    fails(unknown, "an unknown transition key must not load");
    assert.match(unknown.stderr + unknown.stdout, /unknown transition/);

    delete tampered.transitions;
    writeFileSync(backlogFile, `${JSON.stringify(tampered, null, 2)}\n`);
    ok(box.run("list"), "a missing transitions map still loads");
  } finally {
    box.cleanup();
  }
});

test("malformed or escaping check payloads are rejected at load", () => {
  const escaping = sandbox([makeItem({
    acceptance_criteria: [
      { id: "AC1", description: "escape", check: { type: "file-exists", path: "../../outside.txt" } },
    ],
  })]);
  try {
    const result = escaping.run("list");
    fails(result, "check path escaping the worktree must not load");
    assert.match(result.stderr + result.stdout, /escapes the worktree/);
  } finally {
    escaping.cleanup();
  }
  const noField = sandbox([makeItem({
    acceptance_criteria: [
      { id: "AC1", description: "no field", check: { type: "json-field", path: "src/report.json" } },
    ],
  })]);
  try {
    fails(noField.run("list"), "json-field without field must not load");
  } finally {
    noField.cleanup();
  }
  const noCommand = sandbox([makeItem({
    acceptance_criteria: [
      { id: "AC1", description: "empty", check: { type: "command" } },
    ],
  })]);
  try {
    fails(noCommand.run("list"), "command check without command must not load");
  } finally {
    noCommand.cleanup();
  }
  for (const [label, field] of [
    ["non-integer priority", { priority: "high" }],
    ["empty module boundary entry", { module_boundary: ["src/", ""] }],
    ["non-string verify entry", { verify: [42] }],
    ["empty title", { title: "  " }],
    ["non-string kind", { kind: 7 }],
    ["missing implementation", { implementation: undefined }],
    ["non-boolean allow_empty_diff", { allow_empty_diff: "yes" }],
  ]) {
    const bad = sandbox([makeItem(field)]);
    try {
      fails(bad.run("list"), `${label} must not load`);
    } finally {
      bad.cleanup();
    }
  }
});

test("delivery evidence embeds only the latest verify run's checks", () => {
  const box = sandbox([makeItem({ allow_empty_diff: true, verify: ["exit 0"] })], { git: true });
  try {
    mkdirSync(path.join(box.dir, "src"), { recursive: true });
    writeFileSync(path.join(box.dir, "src", "ok.txt"), "ok\n");
    ok(box.run("claim", "IT-001"), "claim");
    ok(box.run("implemented", "IT-001"), "implemented");
    ok(box.run("verify", "IT-001"), "first verify");
    ok(box.run("verify", "IT-001"), "re-verify on verified state");
    ok(box.run("deliver", "IT-001"), "deliver");
    const bundle = path.join(box.dir, ".codex", "runtime", "devin-factory", "deliveries", "IT-001", "attempt-1");
    const evidence = JSON.parse(readFileSync(path.join(bundle, "evidence.json"), "utf8"));
    assert.equal(evidence.checks.length, 2,
      "checks must cover only the run that produced the current verification, not earlier runs on the same attempt");
    assert(evidence.checks.every((row) => row.ok === true), "latest run's checks all passed");
  } finally {
    box.cleanup();
  }
});

test("inspect audits a delivery bundle read-only", () => {
  const box = sandbox([makeItem({ allow_empty_diff: true })], { git: true });
  try {
    mkdirSync(path.join(box.dir, "src"), { recursive: true });
    writeFileSync(path.join(box.dir, "src", "ok.txt"), "ok\n");
    ok(box.run("claim", "IT-001"), "claim");
    ok(box.run("implemented", "IT-001"), "implemented");
    ok(box.run("verify", "IT-001"), "verify");
    ok(box.run("deliver", "IT-001"), "deliver");
    const bundle = path.join(box.dir, ".codex", "runtime", "devin-factory", "deliveries", "IT-001", "attempt-1");

    const good = box.run("inspect", "IT-001");
    ok(good, "inspect passes on a complete bundle");
    assert.match(good.stdout, /inspect IT-001: OK/);

    const corrupted = path.join(bundle, "evidence.json");
    const original = readFileSync(corrupted, "utf8");
    writeFileSync(corrupted, original.replace('"item": "IT-001"', '"item": "IT-999"'));
    const tampered = box.run("inspect", "IT-001");
    fails(tampered, "inspect must catch evidence/item mismatch");
    assert.match(tampered.stderr + tampered.stdout, /evidence\.item/);
    writeFileSync(corrupted, original);

    const evidence = JSON.parse(original);
    delete evidence.item_log_bytes;
    writeFileSync(corrupted, JSON.stringify(evidence, null, 2));
    const legacy = box.run("inspect", "IT-001");
    ok(legacy, "bundles that predate item_log_bytes warn but do not fail");
    assert.match(legacy.stderr + legacy.stdout, /predates item_log_bytes/);
    writeFileSync(corrupted, original);

    rmSync(path.join(bundle, "summary.md"));
    const missing = box.run("inspect", "IT-001");
    fails(missing, "inspect must catch a missing bundle file");
    assert.match(missing.stderr + missing.stdout, /missing summary\.md/);
  } finally {
    box.cleanup();
  }
});

test("mutating commands serialize on the runtime lock", () => {
  const box = sandbox([makeItem()]);
  try {
    const lockDir = path.join(box.dir, ".codex", "runtime", "devin-factory");
    mkdirSync(lockDir, { recursive: true });
    const lockPath = path.join(lockDir, "run.lock");

    writeFileSync(lockPath, JSON.stringify({ pid: process.pid, command: "verify", at: new Date().toISOString() }));
    const blocked = box.run("claim", "IT-001");
    fails(blocked, "claim must fail while a live pid holds the lock");
    assert.match(blocked.stderr + blocked.stdout, /factory already running/);
    ok(box.run("list"), "read-only commands do not take the lock");

    const dead = spawnSync(process.execPath, ["-e", ""], { encoding: "utf8" });
    writeFileSync(lockPath, JSON.stringify({ pid: dead.pid, command: "claim", at: "stale" }));
    ok(box.run("claim", "IT-001"), "claim reclaims a stale lock");
    assert(!existsSync(lockPath), "lock released on process exit");
  } finally {
    box.cleanup();
  }
});

test("dry-run exercises the full pipeline in a sandbox", () => {
  const result = spawnSync(process.execPath, [runner, "dry-run"], { cwd: repo, encoding: "utf8" });
  assert.equal(result.status, 0, `dry-run failed: ${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /dry-run: PASS/);
});
