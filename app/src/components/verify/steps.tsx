// The three step bodies.
//
// 01 accepts the challenge a gate issued, or issues one locally so the surface
// works with no gate bot in the loop. 02 says where signing happens and states,
// plainly, that this page has no field for a key. 03 runs the check.

import { useEffect, useRef, useState } from "react";

import { fmtBlock } from "../../config";
import { hex } from "../../lib/verify";
import type { ParsedChallenge, Verdict } from "../../lib/verify";
import { Button } from "../ui/button";
import { CHALLENGE_WINDOW } from "./chain";
import { LinkabilityNote } from "./linkability";
import { Field, KeyValue, TextArea, TextInput } from "./step";
import { VerifyStatus } from "./verdict";

const CONSOLE_URL = "https://github.com/kshitij-hash/nightshift/tree/main/web";

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
        <p className="text-[12.5px] leading-[1.6] text-text-prose">
          With no gate bot in the loop, this page can be the verifier. It reads the current mainnet
          block, sets the expiry {fmtBlock(CHALLENGE_WINDOW)} blocks ahead, and draws a 31 byte
          nonce from the browser's own random source. A name of 31 characters or fewer is encoded
          as a Cairo short string, so DOOR_1 and its felt are the same id.
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

export function SignStep({
  challenge,
  source,
  onSigned,
}: {
  challenge: ParsedChallenge;
  source: "pasted" | "generated" | null;
  onSigned: () => void;
}) {
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
      <LinkabilityNote />
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
