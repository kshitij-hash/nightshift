// The thin adapter between the decision module and Starknet.
//
// Everything in here is I/O: four operations the server injects as one object,
// so src/decide.mjs stays a pure function of numbers and the tests never open a
// socket. `mockChain` implements the same four operations from a fixture, which
// is how the endpoint runs on a laptop with no key present.
//
//   head()                        -> bigint block number
//   schedule(commitment)          -> 8 felt strings (vault schedule_of)
//   tierAmount(creatorId, tier)   -> bigint per-period amount (vault tier_of)
//   submitCharge(commitment)      -> { txHash } after an estimate-fee dry run
//
// The private key is read once, at construction, straight from the file the
// keeper already uses. It is held in a closure, never returned, never logged,
// never placed on the config object.

import { readFileSync } from "node:fs";
import { basename } from "node:path";

const hex = (v) => `0x${BigInt(v).toString(16)}`;

/**
 * The real adapter. Imports starknet lazily so `--signer mock` runs without the
 * dependency resolving anything at module load.
 */
export async function starknetChain(config) {
  const { Account, RpcProvider } = await import("starknet");

  const address = readFileSync(config.addressFile, "utf8").trim();
  const keypair = readFileSync(config.keypairFile, "utf8");
  const pk = keypair.match(/Private key\s*:\s*(0x[0-9a-fA-F]+)/)?.[1];
  // Basename only, the way scripts/keeper.mjs names it: the full path says
  // where the operator keeps key material and belongs in no log line.
  if (!pk) throw new Error(`no private key found in ${basename(config.keypairFile)}`);

  const provider = new RpcProvider({ nodeUrl: config.rpc });
  const account = new Account({ provider, address, signer: pk });

  const view = async (entrypoint, calldata) =>
    provider.callContract({ contractAddress: config.vault, entrypoint, calldata });

  return {
    kind: "starknet",

    async head() {
      return BigInt(await provider.getBlockNumber());
    },

    async schedule(commitment) {
      return view("schedule_of", [commitment]);
    },

    async tierAmount(creatorId, tier) {
      const res = await view("tier_of", [hex(creatorId), hex(tier)]);
      return BigInt(res[1]);
    },

    /**
     * Estimate first, submit second. CLAUDE.md requires the dry run before any
     * mainnet write, and it doubles as the last correctness check: if the vault
     * would revert this call, the estimate fails and nothing is sent.
     */
    async submitCharge(commitment) {
      const call = { contractAddress: config.vault, entrypoint: "charge", calldata: [commitment] };
      const fee = await account.estimateInvokeFee(call);
      const { transaction_hash } = await account.execute(call);
      return { txHash: transaction_hash, estimatedFee: fee?.overall_fee ?? null };
    },
  };
}

/**
 * A fixture adapter for local runs and manual pokes. It answers the same four
 * calls, advances its own head block on a timer, and returns a fake tx hash.
 * It holds no key and can reach no network.
 */
export function mockChain({
  head = 13_650_000n,
  creatorId = 0x396c007ff97561b1eadf59540c71944f6ad2ccfbfc7116254f1a34d869205dfn,
  tier = 0n,
  periodBlocks = 2100n,
  startBlock = 13_649_000n,
  nPeriods = 24n,
  escrow = 24n * 10n ** 18n,
  nextPeriod = 0n,
  cancelled = false,
  amount = 10n ** 18n,
  blocksPerSecond = 1 / 1.7,
} = {}) {
  const bootMs = Date.now();
  let submits = 0;
  const state = { head, creatorId, tier, periodBlocks, startBlock, nPeriods, escrow, nextPeriod, cancelled };

  return {
    kind: "mock",
    state,

    async head() {
      const elapsedS = (Date.now() - bootMs) / 1000;
      return state.head + BigInt(Math.floor(elapsedS * blocksPerSecond));
    },

    async schedule() {
      return [
        hex(state.creatorId),
        hex(state.tier),
        hex(state.periodBlocks),
        hex(state.startBlock),
        hex(state.nPeriods),
        hex(state.escrow),
        hex(state.nextPeriod),
        state.cancelled ? "0x1" : "0x0",
      ];
    },

    async tierAmount() {
      return amount;
    },

    async submitCharge() {
      submits += 1;
      // Mirror the vault's bookkeeping so a second press behaves like mainnet.
      state.nextPeriod += 1n;
      state.escrow -= amount;
      return { txHash: `0xmock${submits.toString(16).padStart(60, "0")}`, estimatedFee: null };
    },
  };
}
