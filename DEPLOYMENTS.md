# Deployments

## Starknet mainnet — NightshiftVault v2 (current)

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

The vault address is deliberately NOT in `strk20.json` yet: the sprint indexer
only counts transactions routed through declared contracts, so the address and
the first vault-routed transaction hashes land in one commit together.
