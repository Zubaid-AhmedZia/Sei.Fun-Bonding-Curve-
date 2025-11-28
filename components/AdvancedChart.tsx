"use client";

import React, { useEffect, useRef, useState, useMemo } from "react";
import {
    createChart,
    ColorType,
    IChartApi,
    ISeriesApi,
    Time,
    CandlestickData,
    LineData,
    UTCTimestamp,
    CandlestickSeries,
    LineSeries,
} from "lightweight-charts";
import {
    ChartBarIcon,
    ClockIcon,
    AdjustmentsHorizontalIcon,
} from "@heroicons/react/24/outline";

// --- Types ---

export type TradePoint = {
    token: string;
    hash: string;
    side: "buy" | "sell";
    tokens: number;
    eth: number;
    timestamp: number;
};

type TimeRange = "1m" | "5m" | "15m" | "1h" | "4h" | "1d";

type IndicatorType = "SMA" | "EMA" | "BB";

interface AdvancedChartProps {
    trades: TradePoint[];
    symbol?: string;
}

// --- Helpers ---

const TIME_RANGE_CONFIG: Record<TimeRange, { label: string; bucketMs: number }> = {
    "1m": { label: "1m", bucketMs: 60 * 1000 },
    "5m": { label: "5m", bucketMs: 5 * 60 * 1000 },
    "15m": { label: "15m", bucketMs: 15 * 60 * 1000 },
    "1h": { label: "1h", bucketMs: 60 * 60 * 1000 },
    "4h": { label: "4h", bucketMs: 4 * 60 * 60 * 1000 },
    "1d": { label: "1D", bucketMs: 24 * 60 * 60 * 1000 },
};

const calculateSMA = (data: CandlestickData<Time>[], period: number): LineData<Time>[] => {
    const smaData: LineData<Time>[] = [];
    for (let i = period - 1; i < data.length; i++) {
        const sum = data.slice(i - period + 1, i + 1).reduce((acc, val) => acc + val.close, 0);
        smaData.push({ time: data[i].time, value: sum / period });
    }
    return smaData;
};

const calculateEMA = (data: CandlestickData<Time>[], period: number): LineData<Time>[] => {
    const emaData: LineData<Time>[] = [];
    const k = 2 / (period + 1);
    let ema = data[0].close;

    // Initialize with SMA for the first point
    emaData.push({ time: data[0].time, value: ema });

    for (let i = 1; i < data.length; i++) {
        ema = data[i].close * k + ema * (1 - k);
        if (i >= period - 1) {
            emaData.push({ time: data[i].time, value: ema });
        }
    }
    return emaData;
};

const calculateBollingerBands = (data: CandlestickData<Time>[], period: number, stdDevMultiplier: number) => {
    const upper: LineData<Time>[] = [];
    const lower: LineData<Time>[] = [];
    const middle: LineData<Time>[] = [];

    for (let i = period - 1; i < data.length; i++) {
        const slice = data.slice(i - period + 1, i + 1);
        const sum = slice.reduce((acc, val) => acc + val.close, 0);
        const mean = sum / period;

        const squaredDiffs = slice.map(val => Math.pow(val.close - mean, 2));
        const variance = squaredDiffs.reduce((acc, val) => acc + val, 0) / period;
        const stdDev = Math.sqrt(variance);

        middle.push({ time: data[i].time, value: mean });
        upper.push({ time: data[i].time, value: mean + stdDev * stdDevMultiplier });
        lower.push({ time: data[i].time, value: mean - stdDev * stdDevMultiplier });
    }
    return { upper, lower, middle };
};


export default function AdvancedChart({ trades, symbol = "TOKEN" }: AdvancedChartProps) {
    const chartContainerRef = useRef<HTMLDivElement>(null);
    const chartRef = useRef<IChartApi | null>(null);
    const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);

    // Indicator series refs
    const smaSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
    const emaSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
    const bbUpperSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
    const bbLowerSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);

    const [timeRange, setTimeRange] = useState<TimeRange>("15m");
    const [indicators, setIndicators] = useState<Record<IndicatorType, boolean>>({
        SMA: false,
        EMA: false,
        BB: false,
    });

    // OHLC Legend State
    const [legend, setLegend] = useState<{ open: string, high: string, low: string, close: string, change: string, color: string } | null>(null);

    // --- Data Processing ---
    const candleData = useMemo(() => {
        if (!trades || trades.length === 0) return [];

        const sortedTrades = [...trades].sort((a, b) => a.timestamp - b.timestamp);
        const bucketMs = TIME_RANGE_CONFIG[timeRange].bucketMs;

        // Filter out bad data
        const validTrades = sortedTrades.filter(t =>
            t.timestamp && Number.isFinite(t.timestamp) && t.tokens > 0 && t.eth > 0
        );

        if (validTrades.length === 0) return [];

        const priceEvents = validTrades.map(t => ({
            x: t.timestamp,
            y: t.eth / t.tokens
        }));

        const earliest = priceEvents[0].x;
        const latest = priceEvents[priceEvents.length - 1].x;
        const alignedStart = Math.floor(earliest / bucketMs) * bucketMs;
        const alignedEnd = Math.ceil(latest / bucketMs) * bucketMs;

        const candles: CandlestickData<Time>[] = [];
        let eventIdx = 0;
        let carry = priceEvents[0].y;

        for (let t = alignedStart; t <= alignedEnd; t += bucketMs) {
            const bucketEnd = t + bucketMs;
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
                time: (t / 1000) as UTCTimestamp,
                open,
                high,
                low,
                close,
            });
        }

        return candles;
    }, [trades, timeRange]);

    // --- Chart Initialization ---
    useEffect(() => {
        if (!chartContainerRef.current) return;

        const chart = createChart(chartContainerRef.current, {
            layout: {
                background: { type: ColorType.Solid, color: "transparent" },
                textColor: "#94a3b8",
            },
            grid: {
                vertLines: { color: "rgba(148, 163, 184, 0.05)" },
                horzLines: { color: "rgba(148, 163, 184, 0.05)" },
            },
            width: chartContainerRef.current.clientWidth,
            height: 400,
            timeScale: {
                timeVisible: true,
                secondsVisible: false,
                borderColor: "rgba(148, 163, 184, 0.1)",
            },
            rightPriceScale: {
                borderColor: "rgba(148, 163, 184, 0.1)",
                autoScale: true,
                // Increase precision for low cap tokens
                mode: 0, // Normal
            },
            crosshair: {
                mode: 1, // Magnet
                vertLine: {
                    width: 1,
                    color: 'rgba(148, 163, 184, 0.4)',
                    style: 0,
                },
                horzLine: {
                    width: 1,
                    color: 'rgba(148, 163, 184, 0.4)',
                    style: 0,
                },
            },
        });

        const candleSeries = chart.addSeries(CandlestickSeries, {
            upColor: "#22c55e",
            downColor: "#ef4444",
            borderVisible: false,
            wickUpColor: "#22c55e",
            wickDownColor: "#ef4444",
        });

        // Apply dynamic precision based on price
        // We'll set a default high precision, but it's better to update it when data arrives
        candleSeries.applyOptions({
            priceFormat: {
                type: 'custom',
                formatter: (price: number) => {
                    if (price < 0.000001) return price.toFixed(10);
                    if (price < 0.0001) return price.toFixed(8);
                    if (price < 0.01) return price.toFixed(6);
                    return price.toFixed(4);
                },
                minMove: 0.0000000001,
            },
        });

        chartRef.current = chart;
        candleSeriesRef.current = candleSeries;

        // Crosshair move handler for OHLC legend
        chart.subscribeCrosshairMove((param) => {
            if (
                param.point === undefined ||
                !param.time ||
                param.point.x < 0 ||
                param.point.x > chartContainerRef.current!.clientWidth ||
                param.point.y < 0 ||
                param.point.y > chartContainerRef.current!.clientHeight
            ) {
                // Reset to last candle if mouse leaves
                if (candleData.length > 0) {
                    const last = candleData[candleData.length - 1];
                    updateLegend(last);
                } else {
                    setLegend(null);
                }
            } else {
                // Get data at current crosshair position
                const data = param.seriesData.get(candleSeries) as CandlestickData<Time>;
                if (data) {
                    updateLegend(data);
                }
            }
        });

        const handleResize = () => {
            if (chartContainerRef.current && chartRef.current) {
                chartRef.current.applyOptions({ width: chartContainerRef.current.clientWidth });
            }
        };

        window.addEventListener("resize", handleResize);

        return () => {
            window.removeEventListener("resize", handleResize);
            chart.remove();
        };
    }, []); // Run once on mount

    // Helper to update legend state
    const updateLegend = (data: CandlestickData<Time>) => {
        const open = data.open;
        const close = data.close;
        const change = ((close - open) / open) * 100;
        const color = close >= open ? "text-emerald-400" : "text-rose-400";

        // Dynamic formatting for legend
        const fmt = (p: number) => {
            if (p < 0.000001) return p.toFixed(10);
            if (p < 0.0001) return p.toFixed(8);
            if (p < 0.01) return p.toFixed(6);
            return p.toFixed(4);
        };

        setLegend({
            open: fmt(data.open),
            high: fmt(data.high),
            low: fmt(data.low),
            close: fmt(data.close),
            change: `${change >= 0 ? '+' : ''}${change.toFixed(2)}%`,
            color
        });
    };

    // --- Update Data & Indicators ---
    useEffect(() => {
        if (!chartRef.current || !candleSeriesRef.current) return;

        // Update candles
        candleSeriesRef.current.setData(candleData);

        // Update initial legend to last candle
        if (candleData.length > 0) {
            updateLegend(candleData[candleData.length - 1]);
        }

        // Helper to manage indicator series
        const updateIndicator = (
            ref: React.MutableRefObject<ISeriesApi<"Line"> | null>,
            active: boolean,
            data: LineData<Time>[],
            options: any
        ) => {
            if (active) {
                if (!ref.current) {
                    ref.current = chartRef.current!.addSeries(LineSeries, options);
                }
                ref.current?.setData(data);
            } else {
                if (ref.current) {
                    chartRef.current!.removeSeries(ref.current);
                    ref.current = null;
                }
            }
        };

        // SMA (20)
        const smaData = indicators.SMA ? calculateSMA(candleData, 20) : [];
        updateIndicator(smaSeriesRef, indicators.SMA, smaData, { color: '#fbbf24', lineWidth: 2, title: 'SMA 20' });

        // EMA (20)
        const emaData = indicators.EMA ? calculateEMA(candleData, 20) : [];
        updateIndicator(emaSeriesRef, indicators.EMA, emaData, { color: '#38bdf8', lineWidth: 2, title: 'EMA 20' });

        // Bollinger Bands (20, 2)
        const bbData = indicators.BB ? calculateBollingerBands(candleData, 20, 2) : { upper: [], lower: [], middle: [] };
        updateIndicator(bbUpperSeriesRef, indicators.BB, bbData.upper, { color: 'rgba(167, 139, 250, 0.5)', lineWidth: 1, title: 'BB Upper' });
        updateIndicator(bbLowerSeriesRef, indicators.BB, bbData.lower, { color: 'rgba(167, 139, 250, 0.5)', lineWidth: 1, title: 'BB Lower' });

    }, [candleData, indicators]);

    // Fit content when time range changes
    useEffect(() => {
        if (chartRef.current && candleData.length > 0) {
            chartRef.current.timeScale().fitContent();
        }
    }, [timeRange, candleData.length]);


    return (
        <div className="flex flex-col gap-4 rounded-xl border border-slate-800 bg-slate-900/50 p-4 backdrop-blur-sm">
            {/* Controls Header */}
            <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-2">
                    <ChartBarIcon className="h-5 w-5 text-cyan-400" />
                    <span className="font-semibold text-slate-200">Price Chart</span>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                    {/* Time Range Selector */}
                    <div className="flex items-center rounded-lg bg-slate-800 p-1">
                        {(Object.keys(TIME_RANGE_CONFIG) as TimeRange[]).map((range) => (
                            <button
                                key={range}
                                onClick={() => setTimeRange(range)}
                                className={`rounded px-3 py-1 text-xs font-medium transition-colors ${timeRange === range
                                    ? "bg-cyan-500/20 text-cyan-300"
                                    : "text-slate-400 hover:bg-slate-700 hover:text-slate-200"
                                    }`}
                            >
                                {TIME_RANGE_CONFIG[range].label}
                            </button>
                        ))}
                    </div>

                    {/* Indicators Dropdown/Toggle */}
                    <div className="flex items-center gap-2 rounded-lg bg-slate-800 p-1 px-2">
                        <AdjustmentsHorizontalIcon className="h-4 w-4 text-slate-400" />
                        <span className="text-xs text-slate-400 mr-2">Indicators:</span>

                        {(Object.keys(indicators) as IndicatorType[]).map((ind) => (
                            <button
                                key={ind}
                                onClick={() => setIndicators(prev => ({ ...prev, [ind]: !prev[ind] }))}
                                className={`rounded px-2 py-1 text-[10px] font-bold transition-colors border ${indicators[ind]
                                    ? "border-cyan-500/50 bg-cyan-500/10 text-cyan-300"
                                    : "border-transparent text-slate-500 hover:text-slate-300"
                                    }`}
                            >
                                {ind}
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            {/* OHLC Legend Overlay */}
            <div className="flex items-center gap-4 text-xs font-mono border-b border-slate-800 pb-2 mb-2">
                <span className="text-slate-400">{symbol}</span>
                {legend ? (
                    <>
                        <span className="text-slate-400">O: <span className={legend.color}>{legend.open}</span></span>
                        <span className="text-slate-400">H: <span className={legend.color}>{legend.high}</span></span>
                        <span className="text-slate-400">L: <span className={legend.color}>{legend.low}</span></span>
                        <span className="text-slate-400">C: <span className={legend.color}>{legend.close}</span></span>
                        <span className={legend.color}>{legend.change}</span>
                    </>
                ) : (
                    <span className="text-slate-600">Hover for details</span>
                )}
            </div>

            {/* Chart Container */}
            <div
                ref={chartContainerRef}
                className="relative h-[400px] w-full overflow-hidden rounded-lg border border-slate-800/50 bg-slate-950/30"
            />
        </div>
    );
}
