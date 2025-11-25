"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { WalletIcon, XMarkIcon } from "@heroicons/react/24/outline";

type NavbarProps = {
  account: string | null;
  onConnect: () => void | Promise<void>;
  onDisconnect: () => void;
};

const NAV_LINKS = [
  { href: "/", label: "Home" },
  { href: "/livestream", label: "Live Streams" },
  { href: "/competition", label: "Trading Competition" },
];

export default function Navbar({ account, onConnect, onDisconnect }: NavbarProps) {
  const pathname = usePathname();

  return (
    <nav className="sticky top-0 z-30 border-b border-white/10 bg-black/40 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
        <Link href="/" className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-full bg-gradient-to-tr from-cyan-400 via-fuchsia-500 to-amber-400 shadow-lg" />
          <div className="leading-tight">
            <span className="text-sm font-semibold tracking-wide text-white">
              Sei.Fun
            </span>
            <span className="block text-[10px] text-slate-400">
              Powered by Sei Network · Bonding Curve
            </span>
          </div>
        </Link>

        <div className="hidden items-center gap-2 text-xs md:flex">
          {NAV_LINKS.map(link => {
            const active = pathname === link.href;
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`rounded-full border border-transparent px-3 py-1.5 transition ${
                  active
                    ? "border-white/20 bg-white/10 text-white"
                    : "text-slate-300 hover:text-white"
                }`}
              >
                {link.label}
              </Link>
            );
          })}
        </div>

        <div className="flex items-center gap-2">
          {account ? (
            <>
              <span className="hidden items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-[11px] text-slate-200 sm:inline-flex">
                <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                {account.slice(0, 6)}...{account.slice(-4)}
              </span>
              <button
                onClick={onDisconnect}
                className="rounded-full border border-white/10 bg-white/5 p-1.5 text-slate-300 transition hover:bg-white/10"
                aria-label="Disconnect wallet"
              >
                <XMarkIcon className="h-3.5 w-3.5" />
              </button>
            </>
          ) : (
            <button
              onClick={onConnect}
              className="inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-cyan-400 to-fuchsia-500 px-4 py-1.5 text-xs font-medium text-slate-950 shadow-lg transition hover:brightness-110"
            >
              <WalletIcon className="h-4 w-4" />
              Connect Wallet
            </button>
          )}
        </div>
      </div>
    </nav>
  );
}

