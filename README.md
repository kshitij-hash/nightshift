# NIGHTSHIFT

**Private standing authorization on Starknet.** A subscriber commits escrow
once, through the [STRK20 privacy pool](https://strk20.starknet.io); after
that, charges fire on schedule against a write-once period nullifier. The
subscriber's wallet is never named, never asked again, and can never be
charged early, twice, or beyond what it escrowed.

Live on mainnet. Every claim below has a transaction hash.

| | |
|---|---|
| Demo board | hosting in progress — runs locally via `node scripts/serve.mjs` + `site/`; reads mainnet with no key |
| Vault (mainnet) | [`0x01f653f21e…8715f338`](https://voyager.online/contract/0x01f653f21e557e70384c8631f9c8f97e0342aa1d5e975bdcaca76bbf8715f338) |
| Full lifecycle receipts | [subscribe](https://voyager.online/tx/0x03d637dfbcd61ab27c02f4c94f83a3eab1e57f58b1d88dc8882d5095684a47de) · [charge 0](https://voyager.online/tx/0x368e6fe18d704765e505526a616cef68d325d7deb3b138ca08363f0010fd4b4) · [charge 1](https://voyager.online/tx/0x0086edb814112bab5042c22ba6a4711eef502fe102b5179978e9cc81833d21a6) · [charge 2](https://voyager.online/tx/0x031fb82151e3204c2cb3c310a57b6d466fc8d69eb75af600a3d0bf2d26a580f6) |
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
                                   pool credits the charge as an open note
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

## What the chain learns

A charge names the vault, an amount, a period index, and a nullifier. It does
not name the subscriber. The escrow arrived through a pool withdrawal, which
severs the link to the wallet that funded it. Boundaries and caveats are
documented per-operation in [PRIVACY.md](PRIVACY.md) — including the ones that
are not flattering.

## Repository

| Path | What |
|---|---|
| `src/vault.cairo` | The anonymizer vault: `privacy_invoke` (Subscribe/Release ops), accounted custody, period nullifiers, `schedule_of` / `tier_of` read views |
| `src/mocks.cairo` | `MockPrivacyPool` — an snforge double that replays the deployed pool's invoke sequence with its real revert strings. No other public test harness for this pool exists |
| `tests/` | The adversarial suite: hostile donations, non-pool callers, early charges, double charges, escrow exhaustion |
| `site/` | The demo board: keyless, static, reads mainnet over JSON-RPC, committed-snapshot fallback it labels honestly |
| `web/` | Ops console used to drive the wallet-route pool actions (dry-run first) |
| `strk20.json` | The sprint manifest: the vault and the transactions routed through it |

## Build and test

```
scarb build          # scarb 2.17.0
snforge test         # 12 adversarial + lifecycle cases
node scripts/check-manifest.mjs
```

JS installs use `npm ci --ignore-scripts`, exact pins only.

## Design notes

- **Quantized ladders.** Amounts and period lengths come from a small fixed
  set, so a schedule cannot fingerprint its subscriber.
- **Accounted custody.** `received = balance_of(self) − accounted[token]`,
  asserted equal to the schedule's exact price — a stray donation cannot mint
  a subscription (tested).
- **Approve, never transfer.** The vault approves the pool for the exact
  charge; the pool pulls. The vault never moves tokens outward itself.
- **Block-time calibration.** Periods are denominated in blocks; mainnet runs
  ~1.7s blocks, so "a day" is ~50,400 blocks, not 2,880. The demo subscription
  ran its three periods fast — the receipts above are the complete lifecycle,
  escrow consumed exactly to zero.

The signature-binding hazard class in pool helpers was first shown by the
Envelope team's finding against the reference escrow helper; NIGHTSHIFT's next
contract revision binds payouts to a creator-signed claim for the same reason.

## License

Apache-2.0.
