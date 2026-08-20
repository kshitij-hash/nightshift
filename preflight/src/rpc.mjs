// RPC half of the checker: fetch each listed transaction and its receipt, then
// hand both to the pure verdict function. Nothing here decides pass or fail.

import { declaredFelts, transactionVerdict } from "./verdict.mjs";

/** Host of the RPC URL, for printing. The full URL often carries an API key, so it is never printed. */
export function rpcHost(url) {
  try {
    return new URL(url).host;
  } catch {
    return "(unparseable RPC URL)";
  }
}

async function defaultProviderFactory(nodeUrl) {
  let starknet;
  try {
    starknet = await import("starknet");
  } catch (e) {
    const err = new Error(
      `the starknet package could not be loaded (${e.message}). ` +
        "Install it, or re-run with --offline to skip the RPC checks.",
    );
    err.setup = true;
    throw err;
  }
  return new starknet.RpcProvider({ nodeUrl });
}

/**
 * Check every hash against the node, in order.
 *
 * @param {{rpcUrl: string, hashes: string[], contracts: Array<string|{address:string}>,
 *          providerFactory?: (url:string) => Promise<object>}} options
 * @returns {Promise<Array<{hash:string, pass:boolean, code:string, reason:string|null, mineRule:boolean}>>}
 */
export async function verifyTransactions({ rpcUrl, hashes, contracts, providerFactory }) {
  const declared = declaredFelts(contracts);
  const provider = await (providerFactory ?? defaultProviderFactory)(rpcUrl);
  const results = [];

  for (const hash of hashes) {
    try {
      const [receipt, tx] = await Promise.all([
        provider.getTransactionReceipt(hash),
        provider.getTransaction(hash),
      ]);
      results.push({ hash, ...transactionVerdict(receipt, tx, declared) });
    } catch (e) {
      results.push({
        hash,
        pass: false,
        code: "rpc_error",
        reason: `RPC error: ${e.message}`,
        mineRule: false,
      });
    }
  }

  return results;
}
