// Argument handling and the run loop. Exit codes: 0 all-pass, 1 any failure,
// 2 usage error or the manifest could not be read.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { inspectManifest } from "./manifest.mjs";
import { rpcHost, verifyTransactions } from "./rpc.mjs";
import { useColor, renderReport } from "./report.mjs";

export const USAGE = `strk20-preflight: check strk20.json the way the judges' indexer reads it.

usage:
  npx strk20-preflight [path/to/strk20.json] [--rpc URL] [--offline] [--json]

  path        manifest to check (default: ./strk20.json)
  --rpc URL   Starknet RPC node for the on-chain checks.
              Default: the STARKNET_RPC environment variable, when it is set.
  --offline   file checks only, never touch the network
  --json      print one machine-readable result object instead of the report

exit codes:
  0  every check passed
  1  at least one check failed
  2  usage error, or the manifest could not be read`;

export const VERSION = readVersion();

function readVersion() {
  try {
    return JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;
  } catch {
    return "";
  }
}

/**
 * @param {string[]} argv  arguments after the node binary and the script
 * @returns {{path?: string, rpc?: string, offline: boolean, json: boolean, help: boolean, error?: string}}
 */
export function parseArgs(argv) {
  const args = { path: undefined, rpc: undefined, offline: false, json: false, help: false };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--offline") args.offline = true;
    else if (arg === "--json") args.json = true;
    else if (arg === "--help" || arg === "-h") args.help = true;
    else if (arg === "--rpc") {
      const value = argv[++i];
      if (!value || value.startsWith("--")) return { ...args, error: "--rpc needs a URL" };
      args.rpc = value;
    } else if (arg.startsWith("--rpc=")) {
      const value = arg.slice("--rpc=".length);
      if (!value) return { ...args, error: "--rpc needs a URL" };
      args.rpc = value;
    } else if (arg.startsWith("-")) {
      return { ...args, error: `unknown flag ${arg}` };
    } else if (args.path === undefined) {
      args.path = arg;
    } else {
      return { ...args, error: `unexpected extra argument ${arg}` };
    }
  }

  return args;
}

/**
 * Run one check.
 *
 * @param {string[]} argv
 * @param {{env?: object, cwd?: string, stdout?: {write:Function}, stderr?: {write:Function},
 *          verify?: typeof verifyTransactions}} io
 * @returns {Promise<number>} exit code
 */
export async function run(argv, io = {}) {
  const env = io.env ?? process.env;
  const cwd = io.cwd ?? process.cwd();
  const stdout = io.stdout ?? process.stdout;
  const stderr = io.stderr ?? process.stderr;
  const verify = io.verify ?? verifyTransactions;

  const args = parseArgs(argv);
  if (args.error) {
    stderr.write(`strk20-preflight: ${args.error}\n\n${USAGE}\n`);
    return 2;
  }
  if (args.help) {
    stdout.write(`${USAGE}\n`);
    return 0;
  }

  const path = resolve(cwd, args.path ?? "strk20.json");

  let raw;
  try {
    raw = readFileSync(path, "utf8");
  } catch (e) {
    stderr.write(
      `strk20-preflight: cannot read ${path} (${e.code ?? e.message}).\n` +
        "Point the first argument at the manifest, or run this from the repo root.\n",
    );
    return 2;
  }

  const inspection = inspectManifest(raw);

  const result = {
    tool: "strk20-preflight",
    version: VERSION,
    path,
    ok: inspection.ok,
    mode: "offline",
    rpc: { host: null, skipped: null },
    checks: inspection.checks,
    manifest: {
      transactionsRead: inspection.txsRead,
      transactionsIgnored: inspection.txsIgnored,
      contracts: inspection.contracts,
      demoVideo: inspection.manifest?.demo_video ?? null,
      demoUrl: inspection.manifest?.demo_url ?? null,
    },
    transactions: [],
    exitCode: 0,
  };

  const rpcUrl = args.rpc ?? env.STARKNET_RPC;
  const skipReason = rpcSkipReason(args, rpcUrl, inspection);

  if (skipReason) {
    result.rpc.skipped = skipReason;
  } else {
    result.mode = "rpc";
    result.rpc.host = rpcHost(rpcUrl);
    try {
      result.transactions = await verify({
        rpcUrl,
        hashes: inspection.txsRead,
        contracts: inspection.contracts,
      });
    } catch (e) {
      stderr.write(`strk20-preflight: ${e.message}\n`);
      return 2;
    }
    if (result.transactions.some((t) => !t.pass)) result.ok = false;
  }

  result.exitCode = result.ok ? 0 : 1;

  if (args.json) {
    stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    stdout.write(
      `${renderReport(result, { color: useColor(stdout, env), version: VERSION })}\n`,
    );
  }

  return result.exitCode;
}

function rpcSkipReason(args, rpcUrl, inspection) {
  if (args.offline) return "--offline";
  if (!rpcUrl) return "no --rpc URL and no STARKNET_RPC in the environment";
  if (inspection.fatal) return "the manifest does not parse, so there is nothing to look up";
  if (inspection.txsRead.length === 0) return "no readable transaction hashes in the manifest";
  return null;
}
