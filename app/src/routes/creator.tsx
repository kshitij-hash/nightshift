// The creator dashboard.
//
// Reading order is the argument, the same way the board's is, but the rhythm
// is deliberately looser: this surface is read, not watched. Provenance
// first, because a reader has to know where the numbers came from before the
// numbers mean anything. Then the six figures with their bases. Then the
// timeline, which is the evidence under the figures. Then the subscriptions,
// which is the evidence under the timeline. Churn last, because it is the
// only section about what stopped rather than what is running.
//
// Nothing on this page is a placeholder. Every branch below is a real answer:
// no id pasted, an id that matched nothing, a scan that stopped short, a read
// still in flight, and the full ledger. The first four get the same design
// attention as the last one, because on a surface keyed by a pasted id they
// are the states most readers will actually see.

import { useNavigate, useSearch } from "@tanstack/react-router";

import { SectionHead } from "../components/board/primitives";
import { ChurnTiles } from "../components/dashboard/churn-tiles";
import { CreatorIds } from "../components/dashboard/creator-ids";
import {
  ledgerIsEmpty,
  perIdSummaries,
  revenueSeries,
  stampUtc,
  subscriptionRows,
} from "../components/dashboard/derive";
import { DashboardFooter } from "../components/dashboard/footer";
import { MetricTiles } from "../components/dashboard/metric-tiles";
import { RevenueTimeline } from "../components/dashboard/revenue-timeline";
import { DashboardSkeleton } from "../components/dashboard/skeletons";
import {
  ChainChip,
  PartialScanBanner,
  ProvenanceBanner,
  RejectedIds,
  UnknownCreator,
} from "../components/dashboard/states";
import { SubscriptionTable } from "../components/dashboard/subscription-table";
import { CaveatDisclosure } from "../components/dashboard/tile";
import { useIsNarrow } from "../components/dashboard/use-media";
import { Masthead } from "../components/masthead";
import { Badge } from "../components/ui/badge";
import { fmtBlock, fmtStrk } from "../config";
import { useCreatorLedger } from "../query/useCreatorLedger";
import { splitCreatorIds } from "../router";

const SENTENCE =
  "A creator ledger, summed in this browser from the vault's public event log. Anyone can derive the same figures.";
const RIGHT = "read only · no wallet connected · no key required";

/** The dashboard's rhythm is not uniform: the metrics and the timeline under
 *  them are one thought at 32px, and the two sections that follow are separate
 *  ones at 64px. */
const SECTIONS = "flex flex-col gap-8 py-10";
const BREAK = "mt-8";
const PAGE = "mx-auto flex w-full max-w-[1200px] flex-col";
const GUTTER = "flex-1 px-5 lg:px-10";

export function CreatorRoute() {
  const search = useSearch({ from: "/creator" });
  const navigate = useNavigate({ from: "/creator" });
  const narrow = useIsNarrow();

  const ids = splitCreatorIds(search.creator);
  const { data, isPending, isError, error, isFetching } = useCreatorLedger(ids);

  const setIds = (next: string[]) => {
    void navigate({
      search: (prev) => ({
        ...prev,
        creator: next.length > 0 ? next.join(",") : undefined,
        // A new list supersedes whatever was rejected out of the old one.
        invalidCreator: undefined,
      }),
    });
  };

  const ledger = data?.ledger;
  const summaries = ledger ? perIdSummaries(ledger, ids) : undefined;
  /** The 120 second poll only runs while there is something to poll for. */
  const live = ids.length > 0 && !isError;

  // --- no id pasted: the entry state ---------------------------------------
  if (ids.length === 0) {
    return (
      <div className={PAGE}>
        <Masthead
          active="dashboard"
          sentence={SENTENCE}
          right={RIGHT}
          chip={<ChainChip headBlock={null} live={false} />}
        />
        <main className={GUTTER}>
          <div className={SECTIONS}>
            {search.invalidCreator ? <RejectedIds raw={search.invalidCreator} /> : null}
            <CreatorIds ids={ids} summaries={undefined} onChange={setIds} variant="entry" />
            <section className="flex flex-col gap-4">
              <SectionHead note="the same figures, whoever asks">
                // WHAT THIS PAGE DERIVES
              </SectionHead>
              <p className="max-w-[130ch] text-[14px] leading-[1.7] text-text-prose">
                Gross revenue and its split, the escrowed run rate, funded and entitled
                subscriptions, arrears, the timeline, one row per commitment, and churn. Each
                figure prints the rule it came from, and an empty dashboard is a legitimate state.
              </p>
            </section>
          </div>
        </main>
        <DashboardFooter ids={ids} />
      </div>
    );
  }

  // --- the read is in flight -----------------------------------------------
  if (isPending) {
    return (
      <div className={PAGE}>
        <Masthead
          active="dashboard"
          sentence={SENTENCE}
          right={RIGHT}
          chip={<ChainChip headBlock={null} live={true} />}
        />
        <main className={GUTTER}>
          <div className={SECTIONS}>
            {search.invalidCreator ? <RejectedIds raw={search.invalidCreator} /> : null}
            <CreatorIds ids={ids} summaries={undefined} onChange={setIds} variant="bar" />
            <DashboardSkeleton />
          </div>
        </main>
        <DashboardFooter ids={ids} />
      </div>
    );
  }

  // --- the query machinery broke -------------------------------------------
  // assembleCreatorLedger degrades read by read rather than rejecting, so
  // reaching here means the query failed, not the chain read.
  if (isError || data === undefined || ledger === undefined) {
    return (
      <div className={PAGE}>
        <Masthead active="dashboard" sentence={SENTENCE} right={RIGHT} />
        <main className={GUTTER}>
          <div className={SECTIONS}>
            {search.invalidCreator ? <RejectedIds raw={search.invalidCreator} /> : null}
            <CreatorIds ids={ids} summaries={undefined} onChange={setIds} variant="bar" />
            <p className="max-w-[70ch] text-[14px] leading-[1.7] text-destructive">
              The ledger query failed to run:{" "}
              {error instanceof Error ? error.message : String(error)}. Reload the page. If it keeps
              failing, the vault event log on Voyager carries the same events this page reads.
            </p>
          </div>
        </main>
        <DashboardFooter ids={ids} />
      </div>
    );
  }

  const rows = subscriptionRows(ledger);
  const points = revenueSeries(ledger);
  const empty = ledgerIsEmpty(ledger);
  const capped = ledger.provenance.truncated;
  const first = points[0];
  const last = points[points.length - 1];
  const tiers = new Set(rows.filter((r) => r.tier !== null).map((r) => r.tier)).size;
  const presentations = data.metrics.presentationsToDate;

  const description = empty
    ? SENTENCE
    : `Creator ledger for ${ids.length} id${ids.length === 1 ? "" : "s"} at this vault · ` +
      `${rows.length} commitment${rows.length === 1 ? "" : "s"} · ` +
      `${tiers} tier${tiers === 1 ? "" : "s"} · read from public events.`;

  return (
    <div className={PAGE}>
      <Masthead
        active="dashboard"
        sentence={description}
        right={RIGHT}
        chip={<ChainChip headBlock={ledger.headBlock} live={live} />}
        badge={
          capped ? (
            <Badge variant="outline" className="border-ns-accent text-ns-accent">
              PARTIAL SCAN
            </Badge>
          ) : null
        }
      />

      <main className={GUTTER}>
        <div className={SECTIONS}>
          {search.invalidCreator ? <RejectedIds raw={search.invalidCreator} /> : null}
          <ProvenanceBanner ledger={ledger} live={live} />
          <PartialScanBanner ledger={ledger} />
          <CreatorIds ids={ids} summaries={summaries} onChange={setIds} variant="bar" />

          {empty ? (
            <UnknownCreator ids={ids} ledger={ledger} />
          ) : (
            <>
              <section className="flex flex-col gap-5">
                <SectionHead
                  note={
                    isFetching
                      ? "re-reading the event log"
                      : "each figure carries the rule it came from"
                  }
                >
                  // METRICS · WITH THEIR BASIS
                </SectionHead>
                <MetricTiles metrics={data.metrics} ledger={ledger} />
              </section>

              <section className="flex flex-col gap-5">
                <SectionHead note="orange leads, grays behind, zero baseline, direct labels">
                  {`// REVENUE TIMELINE · ${points.length} CHARGE${points.length === 1 ? "" : "S"}`}
                </SectionHead>
                {points.length === 0 ? (
                  <div className="border border-border-panel bg-surface-panel px-6 py-7">
                    <p className="max-w-[70ch] text-[14px] leading-[1.7] text-text-prose">
                      No charge has fired for these commitments yet, so there is no timeline to
                      draw. A subscription that has been signed but not billed sits in the table
                      below with 0 of its periods charged.
                    </p>
                  </div>
                ) : (
                  <div className="flex flex-col gap-4 border border-border-panel bg-surface-panel px-4 py-6 lg:px-6">
                    <RevenueTimeline points={points} compact={narrow} height={narrow ? 190 : 250} />
                    <dl className="flex max-w-[100ch] flex-col gap-2 border-t border-border-row pt-4">
                      <div className="flex flex-col gap-1 sm:flex-row sm:gap-4">
                        <dt className="w-[168px] shrink-0 text-[11px] font-medium tracking-[0.18em] text-text-label">
                          ESTABLISHES
                        </dt>
                        <dd className="text-[13px] leading-[1.7] text-text-prose">
                          {points.length} charge{points.length === 1 ? "" : "s"} totalling{" "}
                          {last ? last.cumulativeLabel : "0.00"} STRK landed against {rows.length}{" "}
                          commitment{rows.length === 1 ? "" : "s"}
                          {first && last
                            ? ` between ${stampUtc(first.ts)} and ${stampUtc(last.ts)}`
                            : ""}
                          , each at or after the block its period was due, which the vault asserts
                          on chain.
                        </dd>
                      </div>
                      <div className="flex flex-col gap-1 sm:flex-row sm:gap-4">
                        <dt className="w-[168px] shrink-0 text-[11px] font-medium tracking-[0.18em] text-text-label">
                          DOES NOT ESTABLISH
                        </dt>
                        <dd className="text-[13px] leading-[1.7] text-text-prose">
                          who subscribed, whether one subscriber holds more than one of these
                          commitments, or any revenue that did not pass through this vault, and a
                          per-creator topline is publicly derivable from these events, which is all
                          this page claims.
                        </dd>
                      </div>
                    </dl>
                  </div>
                )}
              </section>

              <section className={`flex flex-col gap-5 ${BREAK}`}>
                <SectionHead
                  note={`${rows.length} row${rows.length === 1 ? "" : "s"} · state tags carry the lifecycle`}
                >
                  // SUBSCRIPTIONS AT THIS VAULT
                </SectionHead>
                <SubscriptionTable rows={rows} />
                <div className="flex flex-col gap-4">
                  <p className="max-w-[100ch] text-[12px] leading-[1.6] text-text-caption">
                    Every state tag and money column carries its definition. Hover or focus it.
                  </p>
                  <div className="flex flex-wrap items-start gap-4">
                    <p className="max-w-[70ch] text-[12px] leading-[1.6] text-text-caption">
                      {presentations.value.total} gate presentation
                      {presentations.value.total === 1 ? "" : "s"} recorded for these commitments,
                      across {presentations.value.distinctVerifiers} verifier
                      {presentations.value.distinctVerifiers === 1 ? "" : "s"}. Basis:{" "}
                      {presentations.basis}.
                    </p>
                    {presentations.caveat ? (
                      <CaveatDisclosure caveat={presentations.caveat} />
                    ) : null}
                  </div>
                </div>
              </section>

              <section className={`flex flex-col gap-5 ${BREAK}`}>
                <SectionHead note="measured over subscriptions that have ended, not modelled">
                  // CHURN
                </SectionHead>
                <ChurnTiles metrics={data.metrics} ledger={ledger} />
                <p className="max-w-[100ch] text-[12px] leading-[1.6] text-text-caption">
                  A subscription ends when its escrow is spent or when the subscriber cancels. It
                  does not renew itself and the vault cannot ask: a renewal is a fresh subscribe
                  transaction through the pool, and it arrives as a new commitment rather than as an
                  extension of an old one. Claimable right now:{" "}
                  {fmtStrk(data.metrics.settledVsUnsettled.value.unsettledWei)} STRK, as of block{" "}
                  {fmtBlock(ledger.headBlock)}.
                </p>
              </section>
            </>
          )}
        </div>
      </main>

      <DashboardFooter ids={ids} />
    </div>
  );
}
