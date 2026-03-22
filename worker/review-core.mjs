import { createHash } from "node:crypto";

function normalize(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function computeReportHash(payload) {
  return `0x${createHash("sha256").update(JSON.stringify(payload)).digest("hex")}`;
}

export function reviewCasePayload(payload) {
  const narrative = normalize(payload?.submission?.narrative);
  const criteria = (payload?.milestone?.criteria || []).map((criterion) => {
    const criterionTokens = normalize(`${criterion.label} ${criterion.description}`)
      .split(" ")
      .filter((token) => token.length > 4);
    const matched = criterionTokens.filter((token) => narrative.includes(token));
    const ratio = criterionTokens.length === 0 ? 0 : matched.length / criterionTokens.length;

    if (ratio >= 0.45) {
      return {
        id: criterion.id,
        label: criterion.label,
        result: "pass",
        notes: `Matched ${matched.length} relevant signals inside the private narrative.`,
      };
    }

    if (ratio >= 0.2) {
      return {
        id: criterion.id,
        label: criterion.label,
        result: "unclear",
        notes: "Partial evidence detected, but not enough for deterministic release.",
      };
    }

    return {
      id: criterion.id,
      label: criterion.label,
      result: "fail",
      notes: "The submission narrative does not provide enough private evidence for this criterion.",
    };
  });

  const passes = criteria.filter((item) => item.result === "pass").length;
  const fails = criteria.filter((item) => item.result === "fail").length;
  const unclear = criteria.filter((item) => item.result === "unclear").length;
  const score = (passes + unclear * 0.35) / Math.max(criteria.length, 1);

  let verdict = "needs_dispute";
  let recommendedAction = "dispute";
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

  const computedAt = new Date().toISOString();
  const requestHash = computeReportHash({
    caseId: payload.caseId,
    submissionHash: payload?.submission?.artifactHash || "0x0",
    criteria: payload?.milestone?.criteria || [],
  });
  const reviewPayload = {
    caseId: payload.caseId,
    verdict,
    criteria,
    narrative: payload?.submission?.narrative || "",
  };
  const reportHash = computeReportHash(reviewPayload);
  const workerVersion = process.env.WORKER_VERSION || "eigencompute-worker-v1";
  const image = process.env.WORKER_IMAGE || "blindarbiter/arbiter-worker:eigencompute-dev";
  const attestationHash = computeReportHash({
    requestHash,
    reportHash,
    workerVersion,
    image,
  });

  return {
    review: {
      verdict,
      confidence: Number(score.toFixed(2)),
      redactedSummary,
      reportHash,
      criteria,
      recommendedAction,
      computedAt,
      execution: {
        mode: "ready",
        strategy: "http_worker",
        image,
        workerVersion,
        requestHash,
        attestationHash,
        enclaveProof: "container-review-worker",
        workerUrl: process.env.PUBLIC_WORKER_URL || undefined,
      },
    },
  };
}
