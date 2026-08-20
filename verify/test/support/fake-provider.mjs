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
 * The four vault views verifyPresentation reads, with the shapes the real
 * contract returns: is_active a bool, periods_due a u32, owner_key_of a felt,
 * schedule_of the eight-felt tuple whose first two entries are creator_id and
 * tier.
 *
 * @param {{active?: boolean, due?: number, ownerKey?: string|bigint,
 *          creatorId?: string|bigint, tier?: number}} state
 */
export function vaultStubs({
  active = true,
  due = 0,
  ownerKey = "0x1",
  creatorId = "0xc0ffee",
  tier = 2,
} = {}) {
  return {
    is_active: [active ? "0x1" : "0x0"],
    periods_due: [felt(due)],
    owner_key_of: [felt(ownerKey)],
    schedule_of: [
      felt(creatorId),
      felt(tier),
      felt(2100),
      felt(499_000),
      felt(12),
      felt(1_000_000_000n),
      felt(3),
      "0x0",
    ],
  };
}
