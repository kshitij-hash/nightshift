#!/usr/bin/env node
// The NIGHTSHIFT keeper: bare `charge` invokes from Account 2 on a cron.
// This IS the unattended daemon — no prover, no pool batch, no wallet API.
// The vault's Charged event records this account as `by`, provably not the
// subscriber: that receipt is the "nobody was at a keyboard" evidence.
//
// It finds its own work. The vault publishes a Subscribed event per
// subscription, so the set of things that could ever need charging is public
// and reconstructible by anyone — which is the same property that makes
// `charge` permissionless in the first place. A keeper that had to be handed
// each commitment by hand would contradict the claim it exists to demonstrate,
// and would silently stop covering a subscription made five minutes ago.
//
// Single-shot by design (cron provides the recurrence):
//   1. scan Subscribed events for every commitment this vault has ever held
//   2. ask each one is_active, then periods_due — both plain view calls
//   3. charge the due ones, newest schedules first, capped at
//      MAX_CHARGES_PER_RUN per invocation so a backlog drains over several
//      runs instead of one gas blast
//   4. a run with nothing due costs one scan and no transaction
//
// Charging somebody else's subscription is not a bug: the vault takes a charge
// from any sender and moves escrow the subscriber already committed, to the
// creator they chose. This account pays the gas and can direct nothing.
//
// Install (every 30 min; a charge only fires when a period is actually due):
//   */30 * * * * cd <repo> && /usr/bin/env node scripts/keeper.mjs >> ~/.nightshift/keeper.log 2>&1
//
// Config: STARKNET_RPC from the environment or .env; operator address/key from
// ~/.nightshift/ (acct2.address, acct2.keypair — never printed). Vault from
// NIGHTSHIFT_VAULT. Flags and args:
//   node scripts/keeper.mjs [vault] [commitment]   one commitment, no scan
//   node scripts/keeper.mjs --dry-run              scan and report, charge nothing

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { Account, RpcProvider, hash } from "starknet";

const MAX_CHARGES_PER_RUN = 3; // budget guard: a backlog drains slowly, not in one blast
/** The v4 vault's deploy block. Scanning from genesis would be free but slow;
 *  this is the first block that could carry one of its events. Override with
 *  NIGHTSHIFT_SCAN_FROM_BLOCK when pointing the keeper at a different vault. */
const DEFAULT_SCAN_FROM_BLOCK = 13_613_300;
const CHUNK = 100;

const ts = () => new Date().toISOString();
const log = (msg) => console.log(`${ts()} keeper ${msg}`);
const die = (msg) => {
  console.error(`${ts()} keeper FATAL ${msg}`);
  process.exit(1);
};

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const positional = args.filter((a) => !a.startsWith("--"));

let fileEnv = "";
try {
  fileEnv = readFileSync(new URL("../.env", import.meta.url), "utf8");
} catch {
  /* no .env is fine when the values come from the environment */
}
const envVal = (k) =>
  process.env[k]?.trim() || fileEnv.match(new RegExp(`^${k}=(.+)$`, "m"))?.[1]?.trim();

const rpc = envVal("STARKNET_RPC") ?? die("STARKNET_RPC missing from environment and .env");
const vault =
  positional[0] ?? envVal("NIGHTSHIFT_VAULT") ?? die("no vault: pass as arg 1 or set NIGHTSHIFT_VAULT");
/** A commitment given explicitly turns the scan off: targeted mode, for
 *  testing one subscription without waiting on discovery. */
const only = positional[1] ?? null;
const scanFrom = Number(envVal("NIGHTSHIFT_SCAN_FROM_BLOCK") ?? DEFAULT_SCAN_FROM_BLOCK);

const provider = new RpcProvider({ nodeUrl: rpc });

const short = (c) => `${c.slice(0, 10)}…`;

/** Every commitment this vault has ever recorded, from its own event log.
 *  keys[0] is the Subscribed selector and keys[1] is the commitment, so the
 *  node does the filtering and this only pages through what matched. */
async function discoverCommitments() {
  const selector = hash.getSelectorFromName("Subscribed");
  const seen = new Map(); // commitment -> block it was created at
  let token;
  let pages = 0;
  do {
    const page = await provider.getEvents({
      address: vault,
      keys: [[selector]],
      from_block: { block_number: scanFrom },
      to_block: "latest",
      chunk_size: CHUNK,
      continuation_token: token,
    });
    for (const ev of page.events ?? []) {
      const commitment = ev.keys?.[1];
      if (!commitment) continue;
      const key = BigInt(commitment).toString();
      if (!seen.has(key)) seen.set(key, { commitment, block: ev.block_number ?? 0 });
    }
    token = page.continuation_token;
    pages += 1;
  } while (token);
  log(`scan: ${seen.size} subscription(s) ever created at this vault, ${pages} page(s)`);
  // Newest first: a subscription made minutes ago is the one most likely to be
  // watched right now, and the per-run cap should spend itself there first.
  return [...seen.values()].sort((a, b) => b.block - a.block).map((v) => v.commitment);
}

const view = async (entrypoint, commitment) => {
  const res = await provider.callContract({ contractAddress: vault, entrypoint, calldata: [commitment] });
  return BigInt(res[0]);
};

/* NIGHTSHIFT_COMMITMENT used to be how this script was told what to charge.
   Honouring it now would reintroduce the exact failure discovery exists to
   remove - a keeper pinned to one subscription, silently ignoring every one
   made after it. It is announced and ignored rather than quietly dropped. */
if (!only && envVal("NIGHTSHIFT_COMMITMENT")) {
  log("note: NIGHTSHIFT_COMMITMENT is set but no longer used — every subscription is discovered from the chain");
}

const commitments = only ? [only] : await discoverCommitments();
if (commitments.length === 0) {
  log("no subscription has ever been created at this vault — nothing to do");
  process.exit(0);
}

/** Read-only pass first, so a run with nothing due never touches a key. */
const work = [];
for (const commitment of commitments) {
  let activeFlag;
  try {
    activeFlag = await view("is_active", commitment);
  } catch (e) {
    log(`sub=${short(commitment)} unreadable, skipped: ${e.message}`);
    continue;
  }
  if (activeFlag === 0n) continue;
  const due = await view("periods_due", commitment);
  if (due > 0n) work.push({ commitment, due });
  else log(`sub=${short(commitment)} active, nothing due yet`);
}

if (work.length === 0) {
  log("no charge fired (none due)");
  process.exit(0);
}

log(`due now: ${work.map((w) => `${short(w.commitment)}=${w.due}`).join(" ")}`);

if (dryRun) {
  log(`dry run: would fire up to ${MAX_CHARGES_PER_RUN} charge(s); nothing submitted`);
  process.exit(0);
}

/* Key material is read only once there is a charge to fire, so a quiet run
   and a dry run never open the keypair at all. */
const address = readFileSync(`${homedir()}/.nightshift/acct2.address`, "utf8").trim();
const keypair = readFileSync(`${homedir()}/.nightshift/acct2.keypair`, "utf8");
const pk = keypair.match(/Private key\s*:\s*(0x[0-9a-fA-F]+)/)?.[1] ?? die("no key in acct2.keypair");
const account = new Account({ provider, address, signer: pk });

let fired = 0;
for (const item of work) {
  let due = item.due;
  while (due > 0n && fired < MAX_CHARGES_PER_RUN) {
    const call = { contractAddress: vault, entrypoint: "charge", calldata: [item.commitment] };

    let fee;
    try {
      fee = await account.estimateInvokeFee(call);
    } catch (e) {
      // One subscription the vault would reject must not stop the others: log
      // it, drop it, and let the run carry on to the next.
      log(`sub=${short(item.commitment)} fee estimate failed, skipped: ${e.message}`);
      break;
    }
    log(`sub=${short(item.commitment)} charge estimated overall_fee=${fee.overall_fee ?? "unknown"}`);

    const { transaction_hash } = await account.execute(call);
    log(`sub=${short(item.commitment)} charge submitted tx=${transaction_hash}`);
    const receipt = await provider.waitForTransaction(transaction_hash);
    const status = receipt.execution_status ?? receipt.statusReceipt ?? "unknown";
    if (`${status}`.includes("REVERTED")) die(`charge REVERTED tx=${transaction_hash}`);
    fired += 1;
    due = await view("periods_due", item.commitment);
    log(`sub=${short(item.commitment)} charge accepted tx=${transaction_hash} remaining_due=${due}`);
  }
  if (fired >= MAX_CHARGES_PER_RUN) {
    log(`per-run cap reached (${MAX_CHARGES_PER_RUN}); the rest drains on the next run`);
    break;
  }
}

log(`done: ${fired} charge(s) this run, by=${address}`);
