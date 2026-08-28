import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const FULL_SHA_PATTERN = /^[0-9a-f]{40}$/;
const REPOSITORY_PATH_PATTERN = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))(?!.*\0).+$/;

export class CandidateError extends Error {
  constructor(message) {
    super(message);
    this.name = "CandidateError";
  }
}

export function requireFullSha(value, label = "candidate SHA") {
  if (!FULL_SHA_PATTERN.test(String(value ?? ""))) {
    throw new CandidateError(`${label} must be one lowercase 40-character commit SHA`);
  }
  return value;
}

export function requireRepositoryPath(value, label = "candidate path") {
  if (typeof value !== "string" || !REPOSITORY_PATH_PATTERN.test(value)) {
    throw new CandidateError(`${label} must be a normalized repository-relative path`);
  }
  return value;
}

async function runGit(repository, args, options = {}) {
  try {
    const result = await execFileAsync("git", args, {
      cwd: repository,
      encoding: options.encoding ?? "utf8",
      maxBuffer: options.maxBuffer ?? 64 * 1024 * 1024,
    });
    return result.stdout;
  } catch (error) {
    const detail = String(error.stderr || error.message).trim();
    throw new CandidateError(`git ${args.join(" ")} failed${detail ? `: ${detail}` : ""}`);
  }
}

export async function assertCandidateObject(repository, candidateSha) {
  requireFullSha(candidateSha);
  const resolved = (await runGit(repository, ["rev-parse", "--verify", `${candidateSha}^{commit}`])).trim();
  if (resolved !== candidateSha) {
    throw new CandidateError(`candidate resolves to ${resolved}, expected exact object ${candidateSha}`);
  }
  return candidateSha;
}

export async function readCandidateFile(repository, candidateSha, repositoryPath, options = {}) {
  await assertCandidateObject(repository, candidateSha);
  requireRepositoryPath(repositoryPath);
  return runGit(repository, ["show", `${candidateSha}:${repositoryPath}`], options);
}

export async function readCandidateJson(repository, candidateSha, repositoryPath) {
  const source = await readCandidateFile(repository, candidateSha, repositoryPath);
  try {
    return JSON.parse(source);
  } catch (error) {
    throw new CandidateError(`${repositoryPath} at ${candidateSha} is malformed JSON: ${error.message}`);
  }
}

export async function listCandidateFiles(repository, candidateSha) {
  await assertCandidateObject(repository, candidateSha);
  const output = await runGit(repository, ["ls-tree", "-r", "--name-only", "-z", candidateSha]);
  return output.split("\0").filter(Boolean);
}

export async function candidateBlobOid(repository, candidateSha, repositoryPath) {
  await assertCandidateObject(repository, candidateSha);
  requireRepositoryPath(repositoryPath);
  const oid = (await runGit(repository, ["rev-parse", `${candidateSha}:${repositoryPath}`])).trim();
  if (!/^[0-9a-f]{40,64}$/.test(oid)) {
    throw new CandidateError(`${repositoryPath} at ${candidateSha} did not resolve to a Git blob`);
  }
  return oid;
}

export async function assertPushedCandidate(repository, candidateSha, expectedBranch) {
  await assertCandidateObject(repository, candidateSha);
  const [head, branch, worktreeStatus] = await Promise.all([
    runGit(repository, ["rev-parse", "HEAD"]),
    runGit(repository, ["symbolic-ref", "--quiet", "--short", "HEAD"]),
    runGit(repository, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]),
  ]);

  if (head.trim() !== candidateSha) {
    throw new CandidateError(`local HEAD ${head.trim()} does not equal candidate ${candidateSha}`);
  }
  const localBranch = branch.trim();
  if (expectedBranch && localBranch !== expectedBranch) {
    throw new CandidateError(`local branch ${localBranch} does not equal expected branch ${expectedBranch}`);
  }
  if (worktreeStatus.length !== 0) {
    throw new CandidateError("candidate worktree is dirty or has untracked files");
  }

  const [remote, mergeRef, upstreamRef, upstreamSha] = await Promise.all([
    runGit(repository, ["config", "--get", `branch.${localBranch}.remote`]),
    runGit(repository, ["config", "--get", `branch.${localBranch}.merge`]),
    runGit(repository, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"]),
    runGit(repository, ["rev-parse", "@{upstream}"]),
  ]);
  const remoteName = remote.trim();
  const remoteBranchRef = mergeRef.trim();
  if (!remoteName || remoteName === "." || !remoteBranchRef.startsWith("refs/heads/")) {
    throw new CandidateError("candidate branch must track a remote branch");
  }
  if (upstreamSha.trim() !== candidateSha) {
    throw new CandidateError(`tracking ref ${upstreamRef.trim()} is ${upstreamSha.trim()}, expected ${candidateSha}`);
  }

  const advertised = await runGit(repository, [
    "ls-remote",
    "--exit-code",
    "--heads",
    remoteName,
    remoteBranchRef,
  ]);
  const remoteRows = advertised.trim().split("\n").filter(Boolean);
  if (remoteRows.length !== 1) {
    throw new CandidateError(`remote ${remoteName} did not advertise exactly one ${remoteBranchRef}`);
  }
  const remoteSha = remoteRows[0].split(/\s+/, 1)[0];
  if (remoteSha !== candidateSha) {
    throw new CandidateError(`remote ${remoteBranchRef} is ${remoteSha}, expected ${candidateSha}`);
  }

  return {
    candidate_sha: candidateSha,
    branch: localBranch,
    tracking_ref: upstreamRef.trim(),
    remote: remoteName,
    remote_ref: remoteBranchRef,
    local_head: head.trim(),
    tracking_head: upstreamSha.trim(),
    remote_head: remoteSha,
    worktree: "clean",
  };
}

export async function archiveCandidate(repository, candidateSha) {
  await assertCandidateObject(repository, candidateSha);
  const tree = await runGit(repository, ["ls-tree", "-r", "-z", candidateSha]);
  for (const entry of tree.split("\0").filter(Boolean)) {
    const [metadata, repositoryPath] = entry.split("\t", 2);
    if (metadata.startsWith("120000 ")) {
      throw new CandidateError(`candidate contains forbidden symbolic link ${repositoryPath}`);
    }
  }
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), "spiral-day-candidate-"));
  const archivePath = path.join(temporaryRoot, "candidate.tar");
  const checkoutPath = path.join(temporaryRoot, "tree");
  await execFileAsync("mkdir", ["-p", checkoutPath]);
  await runGit(repository, ["archive", "--format=tar", `--output=${archivePath}`, candidateSha]);
  try {
    await execFileAsync("tar", ["-xf", archivePath, "-C", checkoutPath], { maxBuffer: 64 * 1024 * 1024 });
  } catch (error) {
    await rm(temporaryRoot, { recursive: true, force: true });
    throw new CandidateError(`failed to extract candidate archive: ${error.message}`);
  }
  return {
    path: checkoutPath,
    async cleanup() {
      await rm(temporaryRoot, { recursive: true, force: true });
    },
  };
}
