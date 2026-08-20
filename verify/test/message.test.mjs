// The message the subscriber signs is the one thing that has to match Cairo
// byte for byte, so it is pinned twice here: recomputed in-test with
// starknet.js the way src/common.cairo lays it out, and against a literal
// vector so a change in either side shows up as a failing test rather than a
// gate that quietly stops admitting anyone.

import assert from "node:assert/strict";
import test from "node:test";
import { ec, hash, shortString } from "starknet";
import { checkPresentSignature, presentMessage, signPresentation, toVerifierFelt } from "../src/index.mjs";

// Test key material. Generated for this file, never used anywhere else.
const PRIV = "0x0511ce1e6ea0a0c3d1a3fdd1a3f0f3a2b8c7d6e5f4a3b2c1d0e9f8a7b6c5d4e3";
const PUB = "0x565b7c584080ffa526d83d93b276be1a8cf9737666251d6cbe57da52a828472";

const VECTOR = {
  commitment: "0x5ca1ab1e",
  verifierId: "DOOR_1",
  expiryBlock: 501000,
  nonce: "0xdeadbeefcafe",
};

test("presentMessage is poseidon(['NIGHTSHIFT_PRESENT', commitment, verifier_id, expiry_block, nonce])", () => {
  // The same span src/common.cairo hashes in present_nonce_message, built here
  // from starknet.js rather than from the library under test.
  const expected = hash.computePoseidonHashOnElements([
    shortString.encodeShortString("NIGHTSHIFT_PRESENT"),
    "0x5ca1ab1e",
    shortString.encodeShortString("DOOR_1"),
    `0x${(501000n).toString(16)}`,
    "0xdeadbeefcafe",
  ]);
  assert.equal(presentMessage(VECTOR), expected);
});

test("the message vector is stable", () => {
  assert.equal(
    presentMessage(VECTOR),
    "0x73faa8ef238d7dee0ebd42e8dab5f1837dcd0d8eee68251609bbac465503852",
  );
});

test("a short-string verifier id and its felt are the same id", () => {
  assert.equal(toVerifierFelt("DOOR_1"), BigInt("0x444f4f525f31"));
  assert.equal(presentMessage(VECTOR), presentMessage({ ...VECTOR, verifierId: "0x444f4f525f31" }));
});

test("every field is bound: changing one changes the message", () => {
  const base = presentMessage(VECTOR);
  const variants = [
    { ...VECTOR, commitment: "0x5ca1ab1f" },
    { ...VECTOR, verifierId: "DOOR_2" },
    { ...VECTOR, expiryBlock: 501001 },
    { ...VECTOR, nonce: "0xdeadbeefcaff" },
  ];
  for (const v of variants) assert.notEqual(presentMessage(v), base);
});

test("field order is part of the message", () => {
  const swapped = presentMessage({
    commitment: VECTOR.nonce,
    verifierId: VECTOR.verifierId,
    expiryBlock: VECTOR.expiryBlock,
    nonce: VECTOR.commitment,
  });
  assert.notEqual(swapped, presentMessage(VECTOR));
});

test("signPresentation returns the wire shape, felts canonicalized", () => {
  const p = signPresentation({ ...VECTOR, ownerPrivKey: PRIV });
  assert.deepEqual(Object.keys(p).sort(), [
    "commitment",
    "expiry_block",
    "nonce",
    "sig_r",
    "sig_s",
    "verifier_id",
  ]);
  assert.equal(p.commitment, "0x5ca1ab1e");
  assert.equal(p.verifier_id, "0x444f4f525f31");
  assert.equal(p.expiry_block, 501000);
  assert.equal(p.nonce, "0xdeadbeefcafe");
});

test("a signature from signPresentation checks against the x-only stored key", () => {
  const p = signPresentation({ ...VECTOR, ownerPrivKey: PRIV });
  const msg = presentMessage(VECTOR);
  assert.equal(checkPresentSignature(msg, BigInt(PUB), BigInt(p.sig_r), BigInt(p.sig_s)), true);
});

test("the stored key is the x coordinate starknet.js derives from the private key", () => {
  assert.equal(ec.starkCurve.getStarkKey(PRIV), PUB);
});

test("a malleated signature still checks, the way Cairo's check_ecdsa_signature does", () => {
  // (r, s) and (r, -s) verify the same message on this curve. The on-chain gate
  // handles that by keying its write-once nullifier on the message tuple rather
  // than on the signature; off-chain the nonce does the same job.
  const p = signPresentation({ ...VECTOR, ownerPrivKey: PRIV });
  const msg = presentMessage(VECTOR);
  const flipped = ec.starkCurve.CURVE.n - BigInt(p.sig_s);
  assert.equal(checkPresentSignature(msg, BigInt(PUB), BigInt(p.sig_r), flipped), true);
});

test("checkPresentSignature returns false rather than throwing on junk", () => {
  const msg = presentMessage(VECTOR);
  assert.equal(checkPresentSignature(msg, BigInt(PUB), 0n, 0n), false);
  assert.equal(checkPresentSignature(msg, 0n, 1n, 1n), false);
  assert.equal(checkPresentSignature(msg, BigInt(PUB), 1n, 1n), false);
});

test("signPresentation refuses a missing key instead of signing with undefined", () => {
  assert.throws(() => signPresentation({ ...VECTOR, ownerPrivKey: undefined }));
});
