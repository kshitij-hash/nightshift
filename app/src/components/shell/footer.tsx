// The footer: the promise in three facts, the doors for the curious, and the
// theme toggle. Receipts and the detail pages live here and nowhere in the nav.

import { Link } from "@tanstack/react-router";

import { ThemeToggle } from "./theme";

export function AppFooter() {
  return (
    <footer className="mt-auto border-t border-line">
      <div className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-x-8 gap-y-5 px-5 py-8 lg:px-16">
        <div className="flex flex-col gap-2">
          <span
            className="text-[15px] font-[800] text-ink"
            style={{ fontFamily: "var(--font-heading)", letterSpacing: "var(--track-wordmark)" }}
          >
            NIGHTSHIFT
          </span>
          <span className="ad-mono text-[11px] tracking-[0.12em] text-faint">
            NO NAME <span className="text-rose">·</span> NO CARD <span className="text-rose">·</span> NO TRACE
          </span>
        </div>
        <nav className="flex flex-wrap items-center gap-x-6 gap-y-3 text-[13px]" aria-label="more">
          <Link to="/receipts" className="text-dim hover:text-ink">
            Receipts
          </Link>
          <Link to="/board" className="text-dim hover:text-ink">
            Live details
          </Link>
          <a
            href="https://github.com/kshitij-hash/nightshift"
            target="_blank"
            rel="noreferrer"
            className="text-dim hover:text-ink"
          >
            Source ↗
          </a>
          <ThemeToggle />
        </nav>
      </div>
    </footer>
  );
}
