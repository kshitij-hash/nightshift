// /start: a creator sets a price and goes live. Loaded on demand.

import { lazy, Suspense } from "react";

import { Column, Display, Page } from "../components/shell/page";
import { usePageTitle } from "../lib/use-title";

const StartSurface = lazy(() =>
  import("../components/creator/start").then((m) => ({ default: m.StartSurface })),
);

function StartFallback() {
  return (
    <Page>
      <main className="flex flex-1 flex-col py-12">
        <Column className="grid gap-12 lg:grid-cols-2" aria-busy="true">
          <Display size="lg">Your fans, invisible.</Display>
          <div className="h-72 w-full animate-pulse bg-silhouette motion-reduce:animate-none" />
        </Column>
      </main>
    </Page>
  );
}

export function StartRoute() {
  usePageTitle("Start earning");
  return (
    <Suspense fallback={<StartFallback />}>
      <StartSurface />
    </Suspense>
  );
}
