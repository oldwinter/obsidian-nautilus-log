import { execFileSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";

const ROOT = process.cwd();
const PROFILE_PATH = resolve(ROOT, "tests/ui/planner-controls/env-vis-profile.json");
const GOLDEN_DIRECTORY = resolve(ROOT, "tests/ui/planner-controls/goldens");
const CONTAINER_RUNNER = "tests/ui/planner-controls/run-visual-evidence-container.mjs";
const update = process.argv.includes("--update");
const unsupported = process.argv.slice(2).filter((argument) => argument !== "--update");
if (unsupported.length > 0) {
  throw new Error(`Unsupported visual evidence arguments: ${unsupported.join(", ")}`);
}

const profile = JSON.parse(await readFile(PROFILE_PATH, "utf8"));
if (profile.schema !== "spiral-day-env-vis-v1") {
  throw new Error(`Unsupported ENV-VIS profile: ${String(profile.schema)}`);
}
const imageTag = `${profile.image.repository}:${profile.image.tag}`;
const imageReference = `${profile.image.repository}@${profile.image.digest}`;
const installedDigests = JSON.parse(execFileSync("docker", [
  "image", "inspect", imageTag, "--format", "{{json .RepoDigests}}",
], { cwd: ROOT, encoding: "utf8" }));
if (!installedDigests.includes(imageReference)) {
  throw new Error(
    `ENV-VIS image mismatch: ${imageTag} must resolve to ${imageReference}; received ${JSON.stringify(installedDigests)}`,
  );
}

const suffix = `${process.pid}-${Date.now()}`;
const dependencyVolume = `spiral-day-issue24-env-vis-${suffix}`;
const outputDirectory = await mkdtemp(join(tmpdir(), "spiral-day-issue24-env-vis-"));

function docker(arguments_) {
  execFileSync("docker", arguments_, {
    cwd: ROOT,
    encoding: "utf8",
    stdio: "inherit",
  });
}

docker(["volume", "create", dependencyVolume]);
try {
  console.log(`ENV-VIS bootstrap: Playwright ${profile.playwright} in ${imageReference}`);
  docker([
    "run", "--rm",
    "--network", "bridge",
    "--mount", `type=volume,src=${dependencyVolume},dst=/env-vis`,
    "--env", "PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1",
    "--entrypoint", "npm",
    imageReference,
    "install", "--prefix", "/env-vis", "--no-save", "--package-lock=false",
    `playwright@${profile.playwright}`,
    `esbuild@${profile.esbuild}`,
  ]);

  console.log("ENV-VIS capture: network=none, normative profile enforcement enabled");
  docker([
    "run", "--rm",
    "--network", "none",
    "--ipc", "host",
    "--mount", `type=bind,src=${ROOT},dst=/workspace,readonly`,
    "--mount", `type=bind,src=${outputDirectory},dst=/output`,
    "--mount", `type=volume,src=${dependencyVolume},dst=/env-vis,readonly`,
    "--mount", `type=volume,src=${dependencyVolume},dst=/workspace/node_modules,volume-subpath=node_modules,readonly`,
    "--workdir", "/workspace",
    "--env", "SPIRAL_DAY_ENV_VIS_NETWORK=none",
    "--entrypoint", "node",
    imageReference,
    CONTAINER_RUNNER,
    "--output", "/output",
    ...(update ? ["--update"] : []),
  ]);

  if (update) {
    const nextGoldens = join(outputDirectory, "goldens");
    await rm(join(GOLDEN_DIRECTORY, profile.fixture), { force: true, recursive: true });
    await rm(join(GOLDEN_DIRECTORY, "planner-controls-light.png"), { force: true });
    await rm(join(GOLDEN_DIRECTORY, "planner-controls-dark.png"), { force: true });
    await mkdir(GOLDEN_DIRECTORY, { recursive: true });
    await cp(nextGoldens, GOLDEN_DIRECTORY, { recursive: true });
    console.log(`updated ${profile.captures.length} ENV-VIS goldens in ${GOLDEN_DIRECTORY}`);
  }
} finally {
  try {
    docker(["volume", "rm", dependencyVolume]);
  } finally {
    await rm(outputDirectory, { force: true, recursive: true });
  }
}
