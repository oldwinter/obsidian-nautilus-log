// Shared helpers for factory check scripts. Node stdlib only.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

export function fail(message) {
  throw new Error(message);
}

export function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

// Evidence root for the current check: the factory exports
// FACTORY_EVIDENCE_DIR; standalone runs fall back to a manual lane directory.
export function evidenceDir(lane) {
  const env = process.env.FACTORY_EVIDENCE_DIR;
  const dir = env ?? path.join(REPO_ROOT, ".codex", "runtime", "devin-factory", "evidence", `${lane}-manual`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function findNode24() {
  const candidates = [
    process.env.FACTORY_NODE24,
    path.join(homedir(), ".local", "share", "mise", "installs", "node", "24.20.0", "bin", "node"),
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    const probe = spawnSync(candidate, ["--version"], { encoding: "utf8" });
    if (probe.stdout?.trim() === "v24.20.0") return candidate;
  }
  fail("Node 24.20.0 not found (set FACTORY_NODE24)");
}

export function runLogged(command, args, { cwd = REPO_ROOT, env = {}, timeout = 600_000, log } = {}) {
  const result = spawnSync(command, args, {
    cwd,
    env: { ...process.env, ...env },
    encoding: "utf8",
    timeout,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (log) {
    const text = `${result.stdout ?? ""}${result.stderr ?? ""}`;
    mkdirSync(path.dirname(log), { recursive: true });
    writeFileSync(log, text);
    if (text.trim()) console.log(text.trim().split("\n").slice(-15).join("\n"));
  }
  return result;
}

export function assertFile(file, hint) {
  assert(existsSync(file), `${hint ?? "missing file"}: ${file}`);
}

export function newestDirectory(parent, prefix) {
  if (!existsSync(parent)) return null;
  const entries = readdirSync(parent, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(prefix))
    .map((entry) => entry.name)
    .sort();
  return entries.length === 0 ? null : path.join(parent, entries.at(-1));
}
