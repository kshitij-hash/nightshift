// The small shared pieces of the wallet surface.
//
// These duplicate a few shapes that exist elsewhere in the app rather than
// importing them, and that is deliberate: this surface is built alongside the
// board and the verify page by separate hands, and a shared component edited
// under one of them should not be able to change what a signing flow looks
// like. The duplication is four small components and it buys independence.

import { useCallback, useEffect, useRef, useState } from "react";

import { cn } from "../../lib/utils";

/** The reduced-motion query, read once and watched. Every animated piece on
 *  this surface asks first. */
export function usePrefersReducedMotion(): boolean {
  const [still, setStill] = useState(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true,
  );
  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!mq) return;
    const onChange = () => setStill(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return still;
}

export type DotState = "live" | "settled" | "pending" | "fail";

const DOT_COLOR: Record<DotState, string> = {
  live: "var(--signal-live)",
  settled: "var(--signal-settled)",
  pending: "var(--signal-pending)",
  fail: "var(--signal-fail)",
};

export function StatusDot({
  state,
  size = 7,
  beat = false,
}: {
  state: DotState;
  size?: number;
  beat?: boolean;
}) {
  const still = usePrefersReducedMotion();
  const animate = beat && state === "live" && !still;
  return (
    <span
      aria-hidden="true"
      className="inline-block shrink-0 rounded-full"
      style={{
        width: size,
        height: size,
        background: DOT_COLOR[state],
        animation: animate ? "ns-heartbeat var(--heartbeat) ease-in-out infinite" : undefined,
      }}
    />
  );
}

/** The connecting spinner: a dashed ring turning once a second, linear. It is
 *  bounded by the request that started it and cannot outlive the promise.
 *  Under reduced motion the ring stops and the word carries the state. */
export function DashSpinner({ size = 14 }: { size?: number }) {
  const still = usePrefersReducedMotion();
  const r = size / 2 - 1.5;
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      aria-hidden="true"
      className="block shrink-0"
      style={{ animation: still ? undefined : "ns-spin 1000ms linear infinite" }}
    >
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="var(--accent)"
        strokeWidth="1.5"
        strokeDasharray="3 4"
      />
    </svg>
  );
}

/**
 * The address arriving, one character at a time.
 *
 * 15ms a glyph and never more than 200ms in total, per the motion table, so
 * the step shrinks rather than the reveal running long. It runs once per
 * distinct value and not on re-render. Reduced motion prints the whole string
 * immediately. The accent caret marks the write head and disappears at the end.
 */
export function CharacterReveal({ text }: { text: string }) {
  const still = usePrefersReducedMotion();
  const [shown, setShown] = useState(0);

  useEffect(() => {
    if (still) return;
    const step = Math.max(1, Math.min(15, Math.floor(200 / Math.max(1, text.length))));
    let i = 0;
    const timer = window.setInterval(() => {
      i += 1;
      setShown(i);
      if (i >= text.length) window.clearInterval(timer);
    }, step);
    return () => window.clearInterval(timer);
  }, [text, still]);

  // Reduced motion is handled here rather than by resetting state, so the
  // effect never writes state synchronously and a mid-reveal preference change
  // completes the string instead of freezing it.
  const visible = still ? text.length : shown;
  return (
    <span className="tabular" title={text}>
      {text.slice(0, visible)}
      {visible < text.length ? <span className="text-ns-accent">▌</span> : null}
    </span>
  );
}

/** `// SECTION` in the label role. */
export function SectionHead({
  children,
  note,
}: {
  children: React.ReactNode;
  note?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-border-row pb-2">
      <h2 className="text-[13px] font-medium tracking-[0.2em] text-text-label">{children}</h2>
      {note ? <span className="text-[12px] text-text-caption">{note}</span> : null}
    </div>
  );
}

/** The numbered step frame. All steps stay visible at all times: advancing
 *  lifts the next border to accent, nothing collapses and nothing slides, so
 *  the preview stays readable while the form above it is re-checked. */
export function Step({
  n,
  name,
  note,
  active,
  children,
}: {
  n: string;
  name: string;
  note: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <section
      className={cn(
        "flex min-w-0 flex-1 flex-col border transition-colors duration-[var(--dur-quick)] ease-[var(--ease-out)]",
        active ? "border-ns-accent" : "border-border-panel",
      )}
    >
      <header
        className={cn(
          "flex flex-wrap items-center justify-between gap-3 border-b border-border-panel px-4 py-3",
          active ? "bg-surface-fill" : "bg-transparent",
        )}
      >
        <div className="flex items-center gap-3">
          <span
            className={cn(
              "inline-flex h-6 w-7 shrink-0 items-center justify-center border text-[11px] tabular-nums",
              active ? "border-ns-accent text-ns-accent" : "border-border-field text-text-caption",
            )}
          >
            {n}
          </span>
          <span
            className={cn(
              "text-[13px] font-medium tracking-[0.14em]",
              active ? "text-text-strong" : "text-text-label",
            )}
          >
            {name}
          </span>
        </div>
        <span className="text-[11px] text-text-caption">{note}</span>
      </header>
      <div className="flex flex-1 flex-col gap-3 px-5 py-5">{children}</div>
    </section>
  );
}

export type NarrationTone = "plain" | "dim" | "ok" | "bad";

export type NarrationLine = { text: string; tone: NarrationTone };

const TONE_CLASS: Record<NarrationTone, string> = {
  plain: "text-text-default",
  dim: "text-text-caption",
  ok: "text-ns-accent",
  bad: "text-destructive",
};

/**
 * Where the ops console writes to a log pane, this surface narrates inline.
 * The lines are the same lines: what was checked, what it cost, what was
 * submitted. Nothing here is decorative and nothing here is a private key.
 */
export function Narration({
  lines,
  minHeight = "5.6em",
  label,
}: {
  lines: NarrationLine[];
  minHeight?: string;
  label: string;
}) {
  return (
    <div
      aria-label={label}
      aria-live="polite"
      className="flex flex-col gap-1 overflow-x-auto border border-border-panel bg-surface-sunken px-3 py-2.5 text-[12px] leading-[1.55] break-words"
      style={{ minHeight }}
    >
      {lines.map((line, i) => (
        <p key={`${i}-${line.text}`} className={TONE_CLASS[line.tone]}>
          {line.text}
        </p>
      ))}
    </div>
  );
}

/** Label left, value right, in the data register. */
export function KeyValue({ rows }: { rows: Array<[string, React.ReactNode]> }) {
  return (
    <dl className="grid grid-cols-[minmax(0,8.5rem)_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-[12px]">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-text-label">{k}</dt>
          <dd className="min-w-0 break-all text-text-default tabular-nums">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** A value the reader can take with them: truncated on screen, whole value in
 *  the title, copy on click, confirmation reverting after 1500ms. */
export function CopyValue({
  value,
  display,
  className,
}: {
  value: string;
  display?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );
  const copy = useCallback(() => {
    void navigator.clipboard?.writeText(value);
    setCopied(true);
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(false), 1500);
  }, [value]);
  return (
    <button
      type="button"
      onClick={copy}
      title={`${value} · click to copy`}
      className={cn(
        "inline-flex min-h-6 max-w-full items-center rounded-sm bg-transparent p-0 text-left font-mono text-inherit break-all",
        "cursor-pointer transition-colors duration-[var(--dur-fast)] ease-[var(--ease-out)] hover:text-ns-accent",
        className,
      )}
    >
      {copied ? "copied" : (display ?? value)}
    </button>
  );
}

/** A labelled input with the sentence that says what goes in it, and the
 *  refusal underneath when there is one. Errors say how to fix. */
export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint: string;
  error?: string | null;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-[11px] font-medium tracking-[0.18em] text-text-label">{label}</span>
      {children}
      <p className="text-[11px] leading-[1.5] text-text-caption">{hint}</p>
      {error ? (
        <p
          role="alert"
          className="border-l-2 border-destructive pl-3 text-[12px] leading-[1.55] text-destructive"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * A one-of-several choice: cadence, owner key. Selection is carried by the
 * accent hairline and the accent label, never by a filled button, because the
 * filled accent is the screen's single primary action and a row of them would
 * spend it on a setting.
 */
export function ChoiceChip({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={cn(
        "inline-flex min-h-11 items-center rounded-md border px-2.5 text-[12px] font-medium",
        "transition-colors duration-[var(--dur-fast)] ease-[var(--ease-out)] active:scale-[0.98]",
        "outline-none focus-visible:ring-2 focus-visible:ring-ring md:min-h-8",
        selected
          ? "border-ns-accent bg-[var(--accent-wash)] text-ns-accent"
          : "border-border-field bg-transparent text-text-label hover:text-text-default",
      )}
    >
      {children}
    </button>
  );
}

export function TextInput({
  invalid = false,
  ...props
}: React.ComponentProps<"input"> & { invalid?: boolean }) {
  return (
    <input
      spellCheck={false}
      autoCorrect="off"
      autoCapitalize="off"
      className={cn(
        "min-h-11 w-full rounded-sm border bg-surface-field px-3 py-2 font-mono text-[13px] text-text-default md:min-h-8",
        "outline-none focus-visible:ring-2 focus-visible:ring-ring",
        invalid ? "border-destructive" : "border-border-field",
      )}
      {...props}
    />
  );
}
