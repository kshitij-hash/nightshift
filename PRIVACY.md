# What is hidden, what is visible

Privacy claims are worthless without their boundaries. This is the complete
accounting of what each NIGHTSHIFT operation reveals, verified against the
actual events and calldata on Starknet mainnet — the same receipts listed in
`strk20.json`.

## The model in one paragraph

A subscriber commits escrow into the vault through a private pool action. The
on-chain record of that commitment is a single Poseidon hash; the secret behind
it never leaves the subscriber's machine. Each billing period, a charge
consumes a write-once period nullifier `poseidon(commitment, period_index)`.
The chain sees that *some* subscription was charged for *some* period — it
cannot tell which charges belong to the same subscriber, and it cannot connect
any of them to the address that funded the escrow.

## Per-operation disclosure

| Operation | Visible on chain | Hidden |
|---|---|---|
| **Subscribe** | The vault received N STRK from the pool (a pool `Withdrawal` edge); the commitment hash; tier index, period length, period count (calldata of the external invoke is public) | Who the subscriber is. The pool's withdrawal edge severs the link to the depositing wallet: the tokens left *someone's* shielded balance, provably screened, unlinkably |
| **Charge** (v3: permissionless call) | The commitment (in public calldata — see Limitations), the period index, the amount, the nullifier, and the caller (the keeper — deliberately, for the nobody-at-a-keyboard proof) | Which subscriber was charged. The commitment is a hash; nothing links it to a wallet. No tokens move — only internal accounting shifts to the creator's claimable balance |
| **Claim** (v3: creator settlement) | The creator_id, the amount, the open note credited into the pool | When each underlying charge happened is decoupled from settlement: one claim can settle many periods in one private batch |
| **Nullifier** | `poseidon(commitment, period_index)` — spent exactly once | Everything else. Charges of one subscription share a commitment by design (see Limitations) |
| **Cancel / reclaim** | Cancel: the commitment and a signature by a bare pubkey — no wallet named. Reclaim: a public ERC-20 transfer out to the chosen address — an exit edge, public like all pool edges | The subscription history behind it, and who authorized it (the owner key is derived from the subscriber's secret, never an account) |

## What the subscriber's wallet never signs away

- No session key, no standing allowance, no delegation. The pool has no such
  primitive — that is precisely why the escrow model exists. The subscriber's
  shielded balance can never be pulled from; only the escrow they explicitly
  committed can ever be charged, and only on schedule.
- The 6 STRK protocol fee per pool action is the pool's, not ours, and applies
  to the subscriber's own actions only.

## Limitations, stated plainly

1. **Charges of one subscription are linkable to each other — in v3 too.**
   `charge(commitment)` is a plain public call: the commitment sits in its
   calldata and in the `Charged` event, so all periods of a subscription are
   publicly connectable to each other (never to a wallet). This is the price
   of a keeper that needs no proof. What v3 decouples is *settlement*: the
   creator's claim reveals nothing about which charges it covers or when
   they fired.
2. **Creator revenue is public per creator id.** `Charged` amounts,
   `Claimed(creator_id, amount)` events, and the `claimable_of` view make a
   creator's cumulative topline derivable by anyone — and a creator must
   publish their `creator_id` for subscribers to find them. NIGHTSHIFT hides
   the *subscriber*; it does not hide the creator's revenue from competitors.
   Tier quantization coarsens the picture (an observer sees ladder multiples,
   not arbitrary amounts), and a creator may run multiple ids, but we do not
   claim Patreon-style revenue confidentiality.
3. **Edges are public by design** — this is the pool's own model, inherited
   honestly: escrow entering the vault and any reclaim leaving it are visible
   legs. Privacy lives between the edges.
4. **Calldata is public.** Anything placed in the external invoke's calldata
   (tier, schedule shape) is visible. Amounts and periods are quantized to a
   small ladder precisely so a schedule cannot fingerprint a subscriber.
5. **The demo subscription used the demo wallet as its own creator**, so its
   linkage properties understate the two-party case. The commitment mechanism
   is identical either way.
6. **Timing correlation is real.** An observer correlating pool edges with
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
