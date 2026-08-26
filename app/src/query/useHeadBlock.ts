// The masthead's head-block readout: one starknet_blockNumber call on the
// shared client, refreshed every 60s. Deliberately independent of useBoard,
// which scans events and is far heavier; every page shows the head, only the
// board pays for a full read.
import { useQuery } from "@tanstack/react-query";

import { getRpcClient } from "../lib/rpc-instance";

export function useHeadBlock() {
  return useQuery({
    queryKey: ["headBlock"],
    queryFn: async () => {
      const n = await getRpcClient().call<number>("starknet_blockNumber", []);
      return Number(n);
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
    retry: 1,
  });
}
