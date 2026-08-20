# NIGHTSHIFT

**Private standing authorization on Starknet.** A subscriber commits escrow
once, through the [STRK20 privacy pool](https://strk20.starknet.io); after
that, charges fire on schedule against a write-once period nullifier. The
subscriber's wallet is never named, never asked again, and can never be
charged early, twice, or beyond what it escrowed.

Live on mainnet. Every claim below has a transaction hash.

| | |
|---|---|
| Demo board | https://nightshift-six-lilac.vercel.app — reads mainnet with no key |
| Vault v3 (mainnet) | [`0x277519c8bc…20b3759`](https://voyager.online/contract/0x277519c8bc1031188313de4528d1f0159319f8f86651422e89b6fbd920b3759) |
| v3 lifecycle receipts | [subscribe](https://voyager.online/tx/0x2ff717d6f38dd438b9161b4b253715daa3dffaf8107699cd99914f707c747e1) (subscriber, private escrow) · [charge](https://voyager.online/tx/0x35fa2c66507fb3959bd806cd41e457c4140d8b4b22bfabd978e3e8e1cad681e) (keeper on cron) · [claim](https://voyager.online/tx/0xce143894bc2b9f6b0091e1ce214fe531003be6ad84cc892cb71fae17ba51a4) (creator-signed, submitted by a relayer) — three legs, three different senders |
| v2 receipts | [subscribe](https://voyager.online/tx/0x03d637dfbcd61ab27c02f4c94f83a3eab1e57f58b1d88dc8882d5095684a47de) · [charge 0](https://voyager.online/tx/0x368e6fe18d704765e505526a616cef68d325d7deb3b138ca08363f0010fd4b4) · [charge 1](https://voyager.online/tx/0x0086edb814112bab5042c22ba6a4711eef502fe102b5179978e9cc81833d21a6) · [charge 2](https://voyager.online/tx/0x031fb82151e3204c2cb3c310a57b6d466fc8d69eb75af600a3d0bf2d26a580f6) |
| What is hidden vs visible | [PRIVACY.md](PRIVACY.md) |
| Deployments | [DEPLOYMENTS.md](DEPLOYMENTS.md) |

## The problem

A subscription is the most linkable payment pattern there is: the same amount,
to the same counterparty, at the same interval. On a public ledger that is a
fingerprint. The STRK20 pool can hold funds privately and move them privately —
but it has no notion of time or recurrence. Every payment is a fresh, manual,
human-signed act. The pool has no session keys, no allowances, no delegated
pull; a payer must be present, every time.

NIGHTSHIFT adds the missing verb without asking the pool for a primitive it
does not have.

## The mechanism

```
subscribe (once, private)          charge (per period, by anyone)
──────────────────────────         ─────────────────────────────────
pool withdraws escrow to vault     nullifier = poseidon(commitment, period)
vault records:                     vault asserts:
  commitment = H(secret, creator)    · schedule exists, escrow remains
  tier · period_blocks · periods     · block ≥ start + period · length   (never early)
returns empty span                   · nullifier unspent, then writes it (never twice)
                                     · escrow -= amount                  (never beyond)
                                   charge credits the creator's claimable
                                   balance; no tokens move. Settlement is the
                                   separate creator-signed Claim
```

The standing authorization is not a key held by anyone — it is the escrow the
subscriber already parted with, plus cryptographic gates on when and how often
it can move. There is nothing to steal, revoke, or phish: a keeper who fires a
charge can only make the vault do exactly what the subscriber committed to.

Some designs conclude that unattended charging through this pool is impossible
because nothing can pull from a shielded balance. That is true, and NIGHTSHIFT
does not try: nothing here ever pulls from the subscriber. The charge spends
pre-committed escrow, and the period nullifier — not a mutable counter —
decides whether the charge is valid. The privacy question and the authorization
question are answered by the same hash.

## Cancelling is submitter-agnostic

Cancellation is authorized by a STARK signature from the subscription's owner
key over `cancel_message(commitment)`, and the vault checks that signature
without ever reading the sender. So a cancel costs the subscriber no gas and
no sender identity: they sign, and any willing party submits. For revocation
only, that covers the paymaster role in the RFP with strictly less trust than a
paymaster, because the relay holds nothing and can change nothing. Subscribing
is not covered: it still costs the subscriber the pool's 6 STRK protocol fee
and the gas for their own transaction. Alter the commitment or the
reclaim destination and the signature check fails; the worst a relay can do is
decline to submit. `scripts/relay.mjs` is one such submitter, running from the
keeper account, and the ops console prints the exact line to hand it.

## What the chain learns

A charge names the vault, an amount, a period index, and a nullifier. It does
not name the subscriber. The escrow arrived through a pool withdrawal, which
severs the link to the wallet that funded it. Boundaries and caveats are
documented per-operation in [PRIVACY.md](PRIVACY.md) — including the ones that
are not flattering.

## Repository

| Path | What |
|---|---|
| `src/vault.cairo` | The anonymizer vault: `privacy_invoke` (Subscribe/Claim ops) plus the `charge`, `cancel` and `reclaim` entrypoints, accounted custody, period nullifiers, `schedule_of` / `tier_of` read views |
| `src/mocks.cairo` | `MockPrivacyPool` — an snforge double that replays the deployed pool's invoke sequence with its real revert strings. No other public test harness for this pool exists |
| `tests/` | The adversarial suite: hostile donations, non-pool callers, early charges, double charges, escrow exhaustion |
| `site/` | The demo board: keyless, static, reads mainnet over JSON-RPC, committed-snapshot fallback it labels honestly |
| `web/` | Ops console used to drive the wallet-route pool actions (dry-run first) |
| `preflight/` | `strk20-preflight`: reads a `strk20.json` the way the sprint indexer reads it and prints where the indexer would silently drop something |
| `strk20.json` | The sprint manifest: the vault and the transactions routed through it |

## Build and test

```
scarb build          # scarb 2.17.0
snforge test         # 47 adversarial + lifecycle cases across the vault and the gate
node scripts/check-manifest.mjs
```

JS installs use `npm ci --ignore-scripts`, exact pins only.

## Design notes

- **Quantized ladders.** Amounts and period lengths come from a small fixed
  set, so a schedule cannot fingerprint its subscriber.
- **Accounted custody.** `received = balance_of(self) − accounted[token]`,
  asserted equal to the schedule's exact price — a stray donation cannot mint
  a subscription (tested).
- **Approve for claims, transfer for reclaim.** A claim approves the pool for
  the exact amount and the pool pulls. A reclaim transfers directly instead,
  because a second reclaim to the same address must not clobber a standing
  allowance left by the first.
- **Block-time calibration.** Periods are denominated in blocks; mainnet runs
  ~1.7s blocks, so "a day" is ~50,400 blocks, not 2,880. The v2 demo
  subscription ran its periods fast and is the completed lifecycle: the v2
  receipts above run escrow to exactly zero. The v3 run is still completing.

The signature-binding hazard class in pool helpers was first shown by the
Envelope team's finding against the reference escrow helper; v3 shipped the fix
for the same reason, binding payouts to a creator-signed claim.

### Scope against the RFP

Session keys are not implemented, and not as an omission: the pool has no such
primitive, so the standing authorization is escrow the subscriber already
parted with plus the period nullifier that decides when it may move (see [the
mechanism](#the-mechanism)). Creator revenue confidentiality is refused rather
than claimed: a creator's cumulative topline is derivable from public events,
written out as limitation 2 in [PRIVACY.md](PRIVACY.md). A creator analytics
dashboard is out of scope for this sprint. The tier gate is a signature
presentation, not a proof: it hands a verifier `(creator_id, tier)` and the
commitment, and presentations of one subscription are linkable to each other
across gates.

## License

Apache-2.0.
