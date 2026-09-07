// Your nights: the creators you back, what is left, when the next charge
// lands, and one tap to stop. Found by this browser alone: the list is built
// from the key stored here, and nothing is uploaded anywhere.

import { Link } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";

import { VAULT, VOYAGER_TX } from "../../config";
import { cadenceWord, creatorHandle, priceLabel, relativeChip, secondsUntilBlock, shortId, strk, tierName } from "../../lib/format";
import { readSchedule } from "../../lib/schedule";
import { coveredCharges, nextChargeBlock, subscriptionState, type Subscription } from "../../lib/subscriptions";
import { cancelCall, reclaimCall } from "../../lib/wallet/core";
import { commitmentsFor, signCancelFor, signReclaimFor } from "../../lib/wallet/keys";
import { useWallet } from "../../lib/wallet/session";
import { useBoard } from "../../query/useBoard";
import { useSubscriptions, useVaultCreators } from "../../query/useSubscriptions";
import { MaskedAvatar } from "../shell/avatar";
import { Swap } from "../shell/motion";
import { Column, Display, Lede, Page } from "../shell/page";
import { Sheet, useNow } from "../shell/sheet";
import { toFailure } from "../wallet/failure";

type ActPhase = "cancelling" | "waiting" | "refunding" | "done" | "failed";
type Act = { commitment: string; phase: ActPhase; message?: string; txHash?: string };

/** Poll until the vault reports the subscription cancelled, or give up. */
async function untilCancelled(commitment: string, tries = 40): Promise<boolean> {
  for (let i = 0; i < tries; i += 1) {
    await new Promise((r) => setTimeout(r, 5000));
    const s = await readSchedule(commitment);
    if (s !== null && s.cancelled) return true;
  }
  return false;
}

function NightCard({
  s,
  headBlock,
  headTimestamp,
  now,
  act,
  onStop,
  index,
}: {
  s: Subscription;
  headBlock: number;
  headTimestamp: number;
  now: number;
  act: Act | null;
  onStop: () => void;
  index: number;
}) {
  const state = subscriptionState(s);
  const live = state === "active";
  const covers = coveredCharges(s);
  const block = nextChargeBlock(s);
  const secs = block === null ? null : secondsUntilBlock(block, headBlock, headTimestamp, now);
  const done = s.schedule.nextPeriod;
  const total = s.schedule.nPeriods;
  const refundable = s.schedule.cancelled && s.schedule.escrowWei > 0n;
  const pb = s.schedule.periodBlocks;
  const unit = cadenceWord(pb);

  const acting = act !== null && act.phase !== "done" && act.phase !== "failed";

  return (
    <div className={`ad-card ad-row flex flex-col ${acting ? "border-rose-line" : ""}`} style={{ "--i": index } as React.CSSProperties}>
      <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-4 sm:px-5">
        <div className="flex items-center gap-3">
          <MaskedAvatar size={40} tone={live ? "rose" : "plain"} />
          <div className="flex flex-col gap-0.5">
            <span className="text-[17px] font-[700]" style={{ fontFamily: "var(--font-heading)" }}>
              {creatorHandle(s.creatorId)}
            </span>
            <span className="ad-mono text-[10px] tracking-[0.08em] text-faint uppercase">
              {tierName(s.schedule.tier)}
              {s.tierPriceWei !== null ? ` · ${priceLabel(s.tierPriceWei, pb)}` : ""}
            </span>
          </div>
        </div>
        {live && secs !== null ? (
          <span className="ad-tag ad-tag-rose">Renews {relativeChip(secs)}</span>
        ) : (
          <span className="ad-tag">{state === "cancelled" ? "Stopped" : "Ended"}</span>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5 sm:px-5">
        <span className="ad-mono text-[12px] text-dim">
          {live
            ? `${unit} ${String(Math.min(done + 1, total)).padStart(2, "0")} of ${total}${covers !== null ? ` · ${strk(s.schedule.escrowWei)} STRK left` : ""}`
            : state === "cancelled"
              ? `stopped after ${unit} ${String(done).padStart(2, "0")} of ${total}${refundable ? ` · ${strk(s.schedule.escrowWei)} STRK to refund` : " · refunded"}`
              : `all ${total} ${cadenceWord(pb, total)} paid`}
        </span>
        {act && acting ? (
          <span className="ad-mono text-[12px] text-rose">
            <Swap>
              {act.phase === "cancelling"
                ? "Confirm in your wallet…"
                : act.phase === "waiting"
                  ? "Stopping…"
                  : "Refunding…"}
            </Swap>
          </span>
        ) : live || refundable ? (
          <button type="button" className="ad-pill ad-pill-quiet ad-pill-sm" onClick={onStop}>
            {refundable ? "Get my refund" : "Cancel"}
          </button>
        ) : null}
      </div>
      {act && (act.phase === "done" || act.phase === "failed") ? (
        <div className="ad-swap block border-t border-line px-4 py-3 text-[12px] leading-[1.55] sm:px-5">
          {act.phase === "done" ? (
            <span className="text-dim">
              Done. The network updates in a minute.{" "}
              {act.txHash ? (
                <a href={VOYAGER_TX(act.txHash)} target="_blank" rel="noreferrer" className="ad-mono text-rose">
                  receipt {shortId(act.txHash)} ↗
                </a>
              ) : null}
            </span>
          ) : (
            <span className="text-dim">{act.message}</span>
          )}
        </div>
      ) : null}
    </div>
  );
}

export function NightsSurface() {
  const { ready, openSheet } = useWallet();
  const queryClient = useQueryClient();
  const board = useBoard().data ?? null;
  const now = useNow();

  const creators = useVaultCreators(ready !== null);
  const candidates = useMemo(
    () => (ready && creators.data ? commitmentsFor(creators.data.creatorIds) : null),
    [ready, creators.data],
  );
  const subs = useSubscriptions(candidates);
  const list = subs.data?.subscriptions ?? [];
  const reading = ready !== null && (creators.isPending || (candidates !== null && candidates.length > 0 && subs.isPending));

  const [acts, setActs] = useState<Record<string, Act>>({});
  const [confirm, setConfirm] = useState<Subscription | null>(null);
  const running = useRef(false);

  const setAct = (commitment: string, patch: Partial<Act>) =>
    setActs((prev) => {
      const base: Act = prev[commitment] ?? { commitment, phase: "cancelling" };
      return { ...prev, [commitment]: { ...base, ...patch } };
    });

  const stop = async (s: Subscription) => {
    if (!ready || running.current) return;
    running.current = true;
    const c = s.commitment;
    try {
      let last: string | undefined;
      if (!s.schedule.cancelled) {
        setAct(c, { phase: "cancelling", message: undefined });
        const signed = signCancelFor(s.creatorId);
        last = await ready.connection.execute(cancelCall(VAULT, signed.commitment, signed.sig));
        setAct(c, { phase: "waiting", txHash: last });
        const ok = await untilCancelled(c);
        if (!ok) {
          setAct(c, { phase: "failed", message: "The stop is taking longer than usual. Check back in a few minutes; the refund button appears once it lands." });
          return;
        }
      }
      if (s.schedule.escrowWei > 0n) {
        setAct(c, { phase: "refunding" });
        const r = signReclaimFor(s.creatorId, ready.connection.address);
        last = await ready.connection.execute(reclaimCall(VAULT, r.commitment, ready.connection.address, r.sig));
      }
      setAct(c, { phase: "done", txHash: last });
      window.setTimeout(() => void queryClient.invalidateQueries({ queryKey: ["subscriptions"] }), 20_000);
    } catch (e) {
      const f = toFailure(e);
      setAct(c, {
        phase: "failed",
        message:
          f.kind === "rejected"
            ? "You said no in the wallet, so nothing changed."
            : `${f.message}. Nothing changed unless a receipt is shown.`,
      });
    } finally {
      running.current = false;
    }
  };

  const active = list.filter((s) => subscriptionState(s) === "active").length;

  return (
    <Page>
      <main className="flex flex-1 flex-col py-8 lg:py-10">
        <Column narrow className="flex flex-col gap-6">
          <div className="ad-enter flex flex-col gap-1.5">
            <Display size="md">Your nights</Display>
            <Lede>
              {ready === null
                ? "Only you can see this page exists."
                : reading
                  ? "Looking for your nights…"
                  : list.length === 0
                    ? "Nothing running yet."
                    : `${active === 0 ? "None" : active === 1 ? "One" : active === 2 ? "Two" : active} running. Only you can see this page exists.`}
            </Lede>
          </div>

          {ready === null ? (
            <div className="ad-card ad-enter ad-enter-2 flex flex-col gap-4 p-6">
              <p className="text-[14px] leading-[1.6] text-dim">
                Your nights live in this browser and show up the moment your wallet is along.
                Nothing is stored anywhere else.
              </p>
              <button type="button" className="ad-pill ad-pill-primary ad-pill-block" onClick={openSheet}>
                Bring a wallet
              </button>
            </div>
          ) : reading ? (
            <div className="flex flex-col gap-4" aria-busy="true">
              <div className="h-28 w-full animate-pulse bg-silhouette motion-reduce:animate-none" />
              <div className="h-28 w-full animate-pulse bg-silhouette motion-reduce:animate-none" />
            </div>
          ) : list.length === 0 ? (
            <div className="ad-card ad-enter ad-enter-2 flex flex-col gap-4 p-6">
              <p className="text-[14px] leading-[1.6] text-dim">
                No nights in this browser yet. A creator's link is the way in; a night you started
                somewhere else lives in that browser.
              </p>
              <Link to="/join" className="ad-pill ad-pill-primary ad-pill-block">
                I have a link
              </Link>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              {list.map((s, i) => (
                <NightCard
                  key={s.commitment}
                  index={i}
                  s={s}
                  headBlock={board?.headBlock ?? s.schedule.startBlock}
                  headTimestamp={board?.headTimestamp ?? now}
                  now={now}
                  act={acts[s.commitment] ?? null}
                  onStop={() => setConfirm(s)}
                />
              ))}
            </div>
          )}

          {subs.data && subs.data.partial.length > 0 ? (
            <p className="text-[12px] leading-[1.5] text-faint">Some of this list could not be read just now. It fills in on its own.</p>
          ) : null}

          <div className="ad-enter ad-enter-3 flex flex-col gap-3 pt-4">
            <p className="text-center text-[12px] leading-[1.6] text-faint">
              Cancelling is instant and nobody can refuse it.
              <br />
              Unused weeks come straight back to you.
            </p>
            <Link to="/join" className="ad-pill ad-pill-ghost ad-pill-block">
              Add another night
            </Link>
          </div>
        </Column>
      </main>

      <Sheet
        open={confirm !== null}
        onOpenChange={(o) => (o ? undefined : setConfirm(null))}
        title={
          confirm && confirm.schedule.cancelled
            ? `Get ${strk(confirm.schedule.escrowWei)} STRK back?`
            : `Stop backing ${confirm ? creatorHandle(confirm.creatorId) : ""}?`
        }
        description={
          confirm ? (
            confirm.schedule.cancelled ? (
              <>The unused {cadenceWord(confirm.schedule.periodBlocks, 2)} come back to your wallet. One confirmation.</>
            ) : confirm.schedule.escrowWei > 0n ? (
              <>
                No further charge will land. The unused {strk(confirm.schedule.escrowWei)} STRK come back to your
                wallet. Two quick confirmations, a few cents of network fee each.
              </>
            ) : (
              <>No further charge will land. One confirmation in your wallet.</>
            )
          ) : null
        }
      >
        <button
          type="button"
          className="ad-pill ad-pill-primary ad-pill-block"
          onClick={() => {
            const s = confirm;
            setConfirm(null);
            if (s) void stop(s);
          }}
        >
          {confirm && confirm.schedule.cancelled ? "Refund me" : "Stop it"}
        </button>
        <button type="button" className="ad-pill ad-pill-quiet" onClick={() => setConfirm(null)}>
          Keep it
        </button>
      </Sheet>
    </Page>
  );
}
