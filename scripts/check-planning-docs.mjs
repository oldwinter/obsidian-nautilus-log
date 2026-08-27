#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const live = args.includes("--live");
const readArg = (name, fallback) => {
  const index = args.indexOf(name);
  return index === -1 ? fallback : args[index + 1];
};

const dossierPath = join(root, "docs/implementation-dossier.md");
const inventoryPath = join(root, "docs/research/behavior-inventory.md");
const ownersPath = join(root, "docs/parity/requirement-owners.json");
const sourceLedgerPath = join(root, "docs/parity/source-ledger.json");
const graphPath = join(root, "docs/planning-github-graph.json");
const localLinksPath = join(root, "docs/planning-local-links.json");
const failures = [];

function fail(message) {
  throw new Error(message);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function read(path) {
  return readFileSync(path, "utf8");
}

function readJson(path) {
  return JSON.parse(read(path));
}

function command(commandName, commandArgs, options = {}) {
  return execFileSync(commandName, commandArgs, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  }).trim();
}

function git(...gitArgs) {
  return command("git", gitArgs);
}

function ghJson(ghArgs) {
  const output = command("gh", ghArgs);
  return output ? JSON.parse(output) : null;
}

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === ".git" || entry.name === "node_modules") return [];
    const path = join(directory, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}

function sameSet(actual, expected, label) {
  const actualSorted = [...actual].sort();
  const expectedSorted = [...expected].sort();
  assert(
    JSON.stringify(actualSorted) === JSON.stringify(expectedSorted),
    `${label}: expected [${expectedSorted.join(", ")}], found [${actualSorted.join(", ")}]`,
  );
}

function range(prefix, first, last, width = 2) {
  return Array.from(
    { length: last - first + 1 },
    (_, index) => `${prefix}-${String(first + index).padStart(width, "0")}`,
  );
}

function report(scope, category, check) {
  try {
    const detail = check();
    console.log(`[${scope}:${category}] PASS${detail ? ` - ${detail}` : ""}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    failures.push(`${scope}:${category}: ${message}`);
    console.error(`[${scope}:${category}] FAIL - ${message}`);
  }
}

const familyRanges = [
  ["INS", 1, 5], ["SET", 1, 13], ["PAR", 1, 12], ["SCH", 1, 7],
  ["DAY", 1, 4], ["HIS", 1, 5], ["VIS", 1, 7], ["CTL", 1, 5],
  ["CMP", 1, 3], ["EXE", 1, 13], ["CLK", 1, 10], ["CMD", 1, 2],
  ["PER", 1, 2], ["ERR", 1, 9], ["ERX", 1, 8], ["DRF", 1, 9],
];
const expectedUpstreamIds = familyRanges.flatMap(([family, first, last]) => range(family, first, last));
const initialIds = [
  "OBS-TRACE-001", "OBS-HOST-001", "OBS-VIS-001", "OBS-VIS-002",
  "OBS-A11Y-001", "OBS-SAFE-001", "OBS-LIFE-001", "OBS-I18N-001",
  "OBS-LOCAL-001", "REL-001", "REL-002", "REL-003",
];
const expectedRequirementIds = [...expectedUpstreamIds.map((id) => `UP-${id}`), ...initialIds];
const expectedFixtureIds = range("FX", 1, 16);
const expectedOperationalFixtureIds = range("OFX-SAFE", 1, 30, 3);
const expectedDeviationIds = [];
const markdownFiles = [join(root, "README.md"), join(root, "CONTEXT.md"), ...walk(join(root, "docs"))]
  .filter((path) => extname(path) === ".md");

report("offline", "structured-local-links", () => {
  const manifest = readJson(localLinksPath);
  assert(manifest.schema_version === 1, "local-link manifest schema_version must be 1");
  assert(Array.isArray(manifest.links) && manifest.links.length > 0, "local-link manifest is empty");
  const keys = new Set();
  for (const link of manifest.links) {
    const key = `${link.source}\0${link.href}\0${link.target}`;
    assert(!keys.has(key), `duplicate local-link manifest entry: ${link.source} -> ${link.href}`);
    keys.add(key);
    const source = join(root, link.source);
    const target = join(root, link.target);
    assert(existsSync(source), `declared local-link source does not exist: ${link.source}`);
    assert(existsSync(target), `declared local-link target does not exist: ${link.target}`);
    assert(read(source).includes(`](${link.href})`), `declared Markdown destination missing in ${link.source}: ${link.href}`);
  }
  return `${manifest.links.length} explicitly declared local Markdown destinations`;
});

let inventoryRows = [];
report("offline", "requirement-universe", () => {
  const inventory = read(inventoryPath);
  inventoryRows = inventory.split("\n")
    .filter((line) => /^\| (?:INS|SET|PAR|SCH|DAY|HIS|VIS|CTL|CMP|EXE|CLK|CMD|PER|ERR|ERX|DRF)-\d{2} \|/.test(line))
    .map((line) => line.split("|").slice(1, -1).map((cell) => cell.trim()));
  assert(inventoryRows.length === 114, `expected 114 inventory rows, found ${inventoryRows.length}`);
  const actualIds = inventoryRows.map((row) => row[0]);
  sameSet(actualIds, expectedUpstreamIds, "exact upstream ID set");
  assert(new Set(actualIds).size === 114, "upstream IDs are not unique");
  for (const row of inventoryRows) {
    const family = row[0].slice(0, 3);
    const expectedColumns = family === "ERR" ? 8 : family === "ERX" || family === "DRF" ? 6 : 9;
    const evidenceColumn = expectedColumns === 9 ? 7 : expectedColumns === 8 ? 6 : 4;
    assert(row.length === expectedColumns, `${row[0]} must have exactly ${expectedColumns} table fields; found ${row.length}`);
    assert(row.every(Boolean), `${row[0]} has an empty required table field`);
    assert(row[evidenceColumn].includes("https://"), `${row[0]} has no HTTPS primary citation`);
    assert(/\/blob\/[0-9a-f]{40}\//.test(row[evidenceColumn]), `${row[0]} citation is not pinned to a 40-character source SHA`);
  }
  assert(inventory.includes("see CTL-04"), "PAR-07 must cross-reference CTL-04");
  assert(!inventory.includes("ACT-07"), "dangling ACT-07 reference remains");
  return "exact 114-row set, section-specific row schemas, immutable citations, PAR-07 -> CTL-04";
});

report("offline", "reference-closure", () => {
  const requirementIds = new Set([...expectedUpstreamIds, ...expectedRequirementIds]);
  const fixtureIds = new Set([...expectedFixtureIds, ...expectedOperationalFixtureIds]);
  const deviationIds = new Set(expectedDeviationIds);
  const nonReferenceTokens = new Set(["UTF-16", "SHA-256"]);
  const requirementFamilies = new Set([
    ...familyRanges.map(([family]) => `UP-${family}`),
    ...initialIds.filter((id) => id.startsWith("OBS-")).map((id) => id.replace(/-\d{3}$/, "")),
  ]);
  const tokenPattern = /\b(?:UP-)?[A-Z]{3,5}(?:-[A-Z]+)?-\d{2,3}\b/g;
  const rangePattern = /\b((?:UP-)?[A-Z]{2,5}(?:-[A-Z]+)?-\d{2,3})\s*(\.\.|to)\s*((?:(?:UP-)?[A-Z]{2,5}(?:-[A-Z]+)?-)?\d{2,3})\b/g;
  const familyPattern = /\b(?:UP-(?:INS|SET|PAR|SCH|DAY|HIS|VIS|CTL|CMP|EXE|CLK|CMD|PER|ERR|ERX|DRF)|OBS-(?:TRACE|HOST|VIS|A11Y|SAFE|LIFE|I18N|LOCAL))\b(?!-\d)/g;
  let tokensChecked = 0;
  let rangesChecked = 0;
  let commaListsChecked = 0;

  const validate = (token, location) => {
    if (nonReferenceTokens.has(token)) return;
    const target = token.startsWith("FX-") || token.startsWith("OFX-") ? fixtureIds : token.startsWith("DEV-") ? deviationIds : requirementIds;
    assert(target.has(token), `unknown requirement/fixture/deviation reference ${token} in ${location}`);
    tokensChecked += 1;
  };

  for (const file of markdownFiles) {
    const location = relative(root, file);
    const source = read(file);
    for (const token of source.match(tokenPattern) ?? []) validate(token, location);
    for (const selector of source.match(familyPattern) ?? []) {
      assert(requirementFamilies.has(selector), `unknown requirement-family selector ${selector} in ${location}`);
    }
    for (const match of source.matchAll(rangePattern)) {
      const start = match[1];
      const end = /^\d+$/.test(match[3]) ? `${start.replace(/\d+$/, "")}${match[3]}` : match[3];
      const startPrefix = start.replace(/\d+$/, "");
      const endPrefix = end.replace(/\d+$/, "");
      assert(startPrefix === endPrefix, `mixed-prefix reference range ${match[0]} in ${location}`);
      const startDigits = start.match(/\d+$/)[0];
      const startNumber = Number(startDigits);
      const endNumber = Number(end.match(/\d+$/)[0]);
      assert(startNumber <= endNumber, `descending reference range ${match[0]} in ${location}`);
      for (let number = startNumber; number <= endNumber; number += 1) {
        validate(`${startPrefix}${String(number).padStart(startDigits.length, "0")}`, location);
      }
      rangesChecked += 1;
    }
    const commaPattern = new RegExp(`${tokenPattern.source}(?:\\s*,\\s*${tokenPattern.source})+`, "g");
    commaListsChecked += (source.match(commaPattern) ?? []).length;
  }
  return `${tokensChecked} references, ${rangesChecked} ranges, ${commaListsChecked} comma lists; fixtures FX-01..16 + OFX-SAFE-001..030; zero concrete DEV IDs`;
});

let ownerMap;
report("offline", "ownership-map", () => {
  ownerMap = readJson(ownersPath);
  const schema = readJson(join(root, "docs/parity/requirement-owners.schema.json"));
  assert(ownerMap.schema_version === 1 && ownerMap.row_count === 126, "owner map version/count mismatch");
  assert(ownerMap.$schema === "./requirement-owners.schema.json", "owner map schema pointer mismatch");
  assert(schema.$defs?.ownership?.required?.includes("owner_ticket"), "ownership schema does not require owner_ticket");
  assert(schema.$defs?.ownership?.required?.includes("owner_module"), "ownership schema does not require owner_module");
  assert(Array.isArray(ownerMap.requirements) && ownerMap.requirements.length === 126, "owner map must contain exactly 126 rows");
  sameSet(ownerMap.requirements.map((row) => row.id), expectedRequirementIds, "126-row owner ID set");
  assert(new Set(ownerMap.requirements.map((row) => row.id)).size === 126, "owner map IDs are not unique");
  for (const row of ownerMap.requirements) {
    assert(Number.isInteger(row.owner_ticket) && row.owner_ticket >= 17 && row.owner_ticket <= 31, `${row.id} owner_ticket is outside #17-#31`);
    assert(typeof row.owner_module === "string" && row.owner_module.trim(), `${row.id} owner_module is empty`);
    if (row.evidence_contributors !== undefined) {
      assert(Array.isArray(row.evidence_contributors), `${row.id} evidence_contributors must be an array`);
      assert(new Set(row.evidence_contributors).size === row.evidence_contributors.length, `${row.id} evidence_contributors are not unique`);
      assert(row.evidence_contributors.every((ticket) => Number.isInteger(ticket) && ticket >= 17 && ticket <= 31), `${row.id} has an invalid evidence contributor`);
      assert(!row.evidence_contributors.includes(row.owner_ticket), `${row.id} repeats its primary owner as an evidence contributor`);
    }
  }
  const byId = new Map(ownerMap.requirements.map((row) => [row.id, row]));
  assert(byId.get("OBS-TRACE-001").owner_ticket === 22, "OBS-TRACE-001 must be owned by #22");
  assert(byId.get("OBS-HOST-001").owner_ticket === 27, "OBS-HOST-001 must be owned by #27");
  assert(byId.get("OBS-I18N-001").owner_ticket === 24, "OBS-I18N-001 must be owned by #24");
  assert(byId.get("REL-001").owner_ticket === 22 && byId.get("REL-002").owner_ticket === 22, "REL-001/002 reusable inputs must be owned by #22");
  assert(byId.get("REL-003").owner_ticket === 31, "REL-003 sign-off must be owned by #31");
  return "126 exact rows, one primary owner/module each, optional contributor schema validated";
});

const expectedLedger = [
  ["research", 2, "254976ab0c92611e59b8c9bb88d946d7b155212b", "957843485e3bcdb780ac2db5ce6cc1282cf6b061", "docs/research/behavior-inventory.md"],
  ["research", 3, "d0d1c100f863a3cea43c0a37407670aa1a3997a4", "0a2ae1d8cc6b1e4708962c889d0026db443aa259", "docs/research/scheduler-semantics.md"],
  ["research", 4, "a43ae669a40799468e6473c6e8f8baac36143b1f", "392c90c9ee98132dc48a14d104ed4e1fe5610f8d", "docs/research/execution-layer.md"],
  ["research", 6, "d906db8ea949c36a9255116b5a535bc9d0afa211", "82d213243147859ed49e41bff210a26c6634f3fc", "docs/research/roam-obsidian-capability-map.md"],
  ["research", 5, "bce308843b3579f1be0afc5a2367e6b00e6feb9a", "97f24f137df7b9e55132bc0d5bccc32a3e35d8a6", "docs/research/visual-interaction.md"],
  ["research", 7, "b2400709e7dea84a1080864a35974f6f2c23c582", "6a1dcc96b0d19242f515c34aaf91e674d63195dc", "docs/research/license-provenance.md"],
  ["decision", 8, "343ae3f252b27f723a97eddaae8813f66a8c21fe", "a2dd0c766abab5d013becfba5c5d8c5651846e0b", "docs/decisions/markdown-grammar-and-plan-item-identity.md"],
  ["decision", 9, "7f3972c2f64bbcf4a6d31c00d262201836273dc2", "4b0ae3f145c3736ec4a4250cceece0e71c8a890a", "docs/decisions/plugin-architecture-and-state-ownership.md"],
  ["decision", 10, "d09d766423326525be1c7e9e6a5d7dc3d8257426", "03e7a8d734a3eec99c8be5b8ce0edde65d9e9a54", "docs/decisions/timing-write-safety-conflict-handling-and-recovery.md"],
  ["decision", 11, "278b3e68c0db50c65b33d572a1a14ec4d8d1e05b", "300a51efd4071357cb58ac2cb031e4b7b15efc19", "docs/decisions/parity-acceptance-matrix-and-release-gates.md"],
  ["decision", 12, "0feaf0ec8f7dc470e06e7bf5d55f0cbc8c8d906c", "f34d6b10880fb9101d05e1328b80fc55f942d84e", "docs/decisions/desktop-compatibility-and-performance-envelope.md"],
  ["decision", 15, "8b7b10abd70a4796c78d518fa3d697e38560fcba", "cdc3a5529271ee3aad2716d130adee53f03f8e24", "docs/decisions/community-compliant-product-naming-and-attribution.md"],
  ["prototype-evidence-only", 13, "5a2db368df31f6ded948a983fbceae38c455b611", null, "prototype/evidence/issue-13/index.md"],
];

function patchId(commit) {
  const diff = execFileSync("git", ["show", "--pretty=format:", "--no-ext-diff", commit], { cwd: root });
  const result = spawnSync("git", ["patch-id", "--stable"], { cwd: root, input: diff, encoding: "utf8" });
  assert(result.status === 0, `git patch-id failed for ${commit}`);
  return result.stdout.trim().split(/\s+/)[0];
}

report("offline", "source-ledger", () => {
  const ledger = readJson(sourceLedgerPath);
  assert(ledger.schema_version === 1, "source ledger schema_version must be 1");
  assert(ledger.entries.length === expectedLedger.length, `source ledger must have ${expectedLedger.length} entries`);
  const dossier = read(dossierPath);
  expectedLedger.forEach(([kind, ticket, source, integrated, artifact], index) => {
    const entry = ledger.entries[index];
    assert(entry.kind === kind && entry.ticket === ticket && entry.source_commit === source && entry.integrated_commit === integrated && entry.artifact === artifact, `source ledger tuple ${index + 1} does not match ticket #${ticket}`);
    command("git", ["cat-file", "-e", `${source}^{commit}`]);
    command("git", ["cat-file", "-e", `${source}:${artifact}`]);
    assert(dossier.includes(source), `dossier does not cite source SHA for ticket #${ticket}`);
    assert(entry.status_pointer === "docs/implementation-dossier.md", `ticket #${ticket} has the wrong status pointer`);
    if (integrated) {
      command("git", ["cat-file", "-e", `${integrated}^{commit}`]);
      assert(spawnSync("git", ["merge-base", "--is-ancestor", integrated, "HEAD"], { cwd: root }).status === 0, `integrated commit ${integrated} is not an ancestor of HEAD`);
      assert(patchId(source) === patchId(integrated), `stable patch identity differs for source/integration of ticket #${ticket}`);
      assert(existsSync(join(root, artifact)), `integrated artifact missing: ${artifact}`);
    }
  });
  return "6 research + 6 decisions + prototype-evidence tuple; commits/artifacts/patch identities verified";
});

report("offline", "status-and-contract-pointers", () => {
  const dossier = read(dossierPath);
  const context = read(join(root, "CONTEXT.md"));
  const capability = read(join(root, "docs/research/roam-obsidian-capability-map.md"));
  const releaseDecision = read(join(root, "docs/decisions/parity-acceptance-matrix-and-release-gates.md"));
  const researchFiles = ["behavior-inventory.md", "scheduler-semantics.md", "execution-layer.md", "roam-obsidian-capability-map.md", "visual-interaction.md", "license-provenance.md"];
  for (const file of researchFiles) {
    const source = read(join(root, "docs/research", file));
    assert(source.includes("> Status:"), `${file} lacks a current status pointer`);
    assert(source.includes("[canonical implementation dossier](../implementation-dossier.md)"), `${file} does not route to the dossier`);
  }
  const requiredHeadings = [
    "Canonical use and precedence", "Evidence ledger", "Versioned parity matrix", "Semantic and data contract",
    "Architecture and ownership", "State machines", "Write protocol", "Compatibility and performance",
    "Visual and interaction contract", "Keyboard, accessibility, and localization", "Privacy and offline contract",
    "License, provenance, and attribution", "Explicit deviations and drift boundary", "Risks and rollback boundaries",
    "Packaging and release gates", "Implementation task graph", "Residual-unknowns audit", "Done-when audit for the dossier ticket",
  ];
  for (const heading of requiredHeadings) assert(dossier.includes(`## ${heading}`), `missing dossier heading: ${heading}`);
  assert(dossier.includes("Version: `1.1.0`"), "dossier version is not 1.1.0");
  assert(dossier.includes("zero foundational unknowns remain before implementation"), "dossier does not state zero foundational fog");
  assert(context.includes("**POMO**:") && context.includes("umbrella focus-cycle concept"), "CONTEXT POMO is not the umbrella contract");
  assert(context.includes("**Task POMO**:") && context.includes("**Standalone POMO**:"), "CONTEXT lacks the two POMO state names");
  assert(context.includes("[canonical implementation dossier](docs/implementation-dossier.md)"), "CONTEXT lacks normative dossier pointer");
  assert(dossier.includes("`ActiveTaskView` is the approved HOST replacement"), "dossier lacks normative ActiveTaskView HOST contract");
  for (const phrase of ["dedicated singleton", "reveals and focuses that same leaf", "authoritative source Markdown", "read-only unavailable state", "narrow dock"]) assert(dossier.includes(phrase), `dossier ActiveTaskView contract lacks: ${phrase}`);
  assert(capability.includes("dedicated singleton") && capability.includes("`ActiveTaskView`"), "capability research does not record ActiveTaskView resolution");
  assert(!capability.includes("The following questions remain genuinely unresolved"), "capability research still claims live unresolved choices");
  for (const phrase of ["Ticket #22 first delivers every reusable release script", "ticket #30 pushes one", "runs G0-G6", "Ticket #31 runs and signs G7-G9", "owns no repository files"]) assert(dossier.includes(phrase), `dossier release model lacks: ${phrase}`);
  assert(releaseDecision.includes("All reusable release scripts, fixtures, scanners, schemas, and templates"), "release decision does not front-load reusable inputs to #22");
  assert(/must not commit or modify source, tests, build,\s*package, or release-input files/.test(releaseDecision), "release decision does not preserve one exact SHA through #31");
  assert(releaseDecision.includes("`owner_ticket`") && releaseDecision.includes("`owner_module`"), "requirement schema decision lacks primary ownership fields");
  for (const namespace of ["`shared`", "`planner`", "`execution`", "`review`"]) assert(dossier.includes(namespace), `dossier lacks i18n namespace ${namespace}`);
  return "research/decision pointers, dossier sections, POMO, ActiveTaskView, i18n, and exact-SHA release model";
});

report("offline", "prototype-isolation", () => {
  const prototypeCommit = "5a2db368df31f6ded948a983fbceae38c455b611";
  const forbiddenRootPaths = new Set([".gitignore", "esbuild.mjs", "package-lock.json", "package.json", "tsconfig.json"]);
  const prototypeTree = command("git", ["ls-tree", "-r", "--format=%(objectname) %(path)", prototypeCommit])
    .split("\n")
    .map((line) => {
      const [object, ...pathParts] = line.split(" ");
      return { object, path: pathParts.join(" ") };
    });
  const forbiddenObjects = new Set(
    prototypeTree
      .filter((entry) => entry.path.startsWith("prototype/") || forbiddenRootPaths.has(entry.path))
      .map((entry) => entry.object),
  );
  assert(forbiddenObjects.size === 17, `expected 17 exact prototype-only objects, found ${forbiddenObjects.size}`);
  const files = walk(root);
  for (const file of files) {
    const path = relative(root, file).replaceAll("\\", "/");
    assert(!path.startsWith("prototype/"), `prototype path exists in worktree: ${path}`);
    const object = command("git", ["hash-object", file]);
    assert(!forbiddenObjects.has(object), `prototype-only object ${object} was copied/renamed to ${path}`);
  }
  const ancestor = spawnSync("git", ["merge-base", "--is-ancestor", prototypeCommit, "HEAD"], { cwd: root });
  assert(ancestor.status === 1, "prototype commit is reachable from the implementation dossier branch");
  const dossier = read(dossierPath);
  assert(dossier.includes(`${prototypeCommit}/prototype/evidence/issue-13/index.md`), "dossier lacks exact-SHA prototype evidence index");
  assert(dossier.includes("releases/tag/issue-13-prototype-evidence"), "dossier lacks approved public prototype evidence Release");
  return `${files.length} paths hashed; prototype path, 17 prototype-only objects, ancestry, and evidence-only citations`;
});

const expectedBlockers = new Map([
  [17, []], [18, [17]], [19, [18]], [20, [18]], [21, [19, 20]], [22, [17]], [23, [21]], [24, [22, 23]],
  [25, [19, 20, 22]], [26, [21, 25]], [27, [24, 26]], [28, [19, 20, 26]], [29, [27, 28]], [30, [22, 24, 26, 29]], [31, [22, 30]],
]);

function assertDag(tasks) {
  const blockers = new Map(tasks.map((task) => [task.number, new Set(task.blocked_by)]));
  const resolved = new Set();
  while (resolved.size < tasks.length) {
    const takeable = tasks.filter((task) => !resolved.has(task.number) && [...blockers.get(task.number)].every((number) => resolved.has(number)));
    assert(takeable.length > 0, "task dependency graph contains a cycle");
    takeable.forEach((task) => resolved.add(task.number));
  }
}

let graph;
report("offline", "task-graph-manifest", () => {
  graph = readJson(graphPath);
  assert(graph.schema_version === 1 && graph.repo === "oldwinter/obsidian-nautilus-log", "graph manifest identity mismatch");
  assert(graph.dossier_issue === 14 && graph.implementation_root === 16 && graph.pr === 32, "graph root/PR identity mismatch");
  sameSet(graph.tasks.map((task) => task.number), Array.from({ length: 15 }, (_, index) => 17 + index), "task issue set");
  for (const task of graph.tasks) sameSet(task.blocked_by, expectedBlockers.get(task.number), `#${task.number} blocker set`);
  assertDag(graph.tasks);
  sameSet(graph.tasks.filter((task) => task.blocked_by.length === 0).map((task) => task.number), [17], "initial frontier");
  const dossier = read(dossierPath);
  for (let issue = 16; issue <= 31; issue += 1) assert(dossier.includes(`issues/${issue}`), `dossier task graph does not link #${issue}`);
  return "#14 -> #16 -> #17-#31 manifest, exact blockers, acyclic, initial frontier #17";
});

if (live) {
  const repo = readArg("--repo", graph?.repo ?? "oldwinter/obsidian-nautilus-log");
  const prNumber = Number(readArg("--pr", String(graph?.pr ?? 32)));
  let issues = new Map();
  report("live", "repository-and-pr-head", () => {
    const head = git("rev-parse", "HEAD");
    const branch = git("branch", "--show-current");
    const tracking = git("rev-parse", "@{u}");
    const status = git("status", "--porcelain");
    const remote = command("git", ["ls-remote", "origin", `refs/heads/${branch}`]).split(/\s+/)[0];
    const pr = ghJson(["pr", "view", String(prNumber), "--repo", repo, "--json", "headRefOid,headRefName,isDraft,state,url"]);
    assert(/^[0-9a-f]{40}$/.test(head), "local HEAD is not a full 40-character SHA");
    assert(status === "", "worktree is not clean");
    assert(branch === "wayfinder/implementation-dossier", `unexpected branch: ${branch}`);
    assert(head === tracking && head === remote && head === pr.headRefOid, `local/tracking/remote/PR mismatch: ${head}/${tracking}/${remote}/${pr.headRefOid}`);
    assert(pr.headRefName === branch, `PR #${prNumber} head branch mismatch`);
    assert(pr.state === "OPEN" && pr.isDraft === true, `PR #${prNumber} must remain open and draft for re-review`);
    return `${head}; clean local = tracking = remote = draft PR #${prNumber}`;
  });
  report("live", "native-parent-relations", () => {
    const dossierChildren = ghJson(["api", `repos/${repo}/issues/14/sub_issues`, "--paginate"]);
    const rootChildren = ghJson(["api", `repos/${repo}/issues/16/sub_issues`, "--paginate"]);
    sameSet(dossierChildren.map((issue) => issue.number), [16], "#14 native sub-issues");
    sameSet(rootChildren.map((issue) => issue.number), Array.from({ length: 15 }, (_, index) => 17 + index), "#16 native sub-issues");
    for (let number = 14; number <= 31; number += 1) issues.set(number, ghJson(["api", `repos/${repo}/issues/${number}`]));
    assert(issues.get(14).state === "open", "issue #14 must remain open pending independent re-review");
    assert(issues.get(16).parent_issue_url?.endsWith("/issues/14"), "#16 parent is not #14");
    for (let number = 17; number <= 31; number += 1) assert(issues.get(number).parent_issue_url?.endsWith("/issues/16"), `#${number} parent is not #16`);
    return "#14 OPEN with sole child #16; #16 has exact children #17-#31 and matching parent pointers";
  });
  report("live", "blocked-by-dag-frontier", () => {
    const liveTasks = [];
    for (const task of graph.tasks) {
      const blockerNumbers = ghJson(["api", `repos/${repo}/issues/${task.number}/dependencies/blocked_by`, "--paginate"]).map((issue) => issue.number);
      sameSet(blockerNumbers, task.blocked_by, `live #${task.number} blocked_by`);
      liveTasks.push({ number: task.number, blocked_by: blockerNumbers });
    }
    assertDag(liveTasks);
    const frontier = liveTasks.filter((task) => issues.get(task.number).state === "open").filter((task) => task.blocked_by.every((number) => issues.get(number).state === "closed"));
    sameSet(frontier.map((task) => task.number), [17], "live open frontier");
    assert(graph.tasks.every((task) => issues.get(task.number).assignees.length === 0), "implementation tasks must remain unassigned at specification handoff");
    return "15 exact blocked_by sets, acyclic graph, open/unassigned frontier #17";
  });
  report("live", "issue-fields-and-dossier-sha", () => {
    const head = git("rev-parse", "HEAD");
    const exactDossierUrl = `https://github.com/${repo}/blob/${head}/docs/implementation-dossier.md`;
    const rootBody = issues.get(16).body ?? "";
    assert(rootBody.includes("## Outcome") && rootBody.includes("## Unique implement-spec entry") && rootBody.includes("## Native task graph") && rootBody.includes("## Completion"), "#16 lacks required root-spec sections");
    for (let number = 16; number <= 31; number += 1) assert((issues.get(number).body ?? "").includes(exactDossierUrl), `#${number} does not pin the exact-HEAD dossier URL`);
    for (const task of graph.tasks) for (const section of graph.required_task_sections) assert((issues.get(task.number).body ?? "").includes(`## ${section}`), `#${task.number} lacks required section: ${section}`);
    return `#16-#31 required fields and exact dossier URL pinned to ${head}`;
  });
  report("live", "ticket-contract-invariants", () => {
    const body = (number) => (issues.get(number).body ?? "").toLowerCase();
    assert(body(17).includes("consumer") && body(17).includes("#22") && !body(17).includes("requirement json schema only"), "#17 must be schema consumer/bootstrap only");
    for (const phrase of ["requirement", "fixtures", "scanners", "schemas", "templates"]) assert(body(22).includes(phrase), `#22 lacks ${phrase} ownership`);
    assert(body(22).includes("scripts/release/") || body(22).includes("release scripts"), "#22 lacks release scripts ownership");
    assert(body(24).includes("shared") && body(24).includes("planner") && body(24).includes("resolver"), "#24 lacks shared/planner resolver namespace ownership");
    assert(body(27).includes("execution") && body(27).includes("activetaskview"), "#27 lacks execution namespace/ActiveTaskView ownership");
    for (const phrase of ["singleton", "reveal", "authoritative block id", "read-only", "stale", "missing", "keyboard", "narrow"]) assert(body(27).includes(phrase), `#27 ActiveTaskView contract lacks ${phrase}`);
    assert(body(29).includes("review") && body(29).includes("namespace"), "#29 lacks review namespace ownership");
    for (const phrase of ["clean pushed", "g0-g6", "freeze", "exact sha"]) assert(body(30).includes(phrase), `#30 candidate-freeze contract lacks ${phrase}`);
    for (const phrase of ["same sha", "g7-g9", "no repository files", "must not commit", "release-input"]) assert(body(31).includes(phrase), `#31 same-SHA sign-off contract lacks ${phrase}`);
    return "#17/#22 ownership, namespaced i18n, ActiveTaskView QA, and #30/#31 exact-SHA split";
  });
  report("live", "map-handoff-boundary", () => {
    const pr = ghJson(["pr", "view", String(prNumber), "--repo", repo, "--json", "isDraft"]);
    assert(issues.get(14).state === "open" && pr.isDraft === true, "review handoff requires open #14 and draft PR");
    return "#1 intentionally not mutated in this scope; #14 remains open and PR remains draft for controller map refresh/re-review";
  });
}

if (failures.length > 0) {
  console.error(`\nplanning audit failed in ${failures.length} categor${failures.length === 1 ? "y" : "ies"}:`);
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exitCode = 1;
} else {
  console.log(`\nplanning audit: PASS (${live ? "offline + live" : "offline"}; every category listed above)`);
}
