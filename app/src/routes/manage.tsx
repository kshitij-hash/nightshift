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

import { StatusDot } from "../components/board/primitives";
import { PendingChip } from "../components/board/skeletons";
import { Masthead } from "../components/masthead";
import { usePageTitle } from "../lib/use-title";
import type { ManageTab } from "../components/wallet/surface";

const ManageSurface = lazy(() =>
  import("../components/wallet/surface").then((m) => ({ default: m.ManageSurface })),
);

/** The frame the surface arrives into. Every row the real surface opens with is
 *  here at its real height, in its real order, saying the true thing: the chip
 *  is reading the head block, the provenance line says not connected, and the
 *  two panels of the wallet section are the boxes they will be. This used to be
 *  the masthead and two unlabelled rectangles, which meant the whole page slid
 *  down by the height of the provenance line when the chunk landed. */
function ManageFallback() {
  return (
    <div className="flex min-h-screen w-full flex-col">
      <Masthead
        active="manage"
        chip={<PendingChip />}
      />
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border-hairline px-5 py-3 lg:px-10">
        <div className="flex items-center gap-3">
          <StatusDot state="pending" size={7} />
          <p className="text-[13px] leading-[1.7] text-text-default">
            not connected · everything here can be read without a wallet; connecting only adds
            signing
          </p>
        </div>
        <span className="text-[11px] leading-[1.45] text-text-caption">
          nothing on this page is sent anywhere
        </span>
      </div>
      <main className="flex flex-1 flex-col gap-8 px-5 py-8 lg:px-10">
        <section className="flex flex-col gap-6" aria-busy="true">
          <div className="border-b-2 border-divider pb-5">
            <div className="mb-2.5 text-[11px] tracking-[0.14em] uppercase text-ns-accent">
              ▸ Nothing is requested until you press connect
            </div>
            <h2 className="text-[30px] tracking-[-0.03em] lg:text-[38px]">
              My subscriptions
            </h2>
          </div>
          <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
            <div className="h-52 border border-border-panel" />
            <div className="h-52 border border-border-panel" />
          </div>
        </section>
      </main>
    </div>
  );
}

export function ManageRoute() {
  usePageTitle("Manage");
  const { tab } = useSearch({ from: "/manage" });
  const navigate = useNavigate({ from: "/manage" });
  // resetScroll: false: the tab is in-page state recorded in the URL, not a
  // different page. The router's default would throw the reader back to the
  // masthead every time they moved between subscribe, cancel and claim.
  const setTab = (next: ManageTab) =>
    void navigate({ search: { tab: next }, replace: true, resetScroll: false });

  return (
    <Suspense fallback={<ManageFallback />}>
      <ManageSurface tab={tab} onTabChange={setTab} />
    </Suspense>
  );
}
