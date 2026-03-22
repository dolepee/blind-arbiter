import { NextResponse } from "next/server";

import { getEigenComputePlan, runEigenComputeReview } from "@/lib/integrations/eigencompute";
import { completeReview, readDb } from "@/lib/store";

export async function POST(_request: Request, context: { params: Promise<{ caseId: string }> }) {
  try {
    const { caseId } = await context.params;
    const db = await readDb();
    const found = db.cases.find((item) => item.id === caseId);
    if (!found) {
      throw new Error("Case not found.");
    }
    if (!found.submission) {
      throw new Error("Submission required before review.");
    }

    const review = await runEigenComputeReview(found);
    const updated = await completeReview(caseId, review);
    return NextResponse.json({
      ok: true,
      case: updated,
      computePlan: getEigenComputePlan(updated),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to review case.";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
