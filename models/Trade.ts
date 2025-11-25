// models/Trade.ts
import mongoose, { Schema, models, model } from "mongoose";

const TradeSchema = new Schema(
  {
    token: { type: String, index: true },
    hash: String,
    side: { type: String, enum: ["buy", "sell"], index: true },
    tokens: Number, // how many tokens
    eth: Number,    // ETH spent/received
    timestamp: Number // ms since epoch
  },
  { timestamps: true }
);

export const Trade =
  models.Trade || model("Trade", TradeSchema);
