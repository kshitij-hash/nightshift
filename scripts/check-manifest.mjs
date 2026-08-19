#!/usr/bin/env node
// Validates strk20.json the way the sprint hub's indexer reads it, so a bad
// manifest fails CI here instead of silently zeroing the entry on the board.
//
// Mirrors scripts/build-projects.mjs in starkience/strk20-hackathon:
//   - readManifest(): invalid JSON is ignored wholesale
//   - transactions: array of bare strings, /^0x[0-9a-fA-F]{1,64}$/, first 10 read
//   - contracts: strings or {address} objects
//   - the mine-rule: with contracts declared, txs must run through one of them
//     (that part needs RPC and runs only with CHECK_RPC set)

import { readFileSync } from "node:fs";

const fail = (msg) => { console.error(`✗ ${msg}`); process.exitCode = 1; };
const ok = (msg) => console.log(`✓ ${msg}`);

let raw;
try {
  raw = readFileSync(new URL("../strk20.json", import.meta.url), "utf8");
} catch {
  fail("strk20.json missing at repo root");
  process.exit(1);
}

let m;
try {
  m = JSON.parse(raw);
} catch (e) {
  fail(`strk20.json is not valid JSON (${e.message}) — the hub would ignore the whole file`);
  process.exit(1);
}
ok("valid JSON");

const txs = m.transactions;
if (!Array.isArray(txs)) fail("transactions must be an array");
else {
  const bad = txs.filter((t) => typeof t !== "string" || !/^0x[0-9a-fA-F]{1,64}$/.test(t));
  if (bad.length) fail(`non-conforming tx entries (must be bare 0x-hex strings): ${JSON.stringify(bad)}`);
  else ok(`transactions: ${txs.length} entries, all bare hex strings`);
  if (txs.length > 10) console.warn(`⚠ only the first 10 of ${txs.length} transactions are read — order best-first`);
}

if (m.contracts !== undefined) {
  if (!Array.isArray(m.contracts)) fail("contracts must be an array");
  else {
    const addrs = m.contracts
      .map((c) => (typeof c === "string" ? c : c?.address))
      .filter(Boolean);
    if (addrs.length !== m.contracts.length) fail("every contracts entry needs an address");
    else ok(`contracts: ${addrs.length} declared`);
    if (addrs.length && (!Array.isArray(txs) || txs.length < 3))
      fail("mine-rule: contracts are declared but fewer than 3 transactions listed — txs not routed through our contracts stop counting the moment contracts appear");
  }
}

if (typeof m.demo_video !== "string") fail("demo_video must be a string (empty until recorded)");
else ok(m.demo_video ? "demo_video set" : "demo_video present (empty — fill before Aug 29)");

process.exit(process.exitCode || 0);
