// Local key material, and the only module in the app that touches it.
//
// SCOPE, STATED PLAINLY. This is demo-grade custody by declared scope, exactly
// as the ops console declares it (PRIVACY.md limitation 5): a subscriber
// master secret and a creator payout key, held in localStorage on one machine,
// under the SAME key names and the SAME derivation the console uses, so a
// subscription made in one can be cancelled from the other. A production build
// would hold both in the wallet. Nothing here is a claim about key security.
//
// The rule this module exists to enforce: a private key never leaves it. Every
// exported function returns a public key, a commitment, or a signature. No
// export returns a secret, no secret is passed to a component, and nothing
// here writes to the console or the DOM. The callers upstairs cannot leak what
// they are never handed.
//
// The subscriber's owner key is not stored at all. It is derived per
// commitment from the master secret on each use and discarded when the call
// returns.

import { ec } from "starknet";

import {
  cancelMessage,
  claimMessage,
  commitmentOf,
  creatorIdOf,
  ownerPrivFor,
  presentMessage,
  reclaimMessage,
  signWith,
  starkPubOf,
  type Signature,
} from "./core";

/** The console's storage keys, character for character. Changing one of these
 *  strings orphans a live subscription: the secret behind its commitment would
 *  no longer be findable, and only that secret can cancel it. */
const SECRET_KEY = "nightshift.subscriber.secret";
const PAYOUT_KEY = "nightshift.payout.priv";
/** Read, never written. A machine that ran the old console has one stored
 *  owner key that the v3 subscription recorded; only that key can authorize
 *  its cancel or reclaim. This returns null everywhere else. */
const LEGACY_OWNER_KEY = "nightshift.owner.priv";

const randomFelt = () =>
  `0x${[...ec.starkCurve.utils.randomPrivateKey()]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")}`;

/** Whether this machine already holds the two keys, without creating them.
 *  The page says which of the two cases the reader is in before it writes
 *  anything. */
export const storedKeyState = (): { secret: boolean; payout: boolean; legacy: boolean } => ({
  secret: localStorage.getItem(SECRET_KEY) !== null,
  payout: localStorage.getItem(PAYOUT_KEY) !== null,
  legacy: localStorage.getItem(LEGACY_OWNER_KEY) !== null,
});

const stored = (key: string): string => {
  const existing = localStorage.getItem(key);
  if (existing !== null) return existing;
  const fresh = randomFelt();
  localStorage.setItem(key, fresh);
  return fresh;
};

/** Which owner key signs a cancel or a reclaim. The vault stores exactly one
 *  owner key per commitment and schedule_of stops short of returning it, so
 *  this page cannot read which era a subscription belongs to. The caller
 *  picks: derived for anything subscribed after the per-commitment change,
 *  legacy for a subscription that predates it. */
export type OwnerKeyChoice = "derived" | "legacy";

export type OwnerKeyOption = { id: OwnerKeyChoice; label: string; pub: string };

/** The public halves, and nothing else. Every field here is safe to render,
 *  safe to copy, and already public on chain once a subscription exists. */
export type PublicIdentity = {
  creatorId: string;
  commitment: string;
  ownerPub: string;
  payoutPub: string;
  legacyOwnerPub: string | null;
};

/** Derive the whole public identity for one connected account. Creates the
 *  master secret and the payout key on first use, which is why it runs after a
 *  deliberate connect and never on page load. */
export const identityFor = (accountAddress: string, token: string): PublicIdentity => {
  const secret = stored(SECRET_KEY);
  const payoutPub = starkPubOf(stored(PAYOUT_KEY));
  const creatorId = creatorIdOf(accountAddress, token, payoutPub);
  const commitment = commitmentOf(secret, creatorId);
  const ownerPub = starkPubOf(ownerPrivFor(secret, creatorId));
  const legacy = localStorage.getItem(LEGACY_OWNER_KEY);
  return {
    creatorId,
    commitment,
    ownerPub,
    payoutPub,
    legacyOwnerPub: legacy === null ? null : starkPubOf(legacy),
  };
};

/** One creator id and the commitment this browser's secret produces for it.
 *  Both halves are public: the id is on chain already and the commitment is
 *  what a subscription publishes. */
export type DerivedCommitment = { creatorId: string; commitment: string };

/** The public identity of a subscription to ONE creator id: the commitment and
 *  owner pubkey this browser's secret derives for that id. This is what a
 *  subscribe must publish for /manage to find the subscription again -
 *  identityFor's commitment is bound to the wallet's own creator id and is the
 *  wrong one for a subscription to anybody else. Creates the master secret on
 *  first use, so call it only from a flow the reader deliberately started. */
export const subscribeIdentityFor = (
  creatorId: string,
): { commitment: string; ownerPub: string } => {
  const secret = stored(SECRET_KEY);
  return {
    commitment: commitmentOf(secret, creatorId),
    ownerPub: starkPubOf(ownerPrivFor(secret, creatorId)),
  };
};

/**
 * The commitments this machine's stored master secret produces for a list of
 * creator ids, for /manage to ask the vault which of them exist.
 *
 * Read-only in the strict sense: unlike identityFor it does NOT create a secret
 * when none is stored, it returns an empty list instead. A page that lists what
 * a reader owns must not, by listing it, mint the key that owns it.
 *
 * Every value returned is public. The secret is read into a local, hashed, and
 * dropped when this function returns.
 */
export const commitmentsFor = (creatorIds: readonly string[]): DerivedCommitment[] => {
  const secret = localStorage.getItem(SECRET_KEY);
  if (secret === null) return [];
  return creatorIds.map((creatorId) => ({
    creatorId,
    commitment: commitmentOf(secret, creatorId),
  }));
};

/** The owner keys this machine can sign with, best first. */
export const ownerKeyOptions = (accountAddress: string, token: string): OwnerKeyOption[] => {
  const id = identityFor(accountAddress, token);
  const out: OwnerKeyOption[] = [
    { id: "derived", label: "derived per-commitment key", pub: id.ownerPub },
  ];
  if (id.legacyOwnerPub !== null) {
    out.push({
      id: "legacy",
      label: "legacy stored key, for a subscription made before per-commitment keys",
      pub: id.legacyOwnerPub,
    });
  }
  return out;
};

/** Resolve a choice to a key. Private, and the only place a caller's choice
 *  turns into key material. */
const ownerPrivFrom = (accountAddress: string, token: string, choice: OwnerKeyChoice): string => {
  if (choice === "legacy") {
    const legacy = localStorage.getItem(LEGACY_OWNER_KEY);
    if (legacy === null) throw new Error("this machine holds no legacy owner key");
    return legacy;
  }
  const secret = stored(SECRET_KEY);
  const payoutPub = starkPubOf(stored(PAYOUT_KEY));
  return ownerPrivFor(secret, creatorIdOf(accountAddress, token, payoutPub));
};

export type SignedCancel = { commitment: string; sig: Signature };

/** The stored secret, or a named refusal. Private: every caller below turns
 *  this into a signature and drops it. */
const requireSecret = (): string => {
  const secret = localStorage.getItem(SECRET_KEY);
  if (secret === null) {
    throw new Error("this browser holds no subscriber secret, so it cannot sign for any subscription");
  }
  return secret;
};

/** Cancel, signed for a subscription to ONE creator id: the commitment and
 *  owner key are derived for that id, which is the only key the vault will
 *  accept for it. This is the right signer for anything /manage lists. */
export const signCancelFor = (creatorId: string): SignedCancel => {
  const secret = requireSecret();
  const commitment = commitmentOf(secret, creatorId);
  return {
    commitment,
    sig: signWith(cancelMessage(commitment), ownerPrivFor(secret, creatorId)),
  };
};

/** Reclaim, signed for a subscription to ONE creator id, destination bound
 *  inside the message. */
export const signReclaimFor = (creatorId: string, to: string): SignedCancel => {
  const secret = requireSecret();
  const commitment = commitmentOf(secret, creatorId);
  return {
    commitment,
    sig: signWith(reclaimMessage(commitment, to), ownerPrivFor(secret, creatorId)),
  };
};

export const signCancel = (
  accountAddress: string,
  token: string,
  choice: OwnerKeyChoice = "derived",
): SignedCancel => {
  const { commitment } = identityFor(accountAddress, token);
  return {
    commitment,
    sig: signWith(cancelMessage(commitment), ownerPrivFrom(accountAddress, token, choice)),
  };
};

export const signReclaim = (
  accountAddress: string,
  token: string,
  to: string,
  choice: OwnerKeyChoice = "derived",
): SignedCancel => {
  const { commitment } = identityFor(accountAddress, token);
  return {
    commitment,
    sig: signWith(
      reclaimMessage(commitment, to),
      ownerPrivFrom(accountAddress, token, choice),
    ),
  };
};

/** The creator side. Signed with the payout key the creator registered, over
 *  the note id the wallet resolved and the exact amount. */
export const signClaim = (
  accountAddress: string,
  token: string,
  noteId: string,
  amountWei: bigint,
): Signature => {
  const payoutPriv = stored(PAYOUT_KEY);
  const payoutPub = starkPubOf(payoutPriv);
  const creatorId = creatorIdOf(accountAddress, token, payoutPub);
  return signWith(claimMessage(creatorId, noteId, amountWei), payoutPriv);
};

/** A tier presentation for a subscription to ONE creator id, signed off
 *  chain with the owner key this browser's secret derives for that id. This
 *  is the right signer for any subscription /manage lists: the commitment on
 *  the card is commitmentOf(secret, creatorId), and only the key derived for
 *  the same id can answer for it. */
export const signPresentationFor = (
  creatorId: string,
  challenge: { verifierId: string; expiryBlock: string; nonce: string },
): { commitment: string; sig: Signature } => {
  const secret = localStorage.getItem(SECRET_KEY);
  if (secret === null) {
    throw new Error(
      "this browser holds no subscriber secret, so it cannot sign for any subscription",
    );
  }
  const commitment = commitmentOf(secret, creatorId);
  return {
    commitment,
    sig: signWith(
      presentMessage(commitment, challenge.verifierId, challenge.expiryBlock, challenge.nonce),
      ownerPrivFor(secret, creatorId),
    ),
  };
};

/** A tier presentation, signed off chain. Included because the owner key lives
 *  here and nowhere else; the /verify surface checks what this produces. */
export const signPresentation = (
  accountAddress: string,
  token: string,
  challenge: { verifierId: string; expiryBlock: string; nonce: string },
): { commitment: string; sig: Signature } => {
  const { commitment } = identityFor(accountAddress, token);
  return {
    commitment,
    sig: signWith(
      presentMessage(commitment, challenge.verifierId, challenge.expiryBlock, challenge.nonce),
      ownerPrivFrom(accountAddress, token, "derived"),
    ),
  };
};
