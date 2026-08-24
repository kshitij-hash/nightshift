// The loading state, at the real measurements. Every bar below is the width
// of the value it stands in for, so the page does not move when the read
// lands. Static fills, not a shimmer: a sweeping highlight is decoration, and
// a page that has not read the chain yet has nothing to report.

import { Skeleton } from "../ui/skeleton";
import { SectionHead, StatusDot } from "./primitives";

/**
 * The chain chip, before there is a head block to put in it.
 *
 * An app surface never simply omits the chip while it reads. A gap where the
 * chip goes reads as "this page is not on a chain", and it also means the
 * masthead is a different height in the two states on the narrow layouts where
 * the chip wraps. This says the true thing at the real size instead.
 */
export function PendingChip() {
  return (
    <span className="inline-flex items-center gap-2 border border-border-panel px-2 py-1.5 text-[11px] tracking-[0.1em] whitespace-nowrap text-text-label md:px-2.5">
      <StatusDot state="pending" size={6} />
      <span className="hidden md:inline">MAINNET&nbsp;·&nbsp;</span>
      <span className="sr-only md:hidden">MAINNET · </span>
      READING THE HEAD BLOCK
    </span>
  );
}

// max-w-full only: the bar keeps the real measurement of the value it stands
// in for, and stops at the edge of its container on a phone rather than
// pushing the page sideways before anything has been read.
const bar = "bg-surface-fill animate-none rounded-none max-w-full";

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
        <div className="flex flex-col items-center gap-4 border-b border-border-panel px-6 py-7 lg:border-r lg:border-b-0 lg:px-8">
          {/* The dial is hairlines, so its placeholder is hairlines too. */}
          {/* 208 on a phone and 320 above it, the two sizes the real dial is
              rendered at, so the placeholder measures what arrives. */}
          <div className="flex h-[208px] w-[208px] items-center justify-center rounded-full border border-border-panel md:h-[320px] md:w-[320px]">
            <div className="flex h-[164px] w-[164px] items-center justify-center rounded-full border border-border-row md:h-[252px] md:w-[252px]">
              <div className="h-[133px] w-[133px] rounded-full border border-border-row bg-surface-panel md:h-[204px] md:w-[204px]" />
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

      {/* The stat row, at the measurements the loaded row lands at: a 16px
          "as of block N" line above the grid, then three tiles whose label,
          figure and basis are 17, 32 and 16 per line. The first two bases run
          to two lines and the third to one, which is what decides the height
          of the phone layout where the tiles stack. */}
      <div className="flex flex-col gap-2">
        <div className="flex justify-end">
          <Bar w={132} h={16} />
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[32, 32, 16].map((caption, i) => (
            <div key={i} className="flex flex-col gap-1 border border-border-panel px-5 py-4">
              <Bar w={130} h={17} />
              <Bar w={120} h={32} />
              <Bar w={210} h={caption} />
            </div>
          ))}
        </div>
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
