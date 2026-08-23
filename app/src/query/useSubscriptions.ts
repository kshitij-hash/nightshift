// The /manage read, in two cached hooks with the division of labor this app
// uses everywhere: src/lib owns transport, scanning, decoding and degradation;
// Query owns caching, dedup and the refetch interval, and never retries around
// the lib (the RPC client already fails over across endpoints, so retry stays
// false).
//
// Two hooks rather than one, because the two halves have different lifetimes.
// The vault's creator list changes only when someone registers, so it is worth
// its own cache key and a long interval; the subscriptions behind it move every
// time a charge lands. Splitting them also means the expensive half, the
// CreatorRegistered scan, runs once per session and is shared by every card.
//
// Both stay disabled until a wallet is connected: the derivation needs the
// stored master secret, and nothing on this page reads it before a deliberate
// connect.

import { useQuery } from "@tanstack/react-query";

import { getRpcClient } from "../lib/rpc-instance";
import { readSubscriptions, readVaultCreators } from "../lib/subscriptions";
import type { Candidate } from "../lib/subscriptions";

/** Creator registrations are rare. Re-scanning them on the board's 60s clock
 *  would be one full event scan a minute for a list that changes in a day. */
const CREATORS_REFETCH_MS = 600_000;
/** A charge lands at most once a period, and the shortest period on the ladder
 *  is about an hour, but escrow and next-period move together and a reader
 *  watching a countdown should not have to reload to see them settle. */
const SUBSCRIPTIONS_REFETCH_MS = 60_000;

export function useVaultCreators(enabled: boolean) {
  return useQuery({
    queryKey: ["vault-creators"],
    queryFn: () => readVaultCreators(getRpcClient()),
    refetchInterval: CREATORS_REFETCH_MS,
    enabled,
  });
}

/** Pass the candidates derived in the browser. The key is the commitment list,
 *  so two different wallets on one machine do not share a cache entry. */
export function useSubscriptions(candidates: Candidate[] | null) {
  return useQuery({
    queryKey: ["subscriptions", (candidates ?? []).map((c) => c.commitment).sort()],
    queryFn: () => readSubscriptions(getRpcClient(), candidates ?? []),
    refetchInterval: SUBSCRIPTIONS_REFETCH_MS,
    enabled: candidates !== null && candidates.length > 0,
  });
}
