// The creator dashboard.
//
// Reading order is the argument, the same way the board's is, but the rhythm
// is deliberately looser: this surface is read, not watched. Provenance
// first, because a reader has to know where the numbers came from before the
// numbers mean anything. Then the six figures with their bases. Then the
// timeline, which is the evidence under the figures. Then the subscriptions,
// which is the evidence under the timeline, and where the lifecycle is stated:
// what ends a subscription, and that nothing here renews itself.
//
// Nothing on this page is a placeholder. Every branch below is a real answer:
// no id pasted, an id that matched nothing, a scan that stopped short, a read
// still in flight, and the full ledger. The first four get the same design
// attention as the last one, because on a surface keyed by a pasted id they
// are the states most readers will actually see.

import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";

import { SectionHead } from "../components/board/primitives";
import { CreatorIds } from "../components/dashboard/creator-ids";
import {
  ledgerIsEmpty,
  perIdSummaries,
  revenueSeries,
  stampUtc,
  subscriptionRows,
} from "../components/dashboard/derive";
import { checkedAtBlock, MetricTiles } from "../components/dashboard/metric-tiles";
import { RevenueTimeline } from "../components/dashboard/revenue-timeline";
import { DashboardSkeleton, ProvenanceBannerSkeleton } from "../components/dashboard/skeletons";
import {
  ChainChip,
  FreshCreator,
  PartialScanBanner,
  ProvenanceBanner,
  RejectedIds,
  UnknownCreator,
} from "../components/dashboard/states";
import { getRpcClient } from "../lib/rpc-instance";
import { tierOf } from "../lib/rpc/views";
import { SubscriptionTable } from "../components/dashboard/subscription-table";
import { CaveatDisclosure } from "../components/dashboard/tile";
import { useIsNarrow } from "../components/dashboard/use-media";
import { Masthead } from "../components/masthead";
import { SiteFooter } from "../components/site-footer";
import { Badge } from "../components/ui/badge";
import { usePageTitle } from "../lib/use-title";
import { useCreatorLedger } from "../query/useCreatorLedger";
import { splitCreatorIds } from "../router";

/** The links out, identical in all five states this route can be in. */
const FOOTER_LINKS = [
  { label: "npm nightshift-verify", href: "https://www.npmjs.com/package/nightshift-verify" },
  { label: "the evidence board", to: "/board" as const },
];

/** The dashboard's rhythm is not uniform: the metrics and the timeline under
 *  them are one thought at 32px, and the two sections that follow are separate
 *  ones at 64px. */
const SECTIONS = "flex flex-col gap-8 py-10";
const BREAK = "mt-8";
const PAGE = "flex min-h-screen w-full flex-col";
const GUTTER = "flex-1 px-5 lg:px-10";

export function CreatorRoute() {
  usePageTitle("Creator ledger");
  const search = useSearch({ from: "/creator" });
  const navigate = useNavigate({ from: "/creator" });
  const narrow = useIsNarrow();

  const ids = splitCreatorIds(search.creator);
  const { data, isPending, isError, error, isFetching } = useCreatorLedger(ids);

  // resetScroll: false: the id list is this page's subject, edited in a bar
  // partway down it, and every edit is a navigation. The router resets scroll
  // on a committed navigation by default, which is right between pages and
  // wrong here: adding a second creator id would throw the reader to the top
  // of the page, away from the control they just used.
  const setIds = (next: string[]) => {
    void navigate({
      search: (prev) => ({
        ...prev,
        creator: next.length > 0 ? next.join(",") : undefined,
        // A new list supersedes whatever was rejected out of the old one.
        invalidCreator: undefined,
      }),
      resetScroll: false,
    });
  };

  const ledger = data?.ledger;
  const summaries = ledger ? perIdSummaries(ledger, ids) : undefined;
  /** The 120 second poll only runs while there is something to poll for. */
  const live = ids.length > 0 && !isError;

  /* An empty ledger is two different situations wearing one shape: an id
   * nobody registered, and a creator who registered minutes ago and has no
   * subscribers yet. The event scan cannot tell them apart - registration is
   * a storage write the ledger's events never mention - so the split comes
   * from tier_of, read only when the ledger came back empty. */
  const emptyLedger = ledger !== undefined && ledgerIsEmpty(ledger);
  const regCheck = useQuery({
    queryKey: ["creator-registered", ids],
    enabled: emptyLedger && ids.length > 0,
    staleTime: 60_000,
    queryFn: async () => {
      const client = getRpcClient();
      const out: Array<{ id: string; tiers: Array<{ index: number; amountWei: bigint }> }> = [];
      for (const id of ids) {
        const probed = await Promise.all(
          Array.from({ length: 8 }, (_, i) => tierOf(client, id, i)),
        );
        const tiers = probed
          .map((t, index) => ({ index, amountWei: t.amountWei, token: BigInt(t.token) }))
          .filter((t) => t.token !== 0n && t.amountWei > 0n)
          .map(({ index, amountWei }) => ({ index, amountWei }));
        if (tiers.length > 0) out.push({ id, tiers });
      }
      return out;
    },
  });

  // --- no id pasted: the entry state ---------------------------------------
  if (ids.length === 0) {
    return (
      <div className={PAGE}>
        <Masthead active="dashboard" chip={<ChainChip headBlock={null} live={false} />} />
        <main className={GUTTER}>
          <div className={SECTIONS}>
            <div className="border-b-2 border-divider pb-5">
              <div className="mb-2.5 text-[11px] tracking-[0.14em] uppercase text-ns-accent">
                ▸ Paste a creator id · nothing is stored, nothing is sent anywhere
              </div>
              <h2 className="text-[30px] tracking-[-0.03em] lg:text-[38px]">Creator ledger</h2>
            </div>
            {search.invalidCreator ? <RejectedIds raw={search.invalidCreator} /> : null}
            <CreatorIds ids={ids} summaries={undefined} onChange={setIds} variant="entry" />
            <div className="grid gap-5 border-2 border-divider p-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center lg:p-7">
              <div>
                <div className="mb-2 text-[11px] tracking-[0.14em] uppercase text-ns-accent">
                  ▸ No id, because the creator is you?
                </div>
                <p className="max-w-[62ch] text-[14px] leading-[1.6] text-text-prose">
                  Set 1-3 tier prices and register them in one public
                  transaction. You get a creator id and a link to share; your
                  audience subscribes through it privately, and this page
                  becomes your ledger.
                </p>
              </div>
              <Link
                to="/creator/register"
                className="m-btn m-btn-primary text-[15px]"
                style={{ padding: "13px 22px" }}
              >
                Become a creator →
              </Link>
            </div>
            <section className="flex flex-col gap-4">
              <SectionHead note="the same figures, whoever asks">
                // WHAT THIS PAGE DERIVES
              </SectionHead>
              <p className="max-w-[130ch] text-[14px] leading-[1.7] text-text-prose">
                Gross revenue and its split, escrow-backed MRR, funded and entitled
                subscriptions, arrears, the timeline, and one row per subscription. Every figure
                shows the rule it came from.
              </p>
            </section>
          </div>
        </main>
        <SiteFooter ids={ids} links={FOOTER_LINKS} />
      </div>
    );
  }

  // --- the read is in flight -----------------------------------------------
  if (isPending) {
    return (
      <div className={PAGE}>
        <Masthead active="dashboard" chip={<ChainChip headBlock={null} live={true} />} />
        <main className={GUTTER}>
          <div className={SECTIONS}>
            {/* Same order as the loaded page: banner, then the id bar, then
                the ledger. The banner used to arrive with the ledger, below
                the bar, which meant the dashboard dropped 116px the moment
                the read landed. */}
            {search.invalidCreator ? <RejectedIds raw={search.invalidCreator} /> : null}
            <ProvenanceBannerSkeleton />
            <CreatorIds ids={ids} summaries={undefined} onChange={setIds} variant="bar" />
            <DashboardSkeleton />
          </div>
        </main>
        <SiteFooter ids={ids} links={FOOTER_LINKS} />
      </div>
    );
  }

  // --- the query machinery broke -------------------------------------------
  // assembleCreatorLedger degrades read by read rather than rejecting, so
  // reaching here means the query failed, not the chain read.
  if (isError || data === undefined || ledger === undefined) {
    return (
      <div className={PAGE}>
        <Masthead active="dashboard" />
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
        <SiteFooter ids={ids} links={FOOTER_LINKS} />
      </div>
    );
  }

  const rows = subscriptionRows(ledger);
  const points = revenueSeries(ledger);
  const empty = ledgerIsEmpty(ledger);
  const capped = ledger.provenance.truncated;
  const first = points[0];
  const last = points[points.length - 1];
  const presentations = data.metrics.presentationsToDate;

  return (
    <div className={PAGE}>
      <Masthead
        active="dashboard"
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
          <div className="border-b-2 border-divider pb-5">
            <div className="mb-2.5 text-[11px] tracking-[0.14em] uppercase text-ns-accent">
              ▸ Read from the public record
            </div>
            <h2 className="text-[30px] tracking-[-0.03em] lg:text-[38px]">Creator ledger</h2>
          </div>

          {search.invalidCreator ? <RejectedIds raw={search.invalidCreator} /> : null}
          <ProvenanceBanner ledger={ledger} live={live} />
          <PartialScanBanner ledger={ledger} />
          <CreatorIds ids={ids} summaries={summaries} onChange={setIds} variant="bar" />

          {empty ? (
            // isPending alone: inside this branch the query is enabled, so
            // pending means "no answer yet" and never "switched off" - and
            // gating on isFetching too would flash the unknown-id card for
            // the frame before the fetch starts.
            regCheck.isPending ? (
              <p className="text-[13px] leading-[1.6] text-text-caption">
                No events yet - asking the vault whether{" "}
                {ids.length === 1 ? "this id is" : "these ids are"} registered…
              </p>
            ) : (
              (() => {
                const fresh = regCheck.data ?? [];
                const freshKeys = new Set(fresh.map((f) => BigInt(f.id).toString()));
                const unknown = ids.filter((id) => !freshKeys.has(BigInt(id).toString()));
                return (
                  <>
                    {fresh.length > 0 ? <FreshCreator entries={fresh} /> : null}
                    {unknown.length > 0 || fresh.length === 0 ? (
                      <UnknownCreator ids={unknown.length > 0 ? unknown : ids} ledger={ledger} />
                    ) : null}
                  </>
                );
              })()
            )
          ) : (
            <>
              <section className="flex flex-col gap-5">
                {/* The six tiles no longer print the head block each, because
                    all six are read at the same one. It lives here, once. */}
                <SectionHead
                  note={`${
                    isFetching
                      ? "re-reading the event log"
                      : "each figure carries the rule it came from"
                  } · ${checkedAtBlock(ledger)}`}
                >
                  // METRICS · WITH THEIR BASIS
                </SectionHead>
                <MetricTiles metrics={data.metrics} ledger={ledger} />
                <p className="max-w-[100ch] text-[12px] leading-[1.6] text-text-caption">
                  Computed from the vault's public event log — anyone reading
                  the chain gets the same figures. What stays hidden is the
                  subscriber behind each subscription.
                </p>
              </section>

              <section className="flex flex-col gap-5">
                <SectionHead note="cumulative, from real charges">
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
                          subscription{rows.length === 1 ? "" : "s"}
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
                          subscriptions, or any revenue that did not pass through this vault.
                          Creator totals are public by design; the subscriber behind each one is
                          not.
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
                    Every state tag and money column carries its definition. Hover or focus it. A
                    subscription never renews itself and the vault cannot ask: a renewal is a fresh
                    subscribe, and it arrives as a new subscription rather than as an extension of
                    an old one.
                  </p>
                  <div className="flex flex-wrap items-start gap-4">
                    <p className="max-w-[70ch] text-[12px] leading-[1.6] text-text-caption">
                      {presentations.value.total} gate presentation
                      {presentations.value.total === 1 ? "" : "s"} recorded for these subscriptions,
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
            </>
          )}
        </div>
      </main>

      <SiteFooter ids={ids} links={FOOTER_LINKS} />
    </div>
  );
}
