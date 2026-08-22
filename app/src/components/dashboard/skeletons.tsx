// The loading state, at the real measurements.
//
// Every bar below stands where a real element will stand and is the width of
// the value it replaces, so nothing on the page moves when the read lands.
// Static fills, no shimmer sweep: a page that has not read the chain yet has
// nothing to report, and a sweeping highlight would be reporting activity.

import { Skeleton } from "../ui/skeleton";
import { SectionHead } from "../board/primitives";

const bar = "bg-surface-fill animate-none rounded-none";

/** The subscription table's real column widths, so the skeleton does not move
 *  when the read lands. Keep in step with subscription-table.tsx. */
const COLUMNS = [86, 40, 120, 60, 78, 84, 108, 108, 70];

function Bar({ w, h = 10 }: { w: number | string; h?: number }) {
  return <Skeleton className={bar} style={{ width: w, height: h }} />;
}

function TileSkeleton() {
  return (
    <div className="flex flex-col gap-3 border border-border-panel bg-surface-panel px-6 py-7">
      <Bar w={140} h={8} />
      <Bar w={150} h={30} />
      <Bar w="90%" h={8} />
      <Bar w="72%" h={8} />
    </div>
  );
}

export function DashboardSkeleton() {
  return (
    <div className="flex flex-col gap-12" aria-busy="true" aria-label="reading the creator ledger">
      <div className="flex flex-col gap-3 border border-border-panel bg-surface-sunken px-5 py-5 lg:flex-row lg:items-center lg:justify-between">
        <Bar w="min(420px, 82%)" h={12} />
        <Bar w="min(330px, 64%)" h={8} />
      </div>

      <div className="flex flex-col gap-5">
        <SectionHead note="reading the event log">// METRICS · WITH THEIR BASIS</SectionHead>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <TileSkeleton key={i} />
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-5">
        <SectionHead note="reading the event log">// REVENUE TIMELINE</SectionHead>
        <div className="flex flex-col gap-4 border border-border-panel bg-surface-panel px-6 py-6">
          <Bar w="100%" h={240} />
          <Bar w="94%" h={10} />
          <Bar w="80%" h={10} />
        </div>
      </div>

      <div className="flex flex-col gap-5">
        <SectionHead note="reading the event log">// SUBSCRIPTIONS AT THIS VAULT</SectionHead>
        <div className="hidden overflow-hidden border border-border-hairline lg:block">
          <div className="flex gap-6 border-b border-border-hairline bg-surface-sunken px-3 py-2.5">
            {COLUMNS.map((w, i) => (
              <Bar key={i} w={w} h={8} />
            ))}
          </div>
          {[0, 1].map((r) => (
            <div
              key={r}
              className="flex items-center gap-6 border-b border-border-row px-3"
              style={{ height: "var(--row-height)" }}
            >
              {COLUMNS.map((w, i) => (
                <Bar key={i} w={w} h={9} />
              ))}
            </div>
          ))}
        </div>
        <div className="flex flex-col gap-3 lg:hidden">
          {[0, 1].map((r) => (
            <div
              key={r}
              className="flex flex-col gap-3 border border-border-panel bg-surface-panel px-4 py-4"
            >
              <Bar w={140} h={12} />
              <Bar w="80%" h={9} />
              <Bar w="66%" h={9} />
              <Bar w="74%" h={9} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
