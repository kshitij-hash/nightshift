// Pure, network-free pieces of the Telegram gate: env parsing, presentation
// text parsing, the REASONS-to-English mapping, the pending-challenge TTL map
// and the rate limiter. Nothing here imports grammy or nightshift-verify, so
// lib.test.mjs runs with no token, no RPC and no network at all.
//
// REASON_MESSAGES below is a hand-written English line per reason code,
// because the lines themselves have to be typed by a person. What is not
// hand-copied any more is the list of codes it is checked against:
// lib.test.mjs imports REASONS straight from verify/src/index.mjs by
// relative path, so the coverage check runs before `npm ci` has ever
// populated node_modules/nightshift-verify, and it genuinely fails if
// verify/src/index.mjs ever adds, drops or renames a reason. bot.mjs imports
// the same REASONS from the nightshift-verify package at runtime.

import { existsSync, readFileSync } from "node:fs";

// --- env loading -------------------------------------------------------

/**
 * Parse KEY=VALUE lines the way a .env file uses them: blank lines and lines
 * starting with # are skipped, and a value wrapped in matching single or
 * double quotes has the quotes stripped. No interpolation, no multiline
 * values, no export keyword handling beyond trimming it away if present.
 *
 * @param {string} text
 * @returns {Record<string,string>}
 */
export function parseEnvText(text) {
  const out = {};
  for (const rawLine of text.split("\n")) {
    let line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;
    if (line.startsWith("export ")) line = line.slice("export ".length).trim();
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    if (key === "") continue;
    let value = line.slice(eq + 1).trim();
    const quoted =
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2);
    if (quoted) value = value.slice(1, -1);
    out[key] = value;
  }
  return out;
}

/**
 * Read and parse a .env file. Returns {} when the file does not exist; this
 * is a plain example bot, so a missing .env just means "use the real
 * environment", never an error.
 *
 * @param {string} path
 * @returns {Record<string,string>}
 */
export function loadEnvFile(path) {
  if (!existsSync(path)) return {};
  return parseEnvText(readFileSync(path, "utf8"));
}

/**
 * Copy parsed .env values into a target env object without overriding a key
 * that is already set there, matching the usual dotenv precedence: real
 * environment variables win over the file.
 *
 * @param {Record<string,string>} parsed
 * @param {Record<string,string>} target
 * @returns {Record<string,string>} target, mutated in place
 */
export function applyEnv(parsed, target) {
  for (const [key, value] of Object.entries(parsed)) {
    if (target[key] === undefined) target[key] = value;
  }
  return target;
}

// --- TIER_CHATS --------------------------------------------------------

/**
 * Parse the TIER_CHATS env var: a JSON object mapping a tier number to
 * {chat_id, label}. Throws a message naming the exact key that is wrong,
 * since this only ever runs once at startup and a vague error just means a
 * slower fix.
 *
 * @param {string} raw
 * @returns {Map<number, {chat_id: string|number, label: string}>}
 */
export function parseTierChats(raw) {
  let obj;
  try {
    obj = JSON.parse(raw);
  } catch (e) {
    throw new Error(`TIER_CHATS is not valid JSON: ${e.message}`);
  }
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
    throw new Error("TIER_CHATS must be a JSON object of tier -> {chat_id, label}");
  }
  const out = new Map();
  for (const [tierKey, value] of Object.entries(obj)) {
    if (!/^[0-9]+$/.test(tierKey)) {
      throw new Error(`TIER_CHATS key "${tierKey}" is not a plain tier number`);
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error(`TIER_CHATS[${tierKey}] must be an object with chat_id and label`);
    }
    if (typeof value.chat_id !== "string" && typeof value.chat_id !== "number") {
      throw new Error(`TIER_CHATS[${tierKey}].chat_id must be a string or number`);
    }
    if (typeof value.label !== "string" || value.label.trim() === "") {
      throw new Error(`TIER_CHATS[${tierKey}].label must be a non-empty string`);
    }
    out.set(Number(tierKey), { chat_id: value.chat_id, label: value.label });
  }
  return out;
}

// --- presentation text parsing ------------------------------------------

/**
 * Strip a single markdown code fence wrapped around the whole message, the
 * common shape Telegram clients produce for pasted JSON (```json ... ``` or
 * plain ``` ... ```). Only a fence around the entire trimmed text is
 * stripped; a fence embedded in the middle of other text is left alone,
 * since that is not JSON either way.
 *
 * @param {string} text
 * @returns {string}
 */
export function stripCodeFence(text) {
  const trimmed = text.trim();
  const match = trimmed.match(/^```[^\n]*\n([\s\S]*?)\n?```$/);
  return match ? match[1].trim() : trimmed;
}

/**
 * Parse a Telegram message as a presentation. Tolerates the same wrapper
 * shape the nightshift-verify CLI accepts: either the presentation object
 * itself, or {presentation, challenge}. The challenge half of that wrapper
 * is returned for logging only, never as a source of truth for verifierId or
 * nonce: those come from the challenge the verifier itself issued and
 * stored, never from anything the presenter supplies. Never throws; a
 * message that is not JSON, or not an object, comes back as {error}.
 *
 * @param {string} text
 * @returns {{presentation: object, challenge: object} | {error: string}}
 */
export function parsePresentationText(text) {
  const stripped = stripCodeFence(text);
  let input;
  try {
    input = JSON.parse(stripped);
  } catch {
    return { error: "parse_error" };
  }
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { error: "parse_error" };
  }
  const presentation = input.presentation ?? input;
  const challenge = input.challenge && typeof input.challenge === "object" ? input.challenge : {};
  if (!presentation || typeof presentation !== "object" || Array.isArray(presentation)) {
    return { error: "parse_error" };
  }
  return { presentation, challenge };
}

// --- REASONS -> English --------------------------------------------------

/**
 * English line per reason code. Keys match verify/src/index.mjs REASONS
 * (lib.test.mjs imports REASONS directly and checks this covers every value
 * it exports, see the header comment above), plus two local codes this bot
 * adds: parse_error for text that never made it to verifyPresentation at
 * all, and wrong_creator for a presentation that checks out but names a
 * different creator.
 */
export const REASON_MESSAGES = Object.freeze({
  bad_config: "the gate is misconfigured (vault address or RPC). tell whoever runs this bot.",
  malformed_presentation: "that is not a readable presentation. paste the JSON the console gave you, unedited.",
  verifier_mismatch: "that presentation was signed for a different verifier.",
  expired: "that challenge already expired. send /start for a new one.",
  expiry_too_far: "the presentation's expiry is set too far ahead of now. send /start and sign it right away.",
  nonce_mismatch: "that does not match the challenge issued to you. send /start for a new one.",
  not_active: "no active subscription was found for that commitment.",
  arrears: "the subscription is behind on payment.",
  unknown_commitment: "the vault does not recognize that commitment.",
  bad_signature: "the signature does not check out against the recorded owner key.",
  rpc_error: "could not reach the Starknet node. try again in a moment.",
  parse_error: "that did not parse as presentation JSON. paste the JSON the console gave you, unedited.",
  wrong_creator: "that subscription checks out, but it belongs to a different creator.",
});

/**
 * @param {string} reason
 * @returns {string}
 */
export function reasonMessage(reason) {
  return REASON_MESSAGES[reason] ?? `verification failed (${reason}).`;
}

/**
 * Whether a reason should count toward the 5-strike lockout. Three reasons
 * are excluded because none of them are evidence that this user did
 * anything wrong:
 *
 *  - parse_error means the text never became a presentation at all (bad
 *    JSON, a fat-fingered paste, a stray half-copy) - a real subscriber can
 *    trip that with no wallet or subscription involved.
 *  - rpc_error means the Starknet node this bot talks to is unreachable or
 *    erroring - a node hiccup, not a bad presentation.
 *  - bad_config means the gate itself is misconfigured (vault address or
 *    RPC) - an operator error, not a subscriber error.
 *
 * Every other reason is an outcome verifyPresentation (or this bot's own
 * creator check) reached after actually checking the presentation against
 * the chain, and counts.
 *
 * @param {string} reason
 * @returns {boolean}
 */
export function countsAsFailure(reason) {
  return reason !== "parse_error" && reason !== "rpc_error" && reason !== "bad_config";
}

// --- pending challenge TTL map -------------------------------------------

/**
 * A Map with per-key expiry, used to hold the one pending challenge per
 * Telegram user. get() and has() evict an expired entry on read rather than
 * on a timer, so the map needs no background sweep to stay correct; the
 * tradeoff is that a key nobody reads again just sits there until the
 * process holding it exits, which is fine for a demo bot's memory footprint.
 */
export class TTLMap {
  /**
   * @param {{ttlMs: number, clock?: () => number}} args
   */
  constructor({ ttlMs, clock = Date.now }) {
    if (!Number.isFinite(ttlMs) || ttlMs <= 0) throw new Error("ttlMs must be a positive number");
    this.ttlMs = ttlMs;
    this.clock = clock;
    this.store = new Map();
  }

  set(key, value) {
    this.store.set(key, { value, expiresAt: this.clock() + this.ttlMs });
    return this;
  }

  get(key) {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (this.clock() >= entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  has(key) {
    return this.get(key) !== undefined;
  }

  delete(key) {
    return this.store.delete(key);
  }

  get size() {
    return this.store.size;
  }
}

// --- rate limiting and lockout -------------------------------------------

/**
 * Two independent limits keyed by Telegram user id, both in memory:
 *
 *  - a 30-second cooldown between challenges issued to the same user, so
 *    /start cannot be used to hammer makeChallenge (and, through it, the RPC
 *    node) in a loop;
 *  - a 5-strikes lockout: once a user's failed verifications (bad JSON, a
 *    presentation that does not check out, or one for the wrong creator)
 *    reach 5, they are locked out for 10 minutes, so a bot that also gates
 *    guesses at other people's presentations cannot be brute-forced quickly.
 *
 * A clock is injectable so tests never depend on real wall-clock time.
 */
export class RateLimiter {
  /**
   * @param {{clock?: () => number, challengeCooldownMs?: number,
   *          maxFailures?: number, lockoutMs?: number}} [args]
   */
  constructor({
    clock = Date.now,
    challengeCooldownMs = 30_000,
    maxFailures = 5,
    lockoutMs = 10 * 60 * 1000,
  } = {}) {
    this.clock = clock;
    this.challengeCooldownMs = challengeCooldownMs;
    this.maxFailures = maxFailures;
    this.lockoutMs = lockoutMs;
    this.lastChallengeAt = new Map();
    this.failures = new Map();
    this.lockedUntil = new Map();
  }

  /**
   * @param {number|string} userId
   * @returns {{allowed: boolean, retryAfterMs: number}}
   */
  canIssueChallenge(userId) {
    const last = this.lastChallengeAt.get(userId);
    if (last === undefined) return { allowed: true, retryAfterMs: 0 };
    const elapsed = this.clock() - last;
    if (elapsed >= this.challengeCooldownMs) return { allowed: true, retryAfterMs: 0 };
    return { allowed: false, retryAfterMs: this.challengeCooldownMs - elapsed };
  }

  /** @param {number|string} userId */
  recordChallengeIssued(userId) {
    this.lastChallengeAt.set(userId, this.clock());
  }

  /**
   * A lockout that has expired is cleared on read, along with the failure
   * count that triggered it, so the next attempt starts clean.
   *
   * @param {number|string} userId
   * @returns {{locked: boolean, retryAfterMs: number}}
   */
  isLockedOut(userId) {
    const until = this.lockedUntil.get(userId);
    if (until === undefined) return { locked: false, retryAfterMs: 0 };
    const remaining = until - this.clock();
    if (remaining <= 0) {
      this.lockedUntil.delete(userId);
      this.failures.delete(userId);
      return { locked: false, retryAfterMs: 0 };
    }
    return { locked: true, retryAfterMs: remaining };
  }

  /** @param {number|string} userId */
  recordFailure(userId) {
    const count = (this.failures.get(userId) ?? 0) + 1;
    this.failures.set(userId, count);
    if (count >= this.maxFailures) {
      this.lockedUntil.set(userId, this.clock() + this.lockoutMs);
    }
  }

  /** @param {number|string} userId */
  recordSuccess(userId) {
    this.failures.delete(userId);
    this.lockedUntil.delete(userId);
  }
}

// --- HTML escaping ---------------------------------------------------------

/**
 * Escape the three characters that are special inside a Telegram HTML
 * parse_mode message (&, < and >), so JSON text can be placed inside a
 * <pre> block without Telegram misreading it as markup. Nothing else needs
 * escaping for <pre>: quotes are not special there.
 *
 * @param {string} text
 * @returns {string}
 */
export function escapeHtml(text) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// --- small formatting helper ---------------------------------------------

/**
 * Round a millisecond duration up to whole seconds or minutes for a reply
 * line, e.g. "23s" or "10m". Never returns "0s"; a duration that rounds to
 * zero still reads as at least one second away.
 *
 * @param {number} ms
 * @returns {string}
 */
export function formatWait(ms) {
  const totalSeconds = Math.max(1, Math.ceil(ms / 1000));
  if (totalSeconds < 60) return `${totalSeconds}s`;
  return `${Math.ceil(totalSeconds / 60)}m`;
}
