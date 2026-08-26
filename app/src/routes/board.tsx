// The live board, Modernist frame. Four figures with their basis, the charge
// feed decoded from mainnet events, and the one element on the page that
// writes: the permissionless charge panel. The committed snapshot appears
// only as the automatic fallback when every RPC endpoint fails, labelled as
// such - there is no manual switch into a degraded state. ?demo=1 keeps the
// recorded-demo replay: real rows, re-landed on a timer, labelled as a
// replay.

import { useQueryClient } from "@tanstack/react-query";
import { useSearch } from "@tanstack/react-router";
import { useCallback } from "react";

import { ChargePanelM } from "../components/board/charge-panel-m";
import { LiveNumber } from "../components/dashboard/tile";
import { deriveWindow, hms, liveCommitment, utcTime } from "../components/board/derive";
import { REPLAY_INTERVAL_SECS, useReplay } from "../components/board/use-replay";
import { Masthead } from "../components/masthead";
import { SiteFooter } from "../components/site-footer";
import { fmtBlock, fmtStrk, truncate, VOYAGER_TX } from "../config";
import { useBoard } from "../query/useBoard";
import { useSchedule } from "../query/useSchedule";

const GUTTER = "px-5 lg:px-10";

function Stat({
  label,
  value,
  note,
  first = false,
}: {
  label: string;
  value: React.ReactNode;
  note: React.ReactNode;
  first?: boolean;
}) {
  return (
    <div className={`py-6 pr-6 ${first ? "" : "border-l border-divider pl-6"} max-lg:border-l-0 max-lg:pl-0 max-lg:not-first:border-t max-lg:not-first:border-divider`}>
      <div className="mb-2.5 text-[11px] tracking-[0.1em] uppercase text-text-caption">
        {label}
      </div>
      <div
        className="text-[30px] leading-none font-[800] tracking-[-0.03em] tabular lg:text-[34px]"
        style={{ fontFamily: "var(--font-heading)" }}
      >
        {value}
      </div>
      <div className="mt-2 text-[12px] text-text-label">{note}</div>
    </div>
  );
}

export function BoardRoute() {
  const search = useSearch({ from: "/board" });
  const query = useBoard();

  const live = query.data ?? null;
  const rpcDown = live !== null && live.provenance.source === "snapshot";
  const showingSnapshot = rpcDown;
  const data = live;

  const commitment = live ? liveCommitment(live.charges) : null;
  const schedule = useSchedule(commitment).data ?? null;

  const demo = search.demo === true && !showingSnapshot && live !== null;
  const replay = useReplay(live?.charges ?? [], demo);
  const charges = demo && replay ? replay.charges : (data?.charges ?? []);

  const queryClient = useQueryClient();
  const onCharged = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["board"] });
    void queryClient.invalidateQueries({ queryKey: ["schedule"] });
  }, [queryClient]);

  const window_ = data
    ? deriveWindow(showingSnapshot ? null : schedule, data.headBlock, data.headTimestamp)
    : null;

  const nextDue =
    window_ === null || showingSnapshot
      ? { value: "—", note: "countdown not running on a snapshot" }
      : window_.cancelled
        ? { value: "—", note: "the live subscription is cancelled; no further charge can fire" }
        : window_.complete
          ? { value: "—", note: "all periods of the live schedule are charged" }
          : window_.block === null
            ? { value: "—", note: "no schedule read yet" }
            : window_.overdue
              ? {
                  value: fmtBlock(window_.block),
                  note: "window open: anyone may fire this charge, right now",
                }
              : {
                  value: fmtBlock(window_.block),
                  note: `≈ ${hms(Math.max(0, (window_.ts ?? 0) - (data?.headTimestamp ?? 0)))} at 1.7 s per block; the charge is block-gated, not clock-gated`,
                };

  const chargeCountNote = (() => {
    const withAmount = charges.filter((c) => c.amountWei !== null);
    const gross = withAmount.reduce((s, c) => s + (c.amountWei ?? 0n), 0n);
    return withAmount.length > 0 ? `${fmtStrk(gross)} STRK gross, from Charged events` : "decoded from mainnet logs";
  })();

  return (
    <div className="flex min-h-screen flex-col">
      <Masthead active="board" />

      <main className={`${GUTTER} flex-1 py-9`}>
        <div className="flex flex-wrap items-end gap-6 border-b-2 border-divider pb-5">
          <div>
            <div className="mb-2.5 text-[11px] tracking-[0.14em] uppercase text-ns-accent">
              ▸ Keyless · reads mainnet over JSON-RPC
            </div>
            <h2 className="text-[30px] tracking-[-0.03em] lg:text-[38px]">Live board</h2>
          </div>
          {showingSnapshot && data ? (
            <span className="m-tag m-tag-outline ml-auto">
              Snapshot @ block {fmtBlock(data.headBlock)}
            </span>
          ) : null}
        </div>

        {showingSnapshot && data ? (
          <div className="mt-5 flex items-start gap-3.5 border-2 border-ns-accent p-4">
            <span
              className="font-[800] text-ns-accent"
              style={{ fontFamily: "var(--font-heading)" }}
            >
              !
            </span>
            <div className="text-[13.5px] leading-[1.55]">
              The RPC endpoints are not answering right now, so this is the
              committed snapshot at block {fmtBlock(data.headBlock)}. Figures
              are frozen at that block; the page returns to live reads on its
              own as soon as an endpoint answers.
            </div>
          </div>
        ) : null}

        {demo && replay ? (
          <div className="mt-5 flex items-start gap-3.5 border-2 border-divider p-4">
            <span className="m-tag m-tag-accent">Demo replay</span>
            <div className="text-[13.5px] leading-[1.55]">
              Real mainnet rows, re-landed one every {REPLAY_INTERVAL_SECS} seconds:{" "}
              {replay.landed} of {replay.held} landed. Remove ?demo=1 for the live feed.
            </div>
          </div>
        ) : null}

        {!showingSnapshot && data && data.provenance.partial.length > 0 ? (
          <div className="mt-5 border border-divider p-3.5 text-[12.5px] text-text-label">
            Partial read: {data.provenance.partial.join(" · ")}
          </div>
        ) : null}

        {data === null ? (
          <div className="mt-8 text-[14px] text-text-label">Reading Starknet mainnet…</div>
        ) : (
          <>
            <div className="grid border-b-2 border-divider lg:grid-cols-4">
              <Stat
                first
                label="Head block"
                value={<LiveNumber value={data.headBlock} />}
                note={
                  showingSnapshot
                    ? "snapshot · not the head"
                    : "lava.build, then blastapi: first endpoint that answers"
                }
              />
              <Stat
                label="Escrow held"
                value={<LiveNumber value={Number(fmtStrk(data.escrowWei))} decimals={2} />}
                note="STRK, accounted custody: balance minus donations"
              />
              <Stat
                label="Active subscriptions"
                value={<LiveNumber value={data.activeSubscriptions} />}
                note="not cancelled · periods left · escrow covers a tier price"
              />
              <Stat
                label="Next charge due"
                value={
                  nextDue.value === "—" ? "—" : <LiveNumber value={Number(nextDue.value.replace(/,/g, ""))} />
                }
                note={nextDue.note}
              />
            </div>

            <div className="grid lg:grid-cols-[8fr_4fr]">
              <div className="py-7 lg:pr-8">
                <div className="mb-4 flex flex-wrap items-baseline gap-3.5">
                  <div className="text-[11px] tracking-[0.1em] uppercase text-text-caption">
                    Charge feed · decoded from Charged events
                  </div>
                  <div className="ml-auto text-[12px] text-text-caption">{chargeCountNote}</div>
                </div>
                {charges.length === 0 ? (
                  <div className="border border-divider p-5 text-[13.5px] text-text-label">
                    No charge has been decoded yet
                    {demo ? "; the replay lands its first row shortly." : "."}
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="m-table min-w-[640px]">
                      <thead>
                        <tr>
                          <th>Block</th>
                          <th>UTC</th>
                          <th>Period</th>
                          <th>Commitment</th>
                          <th>Amount</th>
                          <th>Vault</th>
                          <th style={{ textAlign: "right" }}>Receipt</th>
                        </tr>
                      </thead>
                      <tbody>
                        {charges.map((c) => (
                          <tr key={`${c.txHash}:${c.periodIndex}`}>
                            <td className="font-mono text-[12.5px]">{fmtBlock(c.block)}</td>
                            <td className="font-mono text-[12.5px]">{utcTime(c.timestamp)}</td>
                            <td>{String(c.periodIndex).padStart(2, "0")}</td>
                            <td className="font-mono text-[12.5px]">{truncate(c.commitment)}</td>
                            <td>{c.amountWei !== null ? `${fmtStrk(c.amountWei)} STRK` : "—"}</td>
                            <td>{c.vault}</td>
                            <td className="text-right font-mono text-[12.5px]">
                              <a href={VOYAGER_TX(c.txHash)} target="_blank" rel="noreferrer">
                                {truncate(c.txHash)} ↗
                              </a>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <div className="mt-5 max-w-[82ch] text-[12.5px] leading-[1.6] text-text-label">
                  A charge names the vault, an amount, a period index and a
                  nullifier. It does not name the subscriber. All periods of one
                  subscription share a commitment: that is public, and never
                  linked to a wallet.
                </div>
              </div>

              <div className="border-t-2 border-divider py-7 lg:border-t-0 lg:border-l-2 lg:pl-8">
                <ChargePanelM commitment={commitment} onSubmitted={onCharged} />
              </div>
            </div>
          </>
        )}
      </main>

      <SiteFooter
        className="mt-0"
        snapshot={showingSnapshot}
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
