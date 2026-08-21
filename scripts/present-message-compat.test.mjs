#!/usr/bin/env node --test
// Byte-compatibility proof between the ops console (web/app.mjs) and
// nightshift-verify (verify/src/index.mjs): a presentation the console signs
// has to be the exact thing a verifier checking with nightshift-verify
// accepts, since nothing else confirms the two implementations of the same
// poseidon message layout have not drifted apart.
//
// web/app.mjs is a browser entry module, so the DOM and localStorage it
// touches at import time are stubbed before it is imported here.
//
//   node --test scripts/present-message-compat.test.mjs

import test from "node:test";
import assert from "node:assert/strict";

const { ec } = await import("starknet");
import {
  presentMessage,
  checkPresentSignature,
  readPresentation,
  verifyPresentation,
  signPresentation,
} from "../verify/src/index.mjs";
import { fakeProvider, vaultStubs } from "../verify/test/support/fake-provider.mjs";

// --- minimal browser stubs -------------------------------------------------

const elements = new Map();
const makeEl = () => ({
  onclick: null, value: "", textContent: "", className: "", disabled: true, checked: false,
  appendChild() {}, scrollIntoView() {}, select() {},
});
globalThis.document = {
  // get-starknet-core pulls in @module-federation, which reads
  // document.defaultView and expects a real global object back.
  defaultView: globalThis,
  getElementById(id) {
    if (!elements.has(id)) elements.set(id, makeEl());
    return elements.get(id);
  },
  createElement() { return makeEl(); },
};
const ls = new Map();
globalThis.localStorage = {
  getItem: (k) => (ls.has(k) ? ls.get(k) : null),
  setItem: (k, v) => ls.set(k, v),
};

const { parseChallenge, buildPresentation, presentMessageFor } = await import("../web/app.mjs");

// --- fixtures ----------------------------------------------------------

const ownerPriv = "0x" + [...ec.starkCurve.utils.randomPrivateKey()]
  .map((b) => b.toString(16).padStart(2, "0")).join("");
const ownerKey = BigInt(ec.starkCurve.getStarkKey(ownerPriv));
const COMMITMENT = "0x6d1f3a9c2b8e4700112233445566778899aabbccddeeff00112233445566778";
const VAULT_ADDRESS = "0x171e8e0bb905c899b9d1ad5c02aefe96a5d0b6d5f093f0ee80707b592417f8e";

// --- message layout ------------------------------------------------------

test("the console's message layout equals nightshift-verify's presentMessage", () => {
  const fields = { commitment: COMMITMENT, verifierId: "0x2a", expiryBlock: 501000, nonce: "0x0deadbeef" };
  const mine = presentMessageFor(fields.commitment, fields.verifierId, fields.expiryBlock, fields.nonce);
  assert.equal(mine, presentMessage(fields));
});

// A matching mutation in both web/app.mjs's presentMessageFor and
// verify/src/index.mjs's presentMessage would still pass the test above,
// since it only checks the two implementations agree with each other, not
// that either one still matches the deployed Cairo. This test pins both to
// a hardcoded hash instead, computed once for the fixed input vector below
// and never recomputed from the code under test:
//
//   commitment    = 0x6d1f3a9c2b8e4700112233445566778899aabbccddeeff00112233445566778
//   verifier_id   = 0x2a
//   expiry_block  = 501000
//   nonce         = 0x0deadbeef
//
// GOLDEN_PRESENT_MESSAGE_HASH = presentMessage(fields) for that vector, as
// computed by verify/src/index.mjs. It is anchored to the chain, not just
// to this repo's two JS implementations: the console's on-chain `present`
// flow, with this exact five-element poseidon layout (tag, commitment,
// verifier_id, expiry_block, nonce), was accepted by the deployed gate on
// mainnet in tx 0x30191636301463f89c9686a7426fa2489429024a562bd4c0da7693837d502de,
// and src/common.cairo's present_nonce_message (lines 106-112) is the
// on-chain formula both JS implementations are meant to mirror. If this
// constant ever needs to change, it means the on-chain message layout
// changed, which is exactly the case where both JS sides silently agreeing
// with each other is not enough.
const GOLDEN_PRESENT_MESSAGE_HASH =
  "0x5232c58e65d5cca36d19bd60651c7de23deda70e56ace38522183ab67323f1e";

test("both implementations still produce the golden present-message hash", () => {
  const fields = { commitment: COMMITMENT, verifierId: "0x2a", expiryBlock: 501000, nonce: "0x0deadbeef" };
  assert.equal(presentMessage(fields), GOLDEN_PRESENT_MESSAGE_HASH);
  assert.equal(
    presentMessageFor(fields.commitment, fields.verifierId, fields.expiryBlock, fields.nonce),
    GOLDEN_PRESENT_MESSAGE_HASH,
  );
});

// --- byte-identical presentation objects ----------------------------------

test("the console's presentation is byte-identical to signPresentation's", () => {
  const challenge = parseChallenge('{"verifier_id":"0x2a","nonce":"0x5f2c","expiry_block":501000}');
  const mine = buildPresentation({ commitment: COMMITMENT, ...challenge, ownerPrivKey: ownerPriv });
  const theirs = signPresentation({
    commitment: COMMITMENT,
    verifierId: challenge.verifierId,
    expiryBlock: challenge.expiryBlock,
    nonce: challenge.nonce,
    ownerPrivKey: ownerPriv,
  });
  assert.deepEqual(mine, theirs);
});

test("buildPresentation output parses as a presentation and the signature verifies", () => {
  const challenge = parseChallenge(
    '```json\n{"verifier_id":"DOOR_1","nonce":"0x5f2c","expiry_block":501000}\n```',
  );
  const presentation = buildPresentation({
    commitment: COMMITMENT, ...challenge, ownerPrivKey: ownerPriv,
  });

  // single-line JSON, and no key material anywhere in it
  const line = JSON.stringify(presentation);
  assert.ok(!line.includes("\n"));
  assert.deepEqual(Object.keys(presentation),
    ["commitment", "verifier_id", "expiry_block", "nonce", "sig_r", "sig_s"]);
  const priv = BigInt(ownerPriv).toString(16);
  assert.ok(!line.toLowerCase().includes(priv), "private key leaked into the presentation");

  const { fields, reason } = readPresentation(presentation);
  assert.equal(reason, undefined);
  const msg = presentMessage(fields);
  assert.equal(checkPresentSignature(msg, ownerKey, fields.sigR, fields.sigS), true);
});

// --- end-to-end verifyPresentation acceptance -----------------------------

test("verifyPresentation accepts a console-built presentation end to end", async () => {
  const challenge = parseChallenge('{"verifier_id":"DOOR_1","nonce":"0x5f2c","expiry_block":501000}');
  const presentation = buildPresentation({
    commitment: COMMITMENT, ...challenge, ownerPrivKey: ownerPriv,
  });
  const verdict = await verifyPresentation({
    presentation,
    expectedVerifierId: "DOOR_1",
    expectedNonce: "0x5f2c",
    provider: fakeProvider({ blockNumber: 500_000, vault: vaultStubs({ ownerKey, tier: 2 }) }),
    vaultAddress: VAULT_ADDRESS,
  });
  assert.deepEqual(verdict, { ok: true, creatorId: "0xc0ffee", tier: 2, reason: null });
});

// --- negative controls: the binding has to be real, not just present -----

test("a tampered expiry is rejected as bad_signature, so the binding is real", async () => {
  const challenge = parseChallenge('{"verifier_id":"0x2a","nonce":"0x5f2c","expiry_block":501000}');
  const presentation = buildPresentation({
    commitment: COMMITMENT, ...challenge, ownerPrivKey: ownerPriv,
  });
  const verdict = await verifyPresentation({
    presentation: { ...presentation, expiry_block: 501001 },
    expectedVerifierId: "0x2a",
    expectedNonce: "0x5f2c",
    provider: fakeProvider({ blockNumber: 500_000, vault: vaultStubs({ ownerKey }) }),
    vaultAddress: VAULT_ADDRESS,
  });
  assert.equal(verdict.reason, "bad_signature");
});

test("a presentation signed with a different key fails", async () => {
  const challenge = parseChallenge('{"verifier_id":"0x2a","nonce":"0x5f2c","expiry_block":501000}');
  const presentation = buildPresentation({
    commitment: COMMITMENT, ...challenge, ownerPrivKey: ownerPriv,
  });
  const otherKey = BigInt(ec.starkCurve.getStarkKey("0x1234567890abcdef"));
  const verdict = await verifyPresentation({
    presentation,
    expectedVerifierId: "0x2a",
    expectedNonce: "0x5f2c",
    provider: fakeProvider({ blockNumber: 500_000, vault: vaultStubs({ ownerKey: otherKey }) }),
    vaultAddress: VAULT_ADDRESS,
  });
  assert.equal(verdict.reason, "bad_signature");
});
