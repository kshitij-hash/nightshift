// /unlock: a door asked for proof. Loaded on demand; it signs.

import { lazy, Suspense } from "react";
import { useSearch } from "@tanstack/react-router";

import { LockedAvatar } from "../components/shell/avatar";
import { Column, Page } from "../components/shell/page";
import { usePageTitle } from "../lib/use-title";

const UnlockSurface = lazy(() =>
  import("../components/unlock/surface").then((m) => ({ default: m.UnlockSurface })),
);

function UnlockFallback() {
  return (
    <Page>
      <main className="flex flex-1 flex-col py-10">
        <Column narrow className="flex flex-col items-center gap-5" aria-busy="true">
          <LockedAvatar size={104} />
          <div className="h-8 w-56 animate-pulse bg-silhouette motion-reduce:animate-none" />
          <div className="mt-4 h-32 w-full animate-pulse bg-silhouette motion-reduce:animate-none" />
        </Column>
      </main>
    </Page>
  );
}

export function UnlockRoute() {
  usePageTitle("Unlock");
  const { c } = useSearch({ from: "/unlock" });
  return (
    <Suspense fallback={<UnlockFallback />}>
      <UnlockSurface initialChallenge={c} />
    </Suspense>
  );
}
