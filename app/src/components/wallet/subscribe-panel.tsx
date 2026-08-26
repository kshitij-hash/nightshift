// Subscribe: three steps, all visible at once.
//
// The dry run is the path, not an option. Submit does not exist until a
// preview exists, and editing the form after a preview stamps that preview
// STALE, because a preview that describes different inputs is worse than none.
//
// The price is read from the vault's tier_of view, so the figure on screen is
// the creator's real per-period amount rather than a number typed into a form.
// The escrow is that price times the periods, exactly as the vault computes it
// before it accepts the schedule.

import { useCallback, useEffect, useState } from "react";

import { DEMO_CREATOR_ID, STRK, VAULT, VOYAGER_CONTRACT, VOYAGER_TX } from "../../config";
import { getRpcClient } from "../../lib/rpc-instance";
import { tierOf } from "../../lib/rpc/views";
import { readSchedule } from "../../lib/schedule";
import type { Connection } from "../../lib/wallet/bridge";
import {
  CADENCES,
  feltError,
  fmtStrk,
  periodsError,
  subscribeActions,
  truncate,
  type CadenceBlocks,
} from "../../lib/wallet/core";
import { subscribeIdentityFor } from "../../lib/wallet/keys";
import type { PublicIdentity } from "../../lib/wallet/keys";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { PoolFeeNote, SubscribeDisclosure } from "./disclosure";
import { FailureNote, toFailure, type Failure } from "./failure";
import {
  ChoiceChip,
  Field,
  KeyValue,
  Narration,
  SectionHead,
  Step,
  TextInput,
  type NarrationLine,
} from "./primitives";

type Price =
  | { state: "idle" }
  | { state: "reading" }
  | { state: "known"; amountWei: bigint }
  | { state: "unknown-creator" }
  | { state: "unreadable"; message: string };

type Phase = "form" | "previewing" | "previewed" | "stale" | "submitting" | "submitted";

export function SubscribePanel({
  connection,
  identity,
}: {
  connection: Connection;
  identity: PublicIdentity;
}) {
  const [creatorInput, setCreatorInput] = useState(identity.creatorId);
  const [tierInput, setTierInput] = useState("0");
  const [cadence, setCadence] = useState<CadenceBlocks>(CADENCES[0].blocks);
  const [periodsInput, setPeriodsInput] = useState("3");
  const [priceRead, setPriceRead] = useState<{ key: string; value: Price } | null>(null);
  const [phase, setPhase] = useState<Phase>("form");
  const [lines, setLines] = useState<NarrationLine[]>([]);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);

  const creatorProblem = feltError(creatorInput, "creator id");
  const tierProblem = /^[0-9]{1,3}$/.test(tierInput.trim()) && Number(tierInput) <= 255
    ? null
    : "tier must be a whole number from 0 to 255";
  const periodsProblem = periodsError(periodsInput);
  const formOk = !creatorProblem && !tierProblem && !periodsProblem;

  const periods = periodsProblem ? 0 : Number(periodsInput.trim());
  const tier = tierProblem ? 0 : Number(tierInput.trim());

  // The price is derived from the last completed read plus the inputs it was
  // read for. Anything else is "reading", which keeps the effect below free of
  // a synchronous state write and keeps a stale price off the screen.
  const priceKey = `${creatorInput.trim()}|${tier}`;
  const price: Price =
    creatorProblem || tierProblem
      ? { state: "idle" }
      : priceRead?.key === priceKey
        ? priceRead.value
        : { state: "reading" };
  const escrowWei = price.state === "known" ? price.amountWei * BigInt(periods) : 0n;
  const cadenceMeta = CADENCES.find((c) => c.blocks === cadence) ?? CADENCES[0];

  // Any edit invalidates a preview. This runs on every input change rather
  // than on submit, so the STALE stamp lands the moment the numbers diverge.
  const invalidate = useCallback(() => {
    setAcknowledged(false);
    setPhase((p) => (p === "previewed" ? "stale" : p === "submitted" ? "form" : p));
  }, []);

  // The real per-period price, read from the vault. A creator id nobody
  // registered comes back with token 0, which is a state with a name rather
  // than a zero to render.
  useEffect(() => {
    if (creatorProblem || tierProblem) return;
    let cancelled = false;
    const [creator, tierIndex] = priceKey.split("|");
    tierOf(getRpcClient(), creator, Number(tierIndex))
      .then((t) => {
        if (cancelled) return;
        setPriceRead({
          key: priceKey,
          value:
            BigInt(t.token) === 0n
              ? { state: "unknown-creator" }
              : { state: "known", amountWei: t.amountWei },
        });
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setPriceRead({
          key: priceKey,
          value: { state: "unreadable", message: e instanceof Error ? e.message : String(e) },
        });
      });
    return () => {
      cancelled = true;
    };
  }, [priceKey, creatorProblem, tierProblem]);

  // Derived for the creator id in the form, not for the wallet's own id.
  // identity.commitment is bound to the wallet's own creator id; subscribing
  // to anybody else with it would publish a commitment /manage can never
  // re-derive, orphaning the subscription from this browser's own list.
  const subIdentity = creatorProblem
    ? { commitment: identity.commitment, ownerPub: identity.ownerPub }
    : subscribeIdentityFor(creatorInput.trim());

  const actions = () =>
    subscribeActions({
      vault: VAULT,
      token: STRK,
      commitment: subIdentity.commitment,
      creatorId: creatorInput.trim(),
      tier,
      periodBlocks: cadence,
      nPeriods: periods,
      ownerPub: subIdentity.ownerPub,
      escrowWei,
    });

  const runDryRun = async () => {
    setFailure(null);
    setPhase("previewing");
    setLines([
      { text: "dry run · subscribe", tone: "dim" },
      {
        text: `escrow = tier price × periods = ${fmtStrk(escrowWei / BigInt(periods || 1))} × ${periods} = ${fmtStrk(escrowWei)} STRK`,
        tone: "plain",
      },
      { text: "pool fee = 6 STRK, from your PUBLIC balance", tone: "plain" },
      { text: "asking the wallet to build and prove the transaction", tone: "dim" },
    ]);
    try {
      await connection.prepareInvoke(actions());
      setLines((l) => [
        ...l,
        { text: "proof prepared · nothing submitted", tone: "ok" },
        { text: "sign and submit sends exactly this", tone: "dim" },
      ]);
      setPhase("previewed");
    } catch (e) {
      const f = toFailure(e);
      setFailure(f);
      setLines((l) => [...l, { text: `dry run refused: ${f.message}`, tone: "bad" }]);
      setPhase("form");
    }
  };

  const submit = async () => {
    setFailure(null);
    setPhase("submitting");
    setLines((l) => [
      ...l,
      { text: "submitting · the wallet is generating the proof", tone: "dim" },
      { text: "the private work happens in the wallet and can take a minute or two", tone: "dim" },
    ]);

    // The wallet's promise is not the only truth: it proves, submits, and can
    // resolve well after the transaction has landed. While it runs, watch the
    // vault directly - the moment schedule_of answers for this commitment,
    // the subscribe is on chain and the page says so, whatever the wallet's
    // promise is still doing.
    const commitment = subIdentity.commitment;
    let settled = false;
    const poll = window.setInterval(() => {
      void readSchedule(commitment).then((s) => {
        if (s === null || settled) return;
        settled = true;
        window.clearInterval(poll);
        setLines((l) => [
          ...l,
          { text: "confirmed by reading the vault: the schedule exists on chain", tone: "ok" },
        ]);
        setPhase((p) => (p === "submitting" ? "submitted" : p));
      });
    }, 8000);

    try {
      const hash = await connection.invokeTransaction(actions());
      setTxHash(hash);
      setLines((l) => [...l, { text: `submitted: ${hash}`, tone: "ok" }]);
      setPhase("submitted");
    } catch (e) {
      // The chain outranks a late wallet error: a schedule that exists is a
      // subscribe that happened, whatever the promise says.
      if (!settled) {
        const f = toFailure(e);
        setFailure(f);
        setLines((l) => [...l, { text: `not submitted: ${f.message}`, tone: "bad" }]);
        setPhase("previewed");
      }
    } finally {
      settled = true;
      window.clearInterval(poll);
    }
  };

  const previewReady = phase === "previewed" || phase === "submitting" || phase === "submitted";
  const canDryRun =
    formOk && price.state === "known" && escrowWei > 0n && phase !== "previewing" && phase !== "submitting";

  return (
    <section className="flex flex-col gap-5">
      <SectionHead note="escrow moves through the pool · the fee does not">
        // SUBSCRIBE · ONE STANDING AUTHORIZATION
      </SectionHead>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <Step n="01" name="TERMS" note="all four are on chain" active={!previewReady}>
          <Field
            label="CREATOR ID"
            hint="the id the creator shared. It defaults to the id this wallet would register for itself."
            error={creatorProblem}
          >
            <TextInput
              value={creatorInput}
              invalid={creatorProblem !== null}
              onChange={(e) => {
                setCreatorInput(e.target.value);
                invalidate();
              }}
            />
            <div className="flex flex-wrap items-center gap-2.5 pt-1.5">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setCreatorInput(DEMO_CREATOR_ID);
                  invalidate();
                }}
              >
                use the demo creator
              </Button>
              <span className="text-[11px] text-text-caption">
                registered on the live vault, 1 STRK per period
              </span>
            </div>
          </Field>

          <Field
            label="TIER"
            hint="which of the creator's tiers. The price below is read from the vault, not typed here."
            error={tierProblem}
          >
            <TextInput
              value={tierInput}
              inputMode="numeric"
              invalid={tierProblem !== null}
              onChange={(e) => {
                setTierInput(e.target.value);
                invalidate();
              }}
            />
          </Field>

          <div className="flex items-baseline justify-between gap-3 border border-border-field bg-surface-field px-3 py-2.5">
            <span className="text-[12px] text-text-default">
              {price.state === "known"
                ? `tier ${tier} · ${fmtStrk(price.amountWei)} STRK per period`
                : price.state === "reading"
                  ? "reading the price from the vault"
                  : price.state === "unknown-creator"
                    ? "no creator registered at this id"
                    : price.state === "unreadable"
                      ? "tier price unreadable"
                      : "enter a creator id"}
            </span>
            <span className="text-[11px] text-text-caption">
              {price.state === "known" ? "fixed by the creator" : "vault view"}
            </span>
          </div>
          {price.state === "unreadable" ? (
            <p className="text-[11px] leading-[1.5] text-text-caption">{price.message}</p>
          ) : null}

          <Field
            label="CADENCE"
            hint="three fixed lengths — nothing else is accepted, so a schedule cannot fingerprint its subscriber."
          >
            <div className="flex flex-wrap gap-2">
              {CADENCES.map((c) => (
                <ChoiceChip
                  key={c.blocks}
                  selected={c.blocks === cadence}
                  onClick={() => {
                    setCadence(c.blocks);
                    invalidate();
                  }}
                >
                  {c.label} · {c.blocks}
                </ChoiceChip>
              ))}
            </div>
          </Field>

          <Field
            label="PERIODS"
            hint="how many periods to escrow now. The vault can never charge past this number."
            error={periodsProblem}
          >
            <TextInput
              value={periodsInput}
              inputMode="numeric"
              invalid={periodsProblem !== null}
              onChange={(e) => {
                setPeriodsInput(e.target.value);
                invalidate();
              }}
            />
          </Field>

          <div className="flex items-baseline justify-between gap-3 border border-border-panel bg-surface-fill px-3.5 py-3">
            <span className="text-[11px] font-medium tracking-[0.18em] text-text-label">ESCROW</span>
            <span className="text-[20px] font-semibold text-text-strong tabular-nums">
              {price.state === "known" ? fmtStrk(escrowWei) : "0.00"}
              <span className="pl-1 text-[13px] font-normal text-text-caption">STRK</span>
            </span>
          </div>

          {/* One filled primary on screen at a time: the dry run carries it
              until a preview exists, then the submit does. */}
          <Button
            variant={previewReady ? "outline" : "default"}
            size="md"
            disabled={!canDryRun}
            onClick={() => void runDryRun()}
          >
            {phase === "previewing" ? "running dry run" : "dry run"}
          </Button>
          <p className="text-[11px] text-text-caption">
            a dry run signs nothing. The wallet builds the batch and proves it, then stops.
          </p>
        </Step>

        <Step
          n="02"
          name="DRY-RUN PREVIEW"
          note={
            phase === "stale"
              ? "stale · the form changed"
              : previewReady
                ? "prepared · nothing submitted"
                : "runs before anything is signed"
          }
          active={previewReady || phase === "previewing"}
        >
          <Narration
            label="subscribe dry run"
            minHeight="7.4em"
            lines={
              lines.length > 0
                ? lines
                : [
                    {
                      text: "run a dry run to see the exact amounts before signing",
                      tone: "dim",
                    },
                  ]
            }
          />
          {phase === "stale" ? (
            <div className="flex flex-wrap items-center gap-3 border border-border-field px-3 py-2">
              <Badge variant="outline">STALE PREVIEW</Badge>
              <span className="text-[11px] text-text-caption">
                the form changed after this preview. Run the dry run again.
              </span>
            </div>
          ) : null}

          <PoolFeeNote active={previewReady} />

          <KeyValue
            rows={[
              ["escrow to vault", `${fmtStrk(escrowWei)} STRK · private`],
              ["pool fee", "6.00 STRK · public"],
              ["periods bought", `${periods}`],
              ["cadence", `${cadenceMeta.label} · ${cadenceMeta.blocks} blocks`],
              ["commitment", truncate(subIdentity.commitment)],
              ["owner pubkey", truncate(subIdentity.ownerPub)],
            ]}
          />

          {failure ? <FailureNote failure={failure} /> : null}

          <label className="flex items-start gap-2.5 text-[12px] leading-[1.5] text-text-prose">
            <input
              type="checkbox"
              checked={acknowledged}
              disabled={!previewReady}
              onChange={(e) => setAcknowledged(e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--accent)]"
            />
            I have read the 6 STRK pool fee and what becomes public.
          </label>

          <Button
            variant={previewReady && acknowledged ? "default" : "outline"}
            size="md"
            disabled={!previewReady || !acknowledged || phase === "submitting" || phase === "submitted"}
            onClick={() => void submit()}
          >
            {phase === "submitting"
              ? "waiting for the wallet"
              : `sign and submit ${fmtStrk(escrowWei)} STRK`}
          </Button>
          <p className="text-[11px] text-text-caption">
            {previewReady
              ? "the wallet prompt is next. This page never holds a key that can move funds."
              : "disabled until a dry run has run"}
          </p>
        </Step>

        <Step n="03" name="SUBMITTED" note="the receipt" active={phase === "submitted"}>
          {phase === "submitted" ? (
            <>
              <div className="flex flex-wrap items-center gap-3">
                <Badge variant="verified">SUBSCRIBED</Badge>
                <span className="text-[11px] text-text-caption">accepted by the wallet</span>
              </div>
              <KeyValue
                rows={[
                  [
                    "transaction",
                    txHash !== null
                      ? truncate(txHash)
                      : "landed · the wallet is still returning the hash",
                  ],
                  ["commitment", truncate(subIdentity.commitment)],
                  ["escrow", `${fmtStrk(escrowWei)} STRK, held by the vault`],
                  ["periods", `${periods} · ${cadenceMeta.label}`],
                ]}
              />
              <a
                href={txHash !== null ? VOYAGER_TX(txHash) : `${VOYAGER_CONTRACT(VAULT)}#events`}
                target="_blank"
                rel="noreferrer"
                className="text-[12px]"
              >
                verify on voyager ↗
              </a>
              <p className="text-[13px] leading-[1.6] text-text-prose">
                Save the commitment. It is how you cancel, how you present a tier at a gate, and how
                you find your own charges in a feed that names nobody.
              </p>
              <p className="text-[11px] text-text-caption">
                no wallet appears in this receipt, and none appears in the vault's event log
              </p>
            </>
          ) : (
            <>
              <p className="text-[13px] leading-[1.6] text-text-prose">
                A receipt appears here once the batch lands. Until then there is nothing to show,
                and this panel says so rather than pretending to a state.
              </p>
              <KeyValue
                rows={[
                  ["transaction", "not submitted"],
                  ["commitment", truncate(subIdentity.commitment)],
                  ["escrow", `${fmtStrk(escrowWei)} STRK, still yours`],
                ]}
              />
            </>
          )}
        </Step>
      </div>

      <div className="flex flex-col gap-3">
        <SectionHead note="stated in the preview, before the signature">
          // WHAT BECOMES PUBLIC, WHAT STAYS HIDDEN
        </SectionHead>
        <SubscribeDisclosure
          escrowWei={escrowWei}
          periods={periods}
          cadenceLabel={`${cadenceMeta.label}, ${cadenceMeta.blocks} blocks`}
          vault={VAULT}
          commitment={subIdentity.commitment}
          tierLabel={
            price.state === "known"
              ? `tier ${tier} · ${fmtStrk(price.amountWei)} STRK per period`
              : `tier ${tier}`
          }
        />
      </div>
    </section>
  );
}
