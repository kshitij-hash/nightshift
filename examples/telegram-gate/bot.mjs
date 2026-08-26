#!/usr/bin/env node
// A minimal Telegram gate on top of nightshift-verify: this file has no
// wallet, no private key and no shielded balance anywhere in it. It runs
// three read-only RPC calls per verification attempt (one in makeChallenge
// for the current block, two inside verifyPresentation for schedule_of and
// owner_key_of) and writes nothing to any chain. The only state it keeps is
// two in-memory maps, both gone the moment the process exits.
//
// Flow:
//   /start          -> issue a challenge, store it against this Telegram
//                       user id for 5 minutes, print it as JSON.
//   any other text  -> parse it as a presentation, delete the pending
//                       challenge (one-shot, so a captured message cannot be
//                       replayed against this bot), then verify it. On a
//                       match for CREATOR_ID, mint a single-use invite link
//                       to that tier's chat. On anything else, explain why.
//
// Run with: npm ci --ignore-scripts && npm start
// Needs BOT_TOKEN, STARKNET_RPC, NIGHTSHIFT_VAULT, VERIFIER_ID, CREATOR_ID
// and TIER_CHATS set, in the environment or in a .env file. See .env.example
// and README.md.

import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Bot } from "grammy";
import { makeChallenge, verifyPresentation, REASONS, toVerifierFelt } from "nightshift-verify";
import {
  applyEnv,
  countsAsFailure,
  escapeHtml,
  formatWait,
  loadEnvFile,
  parsePresentationText,
  parseTierChats,
  RateLimiter,
  reasonMessage,
  TTLMap,
} from "./lib.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
applyEnv(loadEnvFile(join(HERE, ".env")), process.env);

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set. Copy .env.example to .env and fill it in.`);
  return value;
}

// CREATOR_ID is compared as a felt, not as a string: verifyPresentation
// returns creatorId as 0x-hex with no leading zeros, but an operator may
// paste it padded, in decimal, or copied from either of the two console log
// lines that print it. Fail at boot with the env var named, rather than at
// the first presentation, if it is not parseable at all.
function requireFeltEnv(name) {
  const raw = requireEnv(name);
  const t = raw.trim();
  if (!/^(0x[0-9a-fA-F]+|[0-9]+)$/.test(t)) {
    throw new Error(
      `${name} is not a valid felt: "${raw}". Expected 0x-hex or decimal, ` +
        "padded or not - copy it from the ops console's creator_id log line.",
    );
  }
  return BigInt(t);
}

// NIGHTSHIFT_VAULT is a contract address, never a felt padded past 64 hex
// digits or missing the 0x prefix. An address this bot cannot parse would
// otherwise surface as "could not reach the Starknet node" at the first
// /start, since it fails deep inside the RPC call rather than here.
function requireVaultEnv(name) {
  const raw = requireEnv(name);
  const t = raw.trim();
  if (!/^0x[0-9a-fA-F]{1,64}$/.test(t)) {
    throw new Error(
      `${name} is not a valid contract address: "${raw}". Expected 0x followed by ` +
        "1 to 64 hex digits - copy it from DEPLOYMENTS.md or the ops console.",
    );
  }
  return t;
}

// VERIFIER_ID has to be something toVerifierFelt can actually turn into a
// felt: 0x-hex, decimal, or a short string of at most 31 chars. Checking
// that here, with the exact rules verifyPresentation and makeChallenge will
// apply later, means an over-long or unencodable VERIFIER_ID fails at boot
// naming the var, instead of surfacing as a fake "could not reach the
// Starknet node" error at every /start (toVerifierFelt throws deep inside
// makeChallenge, which this bot's /start handler reports as an RPC failure).
function requireVerifierIdEnv(name) {
  const raw = requireEnv(name);
  try {
    toVerifierFelt(raw, name);
  } catch (e) {
    throw new Error(
      `${name} is not usable as a verifier id: "${raw}" (${e.message}). Expected 0x-hex, ` +
        "decimal, or a short string of at most 31 characters.",
    );
  }
  return raw;
}

const BOT_TOKEN = requireEnv("BOT_TOKEN");
const STARKNET_RPC = requireEnv("STARKNET_RPC");
const NIGHTSHIFT_VAULT = requireVaultEnv("NIGHTSHIFT_VAULT");
const VERIFIER_ID = requireVerifierIdEnv("VERIFIER_ID");
const CREATOR_ID = requireFeltEnv("CREATOR_ID");
const TIER_CHATS = parseTierChats(requireEnv("TIER_CHATS"));
/** Where subscribers are sent to sign a challenge in the browser. Optional:
 *  the public site is the right default, and a fork points it elsewhere. */
const SITE_URL = (process.env.SITE_URL || "https://nightshift-six-lilac.vercel.app").replace(/\/+$/, "");

const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const INVITE_TTL_SECONDS = 10 * 60;

// Keyed by Telegram user id. Both maps live only in process memory: nothing
// here is written to disk, so a restart forgets every pending challenge and
// every rate-limit counter. That is a fine tradeoff for a gate whose job is
// "decide right now", not "remember forever".
const pending = new TTLMap({ ttlMs: CHALLENGE_TTL_MS });
const limiter = new RateLimiter();

const bot = new Bot(BOT_TOKEN);

bot.command("start", async (ctx) => {
  // This bot is a group admin in every tier chat, so an admin bot receives
  // every message sent there too, not just DMs. Without this guard, /start
  // typed by anyone in a tier chat would issue that chat a challenge.
  if (ctx.chat?.type !== "private") return;

  const userId = ctx.from?.id;
  if (userId === undefined) return;

  const locked = limiter.isLockedOut(userId);
  if (locked.locked) {
    await ctx.reply(`too many failed attempts. try again in ${formatWait(locked.retryAfterMs)}.`);
    return;
  }

  const cooldown = limiter.canIssueChallenge(userId);
  if (!cooldown.allowed) {
    await ctx.reply(`one challenge at a time. try again in ${formatWait(cooldown.retryAfterMs)}.`);
    return;
  }

  let challenge;
  try {
    challenge = await makeChallenge({ verifierId: VERIFIER_ID, rpcUrl: STARKNET_RPC });
  } catch (e) {
    await ctx.reply("could not reach the Starknet node to build a challenge. try again shortly.");
    console.error("makeChallenge failed:", e);
    return;
  }

  limiter.recordChallengeIssued(userId);
  pending.set(userId, challenge);

  // Two messages, not one: gluing the JSON to prose in a single reply means a
  // subscriber who select-alls the message and pastes it into the console
  // hands parseChallenge a trailing instruction line it cannot parse. The
  // JSON goes out as an HTML <pre> block (escaping &, < and >) rather than a
  // Markdown fence, since Telegram's default parse mode is plain text and
  // renders literal backticks instead of a tap-to-copy block; the console's
  // parseChallenge already tolerates the surrounding whitespace a <pre>
  // block's own formatting adds, so the pasted body still parses.
  await ctx.reply(`<pre>${escapeHtml(JSON.stringify(challenge))}</pre>`, { parse_mode: "HTML" });
  await ctx.reply(
    `Sign this on the NIGHTSHIFT gate page: ${SITE_URL}/verify - paste the challenge, ` +
      "sign it in your browser (step 02, the page never sees a private key), press " +
      "COPY THE PRESENTATION, and paste it back here.",
  );
});

bot.on("message:text", async (ctx) => {
  // Same reason as the /start guard above: an admin bot sees every message in
  // every tier chat, and treating those as presentation attempts would spam
  // the paid group and burn members' pending challenges (or none, since
  // pending.delete below runs before the text is even parsed).
  if (ctx.chat?.type !== "private") return;

  const userId = ctx.from?.id;
  if (userId === undefined) return;
  if (ctx.message.text.startsWith("/")) return; // let other commands, if any, pass through

  const locked = limiter.isLockedOut(userId);
  if (locked.locked) {
    await ctx.reply(`too many failed attempts. try again in ${formatWait(locked.retryAfterMs)}.`);
    return;
  }

  const challenge = pending.get(userId);
  if (!challenge) {
    await ctx.reply("no challenge is pending for you. send /start first.");
    return;
  }
  // One presentation per challenge: delete it before verifying, so a message
  // that arrives twice (a retry, a copy-paste of the same text) cannot be
  // checked against the same nonce twice, whatever the answer was.
  pending.delete(userId);

  const parsed = parsePresentationText(ctx.message.text);
  if (parsed.error) {
    // parse_error means the text never became a presentation at all - a
    // fat-fingered paste, not a failed verification - so it does not spend
    // down the same 5-strike budget as an actual bad presentation.
    if (countsAsFailure(parsed.error)) limiter.recordFailure(userId);
    await ctx.reply(`no: ${reasonMessage(parsed.error)}`);
    return;
  }

  let result;
  try {
    result = await verifyPresentation({
      presentation: parsed.presentation,
      expectedVerifierId: VERIFIER_ID,
      // The nonce comes from the challenge THIS bot stored, never from
      // anything in the message. A verifier that reads the nonce off the
      // thing it is checking has checked nothing.
      expectedNonce: challenge.nonce,
      rpcUrl: STARKNET_RPC,
      vaultAddress: NIGHTSHIFT_VAULT,
    });
  } catch (e) {
    // verifyPresentation is documented not to throw; this is here only so a
    // bug in a future version of the library fails as a message, not a
    // crashed bot. A library throw is not evidence this user did anything
    // wrong, so it does not spend down their 5-strike budget either.
    await ctx.reply(`no: ${reasonMessage(REASONS.RPC_ERROR)}`);
    console.error("verifyPresentation threw:", e);
    return;
  }

  if (!result.ok) {
    // Only reasons that reflect something wrong with THIS presentation count
    // toward the lockout - a node hiccup (rpc_error) or a misconfigured gate
    // (bad_config) is not this user's fault. See countsAsFailure in lib.mjs.
    if (countsAsFailure(result.reason)) limiter.recordFailure(userId);
    await ctx.reply(`no: ${reasonMessage(result.reason)}`);
    return;
  }

  // Compared as felts, not as strings: verifyPresentation returns creatorId
  // as 0x-hex with no leading zeros, but CREATOR_ID may be padded, decimal,
  // or copied from either console log line that prints it (see
  // requireFeltEnv above and .env.example).
  if (BigInt(result.creatorId) !== CREATOR_ID) {
    limiter.recordFailure(userId);
    await ctx.reply(`no: ${reasonMessage("wrong_creator")}`);
    return;
  }

  const tier = TIER_CHATS.get(result.tier);
  if (!tier) {
    // A missing TIER_CHATS entry is an operator error hit by a PROVEN
    // subscriber (verifyPresentation and the creator check both passed), so
    // it is never this user's failure and never spends their budget.
    await ctx.reply(`no: the gate is misconfigured for tier ${result.tier}. tell whoever runs this bot.`);
    console.error(`TIER_CHATS has no entry for tier ${result.tier}`);
    return;
  }

  limiter.recordSuccess(userId);

  try {
    const invite = await ctx.api.createChatInviteLink(tier.chat_id, {
      member_limit: 1,
      expire_date: Math.floor(Date.now() / 1000) + INVITE_TTL_SECONDS,
    });
    await ctx.reply(`${tier.label}: ${invite.invite_link}\nGood for one join, expires in 10 minutes.`);
  } catch (e) {
    await ctx.reply(
      "verified, but the invite link could not be created. " +
        "check that this bot is an admin in the tier chat with the invite-link right.",
    );
    console.error("createChatInviteLink failed:", e);
  }
});

bot.catch((err) => {
  console.error("bot error:", err.error ?? err);
});

bot.start();
