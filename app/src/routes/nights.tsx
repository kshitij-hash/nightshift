// /nights: the fan's home. Loaded on demand; it carries the signing stack.

import { lazy, Suspense } from "react";

import { Column, Display, Page } from "../components/shell/page";
import { usePageTitle } from "../lib/use-title";

const NightsSurface = lazy(() =>
  import("../components/nights/surface").then((m) => ({ default: m.NightsSurface })),
);

function NightsFallback() {
  return (
    <Page>
      <main className="flex flex-1 flex-col py-10">
        <Column narrow className="flex flex-col gap-6" aria-busy="true">
          <Display size="md">Your nights</Display>
          <div className="h-28 w-full animate-pulse bg-silhouette motion-reduce:animate-none" />
          <div className="h-28 w-full animate-pulse bg-silhouette motion-reduce:animate-none" />
        </Column>
      </main>
    </Page>
  );
}

export function NightsRoute() {
  usePageTitle("Your nights");
  return (
    <Suspense fallback={<NightsFallback />}>
      <NightsSurface />
    </Suspense>
  );
}
