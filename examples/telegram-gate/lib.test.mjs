// Tests for the pure parts of the Telegram gate. No network, no grammy
// import, no nightshift-verify import: these run before `npm ci` has ever
// touched this directory.
//
// Run with: node --test

import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  applyEnv,
  countsAsFailure,
  escapeHtml,
  formatWait,
  loadEnvFile,
  parseEnvText,
  parsePresentationText,
  parseTierChats,
  RateLimiter,
  REASON_MESSAGES,
  reasonMessage,
  stripCodeFence,
  TTLMap,
} from "./lib.mjs";
// Relative to verify/src/index.mjs itself, not through the nightshift-verify
// package name, so this import (and the coverage test below) works before
// `npm ci` has ever populated node_modules/nightshift-verify.
import { REASONS } from "../../verify/src/index.mjs";

// --- env parsing ---------------------------------------------------------

test("parseEnvText reads KEY=VALUE, skips blanks and comments", () => {
  const text = [
    "# a comment",
    "",
    "BOT_TOKEN=abc:123",
    "  STARKNET_RPC = https://rpc.example  ",
    "export CREATOR_ID=0xdead",
    'TIER_CHATS={"0":{"chat_id":"-1","label":"tier0"}}',
  ].join("\n");
  const parsed = parseEnvText(text);
  assert.equal(parsed.BOT_TOKEN, "abc:123");
  assert.equal(parsed.STARKNET_RPC, "https://rpc.example");
  assert.equal(parsed.CREATOR_ID, "0xdead");
  assert.equal(parsed.TIER_CHATS, '{"0":{"chat_id":"-1","label":"tier0"}}');
});

test("parseEnvText strips matching quotes", () => {
  const parsed = parseEnvText('A="quoted value"\nB=\'single\'\nC=bare');
  assert.equal(parsed.A, "quoted value");
  assert.equal(parsed.B, "single");
  assert.equal(parsed.C, "bare");
});

test("parseEnvText ignores a line with no =", () => {
  const parsed = parseEnvText("NOTANASSIGNMENT\nOK=1");
  assert.deepEqual(parsed, { OK: "1" });
});

test("loadEnvFile returns {} for a missing file", () => {
  assert.deepEqual(loadEnvFile("/definitely/not/a/real/path/.env"), {});
});

test("loadEnvFile reads and parses a real file", () => {
  const dir = mkdtempSync(join(tmpdir(), "telegram-gate-test-"));
  const path = join(dir, ".env");
  try {
    writeFileSync(path, "BOT_TOKEN=xyz\n");
    assert.deepEqual(loadEnvFile(path), { BOT_TOKEN: "xyz" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("applyEnv fills missing keys but never overrides an existing one", () => {
  const target = { BOT_TOKEN: "real-token" };
  applyEnv({ BOT_TOKEN: "from-dotenv", STARKNET_RPC: "https://rpc.example" }, target);
  assert.equal(target.BOT_TOKEN, "real-token");
  assert.equal(target.STARKNET_RPC, "https://rpc.example");
});

// --- TIER_CHATS ------------------------------------------------------------

test("parseTierChats parses a well-formed map", () => {
  const raw = JSON.stringify({
    0: { chat_id: "-1001111111111", label: "supporter" },
    1: { chat_id: -1002222222222, label: "insider" },
  });
  const tiers = parseTierChats(raw);
  assert.equal(tiers.size, 2);
  assert.deepEqual(tiers.get(0), { chat_id: "-1001111111111", label: "supporter" });
  assert.deepEqual(tiers.get(1), { chat_id: -1002222222222, label: "insider" });
});

test("parseTierChats rejects invalid JSON", () => {
  assert.throws(() => parseTierChats("{not json"), /not valid JSON/);
});

test("parseTierChats rejects a non-object top level", () => {
  assert.throws(() => parseTierChats("[1,2,3]"), /must be a JSON object/);
});

test("parseTierChats rejects a non-numeric tier key", () => {
  assert.throws(() => parseTierChats('{"vip":{"chat_id":"-1","label":"x"}}'), /not a plain tier number/);
});

test("parseTierChats rejects a missing chat_id or label", () => {
  assert.throws(() => parseTierChats('{"0":{"label":"x"}}'), /chat_id must be/);
  assert.throws(() => parseTierChats('{"0":{"chat_id":"-1"}}'), /label must be/);
  assert.throws(() => parseTierChats('{"0":{"chat_id":"-1","label":""}}'), /label must be/);
});

// --- presentation text parsing ---------------------------------------------

const PRESENTATION = {
  commitment: "0x1",
  verifier_id: "0x2",
  expiry_block: 100,
  nonce: "0x3",
  sig_r: "0x4",
  sig_s: "0x5",
};

test("stripCodeFence removes a ```json fence wrapped around the whole text", () => {
  const fenced = "```json\n" + JSON.stringify(PRESENTATION) + "\n```";
  assert.equal(stripCodeFence(fenced), JSON.stringify(PRESENTATION));
});

test("stripCodeFence removes a bare ``` fence", () => {
  const fenced = "```\n" + JSON.stringify(PRESENTATION) + "\n```";
  assert.equal(stripCodeFence(fenced), JSON.stringify(PRESENTATION));
});

test("stripCodeFence leaves unfenced text alone but trims it", () => {
  assert.equal(stripCodeFence("  hi  "), "hi");
});

test("parsePresentationText accepts the bare presentation", () => {
  const result = parsePresentationText(JSON.stringify(PRESENTATION));
  assert.deepEqual(result.presentation, PRESENTATION);
  assert.deepEqual(result.challenge, {});
});

test("parsePresentationText accepts the {presentation, challenge} wrapper", () => {
  const wrapped = { presentation: PRESENTATION, challenge: { verifier_id: "0x2", nonce: "0x3" } };
  const result = parsePresentationText(JSON.stringify(wrapped));
  assert.deepEqual(result.presentation, PRESENTATION);
  assert.deepEqual(result.challenge, { verifier_id: "0x2", nonce: "0x3" });
});

test("parsePresentationText strips a code fence before parsing", () => {
  const fenced = "```json\n" + JSON.stringify({ presentation: PRESENTATION }) + "\n```";
  const result = parsePresentationText(fenced);
  assert.deepEqual(result.presentation, PRESENTATION);
});

test("parsePresentationText tolerates surrounding whitespace", () => {
  const result = parsePresentationText(`\n\n   ${JSON.stringify(PRESENTATION)}   \n`);
  assert.deepEqual(result.presentation, PRESENTATION);
});

test("parsePresentationText reports parse_error for non-JSON text", () => {
  assert.deepEqual(parsePresentationText("not json at all"), { error: "parse_error" });
});

test("parsePresentationText reports parse_error for a JSON array or scalar", () => {
  assert.deepEqual(parsePresentationText("[1,2,3]"), { error: "parse_error" });
  assert.deepEqual(parsePresentationText("42"), { error: "parse_error" });
  assert.deepEqual(parsePresentationText("null"), { error: "parse_error" });
});

test("parsePresentationText reports parse_error when presentation itself is not an object", () => {
  assert.deepEqual(parsePresentationText(JSON.stringify({ presentation: "nope" })), { error: "parse_error" });
});

// --- REASONS mapping ---------------------------------------------------

// REASONS is the real export from verify/src/index.mjs (imported above by
// relative path), not a hand copy, so this test genuinely fails if
// verify/src/index.mjs ever adds, drops or renames a reason before
// REASON_MESSAGES is updated to match.
test("REASON_MESSAGES covers every reason nightshift-verify can return", () => {
  for (const reason of Object.values(REASONS)) {
    assert.ok(reason in REASON_MESSAGES, `missing a message for ${reason}`);
    assert.equal(typeof REASON_MESSAGES[reason], "string");
    assert.ok(REASON_MESSAGES[reason].length > 0);
  }
});

test("REASON_MESSAGES also covers the bot's own local reasons", () => {
  assert.ok("parse_error" in REASON_MESSAGES);
  assert.ok("wrong_creator" in REASON_MESSAGES);
});

test("reasonMessage falls back to a generic line for an unknown code", () => {
  assert.match(reasonMessage("something_new"), /verification failed \(something_new\)/);
});

test("reasonMessage returns the mapped line for a known code", () => {
  assert.equal(reasonMessage("expired"), REASON_MESSAGES.expired);
});

// --- TTLMap ------------------------------------------------------------

test("TTLMap returns a value before it expires and undefined after", () => {
  let now = 1_000;
  const map = new TTLMap({ ttlMs: 5000, clock: () => now });
  map.set("user1", { nonce: "0xabc" });
  assert.deepEqual(map.get("user1"), { nonce: "0xabc" });
  now += 4999;
  assert.deepEqual(map.get("user1"), { nonce: "0xabc" });
  now += 2;
  assert.equal(map.get("user1"), undefined);
});

test("TTLMap.has matches .get's expiry behavior", () => {
  let now = 0;
  const map = new TTLMap({ ttlMs: 1000, clock: () => now });
  map.set("k", 1);
  assert.equal(map.has("k"), true);
  now = 1000;
  assert.equal(map.has("k"), false);
});

test("TTLMap.delete removes a pending entry immediately (one-shot use)", () => {
  const map = new TTLMap({ ttlMs: 60_000 });
  map.set("user1", { nonce: "0xabc" });
  map.delete("user1");
  assert.equal(map.get("user1"), undefined);
});

test("TTLMap rejects a non-positive ttl", () => {
  assert.throws(() => new TTLMap({ ttlMs: 0 }));
  assert.throws(() => new TTLMap({ ttlMs: -5 }));
});

// --- escapeHtml --------------------------------------------------------

test("escapeHtml escapes &, < and >", () => {
  assert.equal(escapeHtml('a & b < c > d'), "a &amp; b &lt; c &gt; d");
});

test("escapeHtml leaves quotes and other characters alone", () => {
  assert.equal(escapeHtml('{"nonce":"0xabc"}'), '{"nonce":"0xabc"}');
});

test("escapeHtml escapes & before it turns < into &lt; into a new &", () => {
  // Order matters: escaping & first, then < and >, avoids double-escaping
  // the ampersand a naive < or > replacement would introduce.
  assert.equal(escapeHtml("<&>"), "&lt;&amp;&gt;");
});

// --- countsAsFailure -------------------------------------------------------

// Reasons that reflect something wrong on the OPERATOR's or the NODE's side,
// never on the presenter's: a node hiccup, a misconfigured vault, or (the
// bot's own local code) a message that never made it to verifyPresentation
// at all. None of these are evidence this user did anything wrong, so none
// of them should spend down their 5-strike budget.
const EXEMPT_REASONS = ["parse_error", REASONS.RPC_ERROR, REASONS.BAD_CONFIG];

test("countsAsFailure excludes parse_error, rpc_error and bad_config", () => {
  for (const reason of EXEMPT_REASONS) {
    assert.equal(countsAsFailure(reason), false, `expected ${reason} to be exempt`);
  }
});

test("countsAsFailure includes every other reason nightshift-verify can return, plus wrong_creator", () => {
  for (const reason of [...Object.values(REASONS), "wrong_creator"]) {
    if (EXEMPT_REASONS.includes(reason)) continue;
    assert.equal(countsAsFailure(reason), true, `expected ${reason} to count as a failure`);
  }
});

test("countsAsFailure still counts a real verification failure (wrong_creator)", () => {
  assert.equal(countsAsFailure("wrong_creator"), true);
});

test("countsAsFailure still counts a real verification failure (bad_signature)", () => {
  assert.equal(countsAsFailure(REASONS.BAD_SIGNATURE), true);
});

// --- RateLimiter ---------------------------------------------------------

test("RateLimiter enforces the challenge cooldown and then releases it", () => {
  let now = 0;
  const rl = new RateLimiter({ clock: () => now, challengeCooldownMs: 30_000 });

  assert.deepEqual(rl.canIssueChallenge("u1"), { allowed: true, retryAfterMs: 0 });
  rl.recordChallengeIssued("u1");

  now = 10_000;
  const blocked = rl.canIssueChallenge("u1");
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.retryAfterMs, 20_000);

  now = 30_000;
  assert.deepEqual(rl.canIssueChallenge("u1"), { allowed: true, retryAfterMs: 0 });
});

test("RateLimiter tracks cooldowns per user independently", () => {
  let now = 0;
  const rl = new RateLimiter({ clock: () => now, challengeCooldownMs: 30_000 });
  rl.recordChallengeIssued("u1");
  assert.equal(rl.canIssueChallenge("u2").allowed, true);
});

test("RateLimiter locks a user out after maxFailures and clears on success", () => {
  let now = 0;
  const rl = new RateLimiter({ clock: () => now, maxFailures: 5, lockoutMs: 600_000 });

  for (let i = 0; i < 4; i++) {
    rl.recordFailure("u1");
    assert.equal(rl.isLockedOut("u1").locked, false);
  }
  rl.recordFailure("u1"); // 5th failure trips the lockout
  const locked = rl.isLockedOut("u1");
  assert.equal(locked.locked, true);
  assert.equal(locked.retryAfterMs, 600_000);

  now = 600_000;
  assert.deepEqual(rl.isLockedOut("u1"), { locked: false, retryAfterMs: 0 });
});

test("RateLimiter.recordSuccess resets the failure count", () => {
  let now = 0;
  const rl = new RateLimiter({ clock: () => now, maxFailures: 5, lockoutMs: 600_000 });
  rl.recordFailure("u1");
  rl.recordFailure("u1");
  rl.recordSuccess("u1");
  for (let i = 0; i < 4; i++) rl.recordFailure("u1");
  assert.equal(rl.isLockedOut("u1").locked, false, "success should have zeroed the earlier failures");
});

test("RateLimiter lockout and cooldown are independent per user", () => {
  let now = 0;
  const rl = new RateLimiter({ clock: () => now, maxFailures: 5, lockoutMs: 600_000 });
  for (let i = 0; i < 5; i++) rl.recordFailure("u1");
  assert.equal(rl.isLockedOut("u1").locked, true);
  assert.equal(rl.isLockedOut("u2").locked, false);
});

// --- formatWait ----------------------------------------------------------

test("formatWait renders sub-minute durations in seconds", () => {
  assert.equal(formatWait(1), "1s");
  assert.equal(formatWait(999), "1s");
  assert.equal(formatWait(23_000), "23s");
  assert.equal(formatWait(59_000), "59s");
});

test("formatWait renders minute-plus durations in minutes, rounded up", () => {
  assert.equal(formatWait(60_000), "1m");
  assert.equal(formatWait(60_001), "2m");
  assert.equal(formatWait(600_000), "10m");
});
