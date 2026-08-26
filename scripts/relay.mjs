#!/usr/bin/env node
// The NIGHTSHIFT relay: submits a signature-gated vault call from Account 2.
//
// `cancel` and `reclaim` are authorized purely by a STARK signature from the
// subscription's owner key over a domain-separated Poseidon message (see
// src/common.cairo: cancel_message, reclaim_message). The vault checks that
// signature and nothing else about the sender, so both calls are SUBMITTER-
// AGNOSTIC: whoever pays the gas is irrelevant to authorization. That is what
// this script exists for. A subscriber who self-submits a cancel writes their
// own wallet into the transaction as sender, which is the one linkage the
// owner-key design avoids. Handing the signed payload to this relay instead
// costs the subscriber nothing and puts Account 2 in the sender field. The
// relay cannot tamper: any edit to the commitment or the destination breaks
// the signature, so the worst it can do is decline to submit.
//
// The app's cancel/reclaim flow on /manage prints the exact command to run:
//   node scripts/relay.mjs cancel  <commitment> <sig_r> <sig_s>
//   node scripts/relay.mjs reclaim <commitment> <to_address> <sig_r> <sig_s>
//
// Both verbs are pre-flighted against the vault's schedule_of view, so a
// payload the vault would reject fails here before it costs the relay gas.
//
// Config: STARKNET_RPC and NIGHTSHIFT_VAULT from .env; relay address and key
// from ~/.nightshift/ (acct2.address, acct2.keypair, never printed).
//
// Exit codes: 0 accepted on chain, 1 refused or fatal, 2 usage error.

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { Account, RpcProvider } from "starknet";

const ts = () => new Date().toISOString();
const log = (msg) => console.log(`${ts()} relay ${msg}`);
const die = (msg) => {
  console.error(`${ts()} relay FATAL ${msg}`);
  process.exit(1);
};
const refuse = (msg) => {
  console.error(`${ts()} relay REFUSED ${msg}`);
  process.exit(1);
};
const USAGE = [
  "usage:",
  "  node scripts/relay.mjs cancel  <commitment> <sig_r> <sig_s>",
  "  node scripts/relay.mjs reclaim <commitment> <to_address> <sig_r> <sig_s>",
  "",
  "every argument is a 0x-hex felt. The signature comes from the subscriber's",
  "owner key (the app's cancel flow prints the whole line); this account only pays.",
].join("\n");
const usage = (msg) => {
  console.error(`${ts()} relay USAGE ${msg}`);
  console.error(USAGE);
  process.exit(2);
};

const FELT = /^0x[0-9a-fA-F]{1,64}$/;
const felt = (v, name) => {
  if (typeof v !== "string" || !FELT.test(v)) usage(`${name} must be a 0x-hex felt, got ${JSON.stringify(v)}`);
  return v;
};

// --- arguments --------------------------------------------------------------

const [, , verb, ...rest] = process.argv;
if (!verb) usage("no subcommand");
if (verb !== "cancel" && verb !== "reclaim") usage(`unknown subcommand ${JSON.stringify(verb)}`);

const arity = verb === "cancel" ? 3 : 4;
if (rest.length !== arity) usage(`${verb} takes ${arity} arguments, got ${rest.length}`);

const commitment = felt(rest[0], "commitment");
const to = verb === "reclaim" ? felt(rest[1], "to_address") : null;
const sigR = felt(rest[arity - 2], "sig_r");
const sigS = felt(rest[arity - 1], "sig_s");
if (verb === "reclaim" && BigInt(to) === 0n) usage("to_address must not be zero");

const calldata = verb === "cancel" ? [commitment, sigR, sigS] : [commitment, to, sigR, sigS];

// --- config and keys (never printed) ---------------------------------------

const env = readFileSync(new URL("../.env", import.meta.url), "utf8");
const envVal = (k) => env.match(new RegExp(`^${k}=(.+)$`, "m"))?.[1]?.trim();

const rpc = envVal("STARKNET_RPC") ?? die("STARKNET_RPC missing from .env");
const vault = envVal("NIGHTSHIFT_VAULT") ?? die("NIGHTSHIFT_VAULT missing from .env");

const address = readFileSync(`${homedir()}/.nightshift/acct2.address`, "utf8").trim();
const keypair = readFileSync(`${homedir()}/.nightshift/acct2.keypair`, "utf8");
const pk = keypair.match(/Private key\s*:\s*(0x[0-9a-fA-F]+)/)?.[1] ?? die("no key in acct2.keypair");

const provider = new RpcProvider({ nodeUrl: rpc });
const account = new Account({ provider, address, signer: pk });

// --- pre-flight: read the schedule before spending anything -----------------
// The vault reverts on an unknown subscription (NS_UNKNOWN_SUB) and on a
// reclaim against a live one (NS_CANCELLED). A revert still costs the relay
// gas, so refuse first. schedule_of is a read; nothing is submitted here.

let sched;
try {
  const res = await provider.callContract({
    contractAddress: vault, entrypoint: "schedule_of", calldata: [commitment],
  });
  sched = res.map(BigInt);
} catch (e) {
  die(`schedule_of read failed: ${e.message}`);
}

const [creatorId, , , , , escrow, , cancelled] = sched;
const short = `${commitment.slice(0, 10)}…`;

if (creatorId === 0n) {
  refuse(`unknown subscription ${short}: no schedule at vault ${vault.slice(0, 10)}…, nothing to ${verb}`);
}
if (verb === "cancel" && cancelled === 1n) {
  refuse(`sub=${short} is already cancelled, so this cancel would change nothing`);
}
if (verb === "reclaim") {
  if (cancelled !== 1n) {
    refuse(`sub=${short} is not cancelled: reclaim requires a cancelled subscription, so relay the cancel first`);
  }
  if (escrow === 0n) {
    refuse(`sub=${short} has zero escrow left, nothing to reclaim`);
  }
}

log(`sub=${short} cancelled=${cancelled === 1n} escrow=${escrow} pre-flight ok`);

// --- estimate, then execute -------------------------------------------------

const call = { contractAddress: vault, entrypoint: verb, calldata };

let fee;
try {
  fee = await account.estimateInvokeFee(call);
} catch (e) {
  die(`${verb} fee estimate failed, the vault would reject this payload: ${e.message}`);
}
log(`${verb} estimated overall_fee=${fee.overall_fee ?? "unknown"}, relaying from ${address.slice(0, 10)}…`);

const { transaction_hash } = await account.execute(call).catch((e) => die(`${verb} submit failed: ${e.message}`));
log(`${verb} submitted tx=${transaction_hash}`);

const receipt = await provider.waitForTransaction(transaction_hash);
const status = receipt.execution_status ?? receipt.statusReceipt ?? "unknown";
if (`${status}`.includes("REVERTED")) die(`${verb} REVERTED tx=${transaction_hash}`);

log(`${verb} accepted tx=${transaction_hash} sub=${short} sender=${address}`);
log(`voyager: https://voyager.online/tx/${transaction_hash}`);
log("the subscriber's wallet appears nowhere in this transaction, only their signature does");
