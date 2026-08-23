// What a subscribe makes public and what it does not.
//
// Every row here is the repo's PRIVACY.md subscribe row, restated for the
// numbers actually on screen. Two claims are deliberately absent, because both
// would be false: nothing here says a creator's revenue is confidential (the
// per-creator topline is derivable from public events), and nothing here says
// a tier presentation hides everything but the tier (it reveals the
// commitment, and a verifier can recognize it again).

import { fmtStrk, truncate } from "../../lib/wallet/core";

function Rows({ title, rows }: { title: string; rows: Array<[string, string]> }) {
  return (
    <div className="flex flex-col gap-1 border border-border-panel px-4 py-4">
      <div className="pb-1 text-[11px] font-medium tracking-[0.18em] text-text-label">{title}</div>
      {rows.map(([k, v]) => (
        <div
          key={k}
          className="flex flex-col gap-1 border-t border-border-row py-2 sm:flex-row sm:items-baseline sm:gap-3"
        >
          <span className="shrink-0 text-[12px] text-text-default sm:w-[11.5rem]">{k}</span>
          <span className="text-[11px] leading-[1.5] text-text-caption">{v}</span>
        </div>
      ))}
    </div>
  );
}

export function SubscribeDisclosure({
  escrowWei,
  periods,
  cadenceLabel,
  vault,
  commitment,
  tierLabel,
}: {
  escrowWei: bigint;
  periods: number;
  cadenceLabel: string;
  vault: string;
  commitment: string;
  tierLabel: string;
}) {
  const publicRows: Array<[string, string]> = [
    ["the vault and the tier", `${truncate(vault)} · ${tierLabel}`],
    ["the number of periods", `${periods}, so the ${fmtStrk(escrowWei)} STRK escrow is derivable`],
    ["the commitment", `${truncate(commitment)}, and every charge made against it`],
    ["the 6 STRK pool fee", "paid from your public balance, in a public transaction"],
    ["the schedule shape", `${cadenceLabel}, in the invoke calldata, which is public`],
    ["the timing of each charge", "block and timestamp, to the second"],
  ];
  const hiddenRows: Array<[string, string]> = [
    ["which wallet funded the escrow", "the pool's withdrawal edge severs it and the vault cannot ask"],
    ["the link wallet to commitment", "not in any event this vault emits"],
    ["your shielded balance", "the pool holds the note, the vault holds only the escrow"],
    ["what you pay other creators", "a different creator id derives a different commitment and a different owner key"],
  ];
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Rows title="BECOMES PUBLIC" rows={publicRows} />
      <div className="flex flex-col gap-3">
        <Rows title="STAYS HIDDEN" rows={hiddenRows} />
        <p className="text-[11px] leading-[1.55] text-text-caption">
          Two limits stated where they apply, not in a footnote. Charges of one subscription are
          linkable to each other, because the commitment sits in every charge's public calldata.
          Presentations of one subscription are linkable to each other across gates, for the same
          reason.
        </p>
      </div>
    </div>
  );
}

/** The fee panel. It is on screen from the moment a preview exists, with no
 *  reveal animation and behind no interaction: nothing about cost is hidden
 *  until a click. */
export function PoolFeeNote({ active }: { active: boolean }) {
  return (
    <div
      className={`flex flex-col gap-2 border px-4 py-3.5 ${
        active ? "border-ns-accent" : "border-border-panel"
      }`}
    >
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[11px] font-medium tracking-[0.18em] text-text-label">POOL FEE</span>
        <span className="text-[20px] font-semibold text-text-strong tabular-nums">
          6<span className="pl-1 text-[12px] font-normal text-text-caption">STRK</span>
        </span>
      </div>
      <p className="text-[12px] leading-[1.55] text-text-caption">
        Charged by the privacy pool for the private action, paid from your public balance in a
        public transaction. It is not part of the escrow, the creator never receives it, and it is
        stated here before you sign rather than after.
      </p>
    </div>
  );
}
