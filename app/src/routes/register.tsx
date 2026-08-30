// The /creator/register route.
//
// Loaded on demand for the same reason /manage, /subscribe and /verify are:
// the surface pulls in starknet.js and the wallet bridge, and the creator
// ledger - the page this one is reached from - deliberately never loads that
// stack. Navigating here fetches one extra chunk.

import { lazy, Suspense } from "react";

import { Masthead } from "../components/masthead";
import { usePageTitle } from "../lib/use-title";

const RegisterSurface = lazy(() =>
  import("../components/creator/register").then((m) => ({ default: m.RegisterSurface })),
);

/** The frame the surface arrives into: the masthead and the page header at
 *  their real heights, so nothing jumps when the chunk lands. */
function RegisterFallback() {
  return (
    <div className="flex min-h-screen flex-col">
      <Masthead active="creator" />
      <main className="flex-1 px-5 py-9 lg:px-10">
        <div className="border-b-2 border-divider pb-5">
          <div className="mb-2.5 text-[11px] tracking-[0.14em] uppercase text-ns-accent">
            ▸ One public transaction, then a link to share
          </div>
          <h2 className="text-[30px] tracking-[-0.03em] lg:text-[38px]">Become a creator</h2>
        </div>
        <div className="mt-7 h-64 border-2 border-divider" aria-busy="true" />
      </main>
    </div>
  );
}

export function RegisterRoute() {
  usePageTitle("Become a creator");
  return (
    <Suspense fallback={<RegisterFallback />}>
      <RegisterSurface />
    </Suspense>
  );
}
