// The landing.
//
// Reading order is the argument here too, and it is a different argument from
// the board's. The hero states the claim and carries no numbers and no buttons,
// because a claim with a number in it is asking to be believed before it has
// been checked. The live strip under it is the first evidence and the only
// moving thing above the fold. The persona router is the page's only question:
// which of three readers is at it. The mechanism section answers what the
// machine does, the proof section hands over the transactions, and the close is
// the one place the page asks for anything.
//
// Load is still on purpose. Nothing staggers in, nothing fades up, nothing
// parallaxes. The page is already the answer, and motion here is the first
// thing a reader would distrust.
//
// Every figure comes from the same two reads the board runs on, through the
// same cached queries, so opening /board from here costs no extra request.

import { useNavigate, useSearch } from "@tanstack/react-router";

import { HeroCopy } from "../components/landing/hero";
import { ClosingCTAs, LandingFooter } from "../components/landing/closing";
import { LiveStrip } from "../components/landing/live-strip";
import { MechanismSection } from "../components/landing/mechanism-section";
import { PersonaTabs } from "../components/landing/personas";
import type { PersonaFacts } from "../components/landing/personas";
import { ProofSection } from "../components/landing/proof-section";
import { liveCommitment, perPeriodAmount } from "../components/board/derive";
import { SectionHead } from "../components/board/primitives";
import { useMediaQuery } from "../components/board/use-clock";
import { Masthead } from "../components/masthead";
import { fmtStrk, truncate } from "../config";
import { useBoard } from "../query/useBoard";
import { useSchedule } from "../query/useSchedule";
import type { PersonaId } from "../router";

const PAGE = "mx-auto flex w-full max-w-[1200px] flex-col";
const GUTTER = "px-5 lg:px-14";

export function LandingRoute() {
  const search = useSearch({ from: "/" });
  const navigate = useNavigate({ from: "/" });
  const { data } = useBoard();

  const commitment = data ? liveCommitment(data.charges) : null;
  const schedule = useSchedule(commitment).data ?? null;
  // The phone control and the phone layouts. One variant is in the DOM at a
  // time, so nothing on this page is rendered twice for a screen reader.
  const compact = !useMediaQuery("(min-width: 768px)");

  const persona: PersonaId = search.for ?? "subscribe";
  const setPersona = (next: PersonaId) =>
    void navigate({
      search: next === "subscribe" ? {} : { for: next },
      replace: true,
    });

  const charges = data?.charges ?? [];
  const perPeriodWei = perPeriodAmount(charges, commitment);
  const withAmount = charges.filter((c) => c.amountWei !== null);
  const chargedOfSchedule = schedule
    ? charges.filter(
        (c) => BigInt(c.commitment) === BigInt(schedule.commitment),
      ).length
    : 0;

  const facts: PersonaFacts = {
    periods: schedule ? schedule.nPeriods : null,
    charged: schedule ? chargedOfSchedule : null,
    escrow: schedule ? fmtStrk(schedule.escrowWei) : null,
    creator: schedule ? truncate(schedule.creatorId) : null,
    charges: charges.length,
    gross:
      withAmount.length > 0
        ? fmtStrk(withAmount.reduce((sum, c) => sum + (c.amountWei ?? 0n), 0n))
        : null,
  };

  return (
    <div className={PAGE}>
      {/* No chip and no sentence rule. The strip below the hero carries the
          chain, and a chip would say the same block a second time. */}
      <Masthead heading={false} />

      <main className="flex flex-1 flex-col">
        <HeroCopy compact={compact} />

        {/* The strip is real or it is absent. A skeleton with four zeros in it
            would be a fabricated stat for as long as the read takes. */}
        {data ? (
          <LiveStrip
            data={{
              activeSubscriptions: data.activeSubscriptions,
              charges: data.charges,
              escrowWei: data.escrowWei,
              headBlock: data.headBlock,
              snapshot: data.provenance.source === "snapshot",
            }}
          />
        ) : (
          <div className="flex min-h-[92px] items-center border-y border-border-hairline bg-surface-sunken px-5 lg:px-14">
            <span className="text-[11px] tracking-[0.16em] text-text-label">
              READING STARKNET MAINNET
            </span>
          </div>
        )}

        <section className={`${GUTTER} flex flex-col gap-5 pt-11 lg:pt-14`}>
          <div className="flex flex-wrap items-baseline justify-between gap-5">
            <SectionHead
              className="flex-1 border-b-0 pb-0"
              note="three ways in, one machine underneath"
            >
              // WHO IS AT THIS PAGE
            </SectionHead>
            {!compact ? (
              <span className="max-w-[52ch] text-[11px] leading-[1.5] text-text-caption lg:text-right">
                each tab is a whole path: three steps, the honest limit, and one way forward. None
                of the three is a footnote to another.
              </span>
            ) : null}
          </div>
          <PersonaTabs
            value={persona}
            onChange={setPersona}
            segmented={compact}
            facts={facts}
          />
        </section>

        <div className={`${GUTTER} pt-12 lg:pt-16`}>
          <MechanismSection
            schedule={schedule}
            perPeriodWei={perPeriodWei}
            charged={chargedOfSchedule}
            compact={compact}
          />
        </div>

        <div className={`${GUTTER} pt-10 lg:pt-12`}>
          <ProofSection
            charges={charges}
            creatorId={schedule ? schedule.creatorId : null}
            snapshot={data?.provenance.source === "snapshot"}
            compact={compact}
          />
        </div>

        <div className={`${GUTTER} pt-10 pb-12 lg:pt-12`}>
          <ClosingCTAs compact={compact} />
        </div>
      </main>

      <LandingFooter snapshot={data?.provenance.source === "snapshot"} />
    </div>
  );
}
