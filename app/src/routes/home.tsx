// The door. Who it is for, what it costs, two ways in.
//
// Everything on this page is a sentence a person can act on. The one live
// element is the hero ticket, which shows a real night running on the
// network right now when one is, and how a night looks when none is.

import { Link } from "@tanstack/react-router";

import { LockedAvatar, MaskedAvatar } from "../components/shell/avatar";
import { Column, Display, Facts, GUTTER, Kicker, Page } from "../components/shell/page";
import { CutLines, Reveal } from "../components/shell/motion";
import { useNow } from "../components/shell/sheet";
import { liveCommitment } from "../components/board/derive";
import { creatorHandle, priceLabel, relativeChip, secondsUntilBlock, shortId, strk } from "../lib/format";
import { usePageTitle } from "../lib/use-title";
import { useBoard } from "../query/useBoard";
import { useSchedule } from "../query/useSchedule";

function HeroTicket() {
  const board = useBoard().data ?? null;
  const commitment = board ? liveCommitment(board.charges) : null;
  const schedule = useSchedule(commitment).data ?? null;
  const now = useNow();

  const last = board?.charges.find((c) => c.vault === "v4" && c.amountWei !== null) ?? null;
  const live =
    board !== null && schedule !== null && !schedule.cancelled && schedule.nextPeriod < schedule.nPeriods;
  const nextBlock = live ? schedule.startBlock + schedule.nextPeriod * schedule.periodBlocks : null;
  const renews =
    live && nextBlock !== null && board
      ? relativeChip(secondsUntilBlock(nextBlock, board.headBlock, board.headTimestamp, now))
      : null;

  return (
    <div className="flex flex-col items-stretch gap-4">
      <div className="ad-card ad-glow flex flex-col gap-5 p-6 lg:p-7">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <MaskedAvatar size={56} tone="rose" />
            <div className="flex flex-col gap-1">
              <div className="text-[19px] font-[700]" style={{ fontFamily: "var(--font-heading)" }}>
                {schedule ? creatorHandle(schedule.creatorId) : "Velvet Noir"}
              </div>
              <div className="ad-mono text-[11px] text-faint">
                {schedule ? `AFTER DARK · TIER ${schedule.tier + 1}` : "AFTER DARK · TIER 1"}
              </div>
            </div>
          </div>
          <span className="ad-tag ad-tag-rose">{renews ? `RENEWS ${renews}` : live ? "RUNNING" : "RENEWS FRI"}</span>
        </div>
        <div className="flex flex-col gap-3 border-t border-line pt-4">
          <div className="flex items-baseline justify-between gap-4">
            <span className="ad-mono text-[12px] text-dim">subscriber</span>
            <span className="ad-redact-in text-[14px]">
              <span className="px-2 text-dim">a fan, somewhere</span>
            </span>
          </div>
          <div className="flex items-baseline justify-between gap-4">
            <span className="ad-mono text-[12px] text-dim">{schedule ? "this period" : "this week"}</span>
            <span className="ad-mono text-[15px] text-ink">
              {schedule && last && last.amountWei !== null
                ? `${priceLabel(last.amountWei, schedule.periodBlocks)} · paid`
                : "3 STRK · paid"}
            </span>
          </div>
          <div className="flex items-baseline justify-between gap-4">
            <span className="ad-mono text-[12px] text-dim">receipt</span>
            {last ? (
              <a
                href={`https://voyager.online/tx/${last.txHash}`}
                target="_blank"
                rel="noreferrer"
                className="ad-mono text-[13px] text-rose"
              >
                {shortId(last.txHash)} ↗
              </a>
            ) : (
              <span className="ad-mono text-[13px] text-rose">0x2e54…f43b</span>
            )}
          </div>
        </div>
      </div>
      <div className="ad-mono text-center text-[11px] tracking-[0.1em] text-faint uppercase">
        {live ? "A real night, running right now. That is the product." : "A real receipt. A redacted subscriber. That is the product."}
      </div>
    </div>
  );
}

const STEPS = [
  {
    n: "01",
    title: "Follow their link",
    body: "Every creator shares one link. Open it, pick a tier, done. No account, no email, no profile to fill in.",
  },
  {
    n: "02",
    title: "Pay once, privately",
    body: "One payment from your wallet funds the whole run, and nothing ties it back to you.",
  },
  {
    n: "03",
    title: "It runs itself",
    body: "Each week bills on time, every time. Walk away for a month; it will not miss a beat. Cancel is one tap, whenever.",
  },
];

export function HomeRoute() {
  usePageTitle();
  const board = useBoard().data ?? null;
  const paid = board ? board.charges.filter((c) => c.amountWei !== null).reduce((s, c) => s + (c.amountWei ?? 0n), 0n) : null;

  return (
    <Page
      cta={
        <Link to="/join" className="ad-pill ad-pill-primary ad-pill-sm hidden md:inline-flex">
          Join with your link
        </Link>
      }
    >
      <main className="flex flex-1 flex-col">
        {/* ── hero ── */}
        <Column className="grid items-center gap-12 pt-14 pb-16 lg:grid-cols-[7fr_5fr] lg:pt-24 lg:pb-20">
          <div className="flex flex-col gap-7">
            <Kicker className="ad-enter">Private fan subscriptions · live on Starknet</Kicker>
            <Display size="xl">
              <CutLines
                lines={[
                  "Back anyone.",
                  <>
                    Show <span className="ad-mark">no one.</span>
                  </>,
                ]}
              />
            </Display>
            <p className="ad-enter ad-enter-2 max-w-[46ch] text-[18px] leading-[1.55] text-ink-2 lg:text-[19px]">
              The subscription with no paper trail. Support the creators you love, week after
              week. Your name, your wallet and your history stay yours. Forever.
            </p>
            <div className="ad-enter ad-enter-3 flex flex-wrap items-center gap-4">
              <Link to="/join" className="ad-pill ad-pill-primary ad-pill-lg">
                Join with your link
              </Link>
              <Link to="/start" className="ad-pill ad-pill-ghost ad-pill-lg">
                I'm a creator
              </Link>
            </div>
            <Facts className="ad-enter ad-enter-3" items={["No name", "No card", "No trace", "Cancel in one tap"]} />
          </div>
          <div className="ad-enter ad-enter-3">
            <HeroTicket />
          </div>
        </Column>

        {/* ── proof strip ── */}
        <div className="border-y border-line">
          <Reveal>
          <Column className="grid lg:grid-cols-3">
            {[
              {
                big: "$6.6B",
                rose: true,
                body: "what fans spent on OnlyFans in one year. Money that demands discretion has never had a home on-chain. Now it does.",
              },
              {
                big: "0 names",
                rose: false,
                body: "on chain, in receipts, or in any list a creator, platform or stranger can read.",
              },
              {
                big: paid !== null && paid > 0n ? `${strk(paid)} STRK` : "24/7",
                rose: false,
                body:
                  paid !== null && paid > 0n
                    ? "paid to creators through NIGHTSHIFT so far, every payment on schedule, every one with a receipt."
                    : "your subscription bills itself, on schedule, on Starknet mainnet. Nobody has to remember anything.",
              },
            ].map((s, i) => (
              <div
                key={s.big}
                className={`flex flex-col gap-2 py-8 lg:py-9 ${i > 0 ? "border-t border-line lg:border-t-0 lg:border-l lg:pl-10" : ""} ${i < 2 ? "lg:pr-10" : ""}`}
              >
                <div className={`ad-display text-[36px] lg:text-[40px] ${s.rose ? "text-rose" : ""}`}>{s.big}</div>
                <div className="max-w-[40ch] text-[14px] leading-[1.55] text-dim">{s.body}</div>
              </div>
            ))}
          </Column>
          </Reveal>
        </div>

        {/* ── use cases ── */}
        <Column className="flex flex-col gap-10 py-16 lg:py-20">
          <Reveal className="flex flex-wrap items-baseline justify-between gap-6">
            <Display as="h2" size="lg" className="max-w-[20ch]">
              Made for the subscriptions nobody should see.
            </Display>
            <span className="ad-kicker ad-kicker-dim">Three of many</span>
          </Reveal>
          <Reveal className="grid gap-6 lg:grid-cols-3" delay={80}>
            <div className="ad-card-rose ad-card-hover flex flex-col gap-4 p-7 lg:p-8">
              <MaskedAvatar size={64} tone="rose" />
              <div className="text-[24px] font-[700]" style={{ fontFamily: "var(--font-heading)" }}>
                After-dark creators
              </div>
              <p className="text-[15px] leading-[1.6] text-dim">
                Adult and intimacy creators whose fans would never put this on a card statement.
                Fans pay, unlock, and stay unnamed. To the platform, the bank, and even the
                creator.
              </p>
              <Link to="/join" className="ad-mono text-[12px] tracking-[0.1em] text-rose uppercase">
                The hero case →
              </Link>
            </div>
            <div className="ad-card ad-card-hover flex flex-col gap-4 p-7 lg:p-8">
              <LockedAvatar size={64} />
              <div className="text-[24px] font-[700]" style={{ fontFamily: "var(--font-heading)" }}>
                Members-only rooms
              </div>
              <p className="text-[15px] leading-[1.6] text-dim">
                Paid Telegram and Discord groups where the member list simply does not exist.
                Prove you belong at the door; the door learns your tier and nothing else. Live
                today.
              </p>
              <Link to="/unlock" className="ad-mono text-[12px] tracking-[0.1em] text-faint uppercase hover:text-ink">
                Try the live room →
              </Link>
            </div>
            <div className="ad-card ad-card-hover flex flex-col gap-4 p-7 lg:p-8">
              <svg width="64" height="64" viewBox="0 0 88 88" fill="none" aria-hidden="true">
                <circle cx="44" cy="44" r="42" fill="var(--ad-silhouette)" stroke="var(--ad-line-strong)" strokeWidth="3" />
                <path d="M30 62V30l28 8v24" fill="none" stroke="var(--ad-silhouette-2)" strokeWidth="6" strokeLinejoin="round" />
                <rect x="24" y="40" width="40" height="11" fill="var(--ad-ink)" />
              </svg>
              <div className="text-[24px] font-[700]" style={{ fontFamily: "var(--font-heading)" }}>
                Funding the exposed
              </div>
              <p className="text-[15px] leading-[1.6] text-dim">
                Journalists, advocates, health communities. Anywhere a supporter list is a target
                list. Fund the work, week after week, without ever appearing beside it.
              </p>
              <Link to="/start" className="ad-mono text-[12px] tracking-[0.1em] text-faint uppercase hover:text-ink">
                For causes →
              </Link>
            </div>
          </Reveal>
        </Column>

        {/* ── how it works ── */}
        <div className="border-t border-line">
          <Column className="flex flex-col gap-11 py-16 lg:py-20">
            <Reveal>
              <Display as="h2" size="lg">
                Three steps. You are only there for one.
              </Display>
            </Reveal>
            <div className="grid gap-10 lg:grid-cols-3 lg:gap-12">
              {STEPS.map((s, i) => (
                <Reveal key={s.n} className="flex flex-col gap-3" delay={i * 70}>
                  <span className="ad-mono text-[14px] text-rose">{s.n}</span>
                  <div className="text-[26px] font-[700]" style={{ fontFamily: "var(--font-heading)" }}>
                    {s.title}
                  </div>
                  <p className="text-[15px] leading-[1.6] text-dim">{s.body}</p>
                </Reveal>
              ))}
            </div>
          </Column>
        </div>

        {/* ── creator band ── */}
        <div className="bg-rose text-on-rose">
          <div className={`mx-auto grid max-w-[1440px] items-center gap-12 py-16 lg:grid-cols-[7fr_5fr] lg:py-20 ${GUTTER}`}>
            <Reveal className="flex flex-col gap-6">
              <span className="ad-mono text-[13px] tracking-[0.22em] uppercase opacity-60">For creators</span>
              <h2 className="ad-display text-[40px] sm:text-[52px] lg:text-[60px]" style={{ color: "inherit" }}>
                Your fans, invisible.
                <br />
                Your income, on time.
              </h2>
              <p className="max-w-[46ch] text-[17px] leading-[1.55] opacity-80">
                Set your price, share one link, and get paid on schedule. You see revenue arrive
                and totals grow, never who is behind them. Your audience finally gets a door
                nobody sees them walk through.
              </p>
              <div className="flex flex-wrap items-center gap-5">
                <Link
                  to="/start"
                  className="ad-pill ad-pill-lg"
                  style={{ background: "var(--ad-ground)", color: "var(--ad-ink)", borderColor: "var(--ad-ground)" }}
                >
                  Start earning
                </Link>
                <span className="ad-mono text-[12px] tracking-[0.1em] uppercase opacity-60">
                  One transaction · live in 60 seconds
                </span>
              </div>
            </Reveal>
            <Reveal delay={80}>
              <div
                className="flex flex-col gap-5 p-7"
                style={{ border: "2px solid var(--ad-on-rose)", background: "rgba(14,12,17,0.08)" }}
              >
              <span className="ad-mono text-[11px] tracking-[0.18em] uppercase opacity-60">Your night ledger</span>
              <div className="flex items-baseline justify-between border-b pb-3" style={{ borderColor: "rgba(14,12,17,0.25)" }}>
                <span className="text-[14px] font-[600]">This week</span>
                <span className="ad-mono text-[20px] font-[700]">36 STRK</span>
              </div>
              <div className="flex items-baseline justify-between border-b pb-3" style={{ borderColor: "rgba(14,12,17,0.25)" }}>
                <span className="text-[14px] font-[600]">Backers</span>
                <span className="ad-mono text-[20px] font-[700]">
                  12 <span className="text-[12px] font-[400]">masked</span>
                </span>
              </div>
              <div className="flex items-baseline justify-between">
                <span className="text-[14px] font-[600]">Who they are</span>
                <span className="px-10 text-[14px]" style={{ background: "var(--ad-on-rose)", color: "var(--ad-on-rose)" }}>
                  redacted
                </span>
              </div>
              </div>
            </Reveal>
          </div>
        </div>

        {/* ── the promise ── */}
        <Column className="flex flex-col gap-9 py-16 lg:py-20">
          <Reveal>
            <Display as="h2" size="lg" className="max-w-[22ch]">
              What the world sees, and what it never will.
            </Display>
          </Reveal>
          <Reveal className="grid gap-6 lg:grid-cols-2" delay={80}>
            <div className="ad-hair flex flex-col gap-4 p-7 lg:p-8">
              <span className="ad-kicker ad-kicker-dim">Visible · so it can be trusted</span>
              <p className="text-[15px] leading-[1.9] text-ink-2">
                A payment arrived for a creator.
                <br />
                A subscription renewed on schedule.
                <br />
                A receipt exists for every single charge.
              </p>
            </div>
            <div className="ad-card-rose flex flex-col gap-4 p-7 lg:p-8">
              <span className="ad-kicker">Never · not to anyone</span>
              <p className="text-[15px] leading-[1.9] text-ink-2">
                <span className="ad-redact">who paid</span>, not on chain, not to us.
                <br />
                <span className="ad-redact">what else</span> you subscribe to.
                <br />
                <span className="ad-redact">your wallet</span>, never on file, never asked again.
              </p>
            </div>
          </Reveal>
          <p className="text-[14px] text-faint">
            Skeptical? Good. Every claim on this page has a receipt on the network.{" "}
            <Link to="/receipts" className="text-rose">
              See the receipts
            </Link>
            .
          </p>
        </Column>
      </main>
    </Page>
  );
}
