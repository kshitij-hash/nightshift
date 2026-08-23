// The /manage route.
//
// Loaded on demand, for the same reason /verify is: this surface pulls in
// starknet.js and the get-starknet discovery store, and the board and the
// creator dashboard must not pay for a wallet stack they never use. Navigating
// here fetches one extra chunk; landing on any other page fetches none of it.
//
// This route gates nothing. The board, the dashboard and verify never import
// it and never wait on it.

import { lazy, Suspense } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";

import { Masthead } from "../components/masthead";
import type { ManageTab } from "../components/wallet/surface";

const ManageSurface = lazy(() =>
  import("../components/wallet/surface").then((m) => ({ default: m.ManageSurface })),
);

/** The frame the surface arrives into, mirroring the real layout so the page
 *  does not jump when the chunk lands. */
function ManageFallback() {
  return (
    <div className="mx-auto flex w-full max-w-[1200px] flex-col">
      <Masthead active="manage" />
      <main className="flex flex-1 flex-col gap-8 px-5 py-8 lg:px-14">
        <div className="h-14 border border-border-panel" />
        <div className="h-56 border border-border-panel" />
      </main>
    </div>
  );
}

export function ManageRoute() {
  const { tab } = useSearch({ from: "/manage" });
  const navigate = useNavigate({ from: "/manage" });
  const setTab = (next: ManageTab) =>
    void navigate({ search: { tab: next }, replace: true });

  return (
    <Suspense fallback={<ManageFallback />}>
      <ManageSurface tab={tab} onTabChange={setTab} />
    </Suspense>
  );
}
