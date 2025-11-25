// app/api/trending/route.ts
import { NextRequest, NextResponse } from "next/server";
import { connectMongo } from "@/lib/mongo";
import { Trade } from "@/models/Trade";

export async function GET(_req: NextRequest) {
  await connectMongo();

  const ONE_DAY = 24 * 60 * 60 * 1000;
  const since = Date.now() - ONE_DAY;

  const agg = await Trade.aggregate([
    { $match: { timestamp: { $gte: since } } },
    {
      $group: {
        _id: "$token",
        tradeCount: { $sum: 1 },
        totalVolumeEth: { $sum: "$eth" },
        lastTradeAt: { $max: "$timestamp" }
      }
    },
    { $sort: { totalVolumeEth: -1 } },
    { $limit: 10 }
  ]);

  const trending = agg.map((row: any) => ({
    token: row._id as string,
    tradeCount: row.tradeCount as number,
    totalVolumeEth: row.totalVolumeEth as number,
    lastTradeAt: row.lastTradeAt as number
  }));

  return NextResponse.json({ trending });
}
