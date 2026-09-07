// /room: the creator's home. Loaded on demand.

import { lazy, Suspense } from "react";

import { Column, Display, Page } from "../components/shell/page";
import { usePageTitle } from "../lib/use-title";

const RoomSurface = lazy(() =>
  import("../components/creator/room").then((m) => ({ default: m.RoomSurface })),
);

function RoomFallback() {
  return (
    <Page>
      <main className="flex flex-1 flex-col py-12">
        <Column className="flex flex-col gap-8" aria-busy="true">
          <Display size="lg">Your room</Display>
          <div className="grid gap-5 lg:grid-cols-3">
            <div className="h-32 animate-pulse bg-silhouette motion-reduce:animate-none" />
            <div className="h-32 animate-pulse bg-silhouette motion-reduce:animate-none" />
            <div className="h-32 animate-pulse bg-silhouette motion-reduce:animate-none" />
          </div>
        </Column>
      </main>
    </Page>
  );
}

export function RoomRoute() {
  usePageTitle("Your room");
  return (
    <Suspense fallback={<RoomFallback />}>
      <RoomSurface />
    </Suspense>
  );
}
