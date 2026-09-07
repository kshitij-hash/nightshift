// Check one receipt. Paste a transaction hash; get four plain answers.
//
// Reads only: the receipt, the schedule the charge belongs to, and the price
// the creator published. Nothing here needs a wallet or a key.

import { VAULT } from "../config";
import { getRpcClient } from "./rpc-instance";
import { scheduleOf, tierOf } from "./rpc/views";
import { EVENT, feltEq } from "./selectors";

export type ReceiptVerdict =
  | { status: "not-found"; txHash: string }
  | { status: "not-a-charge"; txHash: string }
  | { status: "error"; txHash: string; message: string }
  | {
      status: "checked";
      txHash: string;
      block: number;
      commitment: string;
      periodIndex: number;
      amountWei: bigint;
      creatorId: string | null;
      tier: number | null;
      /** Landed inside the period it was due for: never early, never a period late. */
      onTime: boolean | null;
      /** How many blocks after the window opened it landed. */
      lagBlocks: number | null;
      /** The amount matches the price the creator published for this tier. */
      exactPrice: boolean | null;
      priceWei: bigint | null;
    };

type RawReceipt = {
  block_number?: number;
  execution_status?: string;
  events?: Array<{ from_address: string; keys: string[]; data: string[] }>;
};

const FELT = /^0x[0-9a-fA-F]{1,64}$/;

export async function checkReceipt(raw: string): Promise<ReceiptVerdict> {
  const txHash = raw.trim();
  if (!FELT.test(txHash)) return { status: "not-found", txHash };
  const client = getRpcClient();
  let receipt: RawReceipt;
  try {
    receipt = await client.call<RawReceipt>("starknet_getTransactionReceipt", [txHash]);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (/TXN_HASH_NOT_FOUND|not found|29/i.test(message)) return { status: "not-found", txHash };
    return { status: "error", txHash, message };
  }
  const charged = (receipt.events ?? []).find(
    (e) => feltEq(e.from_address, VAULT) && e.keys[0] !== undefined && feltEq(e.keys[0], EVENT.Charged),
  );
  if (!charged || receipt.block_number === undefined) return { status: "not-a-charge", txHash };

  const commitment = charged.keys[1] ?? "0x0";
  const periodIndex = Number(BigInt(charged.data[0] ?? "0x0"));
  const amountWei = BigInt(charged.data[1] ?? "0x0");
  const block = receipt.block_number;

  let creatorId: string | null = null;
  let tier: number | null = null;
  let onTime: boolean | null = null;
  let lagBlocks: number | null = null;
  let exactPrice: boolean | null = null;
  let priceWei: bigint | null = null;
  try {
    const s = await scheduleOf(client, commitment);
    if (s !== null) {
      creatorId = s.creatorId;
      tier = s.tier;
      const due = s.startBlock + periodIndex * s.periodBlocks;
      lagBlocks = block - due;
      onTime = block >= due && block < due + s.periodBlocks;
      try {
        const t = await tierOf(client, s.creatorId, s.tier);
        priceWei = t.amountWei;
        exactPrice = t.amountWei === amountWei;
      } catch {
        // the price could not be read; the answer stays unknown rather than invented
      }
    }
  } catch {
    // the schedule could not be read; the checks that need it stay unknown
  }
  return {
    status: "checked",
    txHash,
    block,
    commitment,
    periodIndex,
    amountWei,
    creatorId,
    tier,
    onTime,
    lagBlocks,
    exactPrice,
    priceWei,
  };
}
