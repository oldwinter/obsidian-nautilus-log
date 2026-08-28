import { isDeepStrictEqual } from "node:util";

import {
  candidateBlobOid,
  CandidateError,
  readCandidateFile,
  requireFullSha,
} from "./candidate-object.mjs";
import { validateEvidenceBundle } from "./evidence-bundle.mjs";

export async function validateCandidateEvidenceBundle({
  repository,
  candidateSha,
  bundleRoot,
  candidateRequirements,
  requirementsPath = "docs/parity/requirements.json",
  requiredRequirementIds,
  requiredEnvironmentIds,
  nowMs,
}) {
  requireFullSha(candidateSha);
  const [candidateBytes, sourceBlobOid] = await Promise.all([
    readCandidateFile(repository, candidateSha, requirementsPath),
    candidateBlobOid(repository, candidateSha, requirementsPath),
  ]);
  let exactCandidateRequirements;
  try {
    exactCandidateRequirements = JSON.parse(candidateBytes);
  } catch (error) {
    throw new CandidateError(`${requirementsPath} at ${candidateSha} is malformed JSON: ${error.message}`);
  }
  if (candidateRequirements !== undefined
    && !isDeepStrictEqual(candidateRequirements, exactCandidateRequirements)) {
    throw new CandidateError("candidate requirements do not match the exact candidate Git object");
  }

  const result = validateEvidenceBundle({
    bundleDir: bundleRoot,
    candidateSha,
    candidateRequirements: exactCandidateRequirements,
    candidateRequirementsBlobOid: sourceBlobOid,
    candidateRequirementsSourcePath: requirementsPath,
    requiredRequirementIds,
    requiredEnvironmentIds,
    nowMs,
  });
  return {
    ...result,
    package_sha256: result.packageSha256,
  };
}
