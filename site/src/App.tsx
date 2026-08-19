import NumberFlow from "@number-flow/react";
import { useEffect, useMemo, useState } from "react";
import {
  SECONDS_PER_BLOCK,
  VAULT,
  VOYAGER_CONTRACT,
  VOYAGER_TX,
  fmtBlock,
  fmtStrk,
  truncate,
  utc,
} from "./config";
import { readBoard, type BoardState } from "./rpc";

// The demo schedule the board narrates when charges exist: daily periods.
const PERIOD_BLOCKS = 2880;
const N_PERIODS = 3;
const PER_PERIOD_WEI = 10n ** 18n; // 1.00 STRK

function useNow() {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

function hms(total: number) {
  const s = Math.max(0, total);
  const p = (x: number) => String(x).padStart(2, "0");
  return `${p(Math.floor(s / 3600))}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}`;
}

export default function App() {
  const [board, setBoard] = useState<BoardState | null>(null);
  const now = useNow();

  useEffect(() => {
    let alive = true;
    const load = () => readBoard().then((b) => alive && setBoard(b));
    load();
    const t = setInterval(load, 60_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  const last = board?.charges[0] ?? null;
  const sinceLast = last ? now - last.timestamp : null;
  const periodSeconds = PERIOD_BLOCKS * SECONDS_PER_BLOCK;
  const untilNext =
    last && sinceLast !== null
      ? Math.max(0, periodSeconds - (sinceLast % periodSeconds))
      : null;
  const arcDeg = useMemo(() => {
    if (sinceLast === null) return 0;
    return Math.min(360, ((sinceLast % periodSeconds) / periodSeconds) * 360);
  }, [sinceLast, periodSeconds]);

  const chargedCount = board?.charges.length ?? 0;

  return (
    <div className="page">
      <header className="header wrap">
        <div style={{ display: "flex", alignItems: "baseline", gap: 16 }}>
          <div className="logo">
            NIGHT<em>SHIFT</em>
          </div>
          <div className="tagline">PRIVATE STANDING AUTHORIZATION</div>
        </div>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          {board?.source === "snapshot" && (
            <span className="srcbadge srcbadge--snapshot">
              SNAPSHOT @ {fmtBlock(board.snapshotBlock!)}
            </span>
          )}
          <div className="chip">
            <span className={`dot dot--live ${board ? "pulse" : ""}`} />
            MAINNET · BLOCK {board ? fmtBlock(board.headBlock) : "—"}
          </div>
        </div>
      </header>

      <main className="main wrap">
        <div className="hero-grid">
          <section className="hero">
            <div
              className="instrument"
              style={{
                background: `conic-gradient(var(--accent) 0deg ${arcDeg}deg, #1c1e23 ${arcDeg}deg 360deg)`,
              }}
            >
              <div className="instrument-core">
                <div className="instrument-label">NEXT CHARGE</div>
                <div className="instrument-value">
                  {untilNext !== null ? hms(untilNext) : "--:--:--"}
                </div>
                <div className="instrument-live">
                  <span className="dot dot--accent pulse-fast" />
                  VAULT LIVE
                </div>
              </div>
            </div>
            <div className="hero-copy">
              <div className="eyebrow">LAST AUTONOMOUS CHARGE</div>
              {last ? (
                <>
                  <div className="hero-line">
                    <span className="hero-time">{utc(last.timestamp).time}</span>
                    <span className="hero-unit">UTC</span>
                    <span className="hero-unit">·</span>
                    <span className="hero-unit">BLOCK</span>
                    <span className="hero-block">{fmtBlock(last.block)}</span>
                  </div>
                  <div className="hero-body">
                    Fired by schedule. Settled into the privacy pool. Period
                    nullifier consumed — this period can never be charged again.
                    Nobody was at a keyboard.
                  </div>
                  <div className="hero-meta">
                    tx {truncate(last.txHash)} ·{" "}
                    <a href={VOYAGER_TX(last.txHash)} target="_blank" rel="noreferrer">
                      verify on voyager ↗
                    </a>{" "}
                    · <span style={{ color: "var(--dim)" }}>T+{sinceLast !== null ? hms(sinceLast) : ""} since</span>
                  </div>
                </>
              ) : (
                <>
                  <div className="hero-line">
                    <span className="hero-time">standing by</span>
                  </div>
                  <div className="hero-body">
                    The vault is deployed and reachable. The first scheduled
                    charge will appear here the moment it lands, with its
                    transaction hash — verifiable by anyone.
                  </div>
                  <div className="hero-meta">
                    vault{" "}
                    <a href={VOYAGER_CONTRACT(VAULT)} target="_blank" rel="noreferrer">
                      {truncate(VAULT, 8, 8)} ↗
                    </a>
                  </div>
                </>
              )}
            </div>
          </section>

          <div className="stats">
            <div className="stat">
              <div className="stat-label">ESCROW HELD BY VAULT</div>
              <div className="stat-value">
                <NumberFlow
                  value={board ? Number(fmtStrk(board.escrowWei)) : 0}
                  format={{ minimumFractionDigits: 2, maximumFractionDigits: 2 }}
                />{" "}
                <span className="stat-unit">STRK</span>
              </div>
              <div className="stat-caption">accounted escrow, read from the contract</div>
            </div>
            <div className="stat">
              <div className="stat-label">ACTIVE SUBSCRIPTIONS</div>
              <div className="stat-value">
                <NumberFlow value={board?.activeSubscriptions ?? 0} />
              </div>
              <div className="stat-caption">
                as of block {board ? fmtBlock(board.headBlock) : "—"}
              </div>
            </div>
          </div>
        </div>

        <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div className="section-head">
            <div className="section-title">
              {"// CHARGE FEED — DECODED FROM MAINNET EVENTS"}
            </div>
            <div className="section-note">
              {board?.source === "rpc"
                ? "live via RPC"
                : board
                  ? `committed snapshot @ block ${fmtBlock(board.snapshotBlock!)}`
                  : "connecting…"}
            </div>
          </div>
          <div className="feed">
            <div className="feed-header">
              <span className="col-dot" />
              <span className="col-period">PERIOD</span>
              <span className="col-time">TIME (UTC)</span>
              <span className="col-block">BLOCK</span>
              <span className="col-amount">AMOUNT</span>
              <span className="col-null">NULLIFIER CONSUMED</span>
              <span className="col-status">STATUS</span>
              <span className="col-link" />
            </div>
            {board && board.charges.length === 0 && (
              <div className="feed-empty">
                no charges yet — the vault has not billed anyone. When it does,
                every charge lands here with its receipt.
              </div>
            )}
            {board?.charges.map((c) => {
              const t = utc(c.timestamp);
              return (
                <div className="feed-row feed-row--charged" key={c.txHash}>
                  <span className="col-dot dot dot--live" />
                  <span className="col-period" style={{ color: "var(--fg-strong)" }}>
                    {String(c.periodIndex).padStart(2, "0")}
                  </span>
                  <span className="col-time">{t.date} {t.time}</span>
                  <span className="col-block" style={{ color: "var(--accent)" }}>
                    {fmtBlock(c.block)}
                  </span>
                  <span className="col-amount" style={{ color: "var(--fg-strong)", fontWeight: 500 }}>
                    {fmtStrk(PER_PERIOD_WEI)} STRK
                  </span>
                  <span className="col-null" style={{ color: "var(--dim)" }}>
                    {truncate(c.commitment)}
                  </span>
                  <span className="col-status" style={{ color: "var(--live)" }}>
                    ON SCHEDULE
                  </span>
                  <a className="col-link" href={VOYAGER_TX(c.txHash)} target="_blank" rel="noreferrer">
                    ↗
                  </a>
                </div>
              );
            })}
          </div>
          <div className="ticks">
            <span className="section-title" style={{ fontSize: 10 }}>PERIODS</span>
            <div className="tickbar">
              {Array.from({ length: N_PERIODS }, (_, i) => (
                <span key={i} className={`tick ${i < chargedCount ? "tick--filled" : ""}`} />
              ))}
            </div>
            <span className="ticks-caption">
              {chargedCount} of {N_PERIODS} charged
              {chargedCount > 0 ? " · on schedule" : ""}
            </span>
          </div>
        </section>

        <section className="explainers">
          <div className="explainer">
            <div className="section-title">WHAT THE CHAIN SEES</div>
            <div className="explainer-body">
              A charge names the vault, an amount, and a nullifier. It does not
              name the subscriber. Charges for the same subscription cannot be
              linked across periods.
            </div>
          </div>
          <div className="explainer">
            <div className="section-title">WHAT THE VAULT ENFORCES</div>
            <div className="explainer-body">
              Never early — the window is block-gated. Never twice — the period
              nullifier is write-once. Never beyond escrow — checked before
              anything moves.
            </div>
          </div>
        </section>
      </main>

      <footer className="footer wrap">
        <div className="footer-note">
          vault{" "}
          <a href={VOYAGER_CONTRACT(VAULT)} target="_blank" rel="noreferrer">
            {truncate(VAULT, 8, 8)}
          </a>{" "}
          · every row verifiable on voyager · no key was used to render this page
        </div>
        <div className="verbs">
          <a className="btn btn--primary" href="#verify">VERIFY TIER PROOF</a>
          <a className="btn btn--ghost" href="#cancel">CANCEL</a>
        </div>
      </footer>
    </div>
  );
}
