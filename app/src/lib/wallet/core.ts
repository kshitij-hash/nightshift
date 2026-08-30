// The wallet flows' arithmetic, ported from the ops console (web/app.mjs) and
// kept pure.
//
// Everything in this file is a function of its arguments. No DOM, no
// localStorage, no network, and one import: starknet, for poseidon, the STARK
// curve and short-string encoding. That is deliberate and load-bearing twice
// over.
//
//   1. Node can load this module directly, with no bundler, which is how
//      test/wallet-parity.test.mjs checks every hash and every calldata array
//      here against what the console itself prints for the same inputs. If the
//      two ever drift, that test fails instead of a mainnet transaction.
//   2. A pure module has nowhere to leak to. Private keys are arguments and
//      return values here, never module state, and the callers that hold them
//      (lib/wallet/keys.ts) hand back public halves and signatures only.
//
// The formulas mirror src/common.cairo, which is what the deployed vault and
// gate actually check. A change here that is not also a change there produces
// NS_BAD_SIGNATURE on chain, which is the safe direction to fail.

import { ec, hash, shortString } from "starknet";

/** 10^18, STRK's decimals. */
export const E18 = 10n ** 18n;

/** The STARK field prime. A felt is anything below it. */
export const STARK_PRIME = 2n ** 251n + 17n * 2n ** 192n + 1n;

/** The pool's protocol fee per private action, in whole STRK. It is charged by
 *  the pool, not by this project, and it comes out of the submitter's PUBLIC
 *  balance. Every surface that builds a pool action states it before the
 *  action is built. */
export const POOL_FEE_STRK = 6n;

/** The vault's period ladder (src/common.cairo, is_ladder_period). A schedule
 *  off this ladder reverts with NS_PERIOD_OFF_LADDER, so the form offers these
 *  three and nothing else. Quantized on purpose: an arbitrary period length
 *  would fingerprint a subscription. */
export const CADENCES = [
  { blocks: 2100, label: "hourly", note: "2100 blocks, about 59 minutes" },
  { blocks: 50_400, label: "daily", note: "50400 blocks, about 23 hours 48 minutes" },
  { blocks: 352_800, label: "weekly", note: "352800 blocks, about 6 days 22 hours" },
] as const;

export type CadenceBlocks = (typeof CADENCES)[number]["blocks"];

/** Wallet API addresses are PADDED_FELT: 0x plus exactly 64 hex digits. The
 *  wallet standard hands back an unpadded account.address, which fails the
 *  schema, so every address that goes into a pool action goes through here. */
export const pad = (a: string): string => `0x${BigInt(a).toString(16).padStart(64, "0")}`;

/** Calldata felts forbid leading zeros, unlike the padded ADDRESS fields.
 *  Wallet placeholders (`${openNoteIds[0]}`) pass through untouched: the wallet
 *  resolves them itself and a felt conversion would destroy them. */
export const cd = (x: string): string =>
  x.startsWith("${") ? x : `0x${BigInt(x).toString(16)}`;

/** A domain-separation tag as the Cairo side writes it: a short string literal
 *  in the poseidon span. */
export const tag = (s: string): string => shortString.encodeShortString(s);

/** Fixed 8/6 truncation, the one this product uses everywhere. */
export const truncate = (hex: string, lead = 8, tail = 6): string => {
  const body = hex.startsWith("0x") ? hex.slice(2) : hex;
  const padded = body.padStart(64, "0");
  return `0x${padded.slice(0, lead)}…${padded.slice(-tail)}`;
};

/** Whole STRK from wei, at a fixed number of decimals, without floats. */
export const fmtStrk = (wei: bigint, decimals = 2): string => {
  const whole = wei / E18;
  const frac = (wei % E18) / 10n ** BigInt(18 - decimals);
  return `${whole}.${frac.toString().padStart(decimals, "0")}`;
};

// --- identity -------------------------------------------------------------

/** v4 creator identity: creator_id = poseidon(caller, token, payout_key). The
 *  vault computes the same hash inside register_creator with the connected
 *  wallet as caller, so this is a prediction of an on-chain value, not a name
 *  this page picks. */
export const creatorIdOf = (
  accountAddress: string,
  token: string,
  payoutPub: string,
): string => hash.computePoseidonHashOnElements([accountAddress, token, payoutPub]);

/** commitment = poseidon(subscriber secret, creator_id). The only thing about
 *  the subscription that reaches the chain. */
export const commitmentOf = (secret: string, creatorId: string): string =>
  hash.computePoseidonHashOnElements([secret, creatorId]);

const CURVE_N = ec.starkCurve.CURVE.n;

/**
 * The per-commitment owner key, derived and never stored.
 *
 *   k = poseidon(secret, creator_id, 'NIGHTSHIFT_OWNER') mod n
 *   k == 0 becomes 1
 *
 * n is the STARK curve order. Poseidon's range is [0, P) with P the STARK
 * prime, and P - n is about 2^96, so the reduction biases the result by about
 * 2^-155: no rejection sampling needed. Deterministic, so nothing has to be
 * backed up beyond the master secret.
 *
 * One key per subscription rather than one per subscriber, because the gate
 * publishes owner keys: a single key reused across creators would be a join
 * column linking one subscriber's commitments to each other for anyone reading
 * the chain.
 *
 * The return value is a private key. It is an argument to a signature and
 * nothing else; it never reaches a log, the DOM, or React state.
 */
export const ownerPrivFor = (secret: string, creatorId: string): string => {
  const h = BigInt(
    hash.computePoseidonHashOnElements([secret, creatorId, tag("NIGHTSHIFT_OWNER")]),
  );
  let k = h % CURVE_N;
  if (k === 0n) k = 1n;
  if (!ec.starkCurve.utils.isValidPrivateKey(k)) {
    throw new Error("derived owner key out of range");
  }
  return `0x${k.toString(16).padStart(64, "0")}`;
};

/** The public half of a STARK private key. Safe to show, safe to log. */
export const starkPubOf = (priv: string): string => ec.starkCurve.getStarkKey(priv);

// --- domain-separated messages (mirror src/common.cairo) -------------------

export type Signature = { r: string; s: string };

export const cancelMessage = (commitment: string): string =>
  hash.computePoseidonHashOnElements([tag("NIGHTSHIFT_CANCEL"), commitment]);

export const reclaimMessage = (commitment: string, to: string): string =>
  hash.computePoseidonHashOnElements([tag("NIGHTSHIFT_RECLAIM"), commitment, to]);

export const claimMessage = (
  creatorId: string,
  noteId: string,
  amountWei: bigint,
): string =>
  hash.computePoseidonHashOnElements([
    tag("NIGHTSHIFT_CLAIM"),
    creatorId,
    noteId,
    `0x${amountWei.toString(16)}`,
  ]);

/** present_nonce_message from src/common.cairo. The app's read-only /verify
 *  surface checks this same layout; this copy is the signing side. */
export const presentMessage = (
  commitment: string,
  verifierId: string,
  expiryBlock: string,
  nonce: string,
): string =>
  hash.computePoseidonHashOnElements([
    tag("NIGHTSHIFT_PRESENT"),
    cd(commitment),
    cd(verifierId),
    cd(expiryBlock),
    cd(nonce),
  ]);

/** Sign a felt message. Deterministic (RFC 6979), so the same message and key
 *  always give the same pair, which is what makes the parity test possible. */
export const signWith = (message: string, priv: string): Signature => {
  const sig = ec.starkCurve.sign(message, priv);
  return { r: `0x${sig.r.toString(16)}`, s: `0x${sig.s.toString(16)}` };
};

// --- pool action builders --------------------------------------------------

/** One STRK20 action, in the shape the wallet API takes. Typed loosely on
 *  purpose: the wallet's own schema is the authority and a narrower local type
 *  would only invent a second one to drift from. */
export type PoolAction = Record<string, unknown>;

/** VaultOp serde, variant 0: [0, commitment, creator_id, tier u8,
 *  period_blocks u64, n_periods u32, owner_key]. owner_key is a STARK public
 *  key, never an address: an address here would make revocation name a wallet.
 *
 *  The batch is two actions, atomic. The withdraw moves the escrow out of the
 *  subscriber's shielded balance into the vault, which is the pool edge that
 *  severs the link to the funding wallet. The invoke records the schedule. */
export const subscribeActions = (p: {
  vault: string;
  token: string;
  commitment: string;
  creatorId: string;
  tier: number;
  periodBlocks: number;
  nPeriods: number;
  ownerPub: string;
  escrowWei: bigint;
}): PoolAction[] => [
  {
    type: "withdraw",
    token: p.token,
    amount: `0x${p.escrowWei.toString(16)}`,
    recipient: p.vault,
  },
  {
    type: "invoke",
    contract: p.vault,
    calldata: [
      cd("0x0"),
      cd(p.commitment),
      cd(p.creatorId),
      cd(`0x${p.tier.toString(16)}`),
      cd(`0x${p.periodBlocks.toString(16)}`),
      cd(`0x${p.nPeriods.toString(16)}`),
      cd(p.ownerPub),
    ],
  },
];

/** The placeholder the wallet resolves to the id of the open note it creates.
 *  The literal id cannot be sent back in its place: the wallet's schema
 *  rejects a batch whose open note is not referenced by a placeholder. */
export const OPEN_NOTE_PLACEHOLDER = "${openNoteIds[0]}";

/**
 * Claim, variant 1: [1, creator_id, note_id, amount, sig_r, sig_s].
 *
 * Three actions. The small self-withdraw makes this a spending batch, so the
 * wallet sources the pool's protocol fee. The OPEN transfer to self is the
 * note the payout lands in. The invoke settles the creator's claimable balance
 * into it.
 *
 * With `sig` null the signature felts are 1, which the vault would reject:
 * that form is only ever handed to strk20PrepareInvoke, which builds and
 * proves without executing.
 */
export const claimActions = (p: {
  vault: string;
  token: string;
  accountAddress: string;
  creatorId: string;
  amountWei: bigint;
  noteId: string;
  sig: Signature | null;
}): PoolAction[] => [
  {
    type: "withdraw",
    token: p.token,
    amount: `0x${(E18 / 10n).toString(16)}`,
    recipient: pad(p.accountAddress),
  },
  { type: "transfer", token: p.token, amount: "OPEN", recipient: pad(p.accountAddress) },
  {
    type: "invoke",
    contract: p.vault,
    calldata: [
      cd("0x1"),
      cd(p.creatorId),
      cd(p.noteId),
      cd(`0x${p.amountWei.toString(16)}`),
      cd(p.sig?.r ?? "0x1"),
      cd(p.sig?.s ?? "0x1"),
    ],
  },
];

/**
 * Read the open-note id back out of a prepared batch.
 *
 * The open-note id is computed by the WALLET and cannot be derived by a dapp,
 * while the creator's signature has to bind that exact id. So prepare runs
 * first with the placeholder and a zero signature, and the resolved id is
 * recovered from the pool call the wallet built: the invoke tail
 * [creator_id, NOTE_ID, amount, 1, 1] is unmistakable inside it, and the felt
 * between creator_id and amount is the id.
 *
 * Returns null when the pattern is absent, so the caller can print the
 * calldata and let a human read the id rather than guess one.
 */
export const resolveNoteId = (
  calldata: readonly string[],
  creatorId: string,
  amountWei: bigint,
): string | null => {
  const felts = calldata.map((x) => BigInt(x));
  const cid = BigInt(creatorId);
  for (let j = 0; j + 4 < felts.length; j += 1) {
    if (
      felts[j] === cid &&
      felts[j + 2] === amountWei &&
      felts[j + 3] === 1n &&
      felts[j + 4] === 1n
    ) {
      return `0x${felts[j + 1].toString(16)}`;
    }
  }
  return null;
};

// --- plain public calls ----------------------------------------------------

export type PublicCall = {
  contractAddress: string;
  entrypoint: string;
  calldata: string[];
};

/** cancel(commitment, sig_r, sig_s). The vault checks the owner-key signature
 *  and never reads the sender, which is why this call can be relayed. */
export const cancelCall = (
  vault: string,
  commitment: string,
  sig: Signature,
): PublicCall => ({
  contractAddress: vault,
  entrypoint: "cancel",
  calldata: [commitment, sig.r, sig.s],
});

/** reclaim(commitment, to, sig_r, sig_s). The destination sits inside the
 *  signed message, so a relay that edits it breaks the signature. */
export const reclaimCall = (
  vault: string,
  commitment: string,
  to: string,
  sig: Signature,
): PublicCall => ({
  contractAddress: vault,
  entrypoint: "reclaim",
  calldata: [commitment, to, sig.r, sig.s],
});

/** register_creator(token, payout_key, tier_amounts). A plain public call:
 *  the creator side of the ladder, with the payout key that will later sign
 *  claims. The span serializes as its length followed by each u128 amount;
 *  the vault accepts 1 to 8 tiers and refuses a zero amount anywhere. */
export const registerCreatorCall = (
  vault: string,
  token: string,
  payoutPub: string,
  tiersWei: readonly bigint[],
): PublicCall => ({
  contractAddress: vault,
  entrypoint: "register_creator",
  calldata: [
    token,
    payoutPub,
    `0x${tiersWei.length.toString(16)}`,
    ...tiersWei.map((wei) => cd(`0x${wei.toString(16)}`)),
  ],
});

/** The exact scripts/relay.mjs invocation, positional arguments in the order
 *  RUNBOOK.md documents. Copying this line costs the subscriber nothing and
 *  puts the relay's account in the sender field instead of theirs. */
export const relayCommand = (
  verb: "cancel" | "reclaim",
  args: { commitment: string; to?: string; sig: Signature },
): string =>
  verb === "cancel"
    ? `node scripts/relay.mjs cancel ${args.commitment} ${args.sig.r} ${args.sig.s}`
    : `node scripts/relay.mjs reclaim ${args.commitment} ${args.to} ${args.sig.r} ${args.sig.s}`;

// --- form validation -------------------------------------------------------

const FELT_HEX = /^0x[0-9a-fA-F]{1,64}$/;

/** A felt as a person types it: 0x-hex, at most 64 digits, under the prime.
 *  Returns the reason it was refused rather than a boolean, because the form
 *  prints the reason. */
export const feltError = (raw: string, label: string): string | null => {
  const t = raw.trim();
  if (t === "") return `${label} is empty`;
  if (!FELT_HEX.test(t)) return `${label} must be 0x-hex, at most 64 digits`;
  if (BigInt(t) === 0n) return `${label} must not be zero`;
  if (BigInt(t) >= STARK_PRIME) return `${label} is above the STARK field prime`;
  return null;
};

export const isLadderCadence = (blocks: number): boolean =>
  CADENCES.some((c) => c.blocks === blocks);

/** Periods, as a count the vault stores in a u32. One is the floor: a
 *  zero-period schedule reverts with NS_ZERO_PERIODS. */
export const periodsError = (raw: string): string | null => {
  const t = raw.trim();
  if (!/^[0-9]{1,10}$/.test(t)) return "periods must be a whole number";
  const n = Number(t);
  if (n < 1) return "periods must be at least 1";
  if (n > 4_294_967_295) return "periods must fit a u32";
  return null;
};

/** STRK, two decimal places, parsed without floats. Matches the console's
 *  amount arithmetic for any input it accepts. */
export const strkToWei = (raw: string): bigint | null => {
  const t = raw.trim();
  if (!/^[0-9]+(\.[0-9]{1,2})?$/.test(t)) return null;
  const [whole, frac = ""] = t.split(".");
  return BigInt(whole) * E18 + BigInt(frac.padEnd(2, "0")) * (E18 / 100n);
};

// --- wallet API version compare -------------------------------------------

/**
 * Compare two wallet API versions. The wallet answers wallet_supportedWalletApi
 * with strings like "0.10.4" or "0.10", so a plain string compare is wrong
 * ("0.9" would sort above "0.10") and a missing patch segment counts as zero.
 *
 * Returns a negative number when a is older, 0 when equal, positive when newer.
 */
export const compareApiVersions = (a: string, b: string): number => {
  const parts = (v: string) => {
    const out = v.split(".").map((n) => Number.parseInt(n, 10));
    while (out.length < 3) out.push(0);
    return out;
  };
  const [a0, a1, a2] = parts(a);
  const [b0, b1, b2] = parts(b);
  return a0 - b0 || a1 - b1 || a2 - b2;
};

/** wallet_strk20PrepareInvoke and wallet_strk20InvokeTransaction first appear
 *  in wallet API 0.10.3. A wallet below that can read and can send a plain
 *  invoke, but cannot build a pool action, which is the whole subscribe path. */
export const MIN_POOL_API = "0.10.3";

export const supportsPoolActions = (versions: readonly string[]): boolean =>
  versions.some((v) => compareApiVersions(v, MIN_POOL_API) >= 0);
