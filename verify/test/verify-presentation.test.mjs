// verifyPresentation against a stubbed vault. No network: the provider is
// injected, and every vault view answers from a table (test/support).

import assert from "node:assert/strict";
import test from "node:test";
import { ec } from "starknet";
import { REASONS, signPresentation, verifyPresentation } from "../src/index.mjs";
import { fakeProvider, vaultStubs } from "./support/fake-provider.mjs";

const VAULT = "0x277519c8bc1031188313de4528d1f0159319f8f86651422e89b6fbd920b3759";
const PRIV = "0x0511ce1e6ea0a0c3d1a3fdd1a3f0f3a2b8c7d6e5f4a3b2c1d0e9f8a7b6c5d4e3";
const PUB = "0x565b7c584080ffa526d83d93b276be1a8cf9737666251d6cbe57da52a828472";
const OTHER_PRIV = "0x0299b1a2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e";

const NOW = 500_000;
const CHALLENGE = {
  verifierId: "DOOR_1",
  nonce: "0xdeadbeefcafe",
  expiryBlock: NOW + 1000,
};
const COMMITMENT = "0x5ca1ab1e";

const presentationSignedWith = (priv, over = {}) =>
  signPresentation({
    commitment: COMMITMENT,
    verifierId: CHALLENGE.verifierId,
    expiryBlock: CHALLENGE.expiryBlock,
    nonce: CHALLENGE.nonce,
    ownerPrivKey: priv,
    ...over,
  });

/**
 * One check with the good presentation and a healthy vault, unless the case
 * overrides a piece of it.
 */
function check(args = {}) {
  const { vault, blockNumber = NOW, ...rest } = args;
  delete rest.presentation;
  const provider = fakeProvider({ blockNumber, vault: vault ?? vaultStubs({ ownerKey: PUB }) });
  const promise = verifyPresentation({
    // hasOwn, not a default: the malformed cases pass an explicit undefined and
    // must not be quietly handed a good presentation instead.
    presentation: Object.hasOwn(args, "presentation")
      ? args.presentation
      : presentationSignedWith(PRIV),
    expectedVerifierId: CHALLENGE.verifierId,
    expectedNonce: CHALLENGE.nonce,
    provider,
    vaultAddress: VAULT,
    ...rest,
  });
  return { promise, provider };
}

const verdict = async (args) => await check(args).promise;

test("happy path returns the creator and tier from schedule_of", async () => {
  const { promise, provider } = check();
  assert.deepEqual(await promise, {
    ok: true,
    creatorId: "0xc0ffee",
    tier: 2,
    reason: null,
  });
  assert.deepEqual(
    provider.calls.map((c) => c.entrypoint),
    ["schedule_of", "owner_key_of"],
  );
  assert.deepEqual(provider.calls[0].calldata, [COMMITMENT]);
  for (const c of provider.calls) assert.equal(c.contractAddress, VAULT);
});

test("a presentation meant for another verifier is refused, without asking the node", async () => {
  const { promise, provider } = check({
    presentation: presentationSignedWith(PRIV, { verifierId: "DOOR_2" }),
  });
  assert.deepEqual(await promise, {
    ok: false,
    creatorId: null,
    tier: null,
    reason: REASONS.VERIFIER_MISMATCH,
  });
  // The verifier id needs no chain state, so a captured presentation from
  // another door costs this verifier nothing.
  assert.equal(provider.calls.length, 0);
});

test("a stale expiry is refused", async () => {
  const r = await verdict({ blockNumber: CHALLENGE.expiryBlock + 1 });
  assert.equal(r.reason, REASONS.EXPIRED);
  assert.equal(r.ok, false);
});

test("an expiry at the current block still counts", async () => {
  const r = await verdict({ blockNumber: CHALLENGE.expiryBlock });
  assert.equal(r.ok, true);
});

test("an expiry signed too far ahead is refused", async () => {
  const far = presentationSignedWith(PRIV, { expiryBlock: NOW + 2101 });
  const r = await verdict({ presentation: far });
  assert.equal(r.reason, REASONS.EXPIRY_TOO_FAR);
});

test("maxWindow is the caller's to tighten", async () => {
  const r = await verdict({ maxWindow: 100 });
  assert.equal(r.reason, REASONS.EXPIRY_TOO_FAR);
});

test("a nonce this verifier did not issue is refused", async () => {
  const other = presentationSignedWith(PRIV, { nonce: "0xfeedface" });
  const { promise, provider } = check({ presentation: other });
  assert.equal((await promise).reason, REASONS.NONCE_MISMATCH);
  // Replay dies here: the signature is perfectly good, it just answers a
  // challenge this verifier is no longer waiting on.
  assert.equal(provider.calls.length, 0);
});

test("a cancelled subscription is refused", async () => {
  const { promise, provider } = check({ vault: vaultStubs({ ownerKey: PUB, cancelled: true }) });
  assert.equal((await promise).reason, REASONS.NOT_ACTIVE);
  assert.deepEqual(provider.calls.map((c) => c.entrypoint), ["schedule_of"]);
});

test("an unknown commitment reads creator zero and is refused", async () => {
  const { promise, provider } = check({ vault: vaultStubs({ ownerKey: PUB, creatorId: "0x0" }) });
  assert.equal((await promise).reason, REASONS.NOT_ACTIVE);
  assert.deepEqual(provider.calls.map((c) => c.entrypoint), ["schedule_of"]);
});

test("a subscription whose period 0 was never charged is in arrears", async () => {
  const { promise, provider } = check({ vault: vaultStubs({ ownerKey: PUB, nextPeriod: 0 }) });
  assert.equal((await promise).reason, REASONS.ARREARS);
  assert.deepEqual(provider.calls.map((c) => c.entrypoint), ["schedule_of"]);
});

test("a lapsed paid window is in arrears even with periods left", async () => {
  // start 499_000, pb 2100, next 1: paid through 501_100. Block 501_100 is the
  // first block of the unpaid period, so it must already refuse.
  const r = await verdict({
    vault: vaultStubs({ ownerKey: PUB, nextPeriod: 1 }),
    blockNumber: 501_100,
    presentation: presentationSignedWith(PRIV, { expiryBlock: 501_150 }),
  });
  assert.equal(r.reason, REASONS.ARREARS);
});

test("the final period admits after the final charge", async () => {
  // The rule the on-chain gate had to fix: charging period n-1 flips the
  // vault's is_active flag false at the instant the subscriber is fully paid.
  // Entitlement is the paid window, not the flag. Here next == n == 12 with
  // start 480_000, so the schedule is paid through 480_000 + 2100*12 =
  // 505_200, and the default block 500_000 sits inside the final period.
  const r = await verdict({
    vault: vaultStubs({ ownerKey: PUB, startBlock: 480_000, nextPeriod: 12, nPeriods: 12 }),
  });
  assert.equal(r.ok, true);
});

test("an n_periods = 1 subscription admits inside its only paid window", async () => {
  const r = await verdict({
    vault: vaultStubs({ ownerKey: PUB, nPeriods: 1, nextPeriod: 1 }),
  });
  assert.equal(r.ok, true);
});

test("an n_periods = 1 subscription is in arrears after its window", async () => {
  const r = await verdict({
    vault: vaultStubs({ ownerKey: PUB, nPeriods: 1, nextPeriod: 1 }),
    blockNumber: 501_100,
    presentation: presentationSignedWith(PRIV, { expiryBlock: 501_150 }),
  });
  assert.equal(r.reason, REASONS.ARREARS);
});

test("a commitment the vault holds no key for is refused", async () => {
  // Synthetic: a live schedule whose stored key reads zero. Belt-and-braces,
  // exactly as the gate keeps it.
  const { promise, provider } = check({ vault: vaultStubs({ ownerKey: "0x0" }) });
  assert.equal((await promise).reason, REASONS.UNKNOWN_COMMITMENT);
  assert.deepEqual(provider.calls.map((c) => c.entrypoint), ["schedule_of", "owner_key_of"]);
});

test("a signature by the wrong key is refused", async () => {
  const forged = presentationSignedWith(OTHER_PRIV);
  const { promise, provider } = check({ presentation: forged });
  assert.equal((await promise).reason, REASONS.BAD_SIGNATURE);
  assert.equal(provider.calls.length, 2);
});

test("a tampered field breaks the signature", async () => {
  const p = presentationSignedWith(PRIV);
  const r = await verdict({ presentation: { ...p, commitment: "0x5ca1ab1f" } });
  assert.equal(r.reason, REASONS.BAD_SIGNATURE);
});

test("garbage in the wire fields is a malformed presentation, not a throw", async () => {
  const p = presentationSignedWith(PRIV);
  const cases = [
    undefined,
    null,
    "not an object",
    {},
    { ...p, commitment: undefined },
    { ...p, commitment: "0x0" },
    { ...p, sig_r: "banana" },
    { ...p, expiry_block: -1 },
    { ...p, nonce: {} },
  ];
  for (const presentation of cases) {
    const r = await verdict({ presentation });
    assert.equal(r.reason, REASONS.MALFORMED_PRESENTATION, `case ${JSON.stringify(presentation)}`);
    assert.equal(r.ok, false);
  }
});

test("missing wiring is bad_config, not a throw", async () => {
  const p = presentationSignedWith(PRIV);
  const base = {
    presentation: p,
    expectedVerifierId: CHALLENGE.verifierId,
    expectedNonce: CHALLENGE.nonce,
    provider: fakeProvider({ vault: vaultStubs({ ownerKey: PUB }) }),
    vaultAddress: VAULT,
  };
  const cases = [
    { ...base, vaultAddress: undefined },
    { ...base, vaultAddress: "vault" },
    { ...base, provider: undefined, rpcUrl: undefined },
    { ...base, expectedNonce: "nope" },
    { ...base, expectedVerifierId: undefined },
    { ...base, maxWindow: 0 },
  ];
  for (const args of cases) {
    const r = await verifyPresentation(args);
    assert.equal(r.reason, REASONS.BAD_CONFIG);
    assert.deepEqual([r.ok, r.creatorId, r.tier], [false, null, null]);
  }
  // Called with nothing at all, it still answers instead of throwing.
  assert.equal((await verifyPresentation()).reason, REASONS.BAD_CONFIG);
});

test("an unreachable node is a reason, not an exception", async () => {
  const boom = new Error("ECONNREFUSED");
  const down = await verdict({ blockNumber: boom });
  assert.equal(down.reason, REASONS.RPC_ERROR);

  const halfDown = await verdict({
    vault: { ...vaultStubs({ ownerKey: PUB }), owner_key_of: boom },
  });
  assert.equal(halfDown.reason, REASONS.RPC_ERROR);

  const empty = await verdict({ vault: { ...vaultStubs({ ownerKey: PUB }), schedule_of: [] } });
  assert.equal(empty.reason, REASONS.RPC_ERROR);
});

test("currentBlock can be supplied, and then the node is never asked for it", async () => {
  const provider = fakeProvider({
    blockNumber: new Error("getBlockNumber must not be called"),
    vault: vaultStubs({ ownerKey: PUB }),
  });
  const r = await verifyPresentation({
    presentation: presentationSignedWith(PRIV),
    expectedVerifierId: CHALLENGE.verifierId,
    expectedNonce: CHALLENGE.nonce,
    provider,
    vaultAddress: VAULT,
    currentBlock: NOW,
  });
  assert.equal(r.ok, true);
});

test("round trip: a locally generated keypair signs, the stubbed vault vouches for it", async () => {
  const priv = `0x${[...ec.starkCurve.utils.randomPrivateKey()]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")}`;
  const pub = ec.starkCurve.getStarkKey(priv);

  const challenge = { verifier_id: "0x444f4f525f31", nonce: "0x1a2b3c4d5e6f", expiry_block: NOW + 42 };
  const presentation = signPresentation({
    commitment: "0x7777",
    verifierId: challenge.verifier_id,
    expiryBlock: challenge.expiry_block,
    nonce: challenge.nonce,
    ownerPrivKey: priv,
  });

  const provider = fakeProvider({
    blockNumber: NOW,
    vault: vaultStubs({ ownerKey: pub, creatorId: "0xabc123", tier: 0 }),
  });
  const r = await verifyPresentation({
    presentation,
    expectedVerifierId: challenge.verifier_id,
    expectedNonce: challenge.nonce,
    provider,
    vaultAddress: VAULT,
  });
  assert.deepEqual(r, { ok: true, creatorId: "0xabc123", tier: 0, reason: null });

  // The same presentation put in front of the next challenge is worthless.
  const replay = await verifyPresentation({
    presentation,
    expectedVerifierId: challenge.verifier_id,
    expectedNonce: "0x999999",
    provider,
    vaultAddress: VAULT,
  });
  assert.equal(replay.reason, REASONS.NONCE_MISMATCH);
});

test("the verifier's own id may be given as a short string or as a felt", async () => {
  const r = await verdict({ expectedVerifierId: "0x444f4f525f31" });
  assert.equal(r.ok, true);
});
