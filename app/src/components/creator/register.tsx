// Become a creator: set 1-3 tier prices, send one public transaction, walk
// away with a creator id and a share link. This is the creator's whole
// onboarding, and it is deliberately the mirror image of subscribing: the
// subscriber's side is private and this side is public, because an id nobody
// can find is an id nobody can pay.
//
// THE IDENTITY. creator_id = poseidon(wallet address, token, payout key), and
// the vault computes that hash itself inside register_creator with the caller
// as the wallet. So the id shown before submitting is a prediction of an
// on-chain value, not a name this page picks - and the same wallet, token and
// payout key can register exactly once (the vault refuses a duplicate). That
// is why this surface checks the chain for an existing registration the
// moment a wallet connects, and turns into the share card instead of walking
// a registered creator into a revert.
//
// Everything rendered here is public or derived-public: the payout key's
// public half, the predicted id, the ladder. The payout private key stays in
// lib/wallet/keys.ts's storage and is never passed to, held by, or rendered
// from this component.

import { Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

import { STRK, VAULT, VOYAGER_TX, truncate } from "../../config";
import { getRpcClient } from "../../lib/rpc-instance";
import { tierOf } from "../../lib/rpc/views";
import { fmtStrk, registerCreatorCall, strkToWei } from "../../lib/wallet/core";
import { Masthead } from "../masthead";
import { SiteFooter } from "../site-footer";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { ConnectPanel } from "../wallet/connect-panel";
import { FailureNote, toFailure, type Failure } from "../wallet/failure";
import {
  CopyValue,
  Field,
  KeyValue,
  Narration,
  SectionHead,
  Step,
  TextInput,
  type NarrationLine,
} from "../wallet/primitives";
import { useConnection } from "../wallet/use-connection";

const GUTTER = "px-5 lg:px-10";
const MAX_TIERS = 3;
/** How many tier indices are probed when showing an existing registration.
 *  The vault accepts up to 8 and has no ladder-length view. */
const LADDER_PROBE = 8;

/** What the chain answered about this wallet's creator id. Kept with the id
 *  it was read for, so a reconnect under a different account cannot show the
 *  previous account's answer. */
type Registration =
  | { state: "checking" }
  | { state: "no" }
  | { state: "yes"; tiers: Array<{ index: number; amountWei: bigint }> }
  | { state: "unreadable"; message: string };

const tierProblem = (raw: string): string | null => {
  if (raw.trim() === "") return "set a price";
  const wei = strkToWei(raw);
  if (wei === null) return "a number with at most two decimals";
  if (wei === 0n) return "a price of zero is not a tier anyone can buy";
  return null;
};

/** The absolute share link for one creator id. Built from the page's own
 *  origin so a preview deployment hands out links to itself. */
const shareLink = (creatorId: string): string =>
  `${window.location.origin}/subscribe?creator=${creatorId}`;

export function RegisterSurface() {
  const [tiers, setTiers] = useState<string[]>(["1.00"]);
  const [acknowledged, setAcknowledged] = useState(false);
  const [phase, setPhase] = useState<"form" | "submitting" | "confirmed">("form");
  const [lines, setLines] = useState<NarrationLine[]>([]);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [registration, setRegistration] = useState<{ key: string; value: Registration } | null>(
    null,
  );
  const pollRef = useRef<number | null>(null);

  const { state, start, disconnect } = useConnection();
  const connection = state.status === "connected" ? state.connection : null;
  const identity = state.status === "connected" ? state.identity : null;

  const problems = tiers.map(tierProblem);
  const tiersOk = problems.every((p) => p === null);
  const tiersWei = tiersOk ? tiers.map((t) => strkToWei(t)!) : [];

  // The registration check: does the chain already hold a ladder for the id
  // this wallet + this browser's payout key would register? Read the moment a
  // wallet connects, so a registered creator lands on their share card and an
  // unregistered one on the form - and never the other way round.
  const creatorId = identity?.creatorId ?? null;
  // No synchronous "checking" write here: the derived `reg` below already
  // reads as checking whenever the stored answer's key is not this creator id,
  // which is the same paint a state write would buy at the cost of a cascade.
  useEffect(() => {
    if (creatorId === null) return;
    let cancelled = false;
    void Promise.all(
      Array.from({ length: LADDER_PROBE }, (_, i) => tierOf(getRpcClient(), creatorId, i)),
    )
      .then((probed) => {
        if (cancelled) return;
        const known = probed
          .map((t, index) => ({ index, amountWei: t.amountWei, token: BigInt(t.token) }))
          .filter((t) => t.token !== 0n && t.amountWei > 0n)
          .map(({ index, amountWei }) => ({ index, amountWei }));
        setRegistration({
          key: creatorId,
          value: known.length === 0 ? { state: "no" } : { state: "yes", tiers: known },
        });
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setRegistration({
          key: creatorId,
          value: { state: "unreadable", message: e instanceof Error ? e.message : String(e) },
        });
      });
    return () => {
      cancelled = true;
    };
  }, [creatorId]);
  const reg: Registration =
    creatorId === null
      ? { state: "checking" }
      : registration?.key === creatorId
        ? registration.value
        : { state: "checking" };

  // The interval outlives a re-render but not the page.
  useEffect(
    () => () => {
      if (pollRef.current !== null) window.clearInterval(pollRef.current);
    },
    [],
  );

  const submit = async () => {
    if (!connection || !identity || !tiersOk) return;
    setFailure(null);
    setPhase("submitting");
    setLines([
      { text: `creator id predicted: ${truncate(identity.creatorId)}`, tone: "plain" },
      { text: "one public transaction · the wallet shows the fee before you approve", tone: "dim" },
      { text: "no pool fee: registering never touches the pool", tone: "dim" },
    ]);

    // Watch the vault while the wallet works: the moment tier_of answers for
    // this id, the registration is on chain, whatever the wallet's promise is
    // still doing. Same pattern the subscribe flows use, same reason.
    const id = identity.creatorId;
    let settled = false;
    pollRef.current = window.setInterval(() => {
      void tierOf(getRpcClient(), id, 0).then((t) => {
        if (settled || BigInt(t.token) === 0n) return;
        settled = true;
        if (pollRef.current !== null) window.clearInterval(pollRef.current);
        setLines((l) => [
          ...l,
          { text: "confirmed by reading the vault: the ladder exists on chain", tone: "ok" },
        ]);
        setRegistration({
          key: id,
          value: {
            state: "yes",
            tiers: tiersWei.map((amountWei, index) => ({ index, amountWei })),
          },
        });
        setPhase("confirmed");
      });
    }, 5000);

    try {
      const hash = await connection.execute(
        registerCreatorCall(VAULT, STRK, identity.payoutPub, tiersWei),
      );
      setTxHash(hash);
      setLines((l) => [...l, { text: `submitted · ${truncate(hash)}`, tone: "ok" }]);
    } catch (e) {
      // The chain outranks a late wallet error: a ladder that exists is a
      // registration that happened, whatever the promise says.
      if (!settled) {
        settled = true;
        if (pollRef.current !== null) window.clearInterval(pollRef.current);
        const f = toFailure(e);
        setFailure(f);
        setLines((l) => [...l, { text: `not submitted: ${f.message}`, tone: "bad" }]);
        setPhase("form");
      }
    }
  };

  const registered = reg.state === "yes";
  const shareTiers = registered ? reg.tiers : [];
  const canRegister =
    connection !== null &&
    identity !== null &&
    tiersOk &&
    acknowledged &&
    reg.state === "no" &&
    phase !== "submitting";

  return (
    <div className="flex min-h-screen flex-col">
      <Masthead
        active="creator"
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
              ▸ One public transaction, then a link to share
            </div>
            <h2 className="text-[30px] tracking-[-0.03em] lg:text-[38px]">Become a creator</h2>
          </div>
          {registered ? (
            <Badge variant="verified" className="mb-1 ml-auto">
              REGISTERED
            </Badge>
          ) : null}
        </div>

        <p className="mt-5 mb-7 max-w-[70ch] text-[14px] leading-[1.7] text-text-prose">
          Set your prices, register them once, and hand out one link. Anyone
          who follows it can subscribe privately: you see payments arrive
          against your id, never who they came from. Registering costs about
          0.1 STRK in gas and touches no pool.
        </p>

        <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
          {/* ── 01 · prices ── */}
          <Step
            n="01"
            name="PRICES"
            note="per billing period, public and permanent"
            active={!registered && phase === "form"}
          >
            {tiers.map((value, i) => (
              <Field
                key={i}
                label={`TIER ${i} · STRK PER PERIOD`}
                hint={
                  i === 0
                    ? "what a subscriber pays each period. They pick the period length - hourly, daily or weekly - when they subscribe."
                    : "a higher tier for a bigger promise. Your gate can tell tiers apart."
                }
                error={value.trim() === "" ? null : problems[i]}
              >
                <div className="flex items-center gap-2">
                  <TextInput
                    value={value}
                    inputMode="decimal"
                    invalid={problems[i] !== null && value.trim() !== ""}
                    disabled={registered || phase !== "form"}
                    aria-label={`tier ${i} price in STRK`}
                    onChange={(e) => {
                      const next = [...tiers];
                      next[i] = e.target.value;
                      setTiers(next);
                    }}
                  />
                  {i > 0 && !registered && phase === "form" ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`remove tier ${i}`}
                      onClick={() => setTiers(tiers.filter((_, j) => j !== i))}
                    >
                      remove
                    </Button>
                  ) : null}
                </div>
              </Field>
            ))}
            {tiers.length < MAX_TIERS && !registered && phase === "form" ? (
              <Button variant="outline" size="sm" onClick={() => setTiers([...tiers, ""])}>
                + add a tier
              </Button>
            ) : null}
            <p className="text-[11px] leading-[1.55] text-text-caption">
              A ladder is permanent for its id: to change prices later, you
              register a fresh id and share the new link. Prices are public,
              like everything on this side of the product.
            </p>
          </Step>

          {/* ── 02 · register ── */}
          <Step
            n="02"
            name="REGISTER"
            note={
              registered
                ? "already on chain"
                : connection
                  ? "one public transaction"
                  : "connect to derive your id"
            }
            active={connection !== null && !registered && phase !== "confirmed"}
          >
            {connection === null ? (
              <>
                <p className="text-[13px] leading-[1.6] text-text-prose">
                  Your creator id is computed from your wallet address, the
                  token, and a payout key created in this browser - so it
                  exists the moment you connect, before anything is sent.
                </p>
                <ConnectPanel state={state} onConnect={() => void start()} onDisconnect={disconnect} />
              </>
            ) : (
              <>
                <KeyValue
                  rows={[
                    ["creator id", identity ? truncate(identity.creatorId) : "—"],
                    ["payout key", identity ? truncate(identity.payoutPub) : "—"],
                    [
                      "ladder",
                      tiersOk ? (
                        tiersWei.map((w) => `${fmtStrk(w)} STRK`).join(" · ")
                      ) : (
                        <span key="ladder" className="break-normal">fix the prices in step 01</span>
                      ),
                    ],
                  ]}
                />
                {reg.state === "checking" ? (
                  <p className="text-[12px] text-text-caption">
                    checking the vault for an existing registration…
                  </p>
                ) : null}
                {reg.state === "unreadable" ? (
                  <p className="text-[12px] leading-[1.55] text-accent-700">
                    the vault could not be read, so this page cannot tell
                    whether this id is already registered: {reg.message}
                  </p>
                ) : null}
                {registered ? (
                  <p className="text-[13px] leading-[1.6] text-text-prose">
                    {phase === "confirmed"
                      ? "Registered. The vault computed the same id this page predicted, and the ladder is readable by anyone now. Your link is ready in step 03."
                      : "This wallet already registered this id, so there is nothing to send: the vault holds one ladder per id, permanently. Your link is ready in step 03."}
                  </p>
                ) : (
                  <>
                    <Narration
                      label="register"
                      minHeight="5.6em"
                      lines={
                        lines.length > 0
                          ? lines
                          : [
                              {
                                text: "registering is public: it links this wallet to the creator id, which is how subscribers find you",
                                tone: "dim",
                              },
                            ]
                      }
                    />
                    {failure ? <FailureNote failure={failure} /> : null}
                    <label className="flex items-start gap-2.5 text-[12px] leading-[1.5] text-text-prose">
                      <input
                        type="checkbox"
                        checked={acknowledged}
                        onChange={(e) => setAcknowledged(e.target.checked)}
                        className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--accent)]"
                      />
                      I understand this browser holds the only payout key, and
                      that key is what claims this id's earnings later.
                    </label>
                    <Button
                      variant={canRegister ? "default" : "outline"}
                      size="md"
                      disabled={!canRegister}
                      onClick={() => void submit()}
                    >
                      {phase === "submitting"
                        ? "waiting for the wallet"
                        : `register ${tiers.length} tier${tiers.length === 1 ? "" : "s"}`}
                    </Button>
                    <p className="text-[11px] text-text-caption">
                      about 0.1 STRK in gas, from your public balance. No pool
                      fee: registering never touches the pool.
                    </p>
                  </>
                )}
              </>
            )}
          </Step>

          {/* ── 03 · share ── */}
          <Step
            n="03"
            name="SHARE"
            note="the one link your audience needs"
            active={registered}
          >
            {registered && identity ? (
              <>
                <div className="flex flex-wrap items-center gap-3">
                  <Badge variant="verified">
                    {phase === "confirmed" ? "REGISTERED" : "ALREADY REGISTERED"}
                  </Badge>
                  {txHash ? (
                    <a
                      href={VOYAGER_TX(txHash)}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[12px]"
                    >
                      {truncate(txHash)} ↗
                    </a>
                  ) : null}
                </div>
                <Field label="YOUR SUBSCRIBE LINK" hint="anyone who opens it lands on the subscribe flow with your id already filled in.">
                  <CopyValue
                    value={shareLink(identity.creatorId)}
                    display={`${window.location.host}/subscribe?creator=${truncate(identity.creatorId)}`}
                    className="text-[12px]"
                  />
                </Field>
                <Field label="YOUR CREATOR ID" hint="the same id, bare, for a bot config or a bio.">
                  <CopyValue value={identity.creatorId} display={truncate(identity.creatorId)} className="text-[12px]" />
                </Field>
                <KeyValue
                  rows={shareTiers.map((t) => [
                    `tier ${t.index}`,
                    `${fmtStrk(t.amountWei)} STRK per period`,
                  ])}
                />
                <div className="flex flex-wrap gap-2 pt-1">
                  <Link
                    to="/creator"
                    search={{ creator: identity.creatorId }}
                    className="m-btn m-btn-primary text-[13px]"
                  >
                    Open your ledger →
                  </Link>
                  <Link to="/manage" className="m-btn m-btn-secondary text-[13px]">
                    Claim earnings
                  </Link>
                </div>
                <p className="text-[11px] leading-[1.55] text-text-caption">
                  Subscribers reveal nothing to you. Charges arrive against
                  your id on schedule; who funded them is not recorded
                  anywhere you - or anyone - can read.
                </p>
              </>
            ) : (
              <>
                <p className="text-[13px] leading-[1.6] text-text-prose">
                  Your share link appears here the moment the ladder is on
                  chain. It carries your creator id, so a subscriber who
                  follows it never has to paste anything.
                </p>
                <KeyValue
                  rows={(
                    [
                      ["share link", "after registering"],
                      ["your ledger", "live figures, from public events"],
                      ["claiming", "earnings wait in the vault until claimed"],
                    ] as Array<[string, string]>
                  ).map(([k, v]) => [
                    k,
                    // KeyValue's value cell breaks anywhere, which is right
                    // for hashes and wrong for sentences.
                    <span key={k} className="break-normal">
                      {v}
                    </span>,
                  ])}
                />
              </>
            )}
          </Step>
        </div>

        <div className="mt-8 flex flex-col gap-3">
          <SectionHead note="the two sides of this product are deliberately different">
            // WHAT BECOMES PUBLIC, WHAT NEVER DOES
          </SectionHead>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="flex flex-col gap-1 border border-border-panel px-4 py-4">
              <div className="pb-1 text-[11px] font-medium tracking-[0.18em] text-text-label">
                PUBLIC · THE CREATOR SIDE
              </div>
              {[
                ["your wallet", "the registering transaction names it as the caller"],
                ["your ladder", "prices are readable by anyone, which is how subscribers see them"],
                ["your earnings total", "the sum of charges against your id is derivable by anyone"],
              ].map(([k, v]) => (
                <div key={k} className="flex flex-col gap-1 border-t border-border-row py-2 sm:flex-row sm:items-baseline sm:gap-3">
                  <span className="shrink-0 text-[12px] text-text-default sm:w-[11.5rem]">{k}</span>
                  <span className="text-[11px] leading-[1.5] text-text-caption">{v}</span>
                </div>
              ))}
            </div>
            <div className="flex flex-col gap-1 border border-border-panel px-4 py-4">
              <div className="pb-1 text-[11px] font-medium tracking-[0.18em] text-text-label">
                HIDDEN · THE SUBSCRIBER SIDE
              </div>
              {[
                ["who subscribes to you", "escrow arrives through the pool, which severs the funding wallet"],
                ["who each charge billed", "a charge names an amount and a period, never a person"],
                ["your subscribers to each other", "each subscription derives its own key and code"],
              ].map(([k, v]) => (
                <div key={k} className="flex flex-col gap-1 border-t border-border-row py-2 sm:flex-row sm:items-baseline sm:gap-3">
                  <span className="shrink-0 text-[12px] text-text-default sm:w-[11.5rem]">{k}</span>
                  <span className="text-[11px] leading-[1.5] text-text-caption">{v}</span>
                </div>
              ))}
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
