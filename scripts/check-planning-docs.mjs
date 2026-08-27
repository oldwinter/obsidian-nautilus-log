#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dossierPath = join(root, "docs/implementation-dossier.md");
const inventoryPath = join(root, "docs/research/behavior-inventory.md");

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}

function fail(message) {
  throw new Error(message);
}

const markdownFiles = [join(root, "README.md"), join(root, "CONTEXT.md"), ...walk(join(root, "docs"))]
  .filter((path) => extname(path) === ".md");

const localLinkPattern = /\[[^\]]*\]\(([^)]+)\)/g;
for (const file of markdownFiles) {
  const source = readFileSync(file, "utf8");
  for (const match of source.matchAll(localLinkPattern)) {
    const target = match[1].trim();
    if (target.startsWith("http://") || target.startsWith("https://") || target.startsWith("#") || target.startsWith("mailto:")) {
      continue;
    }
    const withoutAnchor = decodeURIComponent(target.split("#", 1)[0]);
    if (!withoutAnchor) continue;
    const resolved = normalize(resolve(dirname(file), withoutAnchor));
    if (!existsSync(resolved) || !statSync(resolved).isFile()) {
      fail(`Broken local link in ${file.slice(root.length + 1)}: ${target}`);
    }
  }
}

const inventory = readFileSync(inventoryPath, "utf8");
const upstreamIds = [...inventory.matchAll(/^\| ((?:INS|SET|PAR|SCH|DAY|HIS|VIS|CTL|CMP|EXE|CLK|CMD|PER|ERR|ERX|DRF)-\d{2}) \|/gm)]
  .map((match) => match[1]);
if (upstreamIds.length !== 114 || new Set(upstreamIds).size !== 114) {
  fail(`Expected 114 unique upstream requirements, found ${upstreamIds.length} rows / ${new Set(upstreamIds).size} unique IDs`);
}

const dossier = readFileSync(dossierPath, "utf8");
const requiredHeadings = [
  "Canonical use and precedence",
  "Evidence ledger",
  "Versioned parity matrix",
  "Semantic and data contract",
  "Architecture and ownership",
  "State machines",
  "Write protocol",
  "Compatibility and performance",
  "Visual and interaction contract",
  "Keyboard, accessibility, and localization",
  "Privacy and offline contract",
  "License, provenance, and attribution",
  "Explicit deviations and drift boundary",
  "Risks and rollback boundaries",
  "Packaging and release gates",
  "Implementation task graph",
  "Residual-unknowns audit",
  "Done-when audit for the dossier ticket",
];
for (const heading of requiredHeadings) {
  if (!dossier.includes(`## ${heading}`)) fail(`Missing dossier heading: ${heading}`);
}

const requiredShas = [
  "254976ab0c92611e59b8c9bb88d946d7b155212b",
  "d0d1c100f863a3cea43c0a37407670aa1a3997a4",
  "a43ae669a40799468e6473c6e8f8baac36143b1f",
  "d906db8ea949c36a9255116b5a535bc9d0afa211",
  "bce308843b3579f1be0afc5a2367e6b00e6feb9a",
  "b2400709e7dea84a1080864a35974f6f2c23c582",
  "343ae3f252b27f723a97eddaae8813f66a8c21fe",
  "7f3972c2f64bbcf4a6d31c00d262201836273dc2",
  "d09d766423326525be1c7e9e6a5d7dc3d8257426",
  "278b3e68c0db50c65b33d572a1a14ec4d8d1e05b",
  "0feaf0ec8f7dc470e06e7bf5d55f0cbc8c8d906c",
  "8b7b10abd70a4796c78d518fa3d697e38560fcba",
  "5a2db368df31f6ded948a983fbceae38c455b611",
];
for (const sha of requiredShas) {
  if (!dossier.includes(sha)) fail(`Dossier is missing exact source SHA: ${sha}`);
}

if (existsSync(join(root, "prototype/dockable-planner")) || existsSync(join(root, "prototype/evidence"))) {
  fail("Throwaway prototype source or evidence assets were integrated into the dossier branch");
}
if (dossier.includes("PENDING-ROOT-ISSUE")) fail("Implementation root issue has not been linked");
if (!dossier.includes("zero foundational unknowns remain before implementation")) {
  fail("Residual audit does not state its foundational-fog result");
}

console.log(`planning-docs: OK (${markdownFiles.length} Markdown files, 114 unique upstream IDs)`);
