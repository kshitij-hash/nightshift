# NIGHTSHIFT — agent operating rules

Recurring private authorization on the STRK20 privacy pool (Starknet mainnet).
Entry in the STRK20 Private Sprint; hard deadline **2026-08-31T23:59:00Z**. The repo state at
that instant IS the submission — there is nothing to submit.

## Non-negotiable invariants (checked by `npm run check:manifest` and CI)

1. `strk20.json` must ALWAYS be valid JSON. Invalid JSON is silently ignored by the judges'
   indexer and costs every scoring gate at once.
2. `transactions` is a FLAT ARRAY OF BARE STRINGS (`/^0x[0-9a-fA-F]{1,64}$/`), best first —
   only the first 10 are read.
3. **The mine-rule (indexer, changed 2026-08-17):** once ANY address is listed in `contracts`,
   every transaction must run through one of OUR contracts (event from it, or its address in
   calldata) or it stops counting. NEVER add a contract address without ≥3 vault-routed tx
   hashes in the SAME commit.
4. `demo_url` in strk20.json beats all auto-discovery. `demo_video` must be a public URL that
   plays logged-out.
5. The `privacy = { git = …, rev = … }` dependency lives in the ROOT `Scarb.toml` under a
   literal `[dependencies]` header — the hub regex does not match `[workspace.dependencies]`.
6. One commit every UTC day. Commit messages state what actually changed — these words are
   banned by the hub's summarizer and read as filler: "various", "updates", "improvements",
   "enhanced", "new features", "and more", "refactored code", "better".

## Security (supply chain + mainnet keys)

- `npm ci --ignore-scripts` is THE install command. Never plain `npm install` for new deps
  without reading the package (name char-by-char for typosquats, age, downloads, postinstall).
- Never read, print, or commit `.env*` or anything in `~/.nightshift/`. Key material never
  enters the repo tree, the shell history, or the conversation.
- Scarb git dependencies pinned to a tag or commit SHA, never a branch.
- Mainnet transactions: dry-run/estimate first; the 6 STRK protocol fee comes from the
  submitter's PUBLIC balance — keep both accounts funded.
- Private-tx hygiene: ≥10 blocks between private transactions from the same account;
  `invalidateProofNonceCache()` after any failure; `tip: 0n` always.

## Framing (scored by an LLM rubric — wording matters)

- NIGHTSHIFT is "a recurring authorization the pool cannot express", built from a period-
  nullifier scheme + accounted custody + a tier gate. NEVER describe it as "private
  subscription payments" or any "payment app whose only idea is that the payment is private".
- README/description style: flat engineer prose. Banned everywhere: utilizes, leverages, employs,
  facilitates, empowers, enables, seeks to, aims to, provides, robust, seamless, cutting-edge,
  revolutionary, innovative, novel, sophisticated, comprehensive, solution, ecosystem,
  platform, em dashes.

## Boundaries

- This repo is public from commit 1. Nothing from `~/dev/agent/private-sprint/` (competitive
  intelligence) is ever committed, linked, or quoted here.
- Outward actions (opening PRs/issues on other repos, npm publish, Telegram posts, mainnet
  deploys) need explicit human sign-off, every time.
