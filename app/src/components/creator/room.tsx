// Your room: what you earned, how many people, when payday is, one button
// to move it to your wallet. Totals only. Never identities.

import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import NumberFlow from "@number-flow/react";
import { useState } from "react";

import { STRK, VAULT, VOYAGER_TX } from "../../config";
import { priceLabel, relativeSoon, secondsUntilBlock, shortId, strk, tierName, weekdayOf } from "../../lib/format";
import { isFunded } from "../../lib/creator";
import { getRpcClient } from "../../lib/rpc-instance";
import { claimableOf, tierOf } from "../../lib/rpc/views";
import { OPEN_NOTE_PLACEHOLDER, claimActions, resolveNoteId } from "../../lib/wallet/core";
import { signClaim } from "../../lib/wallet/keys";
import { useWallet } from "../../lib/wallet/session";
import { useBoard } from "../../query/useBoard";
import { useCreatorLedger } from "../../query/useCreatorLedger";
import { Ring, Swap } from "../shell/motion";
import { Column, Display, Kicker, Lede, Page } from "../shell/page";
import { CopyButton, useNow } from "../shell/sheet";
import { toFailure } from "../wallet/failure";

const WEEK = 7 * 24 * 3600;

type ClaimPhase = "idle" | "preparing" | "confirming" | "done";

/** A figure rolls per digit when a poll moves it, and sits still otherwise. */
function Figure({ value }: { value: number }) {
  return <NumberFlow value={value} format={{ maximumFractionDigits: 2 }} respectMotionPreference />;
}

function Stat({
  label,
  big,
  small,
  note,
  rose = false,
  index = 0,
}: {
  label: string;
  big: string | number;
  small?: string;
  note: string;
  rose?: boolean;
  index?: number;
}) {
  return (
    <div
      className={`${rose ? "ad-card-rose" : "ad-card"} ad-row flex flex-col gap-2 p-6`}
      style={{ "--i": index } as React.CSSProperties}
    >
      <span className={`ad-mono text-[10px] tracking-[0.18em] uppercase ${rose ? "text-rose" : "text-faint"}`}>{label}</span>
      <span className="ad-display text-[36px] tabular lg:text-[44px]">
        {typeof big === "number" ? <Figure value={big} /> : <Swap>{big}</Swap>}{" "}
        {small ? <span className="text-[18px] font-[500] text-dim">{small}</span> : null}
      </span>
      <span className="ad-mono text-[12px] text-dim">{note}</span>
    </div>
  );
}

export function RoomSurface() {
  const { ready, openSheet } = useWallet();
  const queryClient = useQueryClient();
  const board = useBoard().data ?? null;
  const now = useNow();
  const creatorId = ready?.identity.creatorId ?? null;

  const prices = useQuery({
    queryKey: ["room-prices", creatorId],
    enabled: creatorId !== null,
    staleTime: 60_000,
    queryFn: async () => {
      const probed = await Promise.all(Array.from({ length: 8 }, (_, i) => tierOf(getRpcClient(), creatorId!, i)));
      return probed
        .map((t, index) => ({ index, amountWei: t.amountWei, token: BigInt(t.token) }))
        .filter((t) => t.token !== 0n && t.amountWei > 0n)
        .map(({ index, amountWei }) => ({ index, amountWei }));
    },
  });
  const registered = prices.data !== undefined && prices.data.length > 0;

  const ledgerQ = useCreatorLedger(registered && creatorId ? [creatorId] : []);
  const ledger = ledgerQ.data?.ledger;
  const metrics = ledgerQ.data?.metrics;

  const claimable = useQuery({
    queryKey: ["claimable", creatorId],
    enabled: registered && creatorId !== null,
    refetchInterval: 60_000,
    queryFn: () => claimableOf(getRpcClient(), creatorId!),
  });

  const [claimPhase, setClaimPhase] = useState<ClaimPhase>("idle");
  const [claimTx, setClaimTx] = useState<string | null>(null);
  const [trouble, setTrouble] = useState<string | null>(null);

  const moveToWallet = async () => {
    if (!ready || !creatorId || claimable.data === undefined || claimable.data === 0n) return;
    const amountWei = claimable.data;
    setTrouble(null);
    setClaimTx(null);
    setClaimPhase("preparing");
    try {
      const prepared = await ready.connection.prepareInvoke(
        claimActions({ vault: VAULT, token: STRK, accountAddress: ready.connection.address, creatorId, amountWei, noteId: OPEN_NOTE_PLACEHOLDER, sig: null }),
      );
      const noteId = resolveNoteId(prepared.calldata, creatorId, amountWei);
      if (noteId === null) {
        setTrouble("The wallet built the transfer but the receiving note could not be identified. Try once more.");
        setClaimPhase("idle");
        return;
      }
      const sig = signClaim(ready.connection.address, STRK, noteId, amountWei);
      setClaimPhase("confirming");
      const hash = await ready.connection.invokeTransaction(
        claimActions({ vault: VAULT, token: STRK, accountAddress: ready.connection.address, creatorId, amountWei, noteId: OPEN_NOTE_PLACEHOLDER, sig }),
      );
      setClaimTx(hash);
      setClaimPhase("done");
      window.setTimeout(() => {
        void queryClient.invalidateQueries({ queryKey: ["claimable"] });
        void queryClient.invalidateQueries({ queryKey: ["creator-ledger"] });
      }, 30_000);
    } catch (e) {
      const f = toFailure(e);
      setTrouble(f.kind === "rejected" ? "You said no in the wallet, so nothing moved." : `${f.message}. Nothing moved unless a receipt is shown.`);
      setClaimPhase("idle");
    }
  };

  // ── derived figures ──
  const gross = metrics ? metrics.grossRevenue.value : 0n;
  const backers = ledger ? ledger.commitments.length : 0;
  const activeBackers = ledger ? ledger.commitments.filter((c) => isFunded(c)).length : 0;
  const perTier = ledger
    ? Object.entries(
        ledger.commitments.reduce<Record<number, number>>((acc, c) => {
          const t = c.schedule?.tier ?? 0;
          acc[t] = (acc[t] ?? 0) + 1;
          return acc;
        }, {}),
      )
    : [];

  let paydayBlock: number | null = null;
  let expectedWei = 0n;
  if (ledger) {
    for (const c of ledger.commitments) {
      if (!c.schedule || !isFunded(c) || c.schedule.nextPeriod >= c.schedule.nPeriods) continue;
      const b = c.schedule.startBlock + c.schedule.nextPeriod * c.schedule.periodBlocks;
      if (paydayBlock === null || b < paydayBlock) paydayBlock = b;
      if (c.tierPriceWei !== null) expectedWei += c.tierPriceWei;
    }
  }
  const paydaySecs =
    paydayBlock !== null && board ? secondsUntilBlock(paydayBlock, board.headBlock, board.headTimestamp, now) : null;

  const weeks: bigint[] = Array.from({ length: 8 }, () => 0n);
  if (ledger) {
    for (const ch of ledger.charges) {
      const ts = ch.time?.ts;
      if (ts === undefined) continue;
      const ago = Math.floor((now - ts) / WEEK);
      if (ago >= 0 && ago < 8) weeks[7 - ago] = (weeks[7 - ago] ?? 0n) + ch.amountWei;
    }
  }
  const weekMax = weeks.reduce((m, w) => (w > m ? w : m), 0n);
  const shareLink = creatorId ? `${window.location.origin}/join?creator=${creatorId}` : "";

  // ── not connected ──
  if (ready === null) {
    return (
      <Page>
        <main className="flex flex-1 flex-col py-12 lg:py-16">
          <Column className="flex max-w-[640px] flex-col gap-6">
            <Display size="lg">Your room</Display>
            <Lede>Your room opens the moment your wallet is along. Nothing about it is stored anywhere else.</Lede>
            <div className="flex flex-wrap gap-3">
              <button type="button" className="ad-pill ad-pill-primary" onClick={openSheet}>
                Bring a wallet
              </button>
              <Link to="/start" className="ad-pill ad-pill-ghost">
                I don't have a room yet
              </Link>
            </div>
          </Column>
        </main>
      </Page>
    );
  }

  // ── no room yet ──
  if (prices.isPending) {
    return (
      <Page>
        <main className="flex flex-1 flex-col py-12 lg:py-16">
          <Column className="flex flex-col gap-6" aria-busy="true">
            <Display size="lg">Your room</Display>
            <Lede>Opening…</Lede>
          </Column>
        </main>
      </Page>
    );
  }
  if (!registered) {
    return (
      <Page>
        <main className="flex flex-1 flex-col py-12 lg:py-16">
          <Column className="flex max-w-[640px] flex-col gap-6">
            <Display size="lg">No room yet.</Display>
            <Lede>Set a price and go live. It takes one transaction and about a minute.</Lede>
            <Link to="/start" className="ad-pill ad-pill-primary self-start">
              Start earning
            </Link>
          </Column>
        </main>
      </Page>
    );
  }

  const waiting = claimable.data ?? 0n;

  return (
    <Page>
      <main className="flex flex-1 flex-col py-10 lg:py-14">
        <Column className="flex flex-col gap-10">
          {/* ── headline + claim ── */}
          <div className="ad-enter flex flex-wrap items-end justify-between gap-6">
            <div className="flex flex-col gap-2">
              <Display size="lg">Your room</Display>
              <Lede>
                {ledgerQ.isPending
                  ? "Reading the room…"
                  : backers === 0
                    ? "Nobody is in yet. Share the link; that is the whole job."
                    : `${backers === 1 ? "One person is" : `${backers} people are`} in. You will never know which.`}
              </Lede>
            </div>
            <div className="flex flex-col items-end gap-2">
              <div className="flex items-center gap-4">
                <span className="ad-mono text-[12px] text-faint">
                  <Swap>{claimPhase === "done" ? "moved" : `${strk(waiting)} STRK waiting`}</Swap>
                </span>
                <button
                  type="button"
                  className="ad-pill ad-pill-primary"
                  disabled={waiting === 0n || claimPhase === "preparing" || claimPhase === "confirming"}
                  onClick={() => void moveToWallet()}
                >
                  {claimPhase === "preparing" || claimPhase === "confirming" ? <Ring size={16} /> : null}
                  <Swap>
                    {claimPhase === "preparing"
                      ? "Building…"
                      : claimPhase === "confirming"
                        ? "Confirm in your wallet"
                        : claimPhase === "done"
                          ? "Moved"
                          : "Move to my wallet"}
                  </Swap>
                </button>
              </div>
              {trouble ? <p className="max-w-[44ch] text-right text-[12px] text-dim">{trouble}</p> : null}
              {claimTx ? (
                <a href={VOYAGER_TX(claimTx)} target="_blank" rel="noreferrer" className="ad-mono text-[12px] text-rose">
                  receipt {shortId(claimTx)} ↗
                </a>
              ) : null}
            </div>
          </div>

          {/* ── three numbers ── */}
          <div className="grid gap-5 lg:grid-cols-3">
            <Stat
              label="Earned so far"
              big={Number(strk(gross))}
              small="STRK"
              note={ledger ? `${ledger.charges.length} payment${ledger.charges.length === 1 ? "" : "s"} landed` : "reading…"}
            />
            <Stat
              index={1}
              label="Backers"
              big={backers}
              small="masked"
              note={
                perTier.length > 0
                  ? perTier.map(([t, n]) => `${n} ${tierName(Number(t)).toLowerCase()}`).join(" · ")
                  : "none yet"
              }
            />
            <Stat
              index={2}
              label="Next payday"
              rose
              big={
                paydaySecs === null
                  ? "—"
                  : paydaySecs <= 0
                    ? "Now"
                    : board
                      ? weekdayOf(board.headTimestamp + paydaySecs + (now - board.headTimestamp))
                      : "Soon"
              }
              small={paydaySecs === null ? undefined : paydaySecs <= 0 ? "landing" : relativeSoon(paydaySecs)}
              note={
                paydaySecs === null
                  ? `${activeBackers} running`
                  : `${strk(expectedWei)} STRK expected · paid automatically`
              }
            />
          </div>

          {/* ── weeks + link/prices ── */}
          <div className="ad-enter ad-enter-3 grid items-start gap-5 lg:grid-cols-[7fr_5fr]">
            <div className="ad-hair flex flex-col gap-5 p-6">
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <Kicker>Eight weeks</Kicker>
                <span className="ad-mono text-[12px] text-faint">totals only, week by week</span>
              </div>
              {weekMax === 0n ? (
                <p className="py-10 text-center text-[14px] leading-[1.6] text-dim">
                  Nothing to draw yet.
                  <br />
                  Share the link and this fills in, week by week.
                </p>
              ) : (
                <>
                  <div className="grid h-[150px] grid-cols-8 items-end gap-2.5">
                    {weeks.map((w, i) => (
                      <div
                        key={i}
                        className={`ad-grow ${i === 7 ? "ad-bar-rose" : "ad-bar"}`}
                        style={{ height: `${w === 0n ? 2 : Math.max(6, Number((w * 100n) / weekMax))}%`, "--i": i } as React.CSSProperties}
                      />
                    ))}
                  </div>
                  <div className="ad-mono grid grid-cols-8 gap-2.5 text-center text-[11px] text-faint">
                    {weeks.map((w, i) => (
                      <span key={i} className={i === 7 ? "text-rose" : ""}>
                        {strk(w)}
                      </span>
                    ))}
                  </div>
                </>
              )}
              <p className="text-[13px] leading-[1.55] text-dim">
                This page never shows who paid, and neither does anything else.
              </p>
            </div>

            <div className="flex flex-col gap-5">
              <div className="ad-card-rose flex flex-col gap-3.5 p-6">
                <Kicker>Your link</Kicker>
                <div className="flex items-center justify-between gap-4">
                  <span className="ad-mono min-w-0 truncate text-[13px] text-ink">
                    {window.location.host}/join?creator={shortId(creatorId!)}
                  </span>
                  <CopyButton value={shareLink} />
                </div>
                <p className="text-[12px] text-faint">Paste it anywhere. It is the whole storefront.</p>
              </div>
              <div className="ad-hair flex flex-col gap-1 p-6">
                <Kicker dim className="mb-3">
                  Your prices
                </Kicker>
                {(prices.data ?? []).map((t, i) => (
                  <div
                    key={t.index}
                    className={`flex items-center justify-between py-3 ${i > 0 ? "border-t border-line" : ""}`}
                  >
                    <span className="text-[16px] font-[700]" style={{ fontFamily: "var(--font-heading)" }}>
                      {tierName(t.index)}
                    </span>
                    <span className="ad-mono text-[13px] text-dim">{priceLabel(t.amountWei, 352_800)}</span>
                  </div>
                ))}
                <p className="pt-3 text-[12px] text-faint">Prices are fixed for this link. New prices mean a new link.</p>
              </div>
            </div>
          </div>

          <div className="ad-mono flex flex-wrap items-center gap-x-3 gap-y-2 text-[12px] tracking-[0.1em] text-faint uppercase">
            <span>You see income</span>
            <span className="text-rose">·</span>
            <span>Never identities</span>
            <span className="text-rose">·</span>
            <span>Payday runs itself</span>
            <span className="ml-auto flex flex-wrap gap-x-5 normal-case tracking-normal">
              <a
                href="https://github.com/kshitij-hash/nightshift/tree/main/examples/telegram-gate"
                target="_blank"
                rel="noreferrer"
                className="text-dim hover:text-ink"
              >
                Put a door on a Telegram room ↗
              </a>
              <Link to="/creator" search={{ creator: creatorId! }} className="text-dim hover:text-ink">
                The full ledger →
              </Link>
            </span>
          </div>
        </Column>
      </main>
    </Page>
  );
}
