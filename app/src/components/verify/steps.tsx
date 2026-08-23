// The three step bodies.
//
// 01 accepts the challenge a gate issued, or issues one locally so the surface
// works with no gate bot in the loop. 02 signs it: in this page, when a
// subscriber master secret already lives in this browser (SelfSign, calling
// lib/wallet/keys.ts), or in the ops console otherwise (ConsoleFallback). No
// path here has a field for a private key or a master secret; the self-sign
// path asks only for the public account address that secret is combined
// with. 03 runs the check.

import { useEffect, useRef, useState } from "react";

import { fmtBlock, STRK } from "../../config";
import { hex, toFelt } from "../../lib/verify";
import type { ParsedChallenge, Verdict } from "../../lib/verify";
import { signPresentation, storedKeyState } from "../../lib/wallet/keys";
import { CaveatDisclosure } from "../board/primitives";
import { Button } from "../ui/button";
import { CHALLENGE_WINDOW } from "./chain";
import { Field, KeyValue, TextArea, TextInput } from "./step";
import { VerifyStatus } from "./verdict";

const CONSOLE_URL = "https://github.com/kshitij-hash/nightshift/tree/main/web";

/** Every key a gate bot's extra JSON might carry that names an account,
 *  checked in this order. Standard challenges (verify/README.md) carry none
 *  of these; this is only ever a convenience prefill, never a requirement. */
const ACCOUNT_HINT_KEYS = [
  "account_address",
  "accountAddress",
  "subscriber_address",
  "wallet_address",
  "address",
  "account",
];

/** Read an account address out of a pasted challenge's extra fields, when the
 *  gate bothered to include one. */
function accountHintFrom(raw: Record<string, unknown>): string {
  for (const key of ACCOUNT_HINT_KEYS) {
    const v = raw[key];
    if (typeof v === "string" && v.trim() !== "") return v.trim();
  }
  return "";
}

/** A felt-shaped account address, or the reason it is not one. Mirrors
 *  lib/wallet/core.ts's feltError without importing that module: this
 *  surface is fenced to lib/wallet/keys.ts and lib/verify.ts. */
function accountAddressError(raw: string): string | null {
  const t = raw.trim();
  if (t === "") return "account address is empty";
  let felt: bigint;
  try {
    felt = toFelt(t, "account address");
  } catch {
    return "account address must be 0x-hex or decimal, under the STARK field prime.";
  }
  if (felt === 0n) return "account address must not be zero";
  return null;
}

const CHALLENGE_PLACEHOLDER = `{
  "verifier_id": "DOOR_1",
  "nonce": "0x9f2c4a1b7e0d3856...",
  "expiry_block": 13659458
}`;

const PRESENTATION_PLACEHOLDER =
  '{"commitment":"0x743b3e7f...","verifier_id":"0x444f4f525f31","expiry_block":13659458,"nonce":"0x9f2c...","sig_r":"0x...","sig_s":"0x..."}';

/** The challenge as one line of JSON, which is the form it is signed from. */
export const challengeJson = (c: ParsedChallenge): string =>
  JSON.stringify({
    verifier_id: hex(c.verifierId),
    nonce: hex(c.nonce),
    expiry_block: Number(c.expiryBlock),
  });

function CopyLine({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-[11px] font-medium tracking-[0.14em] text-text-label">{label}</span>
        <Button
          variant="ghost"
          size="sm"
          className="min-h-11 md:min-h-6"
          onClick={() => {
            void navigator.clipboard?.writeText(text);
            setCopied(true);
            if (timer.current !== null) window.clearTimeout(timer.current);
            timer.current = window.setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? "COPIED" : "COPY"}
        </Button>
      </div>
      <pre className="overflow-x-auto rounded-sm border border-border-field bg-surface-field px-3 py-2.5 text-[12px] leading-[1.6] text-text-default">
        {text}
      </pre>
    </div>
  );
}

export function ChallengeStep({
  error,
  busy,
  onParse,
  onGenerate,
}: {
  error: string | null;
  busy: boolean;
  onParse: (text: string) => void;
  onGenerate: (verifierId: string) => void;
}) {
  const [text, setText] = useState("");
  const [verifierId, setVerifierId] = useState("DOOR_1");
  return (
    <div className="flex flex-col gap-5">
      <Field
        hint="The gate issues this. It names the gate, the nonce that kills replay, and the block the challenge dies at. Whitespace and a surrounding code fence are tolerated."
        error={error}
      >
        <TextArea
          rows={7}
          value={text}
          placeholder={CHALLENGE_PLACEHOLDER}
          invalid={error !== null}
          aria-label="challenge JSON"
          onChange={(e) => setText(e.target.value)}
        />
      </Field>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          size="md"
          className="min-h-11 md:min-h-8"
          disabled={busy}
          onClick={() => onParse(text)}
        >
          PARSE CHALLENGE
        </Button>
        <span className="text-[12px] text-text-caption">
          Parsed in this page. Nothing is sent anywhere at this step.
        </span>
      </div>

      <div className="flex flex-col gap-3 border-t border-border-row pt-4">
        <div className="text-[11px] font-medium tracking-[0.14em] text-text-label">
          OR ISSUE A CHALLENGE HERE
        </div>
        <p className="text-[13px] leading-[1.6] text-text-prose">
          With no gate bot in the loop, this page issues the challenge: current block, expiry{" "}
          {fmtBlock(CHALLENGE_WINDOW)} blocks ahead, 31 byte nonce from the browser.
        </p>
        <CaveatDisclosure
          label="how the id is encoded"
          openLabel="how the id is encoded, shown"
          caveat="A name of 31 characters or fewer is encoded as a Cairo short string, so DOOR_1 and its felt are the same id. The nonce comes from the browser's own random source, and the expiry is anchored to the head this page just read."
        />
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <TextInput
            value={verifierId}
            aria-label="verifier id"
            placeholder="DOOR_1 or 0x444f4f525f31"
            onChange={(e) => setVerifierId(e.target.value)}
            className="sm:max-w-[18rem]"
          />
          <Button
            variant="outline"
            size="md"
            className="min-h-11 md:min-h-8"
            disabled={busy}
            onClick={() => onGenerate(verifierId)}
          >
            GENERATE A LOCAL CHALLENGE
          </Button>
        </div>
      </div>
    </div>
  );
}

/** The console fallback: unchanged copy, for a subscription this browser's
 *  derived key cannot sign for (a legacy stored key, or an account this
 *  browser never connected with). */
function ConsoleFallback({
  challenge,
  source,
  onSigned,
}: {
  challenge: ParsedChallenge;
  source: "pasted" | "generated" | null;
  onSigned: () => void;
}) {
  return (
    <>
      <CopyLine text={challengeJson(challenge)} label="THE CHALLENGE TO SIGN" />
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" size="md" className="min-h-11 md:min-h-8" onClick={onSigned}>
          I HAVE THE PRESENTATION
        </Button>
        <span className="text-[12px] text-text-caption">
          {source === "generated"
            ? "this challenge was issued by this page, so its expiry is already anchored to the current head"
            : "the challenge came from the gate, so sign it exactly as issued"}
          {" · "}
          <a href={CONSOLE_URL} target="_blank" rel="noreferrer">
            panel 7 in the repo ↗
          </a>
        </span>
      </div>
    </>
  );
}

/** The self-sign path: a master secret already lives in this browser
 *  (nightshift.subscriber.secret, the same key the ops console and /manage
 *  read), so lib/wallet/keys.ts can derive the commitment and the owner key
 *  and sign this exact challenge without a console in the loop.
 *
 *  Every value this component touches after signing is public: a commitment
 *  and a signature. signPresentation never returns a private key, and
 *  nothing here stores one in state, prints one, or puts one in the DOM. */
function SelfSign({
  challenge,
  onUsePresentation,
}: {
  challenge: ParsedChallenge;
  onUsePresentation: (text: string) => void;
}) {
  const [accountAddress, setAccountAddress] = useState(() => accountHintFrom(challenge.raw));
  const [signed, setSigned] = useState<{ commitment: string; text: string } | null>(null);
  const [signError, setSignError] = useState<string | null>(null);

  const addressProblem = accountAddress.trim() === "" ? null : accountAddressError(accountAddress);
  const canSign = accountAddressError(accountAddress) === null;

  const clearResult = () => {
    setSigned(null);
    setSignError(null);
  };

  const signHere = () => {
    clearResult();
    try {
      const verifierId = hex(challenge.verifierId);
      const nonce = hex(challenge.nonce);
      const expiryBlock = Number(challenge.expiryBlock);
      const { commitment, sig } = signPresentation(accountAddress.trim(), STRK, {
        verifierId,
        expiryBlock: String(expiryBlock),
        nonce,
      });
      const presentation = {
        commitment,
        verifier_id: verifierId,
        expiry_block: expiryBlock,
        nonce,
        sig_r: sig.r,
        sig_s: sig.s,
      };
      setSigned({ commitment, text: JSON.stringify(presentation) });
    } catch (e) {
      setSignError(e instanceof Error ? e.message : "signing failed for this account address.");
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <p className="text-[13px] leading-[1.7] text-text-prose">
        This browser holds a subscriber master secret, the one nightshift.subscriber.secret names,
        the same one the ops console and /manage read. The signature below is computed in this
        page: the owner key is derived from that secret for this one commitment and discarded the
        moment it signs. The secret never leaves the browser, and signing sends nothing anywhere.
      </p>
      <Field
        hint="the wallet address you connected with when you subscribed. Together with this browser's payout key it is what your creator id, commitment and owner key are derived from, so the same address reproduces the same three /manage showed you."
        error={addressProblem}
      >
        <TextInput
          value={accountAddress}
          placeholder="0x04a3f81c9d2e7b6a5f4e3d2c1b0a998877665544332211009988776655444b19"
          invalid={addressProblem !== null}
          aria-label="account address"
          onChange={(e) => {
            setAccountAddress(e.target.value);
            clearResult();
          }}
        />
      </Field>
      <div className="flex flex-wrap items-center gap-3">
        <Button size="md" className="min-h-11 md:min-h-8" disabled={!canSign} onClick={signHere}>
          SIGN HERE
        </Button>
        <span className="text-[12px] text-text-caption">signed in this page, over this exact challenge</span>
      </div>
      {signError ? (
        <p
          role="alert"
          className="border-l-2 border-destructive pl-3 text-[12px] leading-[1.55] text-destructive"
        >
          {signError}
        </p>
      ) : null}
      {signed ? (
        <>
          <CopyLine text={signed.text} label="THE PRESENTATION" />
          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="outline"
              size="md"
              className="min-h-11 md:min-h-8"
              onClick={() => onUsePresentation(signed.text)}
            >
              USE THIS PRESENTATION
            </Button>
            <span className="text-[12px] text-text-caption">
              sends it to step 03 directly, no copy or paste
            </span>
          </div>
        </>
      ) : null}
      <p className="text-[12px] leading-[1.6] text-text-caption">
        Signing reveals the commitment to this verifier. What that does and does not expose is in
        the panel to the right.
      </p>
    </div>
  );
}

export function SignStep({
  challenge,
  source,
  onSigned,
  onUsePresentation,
}: {
  challenge: ParsedChallenge;
  source: "pasted" | "generated" | null;
  onSigned: () => void;
  onUsePresentation: (text: string) => void;
}) {
  const [hasMasterSecret] = useState(() => storedKeyState().secret);

  if (hasMasterSecret) {
    return (
      <div className="flex flex-col gap-4">
        <SelfSign challenge={challenge} onUsePresentation={onUsePresentation} />
        <div className="flex flex-col gap-3 border-t border-border-row pt-4">
          <div className="text-[11px] font-medium tracking-[0.14em] text-text-label">
            OR SIGN ELSEWHERE
          </div>
          <p className="text-[13px] leading-[1.6] text-text-prose">
            The ops console, panel 7, signs with a stored owner key instead of a derived one. That
            is the path for a subscription made before per-commitment keys, or for an account this
            browser never connected with.
          </p>
          <ConsoleFallback challenge={challenge} source={source} onSigned={onSigned} />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-[13px] leading-[1.7] text-text-prose">
        Signing happens in the ops console, panel 7, present tier proof. The console signs this
        challenge with the subscription's owner key, the key the vault recorded at subscribe time,
        and hands back the presentation as one line of JSON.
      </p>
      <p className="text-[13px] leading-[1.7] text-text-default">
        This page never asks for that key and has no field that would accept one. A verifier issues
        a challenge and checks a signature; it has no use for a private key and no way to receive
        one here.
      </p>
      <CopyLine text={challengeJson(challenge)} label="THE CHALLENGE TO SIGN" />
      <p className="text-[12px] leading-[1.6] text-text-caption">
        Signing reveals the commitment to this verifier. What that does and does not expose is in
        the panel to the right.
      </p>
      <p className="text-[11px] text-text-caption">
        a browser that has subscribed on /manage can sign here directly, with no console in the
        loop.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" size="md" className="min-h-11 md:min-h-8" onClick={onSigned}>
          I HAVE THE PRESENTATION
        </Button>
        <span className="text-[12px] text-text-caption">
          {source === "generated"
            ? "this challenge was issued by this page, so its expiry is already anchored to the current head"
            : "the challenge came from the gate, so sign it exactly as issued"}
          {" · "}
          <a href={CONSOLE_URL} target="_blank" rel="noreferrer">
            panel 7 in the repo ↗
          </a>
        </span>
      </div>
    </div>
  );
}

export function VerdictStep({
  error,
  phase,
  verdict,
  text,
  onCheck,
}: {
  error: string | null;
  phase: "idle" | "validating" | "checking" | "done";
  verdict: Verdict | null;
  text: string;
  onCheck: (text: string) => void;
}) {
  const [value, setValue] = useState(text);
  const checking = phase === "checking";
  return (
    <div className="flex flex-col gap-4">
      <Field
        hint="Paste the signed presentation. The check runs in this page against the vault's public state: two read-only view calls, no transaction, no key."
        error={error}
      >
        <TextArea
          rows={5}
          value={value}
          placeholder={PRESENTATION_PLACEHOLDER}
          invalid={error !== null}
          aria-label="presentation JSON"
          onChange={(e) => setValue(e.target.value)}
        />
      </Field>
      <div className="flex flex-wrap items-center gap-4">
        <Button
          size="md"
          className="min-h-11 md:min-h-8"
          disabled={checking}
          onClick={() => onCheck(value)}
        >
          {checking ? "CHECKING…" : "VERIFY"}
        </Button>
        <VerifyStatus phase={phase} verdict={verdict} />
      </div>
    </div>
  );
}

/** The one-line summaries a closed step keeps on screen. */
export function ChallengeSummary({
  challenge,
  source,
}: {
  challenge: ParsedChallenge;
  source: "pasted" | "generated" | null;
}) {
  return (
    <KeyValue
      rows={[
        ["verifier_id", hex(challenge.verifierId)],
        ["nonce", <span key="n" className="break-all">{hex(challenge.nonce)}</span>],
        ["expiry_block", fmtBlock(Number(challenge.expiryBlock))],
        ["source", source === "generated" ? "issued by this page" : "pasted from the gate"],
      ]}
    />
  );
}
