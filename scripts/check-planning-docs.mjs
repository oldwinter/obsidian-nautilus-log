#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import { dirname, posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const failures = [];
const expectedApprovalCommit = "564dc5317612ceef47b0d9d22387868bae773c47";

function fail(message) {
  throw new Error(message);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function argValue(name, fallback = null) {
  const index = args.indexOf(name);
  if (index === -1) return fallback;
  assert(args[index + 1] && !args[index + 1].startsWith("--"), name + " requires a value");
  return args[index + 1];
}

function command(name, commandArgs, options = {}) {
  return execFileSync(name, commandArgs, {
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

function report(scope, category, check) {
  try {
    const detail = check();
    console.log("[" + scope + ":" + category + "] PASS" + (detail ? " - " + detail : ""));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    failures.push(scope + ":" + category + ": " + message);
    console.error("[" + scope + ":" + category + "] FAIL - " + message);
  }
}

function sameSet(actual, expected, label) {
  const actualSorted = [...actual].sort();
  const expectedSorted = [...expected].sort();
  assert(
    JSON.stringify(actualSorted) === JSON.stringify(expectedSorted),
    label + ": expected [" + expectedSorted.join(", ") + "], found [" + actualSorted.join(", ") + "]",
  );
}

function sameSequence(actual, expected, label) {
  assert(
    JSON.stringify(actual) === JSON.stringify(expected),
    label + ": expected " + JSON.stringify(expected) + ", found " + JSON.stringify(actual),
  );
}

function uniqueStrings(value, label, { allowEmpty = false } = {}) {
  assert(Array.isArray(value), label + " must be an array");
  assert(allowEmpty || value.length > 0, label + " must not be empty");
  assert(
    value.every((entry) => typeof entry === "string" && entry.trim() !== ""),
    label + " must contain only non-empty strings",
  );
  assert(new Set(value).size === value.length, label + " contains duplicates");
  return value;
}

function assertRequiredFields(value, fields, label) {
  assert(value !== null && typeof value === "object" && !Array.isArray(value), label + " must be an object");
  for (const field of fields) assert(Object.hasOwn(value, field), label + " is missing " + field);
}

function assertPinnedGithubRefs(value, label) {
  for (const ref of uniqueStrings(value, label)) {
    assert(
      /^https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/blob\/[0-9a-f]{40}\/.+/.test(ref),
      label + " contains a mutable or non-GitHub source reference: " + ref,
    );
  }
}

function isOwnedPath(path, boundary) {
  return [...boundary.allowed_module_boundaries, ...boundary.allowed_external_boundaries]
    .some((allowed) => allowed.endsWith("/") ? path.startsWith(allowed) : path === allowed);
}

function range(prefix, first, last, width = 2) {
  return Array.from(
    { length: last - first + 1 },
    (_, index) => (prefix ? prefix + "-" : "") + String(first + index).padStart(width, "0"),
  );
}

const requestedTarget = argValue("--sha", "HEAD");
assert(
  requestedTarget === "HEAD" || /^[0-9a-f]{40}$/.test(requestedTarget),
  "--sha must be HEAD or one full lowercase 40-character commit SHA",
);
const targetSha = git("rev-parse", "--verify", requestedTarget + "^{commit}");
assert(/^[0-9a-f]{40}$/.test(targetSha), "--sha must resolve to one full lowercase 40-character commit SHA");
assert(git("cat-file", "-t", targetSha) === "commit", "--sha does not resolve to a commit object: " + requestedTarget);
const liveMode = argValue("--live");
assert(
  liveMode === null || liveMode === "review-draft" || liveMode === "merge-ready",
  "--live must be review-draft or merge-ready",
);

function readObject(path) {
  return git("show", targetSha + ":" + path);
}

function readJsonObject(path) {
  return JSON.parse(readObject(path));
}

function objectExists(path, sha = targetSha) {
  return spawnSync("git", ["cat-file", "-e", sha + ":" + path], { cwd: root }).status === 0;
}

function objectId(path, sha = targetSha) {
  return git("rev-parse", sha + ":" + path);
}

function listObjectFiles(sha = targetSha) {
  const output = git("ls-tree", "-r", "--name-only", sha);
  return output === "" ? [] : output.split("\n");
}

function patchId(commit) {
  const diff = execFileSync("git", ["show", "--pretty=format:", "--no-ext-diff", commit], { cwd: root });
  const result = spawnSync("git", ["patch-id", "--stable"], {
    cwd: root,
    input: diff,
    encoding: "utf8",
  });
  assert(result.status === 0, "git patch-id failed for " + commit);
  return result.stdout.trim().split(/\s+/)[0];
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
const expectedRequirementIds = [...expectedUpstreamIds.map((id) => "UP-" + id), ...initialIds];
const expectedFixtureIds = [...range("FX", 1, 16), ...range("OFX-SAFE", 1, 30, 3)];
const expectedCatalogFixtureIds = [...range("FX", 1, 16), ...range("OFX", 1, 9, 3)];
const expectedEnvironmentIds = [
  "ENV-PURE", "ENV-VIS", "ENV-HOST-PRIVATE", "ENV-HOST-MIN", "ENV-HOST-MAC",
  "ENV-HOST-WIN", "ENV-HOST-LINUX", "ENV-THEME", "ENV-A11Y",
];
const acceptedEvidenceKinds = new Set([
  "UNIT", "CONTRACT", "INTEGRATION", "VAULT", "SCREENSHOT", "KEYBOARD",
  "A11Y", "LIFECYCLE", "PACKAGE", "MANUAL",
]);
const expectedDeviationIds = [];
const objectFiles = listObjectFiles();
const markdownFiles = objectFiles.filter((path) => path.endsWith(".md")).sort();

report("offline", "target-object", () => {
  assert(objectExists("scripts/check-planning-docs.mjs"), "checker is absent from target object");
  return targetSha + "; " + objectFiles.length + " files read from Git object, independent of worktree state";
});

function isRelativeMarkdownDestination(href) {
  return href !== ""
    && !href.startsWith("#")
    && !href.startsWith("/")
    && !href.startsWith("//")
    && !/^[a-z][a-z0-9+.-]*:/i.test(href);
}

function destinationTarget(source, href) {
  const path = href.split(/[?#]/, 1)[0];
  return posix.normalize(posix.join(posix.dirname(source), path));
}

function discoverRelativeMarkdownLinks(source, markdown) {
  const found = [];
  const patterns = [
    /!?\[[^\]\n]*\]\(\s*(?:<([^>\n]+)>|([^\s)]+))(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\s*\)/g,
    /^\s{0,3}\[[^\]\n]+\]:\s*(?:<([^>\n]+)>|(\S+))/gm,
  ];
  for (const pattern of patterns) {
    for (const match of markdown.matchAll(pattern)) {
      const href = match[1] ?? match[2];
      if (isRelativeMarkdownDestination(href)) found.push({ offset: match.index, href });
    }
  }
  found.sort((left, right) => left.offset - right.offset || left.href.localeCompare(right.href));
  const ordinals = new Map();
  return found.map(({ href }) => {
    const key = source + "\0" + href;
    const occurrence = (ordinals.get(key) ?? 0) + 1;
    ordinals.set(key, occurrence);
    return { source, href, target: destinationTarget(source, href), occurrence };
  });
}

report("offline", "relative-markdown-links", () => {
  const manifest = readJsonObject("docs/planning-local-links.json");
  assert(manifest.schema_version === 2, "local-link manifest schema_version must be 2");
  assert(
    manifest.discovery === "all-inline-and-reference-definition-relative-destinations",
    "local-link discovery contract mismatch",
  );
  const discovered = markdownFiles.flatMap(
    (source) => discoverRelativeMarkdownLinks(source, readObject(source)),
  );
  assert(
    JSON.stringify(manifest.links) === JSON.stringify(discovered),
    "local-link manifest differs from discovered occurrence set: manifest "
      + manifest.links.length + ", discovered " + discovered.length,
  );
  for (const link of discovered) {
    assert(objectExists(link.target), "relative link target missing: " + link.source + " -> " + link.href);
  }
  return discovered.length + " inline/reference-definition relative destinations discovered, declared, and resolved";
});

let inventoryRows = [];
report("offline", "requirement-universe", () => {
  const inventory = readObject("docs/research/behavior-inventory.md");
  inventoryRows = inventory.split("\n")
    .filter((line) => /^\| (?:INS|SET|PAR|SCH|DAY|HIS|VIS|CTL|CMP|EXE|CLK|CMD|PER|ERR|ERX|DRF)-\d{2} \|/.test(line))
    .map((line) => line.split("|").slice(1, -1).map((cell) => cell.trim()));
  assert(inventoryRows.length === 114, "expected 114 inventory rows, found " + inventoryRows.length);
  const actualIds = inventoryRows.map((row) => row[0]);
  sameSet(actualIds, expectedUpstreamIds, "exact upstream ID set");
  assert(new Set(actualIds).size === 114, "upstream IDs are not unique");
  for (const row of inventoryRows) {
    const family = row[0].slice(0, 3);
    const expectedColumns = family === "ERR" ? 8 : family === "ERX" || family === "DRF" ? 6 : 9;
    const evidenceColumn = expectedColumns === 9 ? 7 : expectedColumns === 8 ? 6 : 4;
    assert(row.length === expectedColumns, row[0] + " must have " + expectedColumns + " fields");
    assert(row.every(Boolean), row[0] + " has an empty required field");
    assert(row[evidenceColumn].includes("https://"), row[0] + " has no HTTPS primary citation");
    assert(/\/blob\/[0-9a-f]{40}\//.test(row[evidenceColumn]), row[0] + " citation is not exact-SHA pinned");
  }
  assert(inventory.includes("see CTL-04"), "PAR-07 must cross-reference CTL-04");
  assert(!inventory.includes("ACT-07"), "dangling ACT-07 reference remains");
  return "exact 114-row set, immutable citations, and PAR-07 -> CTL-04";
});

report("offline", "reference-closure", () => {
  const knownRequirements = new Set([...expectedUpstreamIds, ...expectedRequirementIds]);
  const knownFixtures = new Set(expectedFixtureIds);
  const knownDeviations = new Set(expectedDeviationIds);
  for (const file of markdownFiles) {
    const proposed = /^docs\/deviations\/(DEV-\d{3})-.+\.md$/.exec(file);
    if (!proposed || knownDeviations.has(proposed[1])) continue;
    assert(/^Status: proposed\./m.test(readObject(file)), file + " must remain proposed until approval is registered");
    knownDeviations.add(proposed[1]);
  }
  const concretePattern = /\b(?:UP-(?:INS|SET|PAR|SCH|DAY|HIS|VIS|CTL|CMP|EXE|CLK|CMD|PER|ERR|ERX|DRF)-\d{2}|(?:INS|SET|PAR|SCH|DAY|HIS|VIS|CTL|CMP|EXE|CLK|CMD|PER|ERR|ERX|DRF)-\d{2}|OBS-(?:TRACE|HOST|VIS|A11Y|SAFE|LIFE|I18N|LOCAL)-\d{3}|REL-\d{3}|FX-\d{2}|OFX-SAFE-\d{3}|DEV-\d{3})\b/g;
  const rangePattern = /\b((?:UP-)?(?:INS|SET|PAR|SCH|DAY|HIS|VIS|CTL|CMP|EXE|CLK|CMD|PER|ERR|ERX|DRF)-\d{2}|OBS-(?:TRACE|HOST|VIS|A11Y|SAFE|LIFE|I18N|LOCAL)-\d{3}|REL-\d{3}|FX-\d{2}|OFX-SAFE-\d{3}|DEV-\d{3})\s*(?:\.\.|to)\s*((?:(?:UP-)?(?:INS|SET|PAR|SCH|DAY|HIS|VIS|CTL|CMP|EXE|CLK|CMD|PER|ERR|ERX|DRF)-|OBS-(?:TRACE|HOST|VIS|A11Y|SAFE|LIFE|I18N|LOCAL)-|REL-|FX-|OFX-SAFE-|DEV-)?\d{2,3})\b/g;
  let concreteCount = 0;
  let rangeCount = 0;
  let listCount = 0;
  const validate = (token, location) => {
    const target = token.startsWith("FX-") || token.startsWith("OFX-")
      ? knownFixtures
      : token.startsWith("DEV-")
        ? knownDeviations
        : knownRequirements;
    assert(target.has(token), "unknown requirement/fixture/deviation reference " + token + " in " + location);
    concreteCount += 1;
  };
  for (const file of markdownFiles) {
    const source = readObject(file);
    for (const token of source.match(concretePattern) ?? []) validate(token, file);
    for (const match of source.matchAll(rangePattern)) {
      const start = match[1];
      const startPrefix = start.replace(/\d+$/, "");
      const end = /^\d+$/.test(match[2]) ? startPrefix + match[2] : match[2];
      const endPrefix = end.replace(/\d+$/, "");
      assert(startPrefix === endPrefix, "mixed-prefix range " + match[0] + " in " + file);
      const digits = start.match(/\d+$/)[0];
      const first = Number(digits);
      const last = Number(end.match(/\d+$/)[0]);
      assert(first <= last, "descending range " + match[0] + " in " + file);
      for (let number = first; number <= last; number += 1) {
        validate(startPrefix + String(number).padStart(digits.length, "0"), file);
      }
      rangeCount += 1;
    }
    const listPattern = new RegExp(
      concretePattern.source + "(?:\\s*,\\s*(?:and\\s+)?" + concretePattern.source + ")+",
      "g",
    );
    listCount += (source.match(listPattern) ?? []).length;
  }
  return concreteCount + " concrete/expanded references, " + rangeCount
    + " ranges, " + listCount + " comma lists; exact known sets only";
});

let ownerMap;
let boundaryManifest;
let primaryIdsByTicket;
report("offline", "ticket-boundary-manifest", () => {
  boundaryManifest = readJsonObject("docs/parity/ticket-boundaries.json");
  const schema = readJsonObject("docs/parity/ticket-boundaries.schema.json");
  assert(
    boundaryManifest.schema_version === 1
      && boundaryManifest.$schema === "./ticket-boundaries.schema.json",
    "ticket-boundary identity mismatch",
  );
  assert(
    schema.$defs?.ticketBoundary?.required?.includes("primary_requirement_ids"),
    "ticket-boundary schema does not require primary IDs",
  );
  sameSet(
    boundaryManifest.tickets.map((entry) => entry.ticket),
    range("", 17, 31).map(Number),
    "ticket-boundary ticket set",
  );
  primaryIdsByTicket = new Map();
  const primaryUniverse = [];
  const moduleOwners = new Map();
  for (const entry of boundaryManifest.tickets) {
    assert(
      Array.isArray(entry.allowed_module_boundaries)
        && Array.isArray(entry.allowed_external_boundaries),
      "#" + entry.ticket + " boundaries must be arrays",
    );
    assert(Array.isArray(entry.primary_requirement_ids), "#" + entry.ticket + " primary IDs must be an array");
    assert(
      new Set(entry.primary_requirement_ids).size === entry.primary_requirement_ids.length,
      "#" + entry.ticket + " primary IDs are not unique",
    );
    primaryIdsByTicket.set(entry.ticket, new Set(entry.primary_requirement_ids));
    primaryUniverse.push(...entry.primary_requirement_ids);
    for (const boundary of entry.allowed_module_boundaries) {
      assert(
        !moduleOwners.has(boundary),
        "module boundary " + boundary + " is shared by #" + moduleOwners.get(boundary) + " and #" + entry.ticket,
      );
      moduleOwners.set(boundary, entry.ticket);
    }
    for (const boundary of entry.allowed_external_boundaries) {
      assert(/^external:[a-z0-9-]+$/.test(boundary), "invalid external boundary in #" + entry.ticket);
    }
  }
  const moduleEntries = [...moduleOwners.entries()];
  for (const [left, leftTicket] of moduleEntries) {
    for (const [right, rightTicket] of moduleEntries) {
      if (leftTicket === rightTicket || left === right) continue;
      assert(
        !(left.endsWith("/") && right.startsWith(left)),
        "module boundary " + left + " for #" + leftTicket + " contains #" + rightTicket + " boundary " + right,
      );
    }
  }
  sameSet(primaryUniverse, expectedRequirementIds, "ticket-boundary 126-ID universe");
  assert(new Set(primaryUniverse).size === 126, "a requirement occurs in multiple ticket boundaries");
  assert(primaryIdsByTicket.get(30).size === 0, "#30 must own zero primary requirements");
  sameSet(primaryIdsByTicket.get(31), ["REL-003"], "#31 primary requirements");
  sameSet(
    [...primaryIdsByTicket.get(28)].filter((id) => id.startsWith("UP-HIS-")),
    range("UP-HIS", 1, 5),
    "#28 UP-HIS set",
  );
  assert(
    [...primaryIdsByTicket.get(19)].every((id) => !id.startsWith("UP-HIS-")),
    "#19 must not own UP-HIS requirements",
  );
  return "15 exclusive ticket boundaries and one complete 126-ID primary partition";
});

report("offline", "owner-map-boundary-equality", () => {
  ownerMap = readJsonObject("docs/parity/requirement-owners.json");
  const schema = readJsonObject("docs/parity/requirement-owners.schema.json");
  assert(ownerMap.schema_version === 1 && ownerMap.row_count === 126, "owner map version/count mismatch");
  assert(ownerMap.$schema === "./requirement-owners.schema.json", "owner map schema pointer mismatch");
  assert(schema.$defs?.ownership?.required?.includes("owner_ticket"), "owner schema does not require owner_ticket");
  assert(schema.$defs?.ownership?.required?.includes("owner_module"), "owner schema does not require owner_module");
  sameSet(ownerMap.requirements.map((row) => row.id), expectedRequirementIds, "126-row owner ID set");
  assert(new Set(ownerMap.requirements.map((row) => row.id)).size === 126, "owner map IDs are not unique");

  const tickets = range("", 17, 31).map(Number);
  const mapIdsByTicket = new Map(tickets.map((ticket) => [ticket, new Set()]));
  const boundariesByTicket = new Map(boundaryManifest.tickets.map((entry) => [
    entry.ticket,
    new Set([...entry.allowed_module_boundaries, ...entry.allowed_external_boundaries]),
  ]));
  for (const row of ownerMap.requirements) {
    assert(mapIdsByTicket.has(row.owner_ticket), row.id + " owner is outside #17-#31");
    assert(
      boundariesByTicket.get(row.owner_ticket).has(row.owner_module),
      row.id + " module " + row.owner_module + " is outside #" + row.owner_ticket,
    );
    mapIdsByTicket.get(row.owner_ticket).add(row.id);
    if (row.evidence_contributors !== undefined) {
      assert(Array.isArray(row.evidence_contributors), row.id + " contributors must be an array");
      assert(
        new Set(row.evidence_contributors).size === row.evidence_contributors.length,
        row.id + " contributors are not unique",
      );
      assert(
        row.evidence_contributors.every((ticket) => mapIdsByTicket.has(ticket)),
        row.id + " has an invalid contributor",
      );
      assert(
        !row.evidence_contributors.includes(row.owner_ticket),
        row.id + " repeats its primary owner as contributor",
      );
    }
  }
  for (const [ticket, ids] of mapIdsByTicket) {
    sameSet(ids, primaryIdsByTicket.get(ticket), "owner map vs boundary manifest #" + ticket);
  }
  const byId = new Map(ownerMap.requirements.map((row) => [row.id, row]));
  for (const id of range("UP-HIS", 1, 5)) {
    assert(byId.get(id).owner_ticket === 28, id + " primary owner must be #28");
    assert(byId.get(id).evidence_contributors?.includes(19), id + " must name #19 as evidence contributor");
  }
  assert(
    byId.get("UP-EXE-08").owner_module === "src/ui/execution/review-view.ts",
    "UP-EXE-08 must use #29 live path",
  );
  assert(
    byId.get("OBS-SAFE-001").owner_module === "src/workspace/commit.ts",
    "OBS-SAFE-001 must use workspace write path",
  );
  assert(
    byId.get("UP-CLK-01").owner_module.startsWith("src/runtime/execution/"),
    "UP-CLK owner module must use execution runtime path",
  );
  return "map/manifest exact equality for #17-#31; all 126 owner modules are inside exclusive boundaries";
});

report("offline", "requirement-parity-contract", () => {
  const requirements = readJsonObject("docs/parity/requirements.json");
  const deviations = readJsonObject("docs/parity/deviations.json");
  const owners = readJsonObject("docs/parity/requirement-owners.json");
  const boundaries = readJsonObject("docs/parity/ticket-boundaries.json");
  const schemaPath = "scripts/release/schemas/requirements.schema.json";
  const schemaPointer = "../../" + schemaPath;
  assert(requirements.$schema === schemaPointer, "requirements manifest has the wrong $schema pointer");
  assert(objectExists(schemaPath), "requirements schema is absent from the target object");
  const requirementSchema = readJsonObject(schemaPath);
  assert(
    requirementSchema.$schema === "https://json-schema.org/draft/2020-12/schema",
    "requirements schema must use JSON Schema 2020-12",
  );
  assert(
    requirementSchema.$id
      === "https://github.com/oldwinter/obsidian-nautilus-log/blob/main/scripts/release/schemas/requirements.schema.json",
    "requirements schema identity mismatch",
  );
  const requiredManifestFields = [
    "$schema", "schema_version", "requirement_set", "upstream_baseline_sha", "row_count", "counts",
    "evidence_binding", "fixture_catalog", "test_catalog", "environment_catalog", "requirements",
  ];
  assertRequiredFields(requirements, requiredManifestFields, "requirements manifest");
  for (const field of requiredManifestFields) {
    assert(
      requirementSchema.required?.includes(field),
      "requirements schema does not require top-level field " + field,
    );
  }
  const requiredRowFields = [
    "id", "owner_ticket", "owner_module", "evidence_contributors", "statement", "source_refs",
    "disposition", "fixtures", "tests", "environments", "evidence", "status",
  ];
  const rowSchema = Object.values(requirementSchema.$defs ?? {}).find(
    (definition) => Array.isArray(definition?.required)
      && definition.required.includes("owner_ticket")
      && definition.required.includes("evidence"),
  );
  assert(rowSchema, "requirements schema has no requirement-row definition");
  for (const field of requiredRowFields) {
    assert(rowSchema.required.includes(field), "requirements schema row does not require " + field);
    assert(Object.hasOwn(rowSchema.properties ?? {}, field), "requirements schema row does not define " + field);
  }
  assert(
    requirementSchema.$defs?.requirementId?.pattern
      === "^(?:UP-(?:INS|SET|PAR|SCH|DAY|HIS|VIS|CTL|CMP|EXE|CLK|CMD|PER|ERR|ERX|DRF)-[0-9]{2}|OBS-(?:TRACE|HOST|VIS|A11Y|SAFE|LIFE|I18N|LOCAL)-[0-9]{3}|REL-[0-9]{3})$",
    "requirements schema requirement ID pattern mismatch",
  );
  const testEntrySchema = Object.values(requirementSchema.$defs ?? {}).find(
    (definition) => Array.isArray(definition?.required)
      && definition.required.includes("evidence_kind")
      && definition.required.includes("gates"),
  );
  assert(testEntrySchema, "requirements schema has no test-catalog definition");
  sameSet(
    testEntrySchema.properties?.evidence_kind?.enum ?? [],
    acceptedEvidenceKinds,
    "requirements schema accepted Evidence ID kinds",
  );

  assert(requirements.schema_version === 1, "requirements schema_version must be 1");
  assert(
    requirements.requirement_set === "UPSTREAM-MATRIX-v1+INITIAL-OBS-REL-v1",
    "requirements requirement_set mismatch",
  );
  assert(
    requirements.upstream_baseline_sha === "973a041aa2f59f3b05bf31db8187efbfea07017a",
    "requirements upstream baseline mismatch",
  );
  assert(requirements.row_count === 126, "requirements row_count must be 126");
  sameSequence(
    [requirements.counts?.upstream, requirements.counts?.obsidian, requirements.counts?.release],
    [114, 9, 3],
    "requirements 114 + 9 + 3 partition",
  );
  assert(requirements.evidence_binding === "candidate-evidence-index", "requirements evidence binding mismatch");
  assert(Array.isArray(requirements.requirements), "requirements rows must be an array");
  assert(requirements.requirements.length === 126, "requirements manifest must contain exactly 126 rows");
  const requirementIds = requirements.requirements.map((row) => row?.id);
  assert(new Set(requirementIds).size === 126, "requirements manifest contains duplicate IDs");
  sameSet(requirementIds, expectedRequirementIds, "requirements exact 126-ID partition");

  const fixtureCatalog = requirements.fixture_catalog;
  const testCatalog = requirements.test_catalog;
  const environmentCatalog = requirements.environment_catalog;
  assert(Array.isArray(fixtureCatalog), "fixture_catalog must be an array");
  assert(Array.isArray(testCatalog), "test_catalog must be an array");
  assert(Array.isArray(environmentCatalog), "environment_catalog must be an array");
  const fixtureIds = fixtureCatalog.map((entry) => entry?.id);
  const testIds = testCatalog.map((entry) => entry?.id);
  const environmentIds = environmentCatalog.map((entry) => entry?.id);
  assert(new Set(fixtureIds).size === fixtureIds.length, "fixture_catalog contains duplicate IDs");
  assert(new Set(testIds).size === testIds.length, "test_catalog contains duplicate IDs");
  assert(new Set(environmentIds).size === environmentIds.length, "environment_catalog contains duplicate IDs");
  sameSet(fixtureIds, expectedCatalogFixtureIds, "fixture catalog exact ID set");
  sameSet(environmentIds, expectedEnvironmentIds, "environment catalog exact ID set");
  assert(testIds.length >= 126, "test catalog must contain at least one test per requirement");
  assert(!Object.hasOwn(requirementSchema.properties.test_catalog, "maxItems"), "test catalog schema must not impose a 126-test ceiling");
  for (const [catalogName, catalog] of [
    ["fixture_catalog", fixtureCatalog],
    ["environment_catalog", environmentCatalog],
  ]) {
    for (const entry of catalog) {
      assertRequiredFields(entry, ["id", "statement", "source_refs"], catalogName + " " + String(entry?.id));
      assert(typeof entry.statement === "string" && /\S/.test(entry.statement), entry.id + " has no statement");
      assertPinnedGithubRefs(entry.source_refs, entry.id + " source_refs");
    }
  }
  const requirementIdSet = new Set(requirementIds);
  function acceptedMatrix(id) {
    if (id.startsWith("REL-")) return [["PACKAGE"], ["G0", "G7", id === "REL-003" ? "G9" : "G8"]];
    if (id.startsWith("UP-DRF-")) return [["CONTRACT"], ["G0", "G2", "G8"]];
    if (id === "OBS-TRACE-001") return [["CONTRACT"], ["G0"]];
    if (id === "OBS-A11Y-001") return [["KEYBOARD", "A11Y", "MANUAL"], ["G5", "G6"]];
    if (id === "OBS-I18N-001") return [["CONTRACT", "SCREENSHOT", "MANUAL"], ["G1", "G5", "G6"]];
    if (id === "OBS-LOCAL-001") return [["INTEGRATION"], ["G4", "G7", "G8"]];
    const family = id.split("-")[1];
    if (["INS", "SET"].includes(family) || id === "OBS-LIFE-001") return [["UNIT", "INTEGRATION", "LIFECYCLE", "PACKAGE", "MANUAL"], ["G1", "G4", "G7", "G8"]];
    if (["PAR", "SCH", "DAY"].includes(family)) return [["UNIT", "CONTRACT"], ["G1", "G2"]];
    if (family === "HIS") return [["UNIT", "VAULT", "INTEGRATION"], ["G2", "G3"]];
    if (["VIS", "CTL", "CMP"].includes(family) || id.startsWith("OBS-VIS")) return [["CONTRACT", "INTEGRATION", "SCREENSHOT", "MANUAL"], ["G4", "G5", "G6"]];
    if (family === "EXE") return [["CONTRACT", "INTEGRATION", "KEYBOARD", "SCREENSHOT", "LIFECYCLE"], ["G2", "G4", "G5", "G6"]];
    if (["CLK", "PER"].includes(family) || id === "OBS-SAFE-001") return [["UNIT", "CONTRACT", "VAULT", "INTEGRATION", "LIFECYCLE"], id === "OBS-SAFE-001" ? ["G2", "G3", "G4", "G8"] : ["G2", "G3", "G4"]];
    if (family === "CMD" || id === "OBS-HOST-001") return [["INTEGRATION", "KEYBOARD", "MANUAL"], ["G4", "G5"]];
    if (["ERR", "ERX"].includes(family)) return [["CONTRACT", "VAULT", "INTEGRATION", "A11Y"], ["G2", "G3", "G4", "G5"]];
    throw new Error("no accepted evidence matrix for " + id);
  }
  const testById = new Map();
  for (const entry of testCatalog) {
    assertRequiredFields(entry, ["id", "requirement_id", "evidence_kind", "gates"], "test catalog entry");
    assert(
      /^TC-(?:UP-[A-Z]{3}-[0-9]{2}|OBS-[A-Z0-9]+-[0-9]{3}|REL-[0-9]{3})-[0-9]{3}$/.test(entry.id),
      "invalid stable test ID " + entry.id,
    );
    assert(requirementIdSet.has(entry.requirement_id), entry.id + " points to an unknown requirement");
    assert(
      entry.id.startsWith("TC-" + entry.requirement_id + "-"),
      entry.id + " does not encode its requirement reverse link",
    );
    assert(acceptedEvidenceKinds.has(entry.evidence_kind), entry.id + " has unsupported evidence_kind " + entry.evidence_kind);
    const gates = uniqueStrings(entry.gates, entry.id + " gates");
    assert(gates.every((gate) => /^G[0-9]$/.test(gate)), entry.id + " references an unknown release gate");
    testById.set(entry.id, entry);
  }

  assert(deviations.schema_version === 1, "deviations schema_version must be 1");
  assert(deviations.requirement_set === requirements.requirement_set, "deviation requirement_set mismatch");
  assert(Array.isArray(deviations.deviations), "deviations must be an array");
  assert(Array.isArray(deviations.not_applicable_approvals), "not_applicable_approvals must be an array");
  const deviationById = new Map();
  for (const entry of deviations.deviations) {
    assert(/^DEV-[0-9]{3}$/.test(entry?.id ?? ""), "invalid deviation ID " + String(entry?.id));
    assert(!deviationById.has(entry.id), "duplicate deviation ID " + entry.id);
    assert(entry.status === "approved", entry.id + " is not approved");
    uniqueStrings(entry.requirement_ids, entry.id + " requirement_ids");
    assert(
      entry.requirement_ids.every((id) => requirementIdSet.has(id)),
      entry.id + " points to an unknown requirement",
    );
    const approvals = Array.isArray(entry.approvals)
      ? entry.approvals
      : Object.entries(entry.approvals ?? {}).map(([role, approval]) => ({ role, ...approval }));
    const approvedRoles = new Set(approvals
      .filter((approval) => typeof approval?.reviewer === "string" && approval.reviewer.trim() !== ""
        && Number.isFinite(Date.parse(approval.approved_at)))
      .map((approval) => String(approval.role).replaceAll("_", "-").toLowerCase()));
    assert([...approvedRoles].some((role) => role.includes("parity")), entry.id + " lacks parity approval");
    assert(
      [...approvedRoles].some((role) => role.includes("release") || role.includes("product")),
      entry.id + " lacks product/release approval",
    );
    deviationById.set(entry.id, entry);
  }
  const approvalById = new Map();
  for (const entry of deviations.not_applicable_approvals) {
    assert(/^NA-[0-9]{3}$/.test(entry?.id ?? ""), "invalid not-applicable approval ID " + String(entry?.id));
    assert(!approvalById.has(entry.id), "duplicate not-applicable approval ID " + entry.id);
    assert(entry.status === "approved", entry.id + " is not approved");
    uniqueStrings(entry.requirement_ids, entry.id + " requirement_ids");
    assert(typeof entry.reason === "string" && /\S/.test(entry.reason), entry.id + " has no reason");
    assert(typeof entry.reviewer === "string" && /\S/.test(entry.reviewer), entry.id + " has no reviewer");
    assert(Number.isFinite(Date.parse(entry.approved_at)), entry.id + " has an invalid approval timestamp");
    assertPinnedGithubRefs(entry.source_refs, entry.id + " source_refs");
    approvalById.set(entry.id, entry);
  }

  const ownerById = new Map(owners.requirements.map((entry) => [entry.id, entry]));
  const boundaryByTicket = new Map(boundaries.tickets.map((entry) => [entry.ticket, entry]));
  const fixtureIdSet = new Set(fixtureIds);
  const environmentIdSet = new Set(environmentIds);
  const usedDeviations = new Set();
  const usedApprovals = new Set();
  for (const row of requirements.requirements) {
    assertRequiredFields(row, requiredRowFields, "requirement " + String(row?.id));
    assert(row.status === "active", row.id + " must be active in the initial manifest");
    assert(typeof row.statement === "string" && /\S/.test(row.statement), row.id + " has no statement");
    assertPinnedGithubRefs(row.source_refs, row.id + " source_refs");
    assert(
      ["exact", "host-adapted", "approved-improvement", "not-applicable"].includes(row.disposition),
      row.id + " has unsupported disposition " + String(row.disposition),
    );
    const fixtures = uniqueStrings(row.fixtures, row.id + " fixtures");
    const tests = uniqueStrings(row.tests, row.id + " tests");
    const environments = uniqueStrings(row.environments, row.id + " environments");
    const evidence = uniqueStrings(row.evidence, row.id + " repository evidence", { allowEmpty: true });
    assert(evidence.length === 0, row.id + " repository evidence must be empty until exact-candidate resolution");
    assert(fixtures.every((id) => fixtureIdSet.has(id)), row.id + " has a dangling fixture");
    assert(environments.every((id) => environmentIdSet.has(id)), row.id + " has a dangling environment");
    assert(
      tests.every((id) => testById.get(id)?.requirement_id === row.id),
      row.id + " has a dangling or mislinked test",
    );
    const [expectedKinds, expectedGates] = acceptedMatrix(row.id);
    sameSequence(tests.map((id) => testById.get(id).evidence_kind), expectedKinds, row.id + " evidence modalities");
    for (const testId of tests) sameSequence(testById.get(testId).gates, expectedGates, testId + " gate matrix");
    assert(Array.isArray(row.evidence_contributors), row.id + " evidence_contributors must be an array");
    assert(
      row.evidence_contributors.every((ticket) => Number.isInteger(ticket) && ticket >= 17 && ticket <= 31),
      row.id + " has an invalid evidence contributor",
    );
    assert(
      new Set(row.evidence_contributors).size === row.evidence_contributors.length,
      row.id + " has duplicate evidence contributors",
    );
    assert(!row.evidence_contributors.includes(row.owner_ticket), row.id + " repeats its owner as contributor");
    const projection = ownerById.get(row.id);
    assert(projection, row.id + " is missing from the owner projection");
    assert(row.owner_ticket === projection.owner_ticket, row.id + " owner_ticket differs from projection");
    assert(row.owner_module === projection.owner_module, row.id + " owner_module differs from projection");
    sameSequence(
      row.evidence_contributors,
      projection.evidence_contributors ?? [],
      row.id + " evidence contributors vs owner projection",
    );
    const boundary = boundaryByTicket.get(row.owner_ticket);
    assert(boundary && isOwnedPath(row.owner_module, boundary), row.id + " owner_module is outside its ticket boundary");
    assert(boundary.primary_requirement_ids.includes(row.id), row.id + " lacks its reverse boundary link");

    if (row.disposition === "host-adapted" || row.disposition === "approved-improvement") {
      const deviation = deviationById.get(row.deviation_id);
      assert(deviation?.requirement_ids.includes(row.id), row.id + " lacks an approved bidirectional deviation");
      usedDeviations.add(row.deviation_id);
    } else {
      assert(!Object.hasOwn(row, "deviation_id"), row.id + " has an inapplicable deviation_id");
    }
    if (row.disposition === "not-applicable") {
      const approval = approvalById.get(row.not_applicable_approval_id);
      assert(
        approval?.requirement_ids.length === 1 && approval.requirement_ids[0] === row.id,
        row.id + " lacks a reviewed bidirectional not-applicable approval",
      );
      usedApprovals.add(row.not_applicable_approval_id);
    } else {
      assert(
        !Object.hasOwn(row, "not_applicable_approval_id"),
        row.id + " has an inapplicable not_applicable_approval_id",
      );
    }
  }
  sameSet(usedDeviations, deviationById.keys(), "used vs registered deviations");
  sameSet(usedApprovals, approvalById.keys(), "used vs registered not-applicable approvals");
  return "126 rows, required schema fields, closed catalogs/owners/sources/deviations, and empty repository evidence";
});

function scopePartition(id) {
  return {
    oneOf: [
      {
        properties: {
          included_requirement_ids: { type: "array", contains: { const: id } },
          excluded_requirement_ids: {
            type: "array",
            not: { type: "array", contains: { const: id } },
          },
        },
      },
      {
        properties: {
          included_requirement_ids: {
            type: "array",
            not: { type: "array", contains: { const: id } },
          },
          excluded_requirement_ids: { type: "array", contains: { const: id } },
        },
      },
    ],
  };
}

report("offline", "release-scope-schema", () => {
  const schema = readJsonObject("docs/parity/scope.schema.json");
  const requiredFields = [
    "schema_version", "candidate_sha", "requirements_sha256", "deviations_sha256",
    "release_scope", "parity_claim", "included_requirement_ids", "excluded_requirement_ids",
    "approved_deviation_ids",
  ];
  assert(schema.$schema === "https://json-schema.org/draft/2020-12/schema", "scope schema draft mismatch");
  assert(
    schema.$id === "https://github.com/oldwinter/obsidian-nautilus-log/blob/main/docs/parity/scope.schema.json",
    "scope schema identity mismatch",
  );
  assert(schema.type === "object" && schema.additionalProperties === false, "scope root must be a closed object");
  sameSet(schema.required ?? [], requiredFields, "scope required fields");
  sameSet(Object.keys(schema.properties ?? {}), requiredFields, "scope property names");
  assert(schema.properties.schema_version?.const === 1, "scope schema_version contract mismatch");
  assert(schema.properties.candidate_sha?.pattern === "^[0-9a-f]{40}$", "scope candidate SHA pattern mismatch");
  assert(schema.properties.requirements_sha256?.pattern === "^[0-9a-f]{64}$", "scope requirements hash pattern mismatch");
  assert(schema.properties.deviations_sha256?.pattern === "^[0-9a-f]{64}$", "scope deviations hash pattern mismatch");
  sameSet(schema.properties.release_scope?.enum ?? [], ["private", "public"], "scope release_scope values");
  sameSet(
    schema.properties.parity_claim?.enum ?? [],
    ["private-preview", "v1.0.2-parity"],
    "scope parity_claim values",
  );
  for (const field of ["included_requirement_ids", "excluded_requirement_ids"]) {
    assert(schema.properties[field]?.uniqueItems === true, "scope " + field + " must reject duplicates");
    assert(schema.properties[field]?.items?.$ref === "#/$defs/requirementId", "scope " + field + " has wrong ID schema");
  }
  assert(schema.properties.approved_deviation_ids?.uniqueItems === true, "approved deviations must be unique");
  assert(
    schema.properties.approved_deviation_ids?.items?.pattern === "^DEV-[0-9]{3}$",
    "approved deviation ID pattern mismatch",
  );
  const schemaIds = schema.$defs?.requirementId?.enum;
  assert(Array.isArray(schemaIds) && new Set(schemaIds).size === 126, "scope requirement enum must contain 126 unique IDs");
  sameSet(schemaIds, expectedRequirementIds, "scope exact requirement universe");
  const partitions = (schema.allOf ?? []).filter((entry) => Array.isArray(entry.oneOf));
  assert(partitions.length === 126, "scope schema must encode 126 exact include/exclude partitions");
  const requirementIdSetForScope = new Set(expectedRequirementIds);
  const partitionIds = [];
  for (const entry of partitions) {
    const id = entry.oneOf?.[0]?.properties?.included_requirement_ids?.contains?.const;
    assert(requirementIdSetForScope.has(id), "scope partition has an unknown requirement " + String(id));
    sameSequence(entry, scopePartition(id), "scope partition " + id);
    partitionIds.push(id);
  }
  sameSet(partitionIds, expectedRequirementIds, "scope partition ID set");
  const conditionals = (schema.allOf ?? []).filter((entry) => entry.if);
  assert(conditionals.length === 2, "scope schema must contain public and private conditionals");
  const byReleaseScope = new Map(conditionals.map((entry) => [entry.if?.properties?.release_scope?.const, entry]));
  const publicRule = byReleaseScope.get("public");
  assert(publicRule?.then?.properties?.parity_claim?.const === "v1.0.2-parity", "public parity claim mismatch");
  assert(publicRule?.then?.properties?.included_requirement_ids?.minItems === 126, "public scope must include 126 IDs");
  assert(publicRule?.then?.properties?.included_requirement_ids?.maxItems === 126, "public scope cannot exceed 126 IDs");
  assert(publicRule?.then?.properties?.excluded_requirement_ids?.maxItems === 0, "public scope cannot exclude requirements");
  const privateRule = byReleaseScope.get("private");
  assert(privateRule?.then?.properties?.parity_claim?.const === "private-preview", "private parity claim mismatch");
  const mandatoryPrivateIds = (privateRule?.then?.allOf ?? [])
    .map((entry) => entry.properties?.included_requirement_ids?.contains?.const);
  sameSet(
    mandatoryPrivateIds,
    ["OBS-SAFE-001", "OBS-LIFE-001", "OBS-LOCAL-001", "REL-001", "REL-002"],
    "mandatory private requirement IDs",
  );
  return "canonical fields, 126 exact partitions, public full parity, and mandatory private safety scope";
});

report("offline", "release-input-inventory", () => {
  const declaration = readJsonObject("scripts/release/release-inputs.json");
  assert(declaration.schema_version === 1, "release-input declaration schema_version must be 1");
  const candidateOwned = uniqueStrings(declaration.candidate_owned, "candidate_owned");
  const transitiveInputs = uniqueStrings(declaration.transitive_inputs, "transitive_inputs");
  const externalInputs = uniqueStrings(declaration.external_run_inputs, "external_run_inputs");
  const requiredContractInputs = [
    "docs/parity/requirements.json",
    "docs/parity/deviations.json",
    "docs/parity/requirement-owners.json",
    "docs/parity/requirement-owners.schema.json",
    "docs/parity/scope.schema.json",
    "docs/parity/ticket-boundaries.json",
    "docs/parity/ticket-boundaries.schema.json",
    "docs/parity/trace-reports/README.md",
    "scripts/release/schemas/requirements.schema.json",
  ];
  for (const path of requiredContractInputs) {
    assert(candidateOwned.includes(path), "candidate_owned omits required contract " + path);
  }
  for (const path of candidateOwned) assert(objectExists(path), "candidate_owned path is absent from target: " + path);
  for (const path of transitiveInputs) assert(objectExists(path), "transitive input is absent from target: " + path);
  const exactOwnedInputs = objectFiles.filter((path) => [
    ".github/workflows/", "docs/parity/", "scripts/release/", "scripts/verify/", "tests/fixtures/", "tests/release/",
  ].some((prefix) => path.startsWith(prefix)) || [
    "docs/planning-github-graph.json", "docs/planning-local-links.json", "scripts/check-planning-docs.mjs",
    "scripts/generate-planning-local-links.mjs", "scripts/generate-requirement-owners.mjs",
  ].includes(path));
  sameSet(candidateOwned, exactOwnedInputs, "complete #22 candidate-owned release input inventory");
  const relevantScriptInputs = objectFiles.filter(
    (path) => path.startsWith("scripts/release/") || path.startsWith("scripts/verify/"),
  );
  const declaredScriptInputs = candidateOwned.filter(
    (path) => path.startsWith("scripts/release/") || path.startsWith("scripts/verify/"),
  );
  sameSet(declaredScriptInputs, relevantScriptInputs, "declared executable/schema/template release inputs");
  sameSet(
    externalInputs,
    ["evidence-bundle/manifest.json", "gate-results.json", "g7-package.json", "g8-scope.json", "g9-signoff.json"],
    "external release-run inputs",
  );
  assert(Array.isArray(declaration.preparation_commands), "preparation_commands must be an array");
  assert(declaration.preparation_commands.length === 1, "exactly one package preparation command is required");
  sameSequence(
    declaration.preparation_commands[0],
    { id: "deterministic-package", command: ["node", "scripts/release/build-candidate.mjs"] },
    "deterministic package preparation command",
  );
  assert(Array.isArray(declaration.gates), "release gates must be an array");
  assert(declaration.gates.length === 10, "release declaration must contain G0-G9 exactly once");
  const gateIds = declaration.gates.map((gate) => gate?.id);
  sameSequence(gateIds, Array.from({ length: 10 }, (_, index) => "G" + index), "G0-G9 gate order");
  assert(new Set(gateIds).size === 10, "release declaration contains duplicate gates");
  for (const gate of declaration.gates) {
    sameSequence(
      gate.command,
      ["node", "scripts/release/run-gate.mjs", "--gate", gate.id],
      gate.id + " command",
    );
  }

  const zeroSha = "0".repeat(40);
  const zeroHash = "0".repeat(64);
  const g7 = readJsonObject("scripts/release/g7-package.template.json");
  assertRequiredFields(
    g7,
    [
      "schema_version", "gate", "result", "candidate_sha", "version", "release_label",
      "package_filename", "package_path", "package_sha256", "builds", "smoke_workflows",
      "policy", "release_assets",
    ],
    "G7 template",
  );
  assert(g7.schema_version === 1 && g7.gate === "G7", "G7 template identity mismatch");
  assert(g7.candidate_sha === zeroSha && g7.package_sha256 === zeroHash, "G7 template must use explicit zero identities");
  assert(g7.version === "1.0.2", "G7 template version mismatch");
  assert(Array.isArray(g7.builds) && g7.builds.length === 0, "G7 template builds must begin unresolved");
  assert(Array.isArray(g7.smoke_workflows) && g7.smoke_workflows.length === 0, "G7 smoke workflows must begin unresolved");
  assert(Array.isArray(g7.release_assets) && g7.release_assets.length === 0, "G7 release assets must begin unresolved");
  for (const field of [
    "name_available", "license_present", "notices_present", "provenance_passed", "sbom_present", "banner_passed",
  ]) {
    assert(g7.policy?.[field] === false, "G7 policy " + field + " must fail closed in the template");
  }
  assert(g7.policy?.fork_policy_status === "unverified", "G7 fork policy must begin unverified");

  const g8 = readJsonObject("scripts/release/g8-scope.template.json");
  const canonicalScopeFields = [
    "schema_version", "candidate_sha", "requirements_sha256", "deviations_sha256",
    "release_scope", "parity_claim", "included_requirement_ids", "excluded_requirement_ids",
    "approved_deviation_ids",
  ];
  sameSet(Object.keys(g8), canonicalScopeFields, "G8 canonical scope template fields");
  assert(g8.schema_version === 1 && g8.candidate_sha === zeroSha, "G8 template identity mismatch");
  assert(g8.requirements_sha256 === zeroHash && g8.deviations_sha256 === zeroHash, "G8 revision hashes must begin unresolved");
  assert(g8.release_scope === "private" && g8.parity_claim === "private-preview", "G8 template must default to private preview");
  assert(
    [g8.included_requirement_ids, g8.excluded_requirement_ids, g8.approved_deviation_ids]
      .every((value) => Array.isArray(value) && value.length === 0),
    "G8 scope arrays must begin unresolved",
  );

  const g9 = readJsonObject("scripts/release/g9-signoff.template.json");
  assertRequiredFields(
    g9,
    [
      "schema_version", "gate", "decision", "release_type", "version", "candidate_sha",
      "remote_head", "package_filename", "package_sha256", "requirements", "gate_results",
      "evidence_bundle", "approved_deviation_ids", "scope_exclusions", "manual_workflows",
      "attestations", "repository_state", "release",
    ],
    "G9 template",
  );
  assert(g9.schema_version === 1 && g9.gate === "G9" && g9.decision === "NO-GO", "G9 template must fail closed");
  assert(g9.candidate_sha === zeroSha && g9.remote_head === zeroSha, "G9 candidate identities must begin unresolved");
  assert(g9.package_sha256 === zeroHash, "G9 package identity must begin unresolved");
  assert(g9.evidence_bundle?.index_sha256 === zeroHash, "G9 evidence index identity must begin unresolved");
  assert(g9.release?.draft === false && g9.release?.published === false, "G9 release template must begin unpublished and non-draft");
  assert(g9.repository_state?.before === null && g9.repository_state?.after === null, "G9 repository states must begin unresolved");

  const runGate = readObject("scripts/release/run-gate.mjs");
  const dryRun = readObject("scripts/release/dry-run.mjs");
  const buildCandidate = readObject("scripts/release/build-candidate.mjs");
  for (const phrase of [
    "validateG0",
    "validateCandidateEvidenceBundle",
    "validateGateResults",
    "validateG7Package",
    "validateG9Signoff",
  ]) {
    assert(runGate.includes(phrase), "run-gate is missing exact-candidate stage " + phrase);
  }
  const candidateG0 = readObject("scripts/verify/candidate-g0.mjs");
  assert(
    candidateG0.includes('readCandidateJson(repository, candidateSha, "scripts/release/release-inputs.json")'),
    "G0 does not read the release-input declaration from the exact candidate object",
  );
  assert(dryRun.includes("index <= 9"), "dry-run does not traverse G0-G9");
  assert(dryRun.includes("issue_31_repository_changes_required: false"), "dry-run does not prove #31 input completeness");
  assert(buildCandidate.includes("assertPushedCandidate"), "candidate builder does not require a clean pushed candidate");

  const workflow = readObject(".github/workflows/issue-22-release-evidence.yml");
  for (const phrase of [
    "implement/issue-22-evidence",
    "fetch-depth: 0",
    "actions/checkout@v7.0.1",
    "actions/setup-node@v7.0.0",
    "node-version: 24.20.0",
    "node --test tests/release/*.test.mjs",
    "node scripts/release/dry-run.mjs",
    "node scripts/check-planning-docs.mjs --sha HEAD",
    "npm run verify",
    "npm run validate:provenance",
  ]) {
    assert(workflow.includes(phrase), "issue #22 workflow is missing: " + phrase);
  }
  const pullRequestTrigger = /^  pull_request:([^\n]*)\n([\s\S]*?)(?=^  [a-z_]+:|(?![\s\S]))/m.exec(workflow);
  assert(pullRequestTrigger && pullRequestTrigger[1].trim() === "", "workflow must enable pull_request");
  assert(!/^ +paths(?:-ignore)?:/m.test(pullRequestTrigger[2]), "workflow must verify every pull request without path exclusions");
  return candidateOwned.length + " immutable candidate inputs, five run inputs, exact G0-G9 commands, and fail-closed templates/workflow";
});

report("offline", "evidence-and-trace-contract", () => {
  const requiredVerifierFiles = [
    "scripts/verify/candidate-evidence.mjs",
    "scripts/verify/candidate-g0.mjs",
    "scripts/verify/candidate-object.mjs",
    "scripts/verify/candidate-package.mjs",
    "scripts/verify/candidate-release.mjs",
    "scripts/verify/evidence-bundle.mjs",
    "scripts/verify/evidence-schema.mjs",
    "scripts/verify/json-schema.mjs",
    "scripts/verify/render-trace-report.mjs",
    "scripts/verify/verify-evidence.mjs",
    "tests/fixtures/evidence/scenarios.json",
    "tests/fixtures/release/create-dry-run-fixture.mjs",
    "tests/release/evidence-harness.test.mjs",
    "tests/release/release-gates.test.mjs",
    "tests/release/requirements-contract.test.mjs",
  ];
  for (const path of requiredVerifierFiles) assert(objectExists(path), "required evidence/release verifier is absent: " + path);

  const candidateObject = readObject("scripts/verify/candidate-object.mjs");
  assert(candidateObject.includes('${candidateSha}^{commit}'), "candidate verifier does not peel the exact commit object");
  assert(candidateObject.includes('["show", `${candidateSha}:${repositoryPath}`]'), "candidate verifier does not read candidate paths by Git object");
  assert(candidateObject.includes("assertPushedCandidate"), "candidate verifier lacks pushed/clean equality enforcement");
  for (const phrase of ["local HEAD", "tracking ref", "ls-remote", "worktree is dirty"]) {
    assert(candidateObject.includes(phrase), "candidate equality verifier lacks " + phrase);
  }

  const evidenceSchema = readObject("scripts/verify/evidence-schema.mjs");
  const recordTypes = [
    "pure", "vault", "host", "screenshot", "keyboard", "accessibility", "lifecycle",
    "network/privacy", "performance", "package", "manual",
  ];
  for (const recordType of recordTypes) {
    assert(evidenceSchema.includes(recordType + ":") || evidenceSchema.includes('"' + recordType + '":'), "evidence schema lacks " + recordType);
  }
  for (const kind of acceptedEvidenceKinds) {
    assert(evidenceSchema.includes('"' + kind + '"'), "evidence schema lacks accepted Evidence ID kind " + kind);
  }
  for (const phrase of [
    "candidate_sha", "package_sha256", "started_at", "ended_at", "artifacts",
    "requirement_ids", "test_ids", "attempts", "retries", "skipped", "quarantined",
    "expected_failure", "source_blob_oid",
  ]) {
    assert(evidenceSchema.includes(phrase), "evidence schema lacks fail-closed field " + phrase);
  }

  const scenarios = readJsonObject("tests/fixtures/evidence/scenarios.json");
  assert(scenarios.schema_version === 1 && scenarios.passing === "all-record-types", "evidence scenario identity mismatch");
  const expectedNegativeScenarios = [
    "malformed-record", "missing-record", "duplicate-evidence", "stale-candidate", "stale-package",
    "corrupted-artifact", "corrupted-package", "corrupted-owner", "missing-evidence", "duplicate-test",
    "path-traversal", "symlink-artifact", "skipped", "quarantined", "retry", "expected-failure",
    "failed-result", "symbolic-tool-version", "min-supported-token", "current-stable-token",
    "incomplete-host-profile", "invalid-visual-dpr", "invalid-a11y-zoom", "invalid-timestamp",
    "stale-requirements-object", "invalid-object-id-length", "alternate-requirements-path", "corrupted-index",
  ];
  assert(Array.isArray(scenarios.failing), "evidence failing scenarios must be an array");
  const negativeIds = scenarios.failing.map((entry) => entry?.id);
  assert(new Set(negativeIds).size === negativeIds.length, "evidence scenarios contain duplicate IDs");
  sameSet(negativeIds, expectedNegativeScenarios, "evidence negative scenario set");
  assert(
    scenarios.failing.every((entry) => typeof entry.expected === "string" && entry.expected.trim() !== ""),
    "every negative evidence scenario needs a deterministic rejection",
  );

  const verifyEvidence = readObject("scripts/verify/verify-evidence.mjs");
  assert(verifyEvidence.includes('${candidateSha}^{commit}'), "evidence verifier does not resolve the exact candidate commit");
  assert(verifyEvidence.includes('gitBytes(root, ["show", objectSpec])'), "evidence verifier does not read requirements bytes from the candidate object");
  assert(verifyEvidence.includes("validateCandidateScope"), "private trace verifier does not reuse canonical scope validation");
  const candidateRelease = readObject("scripts/verify/candidate-release.mjs");
  for (const phrase of ["verifyPublishedGitHubRelease", "G9 tag lookup", "release asset hash", "exact candidate object bytes"]) {
    assert(candidateRelease.includes(phrase), "release verifier lacks: " + phrase);
  }
  const evidenceBundle = readObject("scripts/verify/evidence-bundle.mjs");
  for (const phrase of [
    "repository template evidence must be empty",
    "may differ from the exact candidate object only in evidence arrays",
    "source_blob_oid",
    "stale candidate object",
    "validateManifestCoverage",
  ]) {
    assert(evidenceBundle.includes(phrase), "evidence bundle verifier lacks: " + phrase);
  }
  const requirementsTests = readObject("tests/release/requirements-contract.test.mjs");
  for (const phrase of [
    "corrupt requirements are rejected deterministically",
    "src/not-owned.ts",
    "blob/main/file.ts",
    "FX-DOES-NOT-EXIST",
    "TC-DANGLING-001",
    'disposition = "deferred"',
    'deviation_id = "DEV-999"',
  ]) {
    assert(requirementsTests.includes(phrase), "requirements negative tests lack: " + phrase);
  }
  const releaseTests = readObject("tests/release/release-gates.test.mjs");
  for (const phrase of [
    "dirty and unpushed states fail",
    "unknown dispositions, unapproved adaptations, dangling links, and incomplete private scope",
    "stale records, retry-only results, and hash corruption",
    "missing, malformed, duplicate, skipped, and corrupt package data",
    "same-SHA invariant",
  ]) {
    assert(releaseTests.includes(phrase), "release negative tests lack: " + phrase);
  }

  const renderer = readObject("scripts/verify/render-trace-report.mjs");
  for (const phrase of [
    "schema_version: 1", "candidate_sha:", "package_sha256:", "manifest_sha256:",
    "requirements_source_blob_oid:", "forward: { requirements }", "reverse: { tests, evidence, artifacts }",
    "assertTraceOutputOutsideBundle", 'flag: "wx"',
  ]) {
    assert(renderer.includes(phrase), "trace renderer lacks immutable trace field/behavior " + phrase);
  }
  assert(!renderer.includes("generated_at"), "trace report must not depend on a wall-clock generation timestamp");
  const traceContract = readObject("docs/parity/trace-reports/README.md");
  for (const phrase of [
    "exact-candidate evidence verifier", "outside the immutable bundle", "candidate SHA",
    "package SHA-256", "source manifest", "Evidence Index", "resolved requirement overlay",
    "requirement -> test -> evidence -> artifact", "reverse.tests", "reverse.evidence",
    "reverse.artifacts", "Generation is deterministic",
  ]) {
    assert(traceContract.includes(phrase), "trace report contract lacks: " + phrase);
  }
  return "11 record types, 10 accepted Evidence ID kinds, 28 negative cases, exact-object verification, and bidirectional trace semantics";
});

const expectedLedger = [
  ["research", 2, "254976ab0c92611e59b8c9bb88d946d7b155212b", "957843485e3bcdb780ac2db5ce6cc1282cf6b061", "docs/research/behavior-inventory.md", ["status", "errata"]],
  ["research", 3, "d0d1c100f863a3cea43c0a37407670aa1a3997a4", "0a2ae1d8cc6b1e4708962c889d0026db443aa259", "docs/research/scheduler-semantics.md", ["status"]],
  ["research", 4, "a43ae669a40799468e6473c6e8f8baac36143b1f", "392c90c9ee98132dc48a14d104ed4e1fe5610f8d", "docs/research/execution-layer.md", ["status"]],
  ["research", 6, "d906db8ea949c36a9255116b5a535bc9d0afa211", "82d213243147859ed49e41bff210a26c6634f3fc", "docs/research/roam-obsidian-capability-map.md", ["status", "resolution"]],
  ["research", 5, "bce308843b3579f1be0afc5a2367e6b00e6feb9a", "97f24f137df7b9e55132bc0d5bccc32a3e35d8a6", "docs/research/visual-interaction.md", ["status"]],
  ["research", 7, "b2400709e7dea84a1080864a35974f6f2c23c582", "6a1dcc96b0d19242f515c34aaf91e674d63195dc", "docs/research/license-provenance.md", ["status"]],
  ["decision", 8, "343ae3f252b27f723a97eddaae8813f66a8c21fe", "a2dd0c766abab5d013becfba5c5d8c5651846e0b", "docs/decisions/markdown-grammar-and-plan-item-identity.md", ["decision-amendment"]],
  ["decision", 9, "7f3972c2f64bbcf4a6d31c00d262201836273dc2", "4b0ae3f145c3736ec4a4250cceece0e71c8a890a", "docs/decisions/plugin-architecture-and-state-ownership.md", ["decision-amendment"]],
  ["decision", 10, "d09d766423326525be1c7e9e6a5d7dc3d8257426", "03e7a8d734a3eec99c8be5b8ce0edde65d9e9a54", "docs/decisions/timing-write-safety-conflict-handling-and-recovery.md", []],
  ["decision", 11, "278b3e68c0db50c65b33d572a1a14ec4d8d1e05b", "300a51efd4071357cb58ac2cb031e4b7b15efc19", "docs/decisions/parity-acceptance-matrix-and-release-gates.md", ["decision-amendment"]],
  ["decision", 12, "0feaf0ec8f7dc470e06e7bf5d55f0cbc8c8d906c", "f34d6b10880fb9101d05e1328b80fc55f942d84e", "docs/decisions/desktop-compatibility-and-performance-envelope.md", []],
  ["decision", 15, "8b7b10abd70a4796c78d518fa3d697e38560fcba", "cdc3a5529271ee3aad2716d130adee53f03f8e24", "docs/decisions/community-compliant-product-naming-and-attribution.md", []],
  ["prototype-evidence-only", 13, "5a2db368df31f6ded948a983fbceae38c455b611", null, "prototype/evidence/issue-13/index.md", ["evidence-only"]],
];

report("offline", "source-integration-ledger", () => {
  const ledger = readJsonObject("docs/parity/source-ledger.json");
  assert(ledger.entries.length === expectedLedger.length, "source ledger must have 13 entries");
  const dossier = readObject("docs/implementation-dossier.md");
  expectedLedger.forEach(([kind, ticket, source, integrated, artifact], index) => {
    const entry = ledger.entries[index];
    assert(
      entry.kind === kind
        && entry.ticket === ticket
        && entry.source_commit === source
        && entry.integrated_commit === integrated
        && entry.artifact === artifact,
      "source ledger tuple mismatch for #" + ticket,
    );
    assert(git("rev-parse", source + "^{commit}") === source, "missing source commit for #" + ticket);
    assert(objectExists(artifact, source), "source artifact missing for #" + ticket);
    assert(dossier.includes(source), "dossier does not cite source SHA for #" + ticket);
    assert(entry.status_pointer === "docs/implementation-dossier.md", "#" + ticket + " has wrong status pointer");
    if (integrated) {
      assert(git("rev-parse", integrated + "^{commit}") === integrated, "missing integration for #" + ticket);
      assert(
        spawnSync("git", ["merge-base", "--is-ancestor", integrated, targetSha], { cwd: root }).status === 0,
        "integration for #" + ticket + " is not an ancestor of target",
      );
      assert(patchId(source) === patchId(integrated), "source/integration patch differs for #" + ticket);
      assert(objectExists(artifact), "final artifact missing for #" + ticket);
    }
  });
  return "exact source, ordered integration, patch identity, target ancestry, and evidence-only prototype";
});

report("offline", "final-artifact-provenance", () => {
  if (expectedApprovalCommit === null) {
    return "approval commit pin deferred to final provenance commit B";
  }
  assert(/^[0-9a-f]{40}$/.test(expectedApprovalCommit), "approval commit pin is not exact");
  assert(
    spawnSync("git", ["merge-base", "--is-ancestor", expectedApprovalCommit, targetSha], { cwd: root }).status === 0,
    "approval commit A is not an ancestor of target",
  );
  const ledger = readJsonObject("docs/parity/source-ledger.json");
  assert(ledger.schema_version === 2, "final source ledger schema_version must be 2");
  const allowedOverlays = new Set(["status", "errata", "resolution", "decision-amendment", "evidence-only"]);
  assert(ledger.approval_commit === expectedApprovalCommit, "ledger approval_commit is not A");
  sameSet(ledger.overlay_vocabulary, allowedOverlays, "ledger overlay vocabulary");
  expectedLedger.forEach(([kind, ticket, source, , artifact, overlays], index) => {
    const entry = ledger.entries[index];
    assert(entry.approved_commit === expectedApprovalCommit, "#" + ticket + " approved_commit is not A");
    sameSet(entry.overlay_kinds, overlays, "#" + ticket + " overlay kinds");
    assert(entry.overlay_kinds.every((kindName) => allowedOverlays.has(kindName)), "unknown overlay for #" + ticket);
    const finalBlob = kind === "prototype-evidence-only" ? objectId(artifact, source) : objectId(artifact);
    const sourceBlob = objectId(artifact, source);
    assert(entry.final_blob_sha === finalBlob, "#" + ticket + " final blob does not match target");
    if (kind !== "prototype-evidence-only") {
      assert(
        objectId(artifact, expectedApprovalCommit) === finalBlob,
        "#" + ticket + " final blob was not present in approval commit A",
      );
    }
    if (overlays.length === 0) {
      assert(finalBlob === sourceBlob, "#" + ticket + " claims no overlay but differs from source");
    } else if (kind !== "prototype-evidence-only") {
      assert(finalBlob !== sourceBlob, "#" + ticket + " declares overlay but equals source");
    }
  });
  return "13 final blobs, 12 approval-tree matches, and enumerated overlays approved by "
    + expectedApprovalCommit;
});

report("offline", "normative-contract-invariants", () => {
  const dossier = readObject("docs/implementation-dossier.md");
  const context = readObject("CONTEXT.md");
  const capability = readObject("docs/research/roam-obsidian-capability-map.md");
  const releaseDecision = readObject("docs/decisions/parity-acceptance-matrix-and-release-gates.md");
  for (const file of [
    "behavior-inventory.md", "scheduler-semantics.md", "execution-layer.md",
    "roam-obsidian-capability-map.md", "visual-interaction.md", "license-provenance.md",
  ]) {
    const source = readObject("docs/research/" + file);
    assert(source.includes("> Status:"), file + " lacks status overlay");
    assert(
      source.includes("[canonical implementation dossier](../implementation-dossier.md)"),
      file + " lacks dossier pointer",
    );
  }
  for (const heading of [
    "Canonical use and precedence", "Evidence ledger", "Versioned parity matrix",
    "Semantic and data contract", "Architecture and ownership", "State machines",
    "Write protocol", "Compatibility and performance", "Visual and interaction contract",
    "Keyboard, accessibility, and localization", "Privacy and offline contract",
    "License, provenance, and attribution", "Explicit deviations and drift boundary",
    "Risks and rollback boundaries", "Packaging and release gates", "Implementation task graph",
    "Residual-unknowns audit", "Done-when audit for the dossier ticket",
  ]) {
    assert(dossier.includes("## " + heading), "missing dossier heading: " + heading);
  }
  assert(dossier.includes("Version: \x601.2.0\x60"), "dossier version is not 1.2.0");
  assert(
    /status, errata, resolution, and\s+decision-amendment overlays/.test(dossier),
    "dossier does not enumerate final overlays",
  );
  assert(!dossier.includes("only the status pointer"), "dossier still claims status-only final changes");
  assert(
    dossier.includes("[ticket-boundary manifest](parity/ticket-boundaries.json)"),
    "dossier lacks ticket-boundary pointer",
  );
  assert(
    dossier.includes("UP-HIS-01..05")
      && /ticket #28 is their sole\s+primary owner/.test(dossier),
    "dossier lacks sole #28 UP-HIS ownership",
  );
  assert(
    dossier.includes("ticket #19 contributes history primitives as evidence only"),
    "dossier lacks #19 evidence-only history boundary",
  );
  assert(context.includes("**POMO**:") && context.includes("umbrella focus-cycle concept"), "POMO is not umbrella");
  assert(
    context.includes("**Task POMO**:") && context.includes("**Standalone POMO**:"),
    "CONTEXT lacks both POMO states",
  );
  assert(
    context.includes("[canonical implementation dossier](docs/implementation-dossier.md)"),
    "CONTEXT lacks normative dossier pointer",
  );
  assert(
    dossier.includes("\x60ActiveTaskView\x60 is the approved HOST replacement"),
    "dossier lacks ActiveTaskView contract",
  );
  for (const phrase of [
    "dedicated singleton", "reveals and focuses that same leaf", "authoritative source Markdown",
    "read-only unavailable state", "narrow dock",
  ]) {
    assert(dossier.includes(phrase), "ActiveTaskView contract lacks: " + phrase);
  }
  assert(
    capability.includes("dedicated singleton") && capability.includes("\x60ActiveTaskView\x60"),
    "capability resolution lacks ActiveTaskView",
  );
  assert(
    !capability.includes("The following questions remain genuinely unresolved"),
    "capability research still claims live unresolved choices",
  );
  for (const phrase of [
    "Ticket #22 first delivers every reusable release script",
    "ticket #30 pushes one",
    "runs G0-G6",
    "Ticket #31 runs and signs G7-G9",
    "owns no repository files",
  ]) {
    assert(dossier.includes(phrase), "release model lacks: " + phrase);
  }
  assert(
    releaseDecision.includes("All reusable release scripts, fixtures, scanners, schemas, and templates"),
    "release decision does not front-load reusable inputs",
  );
  assert(
    /must not commit or modify source, tests, build,\s*package, or release-input files/.test(releaseDecision),
    "release decision breaks exact-SHA freeze",
  );
  for (const namespace of ["\x60shared\x60", "\x60planner\x60", "\x60execution\x60", "\x60review\x60"]) {
    assert(dossier.includes(namespace), "dossier lacks i18n namespace " + namespace);
  }
  assert(dossier.includes("zero foundational unknowns remain before implementation"), "foundational fog remains");
  return "overlay, POMO, ActiveTaskView, i18n, release, ownership, and residual-fog invariants";
});

report("offline", "prototype-object-isolation", () => {
  const prototypeCommit = "5a2db368df31f6ded948a983fbceae38c455b611";
  const forbiddenRootPaths = new Set([".gitignore", "esbuild.mjs", "package-lock.json", "package.json", "tsconfig.json"]);
  const parseTree = (sha) => git("ls-tree", "-r", "--format=%(objectname) %(path)", sha)
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [object, ...pathParts] = line.split(" ");
      return { object, path: pathParts.join(" ") };
    });
  const forbiddenObjects = new Set(
    parseTree(prototypeCommit)
      .filter((entry) => entry.path.startsWith("prototype/") || forbiddenRootPaths.has(entry.path))
      .map((entry) => entry.object),
  );
  assert(forbiddenObjects.size === 17, "expected 17 prototype-only objects, found " + forbiddenObjects.size);
  const targetTree = parseTree(targetSha);
  for (const entry of targetTree) {
    assert(!entry.path.startsWith("prototype/"), "prototype path exists in target: " + entry.path);
    assert(!forbiddenObjects.has(entry.object), "prototype-only object copied to " + entry.path);
  }
  assert(
    spawnSync("git", ["merge-base", "--is-ancestor", prototypeCommit, targetSha], { cwd: root }).status === 1,
    "prototype commit is reachable from target",
  );
  const dossier = readObject("docs/implementation-dossier.md");
  assert(
    dossier.includes(prototypeCommit + "/prototype/evidence/issue-13/index.md"),
    "dossier lacks exact prototype evidence index",
  );
  assert(
    dossier.includes("releases/tag/evidence-prototype"),
    "dossier lacks approved prototype Release",
  );
  return targetTree.length + " target objects checked against prototype path/object/ancestry denylist";
});

const expectedBlockers = new Map([
  [17, []],
  [18, [17]],
  [19, [18]],
  [20, [18]],
  [21, [19, 20]],
  [22, [17]],
  [23, [21]],
  [24, [22, 23]],
  [25, [19, 20, 22]],
  [26, [21, 25]],
  [27, [24, 26]],
  [28, [19, 20, 26]],
  [29, [27, 28]],
  [30, [22, 24, 26, 29]],
  [31, [22, 30]],
]);

function assertDag(tasks) {
  const blockers = new Map(tasks.map((task) => [task.number, new Set(task.blocked_by)]));
  const resolved = new Set();
  while (resolved.size < tasks.length) {
    const takeable = tasks.filter(
      (task) => !resolved.has(task.number)
        && [...blockers.get(task.number)].every((number) => resolved.has(number)),
    );
    assert(takeable.length > 0, "task dependency graph contains a cycle");
    takeable.forEach((task) => resolved.add(task.number));
  }
}

let graph;
report("offline", "task-graph-manifest", () => {
  graph = readJsonObject("docs/planning-github-graph.json");
  assert(
    graph.schema_version === 1 && graph.repo === "oldwinter/obsidian-nautilus-log",
    "graph identity mismatch",
  );
  assert(
    graph.dossier_issue === 14 && graph.implementation_root === 16 && graph.pr === 32,
    "graph root/PR mismatch",
  );
  sameSet(graph.tasks.map((task) => task.number), range("", 17, 31).map(Number), "task issue set");
  for (const task of graph.tasks) {
    sameSet(task.blocked_by, expectedBlockers.get(task.number), "#" + task.number + " blockers");
  }
  assertDag(graph.tasks);
  sameSet(
    graph.tasks.filter((task) => task.blocked_by.length === 0).map((task) => task.number),
    [17],
    "initial frontier",
  );
  assert(
    graph.required_task_sections.includes("Primary requirement ownership"),
    "live task schema lacks Primary requirement ownership",
  );
  const dossier = readObject("docs/implementation-dossier.md");
  for (let issue = 16; issue <= 31; issue += 1) {
    assert(dossier.includes("issues/" + issue), "dossier does not link #" + issue);
  }
  return "#14 -> #16 -> #17-#31, exact blockers, DAG, frontier #17, and required ownership section";
});

function section(body, heading) {
  const marker = "## " + heading;
  const start = body.indexOf(marker);
  assert(start !== -1, "missing section: " + heading);
  const contentStart = body.indexOf("\n", start);
  const next = body.indexOf("\n## ", contentStart + 1);
  return body.slice(contentStart + 1, next === -1 ? body.length : next).trim();
}

function sectionJson(body, heading) {
  const content = section(body, heading);
  const fence = "\x60\x60\x60";
  assert(content.startsWith(fence + "json\n"), heading + " must start with a JSON code block");
  const end = content.indexOf("\n" + fence, fence.length + 5);
  assert(end !== -1, heading + " JSON code block is unclosed");
  try {
    return JSON.parse(content.slice(fence.length + 5, end));
  } catch (error) {
    fail(heading + " JSON is invalid: " + error.message);
  }
}

function claimedPrimaryFamilies(body) {
  const claims = [];
  let inFence = false;
  for (const line of body.split("\n")) {
    if (line.trim().startsWith("\x60\x60\x60")) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    for (const clause of line.split(/[.;]/)) {
      if (/evidence contribution|evidence[- ]only|not (?:a )?primary/i.test(clause)) continue;
      if (!/(?:mapped primary|primary (?:owner|ownership|for|\x60?UP-)|own(?:s|ing)? (?:all|every)|cover(?:s|ing)? every|all mapped)/i.test(clause)) {
        continue;
      }
      for (const family of clause.match(/UP-(?:INS|SET|PAR|SCH|DAY|HIS|VIS|CTL|CMP|EXE|CLK|CMD|PER|ERR|ERX|DRF)\b/g) ?? []) {
        claims.push(family);
      }
    }
  }
  return claims;
}

let liveRepo;
let livePrNumber;
let livePr;
let liveIssues;

function prepareLiveContext() {
  liveRepo = argValue("--repo", graph.repo);
  livePrNumber = Number(argValue("--pr", String(graph.pr)));
  liveIssues = new Map();

  report("live", "remote-pr-target", () => {
    const remote = command(
      "git",
      ["ls-remote", "origin", "refs/heads/wayfinder/implementation-dossier"],
    ).split(/\s+/)[0];
    livePr = ghJson([
      "pr",
      "view",
      String(livePrNumber),
      "--repo",
      liveRepo,
      "--json",
      "body,headRefOid,headRefName,isDraft,state,url",
    ]);
    assert(
      remote === targetSha && livePr.headRefOid === targetSha,
      "target/remote/PR mismatch: " + targetSha + "/" + remote + "/" + livePr.headRefOid,
    );
    assert(
      livePr.headRefName === "wayfinder/implementation-dossier",
      "PR #" + livePrNumber + " head branch mismatch",
    );
    assert(livePr.state === "OPEN", "PR #" + livePrNumber + " must be OPEN");
    return targetSha + " = remote = PR #" + livePrNumber
      + " head; no worktree cleanliness dependency";
  });

  report("live", "native-parent-relations", () => {
    const dossierChildren = ghJson([
      "api",
      "repos/" + liveRepo + "/issues/14/sub_issues",
      "--paginate",
    ]);
    const rootChildren = ghJson([
      "api",
      "repos/" + liveRepo + "/issues/16/sub_issues",
      "--paginate",
    ]);
    sameSet(dossierChildren.map((issue) => issue.number), [16], "#14 native children");
    sameSet(
      rootChildren.map((issue) => issue.number),
      range("", 17, 31).map(Number),
      "#16 native children",
    );
    for (let number = 14; number <= 31; number += 1) {
      liveIssues.set(number, ghJson(["api", "repos/" + liveRepo + "/issues/" + number]));
    }
    assert(liveIssues.get(16).parent_issue_url?.endsWith("/issues/14"), "#16 parent is not #14");
    for (let number = 17; number <= 31; number += 1) {
      assert(
        liveIssues.get(number).parent_issue_url?.endsWith("/issues/16"),
        "#" + number + " parent is not #16",
      );
    }
    return "#14 sole child #16; #16 exact children #17-#31; all parent pointers match";
  });

  report("live", "blocked-by-dag-frontier", () => {
    const liveTasks = [];
    for (const task of graph.tasks) {
      const blockers = ghJson([
        "api",
        "repos/" + liveRepo + "/issues/" + task.number + "/dependencies/blocked_by",
        "--paginate",
      ]).map((issue) => issue.number);
      sameSet(blockers, task.blocked_by, "live #" + task.number + " blockers");
      liveTasks.push({ number: task.number, blocked_by: blockers });
    }
    assertDag(liveTasks);
    const frontier = liveTasks
      .filter((task) => liveIssues.get(task.number).state === "open")
      .filter(
        (task) => task.blocked_by.every(
          (number) => liveIssues.get(number).state === "closed",
        ),
      );
    sameSet(frontier.map((task) => task.number), [17], "live frontier");
    assert(
      graph.tasks.every((task) => liveIssues.get(task.number).assignees.length === 0),
      "implementation tasks must remain unassigned",
    );
    return "15 exact blocker sets, acyclic, open/unassigned frontier #17";
  });

  report("live", "issue-fields-and-exact-dossier", () => {
    const exactDossierUrl = "https://github.com/" + liveRepo + "/blob/"
      + targetSha + "/docs/implementation-dossier.md";
    const rootBody = liveIssues.get(16).body ?? "";
    for (const heading of [
      "Outcome",
      "Unique implement-spec entry",
      "Native task graph",
      "Completion",
    ]) {
      assert(rootBody.includes("## " + heading), "#16 lacks " + heading);
    }
    for (let number = 16; number <= 31; number += 1) {
      assert(
        (liveIssues.get(number).body ?? "").includes(exactDossierUrl),
        "#" + number + " does not pin target dossier",
      );
    }
    for (const task of graph.tasks) {
      for (const heading of graph.required_task_sections) {
        assert(
          (liveIssues.get(task.number).body ?? "").includes("## " + heading),
          "#" + task.number + " lacks " + heading,
        );
      }
    }
    return "#16-#31 fields and dossier URL pinned to " + targetSha;
  });
}

function runLiveTicketContracts() {
  report("live", "ticket-owner-boundary-equality", () => {
    const ticketNumbers = range("", 17, 31).map(Number);
    const ownerRowsByTicket = new Map(
      ticketNumbers.map((ticket) => [ticket, new Set()]),
    );
    for (const row of ownerMap.requirements) {
      ownerRowsByTicket.get(row.owner_ticket).add(row.id);
    }
    const boundaryByTicket = new Map(
      boundaryManifest.tickets.map((entry) => [entry.ticket, entry]),
    );
    for (const ticket of ticketNumbers) {
      const body = liveIssues.get(ticket).body ?? "";
      const owning = sectionJson(body, "Owning files and modules");
      const primary = sectionJson(body, "Primary requirement ownership");
      const manifest = boundaryByTicket.get(ticket);
      sameSet(
        owning.allowed_module_boundaries,
        manifest.allowed_module_boundaries,
        "#" + ticket + " live module boundaries",
      );
      sameSet(
        owning.allowed_external_boundaries,
        manifest.allowed_external_boundaries,
        "#" + ticket + " live external boundaries",
      );
      sameSet(
        primary.primary_requirement_ids,
        manifest.primary_requirement_ids,
        "#" + ticket + " live primary vs manifest",
      );
      sameSet(
        primary.primary_requirement_ids,
        ownerRowsByTicket.get(ticket),
        "#" + ticket + " live primary vs owner map",
      );
      for (const family of claimedPrimaryFamilies(body)) {
        const completeFamily = ownerMap.requirements
          .filter((row) => row.id.startsWith(family + "-"))
          .map((row) => row.id);
        assert(
          completeFamily.every((id) => ownerRowsByTicket.get(ticket).has(id)),
          "#" + ticket + " makes non-owner primary-family claim for " + family,
        );
      }
    }
    return "live #17-#31 JSON equals manifest/map; non-owner primary-family claims rejected";
  });

  report("live", "ticket-contract-invariants", () => {
    const body = (number) => (liveIssues.get(number).body ?? "").toLowerCase();
    assert(
      body(17).includes("consumer") && body(17).includes("#22"),
      "#17 must be requirement-schema consumer/bootstrap only",
    );
    assert(
      !/cover every[^\n]*up-his/i.test(liveIssues.get(19).body ?? ""),
      "#19 still claims primary UP-HIS",
    );
    assert(
      body(19).includes("evidence contribution") && body(19).includes("#28"),
      "#19 lacks evidence-only handoff to #28",
    );
    assert(
      body(28).includes("up-his-01..05") && body(28).includes("sole primary"),
      "#28 lacks sole UP-HIS ownership statement",
    );
    for (const phrase of [
      "requirement",
      "fixtures",
      "scanners",
      "schemas",
      "templates",
    ]) {
      assert(body(22).includes(phrase), "#22 lacks " + phrase + " ownership");
    }
    assert(
      body(24).includes("shared")
        && body(24).includes("planner")
        && body(24).includes("resolver"),
      "#24 lacks shared/planner i18n ownership",
    );
    for (const phrase of [
      "activetaskview",
      "singleton",
      "reveal",
      "authoritative block id",
      "read-only",
      "stale",
      "missing",
      "keyboard",
      "narrow",
    ]) {
      assert(body(27).includes(phrase), "#27 ActiveTaskView lacks " + phrase);
    }
    assert(
      body(29).includes("review") && body(29).includes("namespace"),
      "#29 lacks review namespace ownership",
    );
    for (const phrase of ["clean pushed", "g0-g6", "freeze", "exact sha"]) {
      assert(body(30).includes(phrase), "#30 freeze contract lacks " + phrase);
    }
    for (const phrase of [
      "same sha",
      "g7-g9",
      "no repository files",
      "must not commit",
      "release-input",
    ]) {
      assert(body(31).includes(phrase), "#31 sign-off contract lacks " + phrase);
    }
    return "#17/#22 schemas, #19/#28 HIS, i18n, ActiveTaskView, and exact-SHA release split";
  });
}

function runLiveHandoff() {
  if (liveMode === "review-draft") {
    report("live", "review-draft-state", () => {
      assert(liveIssues.get(14).state === "open", "review-draft requires #14 OPEN");
      assert(livePr.isDraft === true, "review-draft requires PR draft");
      return "#14 OPEN and PR draft; parent-map and merge handoff intentionally not asserted";
    });
    return;
  }

  report("live", "merge-ready-handoff", () => {
    assert(liveIssues.get(14).state === "closed", "merge-ready requires #14 CLOSED");
    assert(livePr.isDraft === false, "merge-ready requires non-draft PR");
    assert(livePr.body.includes(targetSha), "PR body lacks exact target SHA");
    assert(
      livePr.body.includes("scripts/check-planning-docs.mjs")
        && /(?:validation|verification|验证)/i.test(livePr.body),
      "PR body lacks verification evidence",
    );
    assert(
      new RegExp("--sha\\s+" + targetSha).test(livePr.body),
      "PR body lacks exact --sha verification command",
    );
    assert(/Closes\s+#1\b/i.test(livePr.body), "PR body lacks Closes #1");

    const map = ghJson(["api", "repos/" + liveRepo + "/issues/1"]);
    const mapBody = map.body ?? "";
    for (let number = 2; number <= 7; number += 1) {
      assert(mapBody.includes("#" + number), "#1 lacks research #" + number);
    }
    assert(mapBody.includes("#14"), "#1 lacks dossier #14");
    assert(
      mapBody.includes("blob/" + targetSha + "/docs/implementation-dossier.md"),
      "#1 lacks exact dossier",
    );
    assert(mapBody.includes("/issues/16"), "#1 lacks implementation root #16");
    assert(/destination reached/i.test(mapBody), "#1 lacks destination reached");
    return "#14 closed, PR non-draft exact-SHA verification/Closes #1, and complete destination map";
  });
}

if (liveMode !== null) {
  prepareLiveContext();
  runLiveTicketContracts();
  runLiveHandoff();
}

if (failures.length > 0) {
  console.error(
    "\nplanning audit failed in " + failures.length
      + " categor" + (failures.length === 1 ? "y" : "ies") + ":",
  );
  failures.forEach((failure) => console.error("- " + failure));
  process.exitCode = 1;
} else {
  console.log(
    "\nplanning audit: PASS (target " + targetSha + "; "
      + (liveMode === null ? "offline" : "offline + live " + liveMode)
      + "; every category listed above)",
  );
}
