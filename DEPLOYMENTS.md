# Deployments

## Starknet mainnet

| What | Value |
|---|---|
| NightshiftVault | `0x013b93ac368d4baa0a881848ff23d18849784d10c1c3da545fcebe9891773eb6` |
| Class hash | `0x0399f27333ab7417d9b2b027463a39a012590dfcacf813eb0a842df40af697e8` |
| Declare tx | `0x3bb3c937f5287aa3a0ed5ee74e1a8ce99d4b82d97c86418058948e2130c3c78` |
| Deploy tx | `0x713c0b06e9373f2f2791bbb4671e70488ea0ff5b4d228e6401203674ad94cdc` |
| Constructor | `pool = 0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a` |

The vault address is deliberately NOT in `strk20.json` yet: the sprint indexer
only counts transactions routed through declared contracts, so the address and
the first vault-routed transaction hashes land in one commit together.
