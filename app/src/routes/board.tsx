// The evidence board.
//
// Reading order is the argument: the instrument says the vault is running, the
// tiles say what it holds, the feed proves every charge, the strip under it
// names the subscription those periods belong to, the charge panel lets a
// reader add one row, and the band below explains the machine, three shut
// lines until it is asked for. Everything above the fold comes from one vault
// read plus one schedule read; nothing on this page is a placeholder and
// nothing is rounded into a claim the chain does not make. The charge panel is
// the one element here that writes, and it writes only when pressed.

import { useQueryClient } from "@tanstack/react-query";
import { useSearch } from "@tanstack/react-router";
import { useCallback } from "react";

import { buildFeedRows, ChargeFeed } from "../components/board/charge-feed";
import { ChargePanel } from "../components/board/charge-panel";
import {
  chargeLagBlocks,
  deriveTicks,
  deriveWindow,
  liveCommitment,
  perPeriodAmount,
  vaultBreakdown,
} from "../components/board/derive";
import { InstrumentPanel } from "../components/board/instrument";
import { FLASH_NUMBER } from "../components/board/motion";
import {
  ChainChip,
  DemoBanner,
  PartialBanner,
  SnapshotBanner,
} from "../components/board/provenance";
import type { BoardMode } from "../components/board/provenance";
import { BoardSkeleton, EmptyFeed, PendingChip } from "../components/board/skeletons";
import { StatRow } from "../components/board/stat-tiles";
import { StoryBand } from "../components/board/story-band";
import { SubjectStrip } from "../components/board/subject-strip";
import { TickBar } from "../components/board/tick-bar";
import { useChainClock, useMediaQuery } from "../components/board/use-clock";
import { useArrivalPulse } from "../components/board/use-fresh-rows";
import { REPLAY_INTERVAL_SECS, useReplay } from "../components/board/use-replay";
import { Masthead } from "../components/masthead";
import { SiteFooter } from "../components/site-footer";
import { Badge } from "../components/ui/badge";
import { fmtBlock } from "../config";
import { useBoard } from "../query/useBoard";
import { useSchedule } from "../query/useSchedule";

export function BoardRoute() {
  const search = useSearch({ from: "/board" });
  const { data, isPending, isError, error } = useBoard();

  const commitment = data ? liveCommitment(data.charges) : null;
  const scheduleQuery = useSchedule(commitment);
  const schedule = scheduleQuery.data ?? null;

  const isSnapshot = data?.provenance.source === "snapshot";
  const demo = search.demo === true && data !== undefined && !isSnapshot;
  const replay = useReplay(data?.charges ?? [], demo);
  const mode: BoardMode = isSnapshot ? "snapshot" : demo ? "demo" : "live";

  const charges = replay ? replay.charges : (data?.charges ?? []);
  const newest = charges[0];
  const newestKey = newest ? `${newest.txHash}:${newest.periodIndex}` : null;
  const flare = useArrivalPulse(newestKey, FLASH_NUMBER);
  const now = useChainClock(data ? data.headTimestamp : null, !isSnapshot);
  const wide = useMediaQuery("(min-width: 768px)");

  // The charge panel writes; this page reads. The hand-off between them is one
  // invalidation: a charge that was accepted makes both reads stale, so they
  // are re-run, and the arrival choreography this page already owns (the
  // instrument's flare, the feed row's entrance) runs when the new event shows
  // up in them. The panel does not animate that landing a second time.
  const queryClient = useQueryClient();
  const onCharged = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["board"] });
    void queryClient.invalidateQueries({ queryKey: ["schedule"] });
  }, [queryClient]);

  if (isPending) {
    return (
      <div className="mx-auto flex w-full max-w-[1200px] flex-col">
        {/* The chip matches the loaded masthead, so this page opens at the
            height it lands at. It is never simply absent on this surface:
            while the head block is still being read it says so, rather than
            leaving a gap that reads as "this page is not on a chain". */}
        <Masthead active="board" chip={<PendingChip />} />
        <main className="flex-1 px-5 lg:px-10">
          <div className="flex flex-col gap-8 py-8">
            <BoardSkeleton />
          </div>
        </main>
      </div>
    );
  }

  if (isError) {
    // readBoard() never throws: it falls back to the committed snapshot. So
    // reaching this branch means the query itself broke, not the chain read.
    return (
      <div className="mx-auto flex w-full max-w-[1200px] flex-col">
        <Masthead active="board" />
        <main className="flex-1 px-5 py-8 lg:px-10">
          <p className="text-[14px] text-destructive">
            The board query failed to run: {error instanceof Error ? error.message : String(error)}.
            Reload the page; if it keeps failing, read the vault directly on Voyager.
          </p>
        </main>
      </div>
    );
  }

  const nextWindow = deriveWindow(schedule, data.headBlock, data.headTimestamp);
  const ticks = deriveTicks(schedule, charges, data.headBlock);
  const perPeriodWei = perPeriodAmount(charges, commitment);
  const lagBlocks = chargeLagBlocks(schedule, newest ?? null);
  const rows = buildFeedRows(charges, schedule, nextWindow);
  const chargedCount = ticks.filter((t) => t === "ok" || t === "late").length;
  const coveredPeriods =
    schedule && perPeriodWei !== null && perPeriodWei > 0n
      ? Number(schedule.escrowWei / perPeriodWei)
      : null;

  const feedNote =
    mode === "snapshot"
      ? `committed snapshot @ block ${fmtBlock(data.headBlock)}`
      : mode === "demo"
        ? `real rows, replayed on a ${REPLAY_INTERVAL_SECS} second timer`
        : "live via JSON-RPC · falls back to a committed snapshot";

  return (
    <div className="mx-auto flex w-full max-w-[1200px] flex-col">
      <Masthead
        active="board"
        chip={<ChainChip mode={mode} headBlock={data.headBlock} />}
        badge={
          // Demo mode says so in the chain chip and in the banner. A third
          // pill in the masthead would be the same sentence a third time.
          mode === "snapshot" ? (
            <Badge variant="outline" className="border-ns-accent text-ns-accent">
              SNAPSHOT @ BLOCK {fmtBlock(data.headBlock)}
            </Badge>
          ) : null
        }
      />

      <main className="flex-1 px-5 lg:px-10">
        <div className="flex flex-col gap-8 py-8">
          {mode === "snapshot" ? <SnapshotBanner snapshotBlock={data.headBlock} /> : null}
          {mode === "demo" && replay ? (
            <DemoBanner
              landed={replay.landed}
              total={replay.held}
              intervalSecs={REPLAY_INTERVAL_SECS}
            />
          ) : null}
          {mode !== "snapshot" && data.provenance.partial.length > 0 ? (
            <PartialBanner notes={data.provenance.partial} />
          ) : null}

          <InstrumentPanel
            mode={mode}
            now={now}
            headBlock={data.headBlock}
            lastCharge={newest ?? null}
            window={nextWindow}
            lagBlocks={lagBlocks}
            replaySecs={replay ? replay.secsToNext : null}
            replayProgress={replay ? replay.progress : 0}
            flare={flare}
            size={wide ? 320 : 208}
          />

          <StatRow
            custodyWei={data.escrowWei}
            chargeCount={charges.length}
            activeSubscriptions={data.activeSubscriptions}
            vaultBreakdown={vaultBreakdown(data)}
            asOfBlock={data.headBlock}
            still={mode === "snapshot"}
          />

          <div className="flex flex-col gap-3">
            {charges.length === 0 ? (
              <EmptyFeed />
            ) : (
              <ChargeFeed
                rows={rows}
                note={feedNote}
                caption="Decoded from mainnet charge events. This shows what the vault did, not who subscribed. The nullifier is h(commitment ‖ period): write-once, so a period can be charged exactly once."
              />
            )}
            <div className="flex flex-wrap items-center justify-between gap-4">
              {ticks.length > 0 ? (
                <TickBar
                  states={ticks}
                  caption={
                    schedule
                      ? `${chargedCount} of ${ticks.length} periods charged`
                      : `${chargedCount} charge${chargedCount === 1 ? "" : "s"} decoded · no schedule was read, so the denominator is unknown`
                  }
                />
              ) : (
                <span />
              )}
              {coveredPeriods !== null ? (
                <span className="text-[11px] leading-[1.45] text-text-caption">
                  escrow covers {coveredPeriods} further periods
                </span>
              ) : null}
            </div>
            {schedule ? <SubjectStrip schedule={schedule} perPeriodWei={perPeriodWei} /> : null}
          </div>

          <ChargePanel
            commitment={commitment}
            nextPeriod={schedule ? schedule.nextPeriod : null}
            perPeriodWei={perPeriodWei}
            windowBlock={nextWindow.block}
            onSubmitted={onCharged}
          />
        </div>

        <div className="border-t border-border-hairline">
          <StoryBand
            charges={data.charges}
            schedule={schedule}
            perPeriodWei={perPeriodWei}
            ticks={ticks}
          />
        </div>
      </main>

      <SiteFooter
        snapshot={mode === "snapshot"}
        links={[
          { label: "npm nightshift-verify", href: "https://www.npmjs.com/package/nightshift-verify" },
          { label: "npm strk20-preflight", href: "https://www.npmjs.com/package/strk20-preflight" },
          { label: "source on github", href: "https://github.com/kshitij-hash/nightshift" },
          { label: "verify a tier presentation", to: "/verify" },
        ]}
      />
    </div>
  );
}
