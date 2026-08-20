// Offline half of the checker: reads strk20.json exactly the way the judges'
// indexer reads it, and reports every place where the indexer would quietly
// drop something instead of complaining.
//
// Reference behaviour being mirrored (readManifest in the hub's build step):
//   - a file that does not parse as JSON is ignored wholesale, entry and all
//   - transactions must be a FLAT array of BARE strings matching FELT_RE;
//     objects, numbers and nested arrays are dropped without a word
//   - only the first 10 transactions are read
//   - contracts entries may be a string or an { address } object
//   - the mine-rule: with contracts declared, only transactions routed through
//     a declared contract count

import { FELT_RE, declaredFelts } from "./verdict.mjs";

/** How many transactions the indexer reads, counting from the top of the array. */
export const MAX_INDEXED_TX = 10;

const check = (id, level, message) => ({ id, level, message });

/**
 * Run every offline check against the raw file text.
 *
 * @param {string} raw  file contents of strk20.json
 * @returns {{
 *   ok: boolean, fatal: boolean, checks: Array<{id:string,level:string,message:string}>,
 *   manifest: object|null, txsRead: string[], txsIgnored: string[], contracts: string[]
 * }}
 */
export function inspectManifest(raw) {
  const checks = [];
  let manifest = null;

  try {
    manifest = JSON.parse(raw);
  } catch (e) {
    checks.push(
      check(
        "json",
        "fail",
        `strk20.json is not valid JSON (${e.message}).\n` +
          "The indexer ignores the ENTIRE file when it fails to parse. Not one transaction, not " +
          "one contract, not the demo URL: the whole entry reads as empty. Fix this first, every " +
          "other check below is moot until the file parses.",
      ),
    );
    return { ok: false, fatal: true, checks, manifest: null, txsRead: [], txsIgnored: [], contracts: [] };
  }

  if (manifest === null || typeof manifest !== "object" || Array.isArray(manifest)) {
    checks.push(
      check(
        "json",
        "fail",
        `strk20.json parsed, but the top level is ${describe(manifest)} instead of a JSON object. ` +
          "The indexer reads named fields off an object and finds none here.",
      ),
    );
    return { ok: false, fatal: true, checks, manifest, txsRead: [], txsIgnored: [], contracts: [] };
  }

  checks.push(check("json", "pass", "valid JSON, top level is an object"));

  const { txsRead, txsIgnored } = checkTransactions(manifest.transactions, checks);
  const contracts = checkContracts(manifest.contracts, checks);
  checkMineRule(contracts, txsRead, checks);
  checkDemoVideo(manifest.demo_video, checks);
  checkDemoUrl(manifest.demo_url, checks);

  const ok = !checks.some((c) => c.level === "fail");
  return { ok, fatal: false, checks, manifest, txsRead, txsIgnored, contracts };
}

function checkTransactions(txs, checks) {
  if (txs === undefined) {
    checks.push(check("transactions", "fail", 'no "transactions" field: the indexer reads zero transactions for this entry'));
    return { txsRead: [], txsIgnored: [] };
  }
  if (!Array.isArray(txs)) {
    checks.push(
      check("transactions", "fail", `"transactions" is ${describe(txs)}, and the indexer only reads an array. Everything here is dropped.`),
    );
    return { txsRead: [], txsIgnored: [] };
  }
  if (txs.length === 0) {
    checks.push(check("transactions", "warn", '"transactions" is an empty array: nothing to score'));
    return { txsRead: [], txsIgnored: [] };
  }

  const bad = [];
  txs.forEach((t, i) => {
    if (typeof t !== "string" || !FELT_RE.test(t)) bad.push(`[${i}] ${describe(t)}`);
  });

  if (bad.length) {
    checks.push(
      check(
        "transactions",
        "fail",
        `${bad.length} of ${txs.length} entries are not bare 0x hex strings, and the indexer drops them ` +
          "without any error. Each entry has to be the hash on its own, not an object, not a number, " +
          "not a nested array:\n  " +
          bad.join("\n  "),
      ),
    );
  } else {
    checks.push(check("transactions", "pass", `${txs.length} ${plural(txs.length, "entry", "entries")}, all bare 0x hex strings`));
  }

  const conforming = txs.filter((t) => typeof t === "string" && FELT_RE.test(t));
  const txsRead = conforming.slice(0, MAX_INDEXED_TX);
  const txsIgnored = conforming.slice(MAX_INDEXED_TX);

  if (txsIgnored.length) {
    checks.push(
      check(
        "transactions_limit",
        "warn",
        `only the first ${MAX_INDEXED_TX} transactions are read. ${txsIgnored.length} listed after them are ignored, ` +
          "so put the best ones first. Ignored:\n  " +
          txsIgnored.join("\n  "),
      ),
    );
  }

  return { txsRead, txsIgnored };
}

function checkContracts(contracts, checks) {
  if (contracts === undefined) {
    checks.push(
      check("contracts", "info", 'no "contracts" field: every listed transaction counts on its own, with no routing requirement'),
    );
    return [];
  }
  if (!Array.isArray(contracts)) {
    checks.push(check("contracts", "fail", `"contracts" is ${describe(contracts)}, and the indexer only reads an array`));
    return [];
  }
  if (contracts.length === 0) {
    checks.push(check("contracts", "info", '"contracts" is empty: every listed transaction counts on its own'));
    return [];
  }

  const addresses = [];
  const broken = [];
  contracts.forEach((c, i) => {
    const address = typeof c === "string" ? c : c && typeof c === "object" ? c.address : undefined;
    if (typeof address !== "string" || address === "") broken.push(`[${i}] ${describe(c)}`);
    else addresses.push(address);
  });

  if (broken.length) {
    checks.push(
      check(
        "contracts",
        "fail",
        "every contracts entry has to be an address string or an object with an address field. " +
          "These carry no address and are dropped:\n  " +
          broken.join("\n  "),
      ),
    );
  } else {
    checks.push(check("contracts", "pass", `${addresses.length} declared`));
  }

  const malformed = addresses.filter((a) => !FELT_RE.test(a));
  if (malformed.length) {
    checks.push(
      check(
        "contracts_format",
        "warn",
        "these declared addresses are not 0x hex felts, so no transaction can ever match them, " +
          "while the mine-rule still applies to the entry:\n  " +
          malformed.join("\n  "),
      ),
    );
  }

  return addresses;
}

function checkMineRule(contracts, txsRead, checks) {
  if (contracts.length === 0) return;

  const usable = declaredFelts(contracts).length;
  checks.push(
    check(
      "mine_rule",
      "warn",
      "THE MINE-RULE APPLIES TO THIS ENTRY.\n" +
        `${contracts.length} contract ${plural(contracts.length, "address", "addresses")} declared` +
        `${usable === contracts.length ? "" : ` (${usable} of them parse as felts)`}. ` +
        'From the moment any address appears in "contracts", a listed transaction only counts ' +
        "when it runs through one of those contracts: an event emitted by it, or its address as " +
        "a felt in the calldata. Everything else stops counting, silently.\n" +
        "Declaring a contract that none of the listed transactions touch is how an entry ends up " +
        "scoring zero transactions while the file looks perfectly fine. Run this checker with " +
        "--rpc to see which of the listed hashes actually route through the declared addresses." +
        (txsRead.length === 0
          ? "\nNo readable transaction is listed at all right now, so the entry scores zero transactions."
          : ""),
    ),
  );
}

function checkDemoVideo(demoVideo, checks) {
  if (demoVideo === undefined) {
    checks.push(
      check(
        "demo_video",
        "warn",
        'no "demo_video" field. Without a demo video the entry cannot reach finished status.',
      ),
    );
    return;
  }
  if (typeof demoVideo !== "string") {
    checks.push(check("demo_video", "fail", `"demo_video" is ${describe(demoVideo)} and has to be a string`));
    return;
  }
  if (demoVideo.trim() === "") {
    checks.push(
      check(
        "demo_video",
        "warn",
        '"demo_video" is empty. The entry cannot reach finished status until it holds a public ' +
          "URL that plays for a logged-out viewer.",
      ),
    );
    return;
  }
  if (!/^https?:\/\//i.test(demoVideo)) {
    checks.push(
      check("demo_video", "warn", `"demo_video" is set but is not an http(s) URL: ${demoVideo}`),
    );
    return;
  }
  checks.push(check("demo_video", "pass", `set: ${demoVideo}`));
}

function checkDemoUrl(demoUrl, checks) {
  if (demoUrl === undefined) {
    checks.push(check("demo_url", "info", 'no "demo_url" field: the hub falls back to auto-discovery'));
    return;
  }
  if (typeof demoUrl !== "string") {
    checks.push(check("demo_url", "fail", `"demo_url" is ${describe(demoUrl)} and has to be a string`));
    return;
  }
  if (demoUrl.trim() === "") {
    checks.push(check("demo_url", "warn", '"demo_url" is empty, so the hub falls back to auto-discovery'));
    return;
  }
  if (!/^https?:\/\//i.test(demoUrl)) {
    checks.push(check("demo_url", "warn", `"demo_url" is set but is not an http(s) URL: ${demoUrl}`));
    return;
  }
  checks.push(check("demo_url", "pass", `set: ${demoUrl}`));
}

function plural(n, one, many) {
  return n === 1 ? one : many;
}

function describe(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return `a nested array (${JSON.stringify(value).slice(0, 60)})`;
  const t = typeof value;
  if (t === "object") return `an object (${JSON.stringify(value).slice(0, 60)})`;
  if (t === "string") return `the string ${JSON.stringify(value.slice(0, 80))}`;
  if (t === "undefined") return "absent";
  return `${t} ${String(value).slice(0, 40)}`;
}
