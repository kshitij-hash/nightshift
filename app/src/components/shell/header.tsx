// The header every screen shares: wordmark, three destinations, and the chip
// that says whether a wallet is along. The chip opens the connect sheet.

import { Link, useRouterState } from "@tanstack/react-router";

import { shortId } from "../../lib/format";
import { cn } from "../../lib/utils";
import { useWallet } from "../../lib/wallet/session";
import { Swap } from "./motion";

export function Wordmark({ size = 22, className }: { size?: number; className?: string }) {
  return (
    <Link
      to="/"
      className={cn("inline-flex items-baseline text-ink hover:text-ink", className)}
      style={{
        fontFamily: "var(--font-heading)",
        fontWeight: 800,
        fontSize: size,
        letterSpacing: "var(--track-wordmark)",
        lineHeight: 1,
      }}
      aria-label="NIGHTSHIFT, home"
    >
      NIGHT<span className="bg-rose px-[0.22em] text-on-rose">SHIFT</span>
    </Link>
  );
}

const NAV: Array<{ label: string; to: "/nights" | "/room" | "/receipts"; match: string[] }> = [
  { label: "For fans", to: "/nights", match: ["/nights", "/join", "/unlock"] },
  { label: "For creators", to: "/room", match: ["/room", "/start"] },
  { label: "Receipts", to: "/receipts", match: ["/receipts", "/board", "/verify", "/creator"] },
];

export function WalletChip({ className }: { className?: string }) {
  const { ready, state, openSheet } = useWallet();
  const label =
    ready !== null
      ? `Ready · ${shortId(ready.connection.address)}`
      : state.status === "connecting"
        ? "Connecting"
        : "Connect";
  return (
    <button
      type="button"
      className={cn("ad-chip", ready !== null ? "ad-chip-rose" : "", className)}
      onClick={openSheet}
      aria-haspopup="dialog"
    >
      {ready !== null ? <span className="inline-block h-1.5 w-1.5 rounded-full bg-rose" aria-hidden="true" /> : null}
      <Swap k={label}>
        {ready !== null ? (
          <>
            Ready · <span className="normal-case">{shortId(ready.connection.address)}</span>
          </>
        ) : (
          label
        )}
      </Swap>
    </button>
  );
}

export function AppHeader({ cta }: { cta?: React.ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-ground/95 backdrop-blur">
      <div className="mx-auto flex max-w-[1440px] flex-wrap items-center gap-x-6 gap-y-3 px-5 py-4 lg:px-16">
        <Wordmark />
        <nav className="order-3 -mx-1 flex w-full items-center gap-1 overflow-x-auto md:order-none md:mx-0 md:w-auto md:gap-7 md:pl-6" aria-label="sections">
          {NAV.map((n) => {
            const on = n.match.some((m) => pathname === m || pathname.startsWith(`${m}/`));
            return (
              <Link
                key={n.to}
                to={n.to}
                className={cn(
                  "inline-flex min-h-10 items-center whitespace-nowrap px-1 text-[15px] font-medium",
                  on ? "text-ink" : "text-dim hover:text-ink",
                )}
                style={on ? { boxShadow: "inset 0 -2px 0 var(--ad-rose)" } : undefined}
              >
                {n.label}
              </Link>
            );
          })}
        </nav>
        <div className="ml-auto flex shrink-0 items-center gap-3">
          {cta}
          <WalletChip />
        </div>
      </div>
    </header>
  );
}
