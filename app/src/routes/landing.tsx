// The landing.
//
// Reading order is the argument here too, and it is a different argument from
// the board's. The hero states the claim and carries no numbers and no buttons,
// because a claim with a number in it is asking to be believed before it has
// been checked. The live strip under it is the first evidence and the only
// moving thing above the fold. The persona router is the page's only question:
// which of three readers is at it, and it is the only place the page asks for
// anything. The mechanism section answers what the machine does, the proof
// section hands over the addresses and the packages, and the close is one line
// that offers nothing the router did not already offer.
//
// Load settles once, across three zones, and then the page is still. The zones
// are the hero, the strip, and the section under it: 200ms each, 45ms apart,
// 290ms end to end, which is inside the 400ms at which a person stops feeling
// the machine keeping up with them. Nothing below the fold animates and nothing
// animates on scroll, ever. Three is not a round number picked for taste, it is
// what the budget allows: at 200 and 45, a fourth zone finishes at 335ms and a
// sixth at 425ms, and past that the page is performing rather than arriving.
//
// The hero carries no animation-delay for a second reason. It holds the h1,
// which is this page's largest contentful paint, and an element held at its
// from-state by a delay is an element Chrome will not score as a paint
// candidate for the length of that delay.
//
// Every figure comes from the same two reads the board runs on, through the
// same cached queries, so opening /board from here costs no extra request.

import { useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { HeroCopy } from "../components/landing/hero";
import { ClosingLine } from "../components/landing/closing";
import { LiveStrip } from "../components/landing/live-strip";
import { MechanismSection } from "../components/landing/mechanism-section";
import { PersonaTabs } from "../components/landing/personas";
import type { PersonaFacts } from "../components/landing/personas";
import { ProofSection } from "../components/landing/proof-section";
import { liveCommitment, perPeriodAmount } from "../components/board/derive";
import { SectionHead } from "../components/board/primitives";
import { useMediaQuery } from "../components/board/use-clock";
import { Masthead } from "../components/masthead";
import { SiteFooter } from "../components/site-footer";
import { fmtStrk, truncate } from "../config";
import { useBoard } from "../query/useBoard";
import { useSchedule } from "../query/useSchedule";
import type { PersonaId } from "../router";

const PAGE = "mx-auto flex w-full max-w-[1200px] flex-col";
const GUTTER = "px-5 lg:px-14";

/** Once per page load, not once per visit to this route. A reader who opens
 *  the board and comes back has already watched the page arrive, and replaying
 *  it every time is how a settle turns into a performance. Module scope rather
 *  than storage: the fact being remembered is "this tab has already painted",
 *  which is exactly the lifetime of this module. */
let hasSettled = false;

/** The three zone classes, or nothing at all on a later visit. */
function useSettle(): (zone: 1 | 2 | 3) => string {
  const [play] = useState(() => !hasSettled);
  useEffect(() => {
    hasSettled = true;
  }, []);
  if (!play) return () => "";
  return (zone) =>
    zone === 1 ? "ns-enter" : zone === 2 ? "ns-enter ns-enter-2" : "ns-enter ns-enter-3";
}

export function LandingRoute() {
  const search = useSearch({ from: "/" });
  const navigate = useNavigate({ from: "/" });
  const { data } = useBoard();
  const enter = useSettle();

  const commitment = data ? liveCommitment(data.charges) : null;
  const schedule = useSchedule(commitment).data ?? null;
  // The phone control and the phone layouts. One variant is in the DOM at a
  // time, so nothing on this page is rendered twice for a screen reader.
  const compact = !useMediaQuery("(min-width: 768px)");

  const persona: PersonaId = search.for ?? "subscribe";
  // resetScroll: false, and it is not optional. The router resets scroll to
  // 0,0 on every committed navigation by default, which is right when the
  // navigation is to another page and wrong when the whole navigation is a
  // search param recording which tab of an in-page control is open. Without
  // it, clicking a persona tab throws the reader back to the masthead.
  const setPersona = (next: PersonaId) =>
    void navigate({
      search: next === "subscribe" ? {} : { for: next },
      replace: true,
      resetScroll: false,
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
        <div className={enter(1)}>
          <HeroCopy compact={compact} />
        </div>

        {/* One component in both states. While the read is in flight the four
            cells, their labels and their three reserved slot heights are all
            there and the values are bars; when it lands the bars are replaced
            in place and the numerals roll. Nothing moves, because there is no
            second layout that could disagree with this one. */}
        <div className={enter(2)}>
          <LiveStrip
            data={
              data
                ? {
                    subscriptionsCreated: data.subscriptionsCreated,
                    charges: data.charges,
                    escrowWei: data.escrowWei,
                    headBlock: data.headBlock,
                    snapshot: data.provenance.source === "snapshot",
                  }
                : null
            }
          />
        </div>

        <section className={`${GUTTER} ${enter(3)} flex flex-col gap-5 pt-11 lg:pt-14`}>
          <SectionHead note="three ways in, one machine underneath">
            // WHO IS AT THIS PAGE
          </SectionHead>
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
            creatorId={schedule ? schedule.creatorId : null}
            snapshot={data?.provenance.source === "snapshot"}
          />
        </div>

        <div className={`${GUTTER} pt-10 pb-12 lg:pt-12`}>
          <ClosingLine compact={compact} />
        </div>
      </main>

      <SiteFooter
        snapshot={data?.provenance.source === "snapshot"}
        voyagerLabel="every charge verifiable on voyager"
        links={[
          { label: "github", href: "https://github.com/kshitij-hash/nightshift" },
          { label: "the board", to: "/board" },
        ]}
      />
    </div>
  );
}
