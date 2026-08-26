// The landing, in the Modernist frame. Reading order is the argument: the
// hero states the claim and hands over the receipts in the same viewport, the
// stat row carries four product facts with their basis, the mechanism section
// walks the three verbs, the poster states the one sentence to leave with,
// the benefits grid says what a subscriber gets, and the hidden/provable
// block closes with the claim and a door into the privacy walkthrough.
// Everything printed here is a constant of the deployment (addresses, receipt
// hashes) - the live figures live on /board, one click away.

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
    "Keys with spending power. The escrow moves only under the rules set when you subscribed, so there is nothing to steal and nothing to phish.",
  ],
  [
    "1",
    "Signature to cancel. Cancelling costs no gas and reveals no wallet.",
  ],
  [
    "24/7",
    "Automatic billing. Each period is charged on schedule, with nobody at a keyboard and nobody who needs to be.",
  ],
  [
    "65",
    "Ways we tried to break it. Every rule the vault enforces is tested against early charges, double charges and overdrawn escrow.",
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
        you fund the escrow, privately
        <br />
        the vault records the schedule
        <br />
        your wallet's part is done
      </>
    ),
    prose:
      "The escrow enters through a privacy pool, so the vault never learns which wallet funded it — and has no way to ask.",
  },
  {
    n: "02",
    verb: "charge",
    when: "per period, automatic",
    lit: true,
    mono: (
      <>
        each period, one charge fires
        <br />
        · never early&nbsp;&nbsp;
        <br />
        · never twice&nbsp;&nbsp;
        <br />
        · never beyond the escrow
      </>
    ),
    prose:
      "Billing runs on schedule with nobody at a keyboard. Each charge moves one period's amount from escrow to the creator's balance, and the vault refuses anything else.",
  },
  {
    n: "03",
    verb: "claim",
    when: "creator-signed",
    mono: (
      <>
        the creator signs
        <br />
        the balance settles
        <br />
        one claim covers many periods
      </>
    ),
    prose:
      "Money leaves only under the creator's own signature. Whatever runs the billing can never redirect a cent of it.",
  },
];

const BENEFITS: Array<{ title: string; body: string }> = [
  {
    title: "Set it once",
    body: "Authorize a schedule when you subscribe. From then on billing runs itself: your wallet is never asked again and can never be over-charged.",
  },
  {
    title: "No gas surprises",
    body: "You pay once, at subscribe, and every cost is on screen before you sign. The charges themselves cost you nothing.",
  },
  {
    title: "Cancel with one signature",
    body: "One signature ends the subscription — no gas, no permission needed — and the unspent escrow comes back to you.",
  },
  {
    title: "Prove your tier, not your identity",
    body: "Get into a Telegram group, a Discord server or any paid door by proving you hold an active tier. The gate learns your tier and nothing else: never a wallet, never a payment history.",
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
              <Kicker>▸ Private subscriptions on Starknet</Kicker>
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
              Fund a subscription once, privately. It bills itself on schedule
              after that, and the wallet that paid is never revealed, never
              asked again, and can never be charged early, twice, or more than
              it put in.
            </p>
            <p className="mb-8 max-w-[52ch] text-[15px] leading-[1.6] text-text-prose">
              Nobody holds a key to your money — not the creator, not us — so
              there is nothing to steal and nothing to phish. Cancel any time
              with one signature, free, without revealing who you are.
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
              A complete subscription lifecycle on mainnet: funded, charged on
              schedule, cancelled, refunded. Every hash opens on Voyager.
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
            <Kicker>▸ How it works</Kicker>
          </div>
          <h2 className="max-w-[34ch] text-[28px] tracking-[-0.028em] lg:text-[38px]">
            Three steps. You are only there for the first one.
          </h2>
          <p className="mt-2 mb-9 max-w-[74ch] text-[15px] leading-[1.6] text-text-prose">
            A subscription here is not a standing key anyone could misuse. It
            is escrow you already set aside, plus rules about when it may
            move. The same schedule works as a subscription, rent, a stipend,
            or dues.
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
            Nobody holds a key to your money. So nobody can lose one.
          </div>
          <div
            className="my-7 h-0.5 max-w-[620px] lg:mt-9 lg:mb-5"
            style={{ background: "color-mix(in srgb, #f3f2f2 45%, transparent)" }}
          />
          <div className="max-w-[66ch] text-[15px] leading-[1.5] lg:text-[16px]">
            Systems that guard a live key with rules can fail two ways: the
            rules get misconfigured, or the key leaks. Here there is no key to
            guard.
          </div>
        </div>

        {/* ── what you get ── */}
        <div className="grid border-b-2 border-divider lg:grid-cols-[5fr_7fr]">
          <div className={`${GUTTER} py-10 lg:py-14`}>
            <div className="mb-4">
              <Kicker>▸ What you get</Kicker>
            </div>
            <h2 className="mb-3.5 max-w-[24ch] text-[26px] tracking-[-0.025em] lg:text-[34px]">
              A subscription that behaves like one.
            </h2>
            <p className="max-w-[44ch] text-[14px] leading-[1.6] text-text-prose">
              Pay once, get billed on schedule, cancel whenever you want, and
              open the doors your tier unlocks — all without anyone watching
              which wallet is behind it.
            </p>
          </div>
          <div className="grid border-t-2 border-divider sm:grid-cols-2 lg:border-t-0 lg:border-l-2">
            {BENEFITS.map((row, i) => (
              <div
                key={row.title}
                className={`px-5 py-5 lg:px-6 lg:py-6 ${i > 0 ? "max-sm:border-t max-sm:border-divider" : ""} ${i >= 2 ? "sm:border-t sm:border-divider" : ""} ${i % 2 === 1 ? "sm:border-l sm:border-divider" : ""}`}
              >
                <div
                  className="mb-2 text-[16px] font-[800]"
                  style={{ fontFamily: "var(--font-heading)" }}
                >
                  {row.title}
                </div>
                <div className="text-[13.5px] leading-[1.55] text-text-prose">{row.body}</div>
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
            Everything on this page can be checked against mainnet.{" "}
            <button
              type="button"
              onClick={() => setPrivOpen(true)}
              className="m-btn m-btn-ghost text-[13px]"
              style={{ padding: 0 }}
            >
              How the privacy works, honestly →
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
