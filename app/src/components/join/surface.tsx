// Join: pick a tier, pick how long, pay once. Everything on screen is real:
// the prices are read from the creator's published ladder, the payment goes
// through the connected wallet's private balance, and the page watches the
// network until the night exists.

import { Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

import { STRK, VAULT, VOYAGER_TX } from "../../config";
import {
  SPAN_OPTIONS,
  cadenceWord,
  creatorFromInput,
  creatorHandle,
  priceLabel,
  spanLabel,
  shortId,
  strk,
  tierName,
} from "../../lib/format";
import { getRpcClient } from "../../lib/rpc-instance";
import { tierOf } from "../../lib/rpc/views";
import { readSchedule } from "../../lib/schedule";
import {
  CADENCES,
  POOL_FEE_STRK,
  feltError,
  subscribeActions,
  type CadenceBlocks,
} from "../../lib/wallet/core";
import { subscribeIdentityFor } from "../../lib/wallet/keys";
import { useWallet } from "../../lib/wallet/session";
import { MaskedAvatar } from "../shell/avatar";
import { Ring, Swap } from "../shell/motion";
import { Column, Facts, Kicker, Page } from "../shell/page";
import { toFailure } from "../wallet/failure";

const LADDER_PROBE = 6;

type LadderTier = { index: number; amountWei: bigint };
type Ladder =
  | { state: "idle" }
  | { state: "reading" }
  | { state: "known"; tiers: LadderTier[] }
  | { state: "unknown-creator" }
  | { state: "unreadable" };

type Phase = "idle" | "checking" | "building" | "confirming" | "settling" | "done";

type Trouble = { title: string; body: string; topUp?: boolean };

export function JoinSurface({ initialCreator }: { initialCreator?: string }) {
  const { ready, openSheet } = useWallet();

  const [creatorInput, setCreatorInput] = useState(initialCreator ?? "");
  const creatorKey = creatorFromInput(creatorInput);
  const creatorProblem = creatorKey === "" ? "empty" : feltError(creatorKey, "id");

  const [ladder, setLadder] = useState<{ key: string; value: Ladder } | null>(null);
  const [tier, setTier] = useState(0);
  const [cadence, setCadence] = useState<CadenceBlocks>(CADENCES[2].blocks);
  const [span, setSpan] = useState<number>(SPAN_OPTIONS[CADENCES[2].blocks]![1]!);
  const [phase, setPhase] = useState<Phase>("idle");
  const [trouble, setTrouble] = useState<Trouble | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const pollRef = useRef<number | null>(null);

  // The creator's published prices.
  useEffect(() => {
    if (creatorProblem) return;
    let cancelled = false;
    void Promise.all(
      Array.from({ length: LADDER_PROBE }, (_, i) => tierOf(getRpcClient(), creatorKey, i)),
    )
      .then((tiers) => {
        if (cancelled) return;
        const known = tiers
          .map((t, index) => ({ index, amountWei: t.amountWei, token: BigInt(t.token) }))
          .filter((t) => t.token !== 0n && t.amountWei > 0n)
          .map(({ index, amountWei }) => ({ index, amountWei }));
        setLadder({
          key: creatorKey,
          value: known.length === 0 ? { state: "unknown-creator" } : { state: "known", tiers: known },
        });
      })
      .catch(() => {
        if (!cancelled) setLadder({ key: creatorKey, value: { state: "unreadable" } });
      });
    return () => {
      cancelled = true;
    };
  }, [creatorKey, creatorProblem]);

  useEffect(
    () => () => {
      if (pollRef.current !== null) window.clearInterval(pollRef.current);
    },
    [],
  );

  const ladderNow: Ladder =
    creatorProblem !== null ? { state: "idle" } : ladder?.key === creatorKey ? ladder.value : { state: "reading" };
  const tiers = ladderNow.state === "known" ? ladderNow.tiers : [];
  const chosen = tiers.find((t) => t.index === tier) ?? tiers[0] ?? null;
  const escrowWei = chosen !== null ? chosen.amountWei * BigInt(span) : 0n;
  const spans = SPAN_OPTIONS[cadence] ?? [4, 12, 24];
  const busy = phase !== "idle" && phase !== "done";

  const pickCadence = (blocks: CadenceBlocks) => {
    setCadence(blocks);
    setSpan(SPAN_OPTIONS[blocks]![1]!);
  };

  const fail = (t: Trouble) => {
    setTrouble(t);
    setPhase("idle");
  };

  const join = async () => {
    if (!ready) {
      openSheet();
      return;
    }
    if (chosen === null || creatorProblem) return;
    setTrouble(null);
    setTxHash(null);
    setPhase("checking");

    const identity = subscribeIdentityFor(creatorKey);
    try {
      const balance = await ready.connection.shieldedBalance(STRK);
      if (balance < escrowWei) {
        fail({
          title: "Nothing was charged.",
          body: `Your private balance holds ${strk(balance)} STRK; this night costs ${strk(escrowWei)} for ${spanLabel(span, cadence)}. Top up, or pick fewer ${cadenceWord(cadence, 2)}.`,
          topUp: true,
        });
        return;
      }
    } catch {
      // the balance could not be read; the wallet will refuse if it is short
    }

    const actions = subscribeActions({
      vault: VAULT,
      token: STRK,
      commitment: identity.commitment,
      creatorId: creatorKey,
      tier: chosen.index,
      periodBlocks: cadence,
      nPeriods: span,
      ownerPub: identity.ownerPub,
      escrowWei,
    });

    setPhase("building");
    try {
      await ready.connection.prepareInvoke(actions);
    } catch (e) {
      const f = toFailure(e);
      fail(
        f.kind === "rejected"
          ? { title: "No problem.", body: "You said no in the wallet, so nothing was charged." }
          : { title: "That didn't go through.", body: `${f.message}. Nothing was charged.` },
      );
      return;
    }

    setPhase("confirming");
    const commitment = identity.commitment;
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      if (pollRef.current !== null) window.clearInterval(pollRef.current);
      setPhase("done");
    };
    pollRef.current = window.setInterval(() => {
      void readSchedule(commitment).then((s) => {
        if (s !== null) finish();
      });
    }, 8000);
    try {
      const hash = await ready.connection.invokeTransaction(actions);
      setTxHash(hash);
      if (!settled) setPhase("settling");
    } catch (e) {
      if (settled) return;
      if (pollRef.current !== null) window.clearInterval(pollRef.current);
      const f = toFailure(e);
      fail(
        f.kind === "rejected"
          ? { title: "No problem.", body: "You said no in the wallet, so nothing was charged." }
          : { title: "That didn't go through.", body: `${f.message}. Nothing was charged unless a receipt is shown.` },
      );
    }
  };

  const handle = creatorProblem ? null : creatorHandle(creatorKey);

  // ── done ──
  if (phase === "done" && chosen !== null) {
    return (
      <Page>
        <main className="flex flex-1 flex-col py-10">
          <Column narrow className="flex flex-col items-center gap-6 text-center">
            <div className="ad-pop">
              <MaskedAvatar size={96} tone="filled" />
            </div>
            <div className="ad-enter ad-enter-2 flex flex-col gap-2">
              <h1 className="ad-display text-[34px]">You're in.</h1>
              <p className="max-w-[30ch] text-[15px] leading-[1.55] text-dim">
                {handle} sees one more backer. Not you. Just one more.
              </p>
            </div>
            <div className="ad-card ad-enter ad-enter-3 flex w-full flex-col gap-3 p-5 text-left">
              <div className="flex items-center justify-between">
                <span className="text-[15px] font-[700]" style={{ fontFamily: "var(--font-heading)" }}>
                  {tierName(chosen.index)}
                </span>
                <span className="ad-mono text-[13px] text-rose">{priceLabel(chosen.amountWei, cadence)}</span>
              </div>
              <div className="flex items-center justify-between ad-mono text-[12px] text-dim">
                <span>{spanLabel(span, cadence)}, funded</span>
                <span>{strk(escrowWei)} STRK</span>
              </div>
              {txHash ? (
                <a href={VOYAGER_TX(txHash)} target="_blank" rel="noreferrer" className="ad-mono text-[12px] text-rose">
                  receipt {shortId(txHash)} ↗
                </a>
              ) : null}
            </div>
            <Link to="/nights" className="ad-pill ad-pill-primary ad-pill-block ad-enter ad-enter-3">
              Open your nights
            </Link>
            <p className="text-[12px] leading-[1.6] text-faint">
              The first charge lands when the first {cadenceWord(cadence)} opens. Cancel any time; unused{" "}
              {cadenceWord(cadence, 2)} come straight back.
            </p>
          </Column>
        </main>
      </Page>
    );
  }

  return (
    <Page>
      <main className="flex flex-1 flex-col py-8 lg:py-10">
        <Column narrow className="flex flex-col gap-6">
          {/* ── the invite ── */}
          <div className="ad-enter flex flex-col items-center gap-4 pt-2 text-center">
            <MaskedAvatar size={96} tone="rose" />
            <div className="flex flex-col items-center gap-1.5">
              <h1 className="ad-display text-[30px]">{handle ?? "Someone"}</h1>
              <p className="text-[14px] leading-[1.5] text-dim">
                invited you to the night side.
                <br />
                Nobody will know you took it.
              </p>
            </div>
          </div>

          {/* ── no link yet ── */}
          {initialCreator === undefined ? (
            <div className="flex flex-col gap-2">
              <Kicker dim>Their link, or their id</Kicker>
              <input
                className="ad-input"
                type="text"
                placeholder="nightshift…/join?creator=0x…"
                value={creatorInput}
                aria-label="creator link or id"
                aria-invalid={creatorInput.trim() !== "" && creatorProblem !== null}
                onChange={(e) => setCreatorInput(e.target.value)}
              />
              {creatorInput.trim() !== "" && creatorProblem ? (
                <p className="text-[12px] text-danger">That is not a NIGHTSHIFT link or id.</p>
              ) : null}
            </div>
          ) : null}

          {/* ── tiers ── */}
          <div className="ad-enter ad-enter-2 flex flex-col gap-3">
            <Kicker dim>Pick your tier</Kicker>
            {ladderNow.state === "known" ? (
              tiers.map((t) => {
                const on = chosen !== null && chosen.index === t.index;
                return (
                  <button
                    key={t.index}
                    type="button"
                    className="ad-option"
                    aria-pressed={on}
                    disabled={busy}
                    onClick={() => setTier(t.index)}
                  >
                    <span className="flex flex-col gap-0.5">
                      <span className={`text-[18px] font-[700] ${on ? "text-ink" : "text-ink-2"}`} style={{ fontFamily: "var(--font-heading)" }}>
                        {tierName(t.index)}
                      </span>
                      <span className="text-[13px] text-dim">
                        {t.index === 0 ? "the feed, after hours" : t.index === 1 ? "everything, plus the room" : "the whole night"}
                      </span>
                    </span>
                    <span className="flex flex-col items-end gap-0.5">
                      <span className={`ad-mono text-[18px] font-[700] ${on ? "text-rose" : "text-ink-2"}`}>{strk(t.amountWei)} STRK</span>
                      <span className="ad-mono text-[11px] text-faint uppercase">/ {cadenceWord(cadence)}</span>
                    </span>
                  </button>
                );
              })
            ) : (
              <div className="ad-hair px-4 py-4 text-[14px] text-dim">
                {ladderNow.state === "reading"
                  ? "Reading their prices…"
                  : ladderNow.state === "unknown-creator"
                    ? "No creator lives at that id. Ask them for a fresh link."
                    : ladderNow.state === "unreadable"
                      ? "Their prices could not be read right now. Try again in a moment."
                      : "Paste the creator's link to see their prices."}
              </div>
            )}
          </div>

          {/* ── cadence + length ── */}
          <div className="ad-enter ad-enter-2 flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Kicker dim>How long</Kicker>
              <div className="flex gap-1">
                {[...CADENCES].reverse().map((c) => (
                  <button
                    key={c.blocks}
                    type="button"
                    className={`ad-chip ${c.blocks === cadence ? "ad-chip-rose" : ""}`}
                    disabled={busy}
                    onClick={() => pickCadence(c.blocks)}
                    aria-pressed={c.blocks === cadence}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex gap-2.5">
              {spans.map((n) => {
                const on = n === span;
                return (
                  <button
                    key={n}
                    type="button"
                    className="ad-pill ad-pill-sm flex-1"
                    disabled={busy}
                    aria-pressed={on}
                    onClick={() => setSpan(n)}
                    style={
                      on
                        ? { background: "var(--ad-rose-wash)", borderColor: "var(--ad-rose)", color: "var(--ad-rose)" }
                        : { borderColor: "var(--ad-line-strong)", color: "var(--ad-dim)" }
                    }
                  >
                    {spanLabel(n, cadence)}
                  </button>
                );
              })}
            </div>
            <p className="text-[12px] leading-[1.5] text-faint">
              You fund it once, up front. Unused {cadenceWord(cadence, 2)} come back to you if you cancel.
            </p>
          </div>

          {/* ── trouble ── */}
          {trouble ? (
            <div className="ad-hair ad-swap flex flex-col gap-2 px-5 py-4" role="alert">
              <span className="ad-kicker ad-kicker-dim">Didn't go through</span>
              <div className="text-[20px] font-[800]" style={{ fontFamily: "var(--font-heading)" }}>
                {trouble.title}
              </div>
              <p className="text-[14px] leading-[1.55] text-dim">{trouble.body}</p>
              {trouble.topUp ? (
                <a
                  href="https://strk20.starknet.io"
                  target="_blank"
                  rel="noreferrer"
                  className="ad-mono text-[12px] tracking-[0.1em] text-rose uppercase"
                >
                  Top up your private balance ↗
                </a>
              ) : null}
            </div>
          ) : null}

          {/* ── the button ── */}
          <div className="ad-enter ad-enter-3 flex flex-col gap-3.5 pt-2">
            <button
              type="button"
              className="ad-pill ad-pill-primary ad-pill-lg ad-pill-block"
              disabled={busy || chosen === null || creatorProblem !== null}
              onClick={() => void join()}
            >
              {busy ? <Ring size={18} /> : null}
              <Swap>
                {phase === "checking"
                  ? "Checking your balance…"
                  : phase === "building"
                    ? "Building your night…"
                    : phase === "confirming"
                      ? "Confirm in your wallet"
                      : phase === "settling"
                        ? "Almost in…"
                        : ready
                          ? `Join privately · ${strk(escrowWei)} STRK`
                          : "Connect a wallet to join"}
              </Swap>
            </button>
            <Facts items={["No name", "No card", "No trace"]} className="justify-center" />
            <p className="text-center text-[12px] leading-[1.6] text-faint">
              <Swap>
                {phase === "settling"
                  ? "Your wallet said yes. The network is writing it down. Usually under a minute; you can leave and it still lands."
                  : phase === "confirming"
                    ? "Approve once. Every renewal after this happens without you."
                    : `Pays privately from your Ready wallet, plus a ${POOL_FEE_STRK} STRK privacy fee, once. Cancel any time.`}
              </Swap>
            </p>
            {txHash && phase === "settling" ? (
              <a href={VOYAGER_TX(txHash)} target="_blank" rel="noreferrer" className="ad-mono text-center text-[11px] text-faint">
                receipt {shortId(txHash)} ↗
              </a>
            ) : null}
          </div>
        </Column>
      </main>
    </Page>
  );
}
