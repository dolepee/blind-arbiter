import { NextResponse } from "next/server";

import { readDb } from "@/lib/store";

export async function GET() {
  const db = await readDb();
  return NextResponse.json({
    entries: db.agentLog,
  });
}
