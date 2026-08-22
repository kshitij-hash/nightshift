// Board read: Query polls readBoard() every 60s. readBoard() never throws
// (see src/lib/board.ts), so this hook never surfaces the RPC/snapshot
// fallback as a Query error - it surfaces as data with
// data.provenance.source, which the board page renders as a SNAPSHOT badge
// when it engages.
import { useQuery } from "@tanstack/react-query";
import { readBoard } from "../lib/board";

const BOARD_REFETCH_MS = 60_000;

export function useBoard() {
  return useQuery({
    queryKey: ["board"],
    queryFn: () => readBoard(),
    refetchInterval: BOARD_REFETCH_MS,
  });
}
