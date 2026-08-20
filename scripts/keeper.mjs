#!/usr/bin/env node
// The NIGHTSHIFT keeper: a bare `charge` invoke from Account 2 on a cron.
// This IS the unattended daemon — no prover, no pool batch, no wallet API.
// The vault's Charged event records this account as `by`, provably not the
// subscriber: that receipt is the "nobody was at a keyboard" evidence.
//
// Single-shot by design (cron provides the recurrence):
//   1. read periods_due(commitment) over public RPC
//   2. if 0, log and exit — a quiet run costs nothing
//   3. else fire charge(commitment), wait for acceptance, log the hash;
//      repeat while due, capped at MAX_CHARGES_PER_RUN per invocation
//
// Install (every 30 min; charge only fires when a period is actually due):
//   */30 * * * * cd <repo> && /usr/bin/env node scripts/keeper.mjs >> ~/.nightshift/keeper.log 2>&1
//
// Config: STARKNET_RPC from .env; operator address/key from ~/.nightshift/
// (acct2.address, acct2.keypair — never printed). Vault and commitment from
// NIGHTSHIFT_VAULT / NIGHTSHIFT_COMMITMENT in .env, or as CLI args:
//   node scripts/keeper.mjs [vault] [commitment]

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { Account, RpcProvider } from "starknet";

const MAX_CHARGES_PER_RUN = 3; // budget guard: a backlog drains slowly, not in one blast

const ts = () => new Date().toISOString();
const log = (msg) => console.log(`${ts()} keeper ${msg}`);
const die = (msg) => {
  console.error(`${ts()} keeper FATAL ${msg}`);
  process.exit(1);
};

const env = readFileSync(new URL("../.env", import.meta.url), "utf8");
const envVal = (k) => env.match(new RegExp(`^${k}=(.+)$`, "m"))?.[1]?.trim();

const rpc = envVal("STARKNET_RPC") ?? die("STARKNET_RPC missing from .env");
const vault = process.argv[2] ?? envVal("NIGHTSHIFT_VAULT") ?? die("no vault: pass as arg 1 or set NIGHTSHIFT_VAULT in .env");
const commitment = process.argv[3] ?? envVal("NIGHTSHIFT_COMMITMENT") ?? die("no commitment: pass as arg 2 or set NIGHTSHIFT_COMMITMENT in .env");

const address = readFileSync(`${homedir()}/.nightshift/acct2.address`, "utf8").trim();
const keypair = readFileSync(`${homedir()}/.nightshift/acct2.keypair`, "utf8");
const pk = keypair.match(/Private key\s*:\s*(0x[0-9a-fA-F]+)/)?.[1] ?? die("no key in acct2.keypair");

const provider = new RpcProvider({ nodeUrl: rpc });
const account = new Account({ provider, address, signer: pk });

const view = async (entrypoint) => {
  const res = await provider.callContract({ contractAddress: vault, entrypoint, calldata: [commitment] });
  return BigInt(res[0]);
};

const active = await view("is_active");
if (active === 0n) {
  log(`sub=${commitment.slice(0, 10)}… inactive (cancelled or exhausted) — nothing to do`);
  process.exit(0);
}

let due = await view("periods_due");
log(`sub=${commitment.slice(0, 10)}… due=${due}`);

let fired = 0;
while (due > 0n && fired < MAX_CHARGES_PER_RUN) {
  const { transaction_hash } = await account.execute({
    contractAddress: vault,
    entrypoint: "charge",
    calldata: [commitment],
  });
  log(`charge submitted tx=${transaction_hash}`);
  const receipt = await provider.waitForTransaction(transaction_hash);
  const status = receipt.execution_status ?? receipt.statusReceipt ?? "unknown";
  if (`${status}`.includes("REVERTED")) die(`charge REVERTED tx=${transaction_hash}`);
  fired += 1;
  due = await view("periods_due");
  log(`charge accepted tx=${transaction_hash} remaining_due=${due}`);
}

if (fired === 0) log("no charge fired (none due)");
else log(`done: ${fired} charge(s) this run, by=${address}`);
