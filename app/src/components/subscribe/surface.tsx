// The subscribe wizard: five steps from a creator id to escrow committed on
// mainnet. Everything on screen is real: the tier ladder is read from the
// vault's tier_of view, the commitment and owner key are derived in this
// browser from the same stored secret /manage lists subscriptions by, and the
// invoke goes through the connected Ready wallet's privacy API with a dry run
// before anything is signed.
//
// The key model is the app's real one, stated rather than dressed up: a
// master secret in this browser's localStorage (demo-grade custody by
// declared scope, PRIVACY.md limitation 5), from which a fresh owner key and
// commitment are derived per creator. There is no mnemonic to write down;
// what there is to lose is this browser's storage, and step three says so.

import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { ScrambleIn } from "../motion/scramble-in";
import { ConnectPanel } from "../wallet/connect-panel";
import { useConnection } from "../wallet/use-connection";
import { toFailure } from "../wallet/failure";
import { Masthead } from "../masthead";
import { SiteFooter } from "../site-footer";
import { DEMO_CREATOR_ID, STRK, VAULT, VOYAGER_CONTRACT, VOYAGER_TX, fmtBlock, truncate } from "../../config";
import { getRpcClient } from "../../lib/rpc-instance";
import { tierOf } from "../../lib/rpc/views";
import { readSchedule } from "../../lib/schedule";
import {
  CADENCES,
  feltError,
  fmtStrk,
  periodsError,
  subscribeActions,
  type CadenceBlocks,
} from "../../lib/wallet/core";
import { storedKeyState, subscribeIdentityFor } from "../../lib/wallet/keys";

const GUTTER = "px-5 lg:px-10";
const STEPS = ["Schedule", "Cost", "Key", "Sign", "Receipt"] as const;
const TITLES = [
  "Pick a schedule",
  "What it costs",
  "Your key",
  "Committing escrow",
  "Subscribed",
] as const;

/** How many tier indices are probed for a creator's ladder. The vault has no
 *  ladder-length view, so the page reads tier_of for each index and keeps the
 *  registered ones. */
const LADDER_PROBE = 6;

type LadderTier = { index: number; amountWei: bigint };
type Ladder =
  | { state: "idle" }
  | { state: "reading" }
  | { state: "known"; tiers: LadderTier[] }
  | { state: "unknown-creator" }
  | { state: "unreadable"; message: string };

type LogLine = { mark: "✓" | "·" | "✕"; text: string };

export function SubscribeSurface({
  /** A creator id handed over by a share link (/subscribe?creator=…), already
   *  felt-validated by the router. It seeds the field; the reader can still
   *  edit it, and the demo-creator fallback stays out of the way. */
  initialCreator,
}: {
  initialCreator?: string;
} = {}) {
  const [step, setStep] = useState(0);
  const [creatorInput, setCreatorInput] = useState(initialCreator ?? "");
  const fromShareLink = initialCreator !== undefined;
  const [ladder, setLadder] = useState<{ key: string; value: Ladder } | null>(null);
  const [tier, setTier] = useState(0);
  const [cadence, setCadence] = useState<CadenceBlocks>(CADENCES[0].blocks);
  const [periodsInput, setPeriodsInput] = useState("3");
  const [backedUp, setBackedUp] = useState(false);
  const [identity, setIdentity] = useState<{ commitment: string; ownerPub: string } | null>(null);
  const [phase, setPhase] = useState<"idle" | "preparing" | "prepared" | "submitting" | "submitted">("idle");
  const [log, setLog] = useState<LogLine[]>([]);
  const [txHash, setTxHash] = useState<string | null>(null);

  const { state, start } = useConnection();
  const connection = state.status === "connected" ? state.connection : null;

  const creatorProblem = creatorInput.trim() === "" ? "paste a creator id" : feltError(creatorInput, "creator id");
  const periodsProblem = periodsError(periodsInput);
  const periods = periodsProblem ? 0 : Number(periodsInput.trim());
  const creatorKey = creatorInput.trim();

  // The ladder read: tier_of for the first LADDER_PROBE indices, in parallel,
  // keeping the registered ones. token 0 everywhere means nobody registered
  // this id, which is a state with a name rather than an empty list.
  // No synchronous "reading" write here: ladderNow below already reads as
  // "reading" whenever the stored read's key is not the current creator.
  useEffect(() => {
    if (creatorProblem) return;
    let cancelled = false;
    void Promise.all(
      Array.from({ length: LADDER_PROBE }, (_, i) => tierOf(getRpcClient(), creatorKey, i)),
    )
      .then((tiers) => {
        if (cancelled) return;
        // token 0 means nobody registered this id; a registered id answers
        // every index with its token, amount 0 past the end of the ladder. A
        // zero-price rung is not a tier anyone can buy, so both are dropped.
        const known = tiers
          .map((t, index) => ({ index, amountWei: t.amountWei, token: BigInt(t.token) }))
          .filter((t) => t.token !== 0n && t.amountWei > 0n)
          .map(({ index, amountWei }) => ({ index, amountWei }));
        setLadder({
          key: creatorKey,
          value: known.length === 0 ? { state: "unknown-creator" } : { state: "known", tiers: known },
        });
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setLadder({
          key: creatorKey,
          value: { state: "unreadable", message: e instanceof Error ? e.message : String(e) },
        });
      });
    return () => {
      cancelled = true;
    };
  }, [creatorKey, creatorProblem]);

  const ladderNow: Ladder =
    creatorProblem !== null ? { state: "idle" } : ladder?.key === creatorKey ? ladder.value : { state: "reading" };
  const tiers = ladderNow.state === "known" ? ladderNow.tiers : [];
  const chosen = tiers.find((t) => t.index === tier) ?? tiers[0] ?? null;
  const cadenceMeta = CADENCES.find((c) => c.blocks === cadence) ?? CADENCES[0];
  const escrowWei = chosen !== null ? chosen.amountWei * BigInt(periods) : 0n;
  // Read directly each render: two localStorage lookups, and the step-3 copy
  // must reflect whether enterKeyStep just created the secret.
  const keys = storedKeyState();

  const schedOk = !creatorProblem && !periodsProblem && chosen !== null && periods > 0;

  const enterKeyStep = () => {
    // Deriving reads (and on first use creates) the master secret, so it
    // happens on this deliberate press and never on page load.
    setIdentity(subscribeIdentityFor(creatorKey));
    setStep(2);
  };

  const runPrepare = async () => {
    if (!connection || !identity) return;
    setPhase("preparing");
    setLog([
      { mark: "✓", text: "subscription code computed in this browser, from your secret" },
      { mark: "✓", text: "a fresh key derived for this creator" },
      { mark: "·", text: "dry run · the wallet is building and proving the transaction" },
    ]);
    try {
      await connection.prepareInvoke(
        subscribeActions({
          vault: VAULT,
          token: STRK,
          commitment: identity.commitment,
          creatorId: creatorKey,
          tier: chosen?.index ?? 0,
          periodBlocks: cadence,
          nPeriods: periods,
          ownerPub: identity.ownerPub,
          escrowWei,
        }),
      );
      setLog((l) => [
        ...l.slice(0, -1),
        { mark: "✓", text: "dry run complete · built and proved, nothing submitted" },
        { mark: "·", text: "sign and submit sends exactly this" },
      ]);
      setPhase("prepared");
    } catch (e) {
      const f = toFailure(e);
      setLog((l) => [...l.slice(0, -1), { mark: "✕", text: `dry run refused: ${f.message}` }]);
      setPhase("idle");
    }
  };

  const runSubmit = async () => {
    if (!connection || !identity) return;
    setPhase("submitting");
    setLog((l) => [
      ...l,
      { mark: "·", text: "one wallet signature" },
      { mark: "·", text: "the wallet does the private work, which can take a minute or two" },
    ]);

    // Watch the vault while the wallet works: its promise can resolve well
    // after the transaction lands, and the chain is the truer signal. The
    // moment schedule_of answers for this commitment, the receipt is earned.
    const commitment = identity.commitment;
    let settled = false;
    const poll = window.setInterval(() => {
      void readSchedule(commitment).then((s) => {
        if (s === null || settled) return;
        settled = true;
        window.clearInterval(poll);
        setLog((l) => [
          ...l,
          { mark: "✓", text: "confirmed by reading the vault: the schedule exists on chain" },
        ]);
        setPhase("submitted");
        setStep(4);
      });
    }, 8000);
    try {
      const hash = await connection.invokeTransaction(
        subscribeActions({
          vault: VAULT,
          token: STRK,
          commitment: identity.commitment,
          creatorId: creatorKey,
          tier: chosen?.index ?? 0,
          periodBlocks: cadence,
          nPeriods: periods,
          ownerPub: identity.ownerPub,
          escrowWei,
        }),
      );
      setTxHash(hash);
      setLog((l) => [
        ...l.slice(0, -1),
        { mark: "✓", text: "escrow landed in the vault" },
        { mark: "✓", text: `submitted · ${truncate(hash)}` },
      ]);
      setPhase("submitted");
      setStep(4);
    } catch (e) {
      if (!settled) {
        const f = toFailure(e);
        setLog((l) => [...l.slice(0, -1), { mark: "✕", text: `not submitted: ${f.message}` }]);
        setPhase("prepared");
      }
    } finally {
      settled = true;
      window.clearInterval(poll);
    }
  };

  const next = () => {
    if (step === 0 && schedOk) setStep(1);
    else if (step === 1) enterKeyStep();
    else if (step === 2 && backedUp) setStep(3);
  };

  const nextBlocked = (step === 0 && !schedOk) || (step === 2 && !backedUp);
  const showNext = step <= 2;

  return (
    <div className="flex min-h-screen flex-col">
      <Masthead
        active="subscribe"
        chip={
          connection ? (
            <span className="flex items-center gap-2.5 border border-divider px-3 py-1.5">
              <span className="block h-[7px] w-[7px] bg-ns-accent" />
              <span className="font-mono text-[12px]">{truncate(connection.address)}</span>
              <span className="text-[10px] tracking-[0.1em] uppercase text-text-caption max-md:hidden">
                Ready wallet
              </span>
            </span>
          ) : undefined
        }
      />

      <main className={`${GUTTER} flex-1 py-9`}>
        <div className="flex flex-wrap items-end gap-6 border-b-2 border-divider pb-5">
          <div>
            <div className="mb-2.5 text-[11px] tracking-[0.14em] uppercase text-ns-accent">
              ▸ Step {step + 1} of 5 · {STEPS[step]}
            </div>
            <h2 className="text-[30px] tracking-[-0.03em] lg:text-[38px]">{TITLES[step]}</h2>
          </div>
          <div className="ml-auto flex gap-2 max-md:hidden">
            {STEPS.map((label, i) => (
              <div key={label} className="w-[68px]">
                <div className="h-1 bg-neutral-300">
                  <div
                    className="m-fill h-full bg-ns-accent"
                    style={{ transform: i <= step ? "scaleX(1)" : "scaleX(0)" }}
                  />
                </div>
                <div
                  className={`mt-2 text-[9.5px] tracking-[0.06em] whitespace-nowrap uppercase ${i <= step ? "text-ink" : "text-text-caption"}`}
                >
                  {label}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-7 grid border-2 border-divider lg:grid-cols-[7fr_5fr]">
          <div className="p-6 lg:p-8">
            {/* ── 01 · schedule ── */}
            {step === 0 ? (
              <div>
                <div className="m-field mb-5 max-w-[460px]">
                  <label htmlFor="sub-creator">Creator id, shared with you by the creator</label>
                  <input
                    id="sub-creator"
                    className="m-input font-mono"
                    type="text"
                    placeholder="0x…"
                    value={creatorInput}
                    onChange={(e) => setCreatorInput(e.target.value)}
                  />
                  {creatorInput.trim() !== "" && creatorProblem ? (
                    <div className="mt-1.5 text-[12px] text-accent-700">{creatorProblem}</div>
                  ) : null}
                  {fromShareLink ? (
                    <div className="mt-2.5 text-[12px] text-text-caption">
                      filled in by the creator's link · their prices load below
                    </div>
                  ) : (
                    <div className="mt-2.5 flex flex-wrap items-center gap-2.5">
                      <button
                        type="button"
                        className="m-btn m-btn-secondary text-[12.5px]"
                        style={{ padding: "5px 10px" }}
                        onClick={() => setCreatorInput(DEMO_CREATOR_ID)}
                      >
                        No creator in mind? Try the demo one
                      </button>
                      <span className="text-[12px] text-text-caption">
                        registered on the live vault, 1 STRK per period
                      </span>
                    </div>
                  )}
                </div>

                <div className="mb-3 text-[11px] tracking-[0.1em] uppercase text-text-caption">
                  Tier · the creator's published prices
                </div>
                {ladderNow.state === "known" ? (
                  <div className="mb-6 flex flex-col border border-divider">
                    {tiers.map((t, i) => {
                      const on = chosen !== null && chosen.index === t.index;
                      return (
                        <button
                          key={t.index}
                          type="button"
                          onClick={() => setTier(t.index)}
                          className={`flex cursor-pointer items-center gap-4 px-4 py-3.5 text-left ${i > 0 ? "border-t border-divider" : ""} ${on ? "bg-neutral-900 text-ground" : ""}`}
                        >
                          <span
                            className="block h-[13px] w-[13px] shrink-0 border-2"
                            style={{
                              borderColor: on ? "var(--m-accent)" : "var(--m-divider)",
                              background: on ? "var(--m-accent)" : "transparent",
                            }}
                          />
                          <span className="font-mono text-[12px] opacity-70">tier {t.index}</span>
                          <span
                            className="ml-auto text-[18px] font-[800]"
                            style={{ fontFamily: "var(--font-heading)" }}
                          >
                            {fmtStrk(t.amountWei)} STRK
                          </span>
                          <span className="text-[12px] opacity-70">/ period</span>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div className="mb-6 border border-divider px-4 py-3.5 text-[13px] text-text-label">
                    {ladderNow.state === "reading"
                      ? "reading the creator's prices…"
                      : ladderNow.state === "unknown-creator"
                        ? "no creator is registered at this id"
                        : ladderNow.state === "unreadable"
                          ? `the prices could not be read: ${ladderNow.message}`
                          : "paste a creator id to see their prices"}
                  </div>
                )}

                <div className="mb-3 text-[11px] tracking-[0.1em] uppercase text-text-caption">
                  Billing period
                </div>
                <div className="mb-6 flex flex-col border border-divider sm:flex-row">
                  {CADENCES.map((c, i) => {
                    const on = c.blocks === cadence;
                    return (
                      <button
                        key={c.blocks}
                        type="button"
                        onClick={() => setCadence(c.blocks)}
                        className={`flex-1 cursor-pointer px-4 py-3.5 text-left ${i > 0 ? "max-sm:border-t sm:border-l border-divider" : ""} ${on ? "bg-ns-accent text-ground" : ""}`}
                      >
                        <span
                          className="block text-[16px] font-[800] capitalize"
                          style={{ fontFamily: "var(--font-heading)" }}
                        >
                          {c.label}
                        </span>
                        <span className="mt-1 block font-mono text-[12px] opacity-75">
                          {fmtBlock(c.blocks)} blocks
                        </span>
                      </button>
                    );
                  })}
                </div>

                <div className="flex flex-wrap items-end gap-5">
                  <div className="m-field w-[150px]">
                    <label htmlFor="sub-periods">Periods to escrow</label>
                    <input
                      id="sub-periods"
                      className="m-input"
                      type="text"
                      inputMode="numeric"
                      value={periodsInput}
                      onChange={(e) => setPeriodsInput(e.target.value)}
                    />
                    {periodsProblem ? (
                      <div className="mt-1.5 text-[12px] text-accent-700">{periodsProblem}</div>
                    ) : null}
                  </div>
                  <div className="max-w-[44ch] text-[13px] leading-[1.55] text-text-prose">
                    Prices and periods come from a small fixed menu, so a
                    schedule can never fingerprint the person who chose it.
                  </div>
                </div>
              </div>
            ) : null}

            {/* ── 02 · cost ── */}
            {step === 1 && chosen !== null ? (
              <div>
                <div className="mb-5 flex flex-col border border-divider">
                  {(
                    [
                      [`tier ${chosen.index}`, `${fmtStrk(chosen.amountWei)} STRK per period`],
                      [
                        `${periods} × ${cadenceMeta.label} period`,
                        `${fmtBlock(cadence)} blocks each · ${cadenceMeta.note.split(", ")[1] ?? ""}`,
                      ],
                      ["Escrow committed now", `${fmtStrk(escrowWei)} STRK`],
                      ["Privacy pool fee", "6.00 STRK · charged by the pool, from your public balance"],
                      ["Your gas, this transaction only", "≈ 0.10 STRK"],
                    ] as Array<[string, string]>
                  ).map(([k, v], i) => (
                    <div
                      key={k}
                      className={`flex justify-between gap-4 px-4 py-3.5 text-[14px] ${i > 0 ? "border-t border-divider" : ""}`}
                    >
                      <span className="opacity-70">{k}</span>
                      <span className={i === 2 ? "font-[800]" : ""} style={i === 2 ? { fontFamily: "var(--font-heading)" } : undefined}>
                        {v}
                      </span>
                    </div>
                  ))}
                  <div className="flex justify-between gap-4 border-t-2 border-divider bg-ground px-4 py-3.5 text-[14px]">
                    <span className="font-[800]" style={{ fontFamily: "var(--font-heading)" }}>
                      Total leaving your balances
                    </span>
                    <span className="text-[17px] font-[800]" style={{ fontFamily: "var(--font-heading)" }}>
                      ≈ {fmtStrk(escrowWei + 6_100_000_000_000_000_000n)} STRK
                    </span>
                  </div>
                </div>

                <div className="grid border-2 border-divider sm:grid-cols-2">
                  <div className="p-5">
                    <div className="mb-3 text-[11px] tracking-[0.1em] uppercase text-ns-accent">
                      What the vault can do with it
                    </div>
                    <div className="flex flex-col gap-2 text-[13px] leading-[1.45]">
                      <div>Move {fmtStrk(chosen.amountWei)} STRK to creator {truncate(creatorKey)}</div>
                      <div>Once per {fmtBlock(cadence)} blocks, {periods} times</div>
                      <div>Never before the block arrives</div>
                      <div>Never twice for one period</div>
                      <div>Never past the escrow</div>
                    </div>
                  </div>
                  <div className="bg-panel p-5 max-sm:border-t-2 sm:border-l-2 border-divider">
                    <div className="mb-3 text-[11px] tracking-[0.1em] uppercase opacity-55">
                      What you are not signing away
                    </div>
                    <div className="flex flex-col gap-2 text-[13px] leading-[1.45] opacity-75">
                      <div>No session key</div>
                      <div>No standing allowance</div>
                      <div>No delegation</div>
                      <div>
                        Your shielded balance can never be pulled from; only this
                        escrow can ever be charged
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ) : null}

            {/* ── 03 · key ── */}
            {step === 2 && identity !== null ? (
              <div>
                <p className="mb-5 max-w-[58ch] text-[15px] leading-[1.6]">
                  Your subscription is identified by a code computed here, in
                  this browser. The secret behind it never leaves this machine
                  and is never sent anywhere: not to us, not to the creator,
                  not to the chain.
                </p>
                <div className="mb-4 bg-neutral-900 p-5 font-mono text-[12.5px] leading-[1.9] break-all text-neutral-200">
                  <div className="mb-2.5 text-[11px] tracking-[0.1em] uppercase opacity-55">
                    Derived for this creator
                  </div>
                  <div>
                    commitment&nbsp; <ScrambleIn text={identity.commitment} speed={8} />
                  </div>
                  <div>
                    owner key&nbsp;&nbsp;{" "}
                    <ScrambleIn text={identity.ownerPub} speed={8} startDelay={250} />
                  </div>
                </div>
                <p className="mb-4 max-w-[58ch] text-[13px] leading-[1.6] text-text-prose">
                  {keys.secret
                    ? "The key behind these was already on this machine; the same one lists your subscriptions on the manage page."
                    : "A key was just created in this browser's storage. It is the only copy."}{" "}
                  Every creator you subscribe to gets its own fresh key and
                  code, so your subscriptions can never be linked to each
                  other.
                </p>
                <div className="flex items-start gap-3.5 border-2 border-ns-accent p-4">
                  <span className="font-[800] text-ns-accent" style={{ fontFamily: "var(--font-heading)" }}>
                    !
                  </span>
                  <div>
                    <div className="mb-3 text-[13.5px] leading-[1.55]">
                      Lose this browser's storage and the subscription is
                      unreachable. There is no account to log back into and no
                      support path: cancel and reclaim are authorized by a key
                      derived from this secret, so without it the escrow charges
                      out to the creator on schedule and the remainder can never
                      be reclaimed.
                    </div>
                    <label className="flex cursor-pointer items-start gap-2.5 text-[13.5px]">
                      <input
                        type="checkbox"
                        checked={backedUp}
                        onChange={(e) => setBackedUp(e.target.checked)}
                        className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--m-accent)]"
                      />
                      I understand this browser holds the only key that can
                      cancel or reclaim
                    </label>
                  </div>
                </div>
              </div>
            ) : null}

            {/* ── 04 · invoke ── */}
            {step === 3 ? (
              <div>
                {connection === null ? (
                  <div className="max-w-[480px]">
                    <p className="mb-4 text-[14px] leading-[1.6] text-text-prose">
                      Your wallet builds and proves the private transaction
                      that moves the escrow. Nothing before this step needed a
                      wallet at all.
                    </p>
                    <div className="mb-4 flex flex-col gap-1.5 border border-divider p-4 text-[13px] leading-[1.55]">
                      <div className="mb-1 text-[11px] tracking-[0.1em] uppercase text-text-caption">
                        What you need
                      </div>
                      <div>
                        A{" "}
                        <a href="https://www.ready.co" target="_blank" rel="noreferrer">
                          Ready wallet ↗
                        </a>{" "}
                        with the privacy API, holding STRK.
                      </div>
                      <div>
                        A shielded balance covering the escrow: shield STRK at{" "}
                        <a href="https://strk20.starknet.io" target="_blank" rel="noreferrer">
                          strk20.starknet.io ↗
                        </a>
                        .
                      </div>
                      <div>
                        The pool's 6 STRK fee comes from your public balance,
                        so keep both sides funded.
                      </div>
                    </div>
                    <ConnectPanel state={state} onConnect={() => void start()} onDisconnect={() => {}} />
                  </div>
                ) : (
                  <div>
                    <div className="mb-4 text-[11px] tracking-[0.1em] uppercase text-ns-accent">
                      Your wallet does the private part
                    </div>
                    {log.length > 0 ? (
                      <div className="mb-5 flex flex-col gap-2 font-mono text-[12.5px]">
                        {log.map((l) => (
                          <div key={l.text} className="flex gap-2.5">
                            <span className={l.mark === "✕" ? "text-accent-700" : "text-ns-accent"}>
                              {l.mark}
                            </span>
                            <span className="opacity-85">{l.text}</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="mb-5 max-w-[56ch] text-[14px] leading-[1.6] text-text-prose">
                        A dry run comes first: the wallet builds the batch and
                        proves it, then stops. Nothing is signed and nothing is
                        submitted until the second press.
                      </p>
                    )}
                    <div className="flex flex-wrap gap-3">
                      <button
                        type="button"
                        className={`m-btn ${phase === "idle" ? "m-btn-primary" : "m-btn-secondary"}`}
                        disabled={phase !== "idle"}
                        onClick={() => void runPrepare()}
                      >
                        {phase === "preparing" ? "Running dry run…" : "Run the dry run"}
                      </button>
                      <button
                        type="button"
                        className="m-btn m-btn-primary"
                        disabled={phase !== "prepared"}
                        onClick={() => void runSubmit()}
                      >
                        {phase === "submitting"
                          ? "Waiting for the wallet…"
                          : `Sign and submit ${fmtStrk(escrowWei)} STRK`}
                      </button>
                    </div>
                    <p className="mt-3 text-[12px] text-text-caption">
                      The 6 STRK pool fee is drawn from the account's public
                      balance; the escrow leaves the shielded one. This page
                      never holds a key that can move funds.
                    </p>
                  </div>
                )}
              </div>
            ) : null}

            {/* ── 05 · receipt ── */}
            {step === 4 && identity !== null ? (
              <div>
                <div className="mb-4 flex items-center gap-3">
                  <span
                    className="grid h-8 w-8 place-items-center bg-ns-accent text-[17px] font-[800] text-ground"
                    style={{ fontFamily: "var(--font-heading)" }}
                  >
                    ✓
                  </span>
                  <h3 className="text-[26px] tracking-[-0.025em]">Escrow committed</h3>
                </div>
                <div className="mb-5 font-mono text-[12px] leading-[2] break-all">
                  <div>commitment&nbsp; {identity.commitment}</div>
                  <div>
                    subscribe&nbsp;&nbsp;{" "}
                    {txHash !== null ? (
                      <a href={VOYAGER_TX(txHash)} target="_blank" rel="noreferrer">
                        {truncate(txHash)} ↗
                      </a>
                    ) : (
                      <>
                        landed ·{" "}
                        <a
                          href={`${VOYAGER_CONTRACT(VAULT)}#events`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          vault events ↗
                        </a>
                      </>
                    )}
                  </div>
                  <div>
                    escrow&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; {fmtStrk(escrowWei)} STRK · {periods}{" "}
                    periods of {fmtBlock(cadence)} blocks
                  </div>
                  <div>owner key&nbsp;&nbsp; recorded, fresh for this creator</div>
                </div>
                <div className="mb-5 flex flex-col border border-divider">
                  {(
                    [
                      [
                        "First charge",
                        "Any time after the first period window opens. Anyone may fire it; the keeper cron usually does.",
                      ],
                      [
                        "The chain now shows",
                        `The vault received ${fmtStrk(escrowWei)} STRK from the pool, and this commitment hash.`,
                      ],
                      ["It does not show", "Which shielded balance the escrow came from."],
                      [
                        "Gate access",
                        "Available once period 0 has been charged: a just-subscribed schedule cannot present yet.",
                      ],
                    ] as Array<[string, string]>
                  ).map(([k, v], i) => (
                    <div
                      key={k}
                      className={`grid gap-3.5 px-4 py-3 text-[13px] sm:grid-cols-[170px_1fr] ${i > 0 ? "border-t border-divider" : ""}`}
                    >
                      <span className="opacity-60">{k}</span>
                      <span>{v}</span>
                    </div>
                  ))}
                </div>
                <div className="flex flex-wrap gap-3">
                  <Link to="/manage" className="m-btn m-btn-primary">
                    Manage subscriptions →
                  </Link>
                  <Link to="/verify" className="m-btn m-btn-secondary">
                    Prove it to a gate
                  </Link>
                </div>
              </div>
            ) : null}

            {/* ── nav ── */}
            {step <= 3 ? (
              <div className="mt-7 flex gap-2.5 border-t-2 border-divider pt-5">
                <button
                  type="button"
                  className="m-btn m-btn-secondary"
                  disabled={step === 0 || phase === "submitting" || phase === "preparing"}
                  onClick={() => setStep((s) => Math.max(0, s - 1))}
                >
                  ← Back
                </button>
                {showNext ? (
                  <button
                    type="button"
                    className="m-btn m-btn-primary ml-auto"
                    disabled={nextBlocked}
                    onClick={next}
                  >
                    {step === 2 ? "Continue to sign" : "Continue →"}
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>

          {/* ── side rail ── */}
          <div className="border-t-2 border-divider bg-panel p-6 lg:border-t-0 lg:border-l-2 lg:p-7">
            <div className="mb-4 text-[11px] tracking-[0.1em] uppercase text-ns-accent">
              ▸ What the chain will see
            </div>
            <div className="border border-divider bg-ground p-4 font-mono text-[12px] leading-[2] break-all">
              <div>Subscribe {"{"}</div>
              <div>&nbsp;&nbsp;commitment&nbsp;&nbsp;&nbsp; {identity ? truncate(identity.commitment) : "derived at step 3"}</div>
              <div>&nbsp;&nbsp;creator_id&nbsp;&nbsp;&nbsp; {creatorProblem ? "—" : truncate(creatorKey)}</div>
              <div>&nbsp;&nbsp;tier&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; {chosen !== null ? chosen.index : "—"}</div>
              <div>&nbsp;&nbsp;period_blocks {fmtBlock(cadence)}</div>
              <div>&nbsp;&nbsp;n_periods&nbsp;&nbsp;&nbsp;&nbsp; {periods || "—"}</div>
              <div>&nbsp;&nbsp;owner_key&nbsp;&nbsp;&nbsp;&nbsp; {identity ? truncate(identity.ownerPub) : "derived at step 3"}</div>
              <div>{"}"}</div>
            </div>
            <div className="mt-4 text-[12.5px] leading-[1.6] text-text-prose">
              All of it is public, which is why it comes from a fixed menu.
              What is not here: your address, your secret, and any link between
              the two.
            </div>
            <div className="my-5 h-0.5 bg-divider" />
            <div className="mb-3 text-[11px] tracking-[0.1em] uppercase text-text-caption">
              One key per creator
            </div>
            <div className="text-[12.5px] leading-[1.6] text-text-prose">
              A fresh key and code are derived for every creator you subscribe
              to, so no two of your subscriptions can be tied to each other.
            </div>
          </div>
        </div>
      </main>

      <SiteFooter
        className="mt-0"
        links={[
          { label: "the board", to: "/board" },
          { label: "source on github", href: "https://github.com/kshitij-hash/nightshift" },
        ]}
      />
    </div>
  );
}
