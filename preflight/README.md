# strk20-preflight

Reads your `strk20.json` the way the STRK20 sprint judges' indexer reads it, and tells you
where the indexer would quietly drop something.

Every failure mode this tool covers is silent. The file stays valid-looking, nothing errors,
CI is green, and the entry scores less than it should, or nothing at all. The point is to see
that before the deadline rather than after.

```
node preflight/bin/strk20-preflight.mjs
```

The package is not published to npm, so run it from a checkout by path.

## What it checks

**Offline, always:**

1. **The file parses.** A `strk20.json` that is not valid JSON is ignored wholesale. Not the
   transactions, not the contracts, not the demo URL: the whole entry reads as empty. One
   trailing comma costs every scoring gate at once.
2. **`transactions` is a flat array of bare strings** matching `/^0x[0-9a-fA-F]{1,64}$/`.
   Objects like `{ "hash": "0x…" }`, numbers, and nested arrays are dropped without a word.
   Only the **first 10** entries are read, so the tool warns when the list is longer and
   prints exactly which hashes are being ignored. Order best first.
3. **`contracts` entries are strings or `{ address }` objects.** An entry carrying neither is
   dropped.
4. **`demo_video` and `demo_url` are strings.** An empty `demo_video` is called out with the
   consequence attached: the entry cannot reach finished status without one.
5. **The mine-rule warning.** If `contracts` is non-empty, the tool prints what that costs
   (below).

**Against an RPC node**, when a URL is available and `--offline` is not set:

6. Each of the first 10 hashes is fetched (receipt plus transaction). A hash passes when
   `execution_status` is `SUCCEEDED` and, if any contracts are declared, when the transaction
   also routes through one of them: an event emitted by a declared contract, or a declared
   address appearing as a felt in the calldata. Addresses are compared as `BigInt`, so `0x0`
   padding differences do not matter. Every failure prints its reason. Any failure exits 1.

## The mine-rule, and why it zeroes entries

From the moment one address appears in `contracts`, a listed transaction only counts when it
runs through one of those contracts. Everything else stops counting.

That means declaring a contract is not free. An entry with ten good mainnet transactions and
one freshly declared contract address that none of them touch scores **zero** transactions.
The file is valid, the hashes are real, the transactions succeeded, and the board reads nothing.
This is the trap that has already cost real entries their transaction score.

The rule of thumb: never add an address to `contracts` without transactions in the same commit
that are routed through it, and run this tool with `--rpc` to confirm which ones actually are.

## Usage

```
node preflight/bin/strk20-preflight.mjs [path/to/strk20.json] [--rpc URL] [--offline] [--json]

  path        manifest to check (default: ./strk20.json)
  --rpc URL   Starknet RPC node for the on-chain checks.
              Default: the STARKNET_RPC environment variable, when it is set.
  --offline   file checks only, never touch the network
  --json      print one machine-readable result object instead of the report
```

Exit codes: `0` every check passed, `1` at least one check failed, `2` usage error or the
manifest could not be read.

Warnings (an over-long transaction list, an empty `demo_video`, the mine-rule notice) do not
change the exit code. Only real failures do.

The RPC URL is read but never printed. Only its host appears in the report, so a node URL with
an API key in the path is safe to pass in CI logs.

### In CI

```yaml
- run: node preflight/bin/strk20-preflight.mjs strk20.json
  env:
    STARKNET_RPC: ${{ secrets.STARKNET_RPC }}
```

### As a library

```js
import { inspectManifest } from "./preflight/src/manifest.mjs";
import { transactionVerdict } from "./preflight/src/verdict.mjs";
```

`transactionVerdict(receipt, tx, declaredContracts)` is pure and takes plain objects, so the
routing rule can be tested without a node.

## Requirements

Node 18 or newer. One dependency, `starknet`, and only the RPC path loads it: `--offline` runs
with nothing installed.

## Accuracy

The checks mirror the indexer's read path as documented at the time of writing. When the hub
changes how it reads manifests, this tool can fall behind. Treat a pass as "no known silent
drop", not as a scoring guarantee, and open an issue if you find a case it reads wrong.

Maintained by the NIGHTSHIFT team (https://github.com/kshitij-hash/nightshift).
