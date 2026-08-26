# Runbook

Operator procedures for NIGHTSHIFT: building, testing, running the keeper and
relay, and updating the sprint manifest.

## Prerequisites

- Node 22 (the version CI pins in `.github/workflows/ci.yml`).
- scarb 2.17.0 and snforge 0.59.0 (see `COMPAT.md`).
- Install JS dependencies with `npm ci --ignore-scripts`, the install command
  for every package in this repo (`package.json`, `verify/package.json`,
  `preflight/package.json`, `app/package.json`). A new dependency gets read
  character-by-character for typosquats and its postinstall script read
  before it goes in.
- `.env` (gitignored) holds `STARKNET_RPC`, `NIGHTSHIFT_ACCOUNT_ADDRESS`,
  `NIGHTSHIFT_VAULT`, and `NIGHTSHIFT_COMMITMENT`. Copy `.env.example` and
  fill in an RPC URL; never put a private key in it. No secret value from
  `.env` is reproduced here.
- `~/.nightshift/` holds `acct2.address` and `acct2.keypair`, outside the
  repo tree; the keeper and the relay read from there. Nothing under
  `~/.nightshift/`, and no `.env*` file, is ever read, printed, or committed
  by anything in this repo.

## Build and test

```
scarb build
snforge test
node scripts/check-manifest.mjs
```

`scarb build` compiles the vault and gate against the pinned toolchain and
`privacy` dependency (see `COMPAT.md`). `snforge test` runs the full
adversarial and lifecycle suite across `tests/`. `check-manifest.mjs`
validates `strk20.json` the way the sprint indexer reads it: JSON validity,
flat-array transaction shape, and the mine-rule warning; set `CHECK_RPC=1`
with `STARKNET_RPC` set to also verify each listed transaction against the
declared contracts over RPC.

The JS suites, none of which touch mainnet:

```
node --test verify/test/*.test.mjs
node --test preflight/test/*.test.mjs
(cd examples/telegram-gate && node --test)
(cd demo-charge && node --test)
node --test scripts/*.test.mjs
```

`verify/test` covers `nightshift-verify` in isolation. `preflight` covers
`strk20-preflight.mjs`, the manifest-vs-chain checker. `examples/telegram-gate`
covers the example bot's pure logic (env parsing, presentation parsing, the
reason-code mapping, rate limiting) with no token, no RPC and no network.
`demo-charge` covers the mainnet-charge HTTP endpoint's request handling and
limits. `scripts/*.test.mjs` covers the present-message chain anchor and the
creator metrics math the app's creator ledger runs; `app/test/` pins the
app's wallet math to golden values proven on mainnet.

## The keeper

`scripts/keeper.mjs` is the unattended charge daemon: a bare `charge` call
against the vault, fired from Account 2 (`~/.nightshift/acct2.*`), so the
vault's `Charged` event records that account as `by`, never the subscriber.
It serves exactly one commitment per invocation, read from `[vault]
[commitment]` positional CLI args or from `NIGHTSHIFT_VAULT` /
`NIGHTSHIFT_COMMITMENT` in `.env`. One commitment per subscription managed
this way means one cron line per commitment.

Install it on a cron, every 30 minutes, one line per commitment:

```
*/30 * * * * cd <repo> && /usr/bin/env node scripts/keeper.mjs <vault> <commitment> >> ~/.nightshift/keeper.log 2>&1
```

The log file exists only because this cron line redirects into it; the
keeper itself never opens or creates `~/.nightshift/keeper.log`, it only
writes to stdout/stderr. Running the script by hand, or from a different
cron line, produces no log file unless that invocation redirects one too.

Each run reads `is_active` and `periods_due` over public RPC first; if
nothing is due it logs and exits at no cost. When periods are due it fires
`charge`, estimates the fee first (failing the run cleanly rather than
submitting a payload the vault would reject), waits for
acceptance, and repeats up to `MAX_CHARGES_PER_RUN` (3) so a backlog drains
gradually across runs instead of in one burst.

`keeper.mjs` treats ANY revert, for any reason (`NS_NOT_DUE`,
`NS_ESCROW_EXHAUSTED`, `NS_UNKNOWN_SUB`, `NS_CANCELLED`, `NS_PERIOD_SPENT`),
as fatal: it logs the transaction hash and exits 1, stopping the rest of
that run. This is not an incident that needs an operator to restart
anything: cron refires the script on its own schedule 30 minutes later.
`NS_NOT_DUE` in particular is rare in the first place, since the keeper
already checks `periods_due` before firing `charge` and only calls it when
that read says a period is due; a revert on top of that read means the read
and the invoke landed on either side of a period boundary, not that
anything is wrong. A revert for a different reason (`NS_CANCELLED`,
`NS_PERIOD_SPENT`, `NS_UNKNOWN_SUB`) is worth reading closely before the
next scheduled run fires again.

## The relay

`scripts/relay.mjs` submits a signature-gated `cancel` or `reclaim` on
someone else's behalf. Both entrypoints check only the subscriber's owner-key
signature, never the sender, so submission is agnostic to who pays gas:

```
node scripts/relay.mjs cancel  <commitment> <sig_r> <sig_s>
node scripts/relay.mjs reclaim <commitment> <to_address> <sig_r> <sig_s>
```

The signed line comes from the app: the cancel/reclaim flow on /manage signs
an owner-key message over `cancel_message`/`reclaim_message` from
`src/common.cairo` and prints the exact command above. The relay pre-flights against `schedule_of` before
spending gas (refuses an unknown subscription, an already-cancelled cancel,
or a reclaim against a live or empty-escrow subscription), then estimates
the fee before executing, reading `STARKNET_RPC` and `NIGHTSHIFT_VAULT` from
`.env` and the account from `~/.nightshift/`, same as the keeper.

## Driving pool actions from the app

Every wallet-route action the retired ops console drove now lives in the app
(`app/`): subscribe and creator claim on /manage (both pool-routed, dry-run
first), cancel/reclaim signing with the relay line printed, and off-chain
tier signing on /verify for any bot checking with `nightshift-verify`.

Private-tx hygiene applies to the pool-routed actions - subscribe (a private
withdraw-and-invoke) and claim (a prepare-then-submit into the pool): at
least 10 blocks between private transactions from the same account,
`invalidateProofNonceCache()` after any failure before retrying, and
`tip: 0n` always. Dry-run or estimate first; the pool's 6 STRK protocol fee
is drawn from the submitter's public balance, so keep both sides funded.

## demo-charge

`demo-charge/` is a small long-lived HTTP server exposing one route,
`POST /charge`, that fires a real mainnet `charge` on a whitelisted demo
subscription so a judge with no wallet can watch a transaction land without
running any of the above by hand. It runs on the keeper box, reading the
same `~/.nightshift/acct2.*` account files `scripts/keeper.mjs` reads, and
is otherwise independent of the cron keeper (it is a process of its own, not
something the keeper's cron line launches). See `demo-charge/README.md` for
the threat model and limits.

Everything past building and testing it (a chargeable demo subscription,
pointing the config at it, exposing the port, supervising the process) is a
deploy step per `demo-charge/README.md`'s own "Deploy: TODO, needs human
sign-off" section, and per `CLAUDE.md` is not something an agent does
unattended: it writes to mainnet and exposes a port to the internet.

## Manifest updates

`strk20.json` is read exactly the way `scripts/check-manifest.mjs` and
`preflight/` describe. Rules from `CLAUDE.md`, restated for operators:

- `transactions` must stay a flat array of bare `0x`-hex strings matching
  `/^0x[0-9a-fA-F]{1,64}$/`. Only the first 10 entries are read; order
  best-first.
- **The mine-rule.** The moment any address is listed in `contracts`, every
  transaction must run through one of those contracts (an event from it, or
  its address in calldata) or it stops counting. Never add a contract
  address to `contracts` without at least 3 vault-routed transaction hashes
  landing in the same commit. Run `preflight/bin/strk20-preflight.mjs --rpc
  $STARKNET_RPC` after any manifest edit to confirm which transactions
  actually route through the declared contracts.
- `demo_url` overrides auto-discovery; `demo_video` must be a public URL
  that plays logged out.
- Commit once a day, minimum, with a message that says what changed. The
  hub's summarizer treats filler words as noise: "various", "updates",
  "improvements", "enhanced", "new features", "and more", "refactored code",
  "better".

## Incident basics

RPC endpoint failover exists in exactly one place: the app
(`app/src/config.ts`'s `RPC_URLS`, tried in order, with the board falling
back to a committed snapshot labelled as such on the page). Nothing else in
this repo fails over. `nightshift-verify` takes a single `provider` or a single `rpcUrl` and
talks to only that one; so do the keeper and the relay, reading one
`STARKNET_RPC` from `.env`. If that one endpoint rate-limits or times out,
an operator has to swap `STARKNET_RPC` (or the caller's `rpcUrl`) by hand;
only the app rides through it unattended.

**If the pool blocks the vault as a depositor** (a pool-side block, a token
delisting, or a pool migration), the private claim leg through
`privacy_invoke` stops working and creator claimable balance would otherwise
be stranded. v4's answer is `claim_public`: a nonce-consumed, signature-gated
public exit (`DEPLOYMENTS.md`, v4 notes). The creator signs
`claim_public_message(creator_id, to, amount, nonce)` with their payout key,
using the nonce read from `claim_pub_nonce_of(creator_id)`; any account can
submit it, since the destination and amount are bound inside the signed
message. This is a public exit by construction: destination, amount, and
creator id all land on chain, which the private claim leg avoids.
