// One shared RpcClient for the whole app. Sharing it (rather than one per
// hook) means the "which endpoint answered last" state in rpc/client.ts is
// shared too, so a board poll and a creator-ledger poll converge on the same
// healthy endpoint instead of re-discovering it independently.
import { createRpcClient } from "./rpc/client";
import type { RpcClient } from "./rpc/client";

let instance: RpcClient | null = null;

export function getRpcClient(): RpcClient {
  if (!instance) instance = createRpcClient();
  return instance;
}
