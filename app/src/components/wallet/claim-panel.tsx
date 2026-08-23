// Claim, the creator side, in three phases because of a real constraint.
//
// The open-note id is computed by the WALLET and cannot be derived by a dapp,
// while the creator's signature has to bind that exact id. So PREPARE builds
// and proves the batch without submitting and the id is read back out of the
// call the wallet built; the signature is made here over that id; SEND submits
// the same batch with the placeholder, which the wallet resolves to the same
// id the signature binds.
//
// The assumption is that the note index does not advance between the two
// phases, which means no other pool activity from this wallet in between. If
// it ever did drift, the resolved id would differ from the signed one and the
// vault answers NS_BAD_SIGNATURE. That is fail-safe: a wrong note is never
// paid, the claim simply does not land.

import { useEffect, useState } from "react";

import { STRK, VAULT, VOYAGER_TX } from "../../config";
import { getRpcClient } from "../../lib/rpc-instance";
import { claimableOf } from "../../lib/rpc/views";
import type { Connection } from "../../lib/wallet/bridge";
import {
  OPEN_NOTE_PLACEHOLDER,
  claimActions,
  fmtStrk,
  resolveNoteId,
  strkToWei,
  truncate,
  type Signature,
} from "../../lib/wallet/core";
import { signClaim, type PublicIdentity } from "../../lib/wallet/keys";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { FailureNote, toFailure, type Failure } from "./failure";
import {
  Field,
  KeyValue,
  Narration,
  SectionHead,
  Step,
  TextInput,
  type NarrationLine,
} from "./primitives";

export function ClaimPanel({
  connection,
  identity,
}: {
  connection: Connection;
  identity: PublicIdentity;
}) {
  const [amountInput, setAmountInput] = useState("1.00");
  const [claimable, setClaimable] = useState<bigint | null>(null);
  const [noteId, setNoteId] = useState<string | null>(null);
  const [sig, setSig] = useState<Signature | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [busy, setBusy] = useState<null | "prepare" | "send">(null);
  const [lines, setLines] = useState<NarrationLine[]>([]);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [rawCalldata, setRawCalldata] = useState<string[] | null>(null);

  const amountWei = strkToWei(amountInput);
  const amountProblem =
    amountWei === null ? "amount must be a number with at most two decimals" : null;

  useEffect(() => {
    let cancelled = false;
    claimableOf(getRpcClient(), identity.creatorId)
      .then((v) => {
        if (!cancelled) setClaimable(v);
      })
      .catch(() => {
        if (!cancelled) setClaimable(null);
      });
    return () => {
      cancelled = true;
    };
  }, [identity.creatorId]);

  const reset = () => {
    setNoteId(null);
    setSig(null);
    setTxHash(null);
    setRawCalldata(null);
  };

  const prepare = async () => {
    if (amountWei === null) return;
    setFailure(null);
    reset();
    setBusy("prepare");
    setLines([
      { text: "prepare · claim", tone: "dim" },
      {
        text:
          claimable === null
            ? "claimable balance unread, the vault view did not answer"
            : `claimable = ${fmtStrk(claimable)} STRK for creator ${truncate(identity.creatorId)}`,
        tone: "plain",
      },
      { text: "asking the wallet to build the batch and resolve an open note", tone: "dim" },
    ]);
    try {
      const prepared = await connection.prepareInvoke(
        claimActions({
          vault: VAULT,
          token: STRK,
          accountAddress: connection.address,
          creatorId: identity.creatorId,
          amountWei,
          noteId: OPEN_NOTE_PLACEHOLDER,
          sig: null,
        }),
      );
      const resolved = resolveNoteId(prepared.calldata, identity.creatorId, amountWei);
      if (resolved === null) {
        setRawCalldata(prepared.calldata);
        setLines((l) => [
          ...l,
          {
            text: "prepared, but the [creator_id, ?, amount, 1, 1] pattern is not in the pool calldata",
            tone: "bad",
          },
          { text: "the whole calldata is printed below: read the note id out of it by hand", tone: "dim" },
        ]);
      } else {
        setNoteId(resolved);
        setLines((l) => [
          ...l,
          { text: `open note id resolved from the pool: ${resolved}`, tone: "ok" },
          { text: "do nothing else with the wallet, then sign and send", tone: "dim" },
        ]);
      }
    } catch (e) {
      const f = toFailure(e);
      setFailure(f);
      setLines((l) => [...l, { text: `prepare refused: ${f.message}`, tone: "bad" }]);
    } finally {
      setBusy(null);
    }
  };

  const sign = () => {
    if (amountWei === null || noteId === null) return;
    setFailure(null);
    try {
      setSig(signClaim(connection.address, STRK, noteId, amountWei));
      setLines((l) => [
        ...l,
        { text: "signed with the payout key this creator registered", tone: "ok" },
        { text: "nothing was submitted and no network call was made", tone: "dim" },
      ]);
    } catch (e) {
      setFailure(toFailure(e));
    }
  };

  const send = async () => {
    if (amountWei === null || sig === null) return;
    setFailure(null);
    setBusy("send");
    setLines((l) => [...l, { text: "sending · the wallet is generating the proof", tone: "dim" }]);
    try {
      const hash = await connection.invokeTransaction(
        claimActions({
          vault: VAULT,
          token: STRK,
          accountAddress: connection.address,
          creatorId: identity.creatorId,
          amountWei,
          noteId: OPEN_NOTE_PLACEHOLDER,
          sig,
        }),
      );
      setTxHash(hash);
      setLines((l) => [...l, { text: `claim submitted: ${hash}`, tone: "ok" }]);
    } catch (e) {
      const f = toFailure(e);
      setFailure(f);
      setLines((l) => [...l, { text: `not submitted: ${f.message}`, tone: "bad" }]);
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="flex flex-col gap-5">
      <SectionHead note="creator side · two phases, then send">
        // CLAIM · PREPARE, SIGN, SEND
      </SectionHead>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <Step n="01" name="PREPARE" active={noteId === null} note="reads the pool">
          <p className="text-[13px] leading-[1.6] text-text-prose">
            Prepare asks the wallet to build the claim batch and resolve an open note to receive
            it. Nothing is signed and nothing is submitted, and running it twice changes nothing on
            chain.
          </p>
          <Field
            label="AMOUNT, STRK"
            hint="at most the claimable balance. The vault refuses more with NS_CLAIM_EXCEEDS_BALANCE."
            error={amountProblem}
          >
            <TextInput
              value={amountInput}
              inputMode="decimal"
              invalid={amountProblem !== null}
              onChange={(e) => {
                setAmountInput(e.target.value);
                reset();
              }}
            />
          </Field>
          <KeyValue
            rows={[
              ["creator", truncate(identity.creatorId)],
              ["claimable", claimable === null ? "unread" : `${fmtStrk(claimable)} STRK`],
              ["payout pubkey", truncate(identity.payoutPub)],
            ]}
          />
          <Narration
            label="claim"
            minHeight="5.6em"
            lines={lines.length > 0 ? lines : [{ text: "run prepare to resolve an open note id", tone: "dim" }]}
          />
          {failure ? <FailureNote failure={failure} /> : null}
          {rawCalldata ? (
            <pre className="max-h-40 overflow-auto border border-border-panel bg-surface-sunken px-3 py-2 text-[11px] break-all whitespace-pre-wrap text-text-caption">
              {rawCalldata.join(" ")}
            </pre>
          ) : null}
          <Button
            variant="default"
            size="md"
            disabled={amountProblem !== null || busy !== null}
            onClick={() => void prepare()}
          >
            {busy === "prepare" ? "waiting for the wallet" : "prepare"}
          </Button>
        </Step>

        <Step n="02" name="SIGN" active={noteId !== null && sig === null} note="the payout key, in this page">
          <KeyValue
            rows={[
              ["amount", amountWei === null ? "invalid" : `${fmtStrk(amountWei)} STRK`],
              ["note id", noteId === null ? "not resolved yet" : truncate(noteId)],
              ["signature", sig === null ? "not signed" : `${truncate(sig.r)} / ${truncate(sig.s)}`],
            ]}
          />
          <p className="text-[13px] leading-[1.6] text-text-prose">
            The claim moves the creator's claimable balance into a pool note. It names the creator,
            because a creator's topline is publicly derivable either way. It names no subscriber and
            says nothing about which charges it covers.
          </p>
          <Button variant="outline" size="md" disabled={noteId === null || sig !== null} onClick={sign}>
            sign the claim
          </Button>
          <p className="text-[11px] text-text-caption">
            prepare has to run first: the signature binds the note id the wallet resolved.
          </p>
        </Step>

        <Step n="03" name="SEND" active={sig !== null} note="one transaction">
          {txHash ? (
            <>
              <div className="flex flex-wrap items-center gap-3">
                <Badge variant="verified">CLAIMED</Badge>
                <span className="text-[11px] text-text-caption">accepted by the wallet</span>
              </div>
              <KeyValue
                rows={[
                  ["transaction", truncate(txHash)],
                  ["settled", amountWei === null ? "0.00 STRK" : `${fmtStrk(amountWei)} STRK`],
                  [
                    "unsettled after",
                    claimable === null || amountWei === null
                      ? "read the dashboard"
                      : `${fmtStrk(claimable > amountWei ? claimable - amountWei : 0n)} STRK`,
                  ],
                ]}
              />
              <a href={VOYAGER_TX(txHash)} target="_blank" rel="noreferrer" className="text-[12px]">
                verify on voyager ↗
              </a>
              <p className="text-[11px] text-text-caption">
                the dashboard's settled and unsettled tiles move at the same block
              </p>
            </>
          ) : (
            <>
              <p className="text-[13px] leading-[1.6] text-text-prose">
                Sending is one transaction. Until it lands the dashboard keeps showing the balance
                as unsettled, because that is what the chain says.
              </p>
              <Button variant="outline" size="md" disabled={sig === null || busy !== null} onClick={() => void send()}>
                {busy === "send" ? "waiting for the wallet" : "send the claim"}
              </Button>
              <p className="text-[11px] text-text-caption">
                the batch carries the note placeholder, not the literal id: the wallet's schema
                refuses a batch whose open note is not referenced by one, and it resolves the
                placeholder to the same note the signature binds.
              </p>
            </>
          )}
        </Step>
      </div>
    </section>
  );
}
