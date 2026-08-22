// Creator ledger read: Query polls assembleCreatorLedger() + allMetrics()
// every 120s. assembleCreatorLedger degrades read-by-read (see
// src/lib/creator/ledger.ts) rather than rejecting, so a failed scan or view
// shows up as ledger.provenance.partial, not as a Query error.
import { useQuery } from "@tanstack/react-query";
import { assembleCreatorLedger, allMetrics } from "../lib/creator";
import { getRpcClient } from "../lib/rpc-instance";

const CREATOR_REFETCH_MS = 120_000;

export function useCreatorLedger(creatorIds: string[]) {
  return useQuery({
    queryKey: ["creator-ledger", [...creatorIds].sort()],
    queryFn: async () => {
      const ledger = await assembleCreatorLedger(getRpcClient(), creatorIds, {
        withTimestamps: true,
      });
      return { ledger, metrics: allMetrics(ledger) };
    },
    enabled: creatorIds.length > 0,
    refetchInterval: CREATOR_REFETCH_MS,
  });
}
