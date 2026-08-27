#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

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

export function discoverRelativeMarkdownLinks(source, markdown) {
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
    const key = `${source}\0${href}`;
    const occurrence = (ordinals.get(key) ?? 0) + 1;
    ordinals.set(key, occurrence);
    return { source, href, target: destinationTarget(source, href), occurrence };
  });
}

const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], {
  cwd: root,
  encoding: "utf8",
}).trim().split("\n").filter((path) => path.endsWith(".md")).sort();
const links = files.flatMap((source) => discoverRelativeMarkdownLinks(source, readFileSync(resolve(root, source), "utf8")));
const output = { schema_version: 2, discovery: "all-inline-and-reference-definition-relative-destinations", links };
writeFileSync(resolve(root, "docs/planning-local-links.json"), `${JSON.stringify(output, null, 2)}\n`);
