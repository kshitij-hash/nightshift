// A provider stand-in. Every test in this package runs against it, so the suite
// touches no network and needs no node: verifyPresentation only ever asks a
// provider for getBlockNumber() and callContract({contractAddress, entrypoint,
// calldata}), and this answers both from a table.

/**
 * @param {{blockNumber?: number|Error, vault?: Record<string, string[]|Function|Error>}} options
 * @returns {{getBlockNumber: Function, callContract: Function, calls: object[]}}
 */
export function fakeProvider({ blockNumber = 500_000, vault = {} } = {}) {
  const calls = [];
  return {
    calls,
    async getBlockNumber() {
      if (blockNumber instanceof Error) throw blockNumber;
      return blockNumber;
    },
    async callContract({ contractAddress, entrypoint, calldata }) {
      calls.push({ contractAddress, entrypoint, calldata });
      const stub = vault[entrypoint];
      if (stub === undefined) throw new Error(`fake vault has no stub for ${entrypoint}`);
      const value = typeof stub === "function" ? stub(calldata) : stub;
      if (value instanceof Error) throw value;
      return value;
    },
  };
}

const felt = (v) => `0x${BigInt(v).toString(16)}`;

/**
 * The two vault views verifyPresentation reads, with the shapes the real
 * contract returns: owner_key_of a felt, schedule_of the eight-felt tuple
 * (creator_id, tier, period_blocks, start_block, n_periods, escrow,
 * next_period, cancelled). The entitlement rule derives from the schedule
 * alone, exactly as the on-chain gate does it: with the defaults below
 * (start 499_000, pb 2100, next 3) the paid window covers blocks
 * [499_000, 505_300), so the default test block 500_000 sits inside it.
 *
 * @param {{ownerKey?: string|bigint, creatorId?: string|bigint, tier?: number,
 *          periodBlocks?: number, startBlock?: number, nPeriods?: number,
 *          nextPeriod?: number, cancelled?: boolean}} state
 */
export function vaultStubs({
  ownerKey = "0x1",
  creatorId = "0xc0ffee",
  tier = 2,
  periodBlocks = 2100,
  startBlock = 499_000,
  nPeriods = 12,
  nextPeriod = 3,
  cancelled = false,
} = {}) {
  return {
    owner_key_of: [felt(ownerKey)],
    schedule_of: [
      felt(creatorId),
      felt(tier),
      felt(periodBlocks),
      felt(startBlock),
      felt(nPeriods),
      felt(1_000_000_000n),
      felt(nextPeriod),
      cancelled ? "0x1" : "0x0",
    ],
  };
}
