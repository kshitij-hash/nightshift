// One square per period across the known schedule.
//
// Gray filled = charged inside its window. Orange = charged late, or a window
// that came and went uncharged. Outline = the window is open now or still
// ahead. There is no third signal and there is no green: a period that went
// well is history, and history is gray.

import type { CSSProperties } from "react";

import type { TickState } from "./derive";

const TICK: Record<TickState, CSSProperties> = {
  ok: { background: "var(--ink-5)", border: "1px solid var(--ink-4)" },
  late: { background: "var(--accent)", border: "1px solid var(--accent)" },
  open: { background: "transparent", border: "1px solid var(--ink-4)" },
  future: { background: "var(--bg-4)", border: "1px solid var(--line-ghost)" },
};

const WORD: Record<TickState, string> = {
  ok: "charged inside its window",
  late: "charged late, or its window passed uncharged",
  open: "window open, not charged yet",
  future: "window has not opened yet",
};

export function TickBar({
  states,
  label = "PERIODS",
  caption,
  width = 26,
}: {
  states: TickState[];
  label?: string | null;
  caption?: string;
  width?: number;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      {label ? (
        <span className="text-[11px] leading-[1.45] tracking-[0.18em] text-text-caption">
          {label}
        </span>
      ) : null}
      <div className="flex gap-[5px]">
        {states.map((s, i) => (
          <span
            key={i}
            title={`period ${String(i).padStart(2, "0")} · ${WORD[s]}`}
            style={{
              width,
              height: 11,
              boxSizing: "border-box",
              transition: "background var(--dur-base) var(--ease-out)",
              ...TICK[s],
            }}
          />
        ))}
      </div>
      {caption ? <span className="text-[11px] text-text-caption">{caption}</span> : null}
    </div>
  );
}
