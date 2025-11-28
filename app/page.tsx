// app/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { ethers } from "ethers";
import Link from "next/link";
import axios from "axios";
import Navbar from "@/components/Navbar";
import { getBrowserProvider, getFactoryReadOnly, getFactoryContract } from "@/lib/ethersClient";
import {
  SparklesIcon,
  PlusCircleIcon,
  ArrowTrendingUpIcon,
  PhotoIcon,
} from "@heroicons/react/24/outline";

// 🔑 Pinata JWT – replace this with YOUR real JWT from Pinata dashboard.
// e.g. "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
const PINATA_JWT = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySW5mb3JtYXRpb24iOnsiaWQiOiJjMmVkN2I2Mi00MzJjLTQ4YzQtOWI5YS1kZTlmMjQ1YThmOWYiLCJlbWFpbCI6InRoZWNob3Nlbm9uZTAwNzY2NkBnbWFpbC5jb20iLCJlbWFpbF92ZXJpZmllZCI6dHJ1ZSwicGluX3BvbGljeSI6eyJyZWdpb25zIjpbeyJkZXNpcmVkUmVwbGljYXRpb25Db3VudCI6MSwiaWQiOiJGUkExIn0seyJkZXNpcmVkUmVwbGljYXRpb25Db3VudCI6MSwiaWQiOiJOWUMxIn1dLCJ2ZXJzaW9uIjoxfSwibWZhX2VuYWJsZWQiOmZhbHNlLCJzdGF0dXMiOiJBQ1RJVkUifSwiYXV0aGVudGljYXRpb25UeXBlIjoic2NvcGVkS2V5Iiwic2NvcGVkS2V5S2V5IjoiZDU4MjA0ZDY1MGVkZGFhYzE3Y2QiLCJzY29wZWRLZXlTZWNyZXQiOiIxMzRjODUzMzFiMmIxOWUwOWVmOGNlYjZiZTdmOTkyY2I4ZWFhOGQzMDkxZWE0NTFlZTJlZThhOTZlMGM2ZjliIiwiZXhwIjoxNzk1NTQyNDg0fQ.EhrfZOq5f2QrWD-b0UxqM_HKOIDWK4uad9DB-7X4T1U";

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

type TrendingInfo = {
  token: string;
  tradeCount: number;
  totalVolumeEth: number;
  lastTradeAt: number;
};

type HomeTab = "trending" | "featured" | "new";

export default function HomePage() {
  const [account, setAccount] = useState<string | null>(null);
  const [tokens, setTokens] = useState<MemeToken[]>([]);
  const [loadingTokens, setLoadingTokens] = useState(false);
  const [form, setForm] = useState({
    name: "",
    symbol: "",
    imageUrl: "",
    description: "",
  });
  const [creationFee, setCreationFee] = useState<bigint | null>(null);
  const [txPending, setTxPending] = useState(false);
  const [trending, setTrending] = useState<TrendingInfo[]>([]);
  const [ethUsd, setEthUsd] = useState<number | null>(null);
  const [homeTab, setHomeTab] = useState<HomeTab>("trending");

  // 👇 new state just for image upload UX
  const [uploadingImage, setUploadingImage] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const connect = async () => {
    const provider = getBrowserProvider();
    const accounts = await provider.send("eth_requestAccounts", []);
    setAccount(accounts[0]);
  };

  const disconnect = () => setAccount(null);

  const loadTokens = async () => {
    setLoadingTokens(true);
    try {
      const factory = getFactoryReadOnly();
      const res = await factory.getAllMemeTokens();
      setTokens(res as MemeToken[]);
      const fee: bigint = await factory.MEMETOKEN_CREATION_FEE();
      setCreationFee(fee);
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingTokens(false);
    }
  };

  const loadTrending = async () => {
    try {
      const res = await axios.get("/api/trending");
      setTrending(res.data.trending || []);
    } catch (e) {
      console.error("Failed to load trending", e);
    }
  };

  const loadEthUsd = async () => {
    try {
      const res = await fetch("https://api.coinbase.com/v2/prices/ETH-USD/spot");
      const json = await res.json();
      const price = Number(json?.data?.amount);
      if (!Number.isNaN(price)) setEthUsd(price);
    } catch (e) {
      console.error("Failed to fetch ETH price", e);
    }
  };

  useEffect(() => {
    loadTokens();
    loadTrending();
    loadEthUsd();
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!account) return alert("Connect wallet first");
    setTxPending(true);
    try {
      const factory = await getFactoryContract();
      const fee: bigint = await factory.MEMETOKEN_CREATION_FEE();
      const tx = await factory.createMemeToken(
        form.name,
        form.symbol,
        form.imageUrl, // ✅ still using imageUrl as before
        form.description,
        { value: fee }
      );
      await tx.wait();
      setForm({ name: "", symbol: "", imageUrl: "", description: "" });
      await loadTokens();
    } catch (err: any) {
      console.error(err);
      alert(err?.reason || "Create failed");
    } finally {
      setTxPending(false);
    }
  };

  // 🔥 Upload image directly to Pinata and set form.imageUrl with gateway URL
  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadError(null);
    setUploadingImage(true);

    try {
      if (!PINATA_JWT || PINATA_JWT === "REPLACE_WITH_YOUR_PINATA_JWT") {
        throw new Error("Pinata JWT is not set in the client code.");
      }

      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch("https://api.pinata.cloud/pinning/pinFileToIPFS", {
        method: "POST",
        headers: {
          // Do NOT set Content-Type; browser will set proper multipart boundary
          Authorization: `Bearer ${PINATA_JWT}`,
        },
        body: formData,
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || "Upload failed");
      }

      const data = await res.json() as { IpfsHash?: string };

      const cid = data.IpfsHash;
      if (!cid) {
        throw new Error("No IpfsHash in Pinata response");
      }

      // Use Pinata gateway URL (or your own custom gateway)
      const url = `https://gateway.pinata.cloud/ipfs/${cid}`;

      setForm(f => ({ ...f, imageUrl: url }));
    } catch (err: any) {
      console.error("Pinata upload failed", err);
      setUploadError(err?.message || "Failed to upload image to Pinata");
    } finally {
      setUploadingImage(false);
    }
  };

  const trendingWithMeta = useMemo(
    () =>
      trending
        .map(info => {
          const meta = tokens.find(
            t => t.tokenAddress.toLowerCase() === info.token.toLowerCase()
          );
          return meta ? { info, meta } : null;
        })
        .filter(Boolean) as { info: TrendingInfo; meta: MemeToken }[],
    [trending, tokens],
  );

  const totalVolumeEth24h = trending.reduce(
    (acc, cur) => acc + Number(cur.totalVolumeEth || 0),
    0
  );
  const totalVolumeUsd24h =
    ethUsd !== null
      ? totalVolumeEth24h * ethUsd
      : null;

  const featuredTokens = trendingWithMeta
    .filter(({ meta }) => meta.isLaunched)
    .slice(0, 4);

  const newTokens = [...tokens].reverse().slice(0, 4);

  // Helper to calculate progress
  const getProgress = (fundingRaised: bigint, isLaunched: boolean) => {
    if (isLaunched) return 100;
    const goal = ethers.parseEther("0.01");
    const pct = Number((fundingRaised * 10000n) / goal) / 100;
    return pct > 100 ? 100 : pct;
  };

  const renderTokenCard = (token: MemeToken, info?: TrendingInfo, badge?: string) => {
    const progress = getProgress(token.fundingRaised, token.isLaunched);

    return (
      <Link
        key={`${token.tokenAddress}-${info?.token || "card"}`}
        href={`/token/${token.tokenAddress}`}
        className="group relative flex min-w-[240px] flex-col gap-3 rounded-2xl border border-white/10 bg-white/5 p-4 shadow-[0_0_30px_rgba(8,145,178,0.15)] transition hover:scale-[1.01] hover:border-cyan-400/60 hover:bg-white/10"
      >
        {badge && (
          <span className="w-max rounded-full border border-white/15 bg-white/10 px-2 py-0.5 text-[10px] uppercase tracking-wide text-slate-200">
            {badge}
          </span>
        )}
        <div className="flex items-center gap-3">
          {token.tokenImageUrl && (
            <img
              src={token.tokenImageUrl}
              alt={token.name}
              className="h-10 w-10 rounded-full object-cover"
            />
          )}
          <div>
            <div className="text-sm font-semibold text-white">
              {token.name} ({token.symbol})
            </div>
            <div className="text-[11px] text-slate-400">
              {token.tokenAddress.slice(0, 6)}...{token.tokenAddress.slice(-4)}
            </div>
          </div>
        </div>
        <p className="line-clamp-2 text-xs text-slate-400">
          {token.description || "No description provided."}
        </p>
        <div className="flex items-center justify-between text-[11px] text-slate-300">
          <span>Volume (24h)</span>
          <span>{info ? `${info.totalVolumeEth.toFixed(4)} ETH` : "—"}</span>
        </div>

        {/* Progress Bar */}
        <div className="space-y-1">
          <div className="flex justify-between text-[10px] text-slate-400">
            <span>Bonding Curve</span>
            <span className="text-white">{progress.toFixed(1)}%</span>
          </div>
          <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-slate-800/70">
            <div
              className="h-full rounded-full bg-gradient-to-r from-cyan-400 via-emerald-400 to-amber-400 shadow-[0_0_10px_rgba(56,189,248,0.5)] transition-all duration-500"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>

        <div className="flex items-center justify-between text-[11px] text-slate-300 mt-1">
          <span>Status</span>
          <span className={token.isLaunched ? "text-emerald-400" : "text-yellow-300"}>
            {token.isLaunched ? "Launched" : "Bonding Curve"}
          </span>
        </div>
      </Link>
    )
  };

  const renderTabContent = () => {
    if (homeTab === "trending") {
      if (trendingWithMeta.length === 0) {
        return (
          <p className="text-sm text-slate-400">
            No curve activity yet. Once trades start, trending tokens will appear here.
          </p>
        );
      }
      return (
        <div className="flex gap-4 overflow-x-auto pb-2">
          {trendingWithMeta.map(({ info, meta }) =>
            renderTokenCard(meta, info, "Trending · 24h")
          )}
        </div>
      );
    }
    if (homeTab === "featured") {
      if (featuredTokens.length === 0)
        return <p className="text-sm text-slate-400">No featured tokens yet.</p>;
      return (
        <div className="grid gap-4 md:grid-cols-2">
          {featuredTokens.map(({ meta, info }) =>
            renderTokenCard(meta, info, "Featured")
          )}
        </div>
      );
    }
    if (newTokens.length === 0)
      return <p className="text-sm text-slate-400">No new launches yet.</p>;
    return (
      <div className="grid gap-4 md:grid-cols-2">
        {newTokens.map(t => renderTokenCard(t, undefined, "New"))}
      </div>
    );
  };

  return (
    <main className="min-h-screen bg-gradient-to-b from-[#050816] via-[#050319] to-[#020617] text-slate-50">
      <Navbar account={account} onConnect={connect} onDisconnect={disconnect} />
      <div className="mx-auto max-w-6xl space-y-10 px-4 py-8">
        {/* HERO */}
        <section className="grid items-center gap-6 md:grid-cols-[1.6fr_1.1fr]">
          <div className="space-y-4">
            <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-[11px] text-emerald-300">
              <SparklesIcon className="h-3 w-3" />
              Launch memes on Sei’s bonding curve
            </span>
            <h1 className="text-3xl font-semibold leading-tight md:text-4xl">
              Spin up{" "}
              <span className="bg-gradient-to-r from-cyan-400 via-fuchsia-400 to-amber-300 bg-clip-text text-transparent">
                hyper-volatile
              </span>{" "}
              tokens in seconds.
            </h1>
            <p className="text-sm text-slate-300">
              Create, trade, and track bonding-curve tokens with exchange-grade charts and
              off-chain analytics.
            </p>
            <div className="flex flex-wrap gap-3 text-xs">
              <button
                onClick={() => {
                  const el = document.getElementById("launch-token");
                  if (el) el.scrollIntoView({ behavior: "smooth" });
                }}
                className="inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-cyan-400 to-fuchsia-500 px-4 py-2 font-medium text-slate-950 shadow-lg transition hover:scale-[1.02] hover:brightness-110"
              >
                <PlusCircleIcon className="h-4 w-4" />
                Launch a token
              </button>
              <a
                href="#live-tokens"
                className="inline-flex items-center gap-2 rounded-full border border-white/15 px-4 py-2 text-slate-200 transition hover:bg-white/5"
              >
                <ArrowTrendingUpIcon className="h-4 w-4" />
                Browse live tokens
              </a>
            </div>
          </div>
          <div className="space-y-4 rounded-2xl border border-white/10 bg-white/5 p-4 text-xs shadow-[0_0_40px_rgba(15,23,42,0.7)] backdrop-blur">
            <div className="flex items-center justify-between">
              <span className="text-slate-400">Tokens launched</span>
              <span className="text-lg font-semibold text-white">{tokens.length}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-400">24h Volume</span>
              <span className="text-lg font-semibold text-white">
                {totalVolumeEth24h.toFixed(4)} ETH{" "}
                {totalVolumeUsd24h !== null && (
                  <span className="text-sm text-slate-400">
                    ({totalVolumeUsd24h.toLocaleString(undefined, { maximumFractionDigits: 0 })} USD)
                  </span>
                )}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-400">Network</span>
              <span className="text-lg font-semibold text-white">Sei Network</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-400">Trending pairs</span>
              <span className="text-lg font-semibold text-white">
                {trendingWithMeta.length || "—"}
              </span>
            </div>
          </div>
        </section>

        {/* TABS SECTION */}
        <section className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <h2 className="text-lg font-semibold text-white">Market mood</h2>
            <div className="inline-flex rounded-full bg-white/5 p-1 text-[11px]">
              {(["trending", "featured", "new"] as HomeTab[]).map(tab => (
                <button
                  key={tab}
                  onClick={() => setHomeTab(tab)}
                  className={`rounded-full px-3 py-1.5 capitalize transition ${homeTab === tab
                    ? "bg-gradient-to-r from-cyan-400 to-fuchsia-500 text-slate-950 shadow-sm"
                    : "text-slate-300 hover:text-white"
                    }`}
                >
                  {tab}
                </button>
              ))}
            </div>
          </div>
          {renderTabContent()}
        </section>

        {/* 🚀 LAUNCH TOKEN – updated UI with image upload + preview */}
        <section
          id="launch-token"
          className="rounded-2xl border border-white/10 bg-white/5 p-6 shadow-[0_0_40px_rgba(15,23,42,0.6)] backdrop-blur"
        >
          <div className="mb-6 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-xl font-semibold text-white">Launch a new token</h2>
              <p className="text-sm text-slate-400">
                Deploy instantly on the bonding curve. Your token will show up in the live feed
                and charts as activity starts.
              </p>
            </div>
            <span className="mt-2 inline-flex items-center gap-1 rounded-full border border-cyan-500/40 bg-cyan-500/10 px-3 py-1 text-[11px] text-cyan-200 md:mt-0">
              <SparklesIcon className="h-3 w-3" />
              No code. On-chain in one click.
            </span>
          </div>

          <div className="flex flex-col gap-8 lg:flex-row lg:items-start">
            {/* FORM COLUMN */}
            <form
              onSubmit={handleCreate}
              className="flex-1 space-y-4 max-w-xl"
            >
              <div className="space-y-2">
                <label className="text-xs text-slate-400">Token name</label>
                <input
                  required
                  placeholder="Based Pepe, Laser Frog..."
                  className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white backdrop-blur focus:border-cyan-400/60 focus:outline-none"
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                />
              </div>

              <div className="space-y-2">
                <label className="text-xs text-slate-400">Symbol</label>
                <input
                  required
                  placeholder="BPPE"
                  className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm uppercase text-white backdrop-blur focus:border-cyan-400/60 focus:outline-none"
                  value={form.symbol}
                  onChange={e => setForm(f => ({ ...f, symbol: e.target.value.toUpperCase() }))}
                />
              </div>

              {/* IMAGE UPLOAD + URL */}
              <div className="space-y-2">
                <label className="text-xs text-slate-400">Token image</label>
                <div className="flex flex-wrap gap-3">
                  <label className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-white/15 bg-black/30 px-3 py-2 text-[11px] text-slate-200 hover:border-cyan-400/60">
                    <PhotoIcon className="h-4 w-4 text-cyan-300" />
                    <span>{uploadingImage ? "Uploading..." : "Upload image"}</span>
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={handleImageUpload}
                    />
                  </label>
                  <div className="min-w-[180px] flex-1">
                    <input
                      placeholder="or paste image URL..."
                      className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white backdrop-blur focus:border-cyan-400/60 focus:outline-none"
                      value={form.imageUrl}
                      onChange={e => setForm(f => ({ ...f, imageUrl: e.target.value }))}
                    />
                  </div>
                </div>
                {uploadError && (
                  <p className="text-xs text-rose-400">
                    {uploadError}
                  </p>
                )}
                {form.imageUrl && !uploadError && (
                  <p className="truncate text-[11px] text-slate-400">
                    Using image: <span className="text-cyan-300">{form.imageUrl}</span>
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <label className="text-xs text-slate-400">Description</label>
                <textarea
                  placeholder="Tell traders why this meme should exist..."
                  className="min-h-[90px] w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white backdrop-blur focus:border-cyan-400/60 focus:outline-none"
                  value={form.description}
                  onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                />
              </div>

              <div className="flex flex-col items-start gap-2 text-xs text-slate-400 md:flex-row md:items-center md:justify-between">
                <span>
                  Creation fee:{" "}
                  {creationFee ? `${ethers.formatEther(creationFee)} ETH` : "loading..."}
                </span>
                <button
                  disabled={txPending}
                  type="submit"
                  className="rounded-full bg-gradient-to-r from-cyan-400 to-fuchsia-500 px-5 py-2 text-sm font-semibold text-slate-950 shadow-lg transition hover:brightness-110 disabled:opacity-50 disabled:brightness-90"
                >
                  {txPending ? "Launching..." : "Launch Token"}
                </button>
              </div>
            </form>

            {/* LIVE PREVIEW COLUMN */}
            <div className="hidden flex-1 lg:block">
              <div className="rounded-2xl border border-white/10 bg-black/30 p-4 shadow-[0_0_30px_rgba(14,165,233,0.25)]">
                <p className="mb-3 text-[11px] uppercase tracking-wide text-slate-500">
                  Launch preview
                </p>
                <div className="flex items-center gap-3">
                  <div className="relative h-12 w-12 overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-cyan-400/40 via-fuchsia-500/30 to-amber-300/30">
                    {form.imageUrl && (
                      <img
                        src={form.imageUrl}
                        alt={form.name || "Token preview"}
                        className="h-full w-full object-cover"
                      />
                    )}
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-white">
                      {form.name || "Your token name"}
                      <span className="ml-1 text-xs text-slate-400">
                        ({form.symbol || "SYMBOL"})
                      </span>
                    </p>
                    <p className="text-[11px] text-slate-500">
                      Will appear in Live Tokens & Market mood after launch.
                    </p>
                  </div>
                </div>
                <p className="mt-3 line-clamp-3 text-xs text-slate-400">
                  {form.description || "Describe your meme, lore, or narrative here to attract early traders."}
                </p>
                <div className="mt-4 grid grid-cols-2 gap-3 text-[11px] text-slate-300">
                  <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-2">
                    <p className="text-slate-400">Network</p>
                    <p className="mt-1 font-semibold text-white">Sei Network</p>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-2">
                    <p className="text-slate-400">Creation fee</p>
                    <p className="mt-1 font-semibold text-white">
                      {creationFee ? `${ethers.formatEther(creationFee)} ETH` : "—"}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* LIVE TOKENS */}
        <section id="live-tokens" className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold text-white">Live Tokens</h2>
            {loadingTokens && (
              <span className="text-xs text-slate-400">Refreshing...</span>
            )}
          </div>
          {tokens.length === 0 ? (
            <p className="text-sm text-slate-400">
              No tokens launched yet. Be the first!
            </p>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {tokens.map(t => {
                const progress = getProgress(t.fundingRaised, t.isLaunched);
                return (
                  <div
                    key={t.tokenAddress}
                    className="flex flex-col gap-4 rounded-3xl border border-white/10 bg-white/5 p-4 shadow-[0_0_30px_rgba(236,72,153,0.15)] transition hover:scale-[1.01] hover:border-fuchsia-400/60"
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-3">
                        {t.tokenImageUrl && (
                          <img
                            src={t.tokenImageUrl}
                            alt={t.name}
                            className="h-12 w-12 rounded-2xl border border-white/10 object-cover"
                          />
                        )}
                        <div>
                          <p className="text-sm font-semibold text-white">
                            {t.name} ({t.symbol})
                          </p>
                          <p className="text-[11px] text-slate-400">
                            {t.tokenAddress.slice(0, 6)}...{t.tokenAddress.slice(-4)}
                          </p>
                        </div>
                      </div>
                      <span
                        className={`rounded-full border px-2 py-1 text-[10px] ${t.isLaunched
                          ? "border-emerald-500/30 bg-emerald-500/15 text-emerald-200"
                          : "border-amber-500/30 bg-amber-500/15 text-amber-200"
                          }`}
                      >
                        {t.isLaunched ? "Launched" : "Bonding Curve"}
                      </span>
                    </div>
                    <p className="line-clamp-2 text-xs text-slate-400">{t.description}</p>

                    {/* Progress Bar */}
                    <div className="space-y-1">
                      <div className="flex justify-between text-[10px] text-slate-400">
                        <span>Bonding Curve</span>
                        <span className="text-white">{progress.toFixed(1)}%</span>
                      </div>
                      <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-slate-800/70">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-cyan-400 via-emerald-400 to-amber-400 shadow-[0_0_10px_rgba(56,189,248,0.5)] transition-all duration-500"
                          style={{ width: `${progress}%` }}
                        />
                      </div>
                    </div>

                    <Link
                      href={`/token/${t.tokenAddress}`}
                      className="rounded-full bg-gradient-to-r from-cyan-400 to-fuchsia-500 px-3 py-2 text-center text-xs font-semibold text-slate-950 shadow-lg transition hover:brightness-110"
                    >
                      View / Trade
                    </Link>
                  </div>
                )
              })}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
