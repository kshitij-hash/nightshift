// What the board is watching, stated once so no figure below has to repeat it.
// The commitment is public; it is the whole point that the wallet behind it is
// not, and is never asked for again.

import { fmtStrk, GATE, SECONDS_PER_BLOCK, truncate } from "../../config";
import type { Schedule } from "../../lib/schedule";
import { HashCopy } from "./primitives";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="text-[10px] leading-[1.45] tracking-[0.14em] text-text-caption">
        {label}
      </span>
      <span className="text-[13px] text-text-default">{children}</span>
    </div>
  );
}

export function SubjectStrip({
  schedule,
  perPeriodWei,
}: {
  schedule: Schedule;
  perPeriodWei: bigint | null;
}) {
  const periodMins = Math.round((schedule.periodBlocks * SECONDS_PER_BLOCK) / 60);
  return (
    <div className="flex flex-wrap items-start justify-between gap-6 border border-border-panel bg-surface-sunken px-6 py-4">
      <div className="flex flex-wrap gap-x-8 gap-y-4">
        <Field label="SUBSCRIPTION COMMITMENT">
          <HashCopy
            value={schedule.commitment}
            display={truncate(schedule.commitment)}
            tone="strong"
          />
        </Field>
        <Field label="TIER">
          <span className="text-text-strong">
            {schedule.tier} ·{" "}
            {perPeriodWei !== null ? (
              <>
                {fmtStrk(perPeriodWei)}
                <span className="text-text-label"> STRK</span> / period
              </>
            ) : (
              "amount not in the event"
            )}
          </span>
        </Field>
        <Field label="CADENCE">
          <span className="text-text-strong">
            {schedule.periodBlocks} blocks · about {periodMins} min
          </span>
        </Field>
        <Field label="PERIODS">
          <span className="text-text-strong">
            {schedule.nextPeriod} / {schedule.nPeriods} charged
          </span>
        </Field>
        <Field label="GATE">
          <HashCopy value={GATE} display={truncate(GATE)} />
        </Field>
        <Field label="CREATOR">
          <HashCopy value={schedule.creatorId} display={truncate(schedule.creatorId)} />
        </Field>
      </div>
      <p className="max-w-[260px] text-[10px] leading-[1.45] text-text-caption">
        the commitment is public; the wallet behind it is not, and is not asked again
      </p>
    </div>
  );
}
