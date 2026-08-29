import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

import * as esbuild from "esbuild";

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const outputPath = path.join(rootDir, "main.js");
const stylesOutputPath = path.join(rootDir, "styles.css");
const productionExtensions = new Set([".css", ".js", ".mjs", ".ts", ".tsx"]);
const markerExtensions = new Set([
  ".cjs",
  ".css",
  ".html",
  ".js",
  ".json",
  ".jsx",
  ".md",
  ".mjs",
  ".sh",
  ".ts",
  ".tsx",
  ".txt",
  ".yaml",
  ".yml",
]);
const provenanceFields = [
  "target_scope",
  "disposition",
  "source_repository",
  "source_commit",
  "source_path",
  "source_blob_sha",
  "creation_import_commit",
  "license",
  "notice",
  "modifications",
  "covering_tests",
  "reviewer",
  "verified_on",
  "release_artifact_impact",
];
const validDispositions = new Set([
  "behavioral-reimplementation",
  "copied",
  "excluded",
  "original",
  "ported",
]);
const copiedDispositions = new Set(["copied", "ported"]);
const shaPattern = /^[0-9a-f]{40}$/;
const sourceMarkerPattern = /@spiral-day-source\s+([0-9a-f]{40}):([^\s*]+)/g;

function fail(message) {
  throw new Error(message);
}

async function readText(relativePath) {
  return readFile(path.join(rootDir, relativePath), "utf8");
}

async function readJson(relativePath) {
  return JSON.parse(await readText(relativePath));
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function validateNonemptyString(row, field, label) {
  if (typeof row[field] !== "string" || row[field].trim() === "") {
    fail(`${label}: ${field} must be a non-empty string`);
  }
}

function validateProvenanceRow(row, knownNotices) {
  const label = `provenance row ${String(row?.target_scope ?? "<unknown>")}`;

  if (!row || typeof row !== "object" || Array.isArray(row)) {
    fail("provenance row must be an object");
  }
  for (const field of provenanceFields) {
    if (!Object.hasOwn(row, field)) {
      fail(`${label}: missing required field ${field}`);
    }
  }
  for (const field of [
    "target_scope",
    "disposition",
    "source_repository",
    "source_commit",
    "source_path",
    "source_blob_sha",
    "creation_import_commit",
    "license",
    "modifications",
    "reviewer",
    "verified_on",
    "release_artifact_impact",
  ]) {
    validateNonemptyString(row, field, label);
  }
  if (!validDispositions.has(row.disposition)) {
    fail(`${label}: unsupported disposition ${row.disposition}`);
  }
  if (!Array.isArray(row.notice)) {
    fail(`${label}: notice must be an array of notice IDs`);
  }
  if (!Array.isArray(row.covering_tests) || row.covering_tests.length === 0) {
    fail(`${label}: covering_tests must contain at least one stable test ID`);
  }
  if (row.covering_tests.some((testId) => typeof testId !== "string" || testId.trim() === "")) {
    fail(`${label}: covering_tests contains an invalid test ID`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(row.verified_on)) {
    fail(`${label}: verified_on must use YYYY-MM-DD`);
  }
  for (const noticeId of row.notice) {
    if (typeof noticeId !== "string" || !knownNotices.has(noticeId)) {
      fail(`${label}: notice ${String(noticeId)} has no verbatim notice block`);
    }
  }

  if (copiedDispositions.has(row.disposition)) {
    if (!/^https:\/\//.test(row.source_repository)) {
      fail(`${label}: copied/ported source_repository must be an HTTPS URL`);
    }
    if (!shaPattern.test(row.source_commit)) {
      fail(`${label}: copied/ported source_commit must be a 40-character SHA`);
    }
    if (!shaPattern.test(row.source_blob_sha)) {
      fail(`${label}: copied/ported source_blob_sha must be a 40-character SHA`);
    }
    if (row.notice.length === 0) {
      fail(`${label}: copied/ported units require at least one applicable notice`);
    }
  }
}

function parseNoticeBlocks(noticesText) {
  const notices = new Map();
  const beginPattern = /<!-- notice:([A-Z0-9-]+):begin -->/g;

  for (const match of noticesText.matchAll(beginPattern)) {
    const id = match[1];
    const bodyStart = (match.index ?? 0) + match[0].length;
    const endMarker = `<!-- notice:${id}:end -->`;
    const bodyEnd = noticesText.indexOf(endMarker, bodyStart);
    if (bodyEnd < 0) {
      fail(`THIRD_PARTY_NOTICES.md: missing end marker for ${id}`);
    }
    const body = noticesText.slice(bodyStart, bodyEnd).trim();
    if (body === "" || notices.has(id)) {
      fail(`THIRD_PARTY_NOTICES.md: invalid or duplicate notice ${id}`);
    }
    notices.set(id, body);
  }

  return notices;
}

function parseProvenanceLedger(provenanceText) {
  const match = provenanceText.match(
    /<!-- provenance-ledger:begin -->\s*```json\s*([\s\S]*?)\s*```\s*<!-- provenance-ledger:end -->/,
  );
  if (!match?.[1]) {
    fail("PROVENANCE.md: machine-readable ledger block is missing");
  }
  return JSON.parse(match[1]);
}

async function listFiles(
  relativeDirectory,
  predicate = () => true,
  shouldVisitDirectory = () => true,
) {
  const files = [];

  async function visit(relativeDirectory) {
    const absoluteDirectory = path.join(rootDir, relativeDirectory);
    if (!existsSync(absoluteDirectory)) return;
    for (const entry of await readdir(absoluteDirectory, { withFileTypes: true })) {
      const relativePath = path.posix.join(relativeDirectory, entry.name);
      if (entry.isDirectory()) {
        if (shouldVisitDirectory(relativePath)) await visit(relativePath);
      } else if (entry.isFile() && predicate(relativePath)) {
        files.push(relativePath);
      }
    }
  }

  await visit(relativeDirectory);
  return files.sort();
}

async function listProductionFiles() {
  const files = await Promise.all(
    ["src", "styles"].map((directory) =>
      listFiles(directory, (file) => productionExtensions.has(path.extname(file))),
    ),
  );
  return files.flat().sort();
}

function parseSourceMarkers(sourceText) {
  return [...sourceText.matchAll(sourceMarkerPattern)].map((match) => ({
    sourceCommit: match[1],
    sourcePath: match[2],
  }));
}

async function listGloballyMarkedFiles() {
  const isRepositoryPath = (file) => {
    const [firstSegment] = file.split("/");
    return firstSegment !== ".git" && firstSegment !== "node_modules";
  };
  const candidates = await listFiles(
    ".",
    (file) => isRepositoryPath(file) && file !== "main.js" && markerExtensions.has(path.extname(file)),
    isRepositoryPath,
  );
  const marked = [];
  for (const file of candidates) {
    const markers = parseSourceMarkers(await readText(file));
    if (markers.length > 0) marked.push({ file, markers });
  }
  return marked;
}

function targetFile(targetScope) {
  return targetScope.split("#", 1)[0];
}

function validateProvenanceMarkers(markedFiles, rows) {
  const copiedRows = rows.filter((row) => copiedDispositions.has(row.disposition));
  const markerMatchesRow = (file, marker, row) =>
    targetFile(row.target_scope) === file
    && row.source_commit === marker.sourceCommit
    && row.source_path === marker.sourcePath;

  for (const { file, markers } of markedFiles) {
    for (const marker of markers) {
      if (!copiedRows.some((row) => markerMatchesRow(file, marker, row))) {
        fail(`${file}: source marker has no matching copied or ported ledger row`);
      }
    }
  }

  for (const row of copiedRows) {
    const file = targetFile(row.target_scope);
    const markedFile = markedFiles.find((candidate) => candidate.file === file);
    if (!markedFile?.markers.some((marker) => markerMatchesRow(file, marker, row))) {
      fail(`${file}: copied/ported ledger row ${row.target_scope} requires a matching source marker`);
    }
  }
}

async function loadAndValidateProvenance() {
  const [provenanceText, noticesText, markedFiles, productionFiles] = await Promise.all([
    readText("PROVENANCE.md"),
    readText("THIRD_PARTY_NOTICES.md"),
    listGloballyMarkedFiles(),
    listProductionFiles(),
  ]);
  const notices = parseNoticeBlocks(noticesText);
  const ledger = parseProvenanceLedger(provenanceText);

  if (ledger.schema_version !== 1 || !Array.isArray(ledger.rows)) {
    fail("PROVENANCE.md: expected schema_version 1 and a rows array");
  }

  const rowsByTarget = new Map();
  for (const row of ledger.rows) {
    validateProvenanceRow(row, notices);
    if (rowsByTarget.has(row.target_scope)) {
      fail(`PROVENANCE.md: duplicate target_scope ${row.target_scope}`);
    }
    rowsByTarget.set(row.target_scope, row);
  }

  validateProvenanceMarkers(markedFiles, ledger.rows);

  return { ledger, markedFiles, notices, productionFiles };
}

async function validateRequirementContract() {
  const contract = await readJson("docs/parity/requirement-owners.json");
  if (!Array.isArray(contract.requirements)) {
    fail("requirement-owners.json: requirements must be an array");
  }

  const expectedFoundation = new Map([
    ["UP-DRF-01", "README.md"],
    ["UP-INS-01", "README.md"],
  ]);
  const foundationOwned = contract.requirements.filter((row) => row.owner_ticket === 17);
  if (foundationOwned.length !== expectedFoundation.size) {
    fail(`requirement-owners.json: ticket 17 owns ${foundationOwned.length}, expected ${expectedFoundation.size}`);
  }
  for (const row of foundationOwned) {
    if (expectedFoundation.get(row.id) !== row.owner_module) {
      fail(`requirement-owners.json: unexpected ticket 17 assignment ${row.id} -> ${row.owner_module}`);
    }
    expectedFoundation.delete(row.id);
  }
  if (expectedFoundation.size !== 0) {
    fail(`requirement-owners.json: missing ticket 17 IDs ${[...expectedFoundation.keys()].join(", ")}`);
  }

  for (const id of ["UP-INS-02", "OBS-LOCAL-001"]) {
    const row = contract.requirements.find((candidate) => candidate.id === id);
    if (row?.owner_ticket !== 27 || row.owner_module !== "src/main.ts") {
      fail(`requirement-owners.json: expected ${id} -> ticket 27 src/main.ts`);
    }
  }
}

async function validateManifestAndPackage() {
  const [manifest, packageJson, versions, lockfile, readme] = await Promise.all([
    readJson("manifest.json"),
    readJson("package.json"),
    readJson("versions.json"),
    readJson("package-lock.json"),
    readText("README.md"),
  ]);
  const expectedManifest = {
    id: "spiral-day",
    name: "Spiral Day",
    minAppVersion: "1.7.7",
    description: "An unofficial Obsidian-native parity port of Roam Nautilus Log v1.0.2.",
    isDesktopOnly: true,
  };

  for (const [field, value] of Object.entries(expectedManifest)) {
    if (manifest[field] !== value) {
      fail(`manifest.json: ${field} must be ${JSON.stringify(value)}`);
    }
  }
  if (manifest.version !== packageJson.version || versions[manifest.version] !== manifest.minAppVersion) {
    fail("manifest.json, package.json, and versions.json must agree on version and app floor");
  }
  if (packageJson.name !== manifest.id || packageJson.main !== "main.js" || packageJson.private !== true) {
    fail("package.json: name/main/private do not match the foundation contract");
  }
  if (packageJson.dependencies && Object.keys(packageJson.dependencies).length > 0) {
    fail("package.json: production dependencies are not allowed in the foundation");
  }
  if (packageJson.optionalDependencies || packageJson.bundleDependencies || packageJson.bundledDependencies) {
    fail("package.json: optional, bundled, and native dependency channels are not allowed");
  }
  if (lockfile.lockfileVersion !== 3 || lockfile.packages?.[""]?.version !== packageJson.version) {
    fail("package-lock.json: expected a matching lockfileVersion 3 root package");
  }
  for (const [name, version] of Object.entries(packageJson.devDependencies ?? {})) {
    if (lockfile.packages?.[""]?.devDependencies?.[name] !== version) {
      fail(`package-lock.json: root dev dependency ${name} is not exactly locked from package.json`);
    }
  }
  if (!readme.includes(`Foundation version: \`${manifest.version}\``)) {
    fail("README.md: documented foundation version must match manifest.json");
  }
}

async function scanRuntimeInputs() {
  const productionFiles = await listProductionFiles();
  const networkPattern = /\b(fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon)\b|\b(analytics|telemetry)\b/i;
  const forbiddenInputPattern = /issue-13|prototype\/|extension\.js|extension\.css|bp3-icon|nautilus-log-overview\.png/i;

  for (const file of productionFiles) {
    const source = await readText(file);
    if (networkPattern.test(source)) fail(`${file}: network or telemetry API/token is forbidden`);
    if (forbiddenInputPattern.test(source)) fail(`${file}: forbidden upstream/prototype input token found`);
  }
}

async function validateFoundation() {
  await Promise.all([
    validateManifestAndPackage(),
    validateRequirementContract(),
    loadAndValidateProvenance(),
    scanRuntimeInputs(),
  ]);
}

function makeBanner(packageJson, ledger, notices) {
  const selectedNoticeIds = new Set();
  for (const row of ledger.rows) {
    if (copiedDispositions.has(row.disposition)) {
      for (const noticeId of row.notice) selectedNoticeIds.add(noticeId);
    }
  }
  const selectedNotices = [...selectedNoticeIds]
    .sort()
    .map((id) => `${id}\n\n${notices.get(id)}`)
    .join("\n\n");
  const legalText = [
    `Spiral Day v${packageJson.version}`,
    "Copyright (c) 2026 oldwinter",
    "MIT licensed. See LICENSE, THIRD_PARTY_NOTICES.md, and PROVENANCE.md.",
    "Unofficial, independently maintained Obsidian-native parity port.",
    selectedNotices,
  ]
    .filter(Boolean)
    .join("\n\n");

  return `/*!\n${legalText}\n*/`;
}

const allowedHostExternals = new Set([
  "obsidian",
  "@codemirror/autocomplete",
  "@codemirror/collab",
  "@codemirror/commands",
  "@codemirror/language",
  "@codemirror/lint",
  "@codemirror/search",
  "@codemirror/state",
  "@codemirror/view",
  "@lezer/common",
  "@lezer/highlight",
  "@lezer/lr",
]);

function validateRuntimeImports(result) {
  for (const [outputPath, output] of Object.entries(result.metafile?.outputs ?? {})) {
    for (const imported of output.imports ?? []) {
      if (imported.external && !allowedHostExternals.has(imported.path)) {
        fail(`${outputPath}: runtime import ${imported.path} is not an allowed Obsidian host external`);
      }
    }
  }
}

async function createProductionBundle() {
  const [{ ledger, notices }, packageJson] = await Promise.all([
    loadAndValidateProvenance(),
    readJson("package.json"),
  ]);
  const result = await esbuild.build({
    absWorkingDir: rootDir,
    banner: { js: makeBanner(packageJson, ledger, notices) },
    bundle: true,
    charset: "utf8",
    entryPoints: ["src/main.ts"],
    external: [...allowedHostExternals],
    format: "cjs",
    legalComments: "none",
    logLevel: "silent",
    metafile: true,
    minify: true,
    outfile: outputPath,
    platform: "browser",
    sourcemap: false,
    target: "es2021",
    treeShaking: true,
    write: false,
  });
  validateRuntimeImports(result);
  return result;
}

async function createStylesBundle() {
  const files = await listFiles("styles", (file) => path.extname(file) === ".css");
  if (files.length === 0) fail("production styles require at least one styles/**/*.css input");
  const sections = await Promise.all(files.map(async (file) =>
    `/* ${file} */\n${(await readText(file)).trimEnd()}\n`));
  return new TextEncoder().encode(`${sections.join("\n")}\n`);
}

function onlyOutput(result) {
  if (result.outputFiles?.length !== 1) {
    fail(`production build emitted ${result.outputFiles?.length ?? 0} files, expected one main.js`);
  }
  const outputs = Object.keys(result.metafile?.outputs ?? {});
  if (outputs.length !== 1 || path.basename(outputs[0]) !== "main.js") {
    fail(`production build output allowlist failed: ${outputs.join(", ")}`);
  }
  return result.outputFiles[0].contents;
}

function scanBundle(bundleBytes) {
  const bundle = Buffer.from(bundleBytes).toString("utf8");
  const forbidden = [
    ["prototype source", /issue-13|prototype\//i],
    ["upstream asset or bundle", /extension\.js|extension\.css|nautilus-log-overview\.png/i],
    ["network API", /\b(fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon)\b/],
    ["telemetry", /\b(analytics|telemetry)\b/i],
  ];
  for (const [label, pattern] of forbidden) {
    if (pattern.test(bundle)) fail(`main.js contains forbidden ${label}`);
  }
  if (!bundle.startsWith("/*!\nSpiral Day v")) {
    fail("main.js is missing the minifier-preserved Spiral Day banner");
  }
  for (const match of bundle.matchAll(/\brequire\(["']([^"']+)["']\)/g)) {
    if (!allowedHostExternals.has(match[1])) {
      fail(`main.js contains non-host runtime import ${match[1]}`);
    }
  }
}

async function buildProduction() {
  await validateFoundation();
  const [first, second, firstStyles, secondStyles] = await Promise.all([
    createProductionBundle(),
    createProductionBundle(),
    createStylesBundle(),
    createStylesBundle(),
  ]);
  const firstBytes = onlyOutput(first);
  const secondBytes = onlyOutput(second);

  if (!Buffer.from(firstBytes).equals(Buffer.from(secondBytes))) {
    fail("two production builds from the same tree were not byte-identical");
  }
  if (!Buffer.from(firstStyles).equals(Buffer.from(secondStyles))) {
    fail("two stylesheet builds from the same tree were not byte-identical");
  }
  scanBundle(firstBytes);
  await Promise.all([
    writeFile(outputPath, firstBytes),
    writeFile(stylesOutputPath, firstStyles),
  ]);
  console.log(
    `build: manifest.json, main.js (${firstBytes.byteLength} bytes, sha256 ${sha256(firstBytes)}), `
    + `styles.css (${firstStyles.byteLength} bytes, sha256 ${sha256(firstStyles)})`,
  );
}

function makeCopiedRow() {
  return {
    target_scope: "src/example.ts",
    disposition: "ported",
    source_repository: "https://example.com/source.git",
    source_commit: "a".repeat(40),
    source_path: "src/example.js",
    source_blob_sha: "b".repeat(40),
    creation_import_commit: "c".repeat(40),
    license: "MIT",
    notice: ["NAUTILUS-LINEAGE-MIT"],
    modifications: "Ported to TypeScript.",
    covering_tests: ["FND-PROVENANCE-NEGATIVE-001"],
    reviewer: "test reviewer",
    verified_on: "2026-08-28",
    release_artifact_impact: "Bundled into main.js.",
  };
}

function runProvenanceNegativeTests(knownNotices) {
  const row = makeCopiedRow();
  validateProvenanceRow(row, knownNotices);

  for (const field of provenanceFields) {
    const invalid = structuredClone(row);
    delete invalid[field];
    assert.throws(
      () => validateProvenanceRow(invalid, knownNotices),
      undefined,
      `missing copied/ported ${field} must fail`,
    );
  }

  const missingNotice = structuredClone(row);
  missingNotice.notice = [];
  assert.throws(() => validateProvenanceRow(missingNotice, knownNotices));

  const movingSource = structuredClone(row);
  movingSource.source_commit = "main";
  assert.throws(() => validateProvenanceRow(movingSource, knownNotices));

  const noTest = structuredClone(row);
  noTest.covering_tests = [];
  assert.throws(() => validateProvenanceRow(noTest, knownNotices));

  const unknownNotice = structuredClone(row);
  unknownNotice.notice = ["UNKNOWN-NOTICE"];
  assert.throws(
    () => validateProvenanceRow(unknownNotice, knownNotices),
    /has no verbatim notice block/,
  );

  const markedTest = {
    file: "packages/downstream/tests/fixtures/ported-upstream.test.ts",
    markers: parseSourceMarkers(
      `// @spiral-day-source ${row.source_commit}:${row.source_path}`,
    ),
  };
  assert.equal(markedTest.markers.length, 1);
  assert.throws(
    () => validateProvenanceMarkers([markedTest], []),
    /source marker has no matching copied or ported ledger row/,
  );

  const testRow = structuredClone(row);
  testRow.target_scope = markedTest.file;
  validateProvenanceMarkers([markedTest], [testRow]);

  const mismatchedMarker = structuredClone(markedTest);
  mismatchedMarker.markers[0].sourcePath = "src/different.js";
  assert.throws(
    () => validateProvenanceMarkers([mismatchedMarker], [testRow]),
    /source marker has no matching copied or ported ledger row/,
  );
  assert.throws(
    () => validateProvenanceMarkers([], [testRow]),
    /requires a matching source marker/,
  );
}

function runRuntimeImportPolicyTests() {
  const resultFor = (path) => ({
    metafile: {
      outputs: {
        "src/main.ts": { imports: [{ external: true, kind: "import-statement", path }] },
      },
    },
  });

  validateRuntimeImports(resultFor("obsidian"));
  assert.throws(
    () => validateRuntimeImports(resultFor("http")),
    /runtime import http is not an allowed/,
  );
  assert.throws(
    () => validateRuntimeImports(resultFor("node:http")),
    /runtime import node:http is not an allowed/,
  );
  assert.throws(
    () => validateRuntimeImports(resultFor("electron")),
    /runtime import electron is not an allowed/,
  );
}

async function createLifecycleBundle() {
  const hostPlugin = {
    name: "foundation-host-stub",
    setup(build) {
      build.onResolve({ filter: /^obsidian$/ }, () => ({ path: "obsidian", namespace: "foundation" }));
      build.onLoad({ filter: /.*/, namespace: "foundation" }, () => ({
        contents: `
          const classList = () => ({ add() {}, remove() {} });
          export class TFile {}
          export class MarkdownView {}
          export class ItemView {}
          export class Notice {
            constructor() { this.noticeEl = { dataset: {}, classList: classList() }; }
          }
          export class PluginSettingTab {
            constructor(app, plugin) {
              this.app = app;
              this.plugin = plugin;
              this.containerEl = { replaceChildren() {}, ownerDocument: { createElement() { return {}; } } };
            }
            hide() {}
          }
          export class Setting {
            constructor() {}
          }
          export function setIcon() {}
          export class Plugin {
            constructor(app, manifest) {
              this.app = app;
              this.manifest = manifest;
              this.cleanups = [];
              this.commands = new Set();
            }
            track(cleanup) { this.cleanups.push(cleanup); }
            addCommand(command) {
              globalThis.__foundationState.registrations += 1;
              this.commands.add(command.id);
              this.track(() => this.removeCommand(command.id));
              return command;
            }
            removeCommand(id) {
              if (!this.commands.delete(id)) return;
              globalThis.__foundationState.registrations -= 1;
            }
            addRibbonIcon() {
              globalThis.__foundationState.dom += 1;
              let removed = false;
              const element = {
                classList: classList(),
                setAttribute() {},
                remove() {
                  if (removed) return;
                  removed = true;
                  globalThis.__foundationState.dom -= 1;
                },
              };
              this.track(() => element.remove());
              return element;
            }
            addSettingTab() {
              globalThis.__foundationState.registrations += 1;
              this.track(() => { globalThis.__foundationState.registrations -= 1; });
            }
            register(callback) { this.track(callback); }
            registerDomEvent() {
              globalThis.__foundationState.listeners += 1;
              this.track(() => { globalThis.__foundationState.listeners -= 1; });
            }
            registerEvent() {
              globalThis.__foundationState.listeners += 1;
              this.track(() => { globalThis.__foundationState.listeners -= 1; });
            }
            registerInterval(handle) { this.track(() => globalThis.clearInterval(handle)); }
            registerView() {
              globalThis.__foundationState.registrations += 1;
              this.track(() => { globalThis.__foundationState.registrations -= 1; });
            }
            async loadData() { return undefined; }
            async saveData() { globalThis.__foundationState.pluginDataWrites += 1; }
            unload() {
              this.onunload();
              for (const cleanup of this.cleanups.splice(0).reverse()) cleanup();
            }
          }
        `,
        loader: "js",
      }));
    },
  };

  const result = await esbuild.build({
    absWorkingDir: rootDir,
    bundle: true,
    entryPoints: ["src/main.ts"],
    format: "cjs",
    logLevel: "silent",
    minify: false,
    platform: "node",
    plugins: [hostPlugin],
    target: "node18",
    write: false,
  });
  return Buffer.from(result.outputFiles[0].contents).toString("utf8");
}

async function runLifecycleTest() {
  const state = {
    consoleErrors: 0,
    dom: 0,
    listeners: 0,
    markdownReads: 0,
    markdownWrites: 0,
    network: 0,
    pluginDataWrites: 0,
    registrations: 0,
    timers: 0,
  };
  const notes = new Map([
    ["ordinary.md", "# Ordinary note\n\nUntouched content.\n"],
    [".obsidian/plugins/nautilus-log/data.json", '{"sentinel":"untouched"}\n'],
  ]);
  const before = sha256(JSON.stringify([...notes]));
  const eventRef = Object.freeze({});
  const vault = {
    cachedRead: async () => {
      state.markdownReads += 1;
      return "";
    },
    getAbstractFileByPath: () => null,
    getMarkdownFiles: () => [],
    on: () => eventRef,
    process: async () => {
      state.markdownWrites += 1;
      return "";
    },
  };
  const workspace = {
    detachLeavesOfType() {},
    getActiveViewOfType: () => null,
    getLeavesOfType: () => [],
    on: () => eventRef,
    rightSplit: Object.freeze({}),
  };
  const app = {
    metadataCache: { on: () => eventRef },
    vault,
    workspace,
  };
  let nextTimer = 1;
  const activeTimers = new Set();
  const startTimer = () => {
    const handle = nextTimer++;
    activeTimers.add(handle);
    state.timers = activeTimers.size;
    return handle;
  };
  const clearTimer = (handle) => {
    activeTimers.delete(handle);
    state.timers = activeTimers.size;
  };
  const sandbox = {
    __foundationState: state,
    AbortController,
    clearInterval: clearTimer,
    clearTimeout: clearTimer,
    console: {
      error: () => {
        state.consoleErrors += 1;
      },
      log: () => {},
      warn: () => {},
    },
    document: new Proxy(
      {},
      {
        get() {
          return () => {
            state.dom += 1;
            return {};
          };
        },
      },
    ),
    DOMException,
    EventSource: class {
      constructor() {
        state.network += 1;
      }
    },
    exports: {},
    fetch: async () => {
      state.network += 1;
      return {};
    },
    module: { exports: {} },
    navigator: {
      sendBeacon: () => {
        state.network += 1;
        return false;
      },
    },
    performance: { now: () => 0 },
    setInterval: startTimer,
    setTimeout: startTimer,
    TextEncoder,
    WebSocket: class {
      constructor() {
        state.network += 1;
      }
    },
    XMLHttpRequest: class {
      constructor() {
        state.network += 1;
      }
    },
  };
  sandbox.exports = sandbox.module.exports;
  const context = vm.createContext(sandbox);
  new vm.Script(await createLifecycleBundle(), { filename: "main.lifecycle.cjs" }).runInContext(context);
  const PluginClass = sandbox.module.exports.default;
  assert.equal(typeof PluginClass, "function");

  for (let cycle = 1; cycle <= 10; cycle += 1) {
    const plugin = new PluginClass(
      app,
      { id: "spiral-day", name: "Spiral Day", version: "0.1.0" },
    );
    await plugin.onload();
    plugin.unload();
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(state.registrations, 0, `cycle ${cycle} retained registrations`);
    assert.equal(state.listeners, 0, `cycle ${cycle} retained listeners`);
    assert.equal(state.dom, 0, `cycle ${cycle} retained DOM`);
    assert.equal(state.timers, 0, `cycle ${cycle} retained timers`);
  }

  assert.deepEqual(state, {
    consoleErrors: 0,
    dom: 0,
    listeners: 0,
    markdownReads: 0,
    markdownWrites: 0,
    network: 0,
    pluginDataWrites: 0,
    registrations: 0,
    timers: 0,
  });
  assert.equal(sha256(JSON.stringify([...notes])), before);
}

async function runTests() {
  await validateFoundation();
  const { notices } = await loadAndValidateProvenance();
  runProvenanceNegativeTests(new Set(notices.keys()));
  runRuntimeImportPolicyTests();
  await runLifecycleTest();
  const [first, second] = await Promise.all([createProductionBundle(), createProductionBundle()]);
  assert.deepEqual(Buffer.from(onlyOutput(first)), Buffer.from(onlyOutput(second)));
  const [firstStyles, secondStyles] = await Promise.all([createStylesBundle(), createStylesBundle()]);
  assert.deepEqual(Buffer.from(firstStyles), Buffer.from(secondStyles));
  scanBundle(onlyOutput(first));
  execFileSync(process.execPath, ["tests/ui/execution/run.mjs"], {
    cwd: rootDir,
    stdio: "inherit",
  });
  console.log(
    "tests: provenance-negative, unledgered-marked-test, runtime-import-policy, lifecycle-10x, no-write, local-only, deterministic-bundle, execution-ui passed",
  );
}

async function main() {
  const command = process.argv[2] ?? "validate";
  if (command === "clean") {
    await Promise.all([rm(outputPath, { force: true }), rm(stylesOutputPath, { force: true })]);
    console.log("clean: removed generated main.js and styles.css");
  } else if (command === "provenance") {
    const result = await loadAndValidateProvenance();
    console.log(
      `provenance: ${result.ledger.rows.length} rows, ${result.markedFiles.length} marked files, ${result.productionFiles.length} production files`,
    );
  } else if (command === "validate") {
    await validateFoundation();
    console.log("validate: manifest, package, #22 contract, provenance, local-only inputs passed");
  } else if (command === "test") {
    await runTests();
  } else if (command === "build") {
    await buildProduction();
  } else {
    fail(`unknown command ${command}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
