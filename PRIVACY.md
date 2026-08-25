# What is hidden, what is visible

Privacy claims are worthless without their boundaries. This is the complete
accounting of what each operation below reveals: the vault's subscribe, charge,
claim, cancel and reclaim, and the gate's present. The vault rows are verified
against the actual events and calldata on Starknet mainnet: the same receipts
listed in `strk20.json`.

## The model in one paragraph

A subscriber commits escrow into the vault through a private pool action. The
on-chain record of that commitment is a single Poseidon hash; the secret behind
it never leaves the subscriber's machine. Each billing period, a charge
consumes a write-once period nullifier `poseidon(commitment, period_index)`.
The chain sees that *some* subscription was charged for *some* period. It
cannot connect any charge to the address that funded the escrow.

## Per-operation disclosure

| Operation | Visible on chain | Hidden |
|---|---|---|
| **Subscribe** | The vault received N STRK from the pool (a pool `Withdrawal` edge); the commitment hash; tier index, period length, period count (calldata of the external invoke is public) | Who the subscriber is. The pool's withdrawal edge severs the link to the depositing wallet: the tokens left *someone's* shielded balance, provably screened, unlinkably |
| **Charge** (v3: permissionless call) | The commitment (in public calldata, see Limitations), the period index, the amount, the nullifier, and the caller (the keeper, deliberately: it proves nobody was at a keyboard) | Which subscriber was charged. The commitment is a hash; nothing links it to a wallet. No tokens move; only internal accounting shifts to the creator's claimable balance |
| **Claim** (v3: creator settlement) | The creator_id, the amount, the open note credited into the pool | When each underlying charge happened is decoupled from settlement: one claim can settle many periods in one private batch |
| **Nullifier** | `poseidon(commitment, period_index)`, spent exactly once | Everything else. Charges of one subscription share a commitment by design (see Limitations) |
| **Cancel / reclaim** | Cancel: the commitment, a signature by a bare pubkey, and whichever account submitted the transaction. Reclaim: a public ERC-20 transfer out to the chosen address, an exit edge, public like all pool edges | The subscription history behind it, and who authorized it (the owner key is derived from the subscriber's secret, never an account). Neither entrypoint reads the sender, so the submitting account can be a relay with no relation to the subscriber |
| **Present** (gate: tier presentation) | The commitment, the verifier id, the expiry block, the nonce, the signature, the returned `creator_id` and `tier`, and whichever account submitted the transaction, all of it repeated in the `Presented` event. Presentations of one subscription are linkable to each other, at one gate and across gates, because every one of them carries the same commitment | The subscriber's wallet: the gate checks the owner key the vault recorded at subscribe, a bare pubkey and never an account. Also the escrow remaining and the period history. A verifier learns the tier a commitment is entitled to and the creator it indexes into, nothing about the payments behind it. One owner key reused across creators would link those commitments to each other, which is why the console derives a fresh key per commitment |

The Present row, a gate operation rather than a vault one, is verified the
same way: tx 0x30191636…, block 13,613,640. Every row above has a mainnet
receipt.

## What the subscriber's wallet never signs away

- No session key, no standing allowance, no delegation. The pool has no such
  feature; that is precisely why the escrow model exists. The subscriber's
  shielded balance can never be pulled from; only the escrow they explicitly
  committed can ever be charged, and only on schedule.
- The 6 STRK protocol fee per pool action is the pool's, not ours, and applies
  to the subscriber's own actions only.

## Limitations

1. **Charges of one subscription are linkable to each other, in v3 too.**
   `charge(commitment)` is a plain public call: the commitment sits in its
   calldata and in the `Charged` event, so all periods of a subscription are
   publicly connectable to each other (never to a wallet). This is the price
   of a keeper that needs no proof. What v3 decouples is *settlement*: the
   creator's claim reveals nothing about which charges it covers or when
   they fired.
2. **Creator revenue is public per creator id.** `Charged` amounts,
   `Claimed(creator_id, amount)` events, and the `claimable_of` view make a
   creator's cumulative topline derivable by anyone, and a creator must
   publish their `creator_id` for subscribers to find them. NIGHTSHIFT hides
   the *subscriber*; it does not hide the creator's revenue from competitors.
   Tier quantization coarsens the picture (an observer sees ladder multiples,
   not arbitrary amounts), and we do not claim Patreon-style revenue
   confidentiality. What a creator can do is break the aggregation: creator_id
   hashes the payout key, so one creator can derive many payout keys and hand
   each cohort of subscribers its own id off-chain. Per-id revenue stays
   public; the creator's total stops being computable by anyone who cannot
   enumerate ids that are never published together.
3. **Edges are public by design.** This is the pool's own model, inherited as
   is: escrow entering the vault and any reclaim leaving it are visible legs.
   Privacy lives between the edges.
4. **Calldata is public.** Anything placed in the external invoke's calldata
   (tier, schedule shape) is visible. Amounts and periods are quantized to a
   small ladder precisely so a schedule cannot fingerprint a subscriber.
5. **The demo subscription used the demo wallet as its own creator**, so its
   linkage properties understate the two-party case. The commitment mechanism
   is identical either way.
6. **Revocation names no wallet in its authorization, and need not name one in
   its submission either.** `cancel` and `reclaim` check only the owner-key
   signature, so any relay can carry a signed cancel (`scripts/relay.mjs`
   submits one from the keeper account). A subscriber who self-submits instead
   writes their own wallet into the transaction as sender: that is the
   trade-off, not a defect in the signature scheme. Two things this does not
   buy. The relay reads the commitment it is handed, so it learns which
   subscription is being cancelled, and the timing correlation in item 7
   applies to a relayed cancel exactly as to any other vault transaction.
7. **Timing correlation is real.** An observer correlating pool edges with
   vault events by block proximity can make probabilistic guesses, as with any
   pool interaction. Larger anonymity sets weaken this; we do not claim
   immunity to it.

## Verify any of this

Every claim above is checkable from public data with no key:

```
starkli call <vault> schedule_of <commitment>   # public schedule state
https://nightshift-six-lilac.vercel.app                                             # built only from public events
```

The board's own footer says it best: no key was used to render this page.
