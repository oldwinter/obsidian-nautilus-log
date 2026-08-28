import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { archiveCandidate, CandidateError, requireFullSha } from "./candidate-object.mjs";

const execFileAsync = promisify(execFile);
const PACKAGE_ASSETS = ["main.js", "manifest.json"];
const OPTIONAL_PACKAGE_ASSETS = ["styles.css"];

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function crc32(value) {
  let crc = 0xffffffff;
  for (const byte of value) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function localHeader(name, content) {
  const filename = Buffer.from(name, "utf8");
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(0, 6);
  header.writeUInt16LE(0, 8);
  header.writeUInt16LE(0, 10);
  header.writeUInt16LE(0x21, 12);
  header.writeUInt32LE(crc32(content), 14);
  header.writeUInt32LE(content.length, 18);
  header.writeUInt32LE(content.length, 22);
  header.writeUInt16LE(filename.length, 26);
  header.writeUInt16LE(0, 28);
  return Buffer.concat([header, filename, content]);
}

function centralHeader(name, content, offset) {
  const filename = Buffer.from(name, "utf8");
  const header = Buffer.alloc(46);
  header.writeUInt32LE(0x02014b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(20, 6);
  header.writeUInt16LE(0, 8);
  header.writeUInt16LE(0, 10);
  header.writeUInt16LE(0, 12);
  header.writeUInt16LE(0x21, 14);
  header.writeUInt32LE(crc32(content), 16);
  header.writeUInt32LE(content.length, 20);
  header.writeUInt32LE(content.length, 24);
  header.writeUInt16LE(filename.length, 28);
  header.writeUInt16LE(0, 30);
  header.writeUInt16LE(0, 32);
  header.writeUInt16LE(0, 34);
  header.writeUInt16LE(0, 36);
  header.writeUInt32LE(0, 38);
  header.writeUInt32LE(offset, 42);
  return Buffer.concat([header, filename]);
}

export function createDeterministicPackage(entries) {
  const normalized = [...entries]
    .map(({ path: entryPath, content }) => ({
      path: String(entryPath),
      content: Buffer.isBuffer(content) ? content : Buffer.from(content),
    }))
    .sort((left, right) => left.path.localeCompare(right.path));
  const names = new Set();
  let offset = 0;
  const localParts = [];
  const centralParts = [];

  for (const entry of normalized) {
    if (!/^[A-Za-z0-9._-]+$/.test(entry.path) || names.has(entry.path)) {
      throw new CandidateError(`invalid or duplicate package asset ${entry.path}`);
    }
    names.add(entry.path);
    const local = localHeader(entry.path, entry.content);
    localParts.push(local);
    centralParts.push(centralHeader(entry.path, entry.content, offset));
    offset += local.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(normalized.length, 8);
  end.writeUInt16LE(normalized.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...localParts, centralDirectory, end]);
}

async function buildArchivedCandidate(repository, candidateSha) {
  const archive = await archiveCandidate(repository, candidateSha);
  try {
    await execFileAsync("npm", ["ci", "--ignore-scripts", "--no-audit", "--no-fund"], {
      cwd: archive.path,
      maxBuffer: 64 * 1024 * 1024,
    });
    await execFileAsync("npm", ["run", "build"], {
      cwd: archive.path,
      maxBuffer: 64 * 1024 * 1024,
    });

    const entries = [];
    for (const asset of [...PACKAGE_ASSETS, ...OPTIONAL_PACKAGE_ASSETS]) {
      try {
        entries.push({ path: asset, content: await readFile(path.join(archive.path, asset)) });
      } catch (error) {
        if (PACKAGE_ASSETS.includes(asset) || error.code !== "ENOENT") throw error;
      }
    }
    const packageJson = JSON.parse(await readFile(path.join(archive.path, "package.json"), "utf8"));
    const manifest = JSON.parse(entries.find((entry) => entry.path === "manifest.json").content);
    if (manifest.id !== "spiral-day" || manifest.name !== "Spiral Day") {
      throw new CandidateError("package manifest identity must be Spiral Day / spiral-day");
    }
    if (manifest.version !== packageJson.version) {
      throw new CandidateError(`manifest version ${manifest.version} does not equal package version ${packageJson.version}`);
    }

    const bytes = createDeterministicPackage(entries);
    return {
      bytes,
      version: manifest.version,
      assets: entries.map((entry) => ({ path: entry.path, sha256: sha256(entry.content) })),
    };
  } finally {
    await archive.cleanup();
  }
}

export async function buildDeterministicCandidatePackage({ repository, candidateSha, outputPath }) {
  requireFullSha(candidateSha);
  const [first, second] = await Promise.all([
    buildArchivedCandidate(repository, candidateSha),
    buildArchivedCandidate(repository, candidateSha),
  ]);
  const firstHash = sha256(first.bytes);
  const secondHash = sha256(second.bytes);
  if (firstHash !== secondHash || !first.bytes.equals(second.bytes)) {
    throw new CandidateError("two clean candidate builds did not produce byte-identical packages");
  }
  if (JSON.stringify(first.assets) !== JSON.stringify(second.assets)) {
    throw new CandidateError("two clean candidate builds produced different asset manifests");
  }
  if (outputPath) await writeFile(outputPath, first.bytes);
  return {
    schema_version: 1,
    candidate_sha: candidateSha,
    version: first.version,
    package_filename: path.basename(outputPath ?? `spiral-day-${first.version}.zip`),
    package_sha256: firstHash,
    assets: first.assets,
    builds: [
      { candidate_sha: candidateSha, package_sha256: firstHash, assets: first.assets },
      { candidate_sha: candidateSha, package_sha256: secondHash, assets: second.assets },
    ],
  };
}
