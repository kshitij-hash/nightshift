// The heartbeat instrument: the board's one bespoke drawing.
//
// Drawn rather than composed. An engraved bezel, 60 minute ticks over the
// period, a needle, the arc filling toward the next charge window, and the
// 1 Hz core. Hairlines only, one accent, no fills that are not a token. The
// arc is an SVG stroke-dasharray rather than a conic gradient so the whole
// instrument stays a single vector object at any size.
//
// One revolution = one period. The dial reports three facts at once: how far
// through the period the chain is (arc + needle), what the countdown says
// (center value), and that the read is live (the core dot).

import { useTheme } from "../../theme/theme-provider";
import { StatusDot } from "./primitives";

export type HeartbeatProps = {
  size?: number;
  /** 0..1 around the dial. */
  progress: number;
  /** The center numeral, already formatted. */
  value: string;
  label: string;
  sub: string;
  subValue: string;
  live?: boolean;
  liveLabel?: string;
  /** Nothing is advancing: snapshot render, or a finished schedule. The arc
   *  and the numeral drop to the label ink so the dial reads as stopped. */
  dead?: boolean;
  /** Set for one beat when a charge lands: the core flares once. */
  flare?: boolean;
};

export function Heartbeat({
  size = 320,
  progress,
  value,
  label,
  sub,
  subValue,
  live = true,
  liveLabel = "VAULT LIVE",
  dead = false,
  flare = false,
}: HeartbeatProps) {
  const { theme } = useTheme();
  const u = size / 320;
  const c = size / 2;
  const R = c - 5 * u;
  const compact = size <= 240;

  const ticks = [];
  for (let i = 0; i < 60; i++) {
    const a = ((i * 6 - 90) * Math.PI) / 180;
    const card = i % 15 === 0;
    const major = i % 5 === 0;
    const r1 = R - 4 * u;
    const r2 = R - (card ? 26 : major ? 17 : 9) * u;
    ticks.push(
      <line
        key={i}
        x1={c + Math.cos(a) * r1}
        y1={c + Math.sin(a) * r1}
        x2={c + Math.cos(a) * r2}
        y2={c + Math.sin(a) * r2}
        stroke={card ? "var(--ink-4)" : major ? "var(--ink-5)" : "var(--line-ghost)"}
        strokeWidth={card ? 1.4 : 1}
      />,
    );
  }

  const ar = R - 34 * u;
  const circ = 2 * Math.PI * ar;
  const na = ((progress * 360 - 90) * Math.PI) / 180;
  const face = R - 58 * u;
  // A finished or stopped schedule draws its arc at track weight in the track
  // ink: the accent's 6px stroke is reserved for an arc that is still
  // advancing, and the label under the numeral says which one this is.
  const arcCol = dead ? "var(--ink-5)" : "var(--accent)";
  // The track is a fill in dark and a hairline gray in light: the same figure
  // needs a different value on each ground to read the same.
  const track = theme === "light" ? "var(--line-ghost)" : "var(--bg-4)";
  const cardinals: Array<[string, number]> = [
    ["+00", -90],
    ["+15", 0],
    ["+30", 90],
    ["+45", 180],
  ];

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg
        aria-hidden="true"
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        style={{ display: "block", overflow: "visible" }}
      >
        <circle cx={c} cy={c} r={R} fill="none" stroke="var(--line-panel)" />
        <circle cx={c} cy={c} r={R - 3 * u} fill="none" stroke="var(--line-rule)" />
        {ticks}
        <circle cx={c} cy={c} r={ar} fill="none" stroke={track} strokeWidth={6 * u} />
        <circle
          cx={c}
          cy={c}
          r={ar}
          fill="none"
          stroke={arcCol}
          strokeWidth={dead ? 1 : 6 * u}
          strokeLinecap="butt"
          strokeDasharray={`${circ * progress} ${circ}`}
          transform={`rotate(-90 ${c} ${c})`}
          style={{ transition: "stroke-dasharray var(--dur-base) var(--ease-in-out)" }}
        />
        <circle cx={c} cy={c} r={ar - 6 * u} fill="none" stroke="var(--line-rule)" />
        <line
          x1={c}
          y1={c}
          x2={c + Math.cos(na) * (ar - 9 * u)}
          y2={c + Math.sin(na) * (ar - 9 * u)}
          stroke="var(--ink-4)"
          strokeWidth={1}
          style={{ transition: "all var(--dur-base) var(--ease-in-out)" }}
        />
        <line
          x1={c + Math.cos(na) * (ar - 13 * u)}
          y1={c + Math.sin(na) * (ar - 13 * u)}
          x2={c + Math.cos(na) * (ar + 6 * u)}
          y2={c + Math.sin(na) * (ar + 6 * u)}
          stroke={arcCol}
          strokeWidth={1.6}
          style={{ transition: "all var(--dur-base) var(--ease-in-out)" }}
        />
        <circle cx={c} cy={c} r={face} fill="var(--bg-3)" stroke="var(--line-panel)" />
        <circle cx={c} cy={c} r={face - 5 * u} fill="none" stroke="var(--line-soft)" />
        {Array.from({ length: 12 }, (_, i) => {
          const a = (i * 30 * Math.PI) / 180;
          const r1 = face - 5 * u;
          const r2 = face - 11 * u;
          return (
            <line
              key={i}
              x1={c + Math.cos(a) * r1}
              y1={c + Math.sin(a) * r1}
              x2={c + Math.cos(a) * r2}
              y2={c + Math.sin(a) * r2}
              stroke="var(--line-ghost)"
              strokeWidth={1}
            />
          );
        })}
        <circle cx={c} cy={c} r={3 * u} fill="var(--bg-1)" stroke="var(--ink-5)" />
        {!compact &&
          cardinals.map(([t, deg]) => {
            const a = (deg * Math.PI) / 180;
            const r = R - 36 * u;
            return (
              <text
                key={t}
                x={c + Math.cos(a) * r}
                y={c + Math.sin(a) * r + 3}
                textAnchor="middle"
                fontSize={11}
                fill="var(--ink-5)"
                letterSpacing="0.06em"
                style={{ fontFamily: "var(--font-mono)" }}
              >
                {t}
              </text>
            );
          })}
      </svg>

      <div
        className="absolute inset-0 flex flex-col items-center justify-center"
        style={{ gap: compact ? 3 : 5 }}
      >
        <div
          className="whitespace-nowrap text-text-label"
          style={{ fontSize: 11, letterSpacing: "0.18em" }}
        >
          {label}
        </div>
        <div
          className="font-semibold tabular-nums"
          style={{
            fontSize: 20,
            lineHeight: 1,
            letterSpacing: "-0.01em",
            color: dead ? "var(--ink-4)" : "var(--ink-1)",
          }}
        >
          {value}
        </div>
        <div
          style={{
            width: compact ? 40 : 60,
            height: 1,
            background: "var(--line-panel)",
            margin: compact ? "1px 0" : "3px 0",
          }}
        />
        <div
          className="whitespace-nowrap text-text-caption"
          style={{ fontSize: 11, letterSpacing: "0.1em" }}
        >
          {sub} <span className="text-text-label">{subValue}</span>
        </div>
        {live ? (
          <div
            className="mt-1 flex items-center gap-1"
            style={{ fontSize: 11, letterSpacing: "0.14em", color: "var(--accent)" }}
          >
            <StatusDot state="live" size={compact ? 4 : 6} beat />
            {liveLabel}
          </div>
        ) : null}
      </div>

      {/* The core interrupts its loop for exactly one flare when a charge
          lands: a single accent ring that washes out and is gone. */}
      {flare ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute rounded-full border"
          style={{
            left: "50%",
            top: "50%",
            width: 18 * u,
            height: 18 * u,
            marginLeft: -9 * u,
            marginTop: -9 * u,
            borderColor: "var(--accent)",
            animation: "ns-value-flash var(--dur-quick) var(--ease-out) 120ms forwards",
          }}
        />
      ) : null}
    </div>
  );
}
