// The "fire a real charge" panel, Modernist skin over the same controller the
// old panel ran on (query/useChargePanel). Every state the endpoint can
// answer is designed; nothing here invents a number. The button writes to
// mainnet, which is the whole point, and it writes only when pressed.

import { truncate, VAULT } from "../../config";
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
        copy: "One real mainnet transaction. It moved escrow the subscriber already committed into the creator's claimable balance, and nothing else.",
        mono: `tx ${truncate(state.txHash)}`,
        link: state.voyagerUrl,
      };
    case "not_due":
      return {
        status: "not_due",
        accent: false,
        copy: "The period has not arrived. The schedule was read first, so this never left the process and cost nothing.",
        mono: `next_due_block ${state.nextDueBlock.toLocaleString("en-US")} · eta ${state.etaMinutes} min`,
        link: null,
      };
    case "rate_limited":
      return {
        status: "rate_limited",
        accent: false,
        copy: "One real charge per caller every 15 minutes. A not-due answer does not consume it; only a submit does.",
        mono: `retry_after_s ${state.retryAfterS}`,
        link: null,
      };
    case "budget_exhausted":
      return {
        status: "budget_exhausted",
        accent: false,
        copy: "The daily cap is spent. The counter is per process and persisted, so a restart is not a way to buy more.",
        mono: "HTTP 503 · resets 00:00 UTC",
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
          : "POST /charge";

  return (
    <div>
      <div className="mb-3.5 text-[11px] tracking-[0.1em] uppercase text-ns-accent">
        ▸ Fire a real charge
      </div>

      {closed ? (
        <>
          <p className="mb-4 text-[13.5px] leading-[1.6]">
            charge() is a public entrypoint: anyone may fire a due charge, from
            any account, and the vault holds the rules. From a terminal:
          </p>
          <div className="mb-4 border border-divider bg-panel p-3.5 font-mono text-[11.5px] leading-[1.8] break-all">
            starkli invoke {truncate(VAULT)} charge{" "}
            {commitment ? truncate(commitment) : "<commitment>"}
          </div>
          <p className="mb-0 text-[12.5px] leading-[1.6] text-text-caption">
            The one-press button on this panel opens during demo windows, when
            a funded account submits the charge for you.
          </p>
        </>
      ) : (
        <>
          <p className="mb-4 text-[13.5px] leading-[1.6]">
            charge() is permissionless. Press this and a funded account submits
            one real mainnet transaction. You are not spending anyone's money,
            only its gas, and only if a period is actually due.
          </p>
          <div className="mb-4 font-mono text-[11.5px] leading-[1.8] break-all opacity-70">
            POST /charge
            <br />
            commitment {commitment ? truncate(commitment) : ""}
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
            Whitelisted to one commitment. Nothing in the endpoint can build a
            cancel, a reclaim, a claim or a transfer.
          </div>
          <div>
            {health && health.maxPerDay !== null
              ? `${health.chargesRemainingToday ?? "?"} of ${health.maxPerDay} transactions left this UTC day, persisted across restarts.`
              : "15 minutes per caller, 24 transactions per UTC day, persisted across restarts."}
          </div>
          <div>A not-due answer costs the visitor nothing and never leaves the process.</div>
        </div>
      ) : null}
    </div>
  );
}
