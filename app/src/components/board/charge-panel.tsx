// The tier-2 charge panel: the one place on this page that writes.
//
// Everything above it reads the chain. This panel asks a rate-limited demo
// account to call charge() on the subscription the board is watching, and then
// renders whatever the endpoint answers, in its own words. Nine answers, one
// rectangle: the frame, the header and the target block never move, and only
// the body under them swaps. READY and SUBMITTING carry the accent border;
// every refusal is gray and collapsed to a line, because a refusal is normal
// and the anomaly is what gets to be loud.
//
// No state here says "try again later" without a number. Each refusal names
// the block, the countdown or the balance that caused it, and each one points
// at the path that still works when this page does not: charge() is a plain
// public entrypoint, so anyone can call it from a terminal.

import { fmtBlock, fmtStrk, truncate, VAULT } from "../../config";
import { cn } from "../../lib/utils";
import type { ChargeHealth, ChargeState } from "../../query/useChargePanel";
import { useChargePanel } from "../../query/useChargePanel";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { hms } from "./derive";
import { Cap, CaveatDisclosure, HashCopy, SectionHead, StatusDot } from "./primitives";
import { usePrefersReducedMotion } from "./use-clock";

/** The state tag each answer wears, in the label register. */
const TAG: Record<ChargeState["tag"], string> = {
  probing: "CHECKING",
  closed: "DEMO WINDOW CLOSED",
  ready: "READY",
  submitting: "SUBMITTING",
  submitted: "CHARGED",
  not_due: "NOT DUE",
  rate_limited: "RATE LIMITED",
  budget_exhausted: "BUDGET EXHAUSTED",
  error: "ERROR",
};

const pad2 = (n: number) => String(n).padStart(2, "0");
/** mm:ss for the sub-hour countdowns; anything longer keeps its hours. */
const mmss = (secs: number) => (secs >= 3600 ? hms(secs) : hms(secs).slice(3));

/** True only when both addresses parse and differ. A felt can be written with
 *  or without leading zeros, so they are compared as numbers, not as text. */
function differs(a: string, b: string): boolean {
  try {
    return BigInt(a) !== BigInt(b);
  } catch {
    return false;
  }
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="text-[11px] leading-[1.45] tracking-[0.14em] text-text-caption">
        {label}
      </span>
      <span className="text-[13px] tabular-nums text-text-strong">{children}</span>
    </div>
  );
}

/**
 * The sanctioned in-flight indicator: a dashed ring at 1s linear, the same one
 * the wallet flows use. Reduced motion drops it for the word, per the motion
 * table's fallback column, rather than leaving a stopped ring on screen.
 */
function DashIndicator({ still }: { still: boolean }) {
  if (still) return <Cap>in flight</Cap>;
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      aria-hidden="true"
      className="shrink-0"
      style={{ animation: "ns-spin 1s linear infinite" }}
    >
      <circle
        cx="6"
        cy="6"
        r="4.5"
        fill="none"
        stroke="var(--accent)"
        strokeWidth="1.5"
        strokeDasharray="8 20"
        strokeLinecap="butt"
      />
    </svg>
  );
}

/** What the press would charge. Present in every state that has not spent its
 *  target yet, and never re-laid-out between them. */
function Target({
  commitment,
  perPeriodWei,
  windowBlock,
  health,
}: {
  commitment: string | null;
  perPeriodWei: bigint | null;
  windowBlock: number | null;
  health: ChargeHealth | null;
}) {
  return (
    <dl className="grid grid-cols-2 gap-x-8 gap-y-4 md:flex md:flex-wrap md:gap-x-10">
      <div className="col-span-2 md:col-auto">
        <Field label="COMMITMENT">
          {commitment ? (
            <HashCopy value={commitment} display={truncate(commitment)} tone="strong" />
          ) : (
            <span className="text-text-caption">no live subscription was read</span>
          )}
        </Field>
      </div>
      <Field label="AMOUNT">
        {perPeriodWei !== null ? (
          <>
            {fmtStrk(perPeriodWei)}
            <span className="text-text-label"> STRK</span>
          </>
        ) : (
          <span className="text-text-caption">not in the event</span>
        )}
      </Field>
      <Field label="WINDOW OPENS">
        {windowBlock !== null ? (
          <>
            block {fmtBlock(windowBlock)}
          </>
        ) : (
          <span className="text-text-caption">no schedule was read</span>
        )}
      </Field>
      <Field label="CHARGES LEFT TODAY">
        {health && health.chargesRemainingToday !== null && health.maxPerDay !== null ? (
          <>
            {health.chargesRemainingToday} of {health.maxPerDay}
          </>
        ) : (
          <span className="text-text-caption">not answered</span>
        )}
      </Field>
    </dl>
  );
}

/**
 * A refusal is normal, so it is collapsed: the header row already carries the
 * state tag, and what is left is one line, the button that says the same thing
 * a second time because it is the thing being pressed, and a "why" that opens
 * the full account with the target it would have charged.
 *
 * The four refusals share this shape. READY, SUBMITTING, CHARGED and REFUSED
 * stay open, because each of those is a moment a reader is inside.
 */
function Refusal({
  line,
  button,
  why,
}: {
  line: React.ReactNode;
  button: React.ReactNode;
  why: React.ReactNode;
}) {
  return (
    <>
      <p className="max-w-[68ch] text-[13px] leading-[1.6] text-text-prose">{line}</p>
      {button}
      <CaveatDisclosure label="why" openLabel="why, shown">
        <span className="flex flex-col gap-3">{why}</span>
      </CaveatDisclosure>
    </>
  );
}

export function ChargePanel({
  commitment,
  nextPeriod,
  perPeriodWei,
  windowBlock,
  onSubmitted,
}: {
  commitment: string | null;
  /** The next period index the vault will charge, for the panel's header. */
  nextPeriod: number | null;
  perPeriodWei: bigint | null;
  windowBlock: number | null;
  /** Called once with the tx hash when a charge is accepted, so the board can
   *  refresh its own reads and run the arrival choreography it already owns. */
  onSubmitted?: (txHash: string) => void;
}) {
  const { state, health, secondsLeft, canPress, press } = useChargePanel(commitment, onSubmitted);
  const still = usePrefersReducedMotion();

  const live = health?.signer === "starknet";
  const vault = health?.vault ?? VAULT;
  const wrongVault = health?.vault != null && differs(health.vault, VAULT);
  const maxPerDay = health?.maxPerDay ?? null;
  const accent = state.tag === "ready" || state.tag === "submitting";
  const target = (
    <Target
      commitment={commitment}
      perPeriodWei={perPeriodWei}
      windowBlock={windowBlock}
      health={health}
    />
  );
  // 150ms cross-fade on the body only. ns-row-in is the token file's entrance
  // keyframe (opacity plus a 4px settle) and the styles/ directory is outside
  // this change, so it is reused rather than a third keyframe added.
  const fade = still ? undefined : "ns-row-in var(--dur-quick) var(--ease-out)";

  return (
    <section aria-labelledby="charge-panel-head" className="flex flex-col gap-3">
      <SectionHead note="one panel, nine honest answers">
        <span id="charge-panel-head">// TIER-2 CHARGE</span>
      </SectionHead>

      <div
        data-charge-state={state.tag}
        className={cn(
          "flex flex-col gap-4 border bg-surface-sunken px-5 py-4 lg:px-6",
          accent ? "border-ns-accent" : "border-border-panel",
        )}
      >
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-border-row pb-3">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-[11px] font-medium tracking-[0.18em] text-text-label">
              CHARGE {nextPeriod !== null ? `· PERIOD ${pad2(nextPeriod)}` : ""}
            </span>
            <Badge variant={state.tag === "submitted" ? "verified" : "outline"}>
              {TAG[state.tag]}
            </Badge>
          </div>
          <Cap>
            vault <HashCopy value={vault} display={truncate(vault)} className="text-[11px]" />
          </Cap>
        </div>

        <div
          key={state.tag}
          role="status"
          aria-live="polite"
          className="flex flex-col gap-4"
          style={{ animation: fade }}
        >
          {state.tag === "probing" ? (
            <>
              {target}
              <p className="max-w-[68ch] text-[13px] leading-[1.6] text-text-prose">
                Reading the demo endpoint&apos;s health check. It answers with the signer it is
                running, the vault it is pointed at, and how many charges are left in today&apos;s
                cap.
              </p>
              <Button variant="ghost" size="md" disabled className="min-h-11 md:min-h-8">
                CHECKING THE DEMO ENDPOINT
              </Button>
            </>
          ) : null}

          {state.tag === "ready" ? (
            <>
              {target}
              <p className="max-w-[68ch] text-[13px] leading-[1.6] text-text-prose">
                {commitment === null
                  ? "The endpoint is open, but this page read no live subscription to charge, so there is nothing to press for. The vault read above says why."
                  : live
                    ? "Pressing this fires a real transaction on Starknet mainnet. It is signed by a rate-limited demo account, not by you, and no wallet is asked for. charge() is a plain public entrypoint: the vault checks the window and the period nullifier before anything moves, and the value that moves is escrow the subscriber already committed."
                    : "This endpoint is running its mock signer, so a press does not reach mainnet and nothing it answers is a real receipt. The wiring below is the same either way."}
              </p>
              <div className="flex flex-wrap items-center gap-4">
                <Button
                  size="md"
                  onClick={press}
                  disabled={!canPress}
                  className="min-h-11 md:min-h-8"
                >
                  {canPress ? "FIRE THE NEXT CHARGE" : "NO COMMITMENT TO CHARGE"}
                </Button>
                <Cap>
                  gas is paid by the demo account · the subscriber is not asked · the cap is{" "}
                  {maxPerDay ?? "a fixed number of"} charges per UTC day
                </Cap>
              </div>
            </>
          ) : null}

          {state.tag === "submitting" ? (
            <>
              {target}
              <div className="flex items-center gap-2">
                <StatusDot state="live" size={7} beat />
                <span className="text-[11px] font-medium tracking-[0.18em] text-ns-accent">
                  SUBMITTING
                </span>
                <DashIndicator still={still} />
              </div>
              <p className="max-w-[68ch] text-[13px] leading-[1.6] text-text-prose">
                The press is with the endpoint. It estimates the fee, invokes once, and answers
                with a transaction hash or a refusal. There is no progress bar because this page
                does not know how long L2 will take.
              </p>
              <Button variant="ghost" size="md" disabled className="min-h-11 md:min-h-8">
                SUBMITTING…
              </Button>
              <Cap>the button is disabled, not hidden · the reader keeps their place</Cap>
            </>
          ) : null}

          {state.tag === "submitted" ? (
            <>
              <dl className="grid grid-cols-1 gap-x-10 gap-y-4 md:flex md:flex-wrap">
                <Field label="TRANSACTION">
                  <HashCopy
                    value={state.txHash}
                    display={truncate(state.txHash)}
                    tone="strong"
                  />
                </Field>
                <Field label="RECEIPT">
                  <a
                    href={state.voyagerUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex min-h-6 items-center text-[13px]"
                  >
                    verify on voyager ↗
                  </a>
                </Field>
              </dl>
              <p className="max-w-[68ch] text-[13px] leading-[1.6] text-text-prose">
                A real charge just landed. The feed above picks the event up on its next read and
                the row arrives there; this panel is only the receipt of the call you made.
              </p>
              <div className="flex flex-wrap items-center gap-4">
                <Button
                  variant="outline"
                  size="md"
                  onClick={press}
                  disabled={!canPress}
                  className="min-h-11 md:min-h-8"
                >
                  CHARGE THE NEXT PERIOD
                </Button>
                <Cap>
                  the next period is almost certainly not due yet, and the endpoint will say so
                </Cap>
              </div>
            </>
          ) : null}

          {state.tag === "not_due" ? (
            <Refusal
              line={
                <>
                  Nothing is due. Come back in about{" "}
                  <span className="tabular-nums">{state.etaMinutes}</span> min, at block{" "}
                  <span className="tabular-nums">{fmtBlock(state.nextDueBlock)}</span>.
                </>
              }
              button={
                <Button variant="ghost" size="md" disabled className="min-h-11 md:min-h-8">
                  <span className="tabular-nums">
                    NOT DUE FOR {hms(secondsLeft ?? state.etaMinutes * 60)}
                  </span>
                </Button>
              }
              why={
                <>
                  {target}
                  <span className="block max-w-[68ch] text-[13px] leading-[1.6] text-text-prose">
                    Charging early is not slow, it is impossible: the vault reverts NS_NOT_DUE
                    before the period arrives.
                  </span>
                  <Cap>
                    the eta is an estimate at about 1.7 s per block · the charge itself is
                    block-gated, not clock-gated
                  </Cap>
                </>
              }
            />
          ) : null}

          {state.tag === "rate_limited" ? (
            <Refusal
              line={
                <>
                  The demo endpoint rate-limited this browser, not the vault. It spaces one
                  visitor&apos;s real charges out by{" "}
                  <span className="tabular-nums">{state.retryAfterS}</span> s.
                </>
              }
              button={
                <Button variant="ghost" size="md" disabled className="min-h-11 md:min-h-8">
                  <span className="tabular-nums">
                    RETRY IN {mmss(secondsLeft ?? state.retryAfterS)}
                  </span>
                </Button>
              }
              why={
                <>
                  {target}
                  <span className="block max-w-[68ch] text-[13px] leading-[1.6] text-text-prose">
                    The spacing is what keeps a flood from draining the account. The charge stays
                    permissionless: anyone can call it from a terminal right now.
                  </span>
                  <Cap>
                    the countdown ticks at 1 Hz and re-opens the button at zero · nothing retries on
                    its own
                  </Cap>
                </>
              }
            />
          ) : null}

          {state.tag === "budget_exhausted" ? (
            <Refusal
              line="The demo account has spent its cap for this UTC day. The cap resets at 00:00 UTC."
              button={
                <Button variant="ghost" size="md" disabled className="min-h-11 md:min-h-8">
                  NO CHARGES LEFT TODAY
                </Button>
              }
              why={
                <>
                  <dl className="grid grid-cols-2 gap-x-10 gap-y-4 md:flex md:flex-wrap">
                    <Field label="DAILY CAP">
                      {maxPerDay !== null ? (
                        <>{maxPerDay} charges per UTC day</>
                      ) : (
                        "a fixed number of charges per UTC day"
                      )}
                    </Field>
                    <Field label="LEFT TODAY">0</Field>
                    <Field label="CAP RESETS">00:00 UTC</Field>
                  </dl>
                  <span className="block max-w-[68ch] text-[13px] leading-[1.6] text-text-prose">
                    The cap is what keeps a public button from draining the account: the counter is
                    per process and survives a restart, so pressing more times, from more browsers,
                    cannot buy another charge. The vault is unchanged and the keeper still charges
                    on schedule.
                  </span>
                </>
              }
            />
          ) : null}

          {state.tag === "closed" ? (
            <Refusal
              line="DEMO WINDOW CLOSED. The endpoint runs during demos. charge() stays a public entrypoint and anyone can call it from a terminal."
              button={
                <Button variant="ghost" size="md" disabled className="min-h-11 md:min-h-8">
                  DEMO WINDOW CLOSED
                </Button>
              }
              why={
                <>
                  {target}
                  <span className="block max-w-[68ch] text-[13px] leading-[1.6] text-text-prose">
                    The endpoint behind this button runs during demos and recordings, and this page
                    is not talking to one right now, so the button is off. The receipts on this page
                    are how it behaves when it is open. The vault has not changed: the window above
                    opens at its block.
                  </span>
                  <Cap>
                    {state.reason === "unconfigured"
                      ? "this build has no charge endpoint configured"
                      : "the endpoint did not answer its health check"}{" "}
                    ·{" "}
                    <a
                      href="https://github.com/kshitij-hash/nightshift/tree/main/demo-charge"
                      target="_blank"
                      rel="noreferrer"
                    >
                      the endpoint, and what it can and cannot do ↗
                    </a>
                  </Cap>
                </>
              }
            />
          ) : null}

          {state.tag === "error" ? (
            <>
              {target}
              <div className="flex items-center gap-2">
                <StatusDot state="fail" size={7} />
                <span className="text-[11px] font-medium tracking-[0.18em] text-destructive">
                  REFUSED
                </span>
              </div>
              <p className="max-w-[68ch] text-[13px] leading-[1.6] text-text-prose">
                The endpoint refused this press. Its reason, in its own words:{" "}
                <span className="text-destructive">{state.reason}</span>
              </p>
              <div className="flex flex-wrap items-center gap-4">
                <Button
                  variant="outline"
                  size="md"
                  onClick={press}
                  disabled={!canPress}
                  className="min-h-11 md:min-h-8"
                >
                  TRY AGAIN
                </Button>
                <Cap>
                  the retry is one press, not a loop · the vault&apos;s own asserts are the reasons
                  worth reading
                </Cap>
              </div>
            </>
          ) : null}
        </div>

        {wrongVault ? (
          <Cap className="text-destructive">
            the endpoint is pointed at a different vault than this page reads
          </Cap>
        ) : null}
        {health !== null && !live ? (
          <Cap>
            this endpoint reports the {health.signer} signer, so nothing it answers reaches mainnet
          </Cap>
        ) : null}
      </div>
    </section>
  );
}
