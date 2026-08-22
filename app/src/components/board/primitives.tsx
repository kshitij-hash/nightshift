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
      <div className="text-[10px] font-medium tracking-[0.18em] whitespace-nowrap text-text-label">
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
      <div className="text-[10px] leading-[1.45] text-text-caption">{caption}</div>
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
    <span className={cn("text-[10px] leading-[1.45] text-text-caption", className)}>
      {children}
    </span>
  );
}
