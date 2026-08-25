// The persona router: three ways in, one machine underneath.
//
// The failure mode this exists to prevent is two real tabs and one thin
// afterthought tab, so the three bodies are equal by construction: three steps
// each, one honest one-liner each, one call to action each at the same weight,
// and one caption each carrying what the vault says about that reader. None of
// the three is a footnote to another.
//
// Two things about the mechanics are load-bearing.
//
//   Height. All three bodies are in the grid at once, stacked in one cell, and
//   the two that are not selected are invisible and inert. The frame is
//   therefore exactly as tall as the tallest body and never animates, so the
//   proof section below it does not move under the reader's cursor when a tab
//   is clicked. Nothing here hard-codes a pixel height that a copy edit could
//   invalidate.
//
//   Control. The bar is the design system's underline tabs and nothing else:
//   no pills, no cards, no persona illustrations. It is hand-rolled rather
//   than taken from the Radix copy because that copy unmounts (or display:none
//   hides) the inactive panels, which is exactly the height behaviour this
//   section cannot have. Roving tabindex, arrow keys, Home and End are
//   implemented here to match what it would have provided.
//
// On a phone the bar becomes a segmented control rather than an accordion.
// Three collapsed rows would put two personas behind a tap and a scroll, which
// is the thin-tab failure again; an accordion also lets a reader open all three
// at once and bury the proof section under a wall. The segmented control shows
// all three labels at the same size and costs one tap for any of them. The
// trade is shortened labels, and the full phrasing survives one line lower in
// the body.

import { Link } from "@tanstack/react-router";
import { useLayoutEffect, useRef, useState } from "react";

import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { Mark } from "./marks";
import type { MarkKind } from "./marks";

export type PersonaId = "subscribe" | "creator" | "verify";

type Persona = {
  id: PersonaId;
  /** The desktop tab label. */
  tab: string;
  /** The phone segment label, shortened to fit three across 390. */
  short: string;
  /** The state tag over the one-liner. */
  label: string;
  steps: Array<[MarkKind, string]>;
  line: string;
  cta: string;
  to: "/manage" | "/creator" | "/verify";
};

/** What the captions under the three calls to action are allowed to say. Every
 *  field is read from the vault by the caller; a field left null drops its
 *  clause rather than printing a placeholder. */
export type PersonaFacts = {
  /** Periods the live schedule bought. */
  periods: number | null;
  /** Periods of it the vault has charged. */
  charged: number | null;
  /** Escrow still held for it, formatted, without a unit. */
  escrow: string | null;
  /** The creator id the live schedule pays, truncated. */
  creator: string | null;
  /** Charges decoded across every vault generation. */
  charges: number;
  /** Their sum, formatted, without a unit. Null when no charge carried an
   *  amount to sum. */
  gross: string | null;
};

const PERSONAS: Persona[] = [
  {
    id: "subscribe",
    tab: "subscribe privately",
    short: "SUBSCRIBE",
    label: "SUBSCRIBER",
    steps: [
      ["deposit", "Fund the subscription once, through the privacy pool."],
      ["wheel", "The vault takes one payment per period; a spent period can never be charged again."],
      ["gate", "Cancel any time with a signature and take back whatever is left."],
    ],
    line: "the vault never learns your wallet, and never asks again",
    cta: "start a private subscription",
    to: "/manage",
  },
  {
    id: "creator",
    tab: "get paid as a creator",
    short: "GET PAID",
    label: "CREATOR",
    steps: [
      ["tray", "Register on the vault and publish one tier: a price and a billing period."],
      ["outlets", "Each period's charge lands on-chain as a public event, on schedule."],
      ["claim", "Claim your balance whenever you like, in one transaction you sign."],
    ],
    line: "nobody can read your subscriber list; anybody can audit your revenue",
    cta: "set up as a creator",
    to: "/creator",
  },
  {
    id: "verify",
    tab: "verify a subscription",
    short: "VERIFY",
    label: "VERIFIER",
    steps: [
      ["doc", "Send the subscriber a challenge: which creator, which tier, valid until which block."],
      ["sign", "Their wallet signs it and hands you back a presentation."],
      ["check", "Check the presentation against the vault. One RPC read; no key, no account."],
    ],
    line: "you learn the tier, not the person",
    cta: "verify a subscription",
    to: "/verify",
  },
];

export const PERSONA_IDS = PERSONAS.map((p) => p.id);

/** The provenance caption under each call to action. The subscriber's is the
 *  live schedule, read from the vault. The other two state a limit the product
 *  is not allowed to hide: the creator's is that a per-creator topline is
 *  publicly derivable, the verifier's is that a presentation reveals the
 *  commitment. */
function caption(p: Persona, facts: PersonaFacts): string {
  if (p.id === "subscribe") {
    // The one-liner two rows above already says the wallet is never named, so
    // this caption is the schedule and nothing else.
    return facts.periods !== null && facts.charged !== null
      ? `${facts.periods} periods bought, ${facts.charged} charged` +
          (facts.escrow !== null ? `, escrow ${facts.escrow} STRK` : "") +
          "."
      : "no live schedule decoded at this vault.";
  }
  if (p.id === "creator") {
    const who = facts.creator !== null ? `creator ${facts.creator} · ` : "";
    const sum = facts.gross !== null ? `${facts.gross} STRK gross, ` : "";
    return `${who}${facts.charges} charges · ${sum}summed from public Charged events.`;
  }
  return (
    "npm nightshift-verify · a presentation reveals the subscription's commitment, and " +
    "presentations of one subscription are linkable across verifiers."
  );
}

function Steps({ steps }: { steps: Persona["steps"] }) {
  return (
    <ol className="flex list-none flex-col">
      {steps.map(([mark, text], i) => (
        <li
          key={text}
          className={cn(
            "flex items-start gap-3 py-3.5",
            i > 0 && "border-t border-border-row",
          )}
        >
          <span className="w-5 shrink-0 pt-0.5 text-[11px] leading-[1.45] text-text-caption">
            {`0${i + 1}`}
          </span>
          <span className="pt-px">
            <Mark kind={mark} />
          </span>
          <span className="text-[13.5px] leading-[1.55] text-text-default">{text}</span>
        </li>
      ))}
    </ol>
  );
}

function PersonaBody({ p, facts }: { p: Persona; facts: PersonaFacts }) {
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <Steps steps={p.steps} />
      <div className="flex flex-col gap-3 border-t border-border-panel pt-4">
        <div className="flex flex-wrap items-baseline gap-3">
          <span className="shrink-0 text-[11px] font-medium tracking-[0.18em] text-text-label">
            {p.label}
          </span>
          <span className="text-[14.5px] leading-[1.5] text-text-strong">{p.line}</span>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-4">
          {/* variant=outline in all three. The one filled button on this page
              is at the bottom of it, so no tab outranks another. */}
          <Button variant="outline" size="md" asChild>
            <Link to={p.to}>
              {p.cta} <span aria-hidden="true">→</span>
            </Link>
          </Button>
          <span className="max-w-[52ch] text-[11px] leading-[1.5] text-text-caption sm:text-right">
            {caption(p, facts)}
          </span>
        </div>
      </div>
    </div>
  );
}

const TAB_ID = (id: PersonaId) => `persona-tab-${id}`;
const PANEL_ID = (id: PersonaId) => `persona-panel-${id}`;

/** Arrow keys move between tabs, Home and End jump to the ends, and the focus
 *  ring stays on the tab list. Tab itself moves into the body, where the call
 *  to action is the only focusable thing. */
function useRovingKeys(value: PersonaId, onChange: (v: PersonaId) => void) {
  const list = useRef<HTMLDivElement | null>(null);
  const focusTab = (id: PersonaId) => {
    onChange(id);
    list.current?.querySelector<HTMLElement>(`#${TAB_ID(id)}`)?.focus();
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    const i = PERSONAS.findIndex((p) => p.id === value);
    if (e.key === "ArrowRight") focusTab(PERSONAS[(i + 1) % PERSONAS.length]!.id);
    else if (e.key === "ArrowLeft")
      focusTab(PERSONAS[(i - 1 + PERSONAS.length) % PERSONAS.length]!.id);
    else if (e.key === "Home") focusTab(PERSONAS[0]!.id);
    else if (e.key === "End") focusTab(PERSONAS[PERSONAS.length - 1]!.id);
    else return;
    e.preventDefault();
  };
  return { list, onKeyDown };
}

/** Where the underline sits, in the tab list's own coordinates. */
type Indicator = { x: number; w: number };

/**
 * The underline is one element that moves, not a border that appears on
 * whichever tab is selected. Selecting a tab is a state change, so the marker
 * travels to report it, on the same clock the body crossfades on, and the eye
 * has something continuous to follow across a swap where the body is briefly
 * empty.
 *
 * It moves on transform alone: the bar is 1px wide and is placed with
 * translateX and stretched with scaleX from a left origin. Animating width or
 * left instead would put a layout pass in every frame of a 160ms move, on an
 * element that sits directly above the tallest section on the page.
 *
 * Measured rather than computed from the labels, because the labels are text
 * in a font that may still be swapping when this first runs; the fonts.ready
 * re-measure is what catches that, and the observer catches a resize.
 *
 * There is no first-run guard, because CSS does not need one. The marker is
 * only in the DOM once a measurement exists, and a transition never runs on
 * the value an element is first painted with, so the first placement lands and
 * every later one travels, with nothing tracking which is which.
 */
function useUnderline(
  list: React.RefObject<HTMLDivElement | null>,
  value: PersonaId,
  enabled: boolean,
): Indicator | null {
  const [at, setAt] = useState<Indicator | null>(null);

  useLayoutEffect(() => {
    const el = list.current;
    if (!enabled || el === null) return;
    // Same measurement or no change: keep the old object, so a resize that
    // did not move this tab does not re-render the section.
    const place = (tab: HTMLElement) =>
      setAt((prev) =>
        prev !== null && prev.x === tab.offsetLeft && prev.w === tab.offsetWidth
          ? prev
          : { x: tab.offsetLeft, w: tab.offsetWidth },
      );
    const measure = () => {
      const tab = el.querySelector<HTMLElement>(`#${TAB_ID(value)}`);
      if (tab) place(tab);
    };
    // The observer delivers a first callback when it starts observing, which
    // is the initial measurement; it is not called separately here.
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    let live = true;
    void document.fonts.ready.then(() => {
      if (live) measure();
    });
    return () => {
      live = false;
      observer.disconnect();
    };
  }, [list, value, enabled]);

  return enabled ? at : null;
}

export function PersonaTabs({
  value,
  onChange,
  segmented,
  facts,
}: {
  value: PersonaId;
  onChange: (v: PersonaId) => void;
  /** The phone control. Same three targets, shorter labels, 44px tall. */
  segmented: boolean;
  facts: PersonaFacts;
}) {
  const { list, onKeyDown } = useRovingKeys(value, onChange);
  // The phone control is a segmented one: three equal cells sharing a border,
  // where the selected cell is already marked by its fill. A marker sliding
  // between adjacent equal cells there would be motion reporting something the
  // fill has already said, so it runs on the desktop bar only.
  const underline = useUnderline(list, value, !segmented);

  return (
    <div className="flex flex-col gap-6">
      <div
        ref={list}
        role="tablist"
        aria-label="who is at this page"
        onKeyDown={onKeyDown}
        className={
          segmented
            ? "flex border border-border-panel"
            : "relative flex items-center gap-8 border-b border-border-hairline"
        }
      >
        {underline ? (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute bottom-[-1px] left-0 h-[2px] w-px origin-left bg-ns-accent"
            style={{
              transform: `translateX(${underline.x}px) scaleX(${underline.w})`,
              transition: "transform var(--dur-swap) var(--ease-in-out)",
            }}
          />
        ) : null}
        {PERSONAS.map((p) => {
          const on = p.id === value;
          return (
            <button
              key={p.id}
              id={TAB_ID(p.id)}
              type="button"
              role="tab"
              aria-selected={on}
              aria-controls={PANEL_ID(p.id)}
              tabIndex={on ? 0 : -1}
              onClick={() => onChange(p.id)}
              className={cn(
                // Focus is the document rule in base.css: a solid 2px accent
                // outline held --focus-offset off the label. What was here was
                // a 2px box-shadow at 55% alpha drawn flush against the text,
                // and the two together (a dull maroon, square, hard on the
                // glyphs) read as an error box around the tab rather than as
                // focus. rounded-sm gives the outline the system's 2px corner.
                // outline-offset 4 rather than the document's 2: the sliding
                // underline sits exactly where a 2px ring would land, and two
                // accent lines merging read as one thick bar, not as a ring.
                "cursor-pointer rounded-sm font-mono focus-visible:outline-offset-4",
                // Instant on, short fade off. See ns-hover in motion.css.
                "transition-colors ns-hover",
                segmented
                  ? cn(
                      "min-h-11 flex-1 border-b-2 px-1 py-3 text-[10.5px] font-medium tracking-[0.1em]",
                      "not-first:border-l not-first:border-l-border-panel",
                      on
                        ? "border-b-ns-accent bg-[var(--accent-wash)] text-ns-accent"
                        : "border-b-transparent text-text-label hover:text-text-default",
                    )
                  : cn(
                      // The 2px of transparent bottom border stays: it is what
                      // reserves the row the sliding marker occupies, so the
                      // bar does not change height when selection moves.
                      "-mb-px inline-flex min-h-11 items-center border-b-2 border-b-transparent px-1 text-[13px] font-medium md:min-h-9",
                      on ? "text-text-strong" : "text-text-label hover:text-text-default",
                    ),
              )}
            >
              {segmented ? p.short : p.tab}
            </button>
          );
        })}
      </div>

      {/* One grid cell, three bodies. The cell is as tall as the tallest of
          them and is never animated, so nothing below this section moves. */}
      <div className="grid">
        {PERSONAS.map((p) => {
          const on = p.id === value;
          return (
            <div
              key={p.id}
              id={PANEL_ID(p.id)}
              role="tabpanel"
              aria-labelledby={TAB_ID(p.id)}
              inert={!on}
              className={cn(
                "col-start-1 row-start-1 min-w-0",
                on ? "visible" : "invisible",
              )}
              style={
                on
                  ? { animation: "ns-persona-in var(--dur-swap) var(--ease-in-out) both" }
                  : undefined
              }
            >
              <PersonaBody p={p} facts={facts} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
