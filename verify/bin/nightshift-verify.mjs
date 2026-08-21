#!/usr/bin/env node
// CLI over the library. Two subcommands, JSON in and JSON out, so a bot written
// in something other than JavaScript can shell out to it.
//
//   nightshift-verify challenge --verifier DOOR_1 --rpc URL
//   nightshift-verify verify '<json>' --vault 0x... --rpc URL
//
// Exit codes: 0 the presentation checks out, 1 it does not, 2 usage error.

import { readFileSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_CHALLENGE_WINDOW,
  MAX_WINDOW_BLOCKS,
  makeChallenge,
  verifyPresentation,
} from "../src/index.mjs";

export const USAGE = `nightshift-verify: check a NIGHTSHIFT tier presentation off-chain.

usage:
  nightshift-verify challenge --verifier ID [--window N] [--rpc URL]
  nightshift-verify verify [JSON] --vault ADDR [--rpc URL]
                           [--verifier ID] [--nonce FELT] [--max-window N]

  challenge   print a fresh { verifier_id, nonce, expiry_block } to hand to the
              subscriber. Keep it against the pending request: the same nonce
              has to come back, and only once.

  verify      read a presentation and print { ok, creatorId, tier, reason }.
              JSON comes from the first argument or, when that is absent, from
              stdin. It may be the presentation itself, or an object with a
              "presentation" key and an optional "challenge" key.

  --verifier  this verifier's own id. 0x-hex passes through, anything else is
              encoded as a Cairo short string. Falls back to challenge.verifier_id
              in the input JSON.
  --nonce     the nonce this verifier issued for THIS request. Falls back to
              challenge.nonce in the input JSON. Never take it from the
              presentation: a nonce the presenter chose checks nothing.
  --vault     NIGHTSHIFT vault address (default: the NIGHTSHIFT_VAULT env var).
  --rpc       Starknet RPC node (default: the STARKNET_RPC env var).
  --window    blocks from now to the challenge expiry (default ${DEFAULT_CHALLENGE_WINDOW}, max ${MAX_WINDOW_BLOCKS}).
  --max-window  how far ahead a presented expiry may sit (default ${MAX_WINDOW_BLOCKS}).

exit codes:
  0  ok
  1  not ok, with a reason
  2  usage error`;

const FLAGS_WITH_VALUE = new Set(["--verifier", "--nonce", "--vault", "--rpc", "--window", "--max-window"]);

/**
 * @param {string[]} argv  arguments after the node binary and the script
 * @returns {{command?: string, json?: string, flags: object, help: boolean,
 *            version: boolean, error?: string}}
 */
export function parseArgs(argv) {
  const args = { command: undefined, json: undefined, flags: {}, help: false, version: false };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      args.help = true;
    } else if (arg === "--version" || arg === "-v") {
      args.version = true;
    } else if (FLAGS_WITH_VALUE.has(arg)) {
      const value = argv[++i];
      if (value === undefined || value.startsWith("--")) return { ...args, error: `${arg} needs a value` };
      args.flags[arg.slice(2)] = value;
    } else if (arg.startsWith("--") && arg.includes("=")) {
      const eq = arg.indexOf("=");
      const name = arg.slice(0, eq);
      if (!FLAGS_WITH_VALUE.has(name)) return { ...args, error: `unknown flag ${name}` };
      const value = arg.slice(eq + 1);
      if (value === "") return { ...args, error: `${name} needs a value` };
      args.flags[name.slice(2)] = value;
    } else if (arg.startsWith("-")) {
      return { ...args, error: `unknown flag ${arg}` };
    } else if (args.command === undefined) {
      args.command = arg;
    } else if (args.json === undefined) {
      args.json = arg;
    } else {
      return { ...args, error: `unexpected extra argument ${arg}` };
    }
  }

  return args;
}

function readVersion() {
  try {
    return JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;
  } catch {
    return "";
  }
}

async function readStdin(stdin) {
  const chunks = [];
  for await (const chunk of stdin) chunks.push(chunk);
  return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString("utf8");
}

function positiveInt(raw, name) {
  if (raw === undefined) return undefined;
  if (!/^[0-9]+$/.test(raw) || Number(raw) === 0) throw new Error(`${name} must be a positive integer`);
  return Number(raw);
}

/**
 * @param {string[]} argv
 * @param {{env?: object, stdin?: object, stdout?: {write:Function}, stderr?: {write:Function}}} io
 * @returns {Promise<number>} exit code
 */
export async function run(argv, io = {}) {
  const env = io.env ?? process.env;
  const stdout = io.stdout ?? process.stdout;
  const stderr = io.stderr ?? process.stderr;
  const stdin = io.stdin ?? process.stdin;

  const args = parseArgs(argv);
  if (args.error) {
    stderr.write(`nightshift-verify: ${args.error}\n\n${USAGE}\n`);
    return 2;
  }
  if (args.version) {
    stdout.write(`${readVersion()}\n`);
    return 0;
  }
  if (args.help || args.command === undefined) {
    stdout.write(`${USAGE}\n`);
    return args.help ? 0 : 2;
  }

  const rpcUrl = args.flags.rpc ?? env.STARKNET_RPC;
  if (!rpcUrl) {
    stderr.write("nightshift-verify: pass --rpc URL, or set STARKNET_RPC.\n");
    return 2;
  }

  if (args.command === "challenge") {
    if (!args.flags.verifier) {
      stderr.write("nightshift-verify: challenge needs --verifier ID.\n");
      return 2;
    }
    let window;
    try {
      window = positiveInt(args.flags.window, "--window") ?? DEFAULT_CHALLENGE_WINDOW;
    } catch (e) {
      stderr.write(`nightshift-verify: ${e.message}\n`);
      return 2;
    }
    try {
      const challenge = await makeChallenge({ verifierId: args.flags.verifier, window, rpcUrl });
      stdout.write(`${JSON.stringify(challenge, null, 2)}\n`);
      return 0;
    } catch (e) {
      stderr.write(`nightshift-verify: could not build a challenge (${e.message}).\n`);
      return 2;
    }
  }

  if (args.command !== "verify") {
    stderr.write(`nightshift-verify: unknown command ${args.command}\n\n${USAGE}\n`);
    return 2;
  }

  const vaultAddress = args.flags.vault ?? env.NIGHTSHIFT_VAULT;
  if (!vaultAddress) {
    stderr.write("nightshift-verify: pass --vault ADDR, or set NIGHTSHIFT_VAULT.\n");
    return 2;
  }

  let raw = args.json;
  if (raw === undefined) {
    if (stdin.isTTY) {
      stderr.write("nightshift-verify: pass the presentation JSON as an argument or on stdin.\n");
      return 2;
    }
    raw = await readStdin(stdin);
  }

  let input;
  try {
    input = JSON.parse(raw);
  } catch (e) {
    stderr.write(`nightshift-verify: the input is not JSON (${e.message}).\n`);
    return 2;
  }
  if (!input || typeof input !== "object") {
    stderr.write("nightshift-verify: the input is not a JSON object.\n");
    return 2;
  }

  const presentation = input.presentation ?? input;
  const challenge = input.challenge ?? {};
  // The presentation is never asked what the challenge was. A verifier that
  // reads the nonce off the thing it is checking has checked nothing.
  const expectedVerifierId = args.flags.verifier ?? challenge.verifier_id;
  const expectedNonce = args.flags.nonce ?? challenge.nonce;
  if (expectedVerifierId === undefined || expectedVerifierId === null) {
    stderr.write("nightshift-verify: pass --verifier ID, or put challenge.verifier_id in the input.\n");
    return 2;
  }
  if (expectedNonce === undefined || expectedNonce === null) {
    stderr.write("nightshift-verify: pass --nonce FELT, or put challenge.nonce in the input.\n");
    return 2;
  }

  let maxWindow;
  try {
    maxWindow = positiveInt(args.flags["max-window"], "--max-window") ?? MAX_WINDOW_BLOCKS;
  } catch (e) {
    stderr.write(`nightshift-verify: ${e.message}\n`);
    return 2;
  }

  const result = await verifyPresentation({
    presentation,
    expectedVerifierId,
    expectedNonce,
    rpcUrl,
    vaultAddress,
    maxWindow,
  });
  stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return result.ok ? 0 : 1;
}

// Importing this file (the tests do) must not run the CLI. npm invokes bin
// scripts through a node_modules/.bin symlink while import.meta.url resolves
// to the realpath, so argv[1] must be realpath'd before comparing or the
// installed CLI silently never runs.
const invokedDirectly = (() => {
  if (process.argv[1] === undefined) return false;
  try {
    return fileURLToPath(import.meta.url) === realpathSync(resolve(process.argv[1]));
  } catch {
    return false;
  }
})();

if (invokedDirectly) {
  process.exitCode = await run(process.argv.slice(2));
}
