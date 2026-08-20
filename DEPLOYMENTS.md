# Deployments

## Starknet mainnet — NightshiftVault v3 (current)

| What | Value |
|---|---|
| NightshiftVault v3 | `0x277519c8bc1031188313de4528d1f0159319f8f86651422e89b6fbd920b3759` |
| Class hash | `0x149dfe71566d1f34f99cae9e55dea972e218ed1580c9c2b93bd2cb01d62c116` |
| Declare tx | `0x2c57bf32f034684b43e3f0cd2fa3e23f6eaac8b72ce677a0092a00308bf12a9` |
| Deploy tx | `0x6e31ec39da6b1ad66ab25f26d6fec5068c2ae5b65e79666ced7f20a566d9b6a` (block 13,606,969) |
| Constructor | `pool = 0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a` |
| v3 over v2 | charging split from settlement: `charge` is a permissionless call (a cron keeper needs no proof, no pool batch, no wallet API); settlement is a creator-signed `Claim` through `privacy_invoke`; `cancel`/`reclaim` signature-gated by the subscriber's owner key; reclaim pays out by direct transfer; `periods_due` and `period_charged` views |

v3's transactions enter `strk20.json` only together with its address (mine-rule
atomicity); until then the manifest keeps carrying the v2 set below.

## v2 (superseded — its four transactions remain the banked strk20.json receipts)

| What | Value |
|---|---|
| NightshiftVault | `0x01f653f21e557e70384c8631f9c8f97e0342aa1d5e975bdcaca76bbf8715f338` |
| Class hash | `0x012816e260ec3343fe7ab8908cb028df7ea143e13fab780379237a7a01482ad` |
| Declare tx | `0x1243bf2479743e148a901e685e8fa32a2b17e8472249fabe1a2389cb980c597` (block 13,554,340) |
| Deploy tx | `0x29d3a6209b20b7a59937bcb09f905f2fe87e5523efea89c6307142d1447f1bc` (block 13,554,345) |
| Constructor | `pool = 0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a` |
| v2 over v1 | adds `schedule_of` and `tier_of` read views for the board and gate consumers |

## v1 (superseded before first use — nothing was ever routed through it)

| What | Value |
|---|---|
| NightshiftVault v1 | `0x013b93ac368d4baa0a881848ff23d18849784d10c1c3da545fcebe9891773eb6` |
| Class hash | `0x0399f27333ab7417d9b2b027463a39a012590dfcacf813eb0a842df40af697e8` |
