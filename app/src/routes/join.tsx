// /join: a fan arrives through a creator's link.
//
// The surface is loaded on demand: it carries the signing stack, and the door,
// the receipts and the creator screens must not pay for it.

import { lazy, Suspense } from "react";
import { useSearch } from "@tanstack/react-router";

import { MaskedAvatar } from "../components/shell/avatar";
import { Column, Page } from "../components/shell/page";
import { usePageTitle } from "../lib/use-title";

const JoinSurface = lazy(() =>
  import("../components/join/surface").then((m) => ({ default: m.JoinSurface })),
);

function JoinFallback() {
  return (
    <Page>
      <main className="flex flex-1 flex-col py-10">
        <Column narrow className="flex flex-col items-center gap-5" aria-busy="true">
          <MaskedAvatar size={96} tone="rose" />
          <div className="h-8 w-48 animate-pulse bg-silhouette motion-reduce:animate-none" />
          <div className="h-4 w-64 animate-pulse bg-silhouette motion-reduce:animate-none" />
          <div className="mt-6 h-20 w-full animate-pulse bg-silhouette motion-reduce:animate-none" />
          <div className="h-20 w-full animate-pulse bg-silhouette motion-reduce:animate-none" />
        </Column>
      </main>
    </Page>
  );
}

export function JoinRoute() {
  usePageTitle("Join");
  const { creator } = useSearch({ from: "/join" });
  return (
    <Suspense fallback={<JoinFallback />}>
      <JoinSurface initialCreator={creator} />
    </Suspense>
  );
}
