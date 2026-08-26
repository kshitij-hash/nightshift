// The /subscribe route.
//
// The wizard is loaded on demand for the same reason /manage and /verify are:
// its surface pulls in starknet.js (poseidon, the STARK curve) and the wallet
// bridge, and the landing, the board and the creator ledger must not pay for
// a signing stack they never use. Navigating here fetches one extra chunk.

import { lazy, Suspense } from "react";

import { Masthead } from "../components/masthead";
import { usePageTitle } from "../lib/use-title";

const SubscribeSurface = lazy(() =>
  import("../components/subscribe/surface").then((m) => ({ default: m.SubscribeSurface })),
);

/** The frame the surface arrives into: the masthead and the step header at
 *  their real heights, so nothing jumps when the chunk lands. */
function SubscribeFallback() {
  return (
    <div className="flex min-h-screen flex-col">
      <Masthead active="subscribe" />
      <main className="flex-1 px-5 py-9 lg:px-10">
        <div className="border-b-2 border-divider pb-5">
          <div className="mb-2.5 text-[11px] tracking-[0.14em] uppercase text-ns-accent">
            ▸ Step 1 of 5 · Schedule
          </div>
          <h2 className="text-[30px] tracking-[-0.03em] lg:text-[38px]">Pick a schedule</h2>
        </div>
        <div className="mt-7 h-64 border-2 border-divider" aria-busy="true" />
      </main>
    </div>
  );
}

export function SubscribeRoute() {
  usePageTitle("Subscribe");
  return (
    <Suspense fallback={<SubscribeFallback />}>
      <SubscribeSurface />
    </Suspense>
  );
}
