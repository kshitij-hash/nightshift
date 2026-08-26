// The landing, in the Modernist frame. Reading order is the argument: the
// hero states the claim and hands over the receipts in the same viewport, the
// stat row carries four product facts with their basis, the mechanism section
// draws the three verbs, the poster states the one sentence to leave with,
// the delivery section answers the brief point by point, and the
// hidden/provable block closes with the claim and a door into the full
// disclosure. Everything printed here is a constant of the deployment
// (addresses, receipt hashes, the test count) - the live figures live on
// /board, one click away, where they arrive with their provenance.

import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { LiveNumber } from "../components/dashboard/tile";
import { Masthead } from "../components/masthead";
import { ScrambleIn } from "../components/motion/scramble-in";
import { PrivacyDrawer } from "../components/privacy-drawer";
import { SiteFooter } from "../components/site-footer";
import { fmtBlock, fmtStrk, GATE, POOL, RECEIPTS, truncate, VAULT, VOYAGER_TX } from "../config";
import { useBoard } from "../query/useBoard";

const GUTTER = "px-5 lg:px-10";

function Kicker({ children, muted = false }: { children: React.ReactNode; muted?: boolean }) {
  return (
    <div
      className={
        muted
          ? "text-[11px] tracking-[0.1em] uppercase text-text-caption"
          : "text-[11px] tracking-[0.16em] uppercase text-ns-accent"
      }
    >
      {children}
    </div>
  );
}

/** A stat numeral that rolls from zero into its value once, on arrival.
 *  Non-numeric values (24/7) render as they are. */
function RollIn({ value }: { value: string }) {
  const numeric = /^\d+$/.test(value) ? Number(value) : null;
  const [rolled, setRolled] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setRolled(true));
    return () => cancelAnimationFrame(id);
  }, []);
  if (numeric === null) return <>{value}</>;
  return <LiveNumber value={rolled ? numeric : 0} />;
}

const STATS: Array<[string, string]> = [
  [
    "0",
    "Keys with spending power. The escrow moves on a hash the subscriber precomputed, or it does not move.",
  ],
  [
    "1",
    "Signature to cancel. The vault checks it and never reads the sender, so cancelling costs you no gas and names no wallet.",
  ],
  [
    "24/7",
    "Unattended charging. A cron keeper fires each period's charge on schedule; nobody is at a keyboard and nobody needs to be.",
  ],
  [
    "65",
    "Adversarial and lifecycle cases under snforge: hostile donations, non-pool callers, early charges, double charges, escrow exhaustion.",
  ],
];

const MECHANISM: Array<{
  n: string;
  verb: string;
  when: string;
  mono: React.ReactNode;
  prose: string;
  lit?: boolean;
}> = [
  {
    n: "01",
    verb: "subscribe",
    when: "once, private",
    mono: (
      <>
        pool withdraws escrow → vault
        <br />
        commitment = H(secret, creator)
        <br />
        tier · period_blocks · periods
        <br />
        owner_key recorded
      </>
    ),
    prose:
      "The secret never leaves the subscriber's machine. The pool's withdrawal edge severs the link to the depositing wallet.",
  },
  {
    n: "02",
    verb: "charge",
    when: "per period, by anyone",
    lit: true,
    mono: (
      <>
        nullifier = poseidon(commitment, period)
        <br />
        · schedule exists, escrow remains
        <br />
        · block ≥ start + period·len&nbsp;&nbsp;
        <span className="text-accent-700">never early</span>
        <br />
        · nullifier unspent, then written&nbsp;&nbsp;
        <span className="text-accent-700">never twice</span>
        <br />
        · escrow −= amount&nbsp;&nbsp;
        <span className="text-accent-700">never beyond</span>
      </>
    ),
    prose:
      "A plain public entrypoint. No proof, no pool batch, no wallet API, so an unattended keeper needs none of those either. Credits the creator's claimable balance; no tokens move.",
  },
  {
    n: "03",
    verb: "claim",
    when: "creator-signed",
    mono: (
      <>
        creator signs (creator_id, note, amount)
        <br />
        pool deposits into an open note
        <br />
        one claim settles many periods
        <br />
        claim_public: signed exit + nonce
      </>
    ),
    prose:
      "Money only leaves under a signature from the creator's own payout key. A keeper can fire charges all day and can never redirect a wei of it.",
  },
];

const DELIVERS: Array<{ asked: string; how: string }> = [
  {
    asked: "Set-and-forget subscriptions",
    how: "Authorize once at subscribe. From then on an unattended keeper charges each period on schedule; your wallet is never asked again and can never be over-charged.",
  },
  {
    asked: "No gas surprises",
    how: "Charges cost the subscriber nothing: whoever fires them pays. Cancelling is a signature any relay can carry, so it costs no gas either. You pay once, at subscribe, and the cost step shows every wei before you sign.",
  },
  {
    asked: "Click-to-cancel",
    how: "One signature ends the subscription. The vault refuses every further charge structurally, not by policy, and the unspent escrow comes back to you. Compliant with click-to-cancel rules by construction.",
  },
  {
    asked: "Tier-gated access without surveillance",
    how: "Prove \"I hold an active tier with this creator\" to a Telegram bot, a Discord gate or a licence server. The verifier learns your tier and nothing else: never a wallet, never a payment history.",
  },
];

export function LandingRoute() {
  const [privOpen, setPrivOpen] = useState(false);
  // The ticker's rows come from the same cached board read /board runs on,
  // so opening the board from here costs no extra request.
  const charges = useBoard().data?.charges ?? [];

  return (
    <div className="flex min-h-screen flex-col">
      <Masthead heading={false} />

      <main className="flex flex-1 flex-col">
        {/* ── hero ── */}
        <div className="grid border-b-2 border-divider lg:grid-cols-[7fr_5fr]">
          <div className={`${GUTTER} pt-12 pb-10 lg:pt-19 lg:pb-14`}>
            <div className="mb-6">
              <Kicker>▸ Private recurring payments on Starknet · STRK20 anonymizer</Kicker>
            </div>
            <h1 className="text-[42px] leading-[0.98] tracking-[-0.035em] lg:text-[74px] lg:leading-[0.95]">
              <span className="m-cut">
                <span>Subscribe once.</span>
              </span>
              <span className="m-cut">
                <span>The escrow does the rest.</span>
              </span>
            </h1>
            <p className="mt-6 mb-5 max-w-[52ch] text-[17px] leading-[1.45] lg:text-[20px]">
              A subscriber funds escrow once through the STRK20 privacy pool.
              After that a vault charges it on schedule, and the wallet that
              funded it is never named, never asked again, and can never be
              charged early, twice, or beyond what it escrowed.
            </p>
            <p className="mb-8 max-w-[52ch] text-[15px] leading-[1.6] text-text-prose">
              Set it up once and forget it. Nothing with spending power is held
              by anyone, so there is nothing to steal or phish, and you can
              cancel any time with one signature that costs you no gas and
              names no wallet.
            </p>
            <div className="flex flex-wrap gap-3">
              <Link to="/board" className="m-btn m-btn-primary text-[15px]" style={{ padding: "13px 22px" }}>
                Watch the live board →
              </Link>
              <Link to="/subscribe" className="m-btn m-btn-secondary text-[15px]" style={{ padding: "13px 22px" }}>
                Subscribe on mainnet
              </Link>
            </div>
          </div>

          <div className={`${GUTTER} border-t-2 border-divider pt-10 pb-10 lg:border-t-0 lg:border-l-2 lg:pt-19 lg:pb-14`}>
            <div className="mb-3.5">
              <Kicker muted>Deployed and receipted</Kicker>
            </div>
            <div className="bg-neutral-900 p-5 font-mono text-[12px] leading-[2] text-neutral-200">
              <div className="flex gap-3">
                <span className="w-[88px] shrink-0">vault v4</span>
                <span className="text-accent-400">
                  <ScrambleIn text={truncate(VAULT)} />
                </span>
              </div>
              <div className="flex gap-3">
                <span className="w-[88px] shrink-0">gate</span>
                <span className="text-accent-400">
                  <ScrambleIn text={truncate(GATE)} startDelay={90} />
                </span>
              </div>
              <div className="flex gap-3">
                <span className="w-[88px] shrink-0">pool</span>
                <span>
                  <ScrambleIn text={truncate(POOL)} startDelay={180} />
                </span>
              </div>
              <div className="mt-2.5">
                {RECEIPTS.map((r, i) => (
                  <a
                    key={r.verb}
                    href={VOYAGER_TX(r.hash)}
                    target="_blank"
                    rel="noreferrer"
                    className="no-u flex gap-3 text-neutral-200 opacity-65 hover:text-accent-400 hover:opacity-100"
                  >
                    <span className="w-[88px] shrink-0">{r.verb}</span>
                    <span>
                      <ScrambleIn text={truncate(r.hash)} startDelay={300 + i * 90} />
                    </span>
                  </a>
                ))}
              </div>
            </div>
            <p className="mt-4 mb-0 text-[13px] leading-[1.6] text-text-prose">
              The full lifecycle: escrow in and out to the exact wei, across
              three different senders. Every claim on this page has a
              transaction hash.
            </p>
          </div>
        </div>

        {/* ── stat row ── */}
        <div className="grid grid-cols-2 border-b-2 border-divider lg:grid-cols-4">
          {STATS.map(([value, basis], i) => (
            <div
              key={value}
              className={`p-6 lg:px-6 lg:py-7 ${i > 0 ? "border-l border-divider" : ""} ${i >= 2 ? "max-lg:border-t max-lg:border-divider" : ""} ${i === 2 ? "max-lg:border-l-0" : ""}`}
            >
              <div
                className="text-[32px] leading-none font-[800] tracking-[-0.03em] tabular lg:text-[38px]"
                style={{ fontFamily: "var(--font-heading)" }}
              >
                <RollIn value={value} />
              </div>
              <div className="mt-2 text-[12px] text-text-label">{basis}</div>
            </div>
          ))}
        </div>

        {/* ── mechanism ── */}
        <div className={`${GUTTER} border-b-2 border-divider py-12 lg:py-16`}>
          <div className="mb-2.5">
            <Kicker>▸ The mechanism</Kicker>
          </div>
          <h2 className="max-w-[34ch] text-[28px] tracking-[-0.028em] lg:text-[38px]">
            Recurrence without asking the pool for anything it does not have.
          </h2>
          <p className="mt-2 mb-9 max-w-[74ch] text-[15px] leading-[1.6] text-text-prose">
            The pool holds funds privately and moves them privately, but it has
            no notion of time. So the standing authorization here is not a key
            at all: it is escrow the subscriber already parted with, plus rules
            about when it may move. Subscriptions are the headline; the same
            schedule reads as rent, a DAO stipend, or dues.
          </p>
          <div className="grid border-2 border-divider lg:grid-cols-3">
            {MECHANISM.map((m, i) => (
              <div
                key={m.verb}
                className={`p-6 lg:p-7 ${i > 0 ? "max-lg:border-t-2 max-lg:border-divider lg:border-l-2 lg:border-divider" : ""} ${m.lit ? "bg-panel" : ""}`}
              >
                <div className="mb-3.5 flex items-baseline gap-2.5">
                  <span
                    className="text-[14px] font-[800] text-ns-accent"
                    style={{ fontFamily: "var(--font-heading)" }}
                  >
                    {m.n}
                  </span>
                  <span
                    className="text-[20px] font-[800] tracking-[-0.015em]"
                    style={{ fontFamily: "var(--font-heading)" }}
                  >
                    {m.verb}
                  </span>
                  <span className="text-[11px] tracking-[0.08em] uppercase text-text-caption">
                    {m.when}
                  </span>
                </div>
                <div className="mb-3.5 font-mono text-[12px] leading-[1.9]">{m.mono}</div>
                <div className="text-[13px] leading-[1.55] text-text-prose">{m.prose}</div>
              </div>
            ))}
          </div>
        </div>

        {/* ── poster ── */}
        <div className={`${GUTTER} bg-ns-accent py-16 text-ground lg:py-21`}>
          <div
            className="max-w-[28ch] text-[36px] leading-[1.0] font-[800] tracking-[-0.035em] lg:text-[62px]"
            style={{ fontFamily: "var(--font-heading)" }}
          >
            The privacy question and the authorization question are answered by
            the same hash.
          </div>
          <div
            className="my-7 h-0.5 max-w-[620px] lg:mt-9 lg:mb-5"
            style={{ background: "color-mix(in srgb, #f3f2f2 45%, transparent)" }}
          />
          <div className="max-w-[66ch] text-[15px] leading-[1.5] lg:text-[16px]">
            Designs that guard a live key with policy rules can fail two ways:
            the policy gets misconfigured, or the key leaks. Here no key with
            spending power exists at all.
          </div>
        </div>

        {/* ── what the brief asked for ── */}
        <div className="grid border-b-2 border-divider lg:grid-cols-[5fr_7fr]">
          <div className={`${GUTTER} py-10 lg:py-14`}>
            <div className="mb-4">
              <Kicker>▸ What the brief asked for</Kicker>
            </div>
            <h2 className="mb-3.5 max-w-[24ch] text-[26px] tracking-[-0.025em] lg:text-[34px]">
              Web2 subscription UX, on chain.
            </h2>
            <p className="max-w-[44ch] text-[14px] leading-[1.6] text-text-prose">
              The STRK20 brief calls for private subscriptions with
              set-and-forget UX: authorize once, get charged automatically,
              cancel with a click, and prove your tier without being watched.
              That is what NIGHTSHIFT runs on mainnet today.
            </p>
          </div>
          <div className="border-t-2 border-divider lg:border-t-0 lg:border-l-2">
            {DELIVERS.map((row, i) => (
              <div
                key={row.asked}
                className={`grid sm:grid-cols-2 ${i < DELIVERS.length - 1 ? "border-b border-divider" : ""}`}
              >
                <div className="px-5 py-5 lg:px-6 lg:py-6">
                  <div className="mb-2 text-[11px] tracking-[0.1em] uppercase text-text-caption">
                    Asked
                  </div>
                  <div className="text-[16px] font-[800]" style={{ fontFamily: "var(--font-heading)" }}>
                    {row.asked}
                  </div>
                </div>
                <div className="bg-panel px-5 py-5 max-sm:border-t max-sm:border-divider sm:border-l sm:border-divider lg:px-6 lg:py-6">
                  <div className="mb-2 text-[11px] tracking-[0.1em] uppercase text-ns-accent">
                    Delivered
                  </div>
                  <div className="text-[13.5px] leading-[1.55]">{row.how}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ── hidden vs provable ── */}
        <div className={`${GUTTER} py-12 lg:py-16`}>
          <div className="mb-2.5">
            <Kicker>▸ What is hidden, what is provable</Kicker>
          </div>
          <div className="flex flex-col border-2 border-divider">
            <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1 px-5 py-5 lg:px-6">
              <span className="w-[96px] shrink-0 text-[11px] font-medium tracking-[0.18em] text-text-label">
                HIDDEN
              </span>
              <span
                className="text-[20px] font-[800] tracking-[-0.01em] lg:text-[24px]"
                style={{ fontFamily: "var(--font-heading)" }}
              >
                your wallet.
              </span>
            </div>
            <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1 border-t-2 border-divider bg-panel px-5 py-5 lg:px-6">
              <span className="w-[96px] shrink-0 text-[11px] font-medium tracking-[0.18em] text-ns-accent">
                PROVABLE
              </span>
              <span
                className="text-[20px] font-[800] tracking-[-0.01em] lg:text-[24px]"
                style={{ fontFamily: "var(--font-heading)" }}
              >
                your tier is valid and your payment is current.
              </span>
            </div>
          </div>
          <div className="mt-5 text-[13px] text-text-caption">
            Every claim on this page is verified against real events and
            calldata on mainnet.{" "}
            <button
              type="button"
              onClick={() => setPrivOpen(true)}
              className="m-btn m-btn-ghost text-[13px]"
              style={{ padding: 0 }}
            >
              The full disclosure, operation by operation →
            </button>
          </div>
        </div>
      </main>

      {/* The charge ticker: real rows from the vault's event log, looping.
          The one continuously-moving element on the site; it holds still on
          hover and under reduced motion. */}
      {charges.length > 0 ? (
        <Link
          to="/board"
          className="m-ticker block border-t-2 border-divider bg-panel py-2.5 font-mono text-[11.5px] text-text-label hover:text-ink"
          aria-label="live charges, open the board"
        >
          <div>
            {[0, 1].map((dup) => (
              <span key={dup} className="inline-flex" aria-hidden={dup === 1}>
                {charges.slice(0, 8).map((c) => (
                  <span
                    key={`${dup}:${c.txHash}:${c.periodIndex}`}
                    className="inline-flex items-baseline gap-2 pr-12"
                  >
                    <span className="text-ns-accent">●</span>
                    charged{c.amountWei !== null ? ` ${fmtStrk(c.amountWei)} STRK` : ""} ·
                    period {String(c.periodIndex).padStart(2, "0")} · block{" "}
                    {fmtBlock(c.block)} · {truncate(c.txHash)}
                  </span>
                ))}
              </span>
            ))}
          </div>
        </Link>
      ) : null}

      <SiteFooter
        className="mt-0"
        voyagerLabel="every charge verifiable on voyager"
        links={[
          { label: "github", href: "https://github.com/kshitij-hash/nightshift" },
          { label: "the board", to: "/board" },
        ]}
      />

      <PrivacyDrawer open={privOpen} onClose={() => setPrivOpen(false)} />
    </div>
  );
}
