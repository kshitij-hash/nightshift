// Every decision the demo charge endpoint makes, as pure functions over plain
// values. No network, no clock, no filesystem, no starknet import. The server
// reads the chain and signs, this module decides whether it should.
//
// The split exists because the interesting failures here are policy failures,
// not RPC failures: a commitment that is not on the whitelist, a period that is
// not due yet, a visitor who already fired one a minute ago, a day that has
// spent its budget. All of those are decided from four numbers and a clock
// reading, so they are unit-testable without touching mainnet.
//
// Two gates, in order:
//   gateRequest  : whitelist, per-IP cooldowns, daily budget. Runs BEFORE any
//                  RPC call and before the key is ever touched.
//   gateChain    : schedule/tier reads against the head block. Decides "due" vs
//                  "not due" so a predictable NS_NOT_DUE revert never costs gas.

/** Longest form of a Starknet felt written as hex, same shape check as relay.mjs. */
export const FELT_RE = /^0x[0-9a-fA-F]{1,64}$/;

/**
 * BigInt(value) for felt-shaped input, else null. Never throws.
 *
 * Hex digits are accepted in either case, so the 0X prefix is accepted in
 * either case too and normalized before the shape test. Rejecting 0XABC while
 * accepting 0xABC would be an arbitrary line, and BigInt() does not draw it.
 */
export function toFelt(value) {
  if (typeof value === "bigint") return value;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  const v = trimmed.startsWith("0X") ? `0x${trimmed.slice(2)}` : trimmed;
  if (!FELT_RE.test(v)) return null;
  try {
    return BigInt(v);
  } catch {
    return null;
  }
}

/** Canonical unpadded lowercase hex, so 0x0abc and 0xABC are one commitment. */
export function normalizeFelt(value) {
  const f = toFelt(value);
  return f === null ? null : `0x${f.toString(16)}`;
}

/** First 10 characters of a commitment, the form the keeper and relay log. */
export function shortFelt(value) {
  const n = normalizeFelt(value);
  return n === null ? "?" : `${n.slice(0, 10)}…`;
}

/**
 * Parse DEMO_COMMITMENTS: comma-separated felts, blanks and junk dropped.
 * @returns {{ felts: bigint[], rejected: string[] }}
 */
export function parseWhitelist(raw) {
  const felts = [];
  const rejected = [];
  for (const part of String(raw ?? "").split(",")) {
    const piece = part.trim();
    if (piece === "") continue;
    const f = toFelt(piece);
    if (f === null || f === 0n) rejected.push(piece);
    else if (!felts.includes(f)) felts.push(f);
  }
  return { felts, rejected };
}

/** Whitelist membership, compared as BigInt so 0x0-padding never matters. */
export function isWhitelisted(commitment, whitelist) {
  const f = toFelt(commitment);
  if (f === null) return false;
  return whitelist.some((w) => w === f);
}

/**
 * Decode the vault's schedule_of tuple:
 *   (creator_id, tier, period_blocks, start_block, n_periods, escrow,
 *    next_period, cancelled)
 * @param {Array<string|bigint>} felts
 */
export function parseSchedule(felts) {
  if (!Array.isArray(felts) || felts.length < 8) return null;
  const n = felts.map(toFelt);
  if (n.some((v) => v === null)) return null;
  return {
    creatorId: n[0],
    tier: Number(n[1]),
    periodBlocks: n[2],
    startBlock: n[3],
    nPeriods: n[4],
    escrow: n[5],
    nextPeriod: n[6],
    cancelled: n[7] === 1n,
  };
}

/** Minutes, rounded up, never below 1 for a block that has not landed yet. */
export function etaMinutes(blocks, secondsPerBlock) {
  if (blocks <= 0n) return 0;
  const seconds = Number(blocks) * secondsPerBlock;
  return Math.max(1, Math.ceil(seconds / 60));
}

/**
 * Is the next period chargeable at `head`? Mirrors vault.cairo `charge`:
 * creator_id != 0, not cancelled, next_period < n_periods, escrow >= tier
 * amount, and block_number >= start_block + period_blocks * next_period.
 *
 * @returns {{code: string, nextDueBlock: bigint, blocksRemaining: bigint,
 *            etaMinutes: number, periodIndex: bigint}}
 */
export function chargeReadiness({ schedule, tierAmount, head, secondsPerBlock = 1.7 }) {
  const headF = toFelt(head);
  const amount = toFelt(tierAmount);
  const blank = { nextDueBlock: 0n, blocksRemaining: 0n, etaMinutes: 0, periodIndex: 0n };
  if (!schedule || headF === null || amount === null) return { code: "unreadable", ...blank };
  if (schedule.creatorId === 0n) return { code: "unknown_sub", ...blank };

  const nextDueBlock = schedule.startBlock + schedule.periodBlocks * schedule.nextPeriod;
  const blocksRemaining = nextDueBlock > headF ? nextDueBlock - headF : 0n;
  const window = {
    nextDueBlock,
    blocksRemaining,
    etaMinutes: etaMinutes(blocksRemaining, secondsPerBlock),
    periodIndex: schedule.nextPeriod,
  };

  if (schedule.cancelled) return { code: "cancelled", ...window };
  if (schedule.nextPeriod >= schedule.nPeriods) return { code: "exhausted", ...window };
  if (amount === 0n) return { code: "unreadable", ...window };
  if (schedule.escrow < amount) return { code: "exhausted", ...window };
  if (headF < nextDueBlock) return { code: "not_due", ...window };
  return { code: "due", ...window };
}

// --- rate limiting ----------------------------------------------------------

/** Entries one cooldown bucket may hold before the oldest are evicted. */
export const MAX_COOLDOWN_ENTRIES = 10_000;

/**
 * Per-key cooldowns in named buckets. One process, one Map: this is the state
 * a long-lived server has and a serverless function does not.
 *
 * The keys are chosen by the caller (an IP, or whatever a trusted proxy wrote
 * in x-forwarded-for), so the map needs a ceiling as well as the age sweep: a
 * flood of one-shot keys must cost bounded memory, not one entry per request.
 * Past the ceiling the least recently marked entry goes first, which is also
 * the entry whose cooldown has the least time left to run.
 */
export class Cooldowns {
  constructor(maxEntries = MAX_COOLDOWN_ENTRIES) {
    /** @type {Map<string, Map<string, number>>} bucket -> key -> last-hit ms */
    this.buckets = new Map();
    this.maxEntries = Math.max(1, Number(maxEntries) || MAX_COOLDOWN_ENTRIES);
  }

  #bucket(name) {
    let b = this.buckets.get(name);
    if (!b) {
      b = new Map();
      this.buckets.set(name, b);
    }
    return b;
  }

  /** Seconds still to wait, 0 when the key is free. */
  remaining(bucket, key, nowMs, cooldownS) {
    const last = this.#bucket(bucket).get(key);
    if (last === undefined) return 0;
    const elapsed = (nowMs - last) / 1000;
    if (elapsed >= cooldownS) return 0;
    return Math.max(1, Math.ceil(cooldownS - elapsed));
  }

  /**
   * Record a hit. Delete-then-set keeps Map iteration order equal to recency
   * order, which is what makes the eviction below oldest-first.
   */
  mark(bucket, key, nowMs) {
    const b = this.#bucket(bucket);
    b.delete(key);
    b.set(key, nowMs);
    while (b.size > this.maxEntries) {
      const oldest = b.keys().next();
      if (oldest.done) break;
      b.delete(oldest.value);
    }
  }

  /** Drop entries older than maxAgeS so a long-running process does not grow. */
  sweep(nowMs, maxAgeS) {
    for (const [name, b] of this.buckets) {
      for (const [key, last] of b) {
        if ((nowMs - last) / 1000 > maxAgeS) b.delete(key);
      }
      if (b.size === 0) this.buckets.delete(name);
    }
  }

  size(bucket) {
    return this.#bucket(bucket).size;
  }
}

// --- daily budget -----------------------------------------------------------

/** UTC calendar day, the unit the budget resets on. */
export function utcDayKey(nowMs) {
  return new Date(nowMs).toISOString().slice(0, 10);
}

/**
 * A hard ceiling on real transactions per UTC day. This is the number that
 * bounds what an abuser can cost: max charges/day x fee per charge, and not a
 * wei more, because nothing else in the process can submit.
 */
export class DailyBudget {
  constructor(max) {
    this.max = Number(max);
    this.day = null;
    this.count = 0;
  }

  #roll(nowMs) {
    const day = utcDayKey(nowMs);
    if (this.day !== day) {
      this.day = day;
      this.count = 0;
    }
  }

  used(nowMs) {
    this.#roll(nowMs);
    return this.count;
  }

  remaining(nowMs) {
    return Math.max(0, this.max - this.used(nowMs));
  }

  /** Reserve one slot. False when the day is spent. */
  take(nowMs) {
    if (this.remaining(nowMs) <= 0) return false;
    this.count += 1;
    return true;
  }

  /** Give a reserved slot back when the submit never happened. */
  refund(nowMs) {
    this.#roll(nowMs);
    if (this.count > 0) this.count -= 1;
  }

  snapshot() {
    return { day: this.day, count: this.count };
  }

  restore(snap) {
    if (!snap || typeof snap !== "object") return this;
    const day = typeof snap.day === "string" ? snap.day : null;
    const count = Number.isInteger(snap.count) && snap.count >= 0 ? snap.count : 0;
    this.day = day;
    this.count = day === null ? 0 : count;
    return this;
  }
}

// --- concurrency ------------------------------------------------------------

/**
 * One in-flight submit per (commitment, period). Two visitors who press the
 * button in the same second must not produce two transactions for one period:
 * the second would revert NS_PERIOD_SPENT and waste the demo account's gas.
 * The second caller joins the first's promise and gets the same tx hash.
 */
export class PendingRegistry {
  constructor() {
    /** @type {Map<string, Promise<any>>} */
    this.inflight = new Map();
    /** @type {Map<string, {value: any, atMs: number}>} */
    this.recent = new Map();
  }

  static key(commitment, periodIndex) {
    return `${normalizeFelt(commitment)}:${periodIndex}`;
  }

  /** @returns {Promise<{joined: boolean, value: any}>} */
  async join(key, factory) {
    const existing = this.inflight.get(key);
    if (existing) return { joined: true, value: await existing };
    const promise = (async () => factory())();
    this.inflight.set(key, promise);
    try {
      return { joined: false, value: await promise };
    } finally {
      this.inflight.delete(key);
    }
  }

  /**
   * A submitted transaction stays remembered after it stops being in flight.
   * schedule_of does not advance next_period until the transaction is accepted,
   * so for the next minute or so the chain still reads "due" for a period that
   * is already spoken for. Without this memo the visitor after the first one
   * would submit a duplicate that reverts NS_PERIOD_SPENT and burns gas.
   */
  remember(key, value, nowMs) {
    this.recent.set(key, { value, atMs: nowMs });
  }

  /** The remembered value for `key`, or undefined once ttlS has passed. */
  recall(key, nowMs, ttlS) {
    const hit = this.recent.get(key);
    if (!hit) return undefined;
    if ((nowMs - hit.atMs) / 1000 > ttlS) {
      this.recent.delete(key);
      return undefined;
    }
    return hit.value;
  }

  sweep(nowMs, ttlS) {
    for (const [key, hit] of this.recent) {
      if ((nowMs - hit.atMs) / 1000 > ttlS) this.recent.delete(key);
    }
  }

  get size() {
    return this.inflight.size;
  }
}

// --- response shapes --------------------------------------------------------

export const VOYAGER_TX = (hash) => `https://voyager.online/tx/${hash}`;

export const submitted = (txHash) => ({
  status: "submitted",
  tx_hash: txHash,
  voyager_url: VOYAGER_TX(txHash),
});

export const notDue = (nextDueBlock, eta) => ({
  status: "not_due",
  next_due_block: Number(nextDueBlock),
  eta_minutes: eta,
});

export const rateLimited = (retryAfterS) => ({
  status: "rate_limited",
  retry_after_s: retryAfterS,
});

export const budgetExhausted = () => ({ status: "budget_exhausted" });

export const failure = (reason) => ({ status: "error", reason });

/** HTTP status for each response shape. */
export function httpStatusFor(response) {
  switch (response?.status) {
    case "submitted":
      return 200;
    case "not_due":
      return 200;
    case "rate_limited":
      return 429;
    case "budget_exhausted":
      return 503;
    default:
      return 400;
  }
}

/**
 * Turn any thrown thing into a short public sentence. Vault asserts are named
 * and safe to echo; everything else collapses to one generic line, because a
 * node error can carry an RPC URL, an account address, or a stack.
 */
export function safeReason(err) {
  const text = typeof err === "string" ? err : String(err?.message ?? err ?? "");
  const known = [
    ["NS_NOT_DUE", "the vault says this period is not due yet"],
    ["NS_PERIOD_SPENT", "this period was already charged"],
    ["NS_ESCROW_EXHAUSTED", "this subscription has no escrow left"],
    ["NS_CANCELLED", "this subscription was cancelled"],
    ["NS_UNKNOWN_SUB", "the vault has no schedule for this commitment"],
  ];
  for (const [needle, message] of known) {
    if (text.includes(needle)) return message;
  }
  if (/insufficient|balance|max_fee|MaxFee|exceed/i.test(text)) {
    return "the demo account cannot cover the fee right now";
  }
  return "the charge could not be submitted right now";
}

// --- the gates --------------------------------------------------------------

/**
 * Everything decidable before a single byte goes to the network.
 *
 * @param {object} a
 * @param {string} a.commitment   commitment named by the request
 * @param {string} a.ip           caller identity for cooldown purposes
 * @param {number} a.nowMs
 * @param {object} a.config       { whitelist, cooldownS, probeCooldownS }
 * @param {Cooldowns} a.cooldowns
 * @param {DailyBudget} a.budget
 * @returns {{allow: boolean, response?: object, commitment?: string}}
 */
export function gateRequest({ commitment, ip, nowMs, config, cooldowns, budget }) {
  const normalized = normalizeFelt(commitment);
  if (normalized === null) {
    return { allow: false, response: failure("commitment must be a 0x-hex felt") };
  }
  // Refuse an unlisted commitment here, before the signer is constructed: the
  // endpoint can only ever move the demo subscription this deployment names.
  if (!isWhitelisted(normalized, config.whitelist)) {
    return { allow: false, response: failure("that commitment is not the demo subscription") };
  }

  const probe = cooldowns.remaining("probe", ip, nowMs, config.probeCooldownS);
  if (probe > 0) return { allow: false, response: rateLimited(probe) };

  const charge = cooldowns.remaining("charge", ip, nowMs, config.cooldownS);
  if (charge > 0) return { allow: false, response: rateLimited(charge) };

  if (budget.remaining(nowMs) <= 0) return { allow: false, response: budgetExhausted() };

  return { allow: true, commitment: normalized };
}

/**
 * Everything decidable from the two read-only views plus the head block.
 * `due` is the only outcome that reaches the signer.
 *
 * @returns {{allow: boolean, response?: object, periodIndex?: bigint}}
 */
export function gateChain({ schedule, tierAmount, head, secondsPerBlock }) {
  const r = chargeReadiness({ schedule, tierAmount, head, secondsPerBlock });
  switch (r.code) {
    case "due":
      return { allow: true, periodIndex: r.periodIndex, readiness: r };
    case "not_due":
      return { allow: false, response: notDue(r.nextDueBlock, r.etaMinutes), readiness: r };
    case "cancelled":
      return { allow: false, response: failure("the demo subscription was cancelled"), readiness: r };
    case "exhausted":
      return {
        allow: false,
        response: failure("the demo subscription has spent its escrow, it needs a top-up"),
        readiness: r,
      };
    case "unknown_sub":
      return { allow: false, response: failure("the vault has no schedule for this commitment"), readiness: r };
    default:
      return { allow: false, response: failure("the vault state could not be read"), readiness: r };
  }
}
