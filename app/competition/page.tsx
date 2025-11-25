"use client";

import { useState } from "react";
import Navbar from "@/components/Navbar";
import { getBrowserProvider } from "@/lib/ethersClient";
import { TrophyIcon, BoltIcon } from "@heroicons/react/24/outline";

export default function CompetitionPage() {
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
      <div className="mx-auto max-w-5xl space-y-8 px-4 py-10">
        <section className="rounded-3xl border border-white/10 bg-white/5 p-8 shadow-[0_0_60px_rgba(168,85,247,0.35)] backdrop-blur space-y-6">
          <div className="flex flex-col gap-3">
            <span className="inline-flex w-max items-center gap-1 rounded-full border border-fuchsia-500/40 bg-fuchsia-500/10 px-3 py-1 text-[11px] text-fuchsia-200">
              <BoltIcon className="h-3 w-3" />
              Upcoming
            </span>
            <h1 className="text-3xl font-semibold text-white">Sei Trading Competition</h1>
            <p className="text-sm text-slate-300">
              Compete for volume and PnL across bonding-curve launches. Climb the leaderboard and earn bragging rights on Sei.
            </p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-black/30 p-6 text-sm text-slate-300 backdrop-blur">
            <div className="flex items-center gap-2 text-white">
              <TrophyIcon className="h-5 w-5 text-amber-300" />
              <h2 className="text-lg font-semibold">Competition preview</h2>
            </div>
            <ul className="mt-4 space-y-2 text-slate-300">
              <li>• 7-day window measuring volume, fills, and realized PnL.</li>
              <li>• Leaderboard featuring the top traders and creators.</li>
              <li>• Bonus spotlight for the most innovative meme narrative.</li>
            </ul>
            <p className="mt-4 text-slate-400">
              This is a preview UI. Final rules, scoring, and prizes will be announced before launch.
            </p>
          </div>
          <div className="flex flex-col gap-3 text-sm text-slate-300 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="font-semibold text-white">Coming soon</p>
              <p className="text-slate-400">Sign up to get notified when registration opens.</p>
            </div>
            <button className="rounded-full border border-white/20 bg-white/5 px-5 py-2 text-sm font-medium text-white transition hover:bg-white/10">
              Notify Me
            </button>
          </div>
        </section>
      </div>
    </main>
  );
}

