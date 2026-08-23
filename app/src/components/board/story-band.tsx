// The story band, below the board fold. Nothing here is live, because nothing
// here changes: it is the explanation, not the instrument. Three parts, in
// this order: what the machine is, what the chain can and cannot see, and the
// row-by-row receipts for every claim above.
//
// All three arrive shut. A reader who came for the instrument gets the
// instrument; the explanation is three 44px lines that say what is inside and
// how much of it, and each opens when it is asked for.

import {
  fmtBlock,
  fmtStrk,
  GATE,
  SECONDS_PER_BLOCK,
  truncate,
  VAULT,
  VAULT_V2,
  VAULT_V3,
  VOYAGER_CONTRACT,
  VOYAGER_TX,
} from "../../config";
import type { Charge } from "../../lib/board";
import type { Schedule } from "../../lib/schedule";
import { chargesOf, utcStamp } from "./derive";
import type { TickState } from "./derive";
import { Mechanism } from "./mechanism-figure";
import type { MechanismLabels } from "./mechanism-figure";
import { Disclosure, HashCopy } from "./primitives";
import { TickBar } from "./tick-bar";

const LEGEND: Array<[string, string, string]> = [
  [
    "1",
    "ESCROW ENTERS THROUGH THE POOL",
    "One private pool action deposits the whole escrow against the commitment. The vault is told an amount arrived for that commitment. It is never told which wallet sent it, and it has no way to ask.",
  ],
  [
    "2",
    "ESCROW IS HELD AND ACCOUNTED",
    "The reservoir is checked before anything moves. Never beyond escrow: a charge that would exceed the accounted balance reverts, so the ceiling is set once, by the subscriber.",
  ],
  [
    "3",
    "THE PERIOD WHEEL IS BLOCK-GATED",
    "One detent per period. Never early: the window is arithmetic on the block height, not a timer someone can nudge.",
  ],
  [
    "4",
    "THE NULLIFIER IS A ONE-WAY GATE",
    "Charging a period consumes its nullifier, write-once. Never twice: the same period cannot be charged again, by anyone, including the creator.",
  ],
  [
    "5",
    "THE CHARGE EXITS ON SCHEDULE",
    "The amount leaves escrow for the creator's claimable balance. No tokens move to a wallet at this step, and nobody was at a keyboard when it happened.",
  ],
  [
    "6",
    "THE CREATOR CLAIMS, SEPARATELY",
    "Settlement is a second transaction the creator signs. Until it lands, the balance reads as unsettled, because that is what the chain says.",
  ],
];

const SEE_ROWS: Array<[string, string, string]> = [
  ["who funded the escrow", "a pool action, and the pool's own address", "the subscriber's wallet"],
  [
    "how much, per period",
    "the amount, in every charge event",
    "nothing · the amount is public by design",
  ],
  ["how many periods", "the period count, so the escrow total is derivable", "nothing"],
  ["when each charge fired", "the block and its timestamp, to the second", "nothing"],
  [
    "which tier a gate was shown",
    "that the tier was presented, if the gate publishes it",
    "anything else about the holder",
  ],
  ["the link from wallet to commitment", "·", "it is in no event this contract emits"],
  [
    "two gates comparing notes",
    "the same commitment, if both were shown it",
    "the wallet behind it, still",
  ],
  [
    "the creator's topline",
    "the sum of the charge events, derivable by anyone",
    "nothing · a creator topline is public, and this product never claims otherwise",
  ],
];

type Receipt = { kind: string; what: string; value: string; href: string | null; full?: string };

function receipts(charges: Charge[], schedule: Schedule | null | undefined): Receipt[] {
  const rows: Receipt[] = [
    {
      kind: "CONTRACT",
      what: "vault v4, the live vault",
      value: truncate(VAULT),
      href: VOYAGER_CONTRACT(VAULT),
    },
    {
      kind: "CONTRACT",
      what: "tier gate, reads the v4 vault",
      value: truncate(GATE),
      href: VOYAGER_CONTRACT(GATE),
    },
    {
      kind: "CONTRACT",
      what: "vault v3, superseded, still decoded here",
      value: truncate(VAULT_V3),
      href: VOYAGER_CONTRACT(VAULT_V3),
    },
    {
      kind: "CONTRACT",
      what: "vault v2, superseded, still decoded here",
      value: truncate(VAULT_V2),
      href: VOYAGER_CONTRACT(VAULT_V2),
    },
  ];
  if (schedule) {
    rows.push({
      kind: "ID",
      what: "creator",
      value: truncate(schedule.creatorId),
      href: null,
      full: schedule.creatorId,
    });
    rows.push({
      kind: "COMMITMENT",
      what: `subscription · ${schedule.nPeriods} periods, ${schedule.periodBlocks} blocks each`,
      value: truncate(schedule.commitment),
      href: null,
      full: schedule.commitment,
    });
  }
  for (const c of charges) {
    rows.push({
      kind: "RECEIPT",
      what:
        `period ${String(c.periodIndex).padStart(2, "0")} · block ${fmtBlock(c.block)} · ` +
        `${utcStamp(c.timestamp)} UTC`,
      value: truncate(c.txHash),
      href: VOYAGER_TX(c.txHash),
    });
  }
  rows.push(
    {
      kind: "PACKAGE",
      what: "verifies a tier presentation against vault state",
      value: "npm nightshift-verify",
      href: "https://www.npmjs.com/package/nightshift-verify",
    },
    {
      kind: "PACKAGE",
      what: "preflights an STRK20 pool action before signing",
      value: "npm strk20-preflight",
      href: "https://www.npmjs.com/package/strk20-preflight",
    },
    {
      kind: "SOURCE",
      what: "contracts, keeper script, verifier",
      value: "github.com/kshitij-hash/nightshift",
      href: "https://github.com/kshitij-hash/nightshift",
    },
  );
  return rows;
}

/** The four numbers FIG. 1 is annotated with, taken from the same reads the
 *  instrument above it runs on so the drawing cannot drift away from the
 *  board. Exported because the landing renders the same figure from the same
 *  reads, and a second copy of this arithmetic would be a second thing to keep
 *  in step. */
export function mechanismLabels(
  schedule: Schedule | null | undefined,
  perPeriodWei: bigint | null,
  charged: number,
): MechanismLabels {
  const strk = (wei: bigint) => `${fmtStrk(wei)} STRK`;
  const escrowIn =
    schedule && perPeriodWei !== null
      ? `ESCROW ${strk(perPeriodWei * BigInt(schedule.nPeriods))}`
      : "ESCROW ENTERS ONCE";
  const claimable =
    perPeriodWei !== null
      ? `CREATOR CLAIMABLE ${strk(perPeriodWei * BigInt(charged))}`
      : "CREATOR CLAIMABLE";
  const levels =
    schedule && perPeriodWei !== null
      ? [1, 2, 3].map((i) =>
          i <= schedule.nPeriods ? fmtStrk(perPeriodWei * BigInt(i)) : "",
        )
      : [];
  return {
    escrowIn,
    escrowNow: schedule ? `${fmtStrk(schedule.escrowWei)} NOW` : "ACCOUNTED",
    claimable,
    periodDim: schedule
      ? `${schedule.periodBlocks} BLOCKS ~ ${Math.round((schedule.periodBlocks * SECONDS_PER_BLOCK) / 60)} MIN`
      : "ONE PERIOD",
    wheel:
      schedule && schedule.nPeriods === 3
        ? "PERIOD WHEEL · 3 DETENTS"
        : "PERIOD WHEEL · ONE DETENT PER PERIOD",
    commit: schedule ? `commit(${truncate(schedule.commitment)})` : "commit(subscription)",
    vault: `${truncate(VAULT)} · SECTION`,
    levels,
  };
}

/**
 * The two columns that are the product, as one table. The board keeps it
 * inside the hidden-and-visible disclosure; /verify renders the same table in
 * the verdict column, where the question it answers is the one a reader is
 * already asking.
 */
export function HiddenAndVisible() {
  return (
    <>
      <div className="overflow-x-auto border border-border-hairline">
        <table className="w-full min-w-[560px] caption-bottom border-collapse text-left font-mono">
          <thead className="bg-surface-sunken">
            <tr className="border-b border-border-hairline">
              <th className="h-8 px-3 text-[13px] font-medium tracking-[0.08em] text-text-label">
                {" "}
              </th>
              <th className="h-8 w-[38%] px-3 text-[13px] font-medium tracking-[0.08em] text-text-label">
                WHAT THE CHAIN SEES
              </th>
              <th className="h-8 w-[38%] px-3 text-[13px] font-medium tracking-[0.08em] text-text-label">
                WHAT IT NEVER SEES
              </th>
            </tr>
          </thead>
          <tbody>
            {SEE_ROWS.map(([a, b, c]) => (
              <tr key={a} className="border-b border-border-row last:border-0">
                <td className="px-3 py-3 align-top text-[13px] text-text-default">{a}</td>
                <td className="px-3 py-3 align-top text-[13px] leading-[1.7] text-text-prose">
                  {b}
                </td>
                <td className="px-3 py-3 align-top text-[13px] leading-[1.7] text-text-caption">
                  {c}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[12px] leading-[1.5] text-text-caption">
        Read the middle column as the cost and the right as the claim. Charges of one subscription
        share a commitment, so they link to each other; a presentation of that subscription is
        linkable across gates. Both limitations are stated where they matter, not here for the
        first time.
      </p>
    </>
  );
}

export function StoryBand({
  charges,
  schedule,
  perPeriodWei,
  ticks,
}: {
  charges: Charge[];
  schedule: Schedule | null | undefined;
  perPeriodWei: bigint | null;
  ticks: TickState[];
}) {
  const mine = schedule ? chargesOf(charges, schedule.commitment) : charges.slice(0, 3);
  const labels = mechanismLabels(schedule, perPeriodWei, mine.length);
  const rows = receipts(mine, schedule);
  const charged = ticks.filter((t) => t === "ok" || t === "late").length;

  return (
    <div className="flex flex-col py-4">
      <Disclosure
        marker="// THE MECHANISM"
        teaser="escrow in once, block-gated period wheel, write-once nullifier, claim out."
        count="figure and six steps."
      >
        <div className="flex flex-wrap items-baseline justify-between gap-8">
          <p
            className="max-w-[760px] font-semibold text-text-strong"
            style={{ fontSize: 20, lineHeight: 1.2, letterSpacing: "-0.01em" }}
          >
            A recurring authorization the pool cannot express, built as a machine that charges on
            schedule with nobody at a keyboard.
          </p>
          <p className="max-w-[420px] text-[13px] leading-[1.7] text-text-prose">
            Escrow enters once, through the pool. After that the vault charges against a write-once
            period nullifier. The subscriber's wallet is never named, never asked again, and cannot
            be charged early, twice, or beyond what it escrowed.
          </p>
        </div>
        <div className="border border-border-panel bg-surface-sunken px-7 py-6">
          <Mechanism labels={labels} />
        </div>
        <div className="grid grid-cols-1 gap-6 pt-2 md:grid-cols-2 lg:grid-cols-3">
          {LEGEND.map(([n, title, body]) => (
            <div key={n} className="flex flex-col gap-2 border-t border-border-row pt-3.5">
              <div className="flex items-center gap-3">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-text-caption text-[11px] text-text-label">
                  {n}
                </span>
                <span className="text-[11px] font-medium tracking-[0.18em] text-text-strong">
                  {title}
                </span>
              </div>
              <p className="text-[13px] leading-[1.7] text-text-prose">{body}</p>
            </div>
          ))}
        </div>
      </Disclosure>

      <Disclosure
        marker="// HIDDEN AND VISIBLE"
        teaser="what the chain sees, and what it never sees."
        count={`${SEE_ROWS.length} rows.`}
      >
        <HiddenAndVisible />
      </Disclosure>

      <Disclosure
        marker="// THE RECEIPTS"
        teaser="every claim above, as an address, a package or a transaction."
        count={`${rows.length} rows.`}
      >
        <div className="flex flex-col border border-border-hairline">
          {rows.map((r, i) => (
            <div
              key={`${r.kind}:${r.value}:${i}`}
              className={`flex flex-wrap items-baseline gap-x-6 gap-y-1 px-4 py-3 ${
                i ? "border-t border-border-row" : ""
              } ${i % 2 ? "" : "bg-surface-panel"}`}
            >
              <span className="w-[92px] shrink-0 text-[11px] leading-[1.45] tracking-[0.14em] text-text-caption">
                {r.kind}
              </span>
              <span className="min-w-0 flex-1 text-[13px] leading-[1.7] text-text-prose">
                {r.what}
              </span>
              <span className="w-full text-[13px] sm:w-[330px] sm:text-right">
                {r.href ? (
                  <a href={r.href} target="_blank" rel="noreferrer">
                    {r.value} ↗
                  </a>
                ) : (
                  <HashCopy value={r.full ?? r.value} display={r.value} />
                )}
              </span>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-6 pt-1">
          <p className="text-[12px] leading-[1.5] text-text-caption">
            Every row above is a real address, a real published package, or a real transaction from
            this subscription's lifecycle. This page renders them with no key, and when the read
            fails it says so.
          </p>
          {ticks.length > 0 ? (
            <TickBar states={ticks} caption={`${charged} of ${ticks.length} charged`} />
          ) : null}
        </div>
      </Disclosure>
    </div>
  );
}
