// Argument handling and the exit codes. Every case here stops before any RPC
// call, so this file touches no network either.

import assert from "node:assert/strict";
import test from "node:test";
import { parseArgs, run, USAGE } from "../bin/nightshift-verify.mjs";

const sink = () => {
  const out = { text: "" };
  out.write = (s) => {
    out.text += s;
  };
  return out;
};

const io = (env = {}) => ({
  env,
  stdout: sink(),
  stderr: sink(),
  stdin: { isTTY: true },
});

test("flags parse in both spellings", () => {
  const a = parseArgs(["verify", "{}", "--vault", "0x1", "--rpc", "http://node", "--nonce", "0x2"]);
  assert.equal(a.command, "verify");
  assert.equal(a.json, "{}");
  assert.deepEqual(a.flags, { vault: "0x1", rpc: "http://node", nonce: "0x2" });

  const b = parseArgs(["challenge", "--verifier=DOOR_1", "--window=500"]);
  assert.deepEqual(b.flags, { verifier: "DOOR_1", window: "500" });
});

test("a flag with no value, an unknown flag and a stray argument are all errors", () => {
  assert.match(parseArgs(["verify", "--vault"]).error, /--vault needs a value/);
  assert.match(parseArgs(["verify", "--rpc", "--vault"]).error, /--rpc needs a value/);
  assert.match(parseArgs(["verify", "--wat", "x"]).error, /unknown flag --wat/);
  assert.match(parseArgs(["verify", "--wat=x"]).error, /unknown flag --wat/);
  assert.match(parseArgs(["verify", "{}", "extra"]).error, /unexpected extra argument extra/);
});

test("--help prints usage and exits 0", async () => {
  const it = io();
  assert.equal(await run(["--help"], it), 0);
  assert.equal(it.stdout.text.trim(), USAGE);
});

test("no command at all is a usage error", async () => {
  const it = io();
  assert.equal(await run([], it), 2);
});

test("an unknown command is a usage error", async () => {
  const it = io({ STARKNET_RPC: "http://node" });
  assert.equal(await run(["present"], it), 2);
  assert.match(it.stderr.text, /unknown command present/);
});

test("a missing RPC URL is a usage error before anything is dialled", async () => {
  const it = io();
  assert.equal(await run(["challenge", "--verifier", "DOOR_1"], it), 2);
  assert.match(it.stderr.text, /--rpc URL/);
});

test("challenge needs a verifier id", async () => {
  const it = io({ STARKNET_RPC: "http://node" });
  assert.equal(await run(["challenge"], it), 2);
  assert.match(it.stderr.text, /--verifier ID/);
});

test("a non-numeric window is a usage error", async () => {
  const it = io({ STARKNET_RPC: "http://node" });
  assert.equal(await run(["challenge", "--verifier", "DOOR_1", "--window", "soon"], it), 2);
  assert.match(it.stderr.text, /--window must be a positive integer/);
});

test("verify needs a vault address", async () => {
  const it = io({ STARKNET_RPC: "http://node" });
  assert.equal(await run(["verify", "{}"], it), 2);
  assert.match(it.stderr.text, /--vault ADDR/);
});

test("verify refuses input that is not JSON", async () => {
  const it = io({ STARKNET_RPC: "http://node", NIGHTSHIFT_VAULT: "0x1" });
  assert.equal(await run(["verify", "{oops"], it), 2);
  assert.match(it.stderr.text, /not JSON/);
});

test("verify refuses to run without an expected verifier id and nonce", async () => {
  const presentation = JSON.stringify({
    commitment: "0x1",
    verifier_id: "0x2",
    expiry_block: 3,
    nonce: "0x4",
    sig_r: "0x5",
    sig_s: "0x6",
  });
  const noVerifier = io({ STARKNET_RPC: "http://node", NIGHTSHIFT_VAULT: "0x1" });
  assert.equal(await run(["verify", presentation], noVerifier), 2);
  assert.match(noVerifier.stderr.text, /--verifier ID/);

  // The nonce may come from the challenge the caller stored, never from the
  // presentation being checked.
  const noNonce = io({ STARKNET_RPC: "http://node", NIGHTSHIFT_VAULT: "0x1" });
  assert.equal(await run(["verify", presentation, "--verifier", "0x2"], noNonce), 2);
  assert.match(noNonce.stderr.text, /--nonce FELT/);
});

test("verify with no JSON and no pipe is a usage error", async () => {
  const it = io({ STARKNET_RPC: "http://node", NIGHTSHIFT_VAULT: "0x1" });
  assert.equal(await run(["verify", "--verifier", "0x2", "--nonce", "0x4"], it), 2);
  assert.match(it.stderr.text, /argument or on stdin/);
});
