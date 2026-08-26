#!/usr/bin/env node --test
// Chain-anchor tests for nightshift-verify's present-message layout
// (verify/src/index.mjs).
//
// The layout has two other implementations that must never drift from it: the
// deployed Cairo gate, and the app's port (app/src/lib/wallet/core.ts, pinned
// by app/test/wallet-parity.test.mjs to the same golden hash used below).
// Pinning to a hardcoded hash - computed once and never recomputed from the
// code under test - is what catches a drift that self-consistent
// implementations would silently agree on.
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

// --- fixtures ----------------------------------------------------------

const ownerPriv = "0x" + [...ec.starkCurve.utils.randomPrivateKey()]
  .map((b) => b.toString(16).padStart(2, "0")).join("");
const ownerKey = BigInt(ec.starkCurve.getStarkKey(ownerPriv));
const COMMITMENT = "0x6d1f3a9c2b8e4700112233445566778899aabbccddeeff00112233445566778";
const VAULT_ADDRESS = "0x171e8e0bb905c899b9d1ad5c02aefe96a5d0b6d5f093f0ee80707b592417f8e";

// --- the golden hash ------------------------------------------------------
//
// GOLDEN_PRESENT_MESSAGE_HASH = presentMessage(fields) for the fixed vector
// below, as computed by verify/src/index.mjs on the day the layout was proven
// on chain. It is anchored to the chain, not just to this repo: a
// presentation built with this exact five-element poseidon layout (tag,
// commitment, verifier_id, expiry_block, nonce) was accepted by the deployed
// gate on mainnet in tx
// 0x30191636301463f89c9686a7426fa2489429024a562bd4c0da7693837d502de, and
// src/common.cairo's present_nonce_message (lines 106-112) is the on-chain
// formula this implementation mirrors. If this constant ever needs to change,
// the on-chain message layout changed - exactly the case that must never pass
// silently.
//
//   commitment    = 0x6d1f3a9c2b8e4700112233445566778899aabbccddeeff00112233445566778
//   verifier_id   = 0x2a
//   expiry_block  = 501000
//   nonce         = 0x0deadbeef
const GOLDEN_PRESENT_MESSAGE_HASH =
  "0x5232c58e65d5cca36d19bd60651c7de23deda70e56ace38522183ab67323f1e";

test("presentMessage still produces the golden hash the deployed gate accepted", () => {
  const fields = { commitment: COMMITMENT, verifierId: "0x2a", expiryBlock: 501000, nonce: "0x0deadbeef" };
  assert.equal(presentMessage(fields), GOLDEN_PRESENT_MESSAGE_HASH);
});

// --- presentation shape and signature -------------------------------------

test("signPresentation's output parses as a presentation and the signature verifies", () => {
  const presentation = signPresentation({
    commitment: COMMITMENT,
    verifierId: "DOOR_1",
    expiryBlock: 501000,
    nonce: "0x5f2c",
    ownerPrivKey: ownerPriv,
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

test("verifyPresentation accepts a signPresentation presentation end to end", async () => {
  const presentation = signPresentation({
    commitment: COMMITMENT,
    verifierId: "DOOR_1",
    expiryBlock: 501000,
    nonce: "0x5f2c",
    ownerPrivKey: ownerPriv,
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
  const presentation = signPresentation({
    commitment: COMMITMENT,
    verifierId: "0x2a",
    expiryBlock: 501000,
    nonce: "0x5f2c",
    ownerPrivKey: ownerPriv,
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
  const presentation = signPresentation({
    commitment: COMMITMENT,
    verifierId: "0x2a",
    expiryBlock: 501000,
    nonce: "0x5f2c",
    ownerPrivKey: ownerPriv,
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
