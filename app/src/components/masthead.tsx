// The masthead every surface shares: the wordmark, the bracketed nav, the
// theme toggle, and one plain sentence about what this is. The chip on the
// right belongs to whichever page can say something true about the chain.
//
// Five targets, four routes. The wordmark is the fifth and it goes to the
// landing; the routes are board, dashboard, verify, manage. Route labels stay
// lower case in brackets, so caps stay reserved for the chip and for state
// tags and the nav never competes with a status.
//
// Which page carries which chip:
//   landing     none. The live strip under the hero already carries the chain,
//               and a chip would say the same block a second time.
//   /board      the full chip: MAINNET · BLOCK N, or SNAPSHOT when the read
//               failed. The board's whole claim is that it is reading now.
//   /creator    chip plus the provenance banner the dashboard renders itself.
//   /verify     chip plus the block a verdict was checked at.
//   /manage     chip plus the connected line.
// A page never shows a chip it cannot honour, and no app page hides the head
// block.

import { Link } from "@tanstack/react-router";

import { useMediaQuery } from "./board/use-clock";
import { cn } from "../lib/utils";
import { ThemeToggle } from "./theme-toggle";

export type NavKey = "board" | "dashboard" | "verify" | "manage";

type RouteTo = "/board" | "/creator" | "/verify" | "/manage";

const ROUTES: Array<{ key: NavKey; label: string; to: RouteTo }> = [
  { key: "board", label: "board", to: "/board" },
  { key: "dashboard", label: "dashboard", to: "/creator" },
  { key: "verify", label: "verify", to: "/verify" },
  { key: "manage", label: "manage", to: "/manage" },
];

function Bracketed({ active, children, to }: { active: boolean; children: string; to: RouteTo }) {
  const color = active ? "text-ns-accent" : "text-text-label hover:text-ns-accent";
  return (
    <span className="inline-flex items-center text-[12px] leading-none">
      <span className="text-text-caption">[</span>
      <Link
        to={to}
        className={cn(
          color,
          "transition-colors duration-[var(--dur-fast)] ease-[var(--ease-out)]",
          "inline-flex min-h-11 items-center px-1 md:min-h-6 md:px-0.5",
          // The underline appears with the page. It never slides between
          // routes, because these are pages and not tabs.
          active ? "border-b border-ns-accent" : "border-b border-transparent",
        )}
      >
        {children}
      </Link>
      <span className="text-text-caption">]</span>
    </span>
  );
}

/** The four routes as one row. On a phone it scrolls sideways rather than
 *  collapsing into a menu button: four routes fit, and a menu would put every
 *  route one tap deeper while hiding that a board, a dashboard and a verifier
 *  exist at all. */
export function NavRoutes({ active }: { active?: NavKey }) {
  return (
    <nav
      className="-mx-1 flex items-center gap-2 overflow-x-auto px-1 md:mx-0 md:gap-3 md:overflow-visible md:px-0"
      aria-label="sections"
    >
      {ROUTES.map((r) => (
        <Bracketed key={r.key} active={active === r.key} to={r.to}>
          {r.label}
        </Bracketed>
      ))}
    </nav>
  );
}

/** NIGHT in the strong ink, SHIFT in the accent. Type, not a file. */
export function Wordmark({ className }: { className?: string }) {
  return (
    <Link
      to="/"
      className={cn(
        "text-[20px] leading-[1.2] font-semibold text-text-strong",
        "transition-colors duration-[var(--dur-fast)] ease-[var(--ease-out)] hover:text-text-strong",
        className,
      )}
      style={{ letterSpacing: "var(--track-wordmark)" }}
    >
      NIGHT<span className="text-ns-accent">SHIFT</span>
    </Link>
  );
}

/** The sentence rule under the masthead. A surface that would rather spend the
 *  top of a phone screen on its instrument renders this itself, lower down. */
export function MastheadSentence({
  sentence,
  right,
  className,
}: {
  sentence: string;
  right?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-between gap-4 border-b border-border-hairline px-5 py-3 lg:px-14",
        className,
      )}
    >
      <p className="text-[13px] leading-[1.7] text-text-default">{sentence}</p>
      {right ? (
        <span className="text-[11px] leading-[1.45] text-text-caption">{right}</span>
      ) : null}
    </div>
  );
}

export function Masthead({
  active,
  sentence,
  right,
  chip,
  badge,
  /** The landing puts its h1 on the tagline, so its wordmark is a plain link.
   *  Every other page has no other candidate and keeps the h1 here. */
  heading = true,
  /** The phone layout drops the sentence rule here and the surface renders it
   *  further down, so the instrument is on screen without scrolling. */
  deferSentence = false,
}: {
  active?: NavKey;
  /** Omitted on the landing: the hero is the sentence there. */
  sentence?: string;
  /** The caption on the right of the sentence rule. */
  right?: string;
  chip?: React.ReactNode;
  badge?: React.ReactNode;
  heading?: boolean;
  deferSentence?: boolean;
}) {
  const wordmark = heading ? (
    <h1 className="flex items-center">
      <Wordmark />
    </h1>
  ) : (
    <Wordmark />
  );
  // One layout is in the DOM at a time rather than two with a CSS breakpoint
  // hiding one, so the four route labels are never on the page twice for a
  // screen reader or a find-in-page.
  const wide = useMediaQuery("(min-width: 768px)");

  return (
    <header className="flex flex-col">
      {/* Phone: two rows of chrome. The wordmark, the chip and the theme
          toggle take the first; the four routes take the second, on their own,
          so the row never wraps into a third and the chrome stays under the
          150px a phone screen can spare. That routes row scrolls sideways
          rather than collapsing into a menu button: four routes fit, and a menu
          would put every one of them a tap deeper while hiding from a reader
          arriving on a shared link that a board, a dashboard and a verifier
          exist at all.
          Desktop: two groups, one line. */}
      <div className="flex items-center justify-between gap-x-3 px-5 pt-3 pb-2 md:gap-x-4 md:pb-3 lg:px-14 lg:pt-5 lg:pb-4">
        <div className="flex min-w-0 items-center gap-3 md:gap-4">
          {wordmark}
          {wide ? badge : null}
        </div>
        <div className="flex shrink-0 items-center gap-x-3 md:gap-x-4">
          {wide ? <NavRoutes active={active} /> : null}
          {chip}
          <ThemeToggle />
        </div>
      </div>
      {wide ? null : (
        <div className="flex items-center gap-4 px-5 pb-2.5">
          <NavRoutes active={active} />
          {badge}
        </div>
      )}
      {sentence ? (
        <MastheadSentence
          sentence={sentence}
          right={right}
          className={deferSentence ? "hidden md:flex" : undefined}
        />
      ) : null}
    </header>
  );
}
