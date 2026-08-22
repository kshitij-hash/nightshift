// The verify surface's state machine.
//
// Six states, all of them designed: idle, validating, checking, success, one
// per failure reason, and rpc_error with a retry. They live in one hook so the
// route file stays a layout and so every transition is visible in one place.
//
// Nothing here holds key material. The only things this hook keeps are a
// challenge (public), a pasted presentation (a signature over that challenge)
// and a verdict.

import { useCallback, useRef, useState } from "react";

import {
  makeChallenge,
  parseChallenge,
  parsePresentation,
  REASONS,
  toVerifierFelt,
  verifyPresentation,
} from "../../lib/verify";
import type { ChainReader, ParsedChallenge, Reason, Verdict } from "../../lib/verify";
import { CHALLENGE_WINDOW, createVaultReader } from "./chain";

export type StepNumber = 1 | 2 | 3;

/** What the surface is doing right now. */
export type Phase = "idle" | "validating" | "checking" | "done";

export type VerifyState = {
  step: StepNumber;
  phase: Phase;
  /** The challenge every later check is measured against, once it parses. */
  challenge: ParsedChallenge | null;
  /** Where the challenge came from, so the page can say so. */
  challengeSource: "pasted" | "generated" | null;
  challengeError: string | null;
  presentationError: string | null;
  verdict: Verdict | null;
  /** The head block the verdict was read at, for the provenance line. */
  checkedAtBlock: number | null;
  /** The last presentation text, so retry after rpc_error needs no re-paste. */
  presentationText: string;
};

const INITIAL: VerifyState = {
  step: 1,
  phase: "idle",
  challenge: null,
  challengeSource: null,
  challengeError: null,
  presentationError: null,
  verdict: null,
  checkedAtBlock: null,
  presentationText: "",
};

/** Wrap a reader so the head block it returned is available for display. The
 *  check itself still asks for the block through the normal path, so an
 *  unreachable node is handled by the ported logic, not by this hook. */
function recordingReader(base: ChainReader, onBlock: (block: number) => void): ChainReader {
  return {
    async getBlockNumber() {
      const block = Number(await base.getBlockNumber());
      onBlock(block);
      return block;
    },
    callVault: (entrypoint, calldata) => base.callVault(entrypoint, calldata),
  };
}

export function useVerify() {
  const [state, setState] = useState<VerifyState>(INITIAL);
  const reader = useRef<ChainReader | null>(null);
  const readerFor = () => {
    if (reader.current === null) reader.current = createVaultReader();
    return reader.current;
  };

  const goToStep = useCallback((step: StepNumber) => {
    setState((s) => (s.challenge === null && step > 1 ? s : { ...s, step }));
  }, []);

  /** Step 01, paste path. Parsing is synchronous and local; the validating
   *  state exists so the button and the dot report it even on a fast machine. */
  const submitChallenge = useCallback((text: string) => {
    setState((s) => ({ ...s, phase: "validating", challengeError: null }));
    const parsed = parseChallenge(text);
    if (parsed.error !== undefined) {
      setState((s) => ({ ...s, phase: "idle", challenge: null, challengeError: parsed.error }));
      return;
    }
    setState((s) => ({
      ...s,
      phase: "idle",
      step: 2,
      challenge: parsed.value,
      challengeSource: "pasted",
      challengeError: null,
      verdict: null,
      checkedAtBlock: null,
    }));
  }, []);

  /** Step 01, standalone path: this page issues its own challenge so the
   *  surface works with no gate bot in the loop. The nonce is 31 random bytes
   *  from the browser's CSPRNG and the expiry rides the current head. */
  const generateChallenge = useCallback(async (verifierIdInput: string) => {
    setState((s) => ({ ...s, phase: "validating", challengeError: null }));
    try {
      toVerifierFelt(verifierIdInput, "verifier_id");
    } catch {
      setState((s) => ({
        ...s,
        phase: "idle",
        challengeError:
          "verifier_id must be 0x-hex, a decimal number, or a name of 31 characters or fewer.",
      }));
      return;
    }
    try {
      const challenge = await makeChallenge({
        verifierId: verifierIdInput,
        window: CHALLENGE_WINDOW,
        reader: readerFor(),
      });
      const parsed = parseChallenge(JSON.stringify(challenge));
      if (parsed.error !== undefined) {
        setState((s) => ({ ...s, phase: "idle", challengeError: parsed.error }));
        return;
      }
      setState((s) => ({
        ...s,
        phase: "idle",
        step: 2,
        challenge: parsed.value,
        challengeSource: "generated",
        challengeError: null,
        verdict: null,
        checkedAtBlock: null,
      }));
    } catch {
      setState((s) => ({
        ...s,
        phase: "idle",
        challengeError:
          "Every configured JSON-RPC endpoint failed, so the current block is unknown and an expiry cannot be set. Retry.",
      }));
    }
  }, []);

  /** Step 03. Runs the ported check against mainnet. It never throws: every
   *  outcome, including an unreachable node, comes back as a verdict. */
  const check = useCallback(
    async (text: string) => {
      const challenge = state.challenge;
      if (challenge === null) {
        setState((s) => ({ ...s, step: 1, presentationError: "Parse a challenge first." }));
        return;
      }
      const parsed = parsePresentation(text);
      if (parsed.error !== undefined) {
        setState((s) => ({
          ...s,
          presentationText: text,
          presentationError: parsed.error,
          phase: "idle",
          verdict: null,
        }));
        return;
      }
      setState((s) => ({
        ...s,
        presentationText: text,
        presentationError: null,
        phase: "checking",
        verdict: null,
      }));
      const seen: { block: number | null } = { block: null };
      const verdict = await verifyPresentation({
        presentation: parsed.value,
        expectedVerifierId: challenge.verifierId,
        expectedNonce: challenge.nonce,
        reader: recordingReader(readerFor(), (block) => {
          seen.block = block;
        }),
      });
      setState((s) => ({ ...s, phase: "done", verdict, checkedAtBlock: seen.block }));
    },
    [state.challenge],
  );

  /** rpc_error is the one failure with a retry: the vault state was never
   *  read, so the verdict is unknown rather than negative. */
  const retry = useCallback(() => {
    void check(state.presentationText);
  }, [check, state.presentationText]);

  const reset = useCallback(() => {
    setState((s) => ({
      ...s,
      step: 3,
      phase: "idle",
      verdict: null,
      checkedAtBlock: null,
      presentationError: null,
      presentationText: "",
    }));
  }, []);

  const failureReason: Reason | null =
    state.verdict !== null && !state.verdict.ok ? state.verdict.reason : null;
  const isRpcError = failureReason === REASONS.RPC_ERROR;

  return { state, goToStep, submitChallenge, generateChallenge, check, retry, reset, isRpcError };
}
