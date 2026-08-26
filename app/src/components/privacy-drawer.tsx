// The "Hidden vs visible" drawer: the privacy model and its honest limits as
// five steps a reader can walk without leaving the page. Static content, one
// overlay, dismissed by the close button, the backdrop, or Escape.
import { useEffect, useState } from "react";

import { cn } from "../lib/utils";

type Step = { title: string; body: React.ReactNode };

const STEPS: Step[] = [
  {
    title: "What stays private",
    body: (
      <>
        <p className="text-[15px] leading-[1.65]">
          Your payment enters through a privacy pool, and what the vault
          records is a subscription — not a wallet. The chain sees that{" "}
          <em>some</em> subscription was charged for <em>some</em> period. It
          cannot connect any charge to the wallet that funded it, because that
          link was cut the moment the escrow passed through the pool.
        </p>
        <div className="mt-5 grid grid-cols-2 border-2 border-divider">
          <div className="p-5">
            <div className="mb-3 text-[11px] tracking-[0.1em] uppercase opacity-55">
              Visible
            </div>
            <div className="font-mono text-[12px] leading-[1.9]">
              your wallet → the pool
              <br />
              like any pool deposit
            </div>
          </div>
          <div className="border-l-2 border-divider bg-panel p-5">
            <div className="mb-3 text-[11px] tracking-[0.1em] uppercase text-ns-accent">
              Hidden
            </div>
            <div className="font-mono text-[12px] leading-[1.9] opacity-75">
              the pool → your subscription
              <br />
              no sender, ever
            </div>
          </div>
        </div>
      </>
    ),
  },
  {
    title: "Charges of one subscription link to each other",
    body: (
      <>
        <p className="text-[15px] leading-[1.65]">
          Every charge of a subscription carries the same public subscription
          id, so anyone can see that period three and period four belong to
          the same subscription. What nobody can see is whose subscription it
          is. This is the price of billing that runs without anyone's help.
        </p>
        <p className="mt-4 text-[15px] leading-[1.65]">
          The creator's side gets the mirror-image protection: when a creator
          withdraws their earnings, that withdrawal reveals nothing about
          which charges it covers or when they fired.
        </p>
      </>
    ),
  },
  {
    title: "Creator earnings are public",
    body: (
      <>
        <p className="text-[15px] leading-[1.65]">
          A creator publishes an id so subscribers can find them, and anyone
          can add up the charges against that id. NIGHTSHIFT hides the
          subscriber, not the creator's totals.
        </p>
        <p className="mt-4 text-[15px] leading-[1.65]">
          Two things soften this. Prices come from a small fixed menu, so an
          observer sees round multiples rather than exact figures. And a
          creator can run several ids and give each audience its own, so no
          single public number is their whole business.
        </p>
      </>
    ),
  },
  {
    title: "The edges are visible by design",
    body: (
      <>
        <p className="text-[15px] leading-[1.65]">
          Money entering the vault and money leaving it are visible, like any
          pool deposit or withdrawal. The privacy lives between those edges.
          The schedule you pick — tier, period, count — is visible too, which
          is exactly why all of them come from a small fixed menu: a schedule
          off a shared menu cannot fingerprint the person who chose it.
        </p>
        <p className="mt-4 text-[15px] leading-[1.65]">
          Cancelling never has to reveal you: the signed cancel works from any
          sender, so a relay can submit it for you. Submit it from your own
          wallet instead and that wallet becomes visible as the sender — your
          choice, stated where you make it.
        </p>
      </>
    ),
  },
  {
    title: "The honest limits",
    body: (
      <>
        <p className="text-[15px] leading-[1.65]">
          An observer watching the timing of pool deposits next to new
          subscriptions can make probabilistic guesses, as with any privacy
          pool. More activity in the pool weakens those guesses. We do not
          claim immunity.
        </p>
        <p className="mt-4 text-[15px] leading-[1.65]">
          And a relay you hand a cancel to learns which subscription is being
          cancelled — that much is already public — but never anything about
          you.
        </p>
        <p className="mt-4 text-[15px] leading-[1.65]">
          Everything above can be checked against the public record by anyone,
          without any key.
        </p>
      </>
    ),
  },
];

export function PrivacyDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [step, setStep] = useState(0);
  // Opening resets to the first step. Derived during render rather than in an
  // effect, so the reset and the paint it governs are the same paint.
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) setStep(0);
  }

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const atStart = step === 0;
  const atEnd = step === STEPS.length - 1;

  return (
    <div
      className="fixed inset-0 z-100 flex justify-end"
      style={{ background: "color-mix(in srgb, var(--m-neutral-900) 55%, transparent)" }}
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Hidden vs visible"
        className="m-in flex h-full w-[min(640px,100%)] flex-col border-l-2 border-neutral-900 bg-ground"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b-2 border-divider px-7 py-5">
          <span className="text-[11px] tracking-[0.14em] uppercase text-ns-accent">
            ▸ Hidden vs visible
          </span>
          <span className="ml-auto text-[11px] tracking-[0.1em] uppercase text-text-caption">
            {step + 1} / {STEPS.length}
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="close"
            className="cursor-pointer pl-2 text-[18px] leading-none text-ink"
          >
            ✕
          </button>
        </div>
        <div className="mt-5 flex gap-1 px-7">
          {STEPS.map((s, i) => (
            <button
              key={s.title}
              type="button"
              aria-label={`step ${i + 1}`}
              onClick={() => setStep(i)}
              className={cn("h-1 flex-1 cursor-pointer", i <= step ? "bg-ns-accent" : "bg-neutral-300")}
            />
          ))}
        </div>
        <div className="flex-1 overflow-auto p-7">
          <h3 className="mb-4 text-[29px] tracking-[-0.03em]">{STEPS[step]!.title}</h3>
          {STEPS[step]!.body}
        </div>
        <div className="flex gap-2.5 border-t-2 border-divider px-7 py-5">
          <button
            type="button"
            className="m-btn m-btn-secondary"
            disabled={atStart}
            onClick={() => setStep((n) => Math.max(0, n - 1))}
          >
            ← Back
          </button>
          <button
            type="button"
            className="m-btn m-btn-primary ml-auto"
            onClick={() => (atEnd ? onClose() : setStep((n) => n + 1))}
          >
            {atEnd ? "Close" : "Next →"}
          </button>
        </div>
      </div>
    </div>
  );
}
