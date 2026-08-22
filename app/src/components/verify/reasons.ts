// The failure vocabulary, rendered verbatim.
//
// The left column is the reason string the check returns, character for
// character. The right column is a plain sentence about what that string
// means, kept next to it so an operator reading a gate log and a person
// reading this page are reading the same word for the same refusal. The page
// never rewords a reason, never sentence-cases it, and never apologizes for
// it: a refusal is a normal answer.

import { REASONS } from "../../lib/verify";
import type { Reason } from "../../lib/verify";

export type ReasonNote = {
  reason: Reason;
  /** What the string means, in one sentence. */
  meaning: string;
  /** What to do about it, when there is something to do. */
  fix?: string;
};

export const REASON_NOTES: readonly ReasonNote[] = [
  {
    reason: REASONS.VERIFIER_MISMATCH,
    meaning: "The presentation carries another gate's verifier id.",
    fix: "It answers a challenge from somewhere else. Sign the challenge this page issued.",
  },
  {
    reason: REASONS.EXPIRED,
    meaning: "expiry_block is behind the current block, so the challenge aged out.",
    fix: "Nothing is wrong with the subscription. Ask the gate for a fresh challenge.",
  },
  {
    reason: REASONS.EXPIRY_TOO_FAR,
    meaning: "expiry_block sits more than 2100 blocks ahead of the head.",
    fix: "A presentation signed that far out would be a standing bearer credential, so the check refuses it.",
  },
  {
    reason: REASONS.NONCE_MISMATCH,
    meaning: "The nonce is not the one this challenge issued.",
    fix: "This is where replay dies: the signature may be perfect and still answer a question nobody is asking.",
  },
  {
    reason: REASONS.NOT_ACTIVE,
    meaning: "The vault holds no schedule for that commitment, or the subscription was cancelled.",
  },
  {
    reason: REASONS.ARREARS,
    meaning: "The paid window does not cover the current block: period 0 was never charged, or the escrow ran out.",
    fix: "The subscription is real, it is just not paid up right now.",
  },
  {
    reason: REASONS.UNKNOWN_COMMITMENT,
    meaning: "The vault stores no owner key for that commitment, so there is nothing to check a signature against.",
  },
  {
    reason: REASONS.BAD_SIGNATURE,
    meaning: "The signature does not check against the owner key the vault recorded at subscribe time.",
    fix: "A different key signed it, or a field was edited after signing.",
  },
  {
    reason: REASONS.MALFORMED_PRESENTATION,
    meaning: "The pasted JSON is not a presentation: a field is missing, is not a felt, or is out of field range.",
  },
  {
    reason: REASONS.RPC_ERROR,
    meaning: "Every configured JSON-RPC endpoint failed, so the vault state was never read.",
    fix: "The verdict is unknown, not negative. Retry.",
  },
  {
    reason: REASONS.BAD_CONFIG,
    meaning: "The challenge this page would check against is incomplete.",
    fix: "Go back to step 01 and parse or generate a challenge.",
  },
];

const BY_REASON = new Map(REASON_NOTES.map((n) => [n.reason, n]));

export const reasonNote = (reason: Reason): ReasonNote | undefined => BY_REASON.get(reason);
