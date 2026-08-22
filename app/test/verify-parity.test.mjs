// Parity between the app's in-page port (src/lib/verify.ts) and the published
// nightshift-verify package (../../verify/src/index.mjs).
//
// The port exists because the app reads the chain through its own RpcClient
// and must not carry a second provider stack into the bundle. The price of
// that is drift, and this file is what makes drift fail loudly: both
// implementations get the same presentation, the same challenge and the same
// vault state, and must return the same verdict AND the same reason string.
//
// No network. The package takes a fakeProvider (its own test pattern, reused
// here from verify/test/support); the port takes a ChainReader backed by the
// same felt table, so the two see identical bytes.
//
// Node strips the types off verify.ts on import, which is why that module
// imports nothing but `starknet`: it has to be loadable with no bundler.
//
// Two installs are in play. The port resolves starknet from app/node_modules;
// verify/src/index.mjs resolves it from the repo root's node_modules, so this
// file needs `npm ci --ignore-scripts` to have run at the repo root as well as
// in app/. Both pin starknet 10.7.0.

import assert from "node:assert/strict";
import test from "node:test";

import { ec } from "starknet";

import {
  REASONS as PKG_REASONS,
  signPresentation,
  verifyPresentation as pkgVerify,
} from "../../verify/src/index.mjs";
import { fakeProvider, vaultStubs } from "../../verify/test/support/fake-provider.mjs";
import { REASONS as PORT_REASONS, verifyPresentation as portVerify } from "../src/lib/verify.ts";

const VAULT = "0x171e8e0bb905c899b9d1ad5c02aefe96a5d0b6d5f093f0ee80707b592417f8e";
const NOW = 500_000;
const COMMITMENT = "0x743b3e7faac6b91926eaa3e6305b79420ab572684ac563e7dc2c4c7edda4f45";

/** A throwaway keypair per run: the parity claim is about the algorithm, not
 *  about one hard-coded signature. */
function randomKeypair() {
  const priv = `0x${[...ec.starkCurve.utils.randomPrivateKey()]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")}`;
  return { priv, pub: ec.starkCurve.getStarkKey(priv) };
}

/** The port's ChainReader, backed by the package's own fakeProvider so both
 *  implementations read one table. */
function readerFor(provider) {
  return {
    async getBlockNumber() {
      return await provider.getBlockNumber();
    },
    async callVault(entrypoint, calldata) {
      const raw = await provider.callContract({
        contractAddress: VAULT,
        entrypoint,
        calldata,
      });
      const out = Array.isArray(raw) ? raw : (raw?.result ?? []);
      return out.map((x) => BigInt(x));
    },
  };
}

/** Run one case through both implementations and return both verdicts. */
async function both({ presentation, expectedVerifierId, expectedNonce, vault, blockNumber }) {
  const pkgProvider = fakeProvider({ blockNumber, vault });
  const portProvider = fakeProvider({ blockNumber, vault });
  const fromPackage = await pkgVerify({
    presentation,
    expectedVerifierId,
    expectedNonce,
    provider: pkgProvider,
    vaultAddress: VAULT,
  });
  const fromPort = await portVerify({
    presentation,
    expectedVerifierId,
    expectedNonce,
    reader: readerFor(portProvider),
  });
  return { fromPackage, fromPort, pkgCalls: pkgProvider.calls, portCalls: portProvider.calls };
}

/** Assert the two agree, and that they agree on the reason the case is about. */
async function agree(name, args, expectedReason) {
  const { fromPackage, fromPort, pkgCalls, portCalls } = await both(args);
  assert.deepEqual(fromPort, fromPackage, `${name}: port and package disagree`);
  assert.equal(fromPort.reason, expectedReason, `${name}: wrong reason`);
  assert.equal(fromPort.ok, expectedReason === null, `${name}: wrong ok`);
  // Same check order means the same node traffic, including the checks that
  // refuse before touching the chain at all.
  assert.deepEqual(
    portCalls.map((c) => c.entrypoint),
    pkgCalls.map((c) => c.entrypoint),
    `${name}: different vault reads`,
  );
  return fromPort;
}

test("REASONS carries the same strings in both implementations", () => {
  assert.deepEqual({ ...PORT_REASONS }, { ...PKG_REASONS });
});

test("parity: valid, tampered expiry, wrong key, wrong verifier, stale nonce", async () => {
  const owner = randomKeypair();
  const stranger = randomKeypair();
  const challenge = {
    verifierId: "DOOR_1",
    nonce: "0x9f2c4a1b7e0d3856",
    expiryBlock: NOW + 1000,
  };
  const vault = vaultStubs({ ownerKey: owner.pub, creatorId: "0x396c007f205df", tier: 1 });

  const sign = (priv, over = {}) =>
    signPresentation({
      commitment: COMMITMENT,
      verifierId: challenge.verifierId,
      expiryBlock: challenge.expiryBlock,
      nonce: challenge.nonce,
      ownerPrivKey: priv,
      ...over,
    });

  const good = sign(owner.priv);
  const base = {
    expectedVerifierId: challenge.verifierId,
    expectedNonce: challenge.nonce,
    vault,
    blockNumber: NOW,
  };

  // 1. valid
  const ok = await agree("valid", { ...base, presentation: good }, null);
  assert.deepEqual([ok.creatorId, ok.tier], ["0x396c007f205df", 1]);

  // 2. tampered expiry: the field is edited after signing, so the signature no
  //    longer covers it. Still inside the window, so the check that catches it
  //    is the signature, not the clock.
  await agree(
    "tampered expiry",
    { ...base, presentation: { ...good, expiry_block: good.expiry_block - 7 } },
    PKG_REASONS.BAD_SIGNATURE,
  );

  // 2b. an expiry that is honestly signed but already past
  await agree(
    "stale expiry",
    { ...base, presentation: sign(owner.priv, { expiryBlock: NOW - 1 }), blockNumber: NOW },
    PKG_REASONS.EXPIRED,
  );

  // 3. wrong key: a well-formed presentation signed by someone else
  await agree("wrong key", { ...base, presentation: sign(stranger.priv) }, PKG_REASONS.BAD_SIGNATURE);

  // 4. wrong verifier: an answer meant for another door
  await agree(
    "wrong verifier",
    { ...base, presentation: sign(owner.priv, { verifierId: "DOOR_2" }) },
    PKG_REASONS.VERIFIER_MISMATCH,
  );

  // 5. stale nonce: a captured presentation replayed at the next challenge
  await agree(
    "stale nonce",
    { ...base, presentation: good, expectedNonce: "0x1111222233334444" },
    PKG_REASONS.NONCE_MISMATCH,
  );
});

test("parity: the chain-state refusals and the malformed paste", async () => {
  const owner = randomKeypair();
  const challenge = { verifierId: "0x444f4f525f31", nonce: "0xabc123", expiryBlock: NOW + 500 };
  const presentation = signPresentation({
    commitment: COMMITMENT,
    verifierId: challenge.verifierId,
    expiryBlock: challenge.expiryBlock,
    nonce: challenge.nonce,
    ownerPrivKey: owner.priv,
  });
  const base = {
    presentation,
    expectedVerifierId: challenge.verifierId,
    expectedNonce: challenge.nonce,
    blockNumber: NOW,
  };
  const live = { ownerKey: owner.pub };

  await agree("cancelled", { ...base, vault: vaultStubs({ ...live, cancelled: true }) }, PKG_REASONS.NOT_ACTIVE);
  await agree(
    "unknown commitment",
    { ...base, vault: vaultStubs({ ...live, creatorId: "0x0" }) },
    PKG_REASONS.NOT_ACTIVE,
  );
  await agree("never charged", { ...base, vault: vaultStubs({ ...live, nextPeriod: 0 }) }, PKG_REASONS.ARREARS);
  await agree(
    "paid window lapsed",
    {
      ...base,
      vault: vaultStubs({ ...live, nextPeriod: 1 }),
      blockNumber: 501_100,
      presentation: signPresentation({
        commitment: COMMITMENT,
        verifierId: challenge.verifierId,
        expiryBlock: 501_150,
        nonce: challenge.nonce,
        ownerPrivKey: owner.priv,
      }),
    },
    PKG_REASONS.ARREARS,
  );
  await agree(
    "zero owner key",
    { ...base, vault: vaultStubs({ ownerKey: "0x0" }) },
    PKG_REASONS.UNKNOWN_COMMITMENT,
  );
  await agree(
    "expiry too far",
    {
      ...base,
      vault: vaultStubs(live),
      presentation: signPresentation({
        commitment: COMMITMENT,
        verifierId: challenge.verifierId,
        expiryBlock: NOW + 2101,
        nonce: challenge.nonce,
        ownerPrivKey: owner.priv,
      }),
    },
    PKG_REASONS.EXPIRY_TOO_FAR,
  );

  for (const bad of [undefined, null, "not an object", {}, { ...presentation, sig_r: "banana" }]) {
    await agree(
      `malformed ${JSON.stringify(bad) ?? "undefined"}`,
      { ...base, vault: vaultStubs(live), presentation: bad },
      PKG_REASONS.MALFORMED_PRESENTATION,
    );
  }
});

test("parity: an unreachable node is a reason in both, not an exception", async () => {
  const owner = randomKeypair();
  const challenge = { verifierId: "DOOR_1", nonce: "0x77", expiryBlock: NOW + 10 };
  const presentation = signPresentation({
    commitment: COMMITMENT,
    verifierId: challenge.verifierId,
    expiryBlock: challenge.expiryBlock,
    nonce: challenge.nonce,
    ownerPrivKey: owner.priv,
  });
  const boom = new Error("ECONNREFUSED");
  const base = {
    presentation,
    expectedVerifierId: challenge.verifierId,
    expectedNonce: challenge.nonce,
    blockNumber: NOW,
  };
  await agree(
    "head read down",
    { ...base, vault: vaultStubs({ ownerKey: owner.pub }), blockNumber: boom },
    PKG_REASONS.RPC_ERROR,
  );
  await agree(
    "owner_key_of down",
    { ...base, vault: { ...vaultStubs({ ownerKey: owner.pub }), owner_key_of: boom } },
    PKG_REASONS.RPC_ERROR,
  );
  await agree(
    "short schedule tuple",
    { ...base, vault: { ...vaultStubs({ ownerKey: owner.pub }), schedule_of: [] } },
    PKG_REASONS.RPC_ERROR,
  );
});
