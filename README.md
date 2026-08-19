# NIGHTSHIFT

Recurring private authorization on the [STRK20 privacy pool](https://strk20.starknet.io)
(Starknet mainnet). Subscribe once from inside the pool; get charged on schedule without your
funds, your identity, or your payment history ever surfacing on a public edge.

The pool can hold funds privately and spend them privately, but it has no notion of time or
recurrence: every payment is a fresh, manual, human-triggered act. NIGHTSHIFT adds the missing
verb. A subscriber commits to a quantized tier once, through a private pool action into the
NIGHTSHIFT vault. After that, charges fire per period against a period nullifier
(`poseidon(commitment, period_index)`) with no wallet open and nobody at a keyboard, and settle
back into the pool as open notes.

## Status

Sprint entry, building in public. `strk20.json` at the repo root carries the mainnet evidence:
transaction hashes, deployed contracts, demo.

## Layout

| Path | What |
|---|---|
| `src/common.cairo` | Tags, `Schedule`/`Tier` types, message-hash builders |
| `src/` (vault, gate — landing next) | The anonymizer vault the pool invokes; the public read gate |
| `scripts/check-manifest.mjs` | CI check that `strk20.json` stays readable by the sprint indexer |

## Development

```
scarb build
snforge test
node scripts/check-manifest.mjs
```

JS dependencies (when they arrive) install with `npm ci --ignore-scripts` — no exceptions.

## License

Apache-2.0.
