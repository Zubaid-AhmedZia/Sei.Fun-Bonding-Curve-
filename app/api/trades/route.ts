// app/api/trades/route.ts
import { NextRequest, NextResponse } from "next/server";
import { connectMongo } from "@/lib/mongo";
import { Trade } from "@/models/Trade";

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  if (!token) {
    return NextResponse.json({ trades: [] });
  }
  await connectMongo();
  const trades = await Trade.find({ token })
    .sort({ timestamp: 1 })
    .lean();
  return NextResponse.json({ trades });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  await connectMongo();
  await Trade.create(body);
  return NextResponse.json({ ok: true });
}
