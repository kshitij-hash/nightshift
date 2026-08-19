#!/usr/bin/env node
// Declares and deploys NightshiftVault to Starknet mainnet via starknet.js.
// Used instead of starkli/sncast: starkli 0.4.2 rejects Sierra >=1.8 and
// sncast 0.59 wants RPC spec 0.10 while mainnet nodes serve 0.8.x.
//
// Reads STARKNET_RPC from .env and the operator key from ~/.nightshift/ —
// nothing secret is printed.

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { Account, RpcProvider, json } from "starknet";

const POOL = "0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a";

const env = readFileSync(new URL("../.env", import.meta.url), "utf8");
const rpc = env.match(/^STARKNET_RPC=(.+)$/m)?.[1]?.trim();
const address = env.match(/^NIGHTSHIFT_ACCOUNT_1=(.+)$/m)?.[1]?.trim();
const keypair = readFileSync(`${homedir()}/.nightshift/acct1.keypair`, "utf8");
const pk = keypair.match(/Private key\s*:\s*(0x[0-9a-fA-F]+)/)?.[1];
if (!rpc || !address || !pk) throw new Error("missing rpc/address/key");

const provider = new RpcProvider({ nodeUrl: rpc });
const account = new Account({ provider, address, signer: pk });

const sierra = json.parse(
  readFileSync(new URL("../target/dev/nightshift_NightshiftVault.contract_class.json", import.meta.url), "utf8"),
);
const casm = json.parse(
  readFileSync(new URL("../target/dev/nightshift_NightshiftVault.compiled_contract_class.json", import.meta.url), "utf8"),
);

console.log("declaring + deploying NightshiftVault (constructor: pool =", POOL.slice(0, 12) + "…)");
const res = await account.declareAndDeploy({
  contract: sierra,
  casm,
  constructorCalldata: [POOL],
});

console.log("class_hash:", res.declare.class_hash);
console.log("declare tx:", res.declare.transaction_hash || "(already declared)");
console.log("vault address:", res.deploy.contract_address);
console.log("deploy tx:", res.deploy.transaction_hash);
