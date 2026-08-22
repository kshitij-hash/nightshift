// The two verdicts. Neither is an afterthought.
//
// Motion, per the design system's verify rows: the check path draws over
// 300ms, the color settles over 150ms, the badge scales 0.98 to 1 over 150ms,
// and there is no bounce. Failure swaps color and text over 150ms with no
// shake and no red page. Under reduced motion the mark is drawn already and
// only the color transition survives.

import { useEffect, useRef, useState } from "react";

import { fmtBlock, truncate, VOYAGER_CONTRACT, VAULT } from "../../config";
import { cn } from "../../lib/utils";
import { REASONS } from "../../lib/verify";
import type { Reason, Verdict } from "../../lib/verify";
import { usePrefersReducedMotion } from "../board/use-clock";
import { HashCopy, StatusDot } from "../board/primitives";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { KeyValue } from "./step";
import { reasonNote } from "./reasons";

/** The check inside the VERIFIED badge, drawn once on mount. */
function CheckMark({ size = 12 }: { size?: number }) {
  const still = usePrefersReducedMotion();
  // Reduced motion starts drawn, so nothing animates and nothing re-renders.
  const [drawn, setDrawn] = useState(still);
  useEffect(() => {
    if (still) return;
    const id = requestAnimationFrame(() => setDrawn(true));
    return () => cancelAnimationFrame(id);
  }, [still]);
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 18 18"
      fill="none"
      aria-hidden="true"
      className="shrink-0"
    >
      <path
        d="M3 9.5 L7 13.5 L15 4.5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="square"
        pathLength={100}
        strokeDasharray={100}
        strokeDashoffset={drawn ? 0 : 100}
        style={
          still
            ? undefined
            : { transition: "stroke-dashoffset 300ms var(--ease-out)" }
        }
      />
    </svg>
  );
}

/** The accent's one filled moment on this surface. */
function VerifiedBadge() {
  const still = usePrefersReducedMotion();
  const [settled, setSettled] = useState(still);
  useEffect(() => {
    if (still) return;
    const id = requestAnimationFrame(() => setSettled(true));
    return () => cancelAnimationFrame(id);
  }, [still]);
  return (
    <Badge
      variant="verified"
      className="gap-1.5 px-3.5 py-[7px] text-[12px]"
      style={{
        transform: settled ? "scale(1)" : "scale(0.98)",
        opacity: settled ? 1 : 0.85,
        transition: still
          ? "opacity 100ms linear"
          : "transform 150ms var(--ease-out), opacity 150ms var(--ease-out)",
      }}
    >
      <CheckMark />
      VERIFIED
    </Badge>
  );
}

function CopyReason({ reason }: { reason: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );
  return (
    <Button
      variant="ghost"
      size="md"
      className="min-h-11 md:min-h-8"
      onClick={() => {
        void navigator.clipboard?.writeText(reason);
        setCopied(true);
        if (timer.current !== null) window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? "COPIED" : "COPY REASON"}
    </Button>
  );
}

export function SuccessVerdict({
  verdict,
  commitment,
  headBlock,
  onAgain,
}: {
  verdict: Verdict;
  commitment: string;
  headBlock: number | null;
  onAgain: () => void;
}) {
  const creator = verdict.creatorId ?? "0x0";
  // The filled badge is the accent's one moment here, so the panel around it
  // stays on the hairline. Two accent rectangles side by side would spend the
  // accent on grouping, which section 5 reserves for spacing to do.
  return (
    <div className="flex flex-col gap-4 border border-border-panel bg-surface-panel px-5 py-5">
      <div className="flex flex-wrap items-center gap-4">
        <VerifiedBadge />
        <span className="text-[12px] text-text-caption">
          {headBlock === null
            ? "checked against vault state"
            : `checked against vault state at block ${fmtBlock(headBlock)}`}
        </span>
      </div>
      <KeyValue
        rows={[
          [
            "creator",
            <HashCopy
              key="c"
              value={creator}
              display={truncate(creator)}
              tone="strong"
              className="min-h-11 md:min-h-6"
            />,
          ],
          ["tier", <span key="t">{verdict.tier}</span>],
          [
            "commitment",
            <HashCopy
              key="k"
              value={commitment}
              display={truncate(commitment)}
              tone="strong"
              className="min-h-11 md:min-h-6"
            />,
          ],
          [
            "vault",
            <a key="v" href={VOYAGER_CONTRACT(VAULT)} target="_blank" rel="noreferrer">
              {truncate(VAULT)} ↗
            </a>,
          ],
          ["reads", <span key="r">schedule_of, owner_key_of. Two view calls, no write.</span>],
        ]}
      />
      <p className="text-[12px] leading-[1.6] text-text-caption">
        The signature checks against the owner key the vault recorded for this commitment, the
        commitment holds tier {verdict.tier} at this creator, and the challenge has not expired.
        That is the whole claim. It does not say who signed.
      </p>
      <div className="flex flex-wrap gap-3">
        <Button variant="ghost" size="md" className="min-h-11 md:min-h-8" onClick={onAgain}>
          CHECK ANOTHER PRESENTATION
        </Button>
      </div>
    </div>
  );
}

export function FailureVerdict({
  reason,
  headBlock,
  onAgain,
  onRetry,
}: {
  reason: Reason;
  headBlock: number | null;
  onAgain: () => void;
  onRetry: () => void;
}) {
  const note = reasonNote(reason);
  const isRpc = reason === REASONS.RPC_ERROR;
  return (
    <div className="flex flex-col gap-4 border border-border-panel bg-surface-panel px-5 py-5">
      <div className="flex flex-wrap items-center gap-4">
        <Badge
          variant="outline"
          className="border-destructive px-3.5 py-[7px] text-[12px] text-destructive"
          style={{ transition: "color 150ms var(--ease-out), border-color 150ms var(--ease-out)" }}
        >
          {isRpc ? "NOT CHECKED" : "FAILED"}
        </Badge>
        <span className="text-[12px] text-text-caption">
          {isRpc
            ? "the vault was never read, so this is not a verdict about the subscription"
            : headBlock === null
              ? "checked against vault state"
              : `checked against vault state at block ${fmtBlock(headBlock)}`}
        </span>
      </div>

      <div className="flex flex-col gap-2 border border-destructive px-4 py-3.5">
        <div className="text-[11px] font-medium tracking-[0.14em] text-text-label">
          REASON, AS RETURNED
        </div>
        <div
          className="text-[13px] leading-[1.6] break-all text-destructive"
          style={{ transition: "color 150ms var(--ease-out)" }}
        >
          {reason}
        </div>
        {note ? (
          <p className="text-[12px] leading-[1.55] text-text-caption">
            {note.meaning}
            {note.fix ? ` ${note.fix}` : ""}
          </p>
        ) : null}
      </div>

      <p className="text-[12.5px] leading-[1.6] text-text-prose">
        {isRpc
          ? "Nothing was decided. Every configured endpoint failed before the vault answered, so the check has no result to report either way."
          : "A failure here is not a fault in the page. It is the honest answer this vault gives for this commitment right now, and a gate should refuse access in exactly these words."}
      </p>

      <div className="flex flex-wrap gap-3">
        {isRpc ? (
          <Button variant="outline" size="md" className="min-h-11 md:min-h-8" onClick={onRetry}>
            RETRY THE READ
          </Button>
        ) : null}
        <Button variant="ghost" size="md" className="min-h-11 md:min-h-8" onClick={onAgain}>
          PASTE ANOTHER PRESENTATION
        </Button>
        <CopyReason reason={reason} />
      </div>
    </div>
  );
}

/** The live-state readout beside the verify control. Wired to real state only. */
export function VerifyStatus({
  phase,
  verdict,
}: {
  phase: "idle" | "validating" | "checking" | "done";
  verdict: Verdict | null;
}) {
  const label =
    phase === "validating"
      ? "VALIDATING"
      : phase === "checking"
        ? "READING VAULT STATE"
        : phase === "done" && verdict !== null
          ? verdict.ok
            ? "VERIFIED"
            : verdict.reason === REASONS.RPC_ERROR
              ? "NOT CHECKED"
              : "FAILED"
          : "IDLE";
  const state =
    phase === "checking" || phase === "validating"
      ? "live"
      : phase === "done" && verdict !== null
        ? verdict.ok
          ? "settled"
          : "fail"
        : "pending";
  return (
    <span className="inline-flex items-center gap-2 text-[11px] tracking-[0.14em] whitespace-nowrap text-text-label">
      <StatusDot state={state} size={6} beat={state === "live"} />
      <span className={cn(state === "fail" && "text-destructive")}>{label}</span>
    </span>
  );
}
