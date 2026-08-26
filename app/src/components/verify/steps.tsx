// The three step bodies.
//
// 01 accepts the challenge a gate issued, or issues one locally so the surface
// works with no gate bot in the loop. 02 signs it: in this page, when a
// subscriber master secret already lives in this browser (SelfSign, calling
// lib/wallet/keys.ts), or in the ops console otherwise (ConsoleFallback). No
// path here has a field for a private key or a master secret; the self-sign
// path asks only for the public creator id the subscription pays, which is
// what the commitment and owner key are derived from. 03 runs the check.

import { useEffect, useMemo, useRef, useState } from "react";

import { DEMO_CREATOR_ID, fmtBlock, truncate } from "../../config";
import { hex, toFelt } from "../../lib/verify";
import type { ParsedChallenge, Verdict } from "../../lib/verify";
import { commitmentsFor, signPresentationFor, storedKeyState } from "../../lib/wallet/keys";
import { useSubscriptions, useVaultCreators } from "../../query/useSubscriptions";
import { ScrambleIn } from "../motion/scramble-in";
import { Button } from "../ui/button";
import { CHALLENGE_WINDOW } from "./chain";
import { Field, KeyValue, TextArea, TextInput } from "./step";
import { VerifyStatus } from "./verdict";

/** A felt-shaped creator id, or the reason it is not one. Mirrors
 *  lib/wallet/core.ts's feltError without importing that module: this
 *  surface is fenced to lib/wallet/keys.ts and lib/verify.ts. */
function creatorIdError(raw: string): string | null {
  const t = raw.trim();
  if (t === "") return "creator id is empty";
  let felt: bigint;
  try {
    felt = toFelt(t, "creator id");
  } catch {
    return "creator id must be a 0x-hex or decimal id.";
  }
  if (felt === 0n) return "creator id must not be zero";
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
        {/* Keyed by the text so a freshly issued challenge types itself in;
            the same challenge re-rendering does not replay. */}
        <ScrambleIn key={text} text={text} speed={6} />
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
        hint="Paste it exactly as the gate sent it. It names the gate, a one-time number, and when it expires."
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
          Trying it without a bot? This page can issue its own challenge, valid
          for the next {fmtBlock(CHALLENGE_WINDOW)} blocks.
        </p>
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
  source,
  onUsePresentation,
}: {
  challenge: ParsedChallenge;
  source: "pasted" | "generated" | null;
  onUsePresentation: (text: string) => void;
}) {
  const [creatorId, setCreatorId] = useState("");
  const [signed, setSigned] = useState<{ commitment: string; text: string } | null>(null);
  const [signError, setSignError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (copyTimer.current !== null) window.clearTimeout(copyTimer.current);
    },
    [],
  );

  // The subscriptions this browser can prove it owns, found the same way
  // /manage finds them and from the same incremental caches. Reaching step 02
  // of a signing flow is the deliberate act that justifies reading the stored
  // secret; commitmentsFor returns public values only and never creates one.
  const creators = useVaultCreators(true);
  const candidates = useMemo(
    () => (creators.data ? commitmentsFor(creators.data.creatorIds) : null),
    [creators.data],
  );
  const mine = useSubscriptions(candidates).data?.subscriptions ?? [];

  // When the browser knows exactly which subscriptions exist, the field fills
  // itself: the first live one wins, once, and stays editable. Derived during
  // render so the fill and the paint it governs are the same paint.
  const [autoFilled, setAutoFilled] = useState(false);
  if (!autoFilled && mine.length > 0 && creatorId.trim() === "") {
    setAutoFilled(true);
    const preferred = mine.find((m) => !m.schedule.cancelled) ?? mine[0]!;
    setCreatorId(preferred.creatorId);
  }

  const creatorProblem = creatorId.trim() === "" ? null : creatorIdError(creatorId);
  const canSign = creatorIdError(creatorId) === null;

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
      const { commitment, sig } = signPresentationFor(creatorId.trim(), {
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
        This browser holds your subscription key. The signature is computed
        right here, with a key that exists only for the moment it signs —
        nothing leaves the browser.
      </p>
      <Field
        hint="the creator this subscription pays — the same id shown on your card at /manage."
        error={creatorProblem}
      >
        <TextInput
          value={creatorId}
          placeholder="0x…"
          invalid={creatorProblem !== null}
          aria-label="creator id"
          onChange={(e) => {
            setCreatorId(e.target.value);
            clearResult();
          }}
        />
      </Field>
      {mine.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] text-text-caption">found in this browser:</span>
          {mine.map((m) => (
            <Button
              key={m.commitment}
              variant="outline"
              size="sm"
              onClick={() => {
                setCreatorId(m.creatorId);
                clearResult();
              }}
            >
              creator {truncate(m.creatorId)} · tier {m.schedule.tier}
              {m.schedule.cancelled ? " · cancelled" : ""}
            </Button>
          ))}
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setCreatorId(DEMO_CREATOR_ID);
              clearResult();
            }}
          >
            use the demo creator
          </Button>
          <span className="text-[11px] text-text-caption">
            the creator registered on the live vault
          </span>
        </div>
      )}
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
            {/* The copy is the primary act when the challenge came from a
                gate: the presentation's whole destination is the chat that
                issued it. A big button, not a corner affordance. */}
            <Button
              size="md"
              className="min-h-11 md:min-h-8"
              onClick={() => {
                void navigator.clipboard?.writeText(signed.text);
                setCopied(true);
                if (copyTimer.current !== null) window.clearTimeout(copyTimer.current);
                copyTimer.current = window.setTimeout(() => setCopied(false), 1500);
              }}
            >
              {copied ? "COPIED" : "COPY THE PRESENTATION"}
            </Button>
            <Button
              variant="outline"
              size="md"
              className="min-h-11 md:min-h-8"
              onClick={() => onUsePresentation(signed.text)}
            >
              CHECK IT HERE INSTEAD
            </Button>
          </div>
          <span className="text-[12px] text-text-caption">
            {source === "pasted"
              ? "paste it back where the challenge came from - the bot or gate that issued it - and it answers with the verdict"
              : "copy it for a verifier, or run the check in step 03 right here"}
          </span>
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
        <SelfSign challenge={challenge} source={source} onUsePresentation={onUsePresentation} />
        <div className="flex flex-col gap-3 border-t border-border-row pt-4">
          <div className="text-[11px] font-medium tracking-[0.14em] text-text-label">
            OR SIGN ELSEWHERE
          </div>
          <p className="text-[13px] leading-[1.6] text-text-prose">
            A subscription made in another browser signs there instead, and the
            presentation pastes into step 03 the same way.
          </p>
          <ConsoleFallback challenge={challenge} source={source} onSigned={onSigned} />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-[13px] leading-[1.7] text-text-prose">
        This browser holds no subscription key, so signing happens where the key lives: the
        browser you subscribed from. Open this page there and it signs directly. The signature
        comes back as one line of JSON, the presentation, and pastes into step 03 here.
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
        a browser that has subscribed here can sign directly, with nothing else in the loop.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" size="md" className="min-h-11 md:min-h-8" onClick={onSigned}>
          I HAVE THE PRESENTATION
        </Button>
        <span className="text-[12px] text-text-caption">
          {source === "generated"
            ? "this challenge was issued by this page, so its expiry is already anchored to the current head"
            : "the challenge came from the gate, so sign it exactly as issued"}
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
        hint="Paste the signed presentation. The check runs in this page against the vault's public state: read-only, no transaction, no key."
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
