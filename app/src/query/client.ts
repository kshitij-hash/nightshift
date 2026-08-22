// Query sits ABOVE the lib (src/lib/**), with a strict division of labor:
//
//   lib   owns transport, endpoint failover, pagination, felt decoding, and
//         the committed-snapshot fallback. A lib read never rejects with a
//         "the chain is unreachable" error the UI has to render as a broken
//         page; it degrades to snapshot data (board) or partial data with a
//         provenance note (creator ledger).
//   Query owns caching, request dedup, refetch intervals, and
//         stale-while-revalidate.
//
// Because the lib already retries and fails over internally, Query must
// never retry around it: retry: false everywhere. Retrying here would
// re-run the lib's own multi-endpoint failover loop N more times, turning
// one slow read into N+1 slow reads for no benefit. refetchOnWindowFocus is
// off because the board and dashboard already poll on fixed intervals
// (60s / 120s); a focus-triggered extra fetch just doubles load on public
// RPC endpoints without changing what the user sees between ticks.
import { QueryClient } from "@tanstack/react-query";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
    },
  },
});
