import { NextResponse } from "next/server";

import { createCase, readDb } from "@/lib/store";

export async function GET() {
  const db = await readDb();
  return NextResponse.json(db);
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const created = await createCase({
      title: String(body.title || "").trim(),
      amountUsd: Number(body.amountUsd || 0),
      summary: String(body.summary || "").trim(),
      buyerName: String(body.buyerName || "").trim(),
      buyerWallet: body.buyerWallet ? String(body.buyerWallet).trim() : undefined,
      buyerSelfId: body.buyerSelfId ? String(body.buyerSelfId).trim() : undefined,
      criteria: String(body.criteria || "")
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean),
    });

    return NextResponse.json({ ok: true, case: created });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create case.";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
