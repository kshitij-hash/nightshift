// Tier-presentation verification, running in the page.
//
// THE REFERENCE IMPLEMENTATION IS THE PUBLISHED `nightshift-verify` PACKAGE
// (verify/src/index.mjs in this repo). This file is a PORT of it, not a
// re-export: the package is a separate npm artifact that carries its own
// starknet RpcProvider, while this app reads the chain through its own
// RpcClient (endpoint failover, read-method allow list, snapshot fallback).
// Importing the package here would drag a second provider stack into the
// bundle and a second notion of what an RPC failure is.
//
// The two must not drift. Check order, reason strings, felt handling and the
// signed message layout are identical here on purpose, and
// app/test/verify-parity.test.mjs runs both against the same inputs and
// asserts the same verdict and the same reason. Any change to one is a change
// to the other.
//
// Nothing in this file touches a private key. A verifier issues a challenge
// and checks a presentation; signing happens elsewhere, with the subscription
// owner key, and this surface has no code path that could ask for one.

import { ec, hash, shortString } from "starknet";

/** STARK field prime. Every felt the vault stores or hashes lives below it. */
const STARK_PRIME = 2n ** 251n + 17n * 2n ** 192n + 1n;
const MAX_U64 = 2n ** 64n - 1n;

/**
 * The furthest ahead of the current block a presentation's expiry may sit,
 * matching the gate's MAX_PRESENT_WINDOW (one PERIOD_HOUR, 2100 blocks). A
 * presentation signed further out would be a long-lived bearer credential.
 */
export const MAX_WINDOW_BLOCKS = 2100;

/** Default distance from the current block to a challenge's expiry_block. */
export const DEFAULT_CHALLENGE_WINDOW = 1000;

/**
 * Every reason string a verdict can carry, in the order the checks run. These
 * are the stable machine-readable half of the result; the names follow the
 * gate's revert names where a check has an on-chain twin. Rendered verbatim,
 * never reworded.
 */
export const REASONS = {
  BAD_CONFIG: "bad_config",
  MALFORMED_PRESENTATION: "malformed_presentation",
  VERIFIER_MISMATCH: "verifier_mismatch",
  EXPIRED: "expired",
  EXPIRY_TOO_FAR: "expiry_too_far",
  NONCE_MISMATCH: "nonce_mismatch",
  NOT_ACTIVE: "not_active",
  ARREARS: "arrears",
  UNKNOWN_COMMITMENT: "unknown_commitment",
  BAD_SIGNATURE: "bad_signature",
  RPC_ERROR: "rpc_error",
} as const;

export type Reason = (typeof REASONS)[keyof typeof REASONS];

// --- felt plumbing ---------------------------------------------------------

export class FeltError extends Error {}
export class ConfigError extends Error {}

export type FeltInput = bigint | number | string | undefined | null;

/**
 * Parse a numeric felt. Accepts a bigint, a non-negative safe integer, a 0x-hex
 * string or a decimal string. A bare word is rejected here: short-string
 * encoding is only ever applied to a verifier id, where a human-readable door
 * name is the point.
 */
export function toFelt(value: unknown, label = "value"): bigint {
  let out: bigint;
  if (typeof value === "bigint") {
    out = value;
  } else if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 0) throw new FeltError(`${label} is not a valid value: use 0x-hex or a plain number`);
    out = BigInt(value);
  } else if (typeof value === "string") {
    const t = value.trim();
    if (!/^(0x[0-9a-fA-F]+|[0-9]+)$/.test(t)) throw new FeltError(`${label} is not a valid value: use 0x-hex or a plain number`);
    out = BigInt(t);
  } else {
    throw new FeltError(`${label} is missing`);
  }
  if (out < 0n || out >= STARK_PRIME) throw new FeltError(`${label} is too large to be an on-chain value`);
  return out;
}

/**
 * Parse a verifier id. 0x-hex and decimal pass through as felts; any other
 * string is encoded as a Cairo short string, so 'DOOR_1' and its felt are the
 * same id. Mirrors the ops console's asFelt.
 */
export function toVerifierFelt(value: unknown, label = "verifier_id"): bigint {
  if (typeof value === "string") {
    const t = value.trim();
    if (t === "") throw new FeltError(`${label} is empty`);
    if (!/^(0x[0-9a-fA-F]+|[0-9]+)$/.test(t)) {
      if (t.length > 31) throw new FeltError(`${label} is longer than a short string`);
      try {
        return toFelt(shortString.encodeShortString(t), label);
      } catch {
        throw new FeltError(`${label} is not encodable as a short string`);
      }
    }
  }
  return toFelt(value, label);
}

/** Canonical 0x-hex with no leading zeros, the form the vault calldata takes. */
export const hex = (v: bigint): string => `0x${v.toString(16)}`;

// --- the signed message ----------------------------------------------------

export type MessageFields = {
  commitment: bigint | string;
  verifierId: bigint | string;
  expiryBlock: bigint | number | string;
  nonce: bigint | string;
};

/**
 * poseidon(['NIGHTSHIFT_PRESENT', commitment, verifier_id, expiry_block, nonce]),
 * the exact message present_nonce_message builds in src/common.cairo and the
 * exact one the ops console signs.
 */
export function presentMessage({ commitment, verifierId, expiryBlock, nonce }: MessageFields): string {
  const c = toFelt(commitment, "commitment");
  const v = toVerifierFelt(verifierId);
  const e = toFelt(expiryBlock, "expiry_block");
  const n = toFelt(nonce, "nonce");
  if (e > MAX_U64) throw new FeltError("expiry_block does not fit in u64");
  return hash.computePoseidonHashOnElements([
    shortString.encodeShortString("NIGHTSHIFT_PRESENT"),
    hex(c),
    hex(v),
    hex(e),
    hex(n),
  ]);
}

/**
 * ECDSA check against a stored owner key.
 *
 * The vault stores the STARK public key as its x coordinate alone, while
 * ec.starkCurve.verify wants a curve point. Both y candidates are tried, which
 * is what Cairo's check_ecdsa_signature does with an x-only key: a signature
 * valid for either y is accepted, and that is also why (r, s) and (r, -s) both
 * verify. Out-of-range r or s makes the Signature constructor throw, which is
 * a failed check here, not an exception for the caller.
 */
export function checkPresentSignature(
  msgHash: string,
  ownerKey: bigint,
  r: bigint,
  s: bigint,
): boolean {
  let sig: InstanceType<typeof ec.starkCurve.Signature>;
  try {
    sig = new ec.starkCurve.Signature(r, s);
  } catch {
    return false;
  }
  const x = ownerKey.toString(16).padStart(64, "0");
  for (const parity of ["02", "03"]) {
    try {
      if (ec.starkCurve.verify(sig, msgHash, parity + x)) return true;
    } catch {
      // A point that does not lie on the curve for this parity is just a miss.
    }
  }
  return false;
}

// --- pure checks -----------------------------------------------------------

export type PresentationFields = {
  commitment: bigint;
  verifierId: bigint;
  expiryBlock: bigint;
  nonce: bigint;
  sigR: bigint;
  sigS: bigint;
};

/** The whole presentation as felts, or a reason it cannot be read. */
export function readPresentation(
  presentation: unknown,
): { fields: PresentationFields; reason?: undefined } | { fields?: undefined; reason: Reason } {
  if (!presentation || typeof presentation !== "object") {
    return { reason: REASONS.MALFORMED_PRESENTATION };
  }
  const p = presentation as Record<string, unknown>;
  try {
    const fields: PresentationFields = {
      commitment: toFelt(p.commitment, "commitment"),
      verifierId: toVerifierFelt(p.verifier_id),
      expiryBlock: toFelt(p.expiry_block, "expiry_block"),
      nonce: toFelt(p.nonce, "nonce"),
      sigR: toFelt(p.sig_r, "sig_r"),
      sigS: toFelt(p.sig_s, "sig_s"),
    };
    if (fields.expiryBlock > MAX_U64) return { reason: REASONS.MALFORMED_PRESENTATION };
    if (fields.commitment === 0n) return { reason: REASONS.MALFORMED_PRESENTATION };
    return { fields };
  } catch {
    return { reason: REASONS.MALFORMED_PRESENTATION };
  }
}

/**
 * The three checks that need no chain: the presentation answers THIS
 * verifier's challenge, and the height it was signed for is reachable and
 * near. Split out so the ordering is testable without a provider.
 */
export function checkChallengeBinding({
  fields,
  expectedVerifierId,
  expectedNonce,
  currentBlock,
  maxWindow,
}: {
  fields: PresentationFields;
  expectedVerifierId: bigint;
  expectedNonce: bigint;
  currentBlock: bigint;
  maxWindow: bigint;
}): Reason | null {
  if (fields.verifierId !== expectedVerifierId) return REASONS.VERIFIER_MISMATCH;
  if (fields.expiryBlock < currentBlock) return REASONS.EXPIRED;
  if (fields.expiryBlock > currentBlock + maxWindow) return REASONS.EXPIRY_TOO_FAR;
  if (fields.nonce !== expectedNonce) return REASONS.NONCE_MISMATCH;
  return null;
}

// --- the chain seam --------------------------------------------------------

/**
 * The only chain traffic in this file, injected rather than constructed. The
 * browser passes a reader backed by the app's RpcClient; the parity test
 * passes one backed by a table, which is how it runs with no network. Both
 * return the vault's felts in declaration order, exactly as the node does.
 */
export type ChainReader = {
  getBlockNumber(): Promise<number | bigint>;
  callVault(entrypoint: "schedule_of" | "owner_key_of", calldata: string[]): Promise<bigint[]>;
};

export type Verdict = {
  ok: boolean;
  creatorId: string | null;
  tier: number | null;
  reason: Reason | null;
};

const fail = (reason: Reason): Verdict => ({ ok: false, creatorId: null, tier: null, reason });

// --- challenge -------------------------------------------------------------

export type Challenge = {
  verifier_id: string;
  nonce: string;
  expiry_block: number;
};

/**
 * Build a fresh challenge for one request. The nonce is what kills replay: a
 * verifier accepts only a presentation carrying the nonce it just issued, so a
 * captured (sig_r, sig_s) is worth nothing at the next request.
 *
 * The expiry rides the current block, so the challenge dies on its own even if
 * the page is left open.
 */
export async function makeChallenge({
  verifierId,
  window = DEFAULT_CHALLENGE_WINDOW,
  reader,
}: {
  verifierId: unknown;
  window?: number;
  reader: ChainReader;
}): Promise<Challenge> {
  const v = toVerifierFelt(verifierId);
  if (!Number.isSafeInteger(window) || window <= 0) {
    throw new ConfigError("window must be a positive integer");
  }
  if (window > MAX_WINDOW_BLOCKS) {
    throw new ConfigError(`window may not exceed ${MAX_WINDOW_BLOCKS} blocks`);
  }
  const current = Number(await reader.getBlockNumber());
  const bytes = new Uint8Array(31);
  globalThis.crypto.getRandomValues(bytes);
  const nonce = `0x${[...bytes].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
  return { verifier_id: hex(v), nonce, expiry_block: current + window };
}

// --- the verdict -----------------------------------------------------------

/**
 * Check one presentation. Returns a verdict, never throws: a bad presentation,
 * a lapsed subscription and an unreachable node are all ok:false with a
 * reason, because a gate that crashes on a malformed input is a gate an
 * attacker can take down.
 *
 * Checks run in this order, stopping at the first failure:
 *   1. verifier_id is this verifier's own id            verifier_mismatch
 *   2. expiry_block is at or after the current block    expired
 *   3. expiry_block is within maxWindow of it           expiry_too_far
 *   4. nonce is the one this verifier issued            nonce_mismatch
 *   5. vault.schedule_of: known and not cancelled       not_active
 *   6. period 0 charged, and the paid window covers     arrears
 *      the current block (now < start + pb * next)
 *   7. vault.owner_key_of(commitment) is non-zero       unknown_commitment
 *   8. the signature verifies against that key          bad_signature
 * On success the (creator_id, tier) come from the same schedule_of read.
 * This is the on-chain gate's exact entitlement rule; is_active is not
 * consulted because it reads false during the final fully-paid period.
 */
export async function verifyPresentation({
  presentation,
  expectedVerifierId,
  expectedNonce,
  reader,
  maxWindow = MAX_WINDOW_BLOCKS,
  currentBlock,
}: {
  presentation: unknown;
  expectedVerifierId: unknown;
  expectedNonce: unknown;
  reader: ChainReader;
  maxWindow?: number;
  currentBlock?: number | bigint;
}): Promise<Verdict> {
  let expectedVerifier: bigint;
  let expectedNonceFelt: bigint;
  let window: bigint;
  try {
    // Runtime guard, not a type guard: this is the one entry point a caller
    // outside TypeScript (the parity test, a console paste) can reach.
    const r = reader as ChainReader | undefined;
    if (!r || typeof r.callVault !== "function" || typeof r.getBlockNumber !== "function") {
      throw new ConfigError("a chain reader is required");
    }
    if (!Number.isSafeInteger(maxWindow) || maxWindow <= 0) {
      throw new ConfigError("maxWindow must be a positive integer");
    }
    window = BigInt(maxWindow);
    expectedVerifier = toVerifierFelt(expectedVerifierId, "expectedVerifierId");
    expectedNonceFelt = toFelt(expectedNonce, "expectedNonce");
  } catch {
    return fail(REASONS.BAD_CONFIG);
  }

  const { fields, reason: parseReason } = readPresentation(presentation);
  if (parseReason !== undefined) return fail(parseReason);

  // The verifier id needs no chain, so an answer meant for another door is
  // refused before the node is touched at all.
  if (fields.verifierId !== expectedVerifier) return fail(REASONS.VERIFIER_MISMATCH);

  let now: bigint;
  try {
    now =
      currentBlock === undefined
        ? BigInt(await reader.getBlockNumber())
        : toFelt(currentBlock, "currentBlock");
  } catch {
    return fail(REASONS.RPC_ERROR);
  }

  const bindingReason = checkChallengeBinding({
    fields,
    expectedVerifierId: expectedVerifier,
    expectedNonce: expectedNonceFelt,
    currentBlock: now,
    maxWindow: window,
  });
  if (bindingReason !== null) return fail(bindingReason);

  const commitmentArg = [hex(fields.commitment)];
  let schedule: bigint[];
  let ownerKey: bigint[];
  try {
    // One schedule read carries the whole entitlement rule, mirroring the
    // on-chain gate: known and not cancelled; period 0 charged; and the paid
    // window covers the current block (now < start + period_blocks * next).
    // The old is_active flag is deliberately NOT consulted: charging the final
    // period flips it false at the exact moment the subscriber is fully paid,
    // which would deny the last paid period and every n_periods = 1 schedule.
    schedule = await reader.callVault("schedule_of", commitmentArg);
    if (schedule.length < 8) return fail(REASONS.RPC_ERROR);
    const creatorFelt = schedule[0]!;
    const periodBlocks = schedule[2]!;
    const startBlock = schedule[3]!;
    const nextPeriod = schedule[6]!;
    const cancelled = schedule[7]!;
    if (creatorFelt === 0n || cancelled !== 0n) return fail(REASONS.NOT_ACTIVE);
    if (nextPeriod === 0n) return fail(REASONS.ARREARS);
    if (now >= startBlock + periodBlocks * nextPeriod) return fail(REASONS.ARREARS);

    ownerKey = await reader.callVault("owner_key_of", commitmentArg);
    if (ownerKey.length === 0) return fail(REASONS.RPC_ERROR);
    // A commitment the vault never recorded reads 0 here. The schedule read
    // above already catches that (creator_id 0), so this is belt-and-braces,
    // kept for the gate's reason: an ECDSA check against a zero key is not one.
    if (ownerKey[0] === 0n) return fail(REASONS.UNKNOWN_COMMITMENT);
  } catch {
    return fail(REASONS.RPC_ERROR);
  }

  const msg = presentMessage({
    commitment: fields.commitment,
    verifierId: fields.verifierId,
    expiryBlock: fields.expiryBlock,
    nonce: fields.nonce,
  });
  if (!checkPresentSignature(msg, ownerKey[0]!, fields.sigR, fields.sigS)) {
    return fail(REASONS.BAD_SIGNATURE);
  }

  return { ok: true, creatorId: hex(schedule[0]!), tier: Number(schedule[1]!), reason: null };
}

// --- challenge parsing (this surface only) ---------------------------------

/**
 * What a gate bot hands a subscriber. The bot's own JSON may carry extra
 * fields (which creator and tier it wants, its own name); only the three the
 * signature binds are read here, and the rest is shown back unchanged so the
 * subscriber can see what they are answering.
 */
export type ParsedChallenge = {
  verifierId: bigint;
  nonce: bigint;
  expiryBlock: bigint;
  /** Every key the pasted object carried, for display. */
  raw: Record<string, unknown>;
};

/** Strip a markdown code fence and surrounding whitespace off a paste. */
export function stripFence(text: string): string {
  const t = text.trim();
  if (!t.startsWith("```")) return t;
  const withoutOpen = t.replace(/^```[a-zA-Z0-9_-]*\s*\n?/, "");
  return withoutOpen.replace(/\n?```\s*$/, "").trim();
}

export type ParseResult<T> = { value: T; error?: undefined } | { value?: undefined; error: string };

function parseJsonObject(text: string): ParseResult<Record<string, unknown>> {
  const cleaned = stripFence(text);
  if (cleaned === "") return { error: "Nothing pasted yet. Paste the JSON the gate issued." };
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return { error: "That is not valid JSON. Paste the whole object, braces included." };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { error: "That JSON is not an object. Expected a single { } with the fields inside." };
  }
  return { value: parsed as Record<string, unknown> };
}

/** Read a pasted challenge, reporting the first field that is wrong by name. */
export function parseChallenge(text: string): ParseResult<ParsedChallenge> {
  const obj = parseJsonObject(text);
  if (obj.error !== undefined) return { error: obj.error };
  const raw = obj.value;
  let verifierId: bigint;
  let nonce: bigint;
  let expiryBlock: bigint;
  try {
    verifierId = toVerifierFelt(raw.verifier_id ?? raw.gate, "verifier_id");
  } catch {
    return { error: "verifier_id is missing or is not a valid id." };
  }
  try {
    nonce = toFelt(raw.nonce, "nonce");
  } catch {
    return { error: "nonce is missing or invalid. It is the 0x value the gate issued." };
  }
  try {
    expiryBlock = toFelt(raw.expiry_block, "expiry_block");
  } catch {
    return { error: "expiry_block is missing or is not a block number." };
  }
  if (expiryBlock > MAX_U64) return { error: "expiry_block is not a usable block number." };
  return { value: { verifierId, nonce, expiryBlock, raw } };
}

/** Read a pasted presentation far enough to say what is wrong with it. The
 *  verdict path re-reads it through readPresentation, which is the check the
 *  reference implementation runs; this is only for the inline error. */
export function parsePresentation(text: string): ParseResult<Record<string, unknown>> {
  const obj = parseJsonObject(text);
  if (obj.error !== undefined) return { error: obj.error };
  const raw = obj.value;
  const missing = ["commitment", "verifier_id", "expiry_block", "nonce", "sig_r", "sig_s"].filter(
    (k) => raw[k] === undefined,
  );
  if (missing.length > 0) {
    return { error: `The presentation is missing ${missing.join(", ")}. Sign the challenge again.` };
  }
  return { value: raw };
}
