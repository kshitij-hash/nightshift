// Small shared pieces of the board's visual language: the section marker, the
// status dot, the copy-on-click hash, the engraved readout. Each one is used
// in several places on this page, which is the only reason it is a component.

import { useCallback, useEffect, useRef, useState } from "react";

import { cn } from "../../lib/utils";
import { usePrefersReducedMotion } from "./use-clock";

export type DotState = "live" | "settled" | "pending" | "fail";

const DOT_COLOR: Record<DotState, string> = {
  live: "var(--signal-live)",
  settled: "var(--signal-settled)",
  pending: "var(--signal-pending)",
  fail: "var(--signal-fail)",
};

/**
 * The live dot is the one ambient loop in the product, and it is justified:
 * it reports that the vault is being watched right now. Under reduced motion
 * it renders solid instead of pulsing.
 */
export function StatusDot({
  state,
  size = 6,
  beat = false,
  className,
}: {
  state: DotState;
  size?: number;
  beat?: boolean;
  className?: string;
}) {
  const still = usePrefersReducedMotion();
  const animate = beat && state === "live" && !still;
  return (
    <span
      aria-hidden="true"
      className={cn("inline-block shrink-0 rounded-full", className)}
      style={{
        width: size,
        height: size,
        background: DOT_COLOR[state],
        animation: animate
          ? "ns-heartbeat var(--heartbeat) ease-in-out infinite"
          : undefined,
      }}
    />
  );
}

/** `// CHARGE FEED` in the label role, with an optional right-hand note. This
 *  slash-comment marker is the one place the page uses the idiom. */
export function SectionHead({
  children,
  note,
  className,
}: {
  children: React.ReactNode;
  note?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-baseline justify-between gap-3 border-b border-border-row pb-2",
        className,
      )}
    >
      <h2 className="text-[13px] font-medium tracking-[0.2em] text-text-label">{children}</h2>
      {note ? <span className="text-[12px] text-text-caption">{note}</span> : null}
    </div>
  );
}

const TRUNCATED = /^0x[0-9a-fA-F]{1,8}…/;

/**
 * A hash the reader can take with them: fixed truncation on screen, the full
 * value in the title attribute, copy on click. The confirmation reverts after
 * 1500ms, per the motion table.
 */
export function HashCopy({
  value,
  display,
  tone = "label",
  title,
  className,
}: {
  value: string;
  display?: string;
  tone?: "strong" | "default" | "label" | "caption";
  title?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | null>(null);
  useEffect(() => () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
  }, []);

  const copy = useCallback(() => {
    void navigator.clipboard?.writeText(value);
    setCopied(true);
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(false), 1500);
  }, [value]);

  const toneClass =
    tone === "strong"
      ? "text-text-strong"
      : tone === "default"
        ? "text-text-default"
        : tone === "caption"
          ? "text-text-caption"
          : "text-text-label";

  const shown = display ?? value;
  return (
    <button
      type="button"
      onClick={copy}
      title={title ?? `${value} · click to copy`}
      className={cn(
        "inline-flex min-h-6 items-center rounded-sm bg-transparent p-0 font-mono text-inherit",
        "cursor-pointer transition-colors duration-[var(--dur-fast)] ease-[var(--ease-out)] hover:text-ns-accent",
        toneClass,
        className,
      )}
    >
      {copied ? "copied" : shown}
    </button>
  );
}

/** True when a string is already truncated with an ellipsis, so nothing tries
 *  to link it to a block explorer as if it were a whole hash. */
export const isTruncated = (v: string) => TRUNCATED.test(v);

/** An engraved instrument readout: label over value over basis caption. */
export function Readout({
  label,
  value,
  caption,
  accent = false,
  size = 20,
  className,
}: {
  label: string;
  value: React.ReactNode;
  caption: string;
  accent?: boolean;
  size?: number;
  className?: string;
}) {
  return (
    <div className={cn("flex min-w-0 flex-1 flex-col gap-1 px-5 py-3.5", className)}>
      <div className="text-[11px] font-medium tracking-[0.18em] whitespace-nowrap text-text-label">
        {label}
      </div>
      <div
        className="font-semibold tabular-nums"
        style={{
          fontSize: size,
          lineHeight: 1.15,
          color: accent ? "var(--accent)" : "var(--text-strong)",
        }}
      >
        {value}
      </div>
      <div className="text-[11px] leading-[1.45] text-text-caption">{caption}</div>
    </div>
  );
}

/** A caption in the page's smallest role. */
export function Cap({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span className={cn("text-[11px] leading-[1.45] text-text-caption", className)}>
      {children}
    </span>
  );
}

/**
 * A band row that stays shut until it is asked for: a 44px summary line
 * carrying the section marker, one line of what is inside, and the count, over
 * content that only enters the reading order once it is opened.
 *
 * Native details/summary, so keyboard and screen reader behaviour come from
 * the element rather than from a hand-rolled toggle.
 */
export function Disclosure({
  marker,
  teaser,
  count,
  children,
  className,
}: {
  marker: string;
  teaser: string;
  count?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <details className={cn("group border-b border-border-row", className)}>
      <summary
        className={cn(
          "flex min-h-11 cursor-pointer list-none flex-wrap items-center gap-x-4 gap-y-1 py-2",
          "outline-none focus-visible:ring-2 focus-visible:ring-ring",
          "[&::-webkit-details-marker]:hidden",
        )}
      >
        <span className="text-[13px] font-medium tracking-[0.2em] whitespace-nowrap text-text-label transition-colors duration-[var(--dur-fast)] ease-[var(--ease-out)] group-open:text-ns-accent">
          {marker}
        </span>
        {/* On a phone the marker and the count take the first line and the
            teaser takes the next, rather than three columns fighting over
            350px and the teaser losing. */}
        <span className="order-last w-full min-w-0 text-[13px] leading-[1.5] text-text-prose md:order-none md:w-auto md:flex-1">
          {teaser}
        </span>
        {count ? (
          <span className="ml-auto text-[12px] whitespace-nowrap text-text-caption md:ml-0">
            {count}
          </span>
        ) : null}
      </summary>
      <div className="flex flex-col gap-6 pt-4 pb-10">{children}</div>
    </details>
  );
}

/**
 * The caveat affordance: a small labelled toggle that opens its sentence in
 * place, rather than a hover-only tooltip a touch reader can never reach. It
 * started on the dashboard tile and is shared from here, because the board and
 * the verify surface need the same affordance for the same reason.
 *
 * `popover` floats the body over the layout instead of pushing it down, for
 * the places where the row it hangs off has to stay one row.
 */
export function CaveatDisclosure({
  caveat,
  label = "caveat",
  openLabel,
  popover = false,
  children,
  className,
}: {
  caveat?: string;
  label?: string;
  openLabel?: string;
  popover?: boolean;
  children?: React.ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const body = children ?? caveat;
  return (
    <div className={cn("flex flex-col gap-1.5", popover && "relative", className)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={cn(
          "inline-flex min-h-11 w-fit items-center rounded-sm border border-border-field px-1.5",
          "text-[11px] font-medium tracking-[0.14em] uppercase md:min-h-6",
          "transition-colors duration-[var(--dur-fast)] ease-[var(--ease-out)]",
          "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
          open ? "border-ns-accent text-ns-accent" : "text-text-label hover:text-ns-accent",
        )}
      >
        {open ? (openLabel ?? `${label}, shown`) : label}
      </button>
      {open ? (
        popover ? (
          <div className="absolute top-full left-0 z-20 mt-1.5 w-[280px] border border-border-panel bg-surface-panel px-3 py-2.5">
            <div className="text-[11px] leading-[1.45] text-text-caption">{body}</div>
          </div>
        ) : (
          <div
            className={cn(
              "text-[11px] leading-[1.45] text-text-caption",
              // A caveat sentence is measured; a caller that passes its own
              // content brings its own measure.
              children ? undefined : "max-w-[46ch]",
            )}
          >
            {body}
          </div>
        )
      ) : null}
    </div>
  );
}
