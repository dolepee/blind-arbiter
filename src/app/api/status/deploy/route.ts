import { NextResponse } from "next/server";

import { deployBlindArbiterReceiptRegistry } from "@/lib/integrations/status";

export async function POST() {
  try {
    const deployment = await deployBlindArbiterReceiptRegistry();
    return NextResponse.json({ ok: true, deployment });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to deploy the Status receipt registry.";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
