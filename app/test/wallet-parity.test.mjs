// Golden-value tests for the app's wallet math (src/lib/wallet/core.ts).
//
// The constants below were captured from the retired ops console (web/app.mjs)
// on the day it was deleted, driven with these exact fixtures. The console is
// the implementation that put the first transactions on mainnet, so these
// values are anchored to behavior the chain accepted - and Stark-curve signing
// is RFC6979-deterministic, which is what makes signatures usable as golden
// constants at all. If any assertion here starts failing, the port's message
// layout or calldata shape has drifted from what the deployed contracts
// accepted, which is exactly the change that must never land silently.
//
// Nothing here touches the network, and the two secrets below are test
// fixtures written into this file, never onto a disk and never onto a chain.
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
  registerCreatorCall,
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

const PERIODS = 3;
const PERIOD_BLOCKS = 2100;
const NOTE_ID = "0x5c0ffee1234567890abcdef1234567890abcdef1234567890abcdef123456";

// --- golden values, captured from the console ------------------------------

const GOLDEN = {
  payoutPub: "0x6cc1e58bb391d06e55f735979e8898afa38ed2967da6e0c8d33ffad902b244d",
  creatorId: "0x7525fe6764e78a5245be791a3f83cd40865710bea250d9af02148e37c7497be",
  commitment: "0x82af430492ef7b2660bfabba97c91253cadf12d64ac8a8af6c7d2c400335e4",
  ownerPub: "0x358069de7f7582c6c1d8cc000359f40d5d3ac3a851e9b152a507e74461d5335",
  subscribe: [
    {
      type: "withdraw",
      token: STRK,
      amount: "0x29a2241af62c0000",
      recipient: VAULT,
    },
    {
      type: "invoke",
      contract: VAULT,
      calldata: [
        "0x0",
        "0x82af430492ef7b2660bfabba97c91253cadf12d64ac8a8af6c7d2c400335e4",
        "0x7525fe6764e78a5245be791a3f83cd40865710bea250d9af02148e37c7497be",
        "0x0",
        "0x834",
        "0x3",
        "0x358069de7f7582c6c1d8cc000359f40d5d3ac3a851e9b152a507e74461d5335",
      ],
    },
  ],
  cancelRelay:
    "node scripts/relay.mjs cancel 0x82af430492ef7b2660bfabba97c91253cadf12d64ac8a8af6c7d2c400335e4 0x5a28966718aa16c72f8c35f395a401d28c2bdd63a07092ec26594ab0ce5a3f9 0x736f98b78a00ef554ddd2b7875944d38f6ef033aaa45ef14f91991f56f4fd84",
  reclaimRelay:
    "node scripts/relay.mjs reclaim 0x82af430492ef7b2660bfabba97c91253cadf12d64ac8a8af6c7d2c400335e4 0x0511f1c2b3a495867788990011223344556677889900aabbccddeeff00112233 0xbdd06d5eda5e27ce1e3489bc264704d481edd20d0600919d68a0dd5eb82059 0x636f389879a45c97cef92de0844adacfe5cce381fedc75058041d05a240b73a",
  claim: [
    {
      type: "withdraw",
      token: STRK,
      amount: "0x16345785d8a0000",
      recipient: ACCOUNT,
    },
    {
      type: "transfer",
      token: STRK,
      amount: "OPEN",
      recipient: ACCOUNT,
    },
    {
      type: "invoke",
      contract: VAULT,
      calldata: [
        "0x1",
        "0x7525fe6764e78a5245be791a3f83cd40865710bea250d9af02148e37c7497be",
        OPEN_NOTE_PLACEHOLDER,
        "0xde0b6b3a7640000",
        "0x7014979d80458eec8c539ea7c2f8d506b0a8df4816161a4a0c7aa79874d7d5",
        "0x9f2afeb728ecd2c294bfa62a6a8b62671fe0d2e623aa1d83662bedc29c7c3e",
      ],
    },
  ],
};

// --- what this port derives, from the same fixtures ------------------------

const payoutPub = starkPubOf(PAYOUT);
const creatorId = creatorIdOf(ACCOUNT, STRK, payoutPub);
const commitment = commitmentOf(SECRET, creatorId);
const ownerPriv = ownerPrivFor(SECRET, creatorId);
const ownerPub = starkPubOf(ownerPriv);

// --- key derivations -------------------------------------------------------

test("the payout pubkey matches the golden derivation", () => {
  assert.equal(payoutPub, GOLDEN.payoutPub);
});

test("the creator id and commitment match the golden derivations", () => {
  assert.equal(BigInt(creatorId), BigInt(GOLDEN.creatorId));
  assert.equal(BigInt(commitment), BigInt(GOLDEN.commitment));
});

test("the per-commitment owner pubkey matches the golden derivation", () => {
  assert.equal(ownerPub, GOLDEN.ownerPub);
});

test("the derived owner key is a valid scalar and is not the master secret", () => {
  assert.match(ownerPriv, /^0x[0-9a-f]{64}$/);
  assert.notEqual(BigInt(ownerPriv), BigInt(SECRET));
  assert.notEqual(BigInt(ownerPriv), BigInt(PAYOUT));
});

// --- subscribe calldata ----------------------------------------------------

const mySubscribe = subscribeActions({
  vault: VAULT,
  token: STRK,
  commitment,
  creatorId,
  tier: 0,
  periodBlocks: PERIOD_BLOCKS,
  nPeriods: PERIODS,
  ownerPub,
  escrowWei: 1n * E18 * BigInt(PERIODS),
});

test("the subscribe batch matches the golden batch, action for action", () => {
  assert.deepEqual(mySubscribe, GOLDEN.subscribe);
});

test("the subscribe invoke calldata has the shape the live subscription used", () => {
  // The real mainnet subscription logged
  //   [0x0, 0x743b3e7f…, 0x396c007f…, 0x0, 0x834, 0x3, ownerPub]
  // which is [variant, commitment, creator_id, tier, period_blocks, n_periods,
  // owner_key]. The fixture secret gives different felts in slots 1, 2 and 6;
  // every other slot is pinned to the literal it had on chain.
  const invoke = mySubscribe[1];
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
  const withdraw = mySubscribe[0];
  assert.equal(withdraw.type, "withdraw");
  assert.equal(withdraw.token, STRK);
  assert.equal(withdraw.recipient, VAULT);
  assert.equal(BigInt(withdraw.amount), 1n * E18 * BigInt(PERIODS));
});

// --- cancel and reclaim messages ------------------------------------------

test("the cancel signature and relay line match the golden line", () => {
  const sig = signWith(cancelMessage(commitment), ownerPriv);
  assert.equal(
    `node scripts/relay.mjs cancel ${commitment} ${sig.r} ${sig.s}`,
    GOLDEN.cancelRelay,
  );
});

test("the reclaim signature and relay line match the golden line", () => {
  const sig = signWith(reclaimMessage(commitment, RECLAIM_TO), ownerPriv);
  assert.equal(
    `node scripts/relay.mjs reclaim ${commitment} ${RECLAIM_TO} ${sig.r} ${sig.s}`,
    GOLDEN.reclaimRelay,
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

// --- register_creator calldata ---------------------------------------------

test("a single-tier registration has the layout the live creator registered with", () => {
  // The demo creator on mainnet was registered with exactly this shape:
  // [token, payout_key, span_len, tier_0]. The span length is the Span<u128>
  // serialization prefix, and every felt is unpadded.
  const call = registerCreatorCall(VAULT, STRK, payoutPub, [1n * E18]);
  assert.equal(call.entrypoint, "register_creator");
  assert.deepEqual(call.calldata, [STRK, payoutPub, "0x1", "0xde0b6b3a7640000"]);
});

test("a multi-tier registration serializes the span as length then amounts, in order", () => {
  const call = registerCreatorCall(VAULT, STRK, payoutPub, [1n * E18, 5n * E18, 20n * E18]);
  assert.equal(call.calldata[2], "0x3", "the span length prefix");
  assert.deepEqual(call.calldata.slice(3), [
    "0xde0b6b3a7640000",
    "0x4563918244f40000",
    "0x1158e460913d00000",
  ]);
  // No leading zeros in the span: calldata felts forbid them. The token slot
  // is exempt - it is a padded ADDRESS field, passed through as given, and the
  // single-tier test above pins that whole layout to the live registration.
  for (const felt of call.calldata.slice(2)) assert.doesNotMatch(felt, /^0x0[0-9a-f]/);
});

// --- claim: resolve, sign, batch ------------------------------------------

const claimWei = 1n * E18;

/** The calldata shape a prepared pool claim carries: the resolved note id in
 *  the position the resolver scans for, wrapped in filler so the scan has to
 *  find it. */
const preparedClaimCalldata = [
  "0x1",
  "0x2",
  creatorId,
  NOTE_ID,
  `0x${claimWei.toString(16)}`,
  "0x1",
  "0x1",
  "0x9",
];

test("the note id resolver finds the marker pattern", () => {
  assert.equal(resolveNoteId(preparedClaimCalldata, creatorId, claimWei), NOTE_ID);
});

test("a batch without the marker pattern resolves to null rather than a guess", () => {
  assert.equal(resolveNoteId(["0x1", "0x2", "0x3"], creatorId, claimWei), null);
});

const claimSig = signWith(claimMessage(creatorId, NOTE_ID, claimWei), PAYOUT);
const myClaim = claimActions({
  vault: VAULT,
  token: STRK,
  accountAddress: ACCOUNT,
  creatorId,
  amountWei: claimWei,
  noteId: OPEN_NOTE_PLACEHOLDER,
  sig: claimSig,
});

test("the claim batch matches the golden batch, including the payout signature", () => {
  assert.deepEqual(myClaim, GOLDEN.claim);
});

test("the claim batch carries the placeholder, never the literal note id", () => {
  const invoke = myClaim[2];
  assert.equal(invoke.calldata[2], OPEN_NOTE_PLACEHOLDER);
  assert.ok(!JSON.stringify(myClaim).includes(NOTE_ID));
});

// --- the property that matters more than any single hash -------------------

test("no key material appears in anything this port produces", () => {
  const everything = JSON.stringify([mySubscribe, myClaim, GOLDEN]).toLowerCase();
  for (const [label, key] of [
    ["subscriber secret", SECRET],
    ["payout key", PAYOUT],
    ["derived owner key", ownerPriv],
  ]) {
    const bare = BigInt(key).toString(16);
    assert.ok(!everything.includes(bare), `${label} leaked into rendered output`);
  }
});
