# NIGHTSHIFT: agent operating rules

Private fan subscriptions on the STRK20 privacy pool (Starknet mainnet), built on a
recurring authorization the pool cannot express by itself.
Entry in the STRK20 Private Sprint; hard deadline **2026-09-07T23:59:00Z** (extended from
August 31; winners September 11). The repo state at that instant IS the submission: there is
nothing to submit.

## Non-negotiable invariants (checked by `npm run check:manifest` and CI)

1. `strk20.json` must ALWAYS be valid JSON. Invalid JSON is silently ignored by the judges'
   indexer and costs every scoring gate at once.
2. `transactions` is a FLAT ARRAY OF BARE STRINGS (`/^0x[0-9a-fA-F]{1,64}$/`), best first;
   only the first 10 are read.
3. **The mine-rule (indexer, changed 2026-08-17):** once ANY address is listed in `contracts`,
   every transaction must run through one of OUR contracts (event from it, or its address in
   calldata) or it stops counting. NEVER add a contract address without ≥3 vault-routed tx
   hashes in the SAME commit.
4. `demo_url` in strk20.json beats all auto-discovery. `demo_video` must be a public URL that
   plays logged-out.
5. The `privacy = { git = …, rev = … }` dependency lives in the ROOT `Scarb.toml` under a
   literal `[dependencies]` header; the hub regex does not match `[workspace.dependencies]`.
6. One commit every UTC day. Commit messages state what actually changed; these words are
   banned by the hub's summarizer and read as filler: "various", "updates", "improvements",
   "enhanced", "new features", "and more", "refactored code", "better".

## Security (supply chain + mainnet keys)

- `npm ci --ignore-scripts` is THE install command. Never plain `npm install` for new deps
  without reading the package (name char-by-char for typosquats, age, downloads, postinstall).
- Never read, print, or commit `.env*` or anything in `~/.nightshift/`. Key material never
  enters the repo tree, the shell history, or the conversation.
- Scarb git dependencies pinned to a tag or commit SHA, never a branch.
- Mainnet transactions: dry-run/estimate first; the 6 STRK protocol fee comes from the
  submitter's PUBLIC balance, so keep both accounts funded.
- Private-tx hygiene: ≥10 blocks between private transactions from the same account;
  `invalidateProofNonceCache()` after any failure; `tip: 0n` always.

## Framing (scored by an LLM rubric; wording matters)

- Two registers, deliberately. The README and docs lead with the mechanism: "a recurring
  authorization the pool cannot express", built from a period-nullifier scheme + accounted
  custody + a tier gate. The product surfaces (`app/`) speak to fans and creators in plain
  words (nights, rooms, receipts) and never explain the cryptography. Neither register
  reduces the project to "a payment app whose only idea is that the payment is private".
- The app's user-facing vocabulary never includes: commitment, creator_id, felt, poseidon,
  escrow, vault, charge, keeper, tx hash, period, gas, mainnet, indexer. Money reads as STRK
  per week, day or hour. The detail pages behind Receipts (/board, /verify, /creator) are the
  one place technical terms are allowed.
- Two privacy overclaims are banned in all docs and demo copy: (1) any claim of creator
  revenue confidentiality (per-creator topline is publicly derivable; PRIVACY.md limitation 2);
  (2) describing the tier gate as a proof where the verifier "learns nothing else" (`present`
  is a signature presentation revealing the commitment, which a verifier can track across gates).
- README/description style: flat engineer prose. Banned everywhere: utilizes, leverages, employs,
  facilitates, empowers, enables, seeks to, aims to, provides, robust, seamless, cutting-edge,
  revolutionary, innovative, novel, sophisticated, comprehensive, solution, ecosystem,
  platform, em dashes.

## Boundaries

- This repo is public from commit 1. Nothing from `~/dev/agent/private-sprint/` (competitive
  intelligence) is ever committed, linked, or quoted here.
- Outward actions (opening PRs/issues on other repos, npm publish, Telegram posts, mainnet
  deploys) need explicit human sign-off, every time.
