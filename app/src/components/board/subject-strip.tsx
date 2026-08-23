// What the board is watching, stated once so no figure below has to repeat it.
//
// One row of fields, directly under the tick bar the feed's periods are drawn
// on, so the thing being watched sits next to the evidence that it ran. The
// sentence about what the commitment does and does not expose hangs off the
// commitment's own label, behind the same caveat affordance the dashboard
// tiles use, rather than as a paragraph competing with the fields.

import { fmtStrk, GATE, SECONDS_PER_BLOCK, truncate } from "../../config";
import type { Schedule } from "../../lib/schedule";
import { CaveatDisclosure, HashCopy } from "./primitives";

function Field({
  label,
  note,
  children,
}: {
  label: string;
  note?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="flex items-center gap-2 text-[11px] leading-[1.45] tracking-[0.14em] text-text-caption">
        {label}
        {note}
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
    <div className="flex flex-wrap items-start gap-x-5 gap-y-4 border border-border-panel bg-surface-sunken px-6 py-4">
      <Field
        label="SUBSCRIPTION COMMITMENT"
        note={
          <CaveatDisclosure
            popover
            caveat="the commitment is public; the wallet behind it is not, and is not asked again"
          />
        }
      >
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
  );
}
