// Per-route document titles, so history entries and shared tabs name the page
// they hold instead of all reading alike.

import { useEffect } from "react";

const SITE = "NIGHTSHIFT";
/** The landing keeps the full descriptive title from index.html. */
const DEFAULT = `${SITE} · private subscriptions on Starknet`;

export function usePageTitle(page?: string) {
  useEffect(() => {
    document.title = page === undefined ? DEFAULT : `${page} · ${SITE}`;
    return () => {
      document.title = DEFAULT;
    };
  }, [page]);
}
