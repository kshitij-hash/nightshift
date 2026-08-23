// The tier-2 charge panel's state machine and its transport.
//
// Division of labor, same as the rest of src/query: this file owns the wire
// (the endpoint URL, the two requests, the shape checks) and the state machine
// over it. The component owns nothing but pixels. Unlike useBoard/useSchedule
// there is no TanStack query here on purpose: a charge is a write with a
// one-per-press contract, and caching, dedup or a refetch interval around it
// would be a way to fire a mainnet transaction nobody pressed for.
//
// Two rules the rest of the file exists to keep:
//   1. POST /charge happens on an explicit press and nowhere else. The health
//      probe is the only thing on a timer, and it is a GET.
//   2. Everything the endpoint says is treated as hostile until checked. A tx
//      hash is matched against a felt regex before it is linked, and a
//      voyager_url is only followed when it parses to https on voyager.online.
//      A page that renders a stranger's URL as a link is a phishing hop.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { VOYAGER_TX } from "../config";

/** Health is re-read on the same 60s cadence as the board and the schedule. */
const HEALTH_INTERVAL_MS = 60_000;
const HEALTH_TIMEOUT_MS = 6_000;
/** A submit does an on-chain fee estimate before it invokes, so it gets room. */
const CHARGE_TIMEOUT_MS = 45_000;
const MAX_REASON_CHARS = 200;

const FELT = /^0x[0-9a-fA-F]{1,64}$/;

export type ChargeHealth = {
  /** "starknet" for the real signer, "mock" for a keyless local run. */
  signer: string;
  vault: string | null;
  chargesRemainingToday: number | null;
  maxPerDay: number | null;
};

/** Why the write path is shut: no endpoint in this build, or one that did not
 *  answer the health probe. The panel says which, because "unavailable" with
 *  no cause is the kind of copy this product does not ship. */
export type ClosedReason = "unconfigured" | "unreachable";

export type ChargeState =
  | { tag: "probing" }
  | { tag: "closed"; reason: ClosedReason }
  | { tag: "ready" }
  | { tag: "submitting" }
  | { tag: "submitted"; txHash: string; voyagerUrl: string }
  | { tag: "not_due"; nextDueBlock: number; etaMinutes: number; deadlineMs: number }
  | { tag: "rate_limited"; retryAfterS: number; deadlineMs: number }
  | { tag: "budget_exhausted" }
  | { tag: "error"; reason: string };

/**
 * The demo-charge endpoint for this build, normalized to an origin plus path
 * with no trailing slash. Returns null when the variable is absent, blank, or
 * not an http(s) URL, which is the panel's DEMO WINDOW CLOSED default.
 */
export function chargeEndpoint(): string | null {
  const raw = (import.meta.env.VITE_DEMO_CHARGE_URL as string | undefined) ?? "";
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  return `${parsed.origin}${parsed.pathname.replace(/\/+$/, "")}`;
}

// --- wire reading -----------------------------------------------------------

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null;

const asString = (v: unknown): string | null => (typeof v === "string" ? v : null);

const asCount = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : null;

/** The endpoint's `reason` is rendered verbatim, so it is bounded and
 *  single-lined first. React escapes it; this only stops a long or multi-line
 *  string from wrecking the panel. */
const cleanReason = (v: unknown): string | null => {
  const s = asString(v);
  if (s === null) return null;
  const flat = s.replace(/\s+/g, " ").trim();
  if (flat === "") return null;
  return flat.length > MAX_REASON_CHARS ? `${flat.slice(0, MAX_REASON_CHARS)}…` : flat;
};

/** Only a voyager.online https URL survives; anything else falls back to the
 *  link this page builds itself from the hash. */
function voyagerLink(txHash: string, given: unknown): string {
  const raw = asString(given);
  if (raw !== null) {
    try {
      const u = new URL(raw);
      const host = u.hostname.toLowerCase();
      if (u.protocol === "https:" && (host === "voyager.online" || host.endsWith(".voyager.online"))) {
        return u.toString();
      }
    } catch {
      // fall through to the link built from the hash
    }
  }
  return VOYAGER_TX(txHash);
}

/** An AbortSignal that fires when the caller's signal fires or the deadline
 *  passes, whichever is first. `done()` clears both listeners. */
function deadlineSignal(alive: AbortSignal, ms: number): { signal: AbortSignal; done: () => void } {
  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort();
  if (alive.aborted) ctrl.abort();
  else alive.addEventListener("abort", onAbort, { once: true });
  const timer = window.setTimeout(() => ctrl.abort(), ms);
  return {
    signal: ctrl.signal,
    done: () => {
      window.clearTimeout(timer);
      alive.removeEventListener("abort", onAbort);
    },
  };
}

/** GET /health. Null means the window is shut: unreachable, wrong shape, or
 *  a body that does not say ok. Never throws. */
export async function probeHealth(base: string, alive: AbortSignal): Promise<ChargeHealth | null> {
  const { signal, done } = deadlineSignal(alive, HEALTH_TIMEOUT_MS);
  try {
    const res = await fetch(`${base}/health`, {
      method: "GET",
      signal,
      mode: "cors",
      credentials: "omit",
      cache: "no-store",
    });
    if (!res.ok) return null;
    const body: unknown = await res.json();
    if (!isRecord(body) || body.status !== "ok") return null;
    return {
      signer: asString(body.signer) ?? "unknown",
      vault: asString(body.vault),
      chargesRemainingToday: asCount(body.charges_remaining_today),
      maxPerDay: asCount(body.max_per_day),
    };
  } catch {
    return null;
  } finally {
    done();
  }
}

/**
 * POST /charge, mapped straight onto the state machine. rate_limited is a 429
 * and budget_exhausted a 503, so the body is read whatever the HTTP status is;
 * res.ok would throw away four of the five answers.
 */
export async function postCharge(
  base: string,
  commitment: string,
  alive: AbortSignal,
): Promise<ChargeState> {
  const { signal, done } = deadlineSignal(alive, CHARGE_TIMEOUT_MS);
  let body: unknown;
  try {
    const res = await fetch(`${base}/charge`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ commitment }),
      signal,
      mode: "cors",
      credentials: "omit",
      cache: "no-store",
    });
    body = await res.json();
  } catch {
    return {
      tag: "error",
      reason: "the demo endpoint did not answer this press",
    };
  } finally {
    done();
  }

  if (!isRecord(body)) return unreadable();
  const receivedAt = Date.now();

  switch (body.status) {
    case "submitted": {
      const txHash = asString(body.tx_hash);
      if (txHash === null || !FELT.test(txHash)) return unreadable();
      return { tag: "submitted", txHash, voyagerUrl: voyagerLink(txHash, body.voyager_url) };
    }
    case "not_due": {
      const nextDueBlock = asCount(body.next_due_block);
      const etaMinutes = asCount(body.eta_minutes);
      if (nextDueBlock === null || etaMinutes === null) return unreadable();
      return {
        tag: "not_due",
        nextDueBlock,
        etaMinutes,
        deadlineMs: receivedAt + etaMinutes * 60_000,
      };
    }
    case "rate_limited": {
      const retryAfterS = asCount(body.retry_after_s);
      if (retryAfterS === null) return unreadable();
      return { tag: "rate_limited", retryAfterS, deadlineMs: receivedAt + retryAfterS * 1000 };
    }
    case "budget_exhausted":
      return { tag: "budget_exhausted" };
    case "error":
      return {
        tag: "error",
        reason: cleanReason(body.reason) ?? "the endpoint refused without naming a reason",
      };
    default:
      return unreadable();
  }
}

const unreadable = (): ChargeState => ({
  tag: "error",
  reason: "the endpoint answered in a shape this page does not read",
});

// --- reconciliation ---------------------------------------------------------

/**
 * What a fresh health read does to the state on screen. A probe may open the
 * panel, shut it, or move it off budget_exhausted when the UTC day rolls over.
 * It never clears a receipt and it never interrupts a submit.
 */
function reconcile(state: ChargeState, health: ChargeHealth | null): ChargeState {
  if (health === null) {
    if (state.tag === "submitting" || state.tag === "submitted") return state;
    return { tag: "closed", reason: "unreachable" };
  }
  const left = health.chargesRemainingToday;
  if (state.tag === "probing" || state.tag === "closed") {
    return left === 0 ? { tag: "budget_exhausted" } : { tag: "ready" };
  }
  if (state.tag === "ready" && left === 0) return { tag: "budget_exhausted" };
  if (state.tag === "budget_exhausted" && left !== null && left > 0) return { tag: "ready" };
  return state;
}

// --- the hook ---------------------------------------------------------------

export type ChargePanelController = {
  /** null when this build has no endpoint configured. */
  endpoint: string | null;
  state: ChargeState;
  health: ChargeHealth | null;
  /** Whole seconds on the running countdown, or null when nothing counts. */
  secondsLeft: number | null;
  canPress: boolean;
  press: () => void;
};

/**
 * The panel's whole behavior: probe on mount and every 60s, POST once per
 * press, count the refusals down at 1 Hz and re-open the button at zero. Every
 * request rides an AbortController that the unmount cleanup aborts, so a
 * navigation away cannot land a setState on a dead component or leave a fetch
 * running behind the page.
 *
 * `onSubmitted` is the hand-off: the board refreshes its own reads with it, and
 * the arrival choreography that already exists there runs when the feed picks
 * the event up. This panel deliberately does not animate that landing twice.
 */
export function useChargePanel(
  commitment: string | null,
  onSubmitted?: (txHash: string) => void,
): ChargePanelController {
  const endpoint = useMemo(() => chargeEndpoint(), []);
  const [state, setState] = useState<ChargeState>(() =>
    endpoint === null ? { tag: "closed", reason: "unconfigured" } : { tag: "probing" },
  );
  const [health, setHealth] = useState<ChargeHealth | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const aliveRef = useRef<AbortController | null>(null);
  const probeRef = useRef<() => void>(() => {});
  const inFlight = useRef(false);
  const submitted = useRef(onSubmitted);
  useEffect(() => {
    submitted.current = onSubmitted;
  }, [onSubmitted]);

  // The health probe. It is the only timer that talks to the endpoint.
  useEffect(() => {
    if (endpoint === null) return;
    const alive = new AbortController();
    aliveRef.current = alive;
    const run = () => {
      void probeHealth(endpoint, alive.signal).then((h) => {
        if (alive.signal.aborted) return;
        setHealth(h);
        setState((s) => reconcile(s, h));
      });
    };
    probeRef.current = run;
    run();
    const id = window.setInterval(run, HEALTH_INTERVAL_MS);
    return () => {
      window.clearInterval(id);
      alive.abort();
      probeRef.current = () => {};
      if (aliveRef.current === alive) aliveRef.current = null;
    };
  }, [endpoint]);

  // The countdown behind not_due and rate_limited. One interval, only while a
  // deadline is on screen, and the button re-opens the second it passes.
  const deadlineMs =
    state.tag === "not_due" || state.tag === "rate_limited" ? state.deadlineMs : null;

  // One interval, running only while a deadline is on screen. It ticks the
  // clock the label reads and re-opens the button on the tick that passes the
  // deadline. The clock is seeded by the press that produced the deadline, not
  // by an effect, so the first paint of a countdown is already right.
  useEffect(() => {
    if (deadlineMs === null) return;
    const id = window.setInterval(() => {
      const t = Date.now();
      if (t >= deadlineMs) setState({ tag: "ready" });
      else setNowMs(t);
    }, 1000);
    return () => window.clearInterval(id);
  }, [deadlineMs]);

  const secondsLeft =
    deadlineMs === null ? null : Math.max(0, Math.ceil((deadlineMs - nowMs) / 1000));

  const press = useCallback(() => {
    const alive = aliveRef.current;
    if (endpoint === null || alive === null || commitment === null) return;
    if (inFlight.current) return;
    inFlight.current = true;
    setState({ tag: "submitting" });
    void postCharge(endpoint, commitment, alive.signal).then((next) => {
      inFlight.current = false;
      if (alive.signal.aborted) return;
      setNowMs(Date.now());
      setState(next);
      if (next.tag === "submitted") {
        submitted.current?.(next.txHash);
        // A charge landed, so the daily counter moved. Read it back rather
        // than decrement a number this page does not own. Only here: after a
        // refusal the counter is unchanged, and a probe racing the answer
        // could overwrite what the endpoint just said.
        probeRef.current();
      }
    });
  }, [endpoint, commitment]);

  // A press is offered from the three states that have an action left: the
  // open window, a refusal worth retrying, and a landed receipt whose next
  // period the reader may want to try. Never during flight, and never from a
  // state whose own countdown or cap is the reason the button is shut.
  const canPress =
    endpoint !== null &&
    commitment !== null &&
    (state.tag === "ready" || state.tag === "error" || state.tag === "submitted");

  return { endpoint, state, health, secondsLeft, canPress, press };
}
