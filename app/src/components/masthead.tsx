// The masthead every surface shares, in the Modernist frame: wordmark, the
// MAINNET tag, the five routes with a 2px underline on the active one, and
// the head-block readout on the right. Sticky, 2px bottom rule, one light
// theme - there is no toggle.
//
// The `chip` slot stays: a page with something truer than the head block to
// say about its own state (the wallet chip on /manage, a snapshot badge)
// renders it there, next to the head readout.

import { Link } from "@tanstack/react-router";

import { fmtBlock } from "../config";
import { cn } from "../lib/utils";
import { useHeadBlock } from "../query/useHeadBlock";

export type NavKey = "board" | "subscribe" | "manage" | "verify" | "creator" | "dashboard";

type RouteTo = "/board" | "/subscribe" | "/manage" | "/verify" | "/creator";

const ROUTES: Array<{ key: NavKey; label: string; to: RouteTo }> = [
  { key: "board", label: "Board", to: "/board" },
  { key: "subscribe", label: "Subscribe", to: "/subscribe" },
  { key: "manage", label: "Manage", to: "/manage" },
  { key: "verify", label: "Gate", to: "/verify" },
  { key: "creator", label: "Creator", to: "/creator" },
];

/** NIGHT in ink, SHIFT in the accent. Type, not a file. */
export function Wordmark({ className }: { className?: string }) {
  return (
    <Link
      to="/"
      className={cn(
        "m-wordmark text-[17px] leading-[1.2] text-ink hover:text-ink",
        className,
      )}
      style={{ fontFamily: "var(--font-heading)", letterSpacing: "var(--track-wordmark)" }}
    >
      NIGHT<span className="text-ns-accent">SHIFT</span>
    </Link>
  );
}

export function NavRoutes({ active }: { active?: NavKey }) {
  // "dashboard" was the creator page's old nav key; accept it as an alias so
  // nothing breaks mid-navigation from an old link.
  const current = active === "dashboard" ? "creator" : active;
  return (
    <nav
      className="-mx-1 flex items-center gap-4 overflow-x-auto px-1 md:mx-0 md:gap-5 md:overflow-visible md:px-0"
      aria-label="sections"
    >
      {ROUTES.map((r) => {
        const on = current === r.key;
        return (
          <Link
            key={r.key}
            to={r.to}
            className={cn(
              "inline-flex min-h-11 items-center whitespace-nowrap border-b-2 py-1.5 text-[13px] tracking-[0.06em] uppercase md:min-h-0",
              on
                ? "border-ns-accent text-ns-accent"
                : "border-transparent text-ink hover:text-ns-accent",
            )}
          >
            <span className="m-swap" data-text={r.label}>
              <span>{r.label}</span>
            </span>
          </Link>
        );
      })}
    </nav>
  );
}

export function Masthead({
  active,
  chip,
  badge,
  /** The landing puts its h1 on the hero, so its wordmark is a plain link.
   *  Every other page has no other candidate and keeps the h1 here. */
  heading = true,
}: {
  active?: NavKey;
  chip?: React.ReactNode;
  badge?: React.ReactNode;
  heading?: boolean;
}) {
  const head = useHeadBlock().data;
  const wordmark = heading ? (
    <h1 className="flex items-center">
      <Wordmark />
    </h1>
  ) : (
    <Wordmark />
  );

  return (
    <header className="sticky top-0 z-40 flex flex-wrap items-center gap-x-4 gap-y-2 border-b-2 border-divider bg-ground px-5 py-3 lg:px-10">
      <div className="flex min-w-0 items-center gap-3">
        {wordmark}
        <span className="m-tag m-tag-accent">Mainnet</span>
        {badge}
      </div>
      <div className="order-3 w-full md:order-none md:w-auto md:flex-1 md:pl-4">
        <NavRoutes active={active} />
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-3">
        {/* One block readout per masthead. A page that passes a chip has
            something truer to say about its own read state (which block ITS
            figures were checked at, the wallet, a snapshot badge), so the
            generic head readout yields rather than printing a second, slightly
            different number next to it. */}
        {chip ??
          (head !== undefined ? (
            <span className="font-mono text-[11.5px] text-text-caption tabular">
              head {fmtBlock(head)}
            </span>
          ) : null)}
      </div>
    </header>
  );
}
