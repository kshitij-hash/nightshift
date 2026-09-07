// Receipts: the one page that shows the machinery, for the curious and the
// skeptical. Every payment, public. Every person, not.

import { Link } from "@tanstack/react-router";
import NumberFlow from "@number-flow/react";
import { useState } from "react";

import { liveCommitment } from "../components/board/derive";
import { Swap } from "../components/shell/motion";
import { Column, Display, Kicker, Page } from "../components/shell/page";
import { useNow } from "../components/shell/sheet";
import { VAULT, VOYAGER_CONTRACT, VOYAGER_TX } from "../config";
import { relativeSoon, secondsUntilBlock, shortId, stamp, strk } from "../lib/format";
import { checkReceipt, type ReceiptVerdict } from "../lib/receipt-check";
import { usePageTitle } from "../lib/use-title";
import { useBoard } from "../query/useBoard";
import { useSchedule } from "../query/useSchedule";

const PAGE = 8;

function Check({ ok, children }: { ok: boolean | null; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <span
        className="grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full text-[11px] font-[700]"
        style={{
          background: ok === true ? "var(--ad-rose)" : ok === false ? "var(--ad-danger)" : "var(--ad-silhouette-2)",
          color: ok === null ? "var(--ad-dim)" : "var(--ad-on-rose)",
        }}
      >
        {ok === true ? "✓" : ok === false ? "×" : "?"}
      </span>
      <span className="text-[14px] text-ink-2">{children}</span>
    </div>
  );
}

function CheckOne() {
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [verdict, setVerdict] = useState<ReceiptVerdict | null>(null);

  const run = async () => {
    setBusy(true);
    setVerdict(await checkReceipt(input));
    setBusy(false);
  };

  return (
    <div className="ad-card flex flex-col gap-4 p-6">
      <Kicker>Check one yourself</Kicker>
      <div className="flex gap-2">
        <input
          className="ad-input"
          type="text"
          placeholder="paste a receipt · 0x…"
          value={input}
          aria-label="receipt hash"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void run();
          }}
        />
        <button type="button" className="ad-pill ad-pill-ghost" disabled={busy || input.trim() === ""} onClick={() => void run()}>
          {busy ? "…" : "Check"}
        </button>
      </div>
      {verdict === null ? (
        <p className="ad-swap block text-[13px] leading-[1.6] text-dim">
          Four plain questions, answered from the network: was it paid the period it was due, at
          exactly the advertised price, to the creator and nowhere else, with no name attached.
        </p>
      ) : verdict.status === "checked" ? (
        <div key={verdict.txHash} className="ad-swap flex flex-col gap-3">
          <Check ok={verdict.onTime}>
            {verdict.onTime === null
              ? "Due date unknown (the schedule could not be read)"
              : verdict.onTime
                ? "Paid the period it was due"
                : verdict.lagBlocks !== null && verdict.lagBlocks < 0
                  ? "Paid early, which the network should never allow"
                  : "Paid, but a period late"}
          </Check>
          <Check ok={verdict.exactPrice}>
            {verdict.exactPrice === null
              ? `${strk(verdict.amountWei)} STRK (the published price could not be read)`
              : verdict.exactPrice
                ? `Exactly the advertised price, ${strk(verdict.amountWei)} STRK`
                : `${strk(verdict.amountWei)} STRK, not the ${verdict.priceWei !== null ? strk(verdict.priceWei) : "?"} STRK advertised`}
          </Check>
          <Check ok={verdict.creatorId !== null}>
            {verdict.creatorId !== null ? `Went to creator ${shortId(verdict.creatorId)}, nowhere else` : "The creator could not be read"}
          </Check>
          <Check ok>No wallet, name, or history attached</Check>
          <p className="ad-mono text-[11px] text-faint">
            period {String(verdict.periodIndex + 1).padStart(2, "0")} · block {verdict.block.toLocaleString("en-US")} ·{" "}
            <a href={VOYAGER_TX(verdict.txHash)} target="_blank" rel="noreferrer" className="text-rose">
              the full trace ↗
            </a>
          </p>
        </div>
      ) : (
        <p key={verdict.txHash} className="ad-swap block text-[13px] leading-[1.6] text-dim">
          {verdict.status === "not-found"
            ? "No transaction with that hash. A receipt is 0x followed by up to 64 characters."
            : verdict.status === "not-a-charge"
              ? "That transaction exists, but it is not a NIGHTSHIFT payment."
              : `The network could not be read: ${verdict.message}`}
        </p>
      )}
    </div>
  );
}

export function ReceiptsRoute() {
  usePageTitle("Receipts");
  const board = useBoard().data ?? null;
  const now = useNow();
  const [shown, setShown] = useState(PAGE);
  const commitment = board ? liveCommitment(board.charges) : null;
  const schedule = useSchedule(commitment).data ?? null;

  const charges = board ? board.charges.filter((c) => c.amountWei !== null) : [];
  const total = charges.reduce((s, c) => s + (c.amountWei ?? 0n), 0n);
  const nextBlock =
    schedule && !schedule.cancelled && schedule.nextPeriod < schedule.nPeriods
      ? schedule.startBlock + schedule.nextPeriod * schedule.periodBlocks
      : null;
  const nextSecs = nextBlock !== null && board ? secondsUntilBlock(nextBlock, board.headBlock, board.headTimestamp, now) : null;

  return (
    <Page>
      <main className="flex flex-1 flex-col py-10 lg:py-14">
        <Column className="flex flex-col gap-10">
          <div className="grid items-end gap-10 lg:grid-cols-[7fr_5fr]">
            <div className="ad-enter flex flex-col gap-4">
              <Kicker>For the curious and the skeptical</Kicker>
              <Display size="lg">
                Every payment, public.
                <br />
                Every person, not.
              </Display>
              <p className="max-w-[52ch] text-[17px] leading-[1.6] text-dim">
                This is the one page that shows the machinery. Anyone can check that every
                subscription paid the right creator the right amount on the right day, and that
                no receipt names a fan.
              </p>
            </div>
            <div className="ad-card-rose ad-enter ad-enter-2 grid grid-cols-3 gap-4 p-6">
              <div className="flex flex-col gap-1">
                <span className="ad-mono text-[10px] tracking-[0.16em] text-faint uppercase">Payments made</span>
                <span className="ad-display text-[24px] tabular lg:text-[28px]">
                  {board ? <NumberFlow value={charges.length} respectMotionPreference /> : "…"}
                </span>
              </div>
              <div className="flex flex-col gap-1">
                <span className="ad-mono text-[10px] tracking-[0.16em] text-faint uppercase">Paid to creators</span>
                <span className="ad-display text-[24px] text-rose tabular lg:text-[28px]">
                  {board ? (
                    <>
                      <NumberFlow value={Number(strk(total))} format={{ maximumFractionDigits: 2 }} respectMotionPreference /> STRK
                    </>
                  ) : (
                    "…"
                  )}
                </span>
              </div>
              <div className="flex flex-col gap-1">
                <span className="ad-mono text-[10px] tracking-[0.16em] text-faint uppercase">Names on file</span>
                <span className="ad-display text-[24px] tabular lg:text-[28px]">0</span>
              </div>
            </div>
          </div>

          <div className="ad-enter ad-enter-3 grid items-start gap-5 lg:grid-cols-[7fr_5fr]">
            {/* ── ledger ── */}
            <div className="ad-hair flex flex-col">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
                <Kicker>Latest receipts · live</Kicker>
                <span className="ad-mono flex items-center gap-2 text-[11px] text-dim">
                  <span
                    className="inline-block h-2 w-2 rounded-full bg-rose"
                    style={{ animation: "ns-heartbeat var(--heartbeat) ease-in-out infinite" }}
                    aria-hidden="true"
                  />
                  <Swap>
                    {nextSecs === null ? "reading the schedule…" : nextSecs <= 0 ? "next one due now" : `next one due ${relativeSoon(nextSecs)}`}
                  </Swap>
                </span>
              </div>
              <div className="overflow-x-auto">
                <div className="min-w-[560px]">
                  <div className="ad-mono grid grid-cols-[120px_1fr_90px_140px] gap-3 border-b border-line px-5 py-3 text-[10px] tracking-[0.14em] text-faint uppercase">
                    <span>When</span>
                    <span>Subscription</span>
                    <span>Amount</span>
                    <span>Receipt</span>
                  </div>
                  {charges.slice(0, shown).map((c, i) => (
                    <div
                      key={`${c.txHash}:${c.periodIndex}`}
                      className="ad-mono ad-row grid grid-cols-[120px_1fr_90px_140px] gap-3 border-b border-line px-5 py-3.5 text-[13px]"
                      style={{ "--i": i } as React.CSSProperties}
                    >
                      <span className="text-dim">{stamp(c.timestamp)}</span>
                      <span className="text-ink">
                        {shortId(c.commitment)} <span className="text-faint">· period {String(c.periodIndex + 1).padStart(2, "0")}</span>
                      </span>
                      <span className="text-ink">{strk(c.amountWei ?? 0n)} STRK</span>
                      <a href={VOYAGER_TX(c.txHash)} target="_blank" rel="noreferrer" className="text-rose">
                        {shortId(c.txHash)} ↗
                      </a>
                    </div>
                  ))}
                  {charges.length === 0 ? (
                    <p className="px-5 py-6 text-[14px] text-dim">{board ? "No payments decoded yet." : "Reading the network…"}</p>
                  ) : null}
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 text-[13px] text-faint">
                <span>Each receipt opens on a public block explorer. Notice the column that is missing.</span>
                {charges.length > shown ? (
                  <button type="button" className="text-dim hover:text-ink" onClick={() => setShown((n) => n + PAGE)}>
                    Show more
                  </button>
                ) : null}
              </div>
            </div>

            {/* ── check + why ── */}
            <div className="flex flex-col gap-5">
              <CheckOne />
              <div className="ad-hair flex flex-col gap-3 p-6">
                <Kicker dim>Why this holds up</Kicker>
                <p className="text-[14px] leading-[1.6] text-ink-2">
                  The money moves on Starknet, in public, on a schedule nobody can skip. The fan is
                  represented by a one-time stub that cannot be traced back to a wallet. Cancelling
                  is a single signed tap that no one, including us, can block.
                </p>
                <div className="flex flex-wrap gap-x-5 gap-y-2 pt-1 text-[13px]">
                  <Link to="/board" className="text-dim hover:text-ink">
                    Show the live details →
                  </Link>
                  <Link to="/verify" className="text-dim hover:text-ink">
                    Run a door check →
                  </Link>
                  <a href={`${VOYAGER_CONTRACT(VAULT)}#events`} target="_blank" rel="noreferrer" className="text-dim hover:text-ink">
                    The contract ↗
                  </a>
                </div>
              </div>
            </div>
          </div>
        </Column>
      </main>
    </Page>
  );
}
