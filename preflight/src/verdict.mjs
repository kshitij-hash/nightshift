// Per-transaction verdict, as a pure function of (receipt, tx, declaredContracts).
//
// This is the half of the checker that decides whether a listed transaction
// actually counts. It touches no network and no globals, so the RPC path and
// the unit tests run the exact same logic.
//
// The rule it encodes (the "mine-rule"): a transaction counts when it SUCCEEDED
// and, if the entry declares any contracts, when it also ran through one of them
// (an event emitted by a declared contract, or a declared address appearing as a
// felt in the transaction calldata). Addresses are compared as BigInt so that
// 0x0-padding differences do not matter.

/** Longest form of a Starknet felt written as hex. */
export const FELT_RE = /^0x[0-9a-fA-F]{1,64}$/;

/** BigInt(value) or null when value is not felt-shaped. */
export function toFelt(value) {
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "bigint") return null;
  try {
    return BigInt(value);
  } catch {
    return null;
  }
}

/**
 * Normalize a contracts array (strings or { address } objects) to BigInt felts.
 * Entries without a usable address are dropped, the same way the indexer drops them.
 */
export function declaredFelts(contracts) {
  if (!Array.isArray(contracts)) return [];
  return contracts
    .map((c) => (typeof c === "string" ? c : c && typeof c === "object" ? c.address : null))
    .map(toFelt)
    .filter((f) => f !== null);
}

/**
 * starknet.js has shipped receipts both bare and wrapped in a response object.
 * Unwrap one level of `.value` so fixtures and live responses look the same.
 */
export function unwrapReceipt(receipt) {
  if (receipt && typeof receipt === "object" && receipt.value && typeof receipt.value === "object") {
    return receipt.value;
  }
  return receipt;
}

/**
 * Decide whether one listed transaction counts.
 *
 * @param {object|null} receipt  transaction receipt from the RPC node
 * @param {object|null} tx       transaction body from the RPC node
 * @param {Array<string|{address:string}>|Array<bigint>} declaredContracts
 * @returns {{pass: boolean, code: string, reason: string|null, mineRule: boolean}}
 */
export function transactionVerdict(receipt, tx, declaredContracts) {
  const declared = Array.isArray(declaredContracts) && declaredContracts.every((c) => typeof c === "bigint")
    ? declaredContracts
    : declaredFelts(declaredContracts);

  const r = unwrapReceipt(receipt);

  if (!r || typeof r !== "object") {
    return {
      pass: false,
      code: "no_receipt",
      reason: "the RPC node returned no receipt, so the indexer sees nothing to count",
      mineRule: false,
    };
  }

  const status = r.execution_status;
  if (status !== "SUCCEEDED") {
    const revert = typeof r.revert_reason === "string" && r.revert_reason.trim()
      ? `: ${firstLine(r.revert_reason)}`
      : "";
    return {
      pass: false,
      code: "not_succeeded",
      reason: `execution_status=${status === undefined ? "absent" : status}${revert}`,
      mineRule: false,
    };
  }

  if (declared.length === 0) {
    return { pass: true, code: "succeeded", reason: null, mineRule: false };
  }

  const inDeclared = (value) => {
    const felt = toFelt(value);
    return felt !== null && declared.some((d) => d === felt);
  };

  const events = Array.isArray(r.events) ? r.events : [];
  const eventHit = events.some((ev) => ev && inDeclared(ev.from_address));

  const calldata = Array.isArray(tx?.calldata) ? tx.calldata : [];
  const calldataHit = calldata.some(inDeclared);

  if (eventHit || calldataHit) {
    return {
      pass: true,
      code: eventHit ? "routed_event" : "routed_calldata",
      reason: null,
      mineRule: false,
    };
  }

  return {
    pass: false,
    code: "not_routed",
    reason:
      "succeeded, but no event from a declared contract and no declared address in the calldata. " +
      "The mine-rule is why this does not count: once contracts are declared, only transactions " +
      "routed through one of them are counted for the entry.",
    mineRule: true,
  };
}

function firstLine(text) {
  const line = String(text).split("\n").find((l) => l.trim());
  return line ? line.trim().slice(0, 200) : "";
}
