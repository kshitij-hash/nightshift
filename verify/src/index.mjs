// nightshift-verify: check a NIGHTSHIFT tier presentation entirely off-chain.
//
// A verifier (a Discord bot, a Telegram gate, a SaaS backend) hands out a
// challenge, the subscriber signs it with the subscription's owner key, and the
// verifier checks the signature against the owner key the vault recorded at
// subscribe time. No transaction, no gas, nothing written on-chain. The chain
// learns nothing from a presentation, because the only chain traffic is a
// handful of read-only view calls the verifier makes on its own behalf.
//
// What the verifier learns is the commitment, which is a subscription
// pseudonym, plus the (creator_id, tier) behind it. What it never learns is a
// wallet: the subscriber authorizes with the STARK key the vault stores for the
// commitment, never with an account address. The commitment is stable, so one
// verifier can recognize a returning subscriber and two verifiers comparing
// notes can tell they saw the same one. A client that wants presentations to
// different creators unlinked derives one owner key and one commitment per
// creator, the way web/app.mjs does.
//
// The message and every check here mirror src/common.cairo and src/gate.cairo.
// The on-chain `present` entrypoint stays the right call when a public receipt
// is wanted; this library is the same check with no receipt and no fee.

import { RpcProvider, ec, hash, shortString } from "starknet";

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
 * Every reason string verifyPresentation can return, in the order the checks
 * run. These are the stable machine-readable half of the result; the names
 * follow the gate's revert names where a check has an on-chain twin.
 */
export const REASONS = Object.freeze({
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
});

// --- felt plumbing ---------------------------------------------------------

class FeltError extends Error {}
class ConfigError extends Error {}

/**
 * Parse a numeric felt. Accepts a bigint, a non-negative safe integer, a 0x-hex
 * string or a decimal string. A bare word is rejected here: short-string
 * encoding is only ever applied to a verifier id, where a human-readable door
 * name is the point.
 *
 * @param {bigint|number|string} value
 * @param {string} label  field name, for the error message
 * @returns {bigint}
 */
export function toFelt(value, label = "value") {
  let out;
  if (typeof value === "bigint") {
    out = value;
  } else if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 0) throw new FeltError(`${label} is not a felt`);
    out = BigInt(value);
  } else if (typeof value === "string") {
    const t = value.trim();
    if (!/^(0x[0-9a-fA-F]+|[0-9]+)$/.test(t)) throw new FeltError(`${label} is not a felt`);
    out = BigInt(t);
  } else {
    throw new FeltError(`${label} is missing`);
  }
  if (out < 0n || out >= STARK_PRIME) throw new FeltError(`${label} is out of field range`);
  return out;
}

/**
 * Parse a verifier id. 0x-hex and decimal pass through as felts; any other
 * string is encoded as a Cairo short string, so 'DOOR_1' and its felt are the
 * same id. Mirrors the console's asFelt.
 *
 * @param {bigint|number|string} value
 * @returns {bigint}
 */
export function toVerifierFelt(value, label = "verifier_id") {
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
const hex = (v) => `0x${v.toString(16)}`;

// --- the signed message ----------------------------------------------------

/**
 * poseidon(['NIGHTSHIFT_PRESENT', commitment, verifier_id, expiry_block, nonce]),
 * the exact message present_nonce_message builds in src/common.cairo and the
 * exact one the console signs in web/app.mjs.
 *
 * @param {{commitment: bigint|string, verifierId: bigint|string,
 *          expiryBlock: bigint|number|string, nonce: bigint|string}} fields
 * @returns {string} 0x-hex message hash
 */
export function presentMessage({ commitment, verifierId, expiryBlock, nonce }) {
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
 * verify. Out-of-range r or s makes the Signature constructor throw, which is a
 * failed check here, not an exception for the caller.
 *
 * @param {string} msgHash  0x-hex
 * @param {bigint} ownerKey  x coordinate of the stored STARK public key
 * @param {bigint} r
 * @param {bigint} s
 * @returns {boolean}
 */
export function checkPresentSignature(msgHash, ownerKey, r, s) {
  let sig;
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

/**
 * The whole presentation as felts, or a reason it cannot be read.
 *
 * @param {object} presentation
 * @returns {{fields?: object, reason?: string}}
 */
export function readPresentation(presentation) {
  if (!presentation || typeof presentation !== "object") {
    return { reason: REASONS.MALFORMED_PRESENTATION };
  }
  try {
    const fields = {
      commitment: toFelt(presentation.commitment, "commitment"),
      verifierId: toVerifierFelt(presentation.verifier_id),
      expiryBlock: toFelt(presentation.expiry_block, "expiry_block"),
      nonce: toFelt(presentation.nonce, "nonce"),
      sigR: toFelt(presentation.sig_r, "sig_r"),
      sigS: toFelt(presentation.sig_s, "sig_s"),
    };
    if (fields.expiryBlock > MAX_U64) return { reason: REASONS.MALFORMED_PRESENTATION };
    if (fields.commitment === 0n) return { reason: REASONS.MALFORMED_PRESENTATION };
    return { fields };
  } catch {
    return { reason: REASONS.MALFORMED_PRESENTATION };
  }
}

/**
 * The three checks that need no chain: the presentation answers THIS verifier's
 * challenge, and the height it was signed for is reachable and near. Split out
 * so the ordering is testable without a provider.
 *
 * @param {{fields: object, expectedVerifierId: bigint, expectedNonce: bigint,
 *          currentBlock: bigint, maxWindow: bigint}} args
 * @returns {string|null} reason, or null when all three pass
 */
export function checkChallengeBinding({
  fields,
  expectedVerifierId,
  expectedNonce,
  currentBlock,
  maxWindow,
}) {
  if (fields.verifierId !== expectedVerifierId) return REASONS.VERIFIER_MISMATCH;
  if (fields.expiryBlock < currentBlock) return REASONS.EXPIRED;
  if (fields.expiryBlock > currentBlock + maxWindow) return REASONS.EXPIRY_TOO_FAR;
  if (fields.nonce !== expectedNonce) return REASONS.NONCE_MISMATCH;
  return null;
}

// --- vault reads -----------------------------------------------------------

/**
 * Read-only view calls, the only chain traffic in this library. The provider is
 * injectable: anything with callContract({contractAddress, entrypoint,
 * calldata}) and getBlockNumber() does, which is how the tests run with no
 * network at all.
 */
function vaultReader(provider, vaultAddress) {
  return async (entrypoint, calldata) => {
    const raw = await provider.callContract({
      contractAddress: vaultAddress,
      entrypoint,
      calldata,
    });
    const out = Array.isArray(raw) ? raw : (raw?.result ?? []);
    return out.map((x) => BigInt(x));
  };
}

function resolveProvider({ provider, rpcUrl }) {
  if (provider) return provider;
  if (typeof rpcUrl === "string" && rpcUrl.length > 0) return new RpcProvider({ nodeUrl: rpcUrl });
  throw new ConfigError("pass either a provider or an rpcUrl");
}

const fail = (reason) => ({ ok: false, creatorId: null, tier: null, reason });

// --- the three exports -----------------------------------------------------

/**
 * Build a fresh challenge for one request. The nonce is what kills replay: a
 * verifier accepts only a presentation carrying the nonce it just issued, so a
 * captured (sig_r, sig_s) is worth nothing at the next request.
 *
 * Store the returned challenge against the pending request (a Discord
 * interaction id, a session id) and hand the same object back to
 * verifyPresentation as expectedVerifierId and expectedNonce.
 *
 * @param {{verifierId: string|bigint|number, window?: number,
 *          provider?: object, rpcUrl?: string}} args
 * @returns {Promise<{verifier_id: string, nonce: string, expiry_block: number}>}
 */
export async function makeChallenge({
  verifierId,
  window = DEFAULT_CHALLENGE_WINDOW,
  provider,
  rpcUrl,
}) {
  const v = toVerifierFelt(verifierId);
  if (!Number.isSafeInteger(window) || window <= 0) throw new ConfigError("window must be a positive integer");
  if (window > MAX_WINDOW_BLOCKS) {
    throw new ConfigError(`window may not exceed ${MAX_WINDOW_BLOCKS} blocks`);
  }
  const p = resolveProvider({ provider, rpcUrl });
  const current = Number(await p.getBlockNumber());
  const bytes = new Uint8Array(31);
  globalThis.crypto.getRandomValues(bytes);
  const nonce = `0x${[...bytes].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
  return { verifier_id: hex(v), nonce, expiry_block: current + window };
}

/**
 * SUBSCRIBER SIDE ONLY. This function wants the subscription's owner PRIVATE
 * key. A verifier never has that key and never asks for it: a verifier runs
 * makeChallenge and verifyPresentation, nothing else. It lives in this package
 * so a subscriber-side script, a CLI, or a test can build a presentation
 * without copying the message layout, and it makes no network call.
 *
 * Sign the challenge exactly as it was issued. Signing a different verifier id,
 * expiry or nonce than the challenge carried produces a presentation the
 * verifier rejects.
 *
 * @param {{commitment: string|bigint, verifierId: string|bigint|number,
 *          expiryBlock: number|bigint|string, nonce: string|bigint,
 *          ownerPrivKey: string|bigint}} args
 * @returns {{commitment: string, verifier_id: string, expiry_block: number,
 *           nonce: string, sig_r: string, sig_s: string}}
 */
export function signPresentation({ commitment, verifierId, expiryBlock, nonce, ownerPrivKey }) {
  const c = toFelt(commitment, "commitment");
  const v = toVerifierFelt(verifierId);
  const e = toFelt(expiryBlock, "expiry_block");
  const n = toFelt(nonce, "nonce");
  if (ownerPrivKey === undefined || ownerPrivKey === null) {
    throw new ConfigError("ownerPrivKey is required");
  }
  const msg = presentMessage({ commitment: c, verifierId: v, expiryBlock: e, nonce: n });
  const sig = ec.starkCurve.sign(msg, ownerPrivKey);
  return {
    commitment: hex(c),
    verifier_id: hex(v),
    expiry_block: Number(e),
    nonce: hex(n),
    sig_r: hex(sig.r),
    sig_s: hex(sig.s),
  };
}

/**
 * Check one presentation. Returns a verdict, never throws: a bad presentation,
 * a lapsed subscription and an unreachable node are all ok:false with a reason,
 * because a gate that crashes on a malformed input is a gate an attacker can
 * take down.
 *
 * Checks run in this order, stopping at the first failure:
 *   1. verifier_id is this verifier's own id            verifier_mismatch
 *   2. expiry_block is at or after the current block    expired
 *   3. expiry_block is within maxWindow of it           expiry_too_far
 *   4. nonce is the one this verifier issued            nonce_mismatch
 *   5. vault.is_active(commitment)                      not_active
 *   6. vault.periods_due(commitment) === 0              arrears
 *   7. vault.owner_key_of(commitment) is non-zero       unknown_commitment
 *   8. the signature verifies against that key          bad_signature
 * On success the (creator_id, tier) come from vault.schedule_of.
 *
 * @param {{presentation: object, expectedVerifierId: string|bigint|number,
 *          expectedNonce: string|bigint, provider?: object, rpcUrl?: string,
 *          vaultAddress: string, maxWindow?: number, currentBlock?: number}} args
 * @returns {Promise<{ok: boolean, creatorId: string|null, tier: number|null,
 *                    reason: string|null}>}
 */
export async function verifyPresentation({
  presentation,
  expectedVerifierId,
  expectedNonce,
  provider,
  rpcUrl,
  vaultAddress,
  maxWindow = MAX_WINDOW_BLOCKS,
  currentBlock,
} = {}) {
  let expected;
  let node;
  let call;
  let window;
  try {
    if (typeof vaultAddress !== "string" || !/^0x[0-9a-fA-F]{1,64}$/.test(vaultAddress.trim())) {
      throw new ConfigError("vaultAddress must be a 0x-hex contract address");
    }
    if (!Number.isSafeInteger(maxWindow) || maxWindow <= 0) {
      throw new ConfigError("maxWindow must be a positive integer");
    }
    window = BigInt(maxWindow);
    expected = {
      verifierId: toVerifierFelt(expectedVerifierId, "expectedVerifierId"),
      nonce: toFelt(expectedNonce, "expectedNonce"),
    };
    node = resolveProvider({ provider, rpcUrl });
    call = vaultReader(node, vaultAddress.trim());
  } catch {
    return fail(REASONS.BAD_CONFIG);
  }

  const { fields, reason: parseReason } = readPresentation(presentation);
  if (parseReason) return fail(parseReason);

  // The verifier id needs no chain, so an answer meant for another door is
  // refused before the node is touched at all.
  if (fields.verifierId !== expected.verifierId) return fail(REASONS.VERIFIER_MISMATCH);

  let now;
  try {
    now =
      currentBlock === undefined
        ? BigInt(await node.getBlockNumber())
        : toFelt(currentBlock, "currentBlock");
  } catch {
    return fail(REASONS.RPC_ERROR);
  }

  const bindingReason = checkChallengeBinding({
    fields,
    expectedVerifierId: expected.verifierId,
    expectedNonce: expected.nonce,
    currentBlock: now,
    maxWindow: window,
  });
  if (bindingReason) return fail(bindingReason);

  const commitmentArg = [hex(fields.commitment)];
  let active;
  let due;
  let ownerKey;
  let schedule;
  try {
    active = await call("is_active", commitmentArg);
    if (active.length === 0) return fail(REASONS.RPC_ERROR);
    if (active[0] === 0n) return fail(REASONS.NOT_ACTIVE);

    due = await call("periods_due", commitmentArg);
    if (due.length === 0) return fail(REASONS.RPC_ERROR);
    if (due[0] !== 0n) return fail(REASONS.ARREARS);

    ownerKey = await call("owner_key_of", commitmentArg);
    if (ownerKey.length === 0) return fail(REASONS.RPC_ERROR);
    // A commitment the vault never recorded reads 0 here. is_active already
    // catches that on a real vault, so this is the belt-and-braces the gate
    // keeps for the same reason: an ECDSA check against a zero key is not one.
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
  if (!checkPresentSignature(msg, ownerKey[0], fields.sigR, fields.sigS)) {
    return fail(REASONS.BAD_SIGNATURE);
  }

  try {
    schedule = await call("schedule_of", commitmentArg);
    if (schedule.length < 2) return fail(REASONS.RPC_ERROR);
  } catch {
    return fail(REASONS.RPC_ERROR);
  }

  return { ok: true, creatorId: hex(schedule[0]), tier: Number(schedule[1]), reason: null };
}
