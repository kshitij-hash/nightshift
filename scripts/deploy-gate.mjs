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
