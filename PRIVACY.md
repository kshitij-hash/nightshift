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
| **Charge (release)** | The vault, the period index, the amount, the nullifier; the open note credited back into the pool | Which subscriber was charged. The commitment appears, but the commitment is a hash — and nothing links it to a wallet |
| **Nullifier** | `poseidon(commitment, period_index)` — spent exactly once | Everything else. Two charges of the same subscription share a commitment in vault events by design in v2 (see Limitations) |
| **Cancel / reclaim** (planned v3) | The reclaim is a public ERC-20 transfer out — an exit edge, public like all pool edges | The subscription history behind it |

## What the subscriber's wallet never signs away

- No session key, no standing allowance, no delegation. The pool has no such
  primitive — that is precisely why the escrow model exists. The subscriber's
  shielded balance can never be pulled from; only the escrow they explicitly
  committed can ever be charged, and only on schedule.
- The 6 STRK protocol fee per pool action is the pool's, not ours, and applies
  to the subscriber's own actions only.

## Limitations, stated plainly

1. **v2 charges share a visible commitment.** The `Released` event carries the
   commitment, so charges of one subscription are linkable *to each other*
   (not to a wallet). The v3 design moves settlement to creator-claimed
   batches, decoupling charge timing from settlement.
2. **Edges are public by design** — this is the pool's own model, inherited
   honestly: escrow entering the vault and any reclaim leaving it are visible
   legs. Privacy lives between the edges.
3. **Calldata is public.** Anything placed in the external invoke's calldata
   (tier, schedule shape) is visible. Amounts and periods are quantized to a
   small ladder precisely so a schedule cannot fingerprint a subscriber.
4. **The demo subscription used the demo wallet as its own creator**, so its
   linkage properties understate the two-party case. The commitment mechanism
   is identical either way.
5. **Timing correlation is real.** An observer correlating pool edges with
   vault events by block proximity can make probabilistic guesses, as with any
   pool interaction. Larger anonymity sets weaken this; we do not claim
   immunity to it.

## Verify any of this

Every claim above is checkable from public data with no key:

```
starkli call <vault> schedule_of <commitment>   # public schedule state
the demo board (site/)                           # built only from public events
```

The board's own footer says it best: no key was used to render this page.
