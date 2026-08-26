// The "fire a real charge" panel, Modernist skin over the same controller the
// old panel ran on (query/useChargePanel). Every state the endpoint can
// answer is designed; nothing here invents a number. The button writes to
// mainnet, which is the whole point, and it writes only when pressed.

import { truncate } from "../../config";
import type { ChargeState } from "../../query/useChargePanel";
import { useChargePanel } from "../../query/useChargePanel";

function stateCopy(state: ChargeState): {
  status: string;
  accent: boolean;
  copy: string;
  mono: string | null;
  link: string | null;
} | null {
  switch (state.tag) {
    case "submitted":
      return {
        status: "submitted",
        accent: true,
        copy: "One real mainnet transaction. It moved escrow the subscriber already committed into the creator's balance, and nothing else.",
        mono: `tx ${truncate(state.txHash)}`,
        link: state.voyagerUrl,
      };
    case "not_due":
      return {
        status: "not due yet",
        accent: false,
        copy: "The next period has not arrived, so there is nothing to charge and nothing was sent.",
        mono: `due at block ${state.nextDueBlock.toLocaleString("en-US")} · ≈ ${state.etaMinutes} min`,
        link: null,
      };
    case "rate_limited":
      return {
        status: "one at a time",
        accent: false,
        copy: "One real charge per visitor every 15 minutes.",
        mono: `try again in ${state.retryAfterS}s`,
        link: null,
      };
    case "budget_exhausted":
      return {
        status: "done for today",
        accent: false,
        copy: "Today's charge budget is spent. It resets at 00:00 UTC.",
        mono: null,
        link: null,
      };
    case "error":
      return {
        status: "error",
        accent: false,
        copy: state.reason,
        mono: null,
        link: null,
      };
    default:
      return null;
  }
}

export function ChargePanelM({
  commitment,
  onSubmitted,
}: {
  commitment: string | null;
  onSubmitted?: (txHash: string) => void;
}) {
  const { state, health, secondsLeft, canPress, press } = useChargePanel(
    commitment,
    onSubmitted,
  );

  const closed = state.tag === "closed" || commitment === null;
  const result = stateCopy(state);

  const label =
    state.tag === "submitting"
      ? "Submitting…"
      : state.tag === "probing"
        ? "Checking the window…"
        : secondsLeft !== null
          ? `Locked · ${secondsLeft}s`
          : "Fire the charge";

  return (
    <div>
      <div className="mb-3.5 text-[11px] tracking-[0.1em] uppercase text-ns-accent">
        ▸ Fire a real charge
      </div>

      {closed ? (
        <>
          <p className="mb-4 text-[13.5px] leading-[1.6]">
            Charging is open: when a period is due, anyone can trigger it, and
            the vault enforces every rule. That is how a subscription here runs
            with nobody in charge of it.
          </p>
          <p className="mb-0 text-[12.5px] leading-[1.6] text-text-caption">
            The one-press button on this panel opens during demo windows, when
            a funded account submits the charge for you.
          </p>
        </>
      ) : (
        <>
          <p className="mb-4 text-[13.5px] leading-[1.6]">
            Charging is open to anyone. Press this and a funded account submits
            one real mainnet transaction that bills the due period — nothing
            moves unless a period is actually due, and nothing of yours is
            spent.
          </p>
          <div className="mb-4 font-mono text-[11.5px] leading-[1.8] break-all opacity-70">
            subscription {commitment ? truncate(commitment) : ""}
          </div>
          <button
            type="button"
            className="m-btn m-btn-primary m-btn-block justify-between"
            style={{ padding: "14px 18px" }}
            disabled={!canPress}
            onClick={press}
          >
            <span>{label}</span>
            <span aria-hidden="true">→</span>
          </button>

          {result ? (
            <div
              className="m-in mt-4 border-2 p-4"
              style={{
                borderColor: result.accent ? "var(--m-accent)" : "var(--m-accent-400)",
              }}
            >
              <div
                className="mb-2.5 text-[11px] tracking-[0.1em] uppercase"
                style={{ color: result.accent ? "var(--m-accent)" : "var(--m-accent-700)" }}
              >
                {result.status}
              </div>
              <div className="mb-2.5 text-[13px] leading-[1.55]">{result.copy}</div>
              {result.mono ? (
                <div className="font-mono text-[11.5px] leading-[1.7] break-all opacity-70">
                  {result.mono}
                  {result.link ? (
                    <>
                      {" · "}
                      <a href={result.link} target="_blank" rel="noreferrer">
                        voyager ↗
                      </a>
                    </>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}
        </>
      )}

      {!closed ? (
        <div className="mt-5 flex flex-col gap-2 border-t border-divider pt-4 text-[12.5px] text-text-label">
          <div>
            This button can only trigger a charge for the demo subscription —
            it cannot cancel, refund, or move anything else.
          </div>
          <div>
            {health && health.maxPerDay !== null
              ? `${health.chargesRemainingToday ?? "?"} of ${health.maxPerDay} charges left today.`
              : "One per visitor every 15 minutes, 24 per day."}
          </div>
        </div>
      ) : null}
    </div>
  );
}
