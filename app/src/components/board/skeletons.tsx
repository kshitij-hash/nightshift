// The loading state, at the real measurements. Every bar below is the width
// of the value it stands in for, so the page does not move when the read
// lands. Static fills, not a shimmer: a sweeping highlight is decoration, and
// a page that has not read the chain yet has nothing to report.

import { Skeleton } from "../ui/skeleton";
import { SectionHead } from "./primitives";

const bar = "bg-surface-fill animate-none rounded-none";

function Bar({ w, h = 10 }: { w: number; h?: number }) {
  return <Skeleton className={bar} style={{ width: w, height: h }} />;
}

/** The feed's real column widths, so the skeleton does not move when the read
 *  lands. Keep in step with the header in charge-feed.tsx. */
const COLUMNS = [24, 76, 200, 110, 110, 240, 128, 150];

export function BoardSkeleton() {
  return (
    <div className="flex flex-col gap-8" aria-busy="true" aria-label="reading the vault">
      <div className="flex flex-col border border-border-panel bg-surface-panel lg:flex-row">
        <div className="flex flex-col items-center gap-4 border-b border-border-panel px-8 py-7 lg:border-r lg:border-b-0">
          {/* The dial is hairlines, so its placeholder is hairlines too. */}
          <div
            className="flex items-center justify-center rounded-full border border-border-panel"
            style={{ width: 320, height: 320 }}
          >
            <div
              className="flex items-center justify-center rounded-full border border-border-row"
              style={{ width: 252, height: 252 }}
            >
              <div
                className="rounded-full border border-border-row bg-surface-panel"
                style={{ width: 204, height: 204 }}
              />
            </div>
          </div>
          <Bar w={280} />
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex flex-col border-b border-border-panel sm:flex-row">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex min-w-0 flex-1 flex-col gap-2 px-5 py-3.5">
                <Bar w={110} h={8} />
                <Bar w={140} h={22} />
                <Bar w={170} h={8} />
              </div>
            ))}
          </div>
          <div className="flex flex-col gap-3 px-8 py-6">
            <Bar w={170} h={8} />
            <Bar w={330} h={44} />
            <Bar w={520} h={12} />
            <Bar w={470} h={12} />
            <Bar w={300} h={10} />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex flex-col gap-2 border border-border-panel px-5 py-4">
            <Bar w={130} h={8} />
            <Bar w={120} h={30} />
            <Bar w={210} h={8} />
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-3">
        <SectionHead note="reading the vault">// CHARGE FEED · DECODED FROM MAINNET EVENTS</SectionHead>
        <div className="overflow-x-auto border border-border-hairline">
          <div className="min-w-[1000px]">
            <div className="flex gap-6 border-b border-border-hairline bg-surface-sunken px-3 py-2.5">
              {COLUMNS.map((w, i) => (
                <Bar key={i} w={Math.min(w - 12, 70)} h={8} />
              ))}
            </div>
            {[0, 1, 2, 3, 4].map((r) => (
              <div
                key={r}
                className="flex items-center gap-6 border-b border-border-row px-3"
                style={{ height: "var(--row-height)" }}
              >
                {COLUMNS.map((w, i) => (
                  <Bar key={i} w={Math.min(w - 12, 96)} h={9} />
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/** No charges decoded, and the read worked. Written out, not a shrug. */
export function EmptyFeed() {
  return (
    <div className="border border-border-hairline px-5 py-8">
      <p className="text-[14px] leading-[1.55] text-text-prose">
        No charges yet. The vault has not billed anyone. When it does, every charge lands here with
        its block, its amount and its receipt.
      </p>
    </div>
  );
}
