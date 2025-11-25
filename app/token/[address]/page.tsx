// app/token/[address]/page.tsx
"use client";

import { useParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ethers } from "ethers";
import axios from "axios";
import Link from "next/link";
import { getBrowserProvider, getFactoryContract, getFactoryReadOnly } from "@/lib/ethersClient";
import Navbar from "@/components/Navbar";
import {
  ArrowTrendingUpIcon,
  ArrowDownRightIcon,
  CheckCircleIcon,
  ClockIcon,
  ChartBarIcon,
} from "@heroicons/react/24/outline";

// Chart.js + financial plugin
import {
  Chart as ChartJS,
  LineElement,
  TimeScale,
  TimeSeriesScale,
  LinearScale,
  PointElement,
  Tooltip,
  Legend,
  CategoryScale,
} from "chart.js";
import { Line, Chart as ReactChart } from "react-chartjs-2";
import {
  CandlestickController,
  CandlestickElement,
} from "chartjs-chart-financial";
import "chartjs-adapter-date-fns"; // IMPORTANT for time / timeseries scales

ChartJS.register(
  LineElement,
  PointElement,
  TimeScale,
  TimeSeriesScale,
  LinearScale,
  Tooltip,
  Legend,
  CategoryScale,
  CandlestickController,
  CandlestickElement,
);

let zoomRegistered = false;


// Types
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

type ChartMode = "line" | "candle";
type TimeRange = "1m" | "1h" | "1d" | "1w" | "all";

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
  return trades
    .filter(
      t =>
        typeof t.timestamp === "number" &&
        Number.isFinite(t.timestamp) &&
        t.tokens > 0 &&
        t.eth > 0,
    )
    .map(t => ({
      x: Number(t.timestamp),
      y: t.eth / t.tokens,
    }))
    .filter(p => Number.isFinite(p.x) && Number.isFinite(p.y) && p.y > 0)
    .sort((a, b) => a.x - b.x);
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
  if (priceEvents.length === 0) return [];

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

  for (let bucketStart = alignedStart; bucketStart <= alignedEnd; bucketStart += bucketMs) {
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

  const [chartMode, setChartMode] = useState<ChartMode>("line");
  const [timeRange, setTimeRange] = useState<TimeRange>("1h");
  const [zoomReady, setZoomReady] = useState<boolean>(zoomRegistered);
  const [ethUsd, setEthUsd] = useState<number | null>(null);
  const lineChartRef = useRef<ChartJS<"line"> | null>(null);
  const candleChartRef = useRef<ChartJS | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (zoomRegistered) {
      setZoomReady(true);
      return;
    }
    let isMounted = true;
    import("chartjs-plugin-zoom")
      .then(mod => {
        if (!isMounted || zoomRegistered) return;
        const zoomPlugin = mod.default;
        ChartJS.register(zoomPlugin);
        zoomRegistered = true;
        setZoomReady(true);
      })
      .catch(err => console.error("Failed to load chart zoom plugin", err));
    return () => {
      isMounted = false;
    };
  }, []);

  const connect = async () => {
    const provider = getBrowserProvider();
    const accounts = await provider.send("eth_requestAccounts", []);
    setAccount(accounts[0]);
  };

  const disconnect = () => setAccount(null);

  const loadToken = async () => {
    const factory = getFactoryReadOnly();
    const list: MemeToken[] = await factory.getAllMemeTokens();
    const t = list.find(
      m => m.tokenAddress.toLowerCase() === tokenAddress.toLowerCase()
    );
    if (t) setToken(t);

    try {
      const res = await axios.get(`/api/trades?token=${tokenAddress}`);
      setTrades(res.data.trades || []);
    } catch (e) {
      console.log("No trade history yet", e);
    }
  };

  // estimate buy cost
  useEffect(() => {
    const run = async () => {
      if (!tokenAddress || !qty || Number(qty) <= 0) {
        setEstimatedCost(null);
        return;
      }
      setLoadingCost(true);
      try {
        const factory = getFactoryReadOnly();
        const currentRaw: bigint = await factory.curveSupply(tokenAddress);
        const amountRaw = ethers.parseUnits(qty, 18);
        const cost: bigint = await factory.calculateCost(currentRaw, amountRaw);
        setEstimatedCost(cost);
      } catch (e) {
        console.error("cost calc fail", e);
        setEstimatedCost(null);
      } finally {
        setLoadingCost(false);
      }
    };
    run();
  }, [qty, tokenAddress]);

  // estimate sell refund
  // estimate sell refund
  useEffect(() => {
    const run = async () => {
      if (!sellQty || Number(sellQty) <= 0) {
        setEstRefund(null);
        return;
      }
      try {
        const factory = getFactoryReadOnly();
        const currentRaw: bigint = await factory.curveSupply(tokenAddress);
        const amountRaw = ethers.parseUnits(sellQty, 18);

        // 🔒 Guard: don't ask contract to compute refund for more than current supply
        if (amountRaw > currentRaw) {
          setEstRefund(null);
          // optionally: you can show a message in UI like "Amount exceeds current curve supply"
          return;
        }

        const refund: bigint = await factory.calculateRefund(currentRaw, amountRaw);
        setEstRefund(refund);
      } catch (e) {
        console.error("refund calc fail", e);
        setEstRefund(null);
      }
    };
    run();
  }, [sellQty, tokenAddress]);


  useEffect(() => {
    loadToken();
  }, [tokenAddress]);

  useEffect(() => {
    const fetchEthPrice = async () => {
      try {
        const res = await fetch("https://api.coinbase.com/v2/prices/ETH-USD/spot");
        const json = await res.json();
        const price = Number(json?.data?.amount);
        if (!Number.isNaN(price)) setEthUsd(price);
      } catch (e) {
        console.error("Failed to fetch ETH price", e);
      }
    };
    fetchEthPrice();
  }, []);

  useEffect(() => {
    lineChartRef.current?.resetZoom?.();
    candleChartRef.current?.resetZoom?.();
  }, [timeRange, chartMode, zoomReady]);

  const handleResetView = () => {
    lineChartRef.current?.resetZoom?.();
    candleChartRef.current?.resetZoom?.();
  };

  const handleBuy = async () => {
    if (!account) return alert("Connect wallet first");
    if (!estimatedCost) return alert("Invalid amount");
    setPending(true);
    try {
      const factory = await getFactoryContract();
      const tx = await factory.buyMemeToken(
        tokenAddress,
        ethers.parseUnits(qty, 0),
        { value: estimatedCost }
      );
      const receipt = await tx.wait();

      try {
        await axios.post("/api/trades", {
          token: tokenAddress,
          hash: receipt.hash,
          side: "buy",
          tokens: Number(qty),
          eth: Number(ethers.formatEther(estimatedCost)),
          timestamp: Date.now(),
        });
      } catch (_) { }

      setQty("0");
      setEstimatedCost(null);
      await loadToken();
    } catch (err: any) {
      console.error(err);
      alert(err?.reason || "Buy failed");
    } finally {
      setPending(false);
    }
  };

  const handleSell = async () => {
    if (!account) return alert("Connect wallet first");
    if (!sellQty || Number(sellQty) <= 0) return;
    setPending(true);
    try {
      const factory = await getFactoryContract();
      const tx = await factory.sellMemeToken(
        tokenAddress,
        ethers.parseUnits(sellQty, 0)
      );
      const receipt = await tx.wait();

      let ethOut = 0;
      if (estRefund) {
        ethOut = Number(ethers.formatEther(estRefund));
      }

      try {
        await axios.post("/api/trades", {
          token: tokenAddress,
          hash: receipt.hash,
          side: "sell",
          tokens: Number(sellQty),
          eth: ethOut,
          timestamp: Date.now(),
        });
      } catch (_) { }

      setSellQty("0");
      setEstRefund(null);
      await loadToken();
    } catch (err: any) {
      console.error(err);
      alert(err?.reason || "Sell failed");
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

  // ----- Build price points from trades: price = eth / tokens -----
  const sortedTrades = trades.slice().sort((a, b) => a.timestamp - b.timestamp);
  const selectedRange = TIME_RANGE_CONFIG[timeRange];
  const priceEvents = buildPriceEvents(sortedTrades);
  const candles: Candle[] = buildCandles(sortedTrades, timeRange);
  const lineSeriesPoints = candles.map(c => ({
    x: c.bucketStart,
    y: c.close,
  }));

  const now = Date.now();
  const last24hTrades = trades.filter(t => now - t.timestamp <= 24 * 60 * 60 * 1000);
  const volumeEth24h = last24hTrades.reduce((acc, t) => acc + (t.eth || 0), 0);
  const volumeTokens24h = last24hTrades.reduce((acc, t) => acc + (t.tokens || 0), 0);
  const volumeUsd24h =
    ethUsd !== null ? volumeEth24h * ethUsd : null;

  // ----- Line chart config -----
  const chartInstanceKey = zoomReady ? "zoom-ready" : "zoom-loading";

  const lineData = {
    datasets: [
      {
        label: "Curve Price (ETH per token)",
        data: lineSeriesPoints,
        borderColor: "#a855f7",
        borderWidth: 1.5,
        tension: 0.25,
        pointRadius: 0,
        pointHoverRadius: 4,
        pointHitRadius: 6,
        parsing: false as const,
      },
    ],
  };

  const chartZoomBlueprint: any = {
    pan: {
      enabled: true,
      mode: "x",
      modifierKey: null,
    },
    zoom: {
      wheel: {
        enabled: true,
      },
      pinch: {
        enabled: true,
      },
      drag: {
        enabled: false,
      },
      mode: "x",
    },
    limits: {
      x: {
        min: "original",
        max: "original",
      },
    },
  };

  const buildZoomOptions = () => ({
    pan: { ...chartZoomBlueprint.pan },
    zoom: {
      ...chartZoomBlueprint.zoom,
      wheel: { ...chartZoomBlueprint.zoom.wheel },
      pinch: { ...chartZoomBlueprint.zoom.pinch },
      drag: { ...chartZoomBlueprint.zoom.drag },
    },
    limits: {
      ...chartZoomBlueprint.limits,
      x: { ...chartZoomBlueprint.limits.x },
    },
  });

  const lineOptions = {
    responsive: true,
    maintainAspectRatio: false as const,
    plugins: {
      legend: {
        display: false,
      },
      tooltip: {
        callbacks: {
          label: (ctx: any) => {
            const v = ctx.parsed.y;
            return `Price: ${v.toFixed(8)} ETH`;
          },
        },
      },
      zoom: buildZoomOptions(),
    },
    scales: {
      x: {
        type: "timeseries" as const,
        time: {
          unit: selectedRange.timeUnit,
        },
        ticks: {
          maxTicksLimit: 6,
          maxRotation: 0,
        },
        grid: {
          color: "rgba(255,255,255,0.05)",
        },
      },
      y: {
        ticks: {
          callback: (value: any) => Number(value).toFixed(6),
        },
        grid: {
          color: "rgba(255,255,255,0.05)",
        },
      },
    },
  };

  // ----- Candlestick chart config -----
  const candleData = {
    datasets: [
      {
        label: "Curve Price (ETH per token)",
        data: candles.map(c => ({
          x: c.bucketStart,
          o: c.open,
          h: c.high,
          l: c.low,
          c: c.close,
        })),
        borderWidth: 1,
        barThickness: 6,
        color: {
          up: "#22c55e",
          down: "#ef4444",
          unchanged: "#94a3b8",
        },
        borderColor: {
          up: "#22c55e",
          down: "#ef4444",
          unchanged: "#94a3b8",
        },
      },
    ],
  };


  const candleOptions = {
    responsive: true,
    maintainAspectRatio: false as const,
    parsing: false as const, // we already provide {x,o,h,l,c}
    plugins: {
      legend: {
        display: false,
      },
      tooltip: {
        callbacks: {
          label: (ctx: any) => {
            const v = ctx.raw as { o: number; h: number; l: number; c: number };
            return `O: ${v.o.toFixed(8)}  H: ${v.h.toFixed(8)}  L: ${v.l.toFixed(8)}  C: ${v.c.toFixed(8)} ETH`;
          },
        },
      },
      zoom: buildZoomOptions(),
    },
    scales: {
      x: {
        type: "timeseries" as const,
        time: {
          unit: selectedRange.timeUnit,
        },
        ticks: {
          maxTicksLimit: 6,
          maxRotation: 0,
        },
        grid: {
          color: "rgba(255,255,255,0.05)",
        },
      },
      y: {
        ticks: {
          callback: (value: any) => Number(value).toFixed(6),
        },
        grid: {
          color: "rgba(255,255,255,0.05)",
        },
      },
    },
  };

  return (
    <main className="min-h-screen bg-gradient-to-b from-[#050816] via-[#050319] to-[#020617] text-slate-50">
      <Navbar account={account} onConnect={connect} onDisconnect={disconnect} />
      <div className="mx-auto max-w-6xl space-y-8 px-4 py-8">
        <section className="rounded-3xl border border-white/10 bg-white/5 p-6 shadow-[0_0_40px_rgba(15,23,42,0.6)] backdrop-blur">
          <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-4">
              {token.tokenImageUrl && (
                <div className="relative">
                  <img
                    src={token.tokenImageUrl}
                    alt={token.name}
                    className="h-16 w-16 rounded-2xl border border-white/10 object-cover"
                  />
                  <span className="absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full bg-gradient-to-tr from-cyan-400 to-fuchsia-500 text-[10px] font-bold text-slate-950 shadow-lg">
                    Ξ
                  </span>
                </div>
              )}
              <div>
                <Link href="/" className="text-xs text-slate-500 hover:text-white">
                  &larr; Back to listings
                </Link>
                <div className="mt-1 flex items-center gap-2">
                  <h1 className="text-2xl font-semibold text-white">
                    {token.name}
                    <span className="text-sm text-slate-400"> ({token.symbol})</span>
                  </h1>
                  {token.isLaunched ? (
                    <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/15 px-2 py-0.5 text-[10px] text-emerald-200">
                      <CheckCircleIcon className="h-3 w-3" />
                      Launched
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/15 px-2 py-0.5 text-[10px] text-amber-200">
                      <ClockIcon className="h-3 w-3" />
                      Bonding curve
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-slate-400">
                  {token.tokenAddress.slice(0, 6)}...{token.tokenAddress.slice(-4)} · Sei Network
                </p>
              </div>
            </div>
            <div className="grid gap-2 text-sm text-slate-300 md:justify-items-end">
              <div>
                Funding raised:{" "}
                <span className="font-semibold text-white">{ethers.formatEther(token.fundingRaised)} ETH</span>
              </div>
              <div>
                24h Vol:{" "}
                <span className="font-semibold text-white">
                  {volumeTokens24h.toFixed(0)} {token.symbol} · {volumeEth24h.toFixed(4)} ETH
                </span>
                {volumeUsd24h !== null && (
                  <span className="text-slate-400"> · ${volumeUsd24h.toFixed(2)}</span>
                )}
              </div>
              <span className="rounded-full border border-white/15 bg-white/5 px-3 py-1 text-[11px] text-slate-300">
                Sei · Bonding Curve Analytics
              </span>
            </div>
          </div>
          <p className="mt-4 text-sm text-slate-400">{token.description}</p>
        </section>

        <section className="h-[360px] rounded-3xl border border-white/10 bg-gradient-to-b from-white/5 via-white/10 to-white/5 p-5 shadow-[0_0_40px_rgba(15,23,42,0.7)]">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-2 text-sm font-semibold text-white">
              <ChartBarIcon className="h-4 w-4 text-cyan-300" />
              Price chart
            </div>
            <div className="flex flex-wrap gap-2 text-[11px]">
              {TIME_RANGE_ORDER.map(range => (
                <button
                  key={range}
                  onClick={() => setTimeRange(range)}
                  className={`rounded-full px-3 py-1 ${timeRange === range
                      ? "bg-gradient-to-r from-cyan-400 to-fuchsia-500 text-slate-950 shadow"
                      : "bg-white/5 text-slate-200 hover:text-white"
                    }`}
                >
                  {TIME_RANGE_CONFIG[range].label}
                </button>
              ))}
            </div>
            <div className="flex gap-2 text-[11px]">
              <button
                onClick={() => setChartMode("line")}
                className={`rounded-full px-3 py-1 ${chartMode === "line"
                    ? "bg-gradient-to-r from-cyan-400 to-fuchsia-500 text-slate-950 shadow"
                    : "bg-white/5 text-slate-200 hover:text-white"
                  }`}
              >
                Line
              </button>
              <button
                onClick={() => setChartMode("candle")}
                className={`rounded-full px-3 py-1 ${chartMode === "candle"
                    ? "bg-gradient-to-r from-cyan-400 to-fuchsia-500 text-slate-950 shadow"
                    : "bg-white/5 text-slate-200 hover:text-white"
                  }`}
              >
                Candle
              </button>
              <button
                onClick={handleResetView}
                className="rounded-full border border-white/15 bg-white/5 px-3 py-1 text-slate-200 transition hover:bg-white/10"
              >
                Reset
              </button>
            </div>
          </div>
          <div className="mt-4 h-[260px]">
            {candles.length === 0 ? (
              <p className="text-xs text-slate-400">
                {priceEvents.length === 0
                  ? "No trades yet. Buy or sell on the curve to start building a price chart."
                  : "Not enough data to render this timeframe yet. Try a wider range."}
              </p>
            ) : chartMode === "line" ? (
              <Line
                key={`line-${chartInstanceKey}`}
                ref={lineChartRef}
                data={lineData}
                options={lineOptions}
              />
            ) : (
              <ReactChart
                key={`candle-${chartInstanceKey}`}
                ref={candleChartRef}
                type="candlestick"
                data={candleData as any}
                options={candleOptions as any}
              />
            )}
          </div>
        </section>

        <div className="grid gap-6 md:grid-cols-2">
          <div className="rounded-3xl border border-white/10 bg-white/5 p-5 shadow-[0_0_30px_rgba(34,197,94,0.2)] backdrop-blur">
            <div className="flex items-center gap-2 text-sm font-semibold text-white">
              <ArrowTrendingUpIcon className="h-4 w-4 text-emerald-300" />
              Buy on bonding curve
            </div>
            <p className="mt-2 text-xs text-slate-400">
              Choose how many tokens you want to buy. Cost is computed from the curve and paid in ETH.
            </p>
            <label className="mt-4 block text-xs text-slate-400">Amount</label>
            <input
              type="number"
              min="0"
              step="1"
              value={qty}
              onChange={e => setQty(e.target.value)}
              className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white backdrop-blur focus:border-cyan-400/60 focus:outline-none"
            />
            <div className="mt-2 text-xs text-slate-400">
              {loadingCost
                ? "Estimating cost..."
                : estimatedCost
                  ? `Estimated cost: ${ethers.formatEther(estimatedCost)} ETH`
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
              Sell back to bonding curve
            </div>
            {!token.isLaunched ? (
              <>
                <p className="mt-2 text-xs text-slate-400">
                  Sell tokens back before launch and receive ETH from the curve.
                </p>
                <label className="mt-4 block text-xs text-slate-400">Amount</label>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={sellQty}
                  onChange={e => setSellQty(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white backdrop-blur focus:border-cyan-400/60 focus:outline-none"
                />
                <div className="mt-2 text-xs text-slate-400">
                  {Number(sellQty) > 0 && estRefund === null
                    ? "Amount exceeds current curve supply or cannot be sold yet."
                    : estRefund
                      ? `Estimated refund: ${ethers.formatEther(estRefund)} ETH`
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
              <div className="mt-4 rounded-lg border border-white/10 bg-black/30 p-4 text-xs text-slate-400 backdrop-blur">
                This token has been launched on a DEX. You can now trade it directly on the exchange of your choice.
              </div>
            )}
          </div>
        </div>

        <section className="rounded-3xl border border-white/10 bg-white/5 p-5 shadow-[0_0_30px_rgba(15,23,42,0.5)] backdrop-blur">
          <h3 className="text-sm font-semibold text-white">Curve trade history</h3>
          {trades.length === 0 ? (
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
                    <th className="pb-2 text-left">ETH</th>
                    <th className="pb-2 text-left">Time</th>
                    <th className="pb-2 text-left">Tx</th>
                  </tr>
                </thead>
                <tbody className="text-[11px]">
                  {sortedTrades
                    .slice()
                    .reverse()
                    .map((t, i) => (
                      <tr key={`${t.hash}-${i}`} className="border-t border-white/10">
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
                        <td className="py-2 text-slate-200">{t.eth.toFixed(4)} ETH</td>
                        <td className="py-2 text-slate-400">
                          {new Date(t.timestamp).toLocaleTimeString()}
                        </td>
                        <td className="py-2">
                          {t.hash ? (
                            <a
                              href={`https://sepolia.etherscan.io/tx/${t.hash}`}
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
          )}
        </section>
      </div>
    </main>
  );
}
