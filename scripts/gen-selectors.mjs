#!/usr/bin/env node
// Computes every NIGHTSHIFT event key and entry-point selector from the Cairo
// names and writes site/src/lib/selectors.ts.
//
// Why generate instead of hand-copying. site/src/rpc.ts carries five selectors
// typed in by hand. A single wrong nibble there is not a crash: getEvents just
// matches nothing and the board renders an empty history that looks like "no
// activity". So this script reads those five values straight out of
// site/src/rpc.ts's source text and ASSERTS the recomputed selectors match
// them; the hardcoded KNOWN map below is kept as a second, independent
// cross-check. If starknet.js ever changes its hashing, or site/src/rpc.ts
// and this script's own KNOWN map disagree on one of those five names, this
// run fails loudly instead of shipping a board that quietly shows zero.
//
// What this script does NOT catch: it never reads src/vault.cairo or
// src/gate.cairo. The names below (VAULT_EVENTS, GATE_EVENTS,
// VAULT_ENTRY_POINTS, GATE_ENTRY_POINTS - 29 selectors in all) are
// transcribed by hand and trusted as given; only 5 of the 29 are
// cross-checked, against site/src/rpc.ts's own hand-typed constants, not
// against Cairo. A Cairo event or entry point renamed without updating this
// file's transcription, outside those 5, recomputes a wrong-but-consistent
// selector with no error from this script.
//
// Run from the repo root:  node scripts/gen-selectors.mjs
// Reads site/src/rpc.ts (to check it, never to copy from it); writes
// site/src/lib/selectors.ts only when the generated content differs from
// what is already there, so a clean run with no Cairo or rpc.ts change
// leaves the committed file byte-identical and untouched - useful as a
// drift check in CI.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { hash } from "starknet";

const OUT = new URL("../site/src/lib/selectors.ts", import.meta.url);
const RPC_TS = new URL("../site/src/rpc.ts", import.meta.url);

/** 0x + 64 hex, the shape the existing board and Voyager both print. */
const pad = (sel) => `0x${BigInt(sel).toString(16).padStart(64, "0")}`;
const sel = (name) => pad(hash.getSelectorFromName(name));

// ---------------------------------------------------------------------------
// Names, transcribed from src/vault.cairo and src/gate.cairo. Every comment
// here states the ON-CHAIN layout as the Cairo defines it, since the layout is
// what a decoder gets wrong, not the name.
// ---------------------------------------------------------------------------

/** Vault events. keys[0] is the selector; #[key] fields follow in keys[1..]. */
const VAULT_EVENTS = {
  // #[key] commitment          | data: creator_id, n_periods
  Subscribed: "Subscribed",
  // #[key] creator_id          | data: token, tiers
  CreatorRegistered: "CreatorRegistered",
  // #[key] commitment          | data: period_index (u32), amount (u128), by
  Charged: "Charged",
  // #[key] creator_id          | data: amount (u128)
  Claimed: "Claimed",
  // #[key] creator_id          | data: to, amount (u128)
  ClaimedPublic: "ClaimedPublic",
  // #[key] commitment          | data: (empty)
  Cancelled: "Cancelled",
  // #[key] commitment          | data: amount (u128)
  Reclaimed: "Reclaimed",
};

/** Gate events. Presented indexes TWO fields, not one. */
const GATE_EVENTS = {
  // #[key] commitment, #[key] verifier_id | data: expiry_block, creator_id, tier
  Presented: "Presented",
};

/** The v2 vault named its charge event Released. Kept so the board can keep
 *  decoding the banked v2 receipts. */
const LEGACY_EVENTS = { Released: "Released" };

/** Vault entry points, from the INightshiftVault trait. */
const VAULT_ENTRY_POINTS = [
  "privacy_invoke",
  "charge",
  "register_creator",
  "cancel",
  "reclaim",
  "claim_public",
  "accounted",
  "is_active",
  "owner_key_of",
  "claimable_of",
  "claim_pub_nonce_of",
  "schedule_of",
  "tier_of",
  "periods_due",
  "period_charged",
];

/** Gate entry points, from the INightshiftGate trait. Note that `is_active`
 *  and `tier_of` exist on BOTH contracts with different signatures. A selector
 *  is a hash of the NAME only, so they share one selector and the caller has
 *  to know which address it is talking to. */
const GATE_ENTRY_POINTS = ["present", "vault", "is_active", "presentable", "tier_of"];

// ---------------------------------------------------------------------------
// The assertion. Two independent sources are checked against the recomputed
// selector for each of the five names site/src/rpc.ts hand-types:
//   1. site/src/rpc.ts itself, read and pattern-matched below - the real
//      target, since that file is what a wrong nibble would actually break.
//   2. KNOWN, a second hardcoded copy kept here so a change to rpc.ts's
//      formatting that breaks the regex below is itself caught (the read
//      would fail loudly) rather than silently skipping the check.
// Any mismatch, in either direction, is a hard failure.
// ---------------------------------------------------------------------------
const KNOWN = {
  Released: "0x0127adceb04d96dd7337eb363a9dd96b0fe957ce88be4b770ba4ef9fdc970f7f",
  Charged: "0x0185ca81badbc5dd12754d07ca82c20ece8887f3e68ce333c631ac3e4faaaa6a",
  Subscribed: "0x001757823b1d7233f8d4a0e3b3766c8a572e33e572b950f099f5338858558d78",
  accounted: "0x019fcbfd1cca23ace0b1d37e31b7215f7c14f51f0aecda59ccbc8cbd93e4a98e",
  is_active: "0x028cd1b9b7a6254f5219ad13ceac17ed7e5c245c1b5f97c1a9c7f69d59cd819f",
};

/** Which hand-typed constant in site/src/rpc.ts holds which Cairo name's
 *  selector. Explicit, since the casing gives no single rule to derive it
 *  from (SEL_IS_ACTIVE -> is_active, SELECTOR_SUBSCRIBED -> Subscribed). */
const RPC_TS_CONST_NAMES = {
  Released: "SELECTOR_RELEASED",
  Charged: "SELECTOR_CHARGED",
  Subscribed: "SELECTOR_SUBSCRIBED",
  accounted: "SEL_ACCOUNTED",
  is_active: "SEL_IS_ACTIVE",
};

/** Extracts `const CONST_NAME = "0x...";` (single- or two-line) from
 *  site/src/rpc.ts's own source text - never copied, always read fresh. */
function readRpcTsSelectors(source) {
  const out = {};
  for (const [cairoName, constName] of Object.entries(RPC_TS_CONST_NAMES)) {
    const re = new RegExp(`const\\s+${constName}\\s*=\\s*\\n?\\s*"(0x[0-9a-fA-F]+)"`);
    const m = source.match(re);
    if (!m) throw new Error(`could not find "const ${constName} = ..." in site/src/rpc.ts`);
    out[cairoName] = m[1];
  }
  return out;
}

const rpcTsSelectors = readRpcTsSelectors(readFileSync(RPC_TS, "utf8"));

let failed = 0;
for (const name of Object.keys(RPC_TS_CONST_NAMES)) {
  const got = sel(name);
  const fromRpcTs = rpcTsSelectors[name];
  const hardcoded = KNOWN[name];
  if (BigInt(got) !== BigInt(fromRpcTs)) {
    console.error(`✗ selector mismatch for ${name}`);
    console.error(`    computed              ${got}`);
    console.error(`    read from site/src/rpc.ts  ${fromRpcTs}`);
    failed += 1;
    continue;
  }
  if (BigInt(hardcoded) !== BigInt(fromRpcTs)) {
    console.error(`✗ ${name}: this script's own KNOWN map disagrees with site/src/rpc.ts`);
    console.error(`    KNOWN[${name}]        ${hardcoded}`);
    console.error(`    read from site/src/rpc.ts  ${fromRpcTs}`);
    failed += 1;
    continue;
  }
  console.log(`✓ ${name} matches site/src/rpc.ts and the KNOWN cross-check`);
}
if (failed > 0) {
  console.error(
    `\n${failed} selector(s) disagree. Nothing written. Either a Cairo event ` +
      `was renamed, the hashing changed, or site/src/rpc.ts and KNOWN drifted ` +
      `apart; resolve before shipping.`,
  );
  process.exit(1);
}

const entry = (names) =>
  names.map((n) => `  ${n}: "${sel(n)}",`).join("\n");
const events = (map) =>
  Object.keys(map)
    .map((n) => `  ${n}: "${sel(n)}",`)
    .join("\n");

const body = `// GENERATED by scripts/gen-selectors.mjs. DO NOT EDIT.
// Regenerate with: node scripts/gen-selectors.mjs
//
// Event keys and entry-point selectors for the NIGHTSHIFT vault and gate,
// computed with starknet.js hash.getSelectorFromName over the names in
// src/vault.cairo and src/gate.cairo.
//
// Event layout, as the Cairo declares it. keys[0] is always the selector of
// the variant name; every #[key] field follows in keys[1..]; everything else is
// positional in data[].
//
//   vault Subscribed        keys: commitment                data: creator_id, n_periods
//   vault CreatorRegistered keys: creator_id                data: token, tiers
//   vault Charged           keys: commitment                data: period_index, amount, by
//   vault Claimed           keys: creator_id                data: amount
//   vault ClaimedPublic     keys: creator_id                data: to, amount
//   vault Cancelled         keys: commitment                data: (empty)
//   vault Reclaimed         keys: commitment                data: amount
//   gate  Presented         keys: commitment, verifier_id   data: expiry_block, creator_id, tier
//
// Presented is the one event with TWO indexed fields, so its creator_id is in
// data[1] and cannot be filtered server-side. Filter it on the commitment set.

/** Vault event keys (keys[0] of a vault event). */
export const EVENT = {
${events(VAULT_EVENTS)}
} as const;

/** Gate event keys. */
export const GATE_EVENT = {
${events(GATE_EVENTS)}
} as const;

/** The v2 vault called its charge event Released. Kept for the banked v2
 *  receipts the board still decodes. */
export const LEGACY_EVENT = {
${events(LEGACY_EVENTS)}
} as const;

/** Vault entry-point selectors. */
export const VAULT_SELECTOR = {
${entry(VAULT_ENTRY_POINTS)}
} as const;

/** Gate entry-point selectors. \`is_active\` and \`tier_of\` collide by name with
 *  the vault's, since a selector hashes the name alone. Same selector, different
 *  contract address, different signature. */
export const GATE_SELECTOR = {
${entry(GATE_ENTRY_POINTS)}
} as const;

/** Felt comparison that ignores leading-zero padding. RPC nodes are not
 *  consistent about padding event keys, so never compare these as strings. */
export const feltEq = (a: string, b: string): boolean => BigInt(a) === BigInt(b);

/** 0x + 64 hex, the padded form used throughout this file. */
export const feltPad = (a: string): string =>
  \`0x\${BigInt(a).toString(16).padStart(64, "0")}\`;
`;

// Write only when the content actually changed, so a clean run (nothing in
// src/vault.cairo, src/gate.cairo or this script's transcription of them
// moved) leaves the committed file's mtime and git status untouched, and
// this doubles as a drift check: re-run it and diff, and any output means
// something real changed.
const existing = existsSync(OUT) ? readFileSync(OUT, "utf8") : null;
const count =
  Object.keys(VAULT_EVENTS).length +
  Object.keys(GATE_EVENTS).length +
  Object.keys(LEGACY_EVENTS).length +
  VAULT_ENTRY_POINTS.length +
  GATE_ENTRY_POINTS.length;
if (existing === body) {
  console.log(`✓ site/src/lib/selectors.ts already up to date (${count} selectors, unchanged)`);
} else {
  writeFileSync(OUT, body);
  console.log(`✓ wrote site/src/lib/selectors.ts (${count} selectors)`);
}
