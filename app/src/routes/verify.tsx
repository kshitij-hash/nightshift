// The /verify route.
//
// The surface itself is loaded on demand. The check is the real one, ported
// from the published nightshift-verify package, and it needs starknet.js for
// poseidon and the STARK curve: about 230 kB minified. The board and the
// creator dashboard need none of that, so this route is the split point and
// they do not pay for it. Navigating here fetches one extra chunk.
//
// This file stays a wrapper on purpose: the surface, its state machine and its
// components all live under components/verify/.

import { lazy, Suspense } from "react";

import { Masthead } from "../components/masthead";

const VerifySurface = lazy(() =>
  import("../components/verify/surface").then((m) => ({ default: m.VerifySurface })),
);

/** The frame the surface arrives into. It mirrors the real layout rather than
 *  flashing a spinner, so the page does not jump when the chunk lands. */
function VerifyFallback() {
  return (
    <div className="mx-auto flex w-full max-w-[1200px] flex-col">
      <Masthead active="verify" />
      <main className="flex flex-1 flex-col gap-8 px-5 py-8 lg:px-10">
        <div className="grid grid-cols-1 items-start gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="flex flex-col">
            {["01", "02", "03"].map((n) => (
              <div
                key={n}
                className="flex items-center gap-3 border border-t-0 border-border-panel px-5 py-5 first:border-t"
              >
                <span className="inline-flex h-6 w-7 shrink-0 items-center justify-center border border-border-field text-[11px] text-text-caption tabular-nums">
                  {n}
                </span>
                <span className="h-3 w-48 max-w-full bg-surface-fill" />
              </div>
            ))}
          </div>
          <div className="h-40 border border-border-panel" />
        </div>
      </main>
    </div>
  );
}

export function VerifyRoute() {
  return (
    <Suspense fallback={<VerifyFallback />}>
      <VerifySurface />
    </Suspense>
  );
}
