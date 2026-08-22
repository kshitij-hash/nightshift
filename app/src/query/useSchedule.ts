// Schedule read for the heartbeat instrument. Same division of labor as
// useBoard: readSchedule() owns transport and decoding and never throws, this
// hook owns caching and the 60s refetch interval, and retry stays false
// because the client below already fails over across endpoints.
import { useQuery } from "@tanstack/react-query";

import { readSchedule } from "../lib/schedule";

const SCHEDULE_REFETCH_MS = 60_000;

/** Pass null while the board read has not named a commitment yet; the query
 *  stays disabled until it does. */
export function useSchedule(commitment: string | null) {
  return useQuery({
    queryKey: ["schedule", commitment],
    queryFn: () => readSchedule(commitment as string),
    refetchInterval: SCHEDULE_REFETCH_MS,
    enabled: commitment !== null,
  });
}
