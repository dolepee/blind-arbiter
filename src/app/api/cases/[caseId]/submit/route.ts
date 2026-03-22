import { NextResponse } from "next/server";

import { submitDeliverable } from "@/lib/store";

export async function POST(request: Request, context: { params: Promise<{ caseId: string }> }) {
  try {
    const { caseId } = await context.params;
    const body = await request.json();
    const updated = await submitDeliverable(caseId, {
      artifactName: String(body.artifactName || "").trim(),
      artifactType: String(body.artifactType || "").trim(),
      artifactHash: String(body.artifactHash || "").trim(),
      storageUri: String(body.storageUri || "").trim(),
      narrative: String(body.narrative || "").trim(),
    });
    return NextResponse.json({ ok: true, case: updated });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to submit deliverable.";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
