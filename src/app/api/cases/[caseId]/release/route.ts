import { NextResponse } from "next/server";

import { releaseCase } from "@/lib/store";

export async function POST(_request: Request, context: { params: Promise<{ caseId: string }> }) {
  try {
    const { caseId } = await context.params;
    const updated = await releaseCase(caseId);
    return NextResponse.json({ ok: true, case: updated });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to release case.";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
