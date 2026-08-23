// Cancel and reclaim: sign here, then choose who submits it.
//
// The vault authorizes both entry points on the owner-key signature alone and
// never reads the sender. Two things follow, and both are on screen rather
// than in a doc. A subscriber does not need gas, a wallet, or this page to
// cancel: the signed line works from any sender. And a subscriber who submits
// it themselves writes their own wallet into the transaction, which is the one
// linkage the owner-key design avoids. Neither path is the default that hides
// a cost; the relay is pre-selected because it names nothing, and the card
// that costs gas says so in its first line.

import { useState } from "react";

import { STRK, VAULT, VOYAGER_TX } from "../../config";
import type { Connection } from "../../lib/wallet/bridge";
import { cancelCall, feltError, reclaimCall, relayCommand, truncate, type Signature } from "../../lib/wallet/core";
import {
  ownerKeyOptions,
  signCancel,
  signReclaim,
  type OwnerKeyChoice,
  type PublicIdentity,
} from "../../lib/wallet/keys";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { FailureNote, toFailure, type Failure } from "./failure";
import {
  ChoiceChip,
  CopyValue,
  Field,
  KeyValue,
  Narration,
  SectionHead,
  StatusDot,
  Step,
  TextInput,
  type NarrationLine,
} from "./primitives";

type Submitter = "relay" | "self";

const OPTIONS: Array<{
  id: Submitter;
  name: string;
  cost: string;
  names: string;
  censorship: string;
  body: string;
}> = [
  {
    id: "relay",
    name: "HAND IT TO A RELAY",
    cost: "costs you nothing",
    names: "names nothing of yours",
    censorship: "a relay can stall, so keep the signature",
    body: "The relay submits the signed message for you. It learns the commitment, which is already public, and nothing else: it cannot alter the message, cannot cancel anything else, and holds no funds. If it stalls, the same signature still works from any other sender.",
  },
  {
    id: "self",
    name: "SUBMIT IT YOURSELF",
    cost: "you pay gas",
    names: "names your wallet as the sender",
    censorship: "nobody can hold it back",
    body: "Your wallet appears in the transaction as the sender, timestamped next to the commitment it acts on, so an observer can link the two. It is the fastest path and it depends on nobody.",
  },
];

function SubmitterChoice({
  pick,
  onPick,
  relayLine,
}: {
  pick: Submitter;
  onPick: (s: Submitter) => void;
  relayLine: string | null;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {OPTIONS.map((o) => {
          const on = pick === o.id;
          return (
            <button
              key={o.id}
              type="button"
              onClick={() => onPick(o.id)}
              className={`flex flex-col gap-3 border px-5 py-4 text-left transition-colors duration-[var(--dur-quick)] ease-[var(--ease-out)] ${
                on ? "border-ns-accent bg-surface-panel" : "border-border-panel bg-transparent"
              }`}
            >
              <span className="flex flex-wrap items-center justify-between gap-2">
                <span className="flex items-center gap-2">
                  <StatusDot state={on ? "live" : "pending"} size={8} />
                  <span
                    className={`text-[11px] font-medium tracking-[0.16em] ${
                      on ? "text-text-strong" : "text-text-label"
                    }`}
                  >
                    {o.name}
                  </span>
                </span>
                {on ? <Badge variant="outline">SELECTED</Badge> : null}
              </span>
              <span className="text-[13px] leading-[1.6] text-text-prose">{o.body}</span>
              <span className="grid grid-cols-[minmax(0,7rem)_minmax(0,1fr)] gap-x-4 gap-y-1 text-[12px]">
                <span className="text-text-label">cost</span>
                <span className="text-text-default">{o.cost}</span>
                <span className="text-text-label">what it names</span>
                <span className="text-text-default">{o.names}</span>
                <span className="text-text-label">censorship</span>
                <span className="text-text-default">{o.censorship}</span>
              </span>
            </button>
          );
        })}
      </div>
      <div className="flex flex-col gap-2 border border-border-panel bg-surface-fill px-4 py-3.5">
        <span className="text-[11px] font-medium tracking-[0.18em] text-text-label">
          THE SIGNED MESSAGE, EITHER WAY
        </span>
        {relayLine ? (
          <CopyValue value={relayLine} className="text-[12px] text-text-default" />
        ) : (
          <span className="text-[12px] text-text-caption">
            sign first, and the exact relay command appears here
          </span>
        )}
        <span className="text-[11px] leading-[1.5] text-text-caption">
          the same signature works from any sender. Hand it to a relay, to a friend, or to your own
          terminal.
        </span>
      </div>
    </div>
  );
}

function ConfirmDialog({
  open,
  onOpenChange,
  title,
  body,
  verb,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  body: string;
  verb: string;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{body}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost" size="md">
              keep the subscription
            </Button>
          </DialogClose>
          <Button
            variant="destructive"
            size="md"
            onClick={() => {
              onOpenChange(false);
              onConfirm();
            }}
          >
            {verb}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function CancelPanel({
  connection,
  identity,
}: {
  connection: Connection;
  identity: PublicIdentity;
}) {
  const keys = ownerKeyOptions(connection.address, STRK);
  const [keyChoice, setKeyChoice] = useState<OwnerKeyChoice>("derived");

  const [cancelSig, setCancelSig] = useState<Signature | null>(null);
  const [cancelPick, setCancelPick] = useState<Submitter>("relay");
  const [cancelLines, setCancelLines] = useState<NarrationLine[]>([]);
  const [cancelFailure, setCancelFailure] = useState<Failure | null>(null);
  const [cancelTx, setCancelTx] = useState<string | null>(null);
  const [cancelBusy, setCancelBusy] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);

  const [toInput, setToInput] = useState("");
  const [reclaimSig, setReclaimSig] = useState<Signature | null>(null);
  const [reclaimPick, setReclaimPick] = useState<Submitter>("relay");
  const [reclaimLines, setReclaimLines] = useState<NarrationLine[]>([]);
  const [reclaimFailure, setReclaimFailure] = useState<Failure | null>(null);
  const [reclaimTx, setReclaimTx] = useState<string | null>(null);
  const [reclaimBusy, setReclaimBusy] = useState(false);
  const [confirmReclaim, setConfirmReclaim] = useState(false);

  const destination = toInput.trim() === "" ? connection.address : toInput.trim();
  const destinationProblem = toInput.trim() === "" ? null : feltError(toInput, "destination");

  const doSignCancel = () => {
    setCancelFailure(null);
    setCancelTx(null);
    try {
      const signed = signCancel(connection.address, STRK, keyChoice);
      setCancelSig(signed.sig);
      setCancelLines([
        { text: `signed with the ${keys.find((k) => k.id === keyChoice)?.label ?? keyChoice}`, tone: "ok" },
        { text: "nothing was submitted, and no network call was made", tone: "dim" },
        { text: "the vault checks this signature, never the sender", tone: "dim" },
      ]);
    } catch (e) {
      setCancelFailure(toFailure(e));
    }
  };

  const doSubmitCancel = async () => {
    if (!cancelSig) return;
    setCancelBusy(true);
    setCancelFailure(null);
    setCancelLines((l) => [
      ...l,
      { text: "self-submitting: this wallet is recorded as the sender", tone: "dim" },
    ]);
    try {
      const hash = await connection.execute(cancelCall(VAULT, identity.commitment, cancelSig));
      setCancelTx(hash);
      setCancelLines((l) => [...l, { text: `cancel submitted: ${hash}`, tone: "ok" }]);
    } catch (e) {
      const f = toFailure(e);
      setCancelFailure(f);
      setCancelLines((l) => [...l, { text: `not submitted: ${f.message}`, tone: "bad" }]);
    } finally {
      setCancelBusy(false);
    }
  };

  const doSignReclaim = () => {
    setReclaimFailure(null);
    setReclaimTx(null);
    if (destinationProblem) return;
    try {
      const signed = signReclaim(connection.address, STRK, destination, keyChoice);
      setReclaimSig(signed.sig);
      setReclaimLines([
        { text: `signed for ${truncate(destination)}`, tone: "ok" },
        { text: "the destination is inside the signed message: a relay that edits it fails the check", tone: "dim" },
        { text: "nothing was submitted", tone: "dim" },
      ]);
    } catch (e) {
      setReclaimFailure(toFailure(e));
    }
  };

  const doSubmitReclaim = async () => {
    if (!reclaimSig) return;
    setReclaimBusy(true);
    setReclaimFailure(null);
    try {
      const hash = await connection.execute(
        reclaimCall(VAULT, identity.commitment, destination, reclaimSig),
      );
      setReclaimTx(hash);
      setReclaimLines((l) => [...l, { text: `reclaim submitted: ${hash}`, tone: "ok" }]);
    } catch (e) {
      const f = toFailure(e);
      setReclaimFailure(f);
      setReclaimLines((l) => [...l, { text: `not submitted: ${f.message}`, tone: "bad" }]);
    } finally {
      setReclaimBusy(false);
    }
  };

  return (
    <section className="flex flex-col gap-8">
      <div className="flex flex-col gap-5">
        <SectionHead note="the trade-off is the design, not a setting">
          // CANCEL · SIGN, THEN CHOOSE WHO SUBMITS IT
        </SectionHead>

        <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
          <Step n="01" name="SIGN THE CANCEL" active={cancelSig === null} note="no network call">
            <KeyValue
              rows={[
                ["commitment", truncate(identity.commitment)],
                ["vault", truncate(VAULT)],
                ["effect", "no further period may be charged"],
              ]}
            />
            <p className="text-[13px] leading-[1.6] text-text-prose">
              Cancelling stops future charges. It does not refund a period already charged, and it
              does not need the vault's permission: the signature is checked against the
              commitment.
            </p>

            {keys.length > 1 ? (
              <Field
                label="OWNER KEY"
                hint="the vault stores one owner key per commitment and does not publish which. Pick by era: derived for a subscription made here, legacy for one made before keys were derived per commitment."
              >
                <div className="flex flex-wrap gap-2">
                  {keys.map((k) => (
                    <ChoiceChip
                      key={k.id}
                      selected={k.id === keyChoice}
                      onClick={() => {
                        setKeyChoice(k.id);
                        setCancelSig(null);
                        setReclaimSig(null);
                      }}
                    >
                      {k.id}
                    </ChoiceChip>
                  ))}
                </div>
              </Field>
            ) : null}

            <Narration label="cancel" minHeight="4.6em" lines={
              cancelLines.length > 0
                ? cancelLines
                : [{ text: "signing happens in this page, with the derived owner key", tone: "dim" }]
            } />

            {cancelFailure ? <FailureNote failure={cancelFailure} /> : null}

            <Button variant="destructive" size="md" onClick={() => setConfirmCancel(true)}>
              sign cancel
            </Button>
            <p className="text-[11px] text-text-caption">
              irreversible. Dim red is used here and on a verify failure, nowhere else.
            </p>
            <ConfirmDialog
              open={confirmCancel}
              onOpenChange={setConfirmCancel}
              title="Sign the cancel"
              body="This produces a signature that stops every future charge against this commitment. It refunds nothing already charged, and once the signature exists anyone holding it can submit it."
              verb="sign cancel"
              onConfirm={doSignCancel}
            />
          </Step>

          <Step n="02" name="CHOOSE THE SUBMITTER" active={cancelSig !== null} note="both paths are first-class">
            <SubmitterChoice
              pick={cancelPick}
              onPick={setCancelPick}
              relayLine={
                cancelSig
                  ? relayCommand("cancel", { commitment: identity.commitment, sig: cancelSig })
                  : null
              }
            />
            {cancelPick === "self" ? (
              <>
                <Button
                  variant="destructive"
                  size="md"
                  disabled={cancelSig === null || cancelBusy}
                  onClick={() => void doSubmitCancel()}
                >
                  {cancelBusy ? "waiting for the wallet" : "submit the cancel from this wallet"}
                </Button>
                <p className="text-[11px] text-text-caption">
                  this writes your wallet into the transaction as the sender
                </p>
              </>
            ) : (
              <p className="text-[11px] text-text-caption">
                copy the line above and run it, or hand it to anyone who will. This page submits
                nothing on the relay path.
              </p>
            )}
            {cancelTx ? (
              <div className="flex flex-wrap items-center gap-3">
                <Badge variant="verified">SUBMITTED</Badge>
                <a href={VOYAGER_TX(cancelTx)} target="_blank" rel="noreferrer" className="text-[12px]">
                  {truncate(cancelTx)}
                </a>
              </div>
            ) : null}
          </Step>
        </div>
      </div>

      <div className="flex flex-col gap-5">
        <SectionHead note="a public exit edge, and the destination is bound by the signature">
          // RECLAIM · UNSPENT ESCROW BACK OUT
        </SectionHead>

        <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
          <Step n="01" name="SIGN THE RECLAIM" active={reclaimSig === null} note="cancel first">
            <Field
              label="DESTINATION"
              hint="a public address. Leave it empty to use the connected wallet. The reclaim is a public ERC-20 transfer out of the vault, so this address becomes visible."
              error={destinationProblem}
            >
              <TextInput
                value={toInput}
                placeholder={connection.address}
                invalid={destinationProblem !== null}
                onChange={(e) => {
                  setToInput(e.target.value);
                  setReclaimSig(null);
                }}
              />
            </Field>
            <KeyValue
              rows={[
                ["commitment", truncate(identity.commitment)],
                ["destination", truncate(destination)],
                ["requires", "a cancelled subscription with escrow left"],
              ]}
            />
            <p className="text-[13px] leading-[1.6] text-text-prose">
              The destination sits inside the signed message. A relay that edits it breaks the
              signature, so the worst any submitter can do is decline to submit.
            </p>
            <Narration label="reclaim" minHeight="4.6em" lines={
              reclaimLines.length > 0
                ? reclaimLines
                : [{ text: "sign to produce a reclaim bound to one destination", tone: "dim" }]
            } />
            {reclaimFailure ? <FailureNote failure={reclaimFailure} /> : null}
            <Button
              variant="destructive"
              size="md"
              disabled={destinationProblem !== null}
              onClick={() => setConfirmReclaim(true)}
            >
              sign reclaim
            </Button>
            <ConfirmDialog
              open={confirmReclaim}
              onOpenChange={setConfirmReclaim}
              title="Sign the reclaim"
              body={`This binds the remaining escrow to ${truncate(destination)} and to nowhere else. The transfer out of the vault is public, like every pool edge.`}
              verb="sign reclaim"
              onConfirm={doSignReclaim}
            />
          </Step>

          <Step n="02" name="CHOOSE THE SUBMITTER" active={reclaimSig !== null} note="same choice, same signature">
            <SubmitterChoice
              pick={reclaimPick}
              onPick={setReclaimPick}
              relayLine={
                reclaimSig
                  ? relayCommand("reclaim", {
                      commitment: identity.commitment,
                      to: destination,
                      sig: reclaimSig,
                    })
                  : null
              }
            />
            {reclaimPick === "self" ? (
              <>
                <Button
                  variant="destructive"
                  size="md"
                  disabled={reclaimSig === null || reclaimBusy}
                  onClick={() => void doSubmitReclaim()}
                >
                  {reclaimBusy ? "waiting for the wallet" : "submit the reclaim from this wallet"}
                </Button>
                <p className="text-[11px] text-text-caption">
                  this writes your wallet into the transaction as the sender, next to a destination
                  that is already public
                </p>
              </>
            ) : (
              <p className="text-[11px] text-text-caption">
                the relay pays the gas and learns the commitment and the destination, both of which
                the transaction publishes anyway
              </p>
            )}
            {reclaimTx ? (
              <div className="flex flex-wrap items-center gap-3">
                <Badge variant="verified">SUBMITTED</Badge>
                <a href={VOYAGER_TX(reclaimTx)} target="_blank" rel="noreferrer" className="text-[12px]">
                  {truncate(reclaimTx)}
                </a>
              </div>
            ) : null}
          </Step>
        </div>
      </div>
    </section>
  );
}
