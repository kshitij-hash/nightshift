// Start earning: name a price, go live in one transaction, get a link.
//
// This side of the product is public on purpose: a creator nobody can find is
// a creator nobody can pay. The id is computed from the wallet the moment it
// connects, so a creator who already went live lands in their room instead
// of being walked into a duplicate.

import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

import { STRK, VAULT } from "../../config";
import { tierName } from "../../lib/format";
import { getRpcClient } from "../../lib/rpc-instance";
import { tierOf } from "../../lib/rpc/views";
import { registerCreatorCall, strkToWei } from "../../lib/wallet/core";
import { useWallet } from "../../lib/wallet/session";
import { Ring, Swap } from "../shell/motion";
import { Column, Display, Kicker, Page } from "../shell/page";
import { toFailure } from "../wallet/failure";

const MAX_TIERS = 3;

const tierProblem = (raw: string): string | null => {
  if (raw.trim() === "") return "Set a price.";
  const wei = strkToWei(raw);
  if (wei === null) return "A number, at most two decimals.";
  if (wei === 0n) return "Free is not a tier anyone can buy.";
  return null;
};

type Registration = "checking" | "no" | "yes" | "unreadable";

export function StartSurface() {
  const { ready, openSheet } = useWallet();
  const navigate = useNavigate();
  const [tiers, setTiers] = useState<string[]>(["3"]);
  const [phase, setPhase] = useState<"form" | "submitting" | "waiting">("form");
  const [trouble, setTrouble] = useState<string | null>(null);
  const [registration, setRegistration] = useState<{ key: string; value: Registration } | null>(null);
  const pollRef = useRef<number | null>(null);

  const problems = tiers.map(tierProblem);
  const tiersOk = problems.every((p) => p === null);
  const tiersWei = tiersOk ? tiers.map((t) => strkToWei(t)!) : [];

  const creatorId = ready?.identity.creatorId ?? null;
  useEffect(() => {
    if (creatorId === null) return;
    let cancelled = false;
    void tierOf(getRpcClient(), creatorId, 0)
      .then((t) => {
        if (cancelled) return;
        const yes = BigInt(t.token) !== 0n && t.amountWei > 0n;
        setRegistration({ key: creatorId, value: yes ? "yes" : "no" });
      })
      .catch(() => {
        if (!cancelled) setRegistration({ key: creatorId, value: "unreadable" });
      });
    return () => {
      cancelled = true;
    };
  }, [creatorId]);
  const reg: Registration =
    creatorId === null ? "checking" : registration?.key === creatorId ? registration.value : "checking";

  // Already live: the room is the place, not this form.
  useEffect(() => {
    if (reg === "yes" && phase === "form") void navigate({ to: "/room" });
  }, [reg, phase, navigate]);

  useEffect(
    () => () => {
      if (pollRef.current !== null) window.clearInterval(pollRef.current);
    },
    [],
  );

  const goLive = async () => {
    if (!ready) {
      openSheet();
      return;
    }
    if (!tiersOk || reg !== "no") return;
    setTrouble(null);
    setPhase("submitting");
    const id = ready.identity.creatorId;
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      if (pollRef.current !== null) window.clearInterval(pollRef.current);
      void navigate({ to: "/room", search: { fresh: "1" } });
    };
    pollRef.current = window.setInterval(() => {
      void tierOf(getRpcClient(), id, 0).then((t) => {
        if (BigInt(t.token) !== 0n) finish();
      });
    }, 5000);
    try {
      await ready.connection.execute(registerCreatorCall(VAULT, STRK, ready.identity.payoutPub, tiersWei));
      if (!settled) setPhase("waiting");
    } catch (e) {
      if (settled) return;
      if (pollRef.current !== null) window.clearInterval(pollRef.current);
      const f = toFailure(e);
      setTrouble(f.kind === "rejected" ? "You said no in the wallet, so nothing happened." : `${f.message}. Nothing was sent.`);
      setPhase("form");
    }
  };

  const busy = phase !== "form";

  return (
    <Page>
      <main className="flex flex-1 flex-col py-12 lg:py-16">
        <Column className="grid items-start gap-12 lg:grid-cols-2 lg:gap-14">
          {/* ── pitch ── */}
          <div className="ad-enter flex flex-col gap-7">
            <Kicker>For creators · go live in 60 seconds</Kicker>
            <Display size="lg">
              Your fans,
              <br />
              invisible.
              <br />
              Your income,
              <br />
              <span className="ad-mark">on time.</span>
            </Display>
            <p className="max-w-[44ch] text-[17px] leading-[1.6] text-dim">
              Some audiences can't be seen supporting you, and today, they don't. Give them a door
              nobody sees them walk through. You set a price and share a link; the rest runs
              itself.
            </p>
            <div className="flex flex-col gap-4">
              {[
                ["01", "Name your price.", "One tier or three, yours to set, public like a menu."],
                ["02", "Share one link.", "Bio, pinned post, DM. It's the whole storefront."],
                ["03", "Get paid on schedule.", "Income lands as totals. Identities were never collected."],
              ].map(([n, head, body]) => (
                <div key={n} className="flex items-baseline gap-4">
                  <span className="ad-mono w-7 shrink-0 text-[13px] text-rose">{n}</span>
                  <span className="text-[16px] text-ink-2">
                    <span className="font-[600] text-ink">{head}</span> {body}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* ── the card ── */}
          <div className="ad-enter ad-enter-2 flex flex-col gap-5">
            <div className="ad-card flex flex-col gap-5 p-6 lg:p-8">
              <Kicker>Set your price</Kicker>
              <div className="flex flex-col gap-3">
                {tiers.map((value, i) => (
                  <div key={i} className="flex flex-col gap-1.5">
                    <div className="flex items-center gap-3">
                      <div className="relative flex-1">
                        <input
                          className="ad-input pr-28"
                          type="text"
                          inputMode="decimal"
                          value={value}
                          disabled={busy}
                          aria-label={`${tierName(i)} price in STRK`}
                          aria-invalid={value.trim() !== "" && problems[i] !== null}
                          onChange={(e) => {
                            const next = [...tiers];
                            next[i] = e.target.value;
                            setTiers(next);
                          }}
                        />
                        <span className="ad-mono pointer-events-none absolute top-1/2 right-4 -translate-y-1/2 text-[12px] text-faint">
                          STRK / WEEK
                        </span>
                      </div>
                      <span className="w-[10ch] text-[13px] text-dim">{tierName(i)}</span>
                      {i > 0 && !busy ? (
                        <button
                          type="button"
                          className="ad-chip"
                          aria-label={`remove ${tierName(i)}`}
                          onClick={() => setTiers(tiers.filter((_, j) => j !== i))}
                        >
                          ×
                        </button>
                      ) : null}
                    </div>
                    {value.trim() !== "" && problems[i] ? (
                      <p className="text-[12px] text-danger">{problems[i]}</p>
                    ) : null}
                  </div>
                ))}
                {tiers.length < MAX_TIERS && !busy ? (
                  <button
                    type="button"
                    className="self-start text-[13px] font-[600] text-dim hover:text-ink"
                    onClick={() => setTiers([...tiers, ""])}
                  >
                    + add a tier
                  </button>
                ) : null}
              </div>

              {trouble ? (
                <p className="ad-swap block text-[13px] leading-[1.55] text-dim" role="alert">
                  {trouble}
                </p>
              ) : null}

              <button
                type="button"
                className="ad-pill ad-pill-primary ad-pill-lg ad-pill-block"
                disabled={busy || (ready !== null && (!tiersOk || reg === "checking" || reg === "unreadable"))}
                onClick={() => void goLive()}
              >
                {busy ? <Ring size={18} /> : null}
                <Swap>
                  {phase === "submitting"
                    ? "Confirm in your wallet"
                    : phase === "waiting"
                      ? "Going live…"
                      : ready === null
                        ? "Connect to go live"
                        : reg === "checking"
                          ? "Checking…"
                          : "Go live · one transaction"}
                </Swap>
              </button>
              <p className="text-center text-[12px] leading-[1.6] text-faint">
                {reg === "unreadable"
                  ? "The network could not be read just now. Try again in a moment."
                  : "Costs about 0.1 STRK, once · prices are permanent for this link. A fan pays the same each week, day or hour, whichever they pick."}
              </p>
            </div>

            <div className="ad-hair ad-enter ad-enter-3 grid grid-cols-3 gap-4 p-6">
              {[
                ["This week", "36 STRK", ""],
                ["Backers", "12", "masked"],
                ["On time", "100%", ""],
              ].map(([label, big, small]) => (
                <div key={label} className="flex flex-col gap-1">
                  <span className="ad-mono text-[10px] tracking-[0.16em] text-faint uppercase">{label}</span>
                  <span className={`ad-display text-[24px] ${label === "On time" ? "text-rose" : ""}`}>
                    {big} {small ? <span className="text-[12px] font-[400] text-dim">{small}</span> : null}
                  </span>
                </div>
              ))}
              <p className="col-span-3 text-[12px] text-faint">How a room reads once fans arrive.</p>
            </div>
          </div>
        </Column>
      </main>
    </Page>
  );
}
