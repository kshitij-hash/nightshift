// The persona router: three ways in, one machine underneath.
//
// The failure mode this exists to prevent is two real tabs and one thin
// afterthought tab, so the three bodies are equal by construction: three steps
// each, one honest one-liner each, one call to action each at the same weight,
// and one provenance caption each that states a real limit. None of the three
// is a footnote to another.
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
import { useRef } from "react";

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
      ["deposit", "Commit escrow once, through the privacy pool."],
      ["wheel", "The vault charges it on its block window, against a write-once nullifier."],
      ["gate", "Cancel with a signature, from any sender, at any time."],
    ],
    line: "your wallet is never named, and is never asked again",
    cta: "start a private subscription",
    to: "/manage",
  },
  {
    id: "creator",
    tab: "get paid as a creator",
    short: "GET PAID",
    label: "CREATOR",
    steps: [
      ["tray", "Deploy a vault and publish one tier: an amount and a cadence."],
      ["outlets", "Charges land as public events, one per period, on schedule."],
      ["claim", "Claim the balance when it suits, in one transaction you sign."],
    ],
    line: "your subscriber list is nobody's business; your ledger is public math",
    cta: "set up as a creator",
    to: "/creator",
  },
  {
    id: "verify",
    tab: "verify a subscription",
    short: "VERIFY",
    label: "VERIFIER",
    steps: [
      ["doc", "Issue a challenge naming gate, creator, tier and expiry block."],
      ["sign", "Take back the presentation the subscriber's wallet signed."],
      ["check", "Check it against vault state: one RPC read, no key, no account."],
    ],
    line: "you learn the tier, not the person",
    cta: "verify a subscription",
    to: "/verify",
  },
];

export const PERSONA_IDS = PERSONAS.map((p) => p.id);

/** The provenance caption under each call to action. Each one states a limit
 *  the product is not allowed to hide: the subscriber's is what a charge
 *  actually names, the creator's is that a per-creator topline is publicly
 *  derivable, the verifier's is that a presentation reveals the commitment. */
function caption(p: Persona, facts: PersonaFacts): string {
  if (p.id === "subscribe") {
    const schedule =
      facts.periods !== null && facts.charged !== null
        ? `${facts.periods} periods bought, ${facts.charged} charged` +
          (facts.escrow !== null ? `, escrow ${facts.escrow} STRK` : "") +
          ". "
        : "";
    return `${schedule}Every charge names the commitment, never the wallet.`;
  }
  if (p.id === "creator") {
    const who = facts.creator !== null ? `creator ${facts.creator} · ` : "";
    const sum = facts.gross !== null ? `${facts.gross} STRK gross, ` : "";
    return `${who}${facts.charges} charges · ${sum}summed from public Charged events.`;
  }
  return (
    "npm nightshift-verify · a presentation reveals the commitment, and presentations " +
    "of one subscription are linkable across gates."
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
            : "flex items-center gap-8 border-b border-border-hairline"
        }
      >
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
                "cursor-pointer font-mono transition-colors duration-[var(--dur-fast)] ease-[var(--ease-out)]",
                "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                segmented
                  ? cn(
                      "min-h-11 flex-1 border-b-2 px-1 py-3 text-[10.5px] font-medium tracking-[0.1em]",
                      "not-first:border-l not-first:border-l-border-panel",
                      on
                        ? "border-b-ns-accent bg-[var(--accent-wash)] text-ns-accent"
                        : "border-b-transparent text-text-label hover:text-text-default",
                    )
                  : cn(
                      "-mb-px inline-flex min-h-11 items-center border-b-2 px-1 text-[13px] font-medium md:min-h-9",
                      on
                        ? "border-b-ns-accent text-text-strong"
                        : "border-b-transparent text-text-label hover:text-text-default",
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
