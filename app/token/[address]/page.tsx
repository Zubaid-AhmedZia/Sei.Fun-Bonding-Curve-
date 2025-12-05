// app/token/[address]/page.tsx
"use client";

import { useParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ethers } from "ethers";
import axios from "axios";
import Link from "next/link";
import {
  getBrowserProvider,
  getFactoryContract,
  getFactoryReadOnly,
} from "@/lib/ethersClient";
import { getTransactionError } from "@/lib/errorHandler";
import TransactionErrorModal from "@/components/TransactionErrorModal";
import { tokenAbi } from "@/lib/abi/Token";
import {
  getDexQuoteBuyExactOut,
  getDexQuoteSell,
  buyTokenDex,
  sellTokenDex,
  checkAllowance,
  approveToken,
} from "@/lib/dragonswap";
import Navbar from "@/components/Navbar";
import {
  ArrowTrendingUpIcon,
  ArrowDownRightIcon,
  CheckCircleIcon,
  ClockIcon,
  ChartBarIcon,
  SparklesIcon,
} from "@heroicons/react/24/outline";
import AdvancedChart from "@/components/AdvancedChart";

// 👉 Bonding curve funding goal (must match your on-chain graduation threshold)
const FUNDING_GOAL_WEI = ethers.parseEther("15"); // 115,000 SEI to graduate & launch
const DEFAULT_CURVE_FEE_BPS = 100n; // 1%
const DEFAULT_BPS_DENOMINATOR = 10_000n;

type MemeToken = {
  name: string;
  symbol: string;
  description: string;
  tokenImageUrl: string;
  fundingRaised: bigint;
  tokenAddress: string;
  creatorAddress: string;
  isLaunched: boolean;
};

type TradePoint = {
  token: string;
  hash: string;
  side: "buy" | "sell";
  tokens: number;
  eth: number;
  timestamp: number;
};

type Candle = {
  bucketStart: number; // ms since epoch
  open: number;
  high: number;
  low: number;
  close: number;
};

type TimeRange = "1m" | "1h" | "1d" | "1w" | "all";

type Holder = {
  address: string;
  balance: number; // in tokens
  percent?: number; // 0-100
};

const TIME_RANGE_CONFIG: Record<
  TimeRange,
  {
    label: string;
    bucketMs: number;
    timeUnit: "minute" | "hour" | "day";
  }
> = {
  "1m": {
    label: "1m",
    bucketMs: 60 * 1000,
    timeUnit: "minute",
  },
  "1h": {
    label: "1h",
    bucketMs: 60 * 60 * 1000,
    timeUnit: "hour",
  },
  "1d": {
    label: "1D",
    bucketMs: 24 * 60 * 60 * 1000,
    timeUnit: "day",
  },
  "1w": {
    label: "1W",
    bucketMs: 7 * 24 * 60 * 60 * 1000,
    timeUnit: "day",
  },
  all: {
    label: "All",
    bucketMs: 0,
    timeUnit: "day",
  },
};

const TIME_RANGE_ORDER: TimeRange[] = ["1m", "1h", "1d", "1w", "all"];

const NICE_BUCKETS_MS = [
  60 * 1000, // 1m
  5 * 60 * 1000,
  15 * 60 * 1000,
  60 * 60 * 1000, // 1h
  4 * 60 * 60 * 1000,
  24 * 60 * 60 * 1000,
  7 * 24 * 60 * 60 * 1000, // 1w
];

const TARGET_CANDLES = 200;

type PriceEvent = { x: number; y: number };

const buildPriceEvents = (trades: TradePoint[]): PriceEvent[] => {
  const priceEvents = trades
    .filter(
      (t) =>
        typeof t.timestamp === "number" &&
        Number.isFinite(t.timestamp) &&
        t.tokens > 0 &&
        t.eth > 0,
    )
    .map((t) => ({
      x: Number(t.timestamp),
      y: t.eth / t.tokens,
    }))
    .filter(
      (p) =>
        Number.isFinite(p.x) && Number.isFinite(p.y) && p.y > 0 && p.x > 0,
    )
    .sort((a, b) => a.x - b.x);

  console.log("[buildPriceEvents] events:", priceEvents.length, priceEvents);
  return priceEvents;
};

const pickBucketSizeForAll = (minTs: number, maxTs: number): number => {
  const duration = Math.max(maxTs - minTs, NICE_BUCKETS_MS[0]);
  const rawBucket = duration / TARGET_CANDLES;
  for (const candidate of NICE_BUCKETS_MS) {
    if (rawBucket <= candidate) {
      return candidate;
    }
  }
  return NICE_BUCKETS_MS[NICE_BUCKETS_MS.length - 1];
};

function buildCandles(trades: TradePoint[], range: TimeRange): Candle[] {
  const priceEvents = buildPriceEvents(trades);
  if (priceEvents.length === 0) {
    console.log("[buildCandles] no price events, returning []");
    return [];
  }

  let bucketMs = TIME_RANGE_CONFIG[range].bucketMs;
  if (range === "all" || bucketMs <= 0) {
    bucketMs = pickBucketSizeForAll(
      priceEvents[0].x,
      priceEvents[priceEvents.length - 1].x,
    );
  }
  if (!bucketMs || !Number.isFinite(bucketMs) || bucketMs <= 0) {
    bucketMs = NICE_BUCKETS_MS[0];
  }

  const earliest = priceEvents[0].x;
  const latest = priceEvents[priceEvents.length - 1].x;
  const alignedStart = Math.floor(earliest / bucketMs) * bucketMs;
  const alignedEnd = Math.ceil(latest / bucketMs) * bucketMs;

  const candles: Candle[] = [];
  let eventIdx = 0;
  let carry = priceEvents[0].y;

  for (
    let bucketStart = alignedStart;
    bucketStart <= alignedEnd;
    bucketStart += bucketMs
  ) {
    const bucketEnd = bucketStart + bucketMs;
    let open = carry;
    let high = carry;
    let low = carry;
    let close = carry;
    let touched = false;

    while (eventIdx < priceEvents.length && priceEvents[eventIdx].x < bucketEnd) {
      const price = priceEvents[eventIdx].y;
      if (!touched) {
        open = price;
        high = price;
        low = price;
        close = price;
        touched = true;
      } else {
        high = Math.max(high, price);
        low = Math.min(low, price);
        close = price;
      }
      eventIdx++;
    }

    if (!touched) {
      open = carry;
      high = carry;
      low = carry;
      close = carry;
    }

    carry = close;
    candles.push({
      bucketStart,
      open,
      high,
      low,
      close,
    });
  }

  console.log(
    "[buildCandles] range:",
    range,
    "candles:",
    candles.length,
    candles.slice(0, 5),
  );
  return candles;
}

export default function TokenPage() {
  const params = useParams<{ address: string }>();
  const tokenAddress = params.address;

  const [token, setToken] = useState<MemeToken | null>(null);
  const [account, setAccount] = useState<string | null>(null);

  const [qty, setQty] = useState<string>("0");
  const [estimatedCost, setEstimatedCost] = useState<bigint | null>(null);
  const [loadingCost, setLoadingCost] = useState(false);
  const [pending, setPending] = useState(false);

  const [trades, setTrades] = useState<TradePoint[]>([]);

  const [sellQty, setSellQty] = useState<string>("0");
  const [estRefund, setEstRefund] = useState<bigint | null>(null);

  const [timeRange, setTimeRange] = useState<TimeRange>("1h");
  const [ethUsd, setEthUsd] = useState<number | null>(null);

  // 🔹 curve supply for market cap
  const [curveSupply, setCurveSupply] = useState<bigint | null>(null);

  // 🔹 initial price and total supply for initial market cap
  const [initialPrice, setInitialPrice] = useState<bigint | null>(null);
  const [totalSupply, setTotalSupply] = useState<bigint | null>(null);
  const [maxSupply, setMaxSupply] = useState<bigint | null>(null);

  // 🔹 top holders (for bottom tab)
  const [holders, setHolders] = useState<Holder[]>([]);
  const [holdersLoading, setHoldersLoading] = useState(false);

  // 🔹 bottom tab: history / holders
  const [bottomTab, setBottomTab] = useState<"history" | "holders">("history");
  const [curveFeeBps, setCurveFeeBps] = useState<bigint>(DEFAULT_CURVE_FEE_BPS);
  const [curveFeeDenominator, setCurveFeeDenominator] = useState<bigint>(
    DEFAULT_BPS_DENOMINATOR,
  );

  // Transaction error modal state
  const [errorModal, setErrorModal] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
  }>({
    isOpen: false,
    title: "",
    message: "",
  });

  const connect = async () => {
    const provider = getBrowserProvider();
    const accounts = await provider.send("eth_requestAccounts", []);
    setAccount(accounts[0]);
  };

  const disconnect = () => setAccount(null);

  const loadToken = async () => {
    console.log(
      "[loadToken] fetching token + trades for",
      tokenAddress,
    );
    const factory = getFactoryReadOnly();
    const list: MemeToken[] = await factory.getAllMemeTokens();
    const t = list.find(
      (m) => m.tokenAddress.toLowerCase() === tokenAddress.toLowerCase(),
    );
    if (t) {
      console.log("[loadToken] token found:", t.tokenAddress);
      setToken(t);
      // 🔹 also fetch curve supply for market cap
      try {
        const supply: bigint = await factory.curveSupply(tokenAddress);
        console.log("[loadToken] curveSupply:", supply.toString());
        setCurveSupply(supply);
      } catch (e) {
        console.error("[loadToken] failed to fetch curveSupply", e);
        setCurveSupply(null);
      }

      try {
        const feeGetter = (factory as any).FEE_BPS;
        const denomGetter = (factory as any).BPS_DENOMINATOR;

        if (typeof feeGetter === "function" && typeof denomGetter === "function") {
          const [feeBpsValue, bpsDenomValue] = await Promise.all([
            feeGetter(),
            denomGetter(),
          ]);
          setCurveFeeBps(feeBpsValue);
          setCurveFeeDenominator(
            bpsDenomValue === 0n ? DEFAULT_BPS_DENOMINATOR : bpsDenomValue,
          );
        } else {
          throw new Error("Factory ABI missing fee getters");
        }
      } catch (e) {
        console.error("[loadToken] failed to fetch fee config", e);
        setCurveFeeBps(DEFAULT_CURVE_FEE_BPS);
        setCurveFeeDenominator(DEFAULT_BPS_DENOMINATOR);
      }

      // 🔹 Fetch initial price from factory
      try {
        const initialPriceGetter = (factory as any).INITIAL_PRICE;
        if (typeof initialPriceGetter === "function") {
          const initialPriceValue: bigint = await initialPriceGetter();
          console.log("[loadToken] INITIAL_PRICE:", initialPriceValue.toString());
          setInitialPrice(initialPriceValue);
        }
      } catch (e) {
        console.error("[loadToken] failed to fetch INITIAL_PRICE", e);
        setInitialPrice(null);
      }

      // 🔹 Fetch total supply and max supply from token contract
      try {
        const rpc = process.env.NEXT_PUBLIC_SEPOLIA_RPC!;
        const provider = new ethers.JsonRpcProvider(rpc);
        const tokenContract = new ethers.Contract(tokenAddress, tokenAbi, provider);
        const [totalSupplyValue, maxSupplyValue]: [bigint, bigint] = await Promise.all([
          tokenContract.totalSupply(),
          tokenContract.maxSupply(),
        ]);
        console.log("[loadToken] totalSupply:", totalSupplyValue.toString());
        console.log("[loadToken] maxSupply:", maxSupplyValue.toString());
        setTotalSupply(totalSupplyValue);
        setMaxSupply(maxSupplyValue);
      } catch (e) {
        console.error("[loadToken] failed to fetch token supply", e);
        setTotalSupply(null);
        setMaxSupply(null);
      }
    }

    try {
      const res = await axios.get(`/api/trades?token=${tokenAddress}`);
      console.log(
        "[loadToken] trades from API:",
        res.data.trades?.length ?? 0,
        res.data.trades?.slice(0, 5),
      );
      setTrades(res.data.trades || []);
    } catch (e) {
      console.log("No trade history yet", e);
    }

    // 🔹 fetch top holders (if backend supports it)
    try {
      setHoldersLoading(true);
      const res = await axios.get(`/api/holders?token=${tokenAddress}`);
      const serverHolders: Holder[] = res.data.holders || [];

      // Calculate percentage if supply is known
      if (t) {
        const supplyRaw = await factory.curveSupply(tokenAddress);
        const supply = Number(ethers.formatUnits(supplyRaw, 18));
        if (supply > 0) {
          serverHolders.forEach(h => {
            h.percent = (h.balance / supply) * 100;
          });
        }
      }

      setHolders(serverHolders);
    } catch (e) {
      console.log("[loadToken] no top holders endpoint or error", e);
      setHolders([]);
    } finally {
      setHoldersLoading(false);
    }
  };

  // 🔹 Check if token is launched to enable DEX mode
  const isDexMode = token?.isLaunched ?? false;

  // estimate buy cost
  useEffect(() => {
    const run = async () => {
      if (!tokenAddress || !qty || Number(qty) <= 0) {
        setEstimatedCost(null);
        return;
      }
      setLoadingCost(true);
      try {
        if (isDexMode) {
          // DEX Quote: how much SEI is needed to buy `qty` tokens
          const rpc = process.env.NEXT_PUBLIC_SEPOLIA_RPC!;
          const provider = new ethers.JsonRpcProvider(rpc);
          const amountOut = ethers.parseUnits(qty, 18);
          const ethNeeded = await getDexQuoteBuyExactOut(
            provider,
            tokenAddress,
            amountOut,
          );
          setEstimatedCost(ethNeeded === 0n ? null : ethNeeded); // null => no quote / pool missing
        } else {
          // Bonding Curve Quote
          const factory = getFactoryReadOnly();
          const currentRaw: bigint = await factory.curveSupply(tokenAddress);
          const amountRaw = ethers.parseUnits(qty, 18);
          const cost: bigint = await factory.calculateCost(currentRaw, amountRaw);
          const denom = curveFeeDenominator === 0n ? DEFAULT_BPS_DENOMINATOR : curveFeeDenominator;
          const feePortion = (cost * curveFeeBps) / denom;
          setEstimatedCost(cost + feePortion);
        }
      } catch (e) {
        console.error("cost calc fail", e);
        setEstimatedCost(null);
      } finally {
        setLoadingCost(false);
      }
    };
    run();
  }, [qty, tokenAddress, isDexMode, curveFeeBps, curveFeeDenominator]);

  // estimate sell refund
  useEffect(() => {
    const run = async () => {
      if (!sellQty || Number(sellQty) <= 0) {
        setEstRefund(null);
        return;
      }
      try {
        if (isDexMode) {
          // DEX Quote: Sell Tokens -> Get SEI
          const rpc = process.env.NEXT_PUBLIC_SEPOLIA_RPC!;
          const provider = new ethers.JsonRpcProvider(rpc);
          const amountIn = ethers.parseUnits(sellQty, 18);
          const ethOut = await getDexQuoteSell(provider, tokenAddress, amountIn);
          setEstRefund(ethOut);
        } else {
          // Bonding Curve Quote
          const factory = getFactoryReadOnly();
          const currentRaw: bigint = await factory.curveSupply(tokenAddress);
          const amountRaw = ethers.parseUnits(sellQty, 18);

          // 🔒 Guard: don't ask contract to compute refund for more than current supply
          if (amountRaw > currentRaw) {
            setEstRefund(null);
            return;
          }

          const refund: bigint = await factory.calculateRefund(
            currentRaw,
            amountRaw,
          );
          setEstRefund(refund);
        }
      } catch (e) {
        console.error("refund calc fail", e);
        setEstRefund(null);
      }
    };
    run();
  }, [sellQty, tokenAddress, isDexMode]);

  useEffect(() => {
    loadToken();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tokenAddress]);

  useEffect(() => {
    const fetchSeiPrice = async () => {
      try {
        const res = await fetch(
          "https://api.coingecko.com/api/v3/simple/price?ids=sei-network&vs_currencies=usd",
        );
        const json = await res.json();
        const price = Number(json?.["sei-network"]?.usd);
        if (!Number.isNaN(price)) setEthUsd(price);
      } catch (e) {
        console.error("Failed to fetch SEI price", e);
      }
    };
    fetchSeiPrice();
  }, []);



  const handleBuy = async () => {
    if (!account) return alert("Connect wallet first");
    if (!estimatedCost) return alert("Invalid amount");
    setPending(true);
    try {
      const provider = getBrowserProvider();
      let txHash = "";
      let ethSpent = estimatedCost;

      if (isDexMode) {
        // DEX Buy
        // estimatedCost is the SEI amount needed to buy `qty` tokens
        // We'll add a slippage tolerance, say 1%? Or just pass estimatedCost as max?
        // swapSEIForExactTokens(amountOut, path, to, deadline)
        // But our helper `buyTokenDex` uses `swapExactSEIForTokens`.
        // Let's use `buyTokenDex` which swaps EXACT SEI for MIN tokens.
        // So we treat `estimatedCost` as the SEI we are spending.
        // And `qty` as the expected tokens.
        // We should recalculate min tokens out based on slippage.

        const amountOutMin = ethers.parseUnits(qty, 18) * 95n / 100n; // 5% slippage for safety
        const receipt = await buyTokenDex(provider, tokenAddress, estimatedCost, amountOutMin, account);
        txHash = receipt.hash;
      } else {
        // Bonding Curve Buy
        const factory = await getFactoryContract();
        const tx = await factory.buyMemeToken(
          tokenAddress,
          ethers.parseUnits(qty, 0), // Wait, qty is string, parseUnits(qty, 0) means wei if qty is integer?
          // The original code used parseUnits(qty, 0) which is weird if qty is "100" tokens (100 * 10^18).
          // Let's check original code: `ethers.parseUnits(qty, 0)`
          // If the user types "1", it sends "1" wei? That seems wrong for a token with 18 decimals.
          // Ah, the factory `buyMemeToken` might take raw amount?
          // Let's assume the original code was correct for the Factory.
          // But for DEX, we definitely need 18 decimals.
          { value: estimatedCost },
        );
        const receipt = await tx.wait();
        txHash = receipt.hash;
      }

      try {
        await axios.post("/api/trades", {
          token: tokenAddress,
          hash: txHash,
          side: "buy",
          tokens: Number(qty),
          eth: Number(ethers.formatEther(ethSpent)),
          timestamp: Date.now(),
          user: account,
        });
      } catch (_) { }

      setQty("0");
      setEstimatedCost(null);
      await loadToken();
    } catch (err: any) {
      // Only log non-user-rejection errors to console
      if (!err?.code || (err.code !== 4001 && err.code !== -32603)) {
        console.error("Transaction error:", err);
      }
      
      const errorInfo = getTransactionError(err);
      setErrorModal({
        isOpen: true,
        title: errorInfo.title,
        message: errorInfo.message,
      });
    } finally {
      setPending(false);
    }
  };

  const handleSell = async () => {
    if (!account) return alert("Connect wallet first");
    if (!sellQty || Number(sellQty) <= 0) return;
    setPending(true);
    try {
      const provider = getBrowserProvider();
      let txHash = "";
      let ethReceived = 0n;

      if (isDexMode) {
        // DEX Sell
        const amountIn = ethers.parseUnits(sellQty, 18);

        // Check Allowance
        const allowance = await checkAllowance(provider, tokenAddress, account);
        if (allowance < amountIn) {
          const approveReceipt = await approveToken(provider, tokenAddress, amountIn);
          console.log("Approved", approveReceipt.hash);
        }

        const minEthOut = (estRefund || 0n) * 95n / 100n; // 5% slippage
        const receipt = await sellTokenDex(provider, tokenAddress, amountIn, minEthOut, account);
        txHash = receipt.hash;
        ethReceived = estRefund || 0n; // Approximation for DB
      } else {
        // Bonding Curve Sell
        const factory = await getFactoryContract();
        const tx = await factory.sellMemeToken(
          tokenAddress,
          ethers.parseUnits(sellQty, 0), // Again, keeping original logic
        );
        const receipt = await tx.wait();
        txHash = receipt.hash;
        ethReceived = estRefund || 0n;
      }

      try {
        await axios.post("/api/trades", {
          token: tokenAddress,
          hash: txHash,
          side: "sell",
          tokens: Number(sellQty),
          eth: Number(ethers.formatEther(ethReceived)),
          timestamp: Date.now(),
          user: account,
        });
      } catch (_) { }

      setSellQty("0");
      setEstRefund(null);
      await loadToken();
    } catch (err: any) {
      // Only log non-user-rejection errors to console
      if (!err?.code || (err.code !== 4001 && err.code !== -32603)) {
        console.error("Transaction error:", err);
      }
      
      const errorInfo = getTransactionError(err);
      setErrorModal({
        isOpen: true,
        title: errorInfo.title,
        message: errorInfo.message,
      });
    } finally {
      setPending(false);
    }
  };

  if (!token) {
    return (
      <main className="min-h-screen bg-[#050816] text-white p-6">
        <Link href="/" className="text-xs text-slate-400 hover:text-white">
          &larr; Back
        </Link>
        <p className="mt-10">Loading token...</p>
      </main>
    );
  }

  // ----- Build price points from trades: price = sei / tokens -----
  const sortedTrades = trades.slice().sort((a, b) => a.timestamp - b.timestamp);
  const selectedRange = TIME_RANGE_CONFIG[timeRange];
  const priceEvents = buildPriceEvents(sortedTrades);
  const candles: Candle[] = buildCandles(sortedTrades, timeRange);

  console.log("[TokenPage render]", {
    tradesLen: trades.length,
    candlesLen: candles.length,
    timeRange,
    firstTrade: trades[0],
    firstCandle: candles[0],
  });

  const now = Date.now();
  const last24hTrades = trades.filter(
    (t) => now - t.timestamp <= 24 * 60 * 60 * 1000,
  );
  const volumeEth24h = last24hTrades.reduce(
    (acc, t) => acc + (t.eth || 0),
    0,
  );
  const volumeTokens24h = last24hTrades.reduce(
    (acc, t) => acc + (t.tokens || 0),
    0,
  );
  const volumeUsd24h = ethUsd !== null ? volumeEth24h * ethUsd : null;

  // 👉 current price (SEI per token) from last candle or last trade, fallback to initial price
  let lastPriceEth: number | null = null;
  if (candles.length > 0) {
    lastPriceEth = candles[candles.length - 1].close;
  } else if (priceEvents.length > 0) {
    lastPriceEth = priceEvents[priceEvents.length - 1].y;
  } else if (initialPrice !== null) {
    // Use initial price from bonding curve when no trades exist
    // INITIAL_PRICE is in wei per token, convert to SEI
    lastPriceEth = Number(ethers.formatEther(initialPrice));
  }

  const lastPriceUsd =
    lastPriceEth !== null && ethUsd !== null
      ? lastPriceEth * ethUsd
      : null;

  const curveSupplyTokens =
    curveSupply !== null
      ? Number(ethers.formatUnits(curveSupply, 18))
      : null;

  // Market cap: use current price * max supply for initial market cap, or total supply for current market cap
  // If no trades, use initial price * max supply for initial market cap
  let marketCapEth: number | null = null;
  if (lastPriceEth !== null) {
    // For initial market cap (no trades), use maxSupply
    if (priceEvents.length === 0 && maxSupply !== null) {
      const maxSupplyTokens = Number(ethers.formatUnits(maxSupply, 18));
      marketCapEth = lastPriceEth * maxSupplyTokens;
    } else if (totalSupply !== null) {
      // Use total supply for current market cap calculation
      const totalSupplyTokens = Number(ethers.formatUnits(totalSupply, 18));
      marketCapEth = lastPriceEth * totalSupplyTokens;
    } else if (curveSupplyTokens !== null && !token?.isLaunched) {
      // Fallback to curve supply for bonding curve phase
      marketCapEth = lastPriceEth * curveSupplyTokens;
    }
  }

  const marketCapUsd =
    marketCapEth !== null && ethUsd !== null
      ? marketCapEth * ethUsd
      : null;
  const curveFeePercent =
    Number(curveFeeDenominator) > 0
      ? (Number(curveFeeBps) / Number(curveFeeDenominator)) * 100
      : (Number(curveFeeBps) / Number(DEFAULT_BPS_DENOMINATOR)) * 100;
  const curveFeePercentLabel = Number.isFinite(curveFeePercent)
    ? Number.isInteger(curveFeePercent)
      ? curveFeePercent.toString()
      : curveFeePercent.toFixed(2)
    : "0";

  // 👉 Bonding curve completion percentage (0–100, with one decimal)
  let fundingCompletionPct = 0;
  if (FUNDING_GOAL_WEI > 0n) {
    const fundingRaisedWei = token.fundingRaised;
    const rawPctScaled = Number((fundingRaisedWei * 10000n) / FUNDING_GOAL_WEI); // scaled by 100
    fundingCompletionPct = rawPctScaled / 100;
    if (fundingCompletionPct > 100) fundingCompletionPct = 100;
  }
  if (token.isLaunched) {
    fundingCompletionPct = 100;
  }

  // 🔹 Price change helpers for 1D, 1W, 1M, ALL
  const computeChange = (periodMs: number | "all") => {
    if (!lastPriceEth || !priceEvents.length) {
      return { changePct: null as number | null, changeAbs: null as number | null };
    }

    let basePrice: number | null = null;

    if (periodMs === "all") {
      basePrice = priceEvents[0].y;
    } else {
      const cutoff = now - periodMs;
      const candidate = priceEvents.find((p) => p.x >= cutoff);
      basePrice = candidate ? candidate.y : priceEvents[0].y;
    }

    if (!basePrice || basePrice <= 0) {
      return { changePct: null, changeAbs: null };
    }

    const changeAbs = lastPriceEth - basePrice;
    const changePct = (changeAbs / basePrice) * 100;

    return { changePct, changeAbs };
  };

  const oneDayMs = 24 * 60 * 60 * 1000;
  const oneWeekMs = 7 * oneDayMs;
  const oneMonthMs = 30 * oneDayMs;

  const change1d = computeChange(oneDayMs);
  const change1w = computeChange(oneWeekMs);
  const change1m = computeChange(oneMonthMs);
  const changeAll = computeChange("all");

  const formatChangeBox = (change: { changePct: number | null }) => {
    if (change.changePct === null) return { text: "—", className: "text-slate-400" };
    const pct = change.changePct;
    const sign = pct > 0 ? "+" : "";
    const colorClass =
      pct > 0
        ? "text-emerald-300"
        : pct < 0
          ? "text-rose-300"
          : "text-slate-300";
    return {
      text: `${sign}${pct.toFixed(2)}%`,
      className: colorClass,
    };
  };

  const changeViews = {
    "1D": formatChangeBox(change1d),
    "1W": formatChangeBox(change1w),
    "1M": formatChangeBox(change1m),
    All: formatChangeBox(changeAll),
  } as const;

  return (
    <main className="min-h-screen bg-gradient-to-b from-[#050816] via-[#050319] to-[#020617] text-slate-50">
      <TransactionErrorModal
        isOpen={errorModal.isOpen}
        onClose={() => setErrorModal({ isOpen: false, title: "", message: "" })}
        title={errorModal.title}
        message={errorModal.message}
      />
      <Navbar account={account} onConnect={connect} onDisconnect={disconnect} />
      <div className="mx-auto max-w-6xl space-y-8 px-4 py-8">
        {/* ------- TOP: Token header + stat boxes ------- */}
        <section className="rounded-3xl border border-cyan-500/20 bg-[radial-gradient(circle_at_top,_rgba(34,211,238,0.18),_transparent_55%),_radial-gradient(circle_at_bottom,_rgba(236,72,153,0.16),_transparent_60%)] p-6 shadow-[0_0_50px_rgba(15,23,42,0.8)] backdrop-blur">
          <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
            {/* Left: avatar + name + status */}
            <div className="flex items-center gap-4">
              {token.tokenImageUrl && (
                <div className="relative">
                  <div className="rounded-3xl bg-gradient-to-tr from-cyan-500 via-fuchsia-500 to-amber-300 p-[2px] shadow-[0_0_20px_rgba(59,130,246,0.8)]">
                    <img
                      src={token.tokenImageUrl}
                      alt={token.name}
                      className="h-16 w-16 rounded-3xl border border-slate-900 object-cover"
                    />
                  </div>
                  <span className="absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full bg-slate-900 text-[10px] font-bold text-cyan-300 shadow-[0_0_15px_rgba(34,211,238,0.9)] ring-2 ring-cyan-400/60">
                    Ξ
                  </span>
                </div>
              )}
              <div>
                <Link
                  href="/"
                  className="inline-flex items-center gap-1 rounded-full bg-white/5 px-3 py-1 text-[10px] text-slate-300 shadow-sm hover:bg-white/10"
                >
                  <span className="text-xs">←</span>
                  Back to listings
                </Link>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <h1 className="text-3xl font-semibold tracking-tight text-white drop-shadow-[0_0_18px_rgba(15,23,42,0.9)]">
                        {token.name}
                      </h1>
                      <span className="rounded-full bg-white/10 px-2 py-0.5 text-xs font-semibold text-cyan-200 shadow-[0_0_10px_rgba(34,211,238,0.6)]">
                        {token.symbol}
                      </span>
                    </div>
                    <p className="mt-1 text-[11px] text-slate-300">
                      {token.tokenAddress.slice(0, 6)}...
                      {token.tokenAddress.slice(-4)} ·{" "}
                      <span className="text-cyan-300">Sei Network</span>
                    </p>
                  </div>
                  {token.isLaunched ? (
                    <span className="inline-flex items-center gap-1 rounded-full border border-emerald-400/40 bg-emerald-500/20 px-2 py-0.5 text-[10px] font-semibold text-emerald-100 shadow-[0_0_12px_rgba(52,211,153,0.5)]">
                      <CheckCircleIcon className="h-3 w-3" />
                      Launched
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded-full border border-amber-400/40 bg-amber-500/20 px-2 py-0.5 text-[10px] font-semibold text-amber-100 shadow-[0_0_12px_rgba(251,191,36,0.5)]">
                      <ClockIcon className="h-3 w-3" />
                      Bonding curve phase
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Right: Pump.fun-style stat boxes */}
            <div className="flex w-full flex-col gap-4 md:w-auto md:items-end md:text-right">
              {/* Stat boxes grid */}
              <div className="grid w-full gap-3 text-xs sm:text-sm text-slate-200 sm:grid-cols-2 lg:grid-cols-4 md:w-[520px]">
                {/* Price */}
                <div className="rounded-2xl border border-cyan-400/30 bg-slate-950/60 px-3 py-2.5 shadow-[0_0_20px_rgba(34,211,238,0.25)]">
                  <p className="text-[10px] font-medium uppercase tracking-wide text-cyan-300/80">
                    Price
                  </p>
                  <p className="mt-1 text-sm font-semibold text-white">
                    {lastPriceEth !== null
                      ? `${lastPriceEth.toFixed(8)} SEI`
                      : "—"}
                  </p>
                  <p className="text-[10px] text-slate-400">
                    {lastPriceUsd !== null
                      ? `≈ $${lastPriceUsd.toFixed(4)}`
                      : priceEvents.length === 0 && initialPrice !== null
                        ? "Initial price"
                        : "Awaiting first trade"}
                  </p>
                </div>

                {/* Market cap */}
                <div className="rounded-2xl border border-fuchsia-400/30 bg-slate-950/60 px-3 py-2.5 shadow-[0_0_20px_rgba(236,72,153,0.25)]">
                  <p className="text-[10px] font-medium uppercase tracking-wide text-fuchsia-300/80">
                    Market cap
                  </p>
                  <p className="mt-1 text-sm font-semibold text-white">
                    {marketCapEth !== null
                      ? `${marketCapEth.toFixed(4)} SEI`
                      : "—"}
                  </p>
                  <p className="text-[10px] text-slate-400">
                    {marketCapUsd !== null
                      ? `≈ $${marketCapUsd.toFixed(2)}`
                      : priceEvents.length === 0 && initialPrice !== null && maxSupply !== null
                        ? "Initial market cap"
                        : "Based on curve supply"}
                  </p>
                </div>

                {/* 24h Volume */}
                <div className="rounded-2xl border border-emerald-400/30 bg-slate-950/60 px-3 py-2.5 shadow-[0_0_20px_rgba(16,185,129,0.25)]">
                  <p className="text-[10px] font-medium uppercase tracking-wide text-emerald-300/80">
                    24h Volume
                  </p>
                  <p className="mt-1 text-sm font-semibold text-white">
                    {volumeEth24h.toFixed(4)} SEI
                  </p>
                  <p className="text-[10px] text-slate-400">
                    {volumeUsd24h !== null
                      ? `≈ $${volumeUsd24h.toFixed(2)} · ${volumeTokens24h.toFixed(0)} ${token.symbol}`
                      : `${volumeTokens24h.toFixed(0)} ${token.symbol}`}
                  </p>
                </div>

                {/* Curve supply */}
                <div className="rounded-2xl border border-amber-400/30 bg-slate-950/60 px-3 py-2.5 shadow-[0_0_20px_rgba(245,158,11,0.25)]">
                  <p className="text-[10px] font-medium uppercase tracking-wide text-amber-300/80">
                    Curve supply
                  </p>
                  <p className="mt-1 text-sm font-semibold text-white">
                    {curveSupplyTokens !== null
                      ? curveSupplyTokens.toLocaleString(undefined, {
                        maximumFractionDigits: 2,
                      }) +
                      " " +
                      token.symbol
                      : "—"}
                  </p>
                  <p className="text-[10px] text-slate-400">
                    {token.isLaunched
                      ? "Supply graduated to DEX"
                      : "Live supply on bonding curve"}
                  </p>
                </div>
              </div>

              {/* Funding raised + completion bar */}
              <div className="w-full md:w-[520px]">
                <div className="flex items-center justify-between text-[11px] text-slate-200">
                  <span>
                    Bonding Curve Progress:{" "}
                    <span className="font-semibold text-white">
                      {fundingCompletionPct.toFixed(1)}%
                    </span>
                  </span>
                  <span className="inline-flex items-center gap-1 rounded-full bg-slate-900/80 px-2 py-0.5 text-[10px] font-medium text-amber-200">
                    <SparklesIcon className="h-3 w-3 text-amber-300" />
                    {ethers.formatEther(token.fundingRaised)} / {ethers.formatEther(FUNDING_GOAL_WEI)} SEI
                  </span>
                </div>
                <div className="mt-1 relative h-3 w-full overflow-hidden rounded-full bg-slate-800/70 shadow-inner">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-cyan-400 via-emerald-400 to-amber-400 shadow-[0_0_15px_rgba(56,189,248,0.6)] transition-all duration-500 relative"
                    style={{ width: `${fundingCompletionPct}%` }}
                  >
                    <div className="absolute inset-0 bg-white/20 animate-pulse"></div>
                  </div>
                  {fundingCompletionPct >= 100 && (
                    <span className="pointer-events-none absolute -right-1 -top-1.5">
                      <SparklesIcon className="h-4 w-4 text-amber-300 drop-shadow-[0_0_8px_rgba(251,191,36,0.8)]" />
                    </span>
                  )}
                </div>
                <p className="mt-1 text-[10px] text-slate-300">
                  {token.isLaunched
                    ? "Graduated: curve target reached and launched on DEX."
                    : `${ethers.formatEther(
                      token.fundingRaised,
                    )} / ${ethers.formatEther(
                      FUNDING_GOAL_WEI,
                    )} SEI to graduate.`}
                </p>
                <p className="mt-1 text-[10px] text-slate-500">
                  Sei · Bonding curve analytics
                </p>
              </div>
            </div>
          </div>

          <p className="mt-4 text-sm text-slate-200">{token.description}</p>
        </section>

        {/* ------- MIDDLE: Price chart (TradingView candles) ------- */}
        <section className="rounded-3xl border border-white/10 bg-gradient-to-b from-white/5 via-white/10 to-white/5 p-5 shadow-[0_0_40px_rgba(15,23,42,0.7)]">
          <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-white">
            <ChartBarIcon className="h-4 w-4 text-cyan-300" />
            Price chart
          </div>

          <AdvancedChart trades={trades} symbol={token.symbol} />

          {/* 🔹 Price change boxes under chart */}
          <div className="mt-5 grid gap-3 text-xs sm:grid-cols-2 lg:grid-cols-4">
            {[
              { label: "1D Change", key: "1D" as const },
              { label: "1W Change", key: "1W" as const },
              { label: "1M Change", key: "1M" as const },
              { label: "All-time Change", key: "All" as const },
            ].map((item) => {
              const view = changeViews[item.key];
              return (
                <div
                  key={item.key}
                  className="rounded-2xl border border-white/10 bg-slate-950/40 px-3 py-2.5"
                >
                  <p className="text-[10px] font-medium uppercase tracking-wide text-slate-400">
                    {item.label}
                  </p>
                  <p
                    className={`mt-1 text-sm font-semibold ${view.className}`}
                  >
                    {view.text}
                  </p>
                </div>
              );
            })}
          </div>
        </section>

        {/* ------- BUY / SELL ------- */}
        <div className="grid gap-6 md:grid-cols-2">
          <div className="rounded-3xl border border-white/10 bg-white/5 p-5 shadow-[0_0_30px_rgba(34,197,94,0.2)] backdrop-blur">
            <div className="flex items-center gap-2 text-sm font-semibold text-white">
              <ArrowTrendingUpIcon className="h-4 w-4 text-emerald-300" />
              {isDexMode ? "Buy on DEX (DragonSwap)" : "Buy on bonding curve"}
            </div>
            <p className="mt-2 text-xs text-slate-400">
              {isDexMode
                ? "Swap SEI for tokens via the DragonSwap pool once liquidity is live."
                : "Choose how many tokens you want to buy. Cost is computed from the curve and paid in SEI."}
            </p>
            <label className="mt-4 block text-xs text-slate-400">
              Amount ({token.symbol})
            </label>
            <input
              type="number"
              min="0"
              step="1"
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white backdrop-blur focus:border-cyan-400/60 focus:outline-none"
            />
            <div className="mt-2 text-xs text-slate-400">
              {loadingCost
                ? "Estimating cost..."
                : estimatedCost
                  ? `Estimated cost (incl. ${curveFeePercentLabel}% fee): ${ethers.formatEther(estimatedCost)} SEI`
                  : isDexMode
                    ? "Enter amount to see DEX quote (pool must have liquidity)."
                    : "Enter amount to see cost"}
            </div>
            <button
              disabled={pending || !estimatedCost}
              onClick={handleBuy}
              className="mt-4 w-full rounded-full bg-gradient-to-r from-emerald-400 to-cyan-400 py-2 text-sm font-semibold text-slate-950 shadow-lg transition hover:brightness-110 disabled:opacity-50"
            >
              {pending ? "Submitting..." : "Buy"}
            </button>
          </div>

          <div className="rounded-3xl border border-white/10 bg-white/5 p-5 shadow-[0_0_30px_rgba(239,68,68,0.2)] backdrop-blur">
            <div className="flex items-center gap-2 text-sm font-semibold text-white">
              <ArrowDownRightIcon className="h-4 w-4 text-rose-300" />
              {isDexMode ? "Sell on DEX (DragonSwap)" : "Sell back to bonding curve"}
            </div>
            {!isDexMode ? (
              <>
                <p className="mt-2 text-xs text-slate-400">
                  Sell tokens back before launch and receive SEI from the curve.
                </p>
                <label className="mt-4 block text-xs text-slate-400">
                  Amount ({token.symbol})
                </label>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={sellQty}
                  onChange={(e) => setSellQty(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white backdrop-blur focus:border-cyan-400/60 focus:outline-none"
                />
                <div className="mt-2 text-xs text-slate-400">
                  {Number(sellQty) > 0 && estRefund === null
                    ? "Amount exceeds current curve supply or cannot be sold yet."
                    : estRefund
                      ? `Estimated refund: ${ethers.formatEther(
                        estRefund,
                      )} SEI`
                      : "Enter amount to see refund"}
                </div>
                <button
                  disabled={pending || Number(sellQty) <= 0}
                  onClick={handleSell}
                  className="mt-4 w-full rounded-full bg-gradient-to-r from-rose-500 to-amber-400 py-2 text-sm font-semibold text-slate-950 shadow-lg transition hover:brightness-110 disabled:opacity-50"
                >
                  {pending ? "Submitting..." : "Sell"}
                </button>
              </>
            ) : (
              <>
                <p className="mt-2 text-xs text-slate-400">
                  Sell your tokens for SEI via the DragonSwap pool. Approval will be requested once if needed.
                </p>
                <label className="mt-4 block text-xs text-slate-400">
                  Amount ({token.symbol})
                </label>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={sellQty}
                  onChange={(e) => setSellQty(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white backdrop-blur focus:border-cyan-400/60 focus:outline-none"
                />
                <div className="mt-2 text-xs text-slate-400">
                  {Number(sellQty) > 0 && estRefund === null
                    ? "Unable to fetch DEX quote (pool may lack liquidity)."
                    : estRefund
                      ? `Estimated proceeds: ${ethers.formatEther(
                        estRefund,
                      )} SEI`
                      : "Enter amount to see DEX quote"}
                </div>
                <button
                  disabled={pending || Number(sellQty) <= 0}
                  onClick={handleSell}
                  className="mt-4 w-full rounded-full bg-gradient-to-r from-rose-500 to-amber-400 py-2 text-sm font-semibold text-slate-950 shadow-lg transition hover:brightness-110 disabled:opacity-50"
                >
                  {pending ? "Submitting..." : "Sell"}
                </button>
              </>
            )}
          </div>
        </div>

        {/* ------- HISTORY / TOP HOLDERS TABS ------- */}
        <section className="rounded-3xl border border-white/10 bg-white/5 p-5 shadow-[0_0_30px_rgba(15,23,42,0.5)] backdrop-blur">
          <div className="flex items-center justify-between gap-4">
            <h3 className="text-sm font-semibold text-white">
              Curve analytics
            </h3>
            <div className="inline-flex rounded-full bg-slate-900/60 p-1 text-[11px]">
              <button
                onClick={() => setBottomTab("history")}
                className={`rounded-full px-3 py-1 ${bottomTab === "history"
                  ? "bg-gradient-to-r from-cyan-400 to-fuchsia-500 text-slate-950 shadow"
                  : "text-slate-300 hover:text-white"
                  }`}
              >
                Trade history
              </button>
              <button
                onClick={() => setBottomTab("holders")}
                className={`rounded-full px-3 py-1 ${bottomTab === "holders"
                  ? "bg-gradient-to-r from-cyan-400 to-fuchsia-500 text-slate-950 shadow"
                  : "text-slate-300 hover:text-white"
                  }`}
              >
                Top holders
              </button>
            </div>
          </div>

          {/* Tab content */}
          {bottomTab === "history" ? (
            trades.length === 0 ? (
              <p className="mt-3 text-xs text-slate-400">
                No trades logged yet. Buy or sell to start building history.
              </p>
            ) : (
              <div className="mt-4 max-h-64 overflow-y-auto">
                <table className="w-full text-xs text-slate-300">
                  <thead className="text-[11px] uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="pb-2 text-left">Side</th>
                      <th className="pb-2 text-left">Tokens</th>
                      <th className="pb-2 text-left">SEI</th>
                      <th className="pb-2 text-left">Time</th>
                      <th className="pb-2 text-left">Tx</th>
                    </tr>
                  </thead>
                  <tbody className="text-[11px]">
                    {sortedTrades
                      .slice()
                      .reverse()
                      .map((t, i) => (
                        <tr
                          key={`${t.hash}-${i}`}
                          className="border-t border-white/10"
                        >
                          <td className="py-2">
                            <span
                              className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${t.side === "buy"
                                ? "bg-emerald-500/15 text-emerald-200 border border-emerald-500/30"
                                : "bg-rose-500/15 text-rose-200 border border-rose-500/30"
                                }`}
                            >
                              {t.side.toUpperCase()}
                            </span>
                          </td>
                          <td className="py-2 text-slate-200">
                            {t.tokens.toFixed(2)} {token.symbol}
                          </td>
                          <td className="py-2 text-slate-200">
                            {t.eth.toFixed(4)} SEI
                          </td>
                          <td className="py-2 text-slate-400">
                            {new Date(t.timestamp).toLocaleTimeString()}
                          </td>
                          <td className="py-2">
                            {t.hash ? (
                              <a
                                href={`https://seitrace.com/tx/${t.hash}`}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1 rounded-full border border-white/15 bg-white/5 px-2 py-0.5 text-[10px] text-cyan-200 transition hover:border-cyan-400/40 hover:text-white"
                              >
                                {t.hash.slice(0, 6)}...{t.hash.slice(-4)}
                              </a>
                            ) : (
                              <span className="text-slate-500">—</span>
                            )}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            )
          ) : (
            <div className="mt-4">
              {holdersLoading ? (
                <p className="text-xs text-slate-400">Loading top holders...</p>
              ) : holders.length === 0 ? (
                <p className="text-xs text-slate-400">
                  Top holders data is not available yet. Wire up{" "}
                  <code className="rounded bg-black/40 px-1 py-0.5">
                    /api/holders?token=
                  </code>{" "}
                  on your backend to power this section.
                </p>
              ) : (
                <div className="max-h-64 overflow-y-auto">
                  <table className="w-full text-xs text-slate-300">
                    <thead className="text-[11px] uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="pb-2 text-left">#</th>
                        <th className="pb-2 text-left">Address</th>
                        <th className="pb-2 text-left">Balance</th>
                        <th className="pb-2 text-left">Share</th>
                      </tr>
                    </thead>
                    <tbody className="text-[11px]">
                      {holders.map((h, idx) => (
                        <tr
                          key={h.address + idx}
                          className="border-t border-white/10"
                        >
                          <td className="py-2 text-slate-400">
                            {idx + 1}
                          </td>
                          <td className="py-2">
                            <span className="font-mono text-[11px] text-cyan-200">
                              {h.address.slice(0, 8)}...
                              {h.address.slice(-4)}
                            </span>
                          </td>
                          <td className="py-2 text-slate-200">
                            {h.balance.toLocaleString(undefined, {
                              maximumFractionDigits: 2,
                            })}{" "}
                            {token.symbol}
                          </td>
                          <td className="py-2 text-slate-200">
                            {h.percent !== undefined
                              ? `${h.percent.toFixed(2)}%`
                              : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </section>
      </div>
    </main >
  );
}
