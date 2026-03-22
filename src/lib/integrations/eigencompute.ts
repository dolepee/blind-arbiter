import { createHash } from "node:crypto";

import type { BlindArbiterCase, IntegrationReadiness, ReviewExecution, ReviewVerdict } from "@/lib/types";

function normalize(text: string) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function computeReportHash(payload: unknown) {
  return `0x${createHash("sha256").update(JSON.stringify(payload)).digest("hex")}`;
}

function buildLocalExecution(caseFile: BlindArbiterCase, fallbackReason?: string): ReviewExecution {
  const requestHash = computeReportHash({
    caseId: caseFile.id,
    submissionHash: caseFile.submission?.artifactHash || "0x0",
    criteria: caseFile.milestone.criteria,
  });

  return {
    mode: "local_stub",
    strategy: "deterministic_local",
    image: "blindarbiter/arbiter-worker:local-stub",
    workerVersion: "local-stub-v1",
    requestHash,
    attestationHash: computeReportHash({
      requestHash,
      mode: "local_stub",
      fallbackReason: fallbackReason || null,
    }),
    enclaveProof: "local-deterministic-review",
    fallbackReason,
  };
}

export function runLocalEigenComputeReview(caseFile: BlindArbiterCase, fallbackReason?: string): ReviewVerdict {
  if (!caseFile.submission) {
    throw new Error("Deliverable must exist before review.");
  }

  const narrative = normalize(caseFile.submission.narrative);
  const criteria = caseFile.milestone.criteria.map((criterion) => {
    const criterionTokens = normalize(`${criterion.label} ${criterion.description}`)
      .split(" ")
      .filter((token) => token.length > 4);
    const matched = criterionTokens.filter((token) => narrative.includes(token));
    const ratio = criterionTokens.length === 0 ? 0 : matched.length / criterionTokens.length;

    if (ratio >= 0.45) {
      return {
        id: criterion.id,
        label: criterion.label,
        result: "pass" as const,
        notes: `Matched ${matched.length} relevant signals inside the private narrative.`,
      };
    }

    if (ratio >= 0.2) {
      return {
        id: criterion.id,
        label: criterion.label,
        result: "unclear" as const,
        notes: "Partial evidence detected, but not enough for deterministic release.",
      };
    }

    return {
      id: criterion.id,
      label: criterion.label,
      result: "fail" as const,
      notes: "The submission narrative does not provide enough private evidence for this criterion.",
    };
  });

  const passes = criteria.filter((item) => item.result === "pass").length;
  const fails = criteria.filter((item) => item.result === "fail").length;
  const unclear = criteria.filter((item) => item.result === "unclear").length;
  const score = (passes + unclear * 0.35) / Math.max(criteria.length, 1);
  let verdict: ReviewVerdict["verdict"] = "needs_dispute";
  let recommendedAction: ReviewVerdict["recommendedAction"] = "dispute";
  let redactedSummary = "BlindArbiter detected mixed signals and recommends human review.";

  if (fails === 0 && unclear === 0) {
    verdict = "pass";
    recommendedAction = "release";
    redactedSummary = "All private acceptance signals aligned with the milestone rubric.";
  } else if (fails > 0 && score < 0.5) {
    verdict = "fail";
    recommendedAction = "dispute";
    redactedSummary = "The private submission missed critical milestone requirements.";
  }

  const payload = {
    caseId: caseFile.id,
    verdict,
    criteria,
    narrative: caseFile.submission.narrative,
  };

  return {
    verdict,
    confidence: Number(score.toFixed(2)),
    redactedSummary,
    reportHash: computeReportHash(payload),
    criteria,
    recommendedAction,
    computedAt: new Date().toISOString(),
    execution: buildLocalExecution(caseFile, fallbackReason),
  };
}

function getConfiguredReviewUrl() {
  return process.env.EIGENCOMPUTE_REVIEW_URL?.trim();
}

export async function resolveEigenComputeReadiness(): Promise<IntegrationReadiness["eigenCompute"]> {
  return getConfiguredReviewUrl() ? "ready" : "local_stub";
}

export async function runEigenComputeReview(caseFile: BlindArbiterCase): Promise<ReviewVerdict> {
  const reviewUrl = getConfiguredReviewUrl();

  if (!reviewUrl) {
    return runLocalEigenComputeReview(caseFile);
  }

  try {
    const response = await fetch(reviewUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        caseId: caseFile.id,
        milestone: caseFile.milestone,
        submission: caseFile.submission,
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      throw new Error(`Worker returned ${response.status}.`);
    }

    const data = (await response.json()) as { review?: ReviewVerdict };

    if (!data.review) {
      throw new Error("Worker response did not contain a review.");
    }

    return data.review;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Worker call failed.";
    return runLocalEigenComputeReview(caseFile, `HTTP worker unavailable: ${message}`);
  }
}

export function getEigenComputePlan(caseFile: BlindArbiterCase) {
  const reviewExecution = caseFile.review?.execution;
  const reviewUrl = getConfiguredReviewUrl();

  return {
    image: reviewExecution?.image || "blindarbiter/arbiter-worker:eigencompute-dev",
    mode: reviewExecution?.mode || caseFile.integrations.eigenCompute,
    strategy: reviewExecution?.strategy || (reviewUrl ? "http_worker" : "deterministic_local"),
    workerUrl: reviewExecution?.workerUrl || reviewUrl || null,
    attestationHash: reviewExecution?.attestationHash || null,
    enclaveNote:
      reviewExecution?.mode === "ready"
        ? "BlindArbiter is delegating review to the Dockerized worker surface intended for EigenCompute."
        : "The current build is using the deterministic local fallback until the HTTP worker is available.",
  };
}
