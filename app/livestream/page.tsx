"use client";

import { useState } from "react";
import Navbar from "@/components/Navbar";
import { getBrowserProvider } from "@/lib/ethersClient";
import { PlayCircleIcon, SparklesIcon } from "@heroicons/react/24/outline";

export default function LivestreamPage() {
  const [account, setAccount] = useState<string | null>(null);

  const connect = async () => {
    const provider = getBrowserProvider();
    const accounts = await provider.send("eth_requestAccounts", []);
    setAccount(accounts[0]);
  };

  const disconnect = () => setAccount(null);

  return (
    <main className="min-h-screen bg-gradient-to-b from-[#050816] via-[#050319] to-[#020617] text-slate-50">
      <Navbar account={account} onConnect={connect} onDisconnect={disconnect} />
      <div className="mx-auto max-w-5xl px-4 py-10">
        <section className="rounded-3xl border border-white/10 bg-white/5 p-8 shadow-[0_0_50px_rgba(8,145,178,0.35)] backdrop-blur space-y-6">
          <div className="flex flex-col gap-3">
            <span className="inline-flex w-max items-center gap-1 rounded-full border border-cyan-400/40 bg-cyan-400/10 px-3 py-1 text-[11px] text-cyan-200">
              <SparklesIcon className="h-3 w-3" />
              Live Streams
            </span>
            <h1 className="text-3xl font-semibold text-white">Trading Competitions on Sei</h1>
            <p className="text-sm text-slate-300">
              Watch bonding-curve launches unfold in real time. Follow volume battles, leaderboard surprises, and meme-fueled narratives.
            </p>
          </div>
          <div className="h-64 w-full rounded-2xl border border-white/15 bg-gradient-to-br from-cyan-500/20 via-fuchsia-500/10 to-transparent text-center text-slate-200 shadow-[0_0_60px_rgba(236,72,153,0.35)]">
            <div className="flex h-full flex-col items-center justify-center gap-3">
              <PlayCircleIcon className="h-14 w-14 text-white/80" />
              <span className="text-sm uppercase tracking-wide text-slate-200">
                Livestream placeholder
              </span>
              <p className="text-xs text-slate-300">
                First broadcast coming soon. Stay tuned.
              </p>
            </div>
          </div>
          <div className="space-y-2 text-sm text-slate-300">
            <p>
              We&apos;re preparing the first Sei trading competition with live commentary, project spotlights, and real-time analytics.
            </p>
            <p>
              Subscribe to updates or join our community channels to be notified when the inaugural stream goes live.
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}

