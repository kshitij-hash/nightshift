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

import { STRK, VAULT, VOYAGER_TX } from "../../config";
import { getRpcClient } from "../../lib/rpc-instance";
import { tierOf } from "../../lib/rpc/views";
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

  const actions = () =>
    subscribeActions({
      vault: VAULT,
      token: STRK,
      commitment: identity.commitment,
      creatorId: creatorInput.trim(),
      tier,
      periodBlocks: cadence,
      nPeriods: periods,
      ownerPub: identity.ownerPub,
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
      { text: "asking the wallet to build and prove the batch", tone: "dim" },
    ]);
    try {
      await connection.prepareInvoke(actions());
      setLines((l) => [
        ...l,
        { text: "proof prepared · nothing submitted", tone: "ok" },
        { text: "the same batch is what SIGN AND SUBMIT sends", tone: "dim" },
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
    setLines((l) => [...l, { text: "submitting · the wallet is generating the proof", tone: "dim" }]);
    try {
      const hash = await connection.invokeTransaction(actions());
      setTxHash(hash);
      setLines((l) => [...l, { text: `submitted: ${hash}`, tone: "ok" }]);
      setPhase("submitted");
    } catch (e) {
      const f = toFailure(e);
      setFailure(f);
      setLines((l) => [...l, { text: `not submitted: ${f.message}`, tone: "bad" }]);
      setPhase("previewed");
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
            hint="the felt the creator published. It defaults to the id this wallet would register for itself, which is how the demo subscription was made."
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
          </Field>

          <Field
            label="TIER"
            hint="the index into the creator's ladder. The price below is read from the vault, not typed here."
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
                  ? "reading tier_of from the vault"
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
            hint="three lengths, and the vault refuses anything else with NS_PERIOD_OFF_LADDER. Quantized so a schedule cannot fingerprint a subscriber."
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
              ["commitment", truncate(identity.commitment)],
              ["owner pubkey", truncate(identity.ownerPub)],
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
          {phase === "submitted" && txHash ? (
            <>
              <div className="flex flex-wrap items-center gap-3">
                <Badge variant="verified">SUBSCRIBED</Badge>
                <span className="text-[11px] text-text-caption">accepted by the wallet</span>
              </div>
              <KeyValue
                rows={[
                  ["transaction", truncate(txHash)],
                  ["commitment", truncate(identity.commitment)],
                  ["escrow", `${fmtStrk(escrowWei)} STRK, held by the vault`],
                  ["periods", `${periods} · ${cadenceMeta.label}`],
                ]}
              />
              <a href={VOYAGER_TX(txHash)} target="_blank" rel="noreferrer" className="text-[12px]">
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
                  ["commitment", truncate(identity.commitment)],
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
          commitment={identity.commitment}
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
