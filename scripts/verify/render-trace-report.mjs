#!/usr/bin/env node

import { realpathSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { verifyEvidenceFromCliArguments } from "./verify-evidence.mjs";

function sorted(values) {
  return [...values].sort();
}

function recordsById(records) {
  return new Map(records.map((record) => [record.evidence_id, record]));
}

export function buildTraceReport(result) {
  const recordMap = recordsById(result.records);
  const activeRows = result.resolvedRequirements.requirements
    .filter((row) => row.status === "active" && result.scope.included_requirement_ids.includes(row.id))
    .sort((left, right) => left.id.localeCompare(right.id));

  const requirements = activeRows.map((row) => ({
    requirement_id: row.id,
    tests: row.tests.map((testId) => ({
      test_id: testId,
      evidence: row.evidence
        .map((evidenceId) => recordMap.get(evidenceId))
        .filter((record) => record.test_ids.includes(testId))
        .map((record) => ({
          evidence_id: record.evidence_id,
          record_type: record.record_type,
          environment_id: record.environment.profile_id,
          artifacts: record.artifacts.map((artifact) => ({ ...artifact })),
        })),
    })),
  }));

  const tests = result.index.tests.map((entry) => ({
    test_id: entry.test_id,
    requirement_ids: entry.requirement_ids,
    evidence_ids: entry.evidence_ids,
  }));

  const evidence = result.index.records.map((entry) => ({
    evidence_id: entry.evidence_id,
    record_type: entry.record_type,
    record_path: entry.path,
    requirement_ids: entry.requirement_ids,
    test_ids: entry.test_ids,
    artifacts: entry.artifacts.map((artifact) => ({ ...artifact })),
  }));

  const artifactMap = new Map();
  for (const record of result.records) {
    for (const artifact of record.artifacts) {
      const projection = artifactMap.get(artifact.path) ?? {
        path: artifact.path,
        sha256: artifact.sha256,
        evidence_ids: new Set(),
        requirement_ids: new Set(),
        test_ids: new Set(),
      };
      projection.evidence_ids.add(record.evidence_id);
      record.requirement_ids.forEach((id) => projection.requirement_ids.add(id));
      record.test_ids.forEach((id) => projection.test_ids.add(id));
      artifactMap.set(artifact.path, projection);
    }
  }
  const artifacts = sorted(artifactMap.keys()).map((path) => {
    const entry = artifactMap.get(path);
    return {
      path: entry.path,
      sha256: entry.sha256,
      evidence_ids: sorted(entry.evidence_ids),
      requirement_ids: sorted(entry.requirement_ids),
      test_ids: sorted(entry.test_ids),
    };
  });

  return {
    schema_version: 1,
    candidate_sha: result.candidateSha,
    package_sha256: result.packageSha256,
    scope: {
      release_scope: result.scope.release_scope,
      included_requirement_ids: sorted(result.scope.included_requirement_ids),
      excluded_requirement_ids: sorted(result.scope.excluded_requirement_ids),
    },
    source: {
      manifest_sha256: result.manifestSha256,
      index_path: result.manifest.index.path,
      index_sha256: result.indexSha256,
      requirements_path: result.manifest.requirements.path,
      requirements_sha256: result.manifest.requirements.sha256,
      requirements_source_path: result.manifest.requirements.source_path,
      requirements_source_blob_oid: result.manifest.requirements.source_blob_oid,
    },
    forward: { requirements },
    reverse: { tests, evidence, artifacts },
  };
}

export function renderTraceReportJson(report) {
  return `${JSON.stringify(report, null, 2)}\n`;
}

function cell(values) {
  return values.length === 0 ? "-" : values.join("<br>");
}

function inlineCode(value) {
  const escaped = String(value).replace(/\|/g, "\\|");
  const longestRun = Math.max(0, ...[...escaped.matchAll(/`+/g)].map((match) => match[0].length));
  const delimiter = "`".repeat(longestRun + 1);
  const content = escaped.startsWith("`") || escaped.endsWith("`") ? ` ${escaped} ` : escaped;
  return `${delimiter}${content}${delimiter}`;
}

export function renderTraceReportMarkdown(report) {
  const lines = [
    "# Exact-candidate trace report",
    "",
    `Candidate: \`${report.candidate_sha}\``,
    "",
    `Package SHA-256: \`${report.package_sha256}\``,
    "",
    `Manifest SHA-256: \`${report.source.manifest_sha256}\``,
    "",
    `Release scope: \`${report.scope.release_scope}\``,
    "",
    `Included requirements: ${report.scope.included_requirement_ids.length}; excluded requirements: ${report.scope.excluded_requirement_ids.length}`,
    "",
    "## Forward trace",
    "",
    "| Requirement | Test | Evidence | Artifacts |",
    "| --- | --- | --- | --- |",
  ];
  for (const requirement of report.forward.requirements) {
    for (const test of requirement.tests) {
      lines.push(`| ${inlineCode(requirement.requirement_id)} | ${inlineCode(test.test_id)} | ${cell(test.evidence.map((entry) => inlineCode(entry.evidence_id)))} | ${cell(test.evidence.flatMap((entry) => entry.artifacts.map((artifact) => `${inlineCode(artifact.path)} (${inlineCode(artifact.sha256)})`)))} |`);
    }
  }
  lines.push(
    "",
    "## Reverse trace",
    "",
    "| Artifact | Evidence | Tests | Requirements |",
    "| --- | --- | --- | --- |",
  );
  for (const artifact of report.reverse.artifacts) {
    lines.push(`| ${inlineCode(artifact.path)} (${inlineCode(artifact.sha256)}) | ${cell(artifact.evidence_ids.map(inlineCode))} | ${cell(artifact.test_ids.map(inlineCode))} | ${cell(artifact.requirement_ids.map(inlineCode))} |`);
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

export function assertTraceOutputOutsideBundle(bundleDir, outputPath) {
  const bundleRoot = realpathSync(bundleDir);
  const output = resolve(realpathSync(dirname(outputPath)), basename(outputPath));
  if (output === bundleRoot || output.startsWith(bundleRoot + sep)) {
    throw new Error("--output must be outside the immutable evidence bundle");
  }
}

function extractRenderArguments(args) {
  const verifyArgs = [];
  let format = "json";
  let output = null;
  let sawFormat = false;
  let sawOutput = false;
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1];
    if (typeof value !== "string" || value.startsWith("--")) throw new Error(`${name} requires one value`);
    if (name === "--format") {
      if (sawFormat) throw new Error("duplicate argument --format");
      sawFormat = true;
      format = value;
    } else if (name === "--output") {
      if (sawOutput) throw new Error("duplicate argument --output");
      sawOutput = true;
      output = resolve(value);
    } else {
      verifyArgs.push(name, value);
    }
  }
  if (format !== "json" && format !== "markdown") throw new Error("--format must be json or markdown");
  return { verifyArgs, format, output };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = extractRenderArguments(process.argv.slice(2));
    const result = verifyEvidenceFromCliArguments(options.verifyArgs);
    const report = buildTraceReport(result);
    const rendered = options.format === "json" ? renderTraceReportJson(report) : renderTraceReportMarkdown(report);
    if (options.output) {
      assertTraceOutputOutsideBundle(result.bundleDir, options.output);
      writeFileSync(options.output, rendered, { encoding: "utf8", flag: "wx" });
    }
    else process.stdout.write(rendered);
  } catch (error) {
    console.error(`trace report failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
