import { NextResponse } from "next/server";

import { buildArkhaiAgreement } from "@/lib/integrations/arkhai";
import { readDb } from "@/lib/store";

export async function GET(_request: Request, context: { params: Promise<{ caseId: string }> }) {
  try {
    const { caseId } = await context.params;
    const db = await readDb();
    const found = db.cases.find((item) => item.id === caseId);

    if (!found) {
      throw new Error("Case not found.");
    }

    return NextResponse.json({
      ok: true,
      agreement: found.arkhaiAgreement || buildArkhaiAgreement(found),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to build Arkhai agreement.";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
