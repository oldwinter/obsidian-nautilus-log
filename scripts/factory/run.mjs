#!/usr/bin/env node
// Spiral Day devin-factory runner.
//
// Drives one work item at a time from factory/backlog.json through the ordered
// states ready -> claimed -> implemented -> verifying -> verified -> delivered.
// Every transition and check result is appended to
// .codex/runtime/devin-factory/progress.jsonl and the per-item log; a failed
// check always marks the item failed and exits nonzero. Volatile evidence
// stays under .codex/ (gitignored); backlog.json holds durable queue state.
//
// Subcommands: list, show, next, claim, implemented, verify, deliver, fail,
// release, block, unblock, cancel, record, status, dry-run.

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  appendFileSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync,
  renameSync, rmSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const { values: opts, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    root: { type: "string", default: repoRoot },
    backlog: { type: "string" },
    note: { type: "string" },
    reason: { type: "string" },
    retry: { type: "boolean", default: false },
    json: { type: "boolean", default: false },
    help: { type: "boolean", default: false },
  },
});

const root = path.resolve(opts.root);
const backlogPath = opts.backlog ? path.resolve(opts.backlog) : path.join(root, "factory", "backlog.json");
const runtimeDir = path.join(root, ".codex", "runtime", "devin-factory");
// The canonical queue file is exempt from module boundaries: every state
// transition rewrites it. `git status -z` collapses fully-untracked dirs to
// "?? dir/", so an ancestor directory of the backlog is exempted as well —
// that only ever covers the queue file's own directory (e.g. "factory/").
function backlogRel() {
  return path.relative(root, backlogPath).split(path.sep).join("/");
}

function selfExempt(file) {
  if (file.startsWith(".codex/")) return true;
  const rel = backlogRel();
  return file === rel || rel.startsWith(file.endsWith("/") ? file : `${file}/`);
}

function fail(message) {
  throw new Error(message);
}

function utc() {
  return new Date().toISOString();
}

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

function writeJsonAtomic(file, value) {
  const tmp = `${file}.tmp-${process.pid}`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(tmp, file);
}

function git(args, { allowFail = false } = {}) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  if (result.status !== 0) {
    if (allowFail) return null;
    fail(`git ${args.join(" ")} failed: ${(result.stderr || result.error?.message || "").trim()}`);
  }
  return result.stdout;
}

function headSha() {
  return git(["rev-parse", "HEAD"], { allowFail: true })?.trim() ?? null;
}

function isGitWorktree() {
  return headSha() !== null;
}

// `git status --porcelain=v1 -z` entries: "XY path\0"; renames/copies emit a
// second raw field holding the source name, which must be consumed, not parsed.
function changedPaths() {
  const raw = git(["status", "--porcelain=v1", "-z"], { allowFail: true });
  if (raw === null) return { available: false, paths: [] };
  const entries = raw.split("\0").filter(Boolean);
  const paths = [];
  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i];
    if (entry.length < 4) continue;
    paths.push(entry.slice(3));
    if (entry[0] === "R" || entry[0] === "C") i += 1;
  }
  return { available: true, paths };
}

function globToRegExp(glob) {
  let out = "^";
  for (let i = 0; i < glob.length; i += 1) {
    const ch = glob[i];
    if (ch === "*") {
      if (glob[i + 1] === "*") {
        out += ".*";
        i += 1;
      } else {
        out += "[^/]*";
      }
    } else {
      out += ch.replace(/[.+^${}()|[\]\\]/, "\\$&");
    }
  }
  return new RegExp(`${out}$`);
}

function boundaryRegexps(item) {
  return (item.module_boundary ?? []).map(globToRegExp);
}

function pathAllowed(file, regexps) {
  return regexps.some((re) => re.test(file));
}

function checkDiffWithinBoundary(item) {
  const { available, paths } = changedPaths();
  if (!available) return { paths: [], skipped: true };
  const relevant = paths.filter((p) => !selfExempt(p));
  const regexps = boundaryRegexps(item);
  const offenders = relevant.filter((p) => !pathAllowed(p, regexps));
  if (offenders.length > 0) {
    fail(`diff escapes module_boundary: ${offenders.join(", ")}`);
  }
  if (relevant.length === 0 && !item.allow_empty_diff) {
    fail("no changes present and item does not allow an empty diff");
  }
  return { paths: relevant, skipped: false };
}

function loadBacklog() {
  assert(existsSync(backlogPath), `backlog missing: ${backlogPath}`);
  const backlog = readJson(backlogPath);
  assert(backlog.schema_version === 1, "backlog schema_version must be 1");
  assert(Array.isArray(backlog.states) && backlog.states.length > 1, "backlog.states must list ordered states");
  assert(Array.isArray(backlog.items), "backlog.items must be an array");
  const ids = new Set();
  for (const item of backlog.items) {
    assert(typeof item.id === "string" && /^[A-Z]+-\d+$/.test(item.id), `bad item id ${item.id}`);
    assert(!ids.has(item.id), `duplicate item id ${item.id}`);
    ids.add(item.id);
    assert(backlog.states.includes(item.state), `${item.id}: unknown state ${item.state}`);
    assert(Array.isArray(item.acceptance_criteria) && item.acceptance_criteria.length > 0,
      `${item.id}: acceptance_criteria required`);
    for (const ac of item.acceptance_criteria) {
      assert(ac.id && ac.description && ac.check?.type, `${item.id}: malformed acceptance criterion`);
      assert(["command", "file-exists", "json-field"].includes(ac.check.type),
        `${item.id}/${ac.id}: unknown check type ${ac.check.type}`);
    }
    assert(Number.isInteger(item.attempts) && item.attempts >= 0, `${item.id}: attempts must be an integer`);
    assert(Number.isInteger(item.max_attempts) && item.max_attempts >= 1, `${item.id}: max_attempts >= 1`);
    assert(Array.isArray(item.module_boundary), `${item.id}: module_boundary must be an array`);
    item.verify ??= [];
    assert(Array.isArray(item.verify), `${item.id}: verify must be an array`);
  }
  return backlog;
}

function saveBacklog(backlog) {
  writeJsonAtomic(backlogPath, backlog);
}

function findItem(backlog, id) {
  const item = backlog.items.find((candidate) => candidate.id === id);
  if (!item) fail(`no backlog item ${id}`);
  return item;
}

function ensureRuntime() {
  for (const dir of [runtimeDir, path.join(runtimeDir, "items"), path.join(runtimeDir, "deliveries"), path.join(runtimeDir, "evidence")]) {
    mkdirSync(dir, { recursive: true });
  }
}

function appendProgress(entry) {
  ensureRuntime();
  const row = { ts: utc(), head: headSha(), ...entry };
  appendFileSync(path.join(runtimeDir, "progress.jsonl"), `${JSON.stringify(row)}\n`);
  if (entry.item) {
    appendFileSync(path.join(runtimeDir, "items", `${entry.item}.jsonl`), `${JSON.stringify(row)}\n`);
  }
  renderStatus();
  return row;
}

function setState(backlog, item, to, event, extra = {}) {
  const from = item.state;
  item.state = to;
  saveBacklog(backlog);
  appendProgress({ event, item: item.id, attempt: item.attempts, from, to, ...extra });
}

function claimAllowed(item, retry) {
  const readyOk = item.state === "ready";
  const retryOk = retry && item.state === "failed" && item.attempts < item.max_attempts;
  return readyOk || retryOk;
}

function runCheckCommand(command, env, timeoutMs) {
  const started = Date.now();
  const result = spawnSync("sh", ["-c", command], {
    cwd: root, env: { ...process.env, ...env }, encoding: "utf8",
    timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024,
  });
  const duration = Date.now() - started;
  const outputTail = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim().slice(-4096);
  return {
    command, exit_code: result.status, signal: result.signal, duration_ms: duration,
    output_tail: outputTail,
    timed_out: result.error?.code === "ETIMEDOUT",
  };
}

function runCheck(check, env) {
  if (check.type === "command") {
    return runCheckCommand(check.command, env, check.timeout_ms ?? 600_000);
  }
  const target = path.resolve(root, check.path ?? "");
  if (check.type === "file-exists") {
    return { check, exit_code: existsSync(target) ? 0 : 1, detail: target };
  }
  if (check.type === "json-field") {
    if (!existsSync(target)) return { check, exit_code: 1, detail: `missing ${check.path}` };
    const data = readJson(target);
    const actual = check.field.split(".").reduce((node, key) => node?.[key], data);
    const ok = String(actual) === String(check.equals);
    return { check, exit_code: ok ? 0 : 1, detail: `${check.field}=${JSON.stringify(actual)} expected ${JSON.stringify(check.equals)}` };
  }
  fail(`unsupported check type ${check.type}`);
}

function commandEnv(item) {
  return {
    FACTORY_ROOT: root,
    FACTORY_ITEM_ID: item.id,
    FACTORY_EVIDENCE_DIR: path.join(runtimeDir, "evidence", item.id, `attempt-${item.attempts}`),
  };
}

function cmdList(backlog) {
  const rows = backlog.items.map((item) => ({
    id: item.id, state: item.state, attempts: item.attempts, priority: item.priority, title: item.title,
  }));
  if (opts.json) {
    console.log(JSON.stringify(rows, null, 2));
    return;
  }
  for (const row of rows) {
    console.log(`${row.id.padEnd(8)} ${row.state.padEnd(11)} a=${row.attempts} p=${String(row.priority).padEnd(3)} ${row.title}`);
  }
}

function cmdShow(backlog, id) {
  console.log(JSON.stringify(findItem(backlog, id), null, 2));
}

function cmdNext(backlog) {
  const candidate = backlog.items
    .filter((item) => item.state === "ready")
    .sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id))[0];
  if (!candidate) {
    console.log("next: no ready items");
    return;
  }
  console.log(JSON.stringify(candidate, null, 2));
}

function cmdClaim(backlog, id) {
  const item = findItem(backlog, id);
  if (!claimAllowed(item, opts.retry)) {
    fail(`${item.id}: cannot claim from state ${item.state} (retry=${opts.retry}, attempts ${item.attempts}/${item.max_attempts})`);
  }
  const from = item.state;
  item.attempts += 1;
  item.claimed_head = headSha();
  item.state = "claimed";
  saveBacklog(backlog);
  appendProgress({ event: "claim", item: item.id, attempt: item.attempts, from, to: "claimed", claimed_head: item.claimed_head });
  console.log(`claimed ${item.id} attempt ${item.attempts} at ${item.claimed_head ?? "no-git"}`);
}

function cmdImplemented(backlog, id) {
  const item = findItem(backlog, id);
  if (!["claimed", "implemented"].includes(item.state)) {
    fail(`${item.id}: cannot mark implemented from state ${item.state}`);
  }
  const diff = checkDiffWithinBoundary(item);
  const event = { event: "implemented", item: item.id, attempt: item.attempts, diff_paths: diff.paths, diff_skipped: diff.skipped };
  if (item.state !== "implemented") setState(backlog, item, "implemented", "implemented", { diff_paths: diff.paths });
  else appendProgress(event);
  console.log(`implemented ${item.id}: ${diff.skipped ? "no git" : `${diff.paths.length} path(s) inside boundary`}`);
}

function cmdVerify(backlog, id) {
  const item = findItem(backlog, id);
  if (!["implemented", "verified", "verifying"].includes(item.state)) {
    fail(`${item.id}: cannot verify from state ${item.state}` +
      (item.state === "failed" ? `; claim --retry first (attempts ${item.attempts}/${item.max_attempts})` : ""));
  }
  if (item.state !== "verifying") {
    item.state = "verifying";
    saveBacklog(backlog);
  }
  appendProgress({ event: "verify-start", item: item.id, attempt: item.attempts });
  const env = commandEnv(item);
  const results = [];
  let ok = true;
  for (const ac of item.acceptance_criteria) {
    const result = runCheck(ac.check, env);
    results.push({ criterion: ac.id, description: ac.description, ...result });
    if (result.exit_code !== 0) ok = false;
    appendProgress({ event: "check", item: item.id, attempt: item.attempts, criterion: ac.id, ok: result.exit_code === 0, ...pickResult(result) });
  }
  if (ok) {
    for (const command of item.verify) {
      const result = runCheckCommand(command, env, 600_000);
      results.push({ verify: command, ...result });
      if (result.exit_code !== 0) ok = false;
      appendProgress({ event: "verify-command", item: item.id, attempt: item.attempts, ok: result.exit_code === 0, ...pickResult(result) });
    }
  }
  const to = ok ? "verified" : "failed";
  item.state = to;
  saveBacklog(backlog);
  appendProgress({ event: "verify-end", item: item.id, attempt: item.attempts, to, ok });
  const failures = results.filter((r) => r.exit_code !== 0);
  for (const failure of failures) {
    console.error(`FAIL ${failure.criterion ?? "verify"}: ${failure.command ?? failure.check?.path}\n${failure.output_tail ?? failure.detail ?? ""}`);
  }
  console.log(`verify ${item.id}: ${ok ? "VERIFIED" : "FAILED"} (${results.length} checks)`);
  if (!ok) process.exitCode = 1;
}

function pickResult(result) {
  return {
    command: result.command ?? result.check?.command ?? result.check?.path,
    exit_code: result.exit_code,
    duration_ms: result.duration_ms,
    output_tail: result.output_tail ?? result.detail,
    timed_out: result.timed_out,
  };
}

function cmdDeliver(backlog, id) {
  const item = findItem(backlog, id);
  if (item.state === "delivered") {
    const existing = path.join(runtimeDir, "deliveries", item.id, `attempt-${item.attempts}`);
    console.log(`deliver ${item.id}: already delivered -> ${existing}`);
    return;
  }
  if (item.state !== "verified") fail(`${item.id}: cannot deliver from state ${item.state}`);
  const dir = path.join(runtimeDir, "deliveries", item.id, `attempt-${item.attempts}`);
  mkdirSync(dir, { recursive: true });
  const { paths } = changedPaths();
  const relevant = (paths ?? []).filter((p) => !selfExempt(p));
  const patch = git(["diff", "HEAD", "--", ...relevant], { allowFail: true }) ?? "";
  writeFileSync(path.join(dir, "change.patch"), patch);
  // Porcelain collapses untracked dirs to "?? dir/"; only single files can be
  // copied into the bundle, so dir-collapse entries are listed, not copied.
  const untracked = relevant.filter((p) => !p.endsWith("/") &&
    git(["status", "--porcelain=v1", "--", p], { allowFail: true })?.startsWith("??"));
  const filesDir = path.join(dir, "files");
  for (const file of untracked) {
    const dest = path.join(filesDir, file);
    mkdirSync(path.dirname(dest), { recursive: true });
    copyFileSync(path.join(root, file), dest);
  }
  const itemLog = path.join(runtimeDir, "items", `${item.id}.jsonl`);
  const evidence = {
    schema_version: 1,
    item: item.id,
    title: item.title,
    kind: item.kind,
    attempt: item.attempts,
    delivered_at: utc(),
    head: headSha(),
    claimed_head: item.claimed_head,
    diff_paths: relevant,
    untracked_files: untracked,
    acceptance_criteria: item.acceptance_criteria.map((ac) => ac.id),
    verify_commands: item.verify,
    item_log_sha256: existsSync(itemLog)
      ? createHash("sha256").update(readFileSync(itemLog)).digest("hex")
      : null,
  };
  writeJsonAtomic(path.join(dir, "evidence.json"), evidence);
  const summary = [
    `# Delivery ${item.id} attempt ${item.attempts}`,
    "",
    `- title: ${item.title}`,
    `- kind: ${item.kind}`,
    `- head: ${evidence.head ?? "no-git"}`,
    `- diff paths: ${relevant.length === 0 ? "none (evidence-only delivery)" : relevant.join(", ")}`,
    `- acceptance criteria: ${evidence.acceptance_criteria.join(", ")}`,
    `- verify commands: ${item.verify.length === 0 ? "none" : item.verify.join(" ; ")}`,
    "",
    "Evidence: change.patch, files/ (untracked copies), evidence.json, per-item JSONL log.",
  ].join("\n");
  writeFileSync(path.join(dir, "summary.md"), `${summary}\n`);
  setState(backlog, item, "delivered", "delivered", { delivery: path.relative(root, dir) });
  console.log(`delivered ${item.id} -> ${dir}`);
}

function cmdFail(backlog, id) {
  const item = findItem(backlog, id);
  if (["delivered", "cancelled"].includes(item.state)) fail(`${item.id}: already ${item.state}`);
  setState(backlog, item, "failed", "failed", { reason: opts.reason ?? "manual" });
  console.log(`failed ${item.id}: ${opts.reason ?? "manual"}`);
}

function cmdTransition(backlog, id, action, fromStates, to) {
  const item = findItem(backlog, id);
  if (!fromStates.includes(item.state)) fail(`${item.id}: cannot ${action} from state ${item.state}`);
  setState(backlog, item, to, action, { reason: opts.reason });
  console.log(`${action} ${item.id}: -> ${to}`);
}

function cmdRecord(backlog, id) {
  const item = findItem(backlog, id);
  appendProgress({ event: "note", item: item.id, attempt: item.attempts, note: opts.note ?? fail("--note required") });
  console.log(`recorded note on ${item.id}`);
}

function renderStatus() {
  if (!existsSync(backlogPath)) return;
  let backlog;
  try {
    backlog = readJson(backlogPath);
  } catch {
    return;
  }
  const counts = {};
  for (const item of backlog.items ?? []) counts[item.state] = (counts[item.state] ?? 0) + 1;
  const lines = [
    "# devin-factory status",
    "",
    `generated: ${utc()}`,
    `head: ${headSha() ?? "no-git"}`,
    "",
    "## Counts",
    "",
    ...Object.entries(counts).sort().map(([state, count]) => `- ${state}: ${count}`),
    "",
    "## Items",
    "",
    ...backlog.items.map((item) =>
      `- **${item.id}** [${item.state}] (attempts ${item.attempts}/${item.max_attempts}) ${item.title}`),
    "",
  ];
  ensureRuntime();
  writeFileSync(path.join(runtimeDir, "status.md"), `${lines.join("\n")}\n`);
}

function cmdStatus(backlog) {
  renderStatus();
  cmdList(backlog);
}

// Full sandboxed pipeline: claim -> implemented -> verify(fail) -> retry ->
// deliver -> idempotent re-deliver. Never touches the real repository.
function cmdDryRun() {
  const sandbox = mkdtempSync(path.join(tmpdir(), "factory-dry-run-"));
  try {
    mkdirSync(path.join(sandbox, "factory"), { recursive: true });
    const mini = {
      schema_version: 1,
      states: ["ready", "claimed", "implemented", "verifying", "verified", "delivered", "failed", "blocked", "cancelled"],
      transitions: {},
      items: [
        {
          id: "IT-001", title: "good item", kind: "code-change", priority: 1, state: "ready",
          attempts: 0, max_attempts: 2, module_boundary: ["src/"], allow_empty_diff: false,
          implementation: "create src/ok.txt",
          acceptance_criteria: [
            { id: "AC1", description: "file exists", check: { type: "file-exists", path: "src/ok.txt" } },
            { id: "AC2", description: "json field", check: { type: "json-field", path: "src/report.json", field: "result", equals: "PASS" } },
          ],
          verify: ["node -e \"process.exit(0)\""],
        },
        {
          id: "IT-002", title: "broken item", kind: "code-change", priority: 2, state: "ready",
          attempts: 0, max_attempts: 2, module_boundary: ["src/"], allow_empty_diff: true,
          implementation: "always fails",
          acceptance_criteria: [
            { id: "AC1", description: "command fails", check: { type: "command", command: "exit 3" } },
          ],
          verify: [],
        },
      ],
    };
    writeJsonAtomic(path.join(sandbox, "factory", "backlog.json"), mini);
    const step = run;
    console.log(`dry-run sandbox: ${sandbox}`);
    step(["claim", "IT-001"]);
    mkdirSync(path.join(sandbox, "src"), { recursive: true });
    writeFileSync(path.join(sandbox, "src", "ok.txt"), "ok\n");
    writeJsonAtomic(path.join(sandbox, "src", "report.json"), { result: "PASS" });
    step(["implemented", "IT-001"]);
    step(["verify", "IT-001"]);
    step(["deliver", "IT-001"]);
    step(["deliver", "IT-001"]);
    step(["claim", "IT-002"]);
    step(["implemented", "IT-002"]);
    step(["verify", "IT-002"], { expectExit: 1 });
    step(["claim", "IT-002"], { expectExit: 1 });
    step(["claim", "IT-002", "--retry"]);
    step(["implemented", "IT-002"]);
    step(["verify", "IT-002"], { expectExit: 1 });
    step(["claim", "IT-002", "--retry"], { expectExit: 1 });
    const final = readJson(path.join(sandbox, "factory", "backlog.json"));
    const it1 = final.items.find((i) => i.id === "IT-001");
    const it2 = final.items.find((i) => i.id === "IT-002");
    assert.equal(it1.state, "delivered", "IT-001 must be delivered");
    assert.equal(it1.attempts, 1);
    assert.equal(it2.state, "failed", "IT-002 must end failed");
    assert.equal(it2.attempts, 2, "IT-002 must have consumed one retry");
    assert(existsSync(path.join(sandbox, ".codex", "runtime", "devin-factory", "deliveries", "IT-001", "attempt-1", "evidence.json")));
    const progress = readFileSync(path.join(sandbox, ".codex", "runtime", "devin-factory", "progress.jsonl"), "utf8").trim().split("\n");
    assert(progress.length >= 10, "progress.jsonl must record the pipeline");
    console.log(`dry-run: PASS (${progress.length} progress rows, IT-001 delivered, IT-002 failed after retry)`);
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }

  function run(argv, { expectExit = 0 } = {}) {
    const result = spawnSync(process.execPath, [fileURLToPath(import.meta.url), "--root", sandbox, ...argv], { encoding: "utf8" });
    const code = result.status ?? 1;
    if (code !== expectExit) {
      console.error(result.stdout, result.stderr);
      fail(`dry-run ${argv.join(" ")}: expected exit ${expectExit}, got ${code}`);
    }
    console.log(`  $ run.mjs ${argv.join(" ")} -> exit ${code}`);
  }
}

const HELP = `usage: node scripts/factory/run.mjs <command> [options]

commands:
  list                     list items (option --json)
  show <id>                print one item spec
  next                     print highest-priority ready item
  claim <id> [--retry]     ready->claimed (or failed->claimed retry)
  implemented <id>         claimed->implemented; enforces module_boundary
  verify <id>              run acceptance criteria + verify commands
  deliver <id>             verified->delivered; write delivery bundle
  fail <id> --reason ...   mark item failed
  release <id>             claimed/implemented/failed -> ready
  block <id> / unblock <id>
  cancel <id> --reason ...
  record <id> --note ...   append a note to the item log
  status                   render status.md and list items
  dry-run                  full sandboxed pipeline self-test

options: --root <dir> --backlog <file> --json --retry`;

async function main() {
  if (opts.help || positionals.length === 0) {
    console.log(HELP);
    return;
  }
  const [command, id] = positionals;
  if (command === "dry-run") {
    cmdDryRun();
    return;
  }
  const backlog = loadBacklog();
  switch (command) {
    case "list": return cmdList(backlog);
    case "show": return cmdShow(backlog, id ?? fail("show requires <id>"));
    case "next": return cmdNext(backlog);
    case "claim": return cmdClaim(backlog, id ?? fail("claim requires <id>"));
    case "implemented": return cmdImplemented(backlog, id ?? fail("implemented requires <id>"));
    case "verify": return cmdVerify(backlog, id ?? fail("verify requires <id>"));
    case "deliver": return cmdDeliver(backlog, id ?? fail("deliver requires <id>"));
    case "fail": return cmdFail(backlog, id ?? fail("fail requires <id>"));
    case "release": return cmdTransition(backlog, id ?? fail("release requires <id>"), "release", backlog.transitions?.release ?? ["claimed", "implemented", "verifying", "failed"], "ready");
    case "block": return cmdTransition(backlog, id ?? fail("block requires <id>"), "block", ["ready"], "blocked");
    case "unblock": return cmdTransition(backlog, id ?? fail("unblock requires <id>"), "unblock", ["blocked"], "ready");
    case "cancel": return cmdTransition(backlog, id ?? fail("cancel requires <id>"), "cancel", backlog.transitions?.cancel ?? ["ready", "claimed", "implemented", "verifying", "verified", "failed", "blocked"], "cancelled");
    case "record": return cmdRecord(backlog, id ?? fail("record requires <id>"));
    case "status": return cmdStatus(backlog);
    default: fail(`unknown command ${command}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
