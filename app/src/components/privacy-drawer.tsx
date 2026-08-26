// The "Hidden vs visible" drawer: PRIVACY.md's model and limitations as five
// steps a reader can walk without leaving the page. Static content, one
// overlay, dismissed by the close button, the backdrop, or Escape.
import { useEffect, useState } from "react";

import { cn } from "../lib/utils";

type Step = { title: string; body: React.ReactNode };

const MONO = "font-mono text-[13px]";

const STEPS: Step[] = [
  {
    title: "The model in one paragraph",
    body: (
      <>
        <p className="text-[15px] leading-[1.65]">
          A subscriber commits escrow into the vault through a private pool
          action. The on-chain record of that commitment is a single Poseidon
          hash; the secret behind it never leaves the subscriber's machine.
          Each billing period, a charge consumes a write-once nullifier{" "}
          <span className={MONO}>poseidon(commitment, period_index)</span>. The
          chain sees that <em>some</em> subscription was charged for{" "}
          <em>some</em> period. It cannot connect any charge to the address
          that funded the escrow.
        </p>
        <div className="mt-5 grid grid-cols-2 border-2 border-divider">
          <div className="p-5">
            <div className="mb-3 text-[11px] tracking-[0.1em] uppercase opacity-55">
              Public
            </div>
            <div className="font-mono text-[12px] leading-[1.9]">
              wallet → pool
              <br />
              a visible edge
            </div>
          </div>
          <div className="border-l-2 border-divider bg-panel p-5">
            <div className="mb-3 text-[11px] tracking-[0.1em] uppercase text-ns-accent">
              Between the edges
            </div>
            <div className="font-mono text-[12px] leading-[1.9] opacity-75">
              pool → vault
              <br />
              a commitment, never a sender
            </div>
          </div>
        </div>
      </>
    ),
  },
  {
    title: "Charges of one subscription are linkable to each other",
    body: (
      <>
        <p className="text-[15px] leading-[1.65]">
          charge(commitment) is a plain public call: the commitment sits in its
          calldata and in the Charged event, so every period of a subscription
          is publicly connectable to every other one, never to a wallet. This
          is the price of a keeper that needs no proof.
        </p>
        <p className="mt-4 text-[15px] leading-[1.65]">
          What the split between charging and settlement buys is the other
          half: the creator's claim reveals nothing about which charges it
          covers or when they fired. One claim settles many periods in one
          private batch.
        </p>
      </>
    ),
  },
  {
    title: "Creator revenue is public per creator id",
    body: (
      <>
        <p className="text-[15px] leading-[1.65]">
          Charged amounts, Claimed events and the claimable_of view make a
          creator's cumulative topline derivable by anyone, and a creator has
          to publish an id for subscribers to find them. NIGHTSHIFT hides the
          subscriber; it does not hide the creator's revenue from competitors,
          and we do not claim Patreon-style confidentiality.
        </p>
        <p className="mt-4 text-[15px] leading-[1.65]">
          Tier quantization coarsens the picture: an observer sees ladder
          multiples, not arbitrary amounts. And because creator_id hashes the
          payout key, one creator can derive many ids and hand each cohort its
          own. Per-id revenue stays public; the total stops being computable by
          anyone who cannot enumerate ids that were never published together.
        </p>
      </>
    ),
  },
  {
    title: "Edges and calldata are public by design",
    body: (
      <>
        <p className="text-[15px] leading-[1.65]">
          This is the pool's own model, inherited as is: escrow entering the
          vault and any reclaim leaving it are visible legs. Privacy lives
          between the edges. Anything placed in the external invoke's calldata
          (tier, schedule shape) is visible too, which is exactly why amounts
          and periods are quantized to a small ladder rather than being
          free-form.
        </p>
        <p className="mt-4 text-[15px] leading-[1.65]">
          A revocation names no wallet in its authorization and need not name
          one in its submission: cancel and reclaim check only the owner-key
          signature, so any relay can carry a signed cancel. Self-submit
          instead and you write your own wallet in as sender. That is the
          trade-off, not a defect.
        </p>
      </>
    ),
  },
  {
    title: "Timing correlation is real",
    body: (
      <>
        <p className="text-[15px] leading-[1.65]">
          An observer correlating pool edges with vault events by block
          proximity can make probabilistic guesses, as with any pool
          interaction. Larger anonymity sets weaken this. We do not claim
          immunity to it.
        </p>
        <p className="mt-4 text-[15px] leading-[1.65]">
          The relay learns the commitment it is handed, so it knows which
          subscription is being cancelled. And the demo subscription used the
          demo wallet as its own creator, so its linkage properties understate
          the two-party case.
        </p>
        <p className="mt-4 text-[15px] leading-[1.65]">
          Every claim on these screens is checkable from public data with no
          key:{" "}
          <span className={MONO}>
            starkli call &lt;vault&gt; schedule_of &lt;commitment&gt;
          </span>
          .
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
