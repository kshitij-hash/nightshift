// Board read: Query polls readBoard() every 60s. readBoard() never throws
// (see src/lib/board.ts), so this hook never surfaces the RPC/snapshot
// fallback as a Query error - it surfaces as data with
// data.provenance.source, which the board page renders as a SNAPSHOT badge
// when it engages.
//
// Two cache layers make a reload cheap: lib/board's scan cache means the
// fresh read fetches only the blocks since the last one, and the persisted
// last state below paints immediately as placeholder data while that read
// runs. The placeholder is the truth as of the previous successful read,
// which the refetch then advances.
import { useQuery } from "@tanstack/react-query";
import { loadPersistedBoard, readBoard, savePersistedBoard } from "../lib/board";

const BOARD_REFETCH_MS = 60_000;

export function useBoard() {
  return useQuery({
    queryKey: ["board"],
    queryFn: async () => {
      const state = await readBoard();
      savePersistedBoard(state);
      return state;
    },
    placeholderData: () => loadPersistedBoard() ?? undefined,
    refetchInterval: BOARD_REFETCH_MS,
  });
}
