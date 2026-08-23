// Parity between the app's ported wallet math (src/lib/wallet/core.ts) and the
// ops console (../../web/app.mjs), which is the implementation that has
// actually put transactions on mainnet.
//
// The console is a browser entry module: it wires DOM handlers at import time
// and reads its inputs out of the document. So the same stubbing pattern
// scripts/present-message-compat.test.mjs uses is extended here by three
// things, which is what makes the console's private derivations reachable:
//
//   - the log pane records the lines the console writes, instead of dropping
//     them, so the values it prints can be read back;
//   - localStorage is pre-loaded with a FIXED subscriber secret and payout key,
//     so both implementations derive from the same material;
//   - window carries a stub wallet that answers standard:connect with a fixed
//     address and refuses every pool call. Refusing is enough: the console logs
//     the batch it built BEFORE it hands it over, so the calldata under test is
//     the calldata it would have submitted.
//
// Nothing here touches the network, and the two secrets below are test
// fixtures written into a Map, never onto a disk and never onto a chain.
//
//   node --test test/wallet-parity.test.mjs

import assert from "node:assert/strict";
import test from "node:test";

import {
  cancelMessage,
  claimActions,
  claimMessage,
  commitmentOf,
  creatorIdOf,
  ownerPrivFor,
  presentMessage,
  reclaimMessage,
  resolveNoteId,
  signWith,
  starkPubOf,
  subscribeActions,
  OPEN_NOTE_PLACEHOLDER,
} from "../src/lib/wallet/core.ts";

// --- fixtures --------------------------------------------------------------

const SECRET = "0x0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20";
const PAYOUT = "0x02a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f";
const ACCOUNT = "0x04a3f81c9d2e7b6a5f4e3d2c1b0a998877665544332211009988776655444b19";
const RECLAIM_TO = "0x0511f1c2b3a495867788990011223344556677889900aabbccddeeff00112233";

const VAULT = "0x171e8e0bb905c899b9d1ad5c02aefe96a5d0b6d5f093f0ee80707b592417f8e";
const STRK = "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";
const E18 = 10n ** 18n;

const TIER_STRK = 1;
const PERIODS = 3;
const PERIOD_BLOCKS = 2100;
const CLAIM_STRK = "1";
/** The id the stub wallet resolves the open-note placeholder to. */
const NOTE_ID = "0x5c0ffee1234567890abcdef1234567890abcdef1234567890abcdef123456";

// --- browser stubs ---------------------------------------------------------

const logLines = [];
const elements = new Map();
const makeEl = () => ({
  onclick: null,
  value: "",
  textContent: "",
  className: "",
  disabled: true,
  checked: false,
  appendChild(child) {
    logLines.push(child.textContent);
  },
  scrollIntoView() {},
  select() {},
});

globalThis.document = {
  // get-starknet-core pulls in @module-federation, which reads
  // document.defaultView and expects a real global object back.
  defaultView: globalThis,
  getElementById(id) {
    if (!elements.has(id)) elements.set(id, makeEl());
    return elements.get(id);
  },
  createElement() {
    return makeEl();
  },
};

const ls = new Map([
  ["nightshift.subscriber.secret", SECRET],
  ["nightshift.payout.priv", PAYOUT],
]);
globalThis.localStorage = {
  getItem: (k) => (ls.has(k) ? ls.get(k) : null),
  setItem: (k, v) => ls.set(k, v),
};

/** What the console's strk20PrepareInvoke stub answers for a claim: a pool
 *  call whose calldata carries the resolved note id in the position the
 *  console scans for, wrapped in filler so the scan has to find it. */
const preparedClaimCalldata = (creatorIdFelt, amountWei) => [
  "0x1",
  "0x2",
  creatorIdFelt,
  NOTE_ID,
  `0x${amountWei.toString(16)}`,
  "0x1",
  "0x1",
  "0x9",
];

let preparedAnswer = null;

const stubWallet = {
  id: "ready",
  name: "Ready (test stub)",
  features: {
    "standard:connect": { connect: async () => ({ accounts: [{ address: ACCOUNT }] }) },
    "standard:events": { on: () => () => {} },
    "starknet:walletApi": {
      request: async (call) => {
        if (call.type === "wallet_strk20PrepareInvoke" && preparedAnswer) {
          return preparedAnswer;
        }
        throw new Error(`stub wallet refuses ${call.type}`);
      },
    },
  },
};

globalThis.window = {
  starknet_ready: stubWallet,
  addEventListener() {},
  removeEventListener() {},
  dispatchEvent() {
    return true;
  },
};

const consoleModule = await import("../../web/app.mjs");
const el = (id) => document.getElementById(id);

// --- drive the console -----------------------------------------------------

const since = () => {
  const from = logLines.length;
  return () => logLines.slice(from);
};

el("tier0").value = String(TIER_STRK);
el("nper").value = String(PERIODS);
el("pblocks").value = String(PERIOD_BLOCKS);
el("clamount").value = CLAIM_STRK;
el("dry3").checked = true;

const afterConnect = since();
await el("connect").onclick();
const connectLines = afterConnect();

const line = (lines, prefix) => {
  const hit = lines.find((l) => l.startsWith(prefix));
  assert.ok(hit, `the console did not print a line starting with ${JSON.stringify(prefix)}`);
  return hit;
};

// --- what this port derives, from the same fixtures ------------------------

const payoutPub = starkPubOf(PAYOUT);
const creatorId = creatorIdOf(ACCOUNT, STRK, payoutPub);
const commitment = commitmentOf(SECRET, creatorId);
const ownerPriv = ownerPrivFor(SECRET, creatorId);
const ownerPub = starkPubOf(ownerPriv);

// --- key derivations -------------------------------------------------------

test("the payout pubkey matches the console's", () => {
  assert.equal(line(connectLines, "payout pubkey: "), `payout pubkey: ${payoutPub}`);
});

test("the per-commitment owner pubkey matches the console's", () => {
  const printed = line(connectLines, "owner pubkey (creator ");
  assert.equal(printed, `owner pubkey (creator ${creatorId.slice(0, 10)}…): ${ownerPub}`);
});

test("the derived owner key is a valid scalar and is not the master secret", () => {
  assert.match(ownerPriv, /^0x[0-9a-f]{64}$/);
  assert.notEqual(BigInt(ownerPriv), BigInt(SECRET));
  assert.notEqual(BigInt(ownerPriv), BigInt(PAYOUT));
});

// --- subscribe calldata ----------------------------------------------------

// A dry run only builds and proves, so an empty prepared answer is a faithful
// stand-in: the console logs the batch before it hands it over either way.
preparedAnswer = { call: { calldata: [] }, proof: {} };
const afterSubscribe = since();
await el("subscribe").onclick();
const subscribeLines = afterSubscribe();
const consoleSubscribe = JSON.parse(line(subscribeLines, "subscribe: ").slice("subscribe: ".length));

test("the subscribe batch matches the console's, action for action", () => {
  const mine = subscribeActions({
    vault: VAULT,
    token: STRK,
    commitment,
    creatorId,
    tier: 0,
    periodBlocks: PERIOD_BLOCKS,
    nPeriods: PERIODS,
    ownerPub,
    escrowWei: BigInt(TIER_STRK) * E18 * BigInt(PERIODS),
  });
  assert.deepEqual(mine, consoleSubscribe);
});

test("the subscribe invoke calldata has the shape the live subscription used", () => {
  // The real mainnet subscription logged
  //   [0x0, 0x743b3e7f…, 0x396c007f…, 0x0, 0x834, 0x3, ownerPub]
  // which is [variant, commitment, creator_id, tier, period_blocks, n_periods,
  // owner_key]. The fixture secret gives different felts in slots 1, 2 and 6;
  // every other slot is pinned to the literal it had on chain.
  const invoke = consoleSubscribe[1];
  assert.equal(invoke.type, "invoke");
  assert.equal(invoke.contract, VAULT);
  assert.equal(invoke.calldata.length, 7);
  assert.equal(invoke.calldata[0], "0x0", "variant 0 is Subscribe");
  assert.equal(BigInt(invoke.calldata[1]), BigInt(commitment));
  assert.equal(BigInt(invoke.calldata[2]), BigInt(creatorId));
  assert.equal(invoke.calldata[3], "0x0", "tier index");
  assert.equal(invoke.calldata[4], "0x834", "2100 blocks, the hourly rung of the ladder");
  assert.equal(invoke.calldata[5], "0x3", "three periods");
  assert.equal(BigInt(invoke.calldata[6]), BigInt(ownerPub));
  // No leading zeros anywhere: calldata felts forbid them.
  for (const felt of invoke.calldata) assert.doesNotMatch(felt, /^0x0[0-9a-f]/);
});

test("the withdraw leg escrows tier times periods into the vault", () => {
  const withdraw = consoleSubscribe[0];
  assert.equal(withdraw.type, "withdraw");
  assert.equal(withdraw.token, STRK);
  assert.equal(withdraw.recipient, VAULT);
  assert.equal(BigInt(withdraw.amount), BigInt(TIER_STRK) * E18 * BigInt(PERIODS));
});

// --- cancel and reclaim messages ------------------------------------------

const afterCancel = since();
el("cancelsign").onclick();
el("reclaimto").value = RECLAIM_TO;
el("reclaimsign").onclick();
const signLines = afterCancel();

test("the cancel signature and relay line match the console's", () => {
  const sig = signWith(cancelMessage(commitment), ownerPriv);
  assert.equal(
    line(signLines, "node scripts/relay.mjs cancel "),
    `node scripts/relay.mjs cancel ${commitment} ${sig.r} ${sig.s}`,
  );
});

test("the reclaim signature and relay line match the console's", () => {
  const sig = signWith(reclaimMessage(commitment, RECLAIM_TO), ownerPriv);
  assert.equal(
    line(signLines, "node scripts/relay.mjs reclaim "),
    `node scripts/relay.mjs reclaim ${commitment} ${RECLAIM_TO} ${sig.r} ${sig.s}`,
  );
});

test("the cancel and reclaim messages are domain-separated from each other", () => {
  assert.notEqual(cancelMessage(commitment), reclaimMessage(commitment, RECLAIM_TO));
  assert.notEqual(
    reclaimMessage(commitment, RECLAIM_TO),
    reclaimMessage(commitment, ACCOUNT),
    "the destination is inside the message, so a relay cannot redirect it",
  );
});

// --- present message -------------------------------------------------------

test("the present message matches the console's exported layout", () => {
  const fields = ["0x2a", 501_000, "0x0deadbeef"];
  assert.equal(
    presentMessage(commitment, fields[0], `0x${fields[1].toString(16)}`, fields[2]),
    consoleModule.presentMessageFor(commitment, fields[0], fields[1], fields[2]),
  );
});

test("the present message still hits the hash the deployed gate accepted", () => {
  // The vector and the constant are scripts/present-message-compat.test.mjs's,
  // which anchors them to mainnet tx 0x30191636… where the gate accepted a
  // presentation built with this exact five-element layout.
  const COMMITMENT = "0x6d1f3a9c2b8e4700112233445566778899aabbccddeeff00112233445566778";
  assert.equal(
    presentMessage(COMMITMENT, "0x2a", `0x${(501_000).toString(16)}`, "0x0deadbeef"),
    "0x5232c58e65d5cca36d19bd60651c7de23deda70e56ace38522183ab67323f1e",
  );
});

// --- claim: prepare, resolve, sign, send ----------------------------------

const claimWei = BigInt(CLAIM_STRK) * E18;
preparedAnswer = { call: { calldata: preparedClaimCalldata(creatorId, claimWei) }, proof: {} };

const afterPrepare = since();
await el("claimprep").onclick();
const prepareLines = afterPrepare();

test("the note id this port resolves is the one the console resolved", () => {
  const mine = resolveNoteId(preparedClaimCalldata(creatorId, claimWei), creatorId, claimWei);
  assert.equal(mine, NOTE_ID);
  assert.equal(el("noteid").value, mine);
  // Matched by suffix rather than by the console's whole sentence, so this
  // file does not have to carry the punctuation that sentence uses.
  assert.ok(
    prepareLines.some((l) => l.startsWith("prepared") && l.endsWith(`resolved note id: ${mine}`)),
    "the console did not report the resolved note id",
  );
});

test("a batch without the marker pattern resolves to null rather than a guess", () => {
  assert.equal(resolveNoteId(["0x1", "0x2", "0x3"], creatorId, claimWei), null);
});

const afterSend = since();
await el("claimsend").onclick();
const sendLines = afterSend();
const consoleClaim = JSON.parse(line(sendLines, "claim: ").slice("claim: ".length));

test("the claim batch matches the console's, including the payout signature", () => {
  const sig = signWith(claimMessage(creatorId, NOTE_ID, claimWei), PAYOUT);
  const mine = claimActions({
    vault: VAULT,
    token: STRK,
    accountAddress: ACCOUNT,
    creatorId,
    amountWei: claimWei,
    noteId: OPEN_NOTE_PLACEHOLDER,
    sig,
  });
  assert.deepEqual(mine, consoleClaim);
});

test("the claim batch carries the placeholder, never the literal note id", () => {
  const invoke = consoleClaim[2];
  assert.equal(invoke.calldata[2], OPEN_NOTE_PLACEHOLDER);
  assert.ok(!JSON.stringify(consoleClaim).includes(NOTE_ID));
});

// --- the property that matters more than any single hash -------------------

test("no key material appears in anything either implementation prints", () => {
  const everything = JSON.stringify([logLines, consoleSubscribe, consoleClaim]).toLowerCase();
  for (const [label, key] of [
    ["subscriber secret", SECRET],
    ["payout key", PAYOUT],
    ["derived owner key", ownerPriv],
  ]) {
    const bare = BigInt(key).toString(16);
    assert.ok(!everything.includes(bare), `${label} leaked into rendered output`);
  }
});
