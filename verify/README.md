# nightshift-verify

Check a NIGHTSHIFT tier presentation entirely off-chain. A Discord bot, a
Telegram gate or a SaaS backend hands the subscriber a challenge, the subscriber
signs it with the subscription's owner key, and this library checks that
signature against the owner key the vault recorded at subscribe time.

There is no transaction. Nothing is sent, nothing is signed by the verifier's
wallet, no gas is spent, and nothing about the presentation is written on-chain.
The only chain traffic is four read-only view calls the verifier makes on its
own behalf, so the chain learns nothing from a presentation.

The checks mirror the on-chain gate (`src/gate.cairo`) and the message layout
mirrors `present_nonce_message` in `src/common.cairo`, so a presentation this
library accepts is one the gate would also accept, and the other way round.

Point `vaultAddress` at a vault that exposes `owner_key_of`. The v3 vault on
mainnet (`0x277519c8bc1031188313de4528d1f0159319f8f86651422e89b6fbd920b3759`)
stores the key but has no view for it, the same constraint `src/gate.cairo`
carries; against that address every check returns `rpc_error` at step 7.

## The trust model

The verifier learns the commitment, which is a subscription pseudonym, plus the
`(creator_id, tier)` behind it, and it never learns a wallet, because the
subscriber authorizes with the subscription's STARK owner key rather than with
an account address. A presentation leaves no on-chain trace at all, so nobody
reading the chain can tell that one happened, who made it or to whom. Replay is
dead: the verifier accepts only the nonce it issued for the request in front
of it, and a captured `(sig_r, sig_s)` reproduces exactly the one
`(commitment, verifier_id, expiry_block, nonce)` tuple it was signed over.
That single-use property is the verifier's to keep: nothing on chain burns an
off-chain nonce, so retire each issued nonce once its request resolves and
never accept one twice.

What this does not hide: the commitment is stable, so
one verifier recognizes a returning subscriber across visits, and two verifiers
comparing notes can tell they saw the same subscription. A client that wants
presentations to different creators unlinked derives one owner key and one
commitment per creator, the way the NIGHTSHIFT app does.

## What gets checked, in order

| # | check | reason on failure |
|---|-------|-------------------|
| 1 | `verifier_id` is this verifier's own id | `verifier_mismatch` |
| 2 | `expiry_block` is at or after the current block | `expired` |
| 3 | `expiry_block` is no more than `maxWindow` blocks ahead | `expiry_too_far` |
| 4 | `nonce` is the one this verifier issued for this request | `nonce_mismatch` |
| 5 | `vault.schedule_of(commitment)`: known and not cancelled | `not_active` |
| 6 | paid through now: period 0 charged and `now < start + period_blocks * next` | `arrears` |
| 7 | `vault.owner_key_of(commitment)` is non-zero | `unknown_commitment` |
| 8 | the signature verifies against that key | `bad_signature` |

Checks 5 and 6 read one `schedule_of` call and mirror the on-chain gate's
entitlement rule exactly. The vault's `is_active` flag is deliberately not
consulted: charging the final period flips it false at the instant the
subscriber becomes fully paid, so a verifier gating on it would deny the last
paid period, and deny every single-period subscription outright.

Pick your `verifier_id` the way the on-chain gate now forces it: there, the id
must equal the calling contract's address, which makes ids collision-free by
construction. An off-chain verifier that never calls the gate may use any
stable felt, but using your own Starknet address keeps one id valid on both
paths and stops two integrators colliding on a name like `'club-door'`.

Three more reasons cover everything else: `malformed_presentation` for input that
is not a readable presentation, `bad_config` for a missing vault address, RPC
target or expected challenge, and `rpc_error` for a node that will not answer.
`verifyPresentation` never throws, so a malformed request cannot take the gate
down; it returns `{ ok: false, reason }` and the caller decides what to do.

Checks 1 to 4 need no chain state, so a presentation captured at another door,
or answering a challenge this verifier is no longer waiting on, is refused
before the node is dialled.

Check 6 is what "paid up" means here. Liveness alone carries no time term, so a
subscription whose keeper stopped charging still reads active; requiring zero
periods due means every period whose block has arrived was already charged. One
consequence: a just-subscribed subscription cannot present until its period 0
is charged.

## Install

```
npm install nightshift-verify
```

Node 18 or newer. The only dependency is `starknet`. In a monorepo checkout of
this repo, `npm install /path/to/nightshift/verify` installs it by path
instead.

## Use it from a Discord bot

Two steps, one per interaction. Issue a challenge, store it against the
interaction, then check what comes back against the stored copy.

```js
import { makeChallenge, verifyPresentation } from "nightshift-verify";

const RPC = process.env.STARKNET_RPC;
const VAULT = process.env.NIGHTSHIFT_VAULT;
const VERIFIER_ID = "DOOR_1"; // this bot's stable id, a short string or a felt
const TIER_ROLE = { 0: "supporter", 1: "insider", 2: "backstage" };

const pending = new Map(); // interaction id -> challenge

// /verify
export async function onVerify(interaction) {
  const challenge = await makeChallenge({ verifierId: VERIFIER_ID, rpcUrl: RPC });
  pending.set(interaction.id, challenge);
  setTimeout(() => pending.delete(interaction.id), 5 * 60 * 1000);
  await interaction.reply({
    ephemeral: true,
    content:
      "Sign this in the NIGHTSHIFT console and paste the presentation back:\n" +
      "```json\n" + JSON.stringify(challenge, null, 2) + "\n```",
  });
}

// the modal or follow-up carrying the signed presentation
export async function onPresentation(interaction, presentation) {
  // The nonce comes from what WE stored, never from the presentation. A
  // verifier that reads the nonce off the thing it is checking has checked
  // nothing.
  const challenge = pending.get(interaction.id);
  if (!challenge) return interaction.reply({ ephemeral: true, content: "challenge expired, run /verify again" });
  pending.delete(interaction.id); // one presentation per challenge

  const { ok, creatorId, tier, reason } = await verifyPresentation({
    presentation,
    expectedVerifierId: VERIFIER_ID,
    expectedNonce: challenge.nonce,
    rpcUrl: RPC,
    vaultAddress: VAULT,
  });

  if (!ok) return interaction.reply({ ephemeral: true, content: `no: ${reason}` });
  if (creatorId !== MY_CREATOR_ID) {
    return interaction.reply({ ephemeral: true, content: "no: another creator's subscription" });
  }
  await interaction.member.roles.add(TIER_ROLE[tier]);
  // creatorId and tier are what the bot gates on. The commitment is a
  // pseudonym: store it if repeat visits should be recognized, and know that
  // storing it is what makes those visits linkable.
}
```

Delete the pending challenge as soon as it is used. The library refuses a stale
nonce, but the record of which nonce is live belongs to the verifier.

## CLI

```
nightshift-verify challenge --verifier DOOR_1 --rpc URL
nightshift-verify verify '<json>' --vault ADDR --rpc URL [--verifier ID] [--nonce FELT]
```

`verify` reads JSON from the first argument or from stdin. The input may be the
presentation itself, or an object with a `presentation` key and a `challenge`
key holding the challenge that was issued. `--verifier` and `--nonce` override
the challenge in the input, and one of the two sources has to supply both.
`--rpc` falls back to `STARKNET_RPC`, `--vault` to `NIGHTSHIFT_VAULT`.

Exit codes: `0` ok, `1` not ok (the reason is on stdout as JSON), `2` usage
error. Output is JSON on both paths, so a bot written in something other than
JavaScript can shell out to it:

```
$ nightshift-verify verify "$(cat presentation.json)" --verifier DOOR_1 --nonce 0xdead...
{
  "ok": true,
  "creatorId": "0xc0ffee",
  "tier": 2,
  "reason": null
}
```

## API

### `makeChallenge({ verifierId, window?, provider?, rpcUrl? })`

Returns `{ verifier_id, nonce, expiry_block }`. The nonce is 31 random bytes
from the runtime's CSPRNG, fresh per request. `window` defaults to 1000 blocks
ahead of the current block and may not exceed 2100, the gate's
`MAX_PRESENT_WINDOW`. Store the result against the pending request.

### `verifyPresentation({ presentation, expectedVerifierId, expectedNonce, provider | rpcUrl, vaultAddress, maxWindow?, currentBlock? })`

Returns `{ ok, creatorId, tier, reason }` and never throws. `presentation` is
`{ commitment, verifier_id, expiry_block, nonce, sig_r, sig_s }`. `maxWindow`
defaults to 2100. Pass `provider` (anything with `getBlockNumber()` and
`callContract({ contractAddress, entrypoint, calldata })`) to reuse a connection
or to test without a network; pass `rpcUrl` to have one built. `currentBlock`
skips the block-height read when the caller already knows the height.

### `signPresentation({ commitment, verifierId, expiryBlock, nonce, ownerPrivKey })`

**Subscriber side only.** This wants the subscription's owner PRIVATE key. A
verifier never holds that key and never asks for it: a verifier calls
`makeChallenge` and `verifyPresentation`, and nothing else. The function is here
so a subscriber-side script or a test can build a presentation without copying
the message layout. It makes no network call. Returns the presentation object
ready to hand back to the verifier.

## When to use the on-chain `present` instead

Use the gate's `present` entrypoint when a public receipt is wanted. That call
writes a `Presented` event and burns a write-once nullifier, so there is a
permanent, citable record that this subscription was presented to this verifier
at this height, and the nullifier makes the tuple unusable a second time at any
verifier rather than only at the one that issued the nonce. The cost is exactly
what this library avoids: a transaction, a fee, and a public trace tying the
commitment to the door.

Off-chain checking is the right default for admission control, where the
verifier only has to decide yes or no right now and nobody needs a citable
record afterwards showing that the decision was made.

## Tests

```
cd verify && node --test
```

The suite makes no network calls. `verifyPresentation` runs against an injected
fake provider that answers each vault view from a table, and the signing tests
generate their keypairs locally.
