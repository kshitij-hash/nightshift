// End-to-end CLI tests. The RPC path is exercised through an injected verifier,
// so no test here touches the network.

import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { parseArgs, run } from "../src/cli.mjs";

const BIN = fileURLToPath(new URL("../bin/strk20-preflight.mjs", import.meta.url));
const VAULT = "0x277519c8bc1031188313de4528d1f0159319f8f86651422e89b6fbd920b3759";
const hash = (n) => `0x${n.toString(16).padStart(63, "0")}`;

const valid = {
  contracts: [VAULT],
  transactions: [hash(1), hash(2), hash(3)],
  demo_video: "https://example.com/demo.mp4",
  demo_url: "https://example.com",
};

function manifestDir(contents) {
  const dir = mkdtempSync(join(tmpdir(), "strk20-preflight-"));
  writeFileSync(join(dir, "strk20.json"), typeof contents === "string" ? contents : JSON.stringify(contents));
  return dir;
}

function cli(args, { cwd, env = {} } = {}) {
  const result = spawnSync(process.execPath, [BIN, ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, STARKNET_RPC: "", NO_COLOR: "1", ...env },
  });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

function collector() {
  const chunks = [];
  return { write: (s) => chunks.push(s), text: () => chunks.join("") };
}

test("a valid manifest passes offline and exits 0", () => {
  const dir = manifestDir(valid);
  const { code, stdout } = cli(["strk20.json", "--offline"], { cwd: dir });
  assert.equal(code, 0);
  assert.match(stdout, /valid JSON/);
  assert.match(stdout, /OK: the indexer reads this entry/);
  assert.match(stdout, /rpc checks skipped: --offline/);
});

test("the default path is ./strk20.json", () => {
  const dir = manifestDir(valid);
  const { code, stdout } = cli(["--offline"], { cwd: dir });
  assert.equal(code, 0);
  assert.match(stdout, /strk20\.json/);
});

test("invalid JSON exits 1 and says the whole file is ignored", () => {
  const dir = manifestDir('{ "transactions": [ }');
  const { code, stdout } = cli(["--offline"], { cwd: dir });
  assert.equal(code, 1);
  assert.match(stdout, /ignores the ENTIRE file/);
  assert.match(stdout, /NOT OK/);
});

test("non-string transaction entries are flagged and exit 1", () => {
  const dir = manifestDir({ ...valid, transactions: [hash(1), { hash: hash(2) }, 42] });
  const { code, stdout } = cli(["--offline"], { cwd: dir });
  assert.equal(code, 1);
  assert.match(stdout, /not bare 0x hex strings/);
});

test("more than ten transactions warns without failing", () => {
  const transactions = Array.from({ length: 12 }, (_, i) => hash(i + 1));
  const dir = manifestDir({ ...valid, transactions });
  const { code, stdout } = cli(["--offline"], { cwd: dir });
  assert.equal(code, 0);
  assert.match(stdout, /only the first 10 transactions are read/);
});

test("object-form contracts are accepted end to end", () => {
  const dir = manifestDir({ ...valid, contracts: [{ address: VAULT }] });
  const { code, stdout } = cli(["--offline"], { cwd: dir });
  assert.equal(code, 0);
  assert.match(stdout, /contracts: 1 declared/);
});

test("--json parses and carries the per-check results", () => {
  const dir = manifestDir(valid);
  const { code, stdout } = cli(["--offline", "--json"], { cwd: dir });
  assert.equal(code, 0);
  const parsed = JSON.parse(stdout);
  assert.equal(parsed.tool, "strk20-preflight");
  assert.equal(parsed.ok, true);
  assert.equal(parsed.exitCode, 0);
  assert.equal(parsed.mode, "offline");
  assert.equal(parsed.rpc.skipped, "--offline");
  assert.deepEqual(parsed.manifest.contracts, [VAULT]);
  assert.equal(parsed.manifest.transactionsRead.length, 3);
  assert.equal(parsed.manifest.demoUrl, "https://example.com");
  const ids = parsed.checks.map((c) => c.id);
  assert.deepEqual(ids, ["json", "transactions", "contracts", "mine_rule", "demo_video", "demo_url"]);
  for (const check of parsed.checks) {
    assert.ok(["pass", "info", "warn", "fail"].includes(check.level));
    assert.equal(typeof check.message, "string");
  }
});

test("--json on a broken manifest reports the failure machine-readably", () => {
  const dir = manifestDir("not json at all");
  const { code, stdout } = cli(["--json"], { cwd: dir });
  assert.equal(code, 1);
  const parsed = JSON.parse(stdout);
  assert.equal(parsed.ok, false);
  assert.equal(parsed.exitCode, 1);
  assert.equal(parsed.checks[0].level, "fail");
});

test("a missing manifest is a usage error, exit 2", () => {
  const dir = mkdtempSync(join(tmpdir(), "strk20-preflight-"));
  const { code, stderr } = cli(["--offline"], { cwd: dir });
  assert.equal(code, 2);
  assert.match(stderr, /cannot read/);
});

test("unknown flags are a usage error, exit 2", () => {
  const dir = manifestDir(valid);
  const { code, stderr } = cli(["--verbose"], { cwd: dir });
  assert.equal(code, 2);
  assert.match(stderr, /unknown flag --verbose/);
  assert.match(stderr, /usage:/);
});

test("--rpc without a URL is a usage error", () => {
  const dir = manifestDir(valid);
  assert.equal(cli(["--rpc"], { cwd: dir }).code, 2);
});

test("parseArgs reads the documented shape", () => {
  assert.deepEqual(parseArgs(["m.json", "--rpc", "https://node", "--json"]), {
    path: "m.json",
    rpc: "https://node",
    offline: false,
    json: true,
    help: false,
  });
  assert.deepEqual(parseArgs(["--rpc=https://node"]).rpc, "https://node");
  assert.match(parseArgs(["a", "b"]).error, /unexpected extra argument b/);
});

test("without --offline and without an RPC URL the network checks are skipped, not failed", () => {
  const dir = manifestDir(valid);
  const { code, stdout } = cli([], { cwd: dir });
  assert.equal(code, 0);
  assert.match(stdout, /rpc checks skipped: no --rpc URL/);
});

test("the RPC path prints PASS per hash and exits 0 when every hash routes", async () => {
  const dir = manifestDir(valid);
  const stdout = collector();
  const verify = async ({ hashes, rpcUrl, contracts }) => {
    assert.equal(rpcUrl, "https://node.example/key");
    assert.deepEqual(contracts, [VAULT]);
    return hashes.map((h) => ({ hash: h, pass: true, code: "routed_event", reason: null, mineRule: false }));
  };
  const code = await run(["--rpc", "https://node.example/key"], {
    cwd: dir,
    env: {},
    stdout,
    stderr: collector(),
    verify,
  });
  assert.equal(code, 0);
  assert.match(stdout.text(), /rpc checks via node\.example/);
  assert.ok(!stdout.text().includes("node.example/key"), "the RPC URL path is never printed");
  assert.equal((stdout.text().match(/PASS 0x/g) ?? []).length, 3);
  assert.match(stdout.text(), /3\/3 transactions verified on chain/);
});

test("a mine-rule failure exits 1 and names the mine-rule", async () => {
  const dir = manifestDir(valid);
  const stdout = collector();
  const verify = async ({ hashes }) =>
    hashes.map((h, i) => ({
      hash: h,
      pass: i !== 1,
      code: i === 1 ? "not_routed" : "routed_event",
      reason: i === 1 ? "succeeded, but the mine-rule is why this does not count" : null,
      mineRule: i === 1,
    }));
  const code = await run(["--rpc", "https://node.example"], {
    cwd: dir,
    env: {},
    stdout,
    stderr: collector(),
    verify,
  });
  assert.equal(code, 1);
  assert.match(stdout.text(), /FAIL 0x/);
  assert.match(stdout.text(), /mine-rule is why/);
  assert.match(stdout.text(), /NOT OK/);
});

test("STARKNET_RPC in the environment turns the RPC checks on by default", async () => {
  const dir = manifestDir(valid);
  const stdout = collector();
  let seen = null;
  const verify = async ({ rpcUrl, hashes }) => {
    seen = rpcUrl;
    return hashes.map((h) => ({ hash: h, pass: true, code: "routed_event", reason: null, mineRule: false }));
  };
  const code = await run(["--json"], {
    cwd: dir,
    env: { STARKNET_RPC: "https://from-env.example/rpc" },
    stdout,
    stderr: collector(),
    verify,
  });
  assert.equal(code, 0);
  assert.equal(seen, "https://from-env.example/rpc");
  const parsed = JSON.parse(stdout.text());
  assert.equal(parsed.mode, "rpc");
  assert.equal(parsed.rpc.host, "from-env.example");
  assert.equal(parsed.transactions.length, 3);
  assert.equal(parsed.transactions[0].pass, true);
});

test("--offline wins over an RPC URL", async () => {
  const dir = manifestDir(valid);
  const stdout = collector();
  const code = await run(["--offline", "--json"], {
    cwd: dir,
    env: { STARKNET_RPC: "https://from-env.example/rpc" },
    stdout,
    stderr: collector(),
    verify: async () => {
      throw new Error("the verifier must not run under --offline");
    },
  });
  assert.equal(code, 0);
  assert.equal(JSON.parse(stdout.text()).mode, "offline");
});
