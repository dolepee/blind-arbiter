import { NextResponse } from "next/server";

import { disputeCase } from "@/lib/store";

export async function POST(request: Request, context: { params: Promise<{ caseId: string }> }) {
  try {
    const { caseId } = await context.params;
    const body = await request.json();
    const updated = await disputeCase(caseId, String(body.reason || "Human operator requested dispute.").trim());
    return NextResponse.json({ ok: true, case: updated });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to dispute case.";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
