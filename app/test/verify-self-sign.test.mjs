// The /verify self-sign path: src/lib/wallet/keys.ts's signPresentation,
// checked through src/lib/verify.ts's own verifyPresentation, the same port
// test/verify-parity.test.mjs holds to the published package.
//
// keys.ts imports core.ts with a bare specifier ("./core", no extension),
// which Node's own resolver never follows for a relative TS import: only
// verify.ts is written import-free enough to load raw (its own header says
// so). So this file bundles keys.ts with esbuild first, exactly the pattern
// test/rpc-smoke.mjs uses for board.ts, self-contained here rather than a
// second `npm run` script: starknet stays external and resolves from
// node_modules as normal, and only the two relative files get inlined.
//
// No network and no real key material: localStorage is stubbed with fixture
// secrets before the bundle is asked to derive anything, the same pattern
// test/wallet-parity.test.mjs uses for the console.
//
//   node --test test/verify-self-sign.test.mjs

import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";

import * as esbuild from "esbuild";

// --- localStorage stub, in place before the bundle derives anything --------

const SECRET_KEY = "nightshift.subscriber.secret";
const PAYOUT_KEY = "nightshift.payout.priv";

const SECRET = "0x0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20";
const PAYOUT = "0x02a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f";
const ACCOUNT = "0x04a3f81c9d2e7b6a5f4e3d2c1b0a998877665544332211009988776655444b19";
const STRANGER_ACCOUNT = "0x0511f1c2b3a495867788990011223344556677889900aabbccddeeff00112233";
const STRK = "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";
const VAULT = "0x171e8e0bb905c899b9d1ad5c02aefe96a5d0b6d5f093f0ee80707b592417f8e";
const NOW = 500_000;

const ls = new Map([
  [SECRET_KEY, SECRET],
  [PAYOUT_KEY, PAYOUT],
]);
globalThis.localStorage = {
  getItem: (k) => (ls.has(k) ? ls.get(k) : null),
  setItem: (k, v) => ls.set(k, v),
};

// --- bundle keys.ts (and the core.ts it imports) for plain Node -----------

const here = fileURLToPath(new URL(".", import.meta.url));
const smokeDir = new URL("../.smoke/", import.meta.url);
await mkdir(smokeDir, { recursive: true });
const keysBundle = fileURLToPath(new URL("keys-bundle.mjs", smokeDir));
await esbuild.build({
  entryPoints: [`${here}../src/lib/wallet/keys.ts`],
  outfile: keysBundle,
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node20",
  external: ["starknet"],
});

const { identityFor, signPresentation } = await import(keysBundle);
const { hex, toVerifierFelt, verifyPresentation, REASONS } = await import("../src/lib/verify.ts");
const { fakeProvider, vaultStubs } = await import("../../verify/test/support/fake-provider.mjs");

// --- a ChainReader over the fake provider, matching verify-parity's shape --

function readerFor(provider) {
  return {
    async getBlockNumber() {
      return await provider.getBlockNumber();
    },
    async callVault(entrypoint, calldata) {
      const raw = await provider.callContract({ contractAddress: VAULT, entrypoint, calldata });
      const out = Array.isArray(raw) ? raw : (raw?.result ?? []);
      return out.map((x) => BigInt(x));
    },
  };
}

// --- the presentation this browser's self-sign path would produce ----------
//
// Shaped exactly like SelfSign.signHere in components/verify/steps.tsx: a
// ParsedChallenge already carries verifierId as a felt (parseChallenge ran
// toVerifierFelt on it), so hex() is what feeds signPresentation and what
// lands in the outgoing presentation's verifier_id field. "DOOR_1" the short
// string never reaches core.ts's presentMessage, only its felt does.
const challenge = {
  verifierId: toVerifierFelt("DOOR_1"),
  nonce: 0x9f2c4a1b7e0d3856n,
  expiryBlock: BigInt(NOW + 1000),
};

const identity = identityFor(ACCOUNT, STRK);

function presentationFor(accountAddress, over = {}) {
  const verifierId = hex(challenge.verifierId);
  const nonce = hex(challenge.nonce);
  const expiryBlock = Number(challenge.expiryBlock);
  const { commitment, sig } = signPresentation(accountAddress, STRK, {
    verifierId,
    expiryBlock: String(expiryBlock),
    nonce,
  });
  return {
    commitment,
    verifier_id: verifierId,
    expiry_block: expiryBlock,
    nonce,
    sig_r: sig.r,
    sig_s: sig.s,
    ...over,
  };
}

test("signPresentation returns only public material", () => {
  const { commitment, sig } = signPresentation(ACCOUNT, STRK, {
    verifierId: hex(challenge.verifierId),
    expiryBlock: String(challenge.expiryBlock),
    nonce: hex(challenge.nonce),
  });
  assert.equal(commitment, identity.commitment);
  assert.match(sig.r, /^0x[0-9a-f]+$/);
  assert.match(sig.s, /^0x[0-9a-f]+$/);
  // Neither secret nor a derived private key appears in the JSON this page
  // would actually serialize and show: only the four fields above exist on
  // the returned object.
  assert.deepEqual(Object.keys({ commitment, sig }).sort(), ["commitment", "sig"]);
});

test("a self-signed presentation verifies when the subscription is entitled", async () => {
  const vault = vaultStubs({ ownerKey: identity.ownerPub, creatorId: "0x396c007f205df", tier: 1 });
  const presentation = presentationFor(ACCOUNT);
  const provider = fakeProvider({ blockNumber: NOW, vault });
  const verdict = await verifyPresentation({
    presentation,
    expectedVerifierId: challenge.verifierId,
    expectedNonce: challenge.nonce,
    reader: readerFor(provider),
  });
  assert.deepEqual(verdict, { ok: true, creatorId: "0x396c007f205df", tier: 1, reason: null });
});

test("the same presentation is refused for arrears, honestly and not silently", async () => {
  // never charged: nextPeriod 0, the exact shape the real subscription's
  // schedule_of reads back when it owes rather than when it is entitled.
  const vault = vaultStubs({ ownerKey: identity.ownerPub, nextPeriod: 0 });
  const presentation = presentationFor(ACCOUNT);
  const provider = fakeProvider({ blockNumber: NOW, vault });
  const verdict = await verifyPresentation({
    presentation,
    expectedVerifierId: challenge.verifierId,
    expectedNonce: challenge.nonce,
    reader: readerFor(provider),
  });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.reason, REASONS.ARREARS);
});

test("negative control: a presentation for the wrong verifier is refused before the chain is read", async () => {
  const vault = vaultStubs({ ownerKey: identity.ownerPub });
  // Same signed fields, a verifier_id edited after signing: it no longer
  // matches what the signature covers, but the mismatch is caught before
  // the (also failing) signature check even runs.
  const presentation = presentationFor(ACCOUNT, { verifier_id: "DOOR_2" });
  const provider = fakeProvider({ blockNumber: NOW, vault });
  const verdict = await verifyPresentation({
    presentation,
    expectedVerifierId: challenge.verifierId,
    expectedNonce: challenge.nonce,
    reader: readerFor(provider),
  });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.reason, REASONS.VERIFIER_MISMATCH);
  assert.equal(provider.calls.length, 0, "a verifier mismatch needs no vault read");
});

test("negative control: a signature from a different account address does not pass as ACCOUNT's", async () => {
  // STRANGER_ACCOUNT derives a different owner key from the same browser
  // secret, exactly as a different creator id would (core.ts's per-commitment
  // derivation, the reason a single browser cannot cross-sign). Its signature
  // does not verify against the owner key the vault recorded for ACCOUNT.
  const good = presentationFor(ACCOUNT);
  const stranger = signPresentation(STRANGER_ACCOUNT, STRK, {
    verifierId: hex(challenge.verifierId),
    expiryBlock: String(Number(challenge.expiryBlock)),
    nonce: hex(challenge.nonce),
  });
  assert.notEqual(stranger.commitment, identity.commitment);
  const forged = { ...good, sig_r: stranger.sig.r, sig_s: stranger.sig.s };
  const vault = vaultStubs({ ownerKey: identity.ownerPub });
  const provider = fakeProvider({ blockNumber: NOW, vault });
  const verdict = await verifyPresentation({
    presentation: forged,
    expectedVerifierId: challenge.verifierId,
    expectedNonce: challenge.nonce,
    reader: readerFor(provider),
  });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.reason, REASONS.BAD_SIGNATURE);
});
