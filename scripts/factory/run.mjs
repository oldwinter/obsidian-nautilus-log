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
// Subcommands: list, show, next, add, claim, implemented, verify, deliver,
// fail, release, block, unblock, cancel, record, status, dry-run.

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  appendFileSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync,
  readFileSync, renameSync, rmSync, writeFileSync,
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
    file: { type: "string" },
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

// Boundary entries ending in "/" mean "this directory prefix" — they match
// everything beneath the directory (equivalent to appending "**").
function globToRegExp(glob) {
  const pattern = glob.endsWith("/") ? `${glob}**` : glob;
  let out = "^";
  for (let i = 0; i < pattern.length; i += 1) {
    const ch = pattern[i];
    if (ch === "*") {
      if (pattern[i + 1] === "*") {
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
  const relevant = relevantPaths();
  if (relevant === null) return { paths: [], skipped: true };
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

// Non-exempt changed paths from git, or null when no repository is present.
function relevantPaths() {
  const { available, paths } = changedPaths();
  if (!available) return null;
  return paths.filter((p) => !selfExempt(p));
}

// sha256 over the exact contract the verifier ran. Any edit to an acceptance
// criterion or a verify command between verify and deliver changes this.
function contractHash(item) {
  return createHash("sha256")
    .update(JSON.stringify({ ac: item.acceptance_criteria, verify: item.verify ?? [] }))
    .digest("hex");
}

// sha256 over the non-exempt worktree the verifier read. With git this is the
// tracked diff plus untracked file bytes; without git it is every non-exempt
// file under root (repo-free sandboxes are tiny).
function workFingerprint(relevant) {
  const hash = createHash("sha256");
  if (relevant === null) {
    const walk = (dir) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })
        .sort((a, b) => a.name.localeCompare(b.name))) {
        const full = path.join(dir, entry.name);
        const rel = path.relative(root, full).split(path.sep).join("/");
        if (rel === ".git" || rel.startsWith(".git/")
          || rel === "node_modules" || rel.startsWith("node_modules/")
          || selfExempt(rel)) continue;
        if (entry.isDirectory()) walk(full);
        else {
          hash.update(`F\0${rel}\0`);
          hash.update(readFileSync(full));
        }
      }
    };
    walk(root);
    return hash.digest("hex");
  }
  for (const p of relevant.slice().sort()) {
    hash.update(`P\0${p}\0`);
    hash.update(git(["diff", "HEAD", "--", p], { allowFail: true }) ?? "");
    const untracked = (git(["ls-files", "-o", "--exclude-standard", "-z", "--", p], { allowFail: true }) ?? "")
      .split("\0").filter(Boolean).sort();
    for (const file of untracked) {
      const abs = path.join(root, file);
      hash.update(`F\0${file}\0`);
      if (existsSync(abs)) hash.update(readFileSync(abs));
    }
  }
  return hash.digest("hex");
}

// A verified item must be delivered against the same contract and the same
// worktree the verifier saw. Returns a reason string when verification is
// stale; backlog/.codex bookkeeping is exempt and never invalidates.
function verifyStaleReason(item) {
  if (item.verified_contract === undefined || item.verified_work === undefined) {
    return "no verification stamp; rerun verify";
  }
  if (contractHash(item) !== item.verified_contract) {
    return "acceptance criteria or verify commands changed since verify";
  }
  const head = headSha();
  if (head !== null && item.verified_head !== head) {
    return `HEAD moved from ${item.verified_head}`;
  }
  if (workFingerprint(relevantPaths()) !== item.verified_work) {
    return "worktree changed since verify";
  }
  return null;
}

// Canonical transition rules. The backlog's `transitions` map is an advisory
// mirror of these — release/cancel read it back — so loadBacklog rejects any
// entry that would widen (or rename) a gate the runner actually enforces.
const CANONICAL_TRANSITIONS = {
  claim: ["ready"],
  retry: ["failed"],
  implemented: ["claimed"],
  verify: ["implemented", "verified", "verifying"],
  deliver: ["verified", "delivered"],
  release: ["claimed", "implemented", "verifying", "failed"],
  block: ["ready"],
  unblock: ["blocked"],
  cancel: ["ready", "claimed", "implemented", "verifying", "verified", "failed", "blocked"],
};

function validateTransitions(backlog) {
  const declared = backlog.transitions ?? {};
  for (const [action, fromStates] of Object.entries(declared)) {
    const canonical = CANONICAL_TRANSITIONS[action];
    assert(canonical, `backlog.transitions.${action}: unknown transition`);
    assert(
      JSON.stringify([...fromStates].sort()) === JSON.stringify([...canonical].sort()),
      `backlog.transitions.${action} diverges from runner rules (canonical: ${canonical.join(", ")})`,
    );
  }
}

function loadBacklog() {
  assert(existsSync(backlogPath), `backlog missing: ${backlogPath}`);
  const backlog = readJson(backlogPath);
  assert(backlog.schema_version === 1, "backlog schema_version must be 1");
  assert(Array.isArray(backlog.states) && backlog.states.length > 1, "backlog.states must list ordered states");
  assert(Array.isArray(backlog.items), "backlog.items must be an array");
  validateItems(backlog);
  validateTransitions(backlog);
  return backlog;
}

function validateItems(backlog) {
  const ids = new Set();
  for (const item of backlog.items) {
    assert(typeof item.id === "string" && /^[A-Z]+-\d+$/.test(item.id), `bad item id ${item.id}`);
    assert(!ids.has(item.id), `duplicate item id ${item.id}`);
    ids.add(item.id);
    assert(backlog.states.includes(item.state), `${item.id}: unknown state ${item.state}`);
    assert(typeof item.title === "string" && item.title.trim().length > 0, `${item.id}: title required`);
    assert(typeof item.kind === "string" && item.kind.trim().length > 0, `${item.id}: kind required`);
    assert(typeof item.implementation === "string" && item.implementation.trim().length > 0,
      `${item.id}: implementation required`);
    if (item.allow_empty_diff !== undefined) {
      assert(typeof item.allow_empty_diff === "boolean", `${item.id}: allow_empty_diff must be a boolean`);
    }
    assert(Array.isArray(item.acceptance_criteria) && item.acceptance_criteria.length > 0,
      `${item.id}: acceptance_criteria required`);
    for (const ac of item.acceptance_criteria) {
      assert(ac.id && ac.description && ac.check?.type, `${item.id}: malformed acceptance criterion`);
      assert(["command", "file-exists", "json-field"].includes(ac.check.type),
        `${item.id}/${ac.id}: unknown check type ${ac.check.type}`);
      if (ac.check.type === "command") {
        assert(typeof ac.check.command === "string" && ac.check.command.length > 0,
          `${item.id}/${ac.id}: command check needs a command string`);
      } else {
        assert(typeof ac.check.path === "string" && ac.check.path.length > 0,
          `${item.id}/${ac.id}: ${ac.check.type} check needs a path`);
        const resolved = path.resolve(root, ac.check.path);
        assert(resolved === root || resolved.startsWith(`${root}${path.sep}`),
          `${item.id}/${ac.id}: check path escapes the worktree`);
        if (ac.check.type === "json-field") {
          assert(typeof ac.check.field === "string" && ac.check.field.length > 0,
            `${item.id}/${ac.id}: json-field check needs a field`);
        }
      }
    }
    assert(Number.isInteger(item.attempts) && item.attempts >= 0, `${item.id}: attempts must be an integer`);
    assert(Number.isInteger(item.max_attempts) && item.max_attempts >= 1, `${item.id}: max_attempts >= 1`);
    assert(Number.isInteger(item.priority), `${item.id}: priority must be an integer`);
    assert(Array.isArray(item.module_boundary), `${item.id}: module_boundary must be an array`);
    for (const entry of item.module_boundary) {
      assert(typeof entry === "string" && entry.trim().length > 0,
        `${item.id}: module_boundary entries must be non-empty strings`);
    }
    item.verify ??= [];
    assert(Array.isArray(item.verify), `${item.id}: verify must be an array`);
    for (const command of item.verify) {
      assert(typeof command === "string" && command.trim().length > 0,
        `${item.id}: verify entries must be non-empty command strings`);
    }
  }
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

// Append a new item from a JSON payload (--file <path>, or --file - for
// stdin). New items always enter at `ready` with attempts 0; history states
// are only reachable through the pipeline commands.
function cmdAdd(backlog) {
  const file = opts.file ?? fail("add requires --file <item.json> (or --file - for stdin)");
  const raw = file === "-" ? readFileSync(0, "utf8") : readFileSync(path.resolve(file), "utf8");
  let spec;
  try {
    spec = JSON.parse(raw);
  } catch (error) {
    fail(`item payload is not valid JSON: ${error.message}`);
  }
  if (spec.state !== undefined && spec.state !== "ready") {
    fail(`add requires state "ready" (got ${JSON.stringify(spec.state)})`);
  }
  const item = {
    id: spec.id,
    title: spec.title,
    kind: spec.kind ?? "code-change",
    priority: spec.priority,
    state: "ready",
    attempts: 0,
    max_attempts: spec.max_attempts ?? 3,
    module_boundary: spec.module_boundary ?? [],
    allow_empty_diff: spec.allow_empty_diff ?? false,
    implementation: spec.implementation,
    acceptance_criteria: spec.acceptance_criteria,
    verify: spec.verify ?? [],
  };
  if (spec.notes !== undefined) item.notes = spec.notes;
  backlog.items.push(item);
  try {
    validateItems(backlog);
  } catch (error) {
    fail(`item rejected: ${error.message}`);
  }
  saveBacklog(backlog);
  appendProgress({ event: "added", item: item.id, attempt: 0, title: item.title });
  console.log(`added ${item.id} (state ready)`);
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
  if (ok) {
    item.verified_head = headSha();
    item.verified_contract = contractHash(item);
    item.verified_work = workFingerprint(relevantPaths());
  } else {
    delete item.verified_head;
    delete item.verified_contract;
    delete item.verified_work;
  }
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

// Writes evidence.json + summary.md into a prepared delivery dir. Runs after
// the delivered state transition so item_log_sha256 covers the delivered row;
// the pre-transition bundle.json preserves the diff file list for rebuilds.
function writeDeliveryEvidence(dir, item) {
  const bundle = JSON.parse(readFileSync(path.join(dir, "bundle.json"), "utf8"));
  const relevant = bundle.diff_paths;
  const untracked = bundle.untracked_files;
  const itemLog = path.join(runtimeDir, "items", `${item.id}.jsonl`);
  const logBytes = existsSync(itemLog) ? readFileSync(itemLog) : null;
  // Only the rows that produced the current verification: a re-verify on the
  // same attempt appends fresh check rows, so take everything after the last
  // verify-start for this attempt.
  const attemptRows = logBytes
    ? logBytes.toString("utf8").trim().split("\n")
      .filter(Boolean).map((line) => JSON.parse(line))
      .filter((row) => row.attempt === item.attempts)
    : [];
  const lastStart = attemptRows.reduce(
    (index, row, i) => (row.event === "verify-start" ? i : index), -1);
  const checks = attemptRows
      .slice(lastStart + 1)
      .filter((row) => row.event === "check" || row.event === "verify-command")
      .map((row) => ({
        criterion: row.criterion ?? null,
        command: row.command ?? null,
        ok: row.ok === true,
        exit_code: row.exit_code ?? null,
        duration_ms: row.duration_ms ?? null,
      }));
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
    checks,
    item_log_sha256: logBytes
      ? createHash("sha256").update(logBytes).digest("hex")
      : null,
    // The log is append-only: later notes/events extend the file, so the
    // hash is verified against its first item_log_bytes bytes.
    item_log_bytes: logBytes ? logBytes.length : null,
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
    "## Check results",
    "",
    ...checks.map((check) =>
      `- ${check.ok ? "PASS" : "FAIL"} ${check.criterion ?? "verify"} ${check.command ?? ""} (exit ${check.exit_code}, ${check.duration_ms} ms)`),
    "",
    "Evidence: change.patch, bundle.json, files/ (untracked copies), evidence.json, per-item JSONL log.",
  ].join("\n");
  writeFileSync(path.join(dir, "summary.md"), `${summary}\n`);
}

function cmdDeliver(backlog, id) {
  const item = findItem(backlog, id);
  const dir = path.join(runtimeDir, "deliveries", item.id, `attempt-${item.attempts}`);
  if (item.state === "delivered") {
    if (existsSync(dir) && !existsSync(path.join(dir, "evidence.json"))) {
      writeDeliveryEvidence(dir, item);
      console.log(`deliver ${item.id}: rebuilt missing evidence -> ${dir}`);
      return;
    }
    console.log(`deliver ${item.id}: already delivered -> ${dir}`);
    return;
  }
  if (item.state !== "verified") fail(`${item.id}: cannot deliver from state ${item.state}`);
  const stale = verifyStaleReason(item);
  if (stale) fail(`${item.id}: verification is stale (${stale}); rerun verify`);
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
  writeJsonAtomic(path.join(dir, "bundle.json"), {
    diff_paths: relevant,
    untracked_files: untracked,
  });
  setState(backlog, item, "delivered", "delivered", { delivery: path.relative(root, dir) });
  writeDeliveryEvidence(dir, item);
  console.log(`delivered ${item.id} -> ${dir}`);
}

// Read-only integrity audit of a delivery bundle: required files present,
// evidence parses, and the recorded item-log prefix hash still verifies.
function cmdInspect(backlog, id) {
  const item = findItem(backlog, id);
  const dir = path.join(runtimeDir, "deliveries", item.id, `attempt-${item.attempts}`);
  const problems = [];
  for (const file of ["change.patch", "bundle.json", "evidence.json", "summary.md"]) {
    if (!existsSync(path.join(dir, file))) problems.push(`missing ${file}`);
  }
  let evidence = null;
  if (existsSync(path.join(dir, "evidence.json"))) {
    try {
      evidence = readJson(path.join(dir, "evidence.json"));
    } catch (error) {
      problems.push(`evidence.json unparseable: ${error.message}`);
    }
  }
  if (evidence) {
    if (evidence.item !== item.id) problems.push(`evidence.item ${evidence.item} != ${item.id}`);
    if (evidence.attempt !== item.attempts) problems.push(`evidence.attempt ${evidence.attempt} != ${item.attempts}`);
    const itemLog = path.join(runtimeDir, "items", `${item.id}.jsonl`);
    if (evidence.item_log_sha256 && existsSync(itemLog)) {
      if (Number.isInteger(evidence.item_log_bytes) && evidence.item_log_bytes > 0) {
        const prefix = readFileSync(itemLog).subarray(0, evidence.item_log_bytes);
        if (createHash("sha256").update(prefix).digest("hex") !== evidence.item_log_sha256) {
          problems.push("item_log_sha256 does not verify against the recorded prefix");
        }
      } else {
        console.warn(`inspect ${item.id}: note: item_log_sha256 predates item_log_bytes; cannot re-verify`);
      }
    }
    if (Array.isArray(evidence.checks) && evidence.checks.some((check) => check.ok !== true)) {
      problems.push("delivery contains a failed check result");
    }
  }
  if (item.state !== "delivered") problems.push(`item state is ${item.state}, not delivered`);
  if (problems.length === 0) {
    console.log(`inspect ${item.id}: OK (${dir})`);
    return;
  }
  for (const problem of problems) console.error(`inspect ${item.id}: ${problem}`);
  process.exitCode = 1;
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

function recentEvents(limit = 12) {
  const file = path.join(runtimeDir, "progress.jsonl");
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8").trim().split("\n")
    .filter(Boolean).slice(-limit)
    .map((line) => {
      try { return JSON.parse(line); } catch { return null; }
    })
    .filter(Boolean);
}

function formatEvent(e) {
  const transition = e.from && e.to ? ` ${e.from}->${e.to}` : "";
  return `${e.ts} ${(e.item ?? "-").padEnd(8)} ${e.event}${transition}`;
}

// deep=true runs the staleness gate per verified item (git subprocesses);
// the appendProgress hot path calls this shallow on every event.
function renderStatus({ deep = false } = {}) {
  if (!existsSync(backlogPath)) return;
  let backlog;
  try {
    backlog = readJson(backlogPath);
  } catch {
    return;
  }
  const counts = {};
  const staleMarks = {};
  for (const item of backlog.items ?? []) {
    counts[item.state] = (counts[item.state] ?? 0) + 1;
    if (deep && item.state === "verified") {
      const reason = verifyStaleReason(item);
      if (reason) staleMarks[item.id] = reason;
    }
  }
  const recent = recentEvents();
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
      `- **${item.id}** [${item.state}] (attempts ${item.attempts}/${item.max_attempts}) ${item.title}`
        + (staleMarks[item.id] ? ` — STALE: ${staleMarks[item.id]}` : "")),
    "",
    "## Recent events",
    "",
    ...(recent.length ? recent.map((e) => `- ${formatEvent(e)}`) : ["- (no progress rows yet)"]),
    "",
  ];
  ensureRuntime();
  writeFileSync(path.join(runtimeDir, "status.md"), `${lines.join("\n")}\n`);
}

function cmdStatus(backlog) {
  renderStatus({ deep: true });
  cmdList(backlog);
  const stale = backlog.items.filter((item) => item.state === "verified")
    .map((item) => ({ item, reason: verifyStaleReason(item) }))
    .filter(({ reason }) => reason);
  for (const { item, reason } of stale) {
    console.log(`${item.id}  STALE: ${reason} — rerun verify`);
  }
  const recent = recentEvents(5);
  if (recent.length) {
    console.log("recent:");
    for (const e of recent) console.log(`  ${formatEvent(e)}`);
  }
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
    step(["inspect", "IT-001"]);
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
  add --file <item.json>   append a ready item (use --file - for stdin)
  claim <id> [--retry]     ready->claimed (or failed->claimed retry)
  implemented <id>         claimed->implemented; enforces module_boundary
  verify <id>              run acceptance criteria + verify commands
  deliver <id>             verified->delivered; write delivery bundle
  fail <id> --reason ...   mark item failed
  release <id>             claimed/implemented/failed -> ready
  block <id> / unblock <id>
  cancel <id> --reason ...
  inspect <id>             audit a delivery bundle's integrity (read-only)
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
    case "add": return cmdAdd(backlog);
    case "claim": return cmdClaim(backlog, id ?? fail("claim requires <id>"));
    case "implemented": return cmdImplemented(backlog, id ?? fail("implemented requires <id>"));
    case "verify": return cmdVerify(backlog, id ?? fail("verify requires <id>"));
    case "deliver": return cmdDeliver(backlog, id ?? fail("deliver requires <id>"));
    case "fail": return cmdFail(backlog, id ?? fail("fail requires <id>"));
    case "release": return cmdTransition(backlog, id ?? fail("release requires <id>"), "release", backlog.transitions?.release ?? ["claimed", "implemented", "verifying", "failed"], "ready");
    case "block": return cmdTransition(backlog, id ?? fail("block requires <id>"), "block", ["ready"], "blocked");
    case "unblock": return cmdTransition(backlog, id ?? fail("unblock requires <id>"), "unblock", ["blocked"], "ready");
    case "cancel": return cmdTransition(backlog, id ?? fail("cancel requires <id>"), "cancel", backlog.transitions?.cancel ?? ["ready", "claimed", "implemented", "verifying", "verified", "failed", "blocked"], "cancelled");
    case "inspect": return cmdInspect(backlog, id ?? fail("inspect requires <id>"));
    case "record": return cmdRecord(backlog, id ?? fail("record requires <id>"));
    case "status": return cmdStatus(backlog);
    default: fail(`unknown command ${command}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
