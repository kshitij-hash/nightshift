// The instrument as a bench panel: the dial, an engraved readout bank, and
// the plate that states what the last autonomous charge did.

import NumberFlow from "@number-flow/react";

import { fmtBlock, fmtStrk, SECONDS_PER_BLOCK, VOYAGER_TX } from "../../config";
import type { Charge } from "../../lib/board";
import { clamp01, hms, utcStamp, utcTime } from "./derive";
import type { WindowInfo } from "./derive";
import { Heartbeat } from "./heartbeat";
import { Readout } from "./primitives";

export type BoardMode = "live" | "snapshot" | "demo";

export type InstrumentPanelProps = {
  mode: BoardMode;
  /** Unix seconds. Frozen at the snapshot timestamp in snapshot mode. */
  now: number;
  headBlock: number;
  lastCharge: Charge | null;
  window: WindowInfo;
  lagBlocks: number | null;
  /** Replay countdown in seconds, demo mode only. */
  replaySecs: number | null;
  replayProgress: number;
  flare: boolean;
  size: number;
};

function dialState(p: InstrumentPanelProps) {
  if (p.mode === "demo") {
    return {
      progress: clamp01(p.replayProgress),
      value: hms(p.replaySecs ?? 0),
      label: "T- NEXT REPLAY",
      sub: "REPLAY STEP",
      subValue: "SCRIPTED",
      dead: false,
    };
  }
  if (p.mode === "snapshot") {
    return {
      progress: 1,
      value: "·:·:·",
      label: "READ STOPPED",
      sub: "SNAPSHOT BLOCK",
      subValue: fmtBlock(p.headBlock),
      dead: true,
    };
  }
  if (p.window.block === null || p.window.ts === null || p.window.periodSecs === null) {
    return {
      progress: 1,
      value: "·:·:·",
      label: p.window.complete ? "SCHEDULE COMPLETE" : "NO WINDOW AHEAD",
      sub: "PERIODS CHARGED",
      subValue: p.window.complete ? "ALL" : "UNKNOWN",
      dead: true,
    };
  }
  const tMinus = Math.max(0, p.window.ts - p.now);
  return {
    progress: clamp01((p.window.periodSecs - tMinus) / p.window.periodSecs),
    value: hms(tMinus),
    label: p.window.overdue ? "WINDOW OPEN NOW" : "T- NEXT WINDOW",
    sub: "OPENS AT BLOCK",
    subValue: fmtBlock(p.window.block),
    dead: false,
  };
}

export function InstrumentPanel(props: InstrumentPanelProps) {
  const { mode, now, headBlock, lastCharge, lagBlocks, flare, size } = props;
  const dial = dialState(props);
  const frozen = mode === "snapshot";
  const tPlus = lastCharge ? now - lastCharge.timestamp : 0;
  const lagSecs = lagBlocks === null ? null : Math.round(lagBlocks * SECONDS_PER_BLOCK);

  return (
    <div className="flex flex-col border border-border-panel bg-surface-panel lg:flex-row lg:items-stretch">
      <div className="flex flex-col items-center gap-4 border-b border-border-panel px-6 py-7 lg:border-r lg:border-b-0 lg:px-8">
        <Heartbeat
          size={size}
          progress={dial.progress}
          value={dial.value}
          label={dial.label}
          sub={dial.sub}
          subValue={dial.subValue}
          live={!frozen}
          liveLabel={mode === "demo" ? "DEMO REPLAY" : "VAULT LIVE"}
          dead={dial.dead}
          flare={flare}
        />
        <div className="max-w-[340px] text-center text-[11px] leading-[1.45] tracking-[0.08em] text-text-caption">
          FIG. A · HEARTBEAT · ONE REVOLUTION = ONE PERIOD
          {props.window.periodSecs !== null
            ? ` = ${Math.round(props.window.periodSecs / SECONDS_PER_BLOCK)} BLOCKS`
            : ""}
        </div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex flex-col border-b border-border-panel sm:flex-row">
          <Readout
            label="UTC CLOCK"
            value={lastCharge || !frozen ? `${utcTime(now)} UTC` : "·:·:· UTC"}
            caption={
              frozen
                ? "frozen at the snapshot block"
                : "anchored to the head block timestamp, 1 Hz"
            }
          />
          <div className="h-px w-full self-stretch bg-border-panel sm:h-auto sm:w-px" />
          <Readout
            label="HEAD BLOCK"
            value={<NumberFlow value={headBlock} format={{ useGrouping: true }} />}
            accent
            caption={frozen ? "committed snapshot, not polled" : "last read, refreshed every 60 s"}
          />
          <div className="h-px w-full self-stretch bg-border-panel sm:h-auto sm:w-px" />
          <Readout
            label="T+ SINCE LAST CHARGE"
            value={lastCharge ? hms(tPlus) : "·:·:·"}
            caption={
              lastCharge
                ? `period ${lastCharge.periodIndex} · block ${fmtBlock(lastCharge.block)}`
                : "no charge decoded yet"
            }
          />
        </div>

        <div className="flex flex-1 flex-col gap-3 px-6 py-6 lg:px-8">
          <div className="text-[11px] font-medium tracking-[0.18em] text-text-label">
            LAST AUTONOMOUS CHARGE
          </div>
          {lastCharge ? (
            <>
              <div className="flex flex-wrap items-baseline gap-4">
                <span
                  className="font-semibold tabular-nums text-text-strong"
                  style={{ fontSize: 44, lineHeight: 1.05, letterSpacing: "-0.02em" }}
                >
                  {utcTime(lastCharge.timestamp)}
                </span>
                <span className="text-[14px] text-text-label">UTC · BLOCK</span>
                <span
                  className="font-semibold tabular-nums"
                  style={{ fontSize: 20, color: "var(--accent)" }}
                >
                  {fmtBlock(lastCharge.block)}
                </span>
              </div>
              <p className="max-w-[560px] text-[14px] leading-[1.55] text-text-prose">
                Fired by schedule
                {lagBlocks !== null && lagSecs !== null
                  ? ` ${lagBlocks} blocks after its window opened, about ${lagSecs} s`
                  : ""}
                . Nobody was at a keyboard.
              </p>
              <div className="text-[12px] leading-[1.5] text-text-caption">
                {utcStamp(lastCharge.timestamp)} UTC ·{" "}
                {lastCharge.amountWei !== null ? (
                  <>
                    <span className="text-text-strong">{fmtStrk(lastCharge.amountWei)}</span>
                    <span className="text-text-label"> STRK</span> ·{" "}
                  </>
                ) : null}
                <a href={VOYAGER_TX(lastCharge.txHash)} target="_blank" rel="noreferrer">
                  verify on voyager ↗
                </a>{" "}
                · nullifier consumed · escrow moved to claimable, not to a wallet ·{" "}
                <span className="text-text-label">T+{hms(tPlus)} since</span>
              </div>
            </>
          ) : (
            <p className="max-w-[560px] text-[14px] leading-[1.55] text-text-prose">
              No charge has been decoded from these vaults yet. When one fires it lands here with
              its block, its timestamp and its receipt.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
