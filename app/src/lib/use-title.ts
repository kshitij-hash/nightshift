// Per-route document titles, so history entries and shared tabs name the page
// they hold instead of all reading alike.

import { useEffect } from "react";

const SITE = "NIGHTSHIFT";
/** The door keeps the full title from index.html. */
const DEFAULT = `${SITE} · Back anyone. Show no one.`;

export function usePageTitle(page?: string) {
  useEffect(() => {
    document.title = page === undefined ? DEFAULT : `${page} · ${SITE}`;
    return () => {
      document.title = DEFAULT;
    };
  }, [page]);
}
