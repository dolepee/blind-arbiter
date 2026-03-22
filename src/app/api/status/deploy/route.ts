import { NextResponse } from "next/server";

import { isReadOnlyDeployment, READ_ONLY_MESSAGE } from "@/lib/deployment-mode";
import { deployBlindArbiterReceiptRegistry } from "@/lib/integrations/status";

export async function POST() {
  if (isReadOnlyDeployment()) {
    return NextResponse.json({ ok: false, error: READ_ONLY_MESSAGE }, { status: 409 });
  }

  try {
    const deployment = await deployBlindArbiterReceiptRegistry();
    return NextResponse.json({ ok: true, deployment });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to deploy the Status receipt registry.";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
