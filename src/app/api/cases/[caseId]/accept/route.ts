import { NextResponse } from "next/server";

import { acceptCase } from "@/lib/store";

export async function POST(request: Request, context: { params: Promise<{ caseId: string }> }) {
  try {
    const { caseId } = await context.params;
    const body = await request.json();
    const updated = await acceptCase(caseId, {
      displayName: String(body.displayName || "").trim(),
      wallet: body.wallet ? String(body.wallet).trim() : undefined,
      selfId: body.selfId ? String(body.selfId).trim() : undefined,
      verified: Boolean(body.selfId),
    });
    return NextResponse.json({ ok: true, case: updated });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to accept case.";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
