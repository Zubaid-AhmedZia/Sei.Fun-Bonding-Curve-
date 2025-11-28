import { NextRequest, NextResponse } from "next/server";
import { connectMongo } from "@/lib/mongo";
import { Trade } from "@/models/Trade";

export async function GET(req: NextRequest) {
    const token = req.nextUrl.searchParams.get("token");
    if (!token) {
        return NextResponse.json({ holders: [] });
    }

    await connectMongo();

    try {
        // Aggregate trades to find top holders
        // We sum tokens for buys and subtract for sells
        const holders = await Trade.aggregate([
            {
                $match: {
                    token: token,
                    user: { $exists: true, $ne: null }
                }
            },
            {
                $group: {
                    _id: "$user",
                    balance: {
                        $sum: {
                            $cond: [
                                { $eq: ["$side", "buy"] },
                                "$tokens",
                                { $multiply: ["$tokens", -1] }
                            ]
                        }
                    }
                }
            },
            {
                $match: {
                    balance: { $gt: 0 }
                }
            },
            { $sort: { balance: -1 } },
            { $limit: 50 },
            {
                $project: {
                    _id: 0,
                    address: "$_id",
                    balance: 1
                }
            }
        ]);

        return NextResponse.json({ holders });
    } catch (e) {
        console.error("Failed to fetch holders:", e);
        return NextResponse.json({ holders: [] }, { status: 500 });
    }
}
