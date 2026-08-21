# 1. Commitment and period-nullifier scheme for standing authorization

## Status

Accepted. Shipped on Starknet mainnet: v3 introduced the scheme, v4 is
current and adds the domain tag to the period nullifier described below.

## Context

A subscription is the most linkable payment pattern there is: the same
amount, to the same counterparty, at the same interval. The STRK20 privacy
pool can hold funds privately and move them privately, but it has no notion
of time or recurrence: every pool action is a fresh, manual, human-signed
act, with no session keys, no allowances, and no delegated pull. A payer must
be present, every time.

NIGHTSHIFT needs a way to authorize a recurring charge once, at subscribe
time, and have that authorization stand for many future charges fired by
someone other than the subscriber, without asking the pool for a primitive
it does not have and without a key anyone can steal or phish.

## Decision

Build the standing authorization out of hashes and signatures the vault
checks itself, never out of anything pulled from the subscriber's shielded
balance:

- **Commitment.** `commitment = poseidon(secret, creator_id)`, computed
  client-side. The secret never leaves the subscriber's machine. The
  subscribe op's calldata is public and carries the commitment, creator_id,
  tier, period lengths and the owner key; what hides the subscriber's wallet
  is the pool's withdrawal edge, which severs the link between the escrow
  and the wallet that funded it. The commitment is the pseudonym every later
  operation is keyed by, never an address.
- **Period nullifier.** `poseidon('NIGHTSHIFT_PERIOD_NUL', commitment,
  period_index)`, written once per period in `src/vault.cairo`'s `charge`
  (`src/common.cairo` carries the tag; v3 shipped the untagged two-element
  form, and v4 added the tag so the nullifier can never collide with any
  other poseidon use of the same commitment). Combined with the block-height
  due check (`block >= start + period_blocks * index`) and the strictly
  incrementing period pointer, this makes a charge for a given period fire
  at most once, and never before its block arrives, no matter who calls
  `charge` or how many times.
- **Owner key.** A bare STARK public key derived from the subscriber's
  secret, recorded at subscribe and never an account address. `cancel`,
  `reclaim`, and the gate's `present` check a signature against this key
  instead of reading who the subscriber is from the sender. For cancel and
  reclaim, submission is sender-agnostic: `scripts/relay.mjs` or any other
  willing party can carry the signed message; altering it breaks the
  signature, so the worst a relay can do is decline to submit. `present` is
  the exception: the gate asserts the caller IS the named verifier, so a
  presentation binds the verifier's own address and cannot be relayed.
- **Pre-committed escrow, not a pull.** Subscribe moves the full schedule
  price into the vault up front, through the pool's private withdraw. The
  claim that unattended charging is impossible on this pool is true for a
  design that tries to pull from a shielded balance later; NIGHTSHIFT does
  not try that. `charge` only ever spends escrow the subscriber already
  parted with, gated by the nullifier and the due check, so there is nothing
  to steal, revoke, or phish from a keeper that fires it.
- **Accounted custody.** The vault tracks `accounted[token]` and requires
  `balance_of(self) >= accounted + expected` at subscribe, crediting exactly
  `per_period * n_periods` regardless of any surplus sitting in the
  contract. A donation can therefore never inflate an escrow beyond one
  schedule price; what it can do is stand in as the funding for a subscribe,
  in which case the donor has prepaid a stranger's schedule and the vault
  treats it as any other escrow (`tests/test_subscribe.cairo` pins both
  properties: the bound, and the donation-funded subscribe).

## Consequences

**What this buys.** A keeper needs no proof, no pool batch, and no wallet
API to fire a charge; it is a plain public call. Revocation needs no
transaction from the subscriber at all, only a signature. The subscriber's
wallet is never named at subscribe (the pool's withdrawal edge severs that
link), at charge, or at cancel/reclaim when relayed.

**What this costs, stated plainly:**

- Charges of one subscription are publicly linkable to each other. The
  commitment sits in `charge`'s calldata and in the `Charged` event on every
  call, so all periods of a subscription connect to each other, though never
  to a wallet (PRIVACY.md limitation 1). This is the price of a keeper that
  needs no proof.
- Per-creator revenue is public. `Charged` amounts, `Claimed`/`ClaimedPublic`
  events, and `claimable_of` make a creator's cumulative topline derivable
  by anyone who knows the creator_id, which a creator must publish for
  subscribers to find them (PRIVACY.md limitation 2). This is not hidden
  from competitors, and this repo does not claim otherwise.
- `present` is a signature presentation, not a proof. It hands a verifier
  the commitment along with `(creator_id, tier)`, and presentations of one
  subscription are linkable to each other, at one gate and across gates,
  because every one of them carries the same commitment. A subscriber who
  wants presentations to different creators unlinked must derive a separate
  owner key and commitment per creator, which is a client-side choice, not
  something this scheme enforces on its own.

## Alternatives considered

- **Session keys.** Rejected because the pool exposes no such primitive:
  there is nothing to delegate a session key against. Building one here
  would mean simulating a capability the underlying pool does not offer,
  with no way to bind it to the pool's own accounting.
- **A mutable counter instead of a nullifier.** A `next_period` counter
  alone would make "was this period charged" an inference over mutable
  state rather than a fact with its own storage slot. The nullifier makes
  each period's charge write-once whatever happens to the counter, keeps
  the answer readable per period forever (`period_charged`), and leaves the
  counter as an ordering cursor rather than the security boundary.
- **Pull-based charging via a stored allowance.** Nothing can pull from a
  shielded pool balance after the fact, so a pull-based design needs the
  subscriber to leave a standing allowance somewhere public for the vault to
  draw against. That allowance would be exactly the linkable, always-present
  authorization the pool's edge model exists to avoid, recreating the
  fingerprint NIGHTSHIFT is built to remove.
