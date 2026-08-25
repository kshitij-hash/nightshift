# Compatibility

What this repo is pinned against, and why the pin keeps it working.

## Toolchain

Two different things share the version numbers 2.17.0 and 0.59.0, and
`Scarb.toml` and CI each pin only one of them:

| What | Version | Where pinned |
|---|---|---|
| `starknet` Cairo package (library code the vault and gate compile against) | 2.17.0 | `Scarb.toml` (`starknet = "2.17.0"`) |
| `assert_macros` Cairo package | 2.17.0 | `Scarb.toml` dev-dependency |
| `snforge_std` Cairo library (the test-framework code `tests/` compiles against) | 0.59.0 | `Scarb.toml` dev-dependency (`snforge_std = "0.59.0"`) |
| scarb CLI binary (the compiler CI runs) | 2.17.0 | `.github/workflows/ci.yml` (`setup-scarb@v1`, `scarb-version: "2.17.0"`) |
| snforge CLI binary (the test runner CI runs) | 0.59.0 | `.github/workflows/ci.yml` (`setup-snfoundry@v3`, `starknet-foundry-version: "0.59.0"`) |
| node | 22 | `.github/workflows/ci.yml` (`setup-node@v4`) |

The numbers match on purpose (a scarb binary built for a different Cairo
edition than the `starknet` package it compiles is asking for trouble), but
they are two independent pins: `Scarb.toml` fixes which Cairo *packages* the
build resolves against, and `ci.yml` fixes which *binaries* run the build.
Bumping one without the other is a version skew, not a typo.

CI runs the same scarb and snforge binary versions, against the same
`Scarb.toml` package pins, the vault was built and deployed with, on
purpose: the comment in `ci.yml` says CI must never build a different tree
than the one shipped from the workstation.

## The privacy dependency

Root `Scarb.toml`, under a literal `[dependencies]` header (the STRK20 hub's
stack detector matches that exact shape, never `[workspace.dependencies]`):

```
privacy = { git = "https://github.com/starkware-libs/starknet-privacy", rev = "66e3caae8c0201227a6719696d004e30d90aea65" }
```

The SHA is tagged `PRIVACY-0.14.3-RC.5` (2026-08-12) in that repo, the newest
tag at pin time. Every `PRIVACY-*` tag in `starknet-privacy` is a release
candidate, so the commit SHA is the real pin, not the tag name, which could
move if a later RC reuses it.

What NIGHTSHIFT specifically relies on at that SHA:

1. **`privacy::objects::OpenNoteDeposit`'s field layout.** `src/common.cairo`
   re-exports the type from the `privacy` crate rather than mirroring its
   fields. A field added or reordered upstream becomes a compile error in
   this repo instead of a batch that serde-mismatches and reverts on mainnet.
2. **The pool's invoke sequence.** `TransferTo` moves funds to the vault,
   then `call_contract_syscall` fires `privacy_invoke` with raw calldata, the
   pool strictly deserializes `Span<OpenNoteDeposit>` from the return data,
   asserts the return data is fully consumed, checks each deposit (note
   exists, is open, undeposited, token matches), then pulls the funds with
   `checked_transfer_from`. `src/mocks.cairo`'s `MockPrivacyPool` replays this
   exact sequence with the pool's own revert strings, checked against the
   live class. No other public test harness for this pool exists, so this
   mock is the only place the sequence is exercised outside mainnet itself.

The Scarb.toml comment notes `OpenNoteDeposit` is byte-identical at the pin
SHA to `CONTRACT_V2_DEPLOYED_MAINNET_2026-07-08`, the revision behind the
mainnet pool this vault is invoked by. That match is what makes the pin
correct today; it is not a promise the pool will never move (see below).

## The mainnet pool address

`0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a` is the
constructor argument for v2 through v4, each with its own `Constructor` row
in `DEPLOYMENTS.md`. v1 predates that per-version constructor table: its
`DEPLOYMENTS.md` entry lists only the vault address and class hash, no
declare tx, deploy tx or constructor row, since it was superseded before
first use and nothing was backfilled. `privacy_invoke` asserts
`get_caller_address() == pool`, so a vault instance only ever accepts
pool-invoked calls from the one address it was constructed with. There is no
admin path to repoint it.

## Vault versions on mainnet

| Version | Address | Status |
|---|---|---|
| v4 | `0x171e8e0bb905c899b9d1ad5c02aefe96a5d0b6d5f093f0ee80707b592417f8e` | current |
| v3 | `0x277519c8bc1031188313de4528d1f0159319f8f86651422e89b6fbd920b3759` | superseded, receipts banked in `strk20.json` |
| v2 | `0x01f653f21e557e70384c8631f9c8f97e0342aa1d5e975bdcaca76bbf8715f338` | superseded, receipts banked in `strk20.json` |
| v1 | `0x013b93ac368d4baa0a881848ff23d18849784d10c1c3da545fcebe9891773eb6` | superseded before first use, nothing routed through it |

v4 adds over v3: surplus-tolerant subscribe custody, `owner_key_of` and
`claim_pub_nonce_of` views, the nonce-consumed `claim_public` exit, indexed
event filter fields, a tagged period nullifier, and zero-token registration
rejection (`DEPLOYMENTS.md`).

## Which consumer reads which vault

| Consumer | Depends on |
|---|---|
| `src/vault.cairo` | The pinned pool address (constructor); `OpenNoteDeposit` layout and the pool's invoke sequence from the `privacy` dependency above |
| `src/gate.cairo` | One vault address, pinned at deploy (constructor); requires that vault to expose `owner_key_of` and `schedule_of`. v3 stores the owner key but has no view for it, so the gate targets v4 |
| `verify/` (`nightshift-verify`) | A caller-supplied `vaultAddress` exposing `owner_key_of` and `schedule_of`; the README calls out that v3 answers `rpc_error` at the `owner_key_of` step for the same reason as the gate |
| `preflight/` | `strk20.json`'s shape and the sprint indexer's mine-rule, not tied to a vault version; it reads RPC receipts and calldata generically against whatever contracts are declared |
| Keeper (`scripts/keeper.mjs`) | `NIGHTSHIFT_VAULT` (env or CLI arg) exposing `is_active`, `periods_due`, `charge`; operated against v4 |
| Relay (`scripts/relay.mjs`) | `NIGHTSHIFT_VAULT` exposing `schedule_of`, `cancel`, `reclaim`; operated against v4 |
| Ops console (`web/app.mjs`) | Hardcoded v4 `VAULT` and `GATE` addresses, plus the hardcoded `POOL` address for building pool-shaped `withdraw`/`invoke` actions |
| Demo board (`site/`) | All three live vault versions (`VAULT`, `VAULT_V3`, `VAULT_V2` in `site/src/config.ts`) so it can render full subscription history, not just v4 |

## What breaks if the pool upgrades

The open risk: the pool contract is not ours. The vault's constructor
pins the pool's *address*, not a class hash, so if STRK20 replaces the pool's
class at that same address, three things this repo depends on could silently
drift out from under it: the `privacy_invoke` calldata shape the pool sends,
the `OpenNoteDeposit` serde layout the vault returns, and the invoke sequence
`MockPrivacyPool` replays in tests. None of that is testable against the real
pool from this repo; `MockPrivacyPool` is checked against the pool's class as
it stands today, and a class upgrade on their side is the one dependency
nothing in this repository can pin.
