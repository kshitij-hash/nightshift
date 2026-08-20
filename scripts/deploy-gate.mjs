#!/usr/bin/env node
// Declares and deploys NightshiftGate to Starknet mainnet via starknet.js.
// Same reasoning as deploy-vault.mjs: starkli 0.4.2 rejects Sierra >=1.8 and
// sncast 0.59 wants RPC spec 0.10 while mainnet nodes serve 0.8.x.
//
// Reads STARKNET_RPC from .env and the operator key from ~/.nightshift/.
// Nothing secret is printed.
//
// Usage: node scripts/deploy-gate.mjs <vault-address>
//
// The vault address is the one constructor argument and is REQUIRED. There is
// no default on purpose: the gate must point at the vault it was built against,
// and defaulting to the v3 address would silently ship a gate reading the wrong
// contract.

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { Account, RpcProvider, json } from "starknet";

const vaultArg = process.argv[2];
if (!vaultArg || !/^0x[0-9a-fA-F]{1,64}$/.test(vaultArg)) {
  console.error("usage: node scripts/deploy-gate.mjs <vault-address>");
  console.error("  vault-address: 0x-prefixed hex felt, the vault this gate reads");
  process.exit(2);
}
const VAULT = vaultArg;

const env = readFileSync(new URL("../.env", import.meta.url), "utf8");
const rpc = env.match(/^STARKNET_RPC=(.+)$/m)?.[1]?.trim();
const address = env.match(/^NIGHTSHIFT_ACCOUNT_1=(.+)$/m)?.[1]?.trim();
const keypair = readFileSync(`${homedir()}/.nightshift/acct1.keypair`, "utf8");
const pk = keypair.match(/Private key\s*:\s*(0x[0-9a-fA-F]+)/)?.[1];
if (!rpc || !address || !pk) throw new Error("missing rpc/address/key");

const provider = new RpcProvider({ nodeUrl: rpc });
const account = new Account({ provider, address, signer: pk });

const sierra = json.parse(
  readFileSync(new URL("../target/dev/nightshift_NightshiftGate.contract_class.json", import.meta.url), "utf8"),
);
const casm = json.parse(
  readFileSync(new URL("../target/dev/nightshift_NightshiftGate.compiled_contract_class.json", import.meta.url), "utf8"),
);

console.log("declaring + deploying NightshiftGate (constructor: vault =", VAULT.slice(0, 12) + "…)");
const res = await account.declareAndDeploy({
  contract: sierra,
  casm,
  constructorCalldata: [VAULT],
});

console.log("class_hash:", res.declare.class_hash);
console.log("declare tx:", res.declare.transaction_hash || "(already declared)");
console.log("gate address:", res.deploy.contract_address);
console.log("deploy tx:", res.deploy.transaction_hash);

// --- post-deploy assertions (read-only) -------------------------------------
// Two things can go wrong at deploy and stay silent until a subscriber is
// standing at a door: the gate points somewhere other than the vault we meant,
// and the vault it points at is an older revision with no owner_key_of. Both are
// one call each to rule out, and both are cheaper to find here than in a
// presentation that reverts on mainnet.

const GATE = res.deploy.contract_address;

const pinned = await provider.callContract({ contractAddress: GATE, entrypoint: "vault" });
if (BigInt(pinned[0]) !== BigInt(VAULT)) {
  console.error(`FATAL: gate.vault() is ${pinned[0]}, not the ${VAULT} it was deployed against`);
  process.exit(1);
}
console.log("check: gate.vault() == the constructor argument");

// A commitment nobody subscribed. A vault with the view answers 0x0; a vault
// without it cannot answer at all. The gate calls this on every presentation, so
// a target missing it is a gate that can never admit anyone.
try {
  const key = await provider.callContract({
    contractAddress: VAULT,
    entrypoint: "owner_key_of",
    calldata: ["0x1"],
  });
  if (BigInt(key[0]) !== 0n) {
    console.error(`FATAL: vault.owner_key_of(0x1) returned ${key[0]}, expected 0x0`);
    process.exit(1);
  }
  console.log("check: vault.owner_key_of exists and reads 0x0 for an unknown commitment");
} catch (e) {
  const msg = String(e?.message ?? e);
  if (/ENTRYPOINT_NOT_FOUND|[Ee]ntry ?point.*not found|not found in contract/.test(msg)) {
    console.error(`FATAL: target vault ${VAULT} has no owner_key_of view.`);
    console.error("  This gate reads owner_key_of on every present() and would revert for");
    console.error("  every subscriber. Point it at the vault revision that adds the view.");
    process.exit(1);
  }
  throw e;
}
