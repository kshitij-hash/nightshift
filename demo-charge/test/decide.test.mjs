// Unit tests for the decision module. Fixture values only, no network, no key.

import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  Cooldowns,
  DailyBudget,
  MAX_COOLDOWN_ENTRIES,
  PendingRegistry,
  budgetExhausted,
  chargeReadiness,
  etaMinutes,
  failure,
  gateChain,
  gateRequest,
  httpStatusFor,
  isWhitelisted,
  normalizeFelt,
  notDue,
  parseSchedule,
  parseWhitelist,
  rateLimited,
  safeReason,
  shortFelt,
  submitted,
  toFelt,
  utcDayKey,
} from "../src/decide.mjs";

const DEMO = "0x3e4a525134a558e7fbabcd62895b879752274308ff618efdb2f20249c053c4a";
const DEMO_PADDED = "0x03e4a525134a558e7fbabcd62895b879752274308ff618efdb2f20249c053c4a";
const OTHER = "0x357ba2895ba553afa1e565f3a2cbb9f39f470f09c6b63e1f23d32611379c6fe";
const CREATOR = "0x396c007ff97561b1eadf59540c71944f6ad2ccfbfc7116254f1a34d869205df";
const ONE_STRK = 10n ** 18n;

/** The live v4 shape: hourly ladder, 1 STRK a period. */
const scheduleFelts = ({
  creatorId = CREATOR,
  tier = "0x0",
  periodBlocks = "0x834", // 2100
  startBlock = "0xcfb9fe", // 13613566, the live v4 subscribe block
  nPeriods = "0x18", // 24
  escrow = "0x" + (24n * ONE_STRK).toString(16),
  nextPeriod = "0x0",
  cancelled = "0x0",
} = {}) => [creatorId, tier, periodBlocks, startBlock, nPeriods, escrow, nextPeriod, cancelled];

// --- felts ------------------------------------------------------------------

test("toFelt takes felt-shaped hex and nothing else", () => {
  assert.equal(toFelt("0x10"), 16n);
  assert.equal(toFelt(16n), 16n);
  assert.equal(toFelt("  0x10  "), 16n);
  assert.equal(toFelt("10"), null);
  assert.equal(toFelt("0xzz"), null);
  assert.equal(toFelt(16), null);
  assert.equal(toFelt(null), null);
  assert.equal(toFelt(`0x${"f".repeat(65)}`), null);
});

test("the 0X prefix is the 0x prefix, since the hex digits are case-blind anyway", () => {
  assert.equal(toFelt("0XABC"), 0xabcn);
  assert.equal(toFelt("0Xabc"), 0xabcn);
  assert.equal(toFelt("  0X10  "), 16n);
  assert.equal(normalizeFelt("0X00A"), "0xa");
  assert.equal(normalizeFelt(DEMO_PADDED.replace("0x", "0X")), normalizeFelt(DEMO));
  // The prefix is the only thing normalized: junk after it is still junk.
  assert.equal(toFelt("0Xzz"), null);
  assert.equal(toFelt("0X"), null);
  assert.deepEqual(parseWhitelist(DEMO.replace("0x", "0X")).felts, [BigInt(DEMO)]);
});

test("normalizeFelt makes padding irrelevant", () => {
  assert.equal(normalizeFelt(DEMO_PADDED), normalizeFelt(DEMO));
  assert.equal(normalizeFelt("0x00A"), "0xa");
  assert.equal(normalizeFelt("nope"), null);
  assert.equal(shortFelt(DEMO_PADDED), `${normalizeFelt(DEMO).slice(0, 10)}…`);
});

// --- whitelist --------------------------------------------------------------

test("parseWhitelist keeps felts, drops blanks and junk, deduplicates", () => {
  const { felts, rejected } = parseWhitelist(` ${DEMO} , ,${DEMO_PADDED}, ${OTHER},nope,0x0 `);
  assert.deepEqual(felts, [BigInt(DEMO), BigInt(OTHER)]);
  assert.deepEqual(rejected, ["nope", "0x0"]);
});

test("parseWhitelist on empty or missing config yields nothing", () => {
  assert.deepEqual(parseWhitelist("").felts, []);
  assert.deepEqual(parseWhitelist(undefined).felts, []);
});

test("isWhitelisted compares as BigInt, not as text", () => {
  const list = parseWhitelist(DEMO).felts;
  assert.equal(isWhitelisted(DEMO, list), true);
  assert.equal(isWhitelisted(DEMO_PADDED, list), true);
  assert.equal(isWhitelisted(OTHER, list), false);
  assert.equal(isWhitelisted("garbage", list), false);
});

// --- schedule decoding ------------------------------------------------------

test("parseSchedule decodes the schedule_of tuple", () => {
  const s = parseSchedule(scheduleFelts());
  assert.equal(s.creatorId, BigInt(CREATOR));
  assert.equal(s.tier, 0);
  assert.equal(s.periodBlocks, 2100n);
  assert.equal(s.startBlock, 13_613_566n);
  assert.equal(s.nPeriods, 24n);
  assert.equal(s.escrow, 24n * ONE_STRK);
  assert.equal(s.nextPeriod, 0n);
  assert.equal(s.cancelled, false);
});

test("parseSchedule refuses a short or unparseable tuple", () => {
  assert.equal(parseSchedule(["0x1", "0x2"]), null);
  assert.equal(parseSchedule(null), null);
  assert.equal(parseSchedule([...scheduleFelts().slice(0, 7), "junk"]), null);
});

// --- due-window math --------------------------------------------------------

test("etaMinutes rounds up and never claims zero for a future block", () => {
  assert.equal(etaMinutes(0n, 1.7), 0);
  assert.equal(etaMinutes(1n, 1.7), 1);
  assert.equal(etaMinutes(2100n, 1.7), 60);
  assert.equal(etaMinutes(1050n, 1.7), 30);
});

test("period 0 is due the moment the subscription starts", () => {
  const r = chargeReadiness({
    schedule: parseSchedule(scheduleFelts()),
    tierAmount: ONE_STRK,
    head: 13_613_566n,
  });
  assert.equal(r.code, "due");
  assert.equal(r.nextDueBlock, 13_613_566n);
  assert.equal(r.periodIndex, 0n);
});

test("period 1 is not due until start + one period, with an eta", () => {
  const r = chargeReadiness({
    schedule: parseSchedule(scheduleFelts({ nextPeriod: "0x1" })),
    tierAmount: ONE_STRK,
    head: 13_614_616n, // 1050 blocks short
    secondsPerBlock: 1.7,
  });
  assert.equal(r.code, "not_due");
  assert.equal(r.nextDueBlock, 13_615_666n);
  assert.equal(r.blocksRemaining, 1050n);
  assert.equal(r.etaMinutes, 30);
});

test("due at exactly the due block, mirroring the vault's >= assert", () => {
  const at = (head) =>
    chargeReadiness({
      schedule: parseSchedule(scheduleFelts({ nextPeriod: "0x1" })),
      tierAmount: ONE_STRK,
      head,
    }).code;
  assert.equal(at(13_615_665n), "not_due");
  assert.equal(at(13_615_666n), "due");
  assert.equal(at(13_615_667n), "due");
});

test("cancelled, exhausted and unknown subscriptions are never due", () => {
  const check = (over, tierAmount = ONE_STRK) =>
    chargeReadiness({
      schedule: parseSchedule(scheduleFelts(over)),
      tierAmount,
      head: 99_999_999n,
    }).code;
  assert.equal(check({ cancelled: "0x1" }), "cancelled");
  assert.equal(check({ nextPeriod: "0x18" }), "exhausted"); // next_period == n_periods
  assert.equal(check({ escrow: "0x0" }), "exhausted");
  assert.equal(check({ escrow: "0x" + (ONE_STRK - 1n).toString(16) }), "exhausted");
  assert.equal(check({ creatorId: "0x0" }), "unknown_sub");
});

test("the live v4 commitment reads exhausted: cancelled, escrow zero", () => {
  // schedule_of at head 13,649,963 for 0x3e4a52…: cancelled, escrow 0, next 1.
  const r = chargeReadiness({
    schedule: parseSchedule(scheduleFelts({ nextPeriod: "0x1", escrow: "0x0", cancelled: "0x1" })),
    tierAmount: ONE_STRK,
    head: 13_649_963n,
  });
  assert.equal(r.code, "cancelled");
});

test("a zero tier amount is unreadable, not a free charge", () => {
  const r = chargeReadiness({
    schedule: parseSchedule(scheduleFelts()),
    tierAmount: 0n,
    head: 13_999_999n,
  });
  assert.equal(r.code, "unreadable");
});

// --- cooldowns --------------------------------------------------------------

test("a cooldown blocks the same key and not a different one", () => {
  const c = new Cooldowns();
  const t0 = 1_700_000_000_000;
  c.mark("charge", "1.2.3.4", t0);
  assert.equal(c.remaining("charge", "1.2.3.4", t0, 900), 900);
  assert.equal(c.remaining("charge", "5.6.7.8", t0, 900), 0);
  assert.equal(c.remaining("probe", "1.2.3.4", t0, 5), 0); // buckets are separate
});

test("a cooldown counts down and expires", () => {
  const c = new Cooldowns();
  const t0 = 1_700_000_000_000;
  c.mark("charge", "ip", t0);
  assert.equal(c.remaining("charge", "ip", t0 + 300_000, 900), 600);
  assert.equal(c.remaining("charge", "ip", t0 + 899_500, 900), 1); // never rounds to 0 early
  assert.equal(c.remaining("charge", "ip", t0 + 900_000, 900), 0);
});

test("sweep drops entries the process no longer needs", () => {
  const c = new Cooldowns();
  const t0 = 1_700_000_000_000;
  c.mark("charge", "old", t0);
  c.mark("charge", "new", t0 + 1_000_000);
  c.sweep(t0 + 1_000_000, 900);
  assert.equal(c.size("charge"), 1);
  assert.equal(c.remaining("charge", "old", t0 + 1_000_000, 900), 0);
});

test("a bucket is capped, and the flood evicts itself oldest first", () => {
  const c = new Cooldowns(4);
  const t0 = 1_700_000_000_000;
  // The visitor we care about, marked first and never touched again.
  c.mark("charge", "victim", t0);
  for (let i = 0; i < 3; i += 1) c.mark("charge", `flood-${i}`, t0 + i + 1);
  assert.equal(c.size("charge"), 4);
  assert.equal(c.remaining("charge", "victim", t0, 900), 900);

  // One more key past the cap drops exactly one entry, the least recent.
  c.mark("charge", "flood-3", t0 + 4);
  assert.equal(c.size("charge"), 4);
  assert.equal(c.remaining("charge", "victim", t0 + 4, 900), 0, "the oldest entry is the one evicted");
  assert.equal(c.remaining("charge", "flood-0", t0 + 4, 900), 900);

  // A thousand fresh keys still leave the bucket at the cap, not at a thousand.
  for (let i = 0; i < 1000; i += 1) c.mark("charge", `wave-${i}`, t0 + 5);
  assert.equal(c.size("charge"), 4);
});

test("re-marking a key refreshes its place in the eviction order", () => {
  const c = new Cooldowns(3);
  const t0 = 1_700_000_000_000;
  c.mark("charge", "a", t0);
  c.mark("charge", "b", t0 + 1);
  c.mark("charge", "c", t0 + 2);
  c.mark("charge", "a", t0 + 3); // a is now the most recent, b the oldest
  c.mark("charge", "d", t0 + 4);
  assert.equal(c.remaining("charge", "b", t0 + 4, 900), 0, "b was the oldest and went");
  assert.equal(c.remaining("charge", "a", t0 + 4, 900), 900);
});

test("the default cap is the documented one and applies to every bucket", () => {
  assert.equal(MAX_COOLDOWN_ENTRIES, 10_000);
  const c = new Cooldowns();
  assert.equal(c.maxEntries, 10_000);
  const t0 = 1_700_000_000_000;
  for (let i = 0; i < 10_050; i += 1) c.mark("probe", `ip-${i}`, t0 + i);
  assert.equal(c.size("probe"), 10_000);
});

// --- budget -----------------------------------------------------------------

test("utcDayKey is the UTC calendar day, not the local one", () => {
  assert.equal(utcDayKey(Date.UTC(2026, 7, 29, 23, 59, 59)), "2026-08-29");
  assert.equal(utcDayKey(Date.UTC(2026, 7, 30, 0, 0, 0)), "2026-08-30");
});

test("the budget hands out exactly max slots per UTC day", () => {
  const b = new DailyBudget(3);
  const t = Date.UTC(2026, 7, 29, 10, 0, 0);
  assert.equal(b.remaining(t), 3);
  assert.equal(b.take(t), true);
  assert.equal(b.take(t), true);
  assert.equal(b.take(t), true);
  assert.equal(b.take(t), false);
  assert.equal(b.remaining(t), 0);
});

test("the budget resets at the UTC day boundary and not before", () => {
  const b = new DailyBudget(1);
  const late = Date.UTC(2026, 7, 29, 23, 59, 0);
  assert.equal(b.take(late), true);
  assert.equal(b.take(Date.UTC(2026, 7, 29, 23, 59, 59)), false);
  assert.equal(b.take(Date.UTC(2026, 7, 30, 0, 0, 1)), true);
});

test("a refund returns a reserved slot and never goes negative", () => {
  const b = new DailyBudget(2);
  const t = Date.UTC(2026, 7, 29, 10, 0, 0);
  b.take(t);
  b.refund(t);
  assert.equal(b.remaining(t), 2);
  b.refund(t);
  assert.equal(b.remaining(t), 2);
});

test("snapshot and restore carry the day across a restart", () => {
  const b = new DailyBudget(24);
  const t = Date.UTC(2026, 7, 29, 10, 0, 0);
  b.take(t);
  b.take(t);
  const restored = new DailyBudget(24).restore(b.snapshot());
  assert.equal(restored.remaining(t), 22);
  // A restart on the next day starts fresh even though the count was saved.
  assert.equal(restored.remaining(Date.UTC(2026, 7, 30, 0, 0, 1)), 24);
});

test("restore ignores a corrupt or hostile state file", () => {
  const t = Date.UTC(2026, 7, 29, 10, 0, 0);
  assert.equal(new DailyBudget(24).restore(null).remaining(t), 24);
  assert.equal(new DailyBudget(24).restore({ day: 5, count: -9 }).remaining(t), 24);
  assert.equal(new DailyBudget(24).restore({ day: "2026-08-29", count: "lots" }).remaining(t), 24);
});

// --- concurrency ------------------------------------------------------------

test("two callers on one period produce one submit and one tx hash", async () => {
  const p = new PendingRegistry();
  let calls = 0;
  let release;
  const gate = new Promise((r) => (release = r));
  const factory = async () => {
    calls += 1;
    await gate;
    return { txHash: "0xabc" };
  };
  const key = PendingRegistry.key(DEMO, 3n);
  const first = p.join(key, factory);
  const second = p.join(key, factory);
  release();
  const [a, b] = await Promise.all([first, second]);
  assert.equal(calls, 1);
  assert.equal(a.joined, false);
  assert.equal(b.joined, true);
  assert.equal(b.value.txHash, "0xabc");
  assert.equal(p.size, 0);
});

test("different periods are different locks", async () => {
  const p = new PendingRegistry();
  let calls = 0;
  const factory = async () => ({ txHash: `0x${++calls}` });
  await p.join(PendingRegistry.key(DEMO, 1n), factory);
  await p.join(PendingRegistry.key(DEMO, 2n), factory);
  assert.equal(calls, 2);
});

test("a failed submit releases the lock instead of wedging it", async () => {
  const p = new PendingRegistry();
  const key = PendingRegistry.key(DEMO, 1n);
  await assert.rejects(p.join(key, async () => {
    throw new Error("boom");
  }));
  assert.equal(p.size, 0);
  const ok = await p.join(key, async () => ({ txHash: "0x1" }));
  assert.equal(ok.joined, false);
});

test("a submitted tx stays remembered for its settle window", () => {
  const p = new PendingRegistry();
  const key = PendingRegistry.key(DEMO, 0n);
  const t0 = 1_700_000_000_000;
  p.remember(key, "0xdead", t0);
  assert.equal(p.recall(key, t0 + 60_000, 300), "0xdead");
  assert.equal(p.recall(key, t0 + 301_000, 300), undefined);
  assert.equal(p.recall(PendingRegistry.key(DEMO, 1n), t0, 300), undefined);
});

// --- response shaping -------------------------------------------------------

test("every response is exactly the documented shape", () => {
  assert.deepEqual(submitted("0xdead"), {
    status: "submitted",
    tx_hash: "0xdead",
    voyager_url: "https://voyager.online/tx/0xdead",
  });
  assert.deepEqual(notDue(13_615_666n, 30), {
    status: "not_due",
    next_due_block: 13615666,
    eta_minutes: 30,
  });
  assert.deepEqual(rateLimited(42), { status: "rate_limited", retry_after_s: 42 });
  assert.deepEqual(budgetExhausted(), { status: "budget_exhausted" });
  assert.deepEqual(failure("nope"), { status: "error", reason: "nope" });
});

test("http status codes match the response shape", () => {
  assert.equal(httpStatusFor(submitted("0x1")), 200);
  assert.equal(httpStatusFor(notDue(1n, 1)), 200);
  assert.equal(httpStatusFor(rateLimited(5)), 429);
  assert.equal(httpStatusFor(budgetExhausted()), 503);
  assert.equal(httpStatusFor(failure("x")), 400);
  assert.equal(httpStatusFor(undefined), 400);
});

test("safeReason names vault asserts and swallows everything else", () => {
  assert.match(safeReason(new Error("Error at pc=0:1\n0x4e535f4e4f545f445545 ('NS_NOT_DUE')")), /not due yet/);
  assert.match(safeReason("NS_PERIOD_SPENT"), /already charged/);
  assert.match(safeReason("NS_ESCROW_EXHAUSTED"), /no escrow left/);
  assert.match(safeReason("NS_CANCELLED"), /cancelled/);
  assert.match(safeReason("NS_UNKNOWN_SUB"), /no schedule/);
  assert.match(safeReason("account balance is insufficient"), /cannot cover the fee/);
});

test("safeReason never echoes a stack, a url, a key or an address", () => {
  const nasty = new Error(
    "connect ECONNREFUSED https://rpc.example/key/SECRET at Object.<anonymous> (/home/me/.nightshift/acct2.keypair:1:1)",
  );
  nasty.stack = "Error: ...\n    at deep/internal/path.js:9:9";
  const reason = safeReason(nasty);
  assert.equal(reason, "the charge could not be submitted right now");
  for (const leak of ["ECONNREFUSED", "http", "SECRET", "nightshift", "at ", "/"]) {
    assert.ok(!reason.includes(leak), `reason leaked ${leak}`);
  }
});

// --- gateRequest ------------------------------------------------------------

const config = () => ({
  whitelist: parseWhitelist(DEMO).felts,
  cooldownS: 900,
  probeCooldownS: 5,
});

const fresh = () => ({ cooldowns: new Cooldowns(), budget: new DailyBudget(24) });
const T0 = Date.UTC(2026, 7, 29, 12, 0, 0);

test("gateRequest passes a whitelisted commitment and normalizes it", () => {
  const { cooldowns, budget } = fresh();
  const g = gateRequest({ commitment: DEMO_PADDED, ip: "ip", nowMs: T0, config: config(), cooldowns, budget });
  assert.equal(g.allow, true);
  assert.equal(g.commitment, normalizeFelt(DEMO));
});

test("gateRequest refuses an unlisted commitment without any other check", () => {
  const { cooldowns, budget } = fresh();
  budget.count = 999; // even a spent budget must not change this answer
  const g = gateRequest({ commitment: OTHER, ip: "ip", nowMs: T0, config: config(), cooldowns, budget });
  assert.equal(g.allow, false);
  assert.equal(g.response.status, "error");
  assert.match(g.response.reason, /not the demo subscription/);
});

test("gateRequest refuses a malformed commitment", () => {
  const { cooldowns, budget } = fresh();
  for (const bad of ["", "0x", undefined, "select * from subs", 42]) {
    const g = gateRequest({ commitment: bad, ip: "ip", nowMs: T0, config: config(), cooldowns, budget });
    assert.equal(g.allow, false);
    assert.equal(g.response.status, "error");
  }
});

test("gateRequest rate-limits the probe bucket first, then the charge bucket", () => {
  const { cooldowns, budget } = fresh();
  const c = config();
  cooldowns.mark("probe", "ip", T0);
  let g = gateRequest({ commitment: DEMO, ip: "ip", nowMs: T0 + 1000, config: c, cooldowns, budget });
  assert.deepEqual(g.response, { status: "rate_limited", retry_after_s: 4 });

  cooldowns.mark("charge", "ip", T0);
  g = gateRequest({ commitment: DEMO, ip: "ip", nowMs: T0 + 10_000, config: c, cooldowns, budget });
  assert.deepEqual(g.response, { status: "rate_limited", retry_after_s: 890 });
});

test("gateRequest reports an exhausted budget after the per-IP checks", () => {
  const { cooldowns, budget } = fresh();
  for (let i = 0; i < 24; i += 1) budget.take(T0);
  const g = gateRequest({ commitment: DEMO, ip: "ip", nowMs: T0, config: config(), cooldowns, budget });
  assert.deepEqual(g.response, { status: "budget_exhausted" });
});

// --- gateChain --------------------------------------------------------------

test("gateChain forwards a due period and shapes every refusal", () => {
  const run = (over, head) =>
    gateChain({
      schedule: parseSchedule(scheduleFelts(over)),
      tierAmount: ONE_STRK,
      head,
      secondsPerBlock: 1.7,
    });

  const due = run({}, 13_613_566n);
  assert.equal(due.allow, true);
  assert.equal(due.periodIndex, 0n);

  const soon = run({ nextPeriod: "0x1" }, 13_615_666n - 2100n);
  assert.equal(soon.allow, false);
  assert.deepEqual(soon.response, { status: "not_due", next_due_block: 13615666, eta_minutes: 60 });

  assert.match(run({ cancelled: "0x1" }, 13_999_999n).response.reason, /cancelled/);
  assert.match(run({ escrow: "0x0" }, 13_999_999n).response.reason, /escrow/);
  assert.match(run({ creatorId: "0x0" }, 13_999_999n).response.reason, /no schedule/);
});
