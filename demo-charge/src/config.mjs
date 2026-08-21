// Configuration, read once at boot. Every knob is an environment variable, and
// the two that matter most are not variables at all: the demo account's address
// and key are read from files under ~/.nightshift/, exactly the way
// scripts/keeper.mjs and scripts/relay.mjs read them. No env var, no config
// file and no log line in this directory ever holds a private key. The
// variables below only name the PATH the keeper convention already uses.
//
// The repo .env is parsed the same way keeper.mjs parses it (line regex, no
// dependency). Real environment variables win over .env, so a systemd unit or
// a shell export can override without editing the file.

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { parseWhitelist } from "./decide.mjs";

/** Read repo .env if present. Returns a lookup that never logs a value. */
export function dotenvLookup(url = new URL("../../.env", import.meta.url)) {
  let text = "";
  try {
    text = readFileSync(url, "utf8");
  } catch {
    text = "";
  }
  return (key) => text.match(new RegExp(`^${key}=(.+)$`, "m"))?.[1]?.trim();
}

const num = (raw, fallback) => {
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};

const bool = (raw, fallback) => {
  if (raw === undefined || raw === "") return fallback;
  return /^(1|true|yes|on)$/i.test(String(raw).trim());
};

export class ConfigError extends Error {}

/**
 * Build the server config.
 * @param {object} env  process.env-shaped object
 * @param {(key: string) => string|undefined} fromDotenv
 */
export function loadConfig(env = process.env, fromDotenv = dotenvLookup()) {
  const pick = (...keys) => {
    for (const k of keys) {
      const v = env[k] ?? fromDotenv(k);
      if (v !== undefined && String(v).trim() !== "") return String(v).trim();
    }
    return undefined;
  };

  const rpc = pick("STARKNET_RPC");
  const vault = pick("NIGHTSHIFT_VAULT");
  const commitmentsRaw = pick("NIGHTSHIFT_DEMO_COMMITMENTS", "DEMO_COMMITMENTS");

  const missing = [];
  if (!rpc) missing.push("STARKNET_RPC");
  if (!vault) missing.push("NIGHTSHIFT_VAULT");
  if (!commitmentsRaw) missing.push("NIGHTSHIFT_DEMO_COMMITMENTS");
  if (missing.length) throw new ConfigError(`missing required config: ${missing.join(", ")}`);

  const { felts: whitelist, rejected } = parseWhitelist(commitmentsRaw);
  if (whitelist.length === 0) {
    throw new ConfigError("NIGHTSHIFT_DEMO_COMMITMENTS parsed to no usable felts");
  }

  const home = homedir();
  const addressFile = pick("NIGHTSHIFT_ACCOUNT_ADDRESS_FILE") ?? `${home}/.nightshift/acct2.address`;
  const keypairFile = pick("NIGHTSHIFT_ACCOUNT_KEYPAIR_FILE") ?? `${home}/.nightshift/acct2.keypair`;
  const signer = (pick("NIGHTSHIFT_DEMO_SIGNER") ?? "starknet").toLowerCase();
  if (signer !== "starknet" && signer !== "mock") {
    throw new ConfigError(`NIGHTSHIFT_DEMO_SIGNER must be "starknet" or "mock"`);
  }
  if (signer === "starknet") {
    for (const f of [addressFile, keypairFile]) {
      if (!existsSync(f)) throw new ConfigError(`account file not found: ${f}`);
    }
  }

  const origins = (pick("NIGHTSHIFT_DEMO_ORIGINS") ?? "https://nightshift-six-lilac.vercel.app")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  return {
    rpc,
    vault,
    whitelist,
    whitelistRejected: rejected,
    addressFile,
    keypairFile,
    signer,
    host: pick("NIGHTSHIFT_DEMO_HOST") ?? "127.0.0.1",
    port: num(pick("NIGHTSHIFT_DEMO_PORT"), 8788),
    // Per-IP gap between two real charges. One period is ~60 minutes, so a
    // visitor who fires one has nothing to fire again for most of an hour.
    cooldownS: num(pick("NIGHTSHIFT_DEMO_COOLDOWN_S"), 900),
    // Per-IP gap between any two requests, including the free "not due" reads.
    probeCooldownS: num(pick("NIGHTSHIFT_DEMO_PROBE_COOLDOWN_S"), 5),
    maxPerDay: num(pick("NIGHTSHIFT_DEMO_MAX_PER_DAY"), 24),
    // How long a submitted tx keeps answering for its period. schedule_of does
    // not advance next_period until the transaction is accepted.
    settleWindowS: num(pick("NIGHTSHIFT_DEMO_SETTLE_WINDOW_S"), 300),
    secondsPerBlock: num(pick("NIGHTSHIFT_DEMO_SECONDS_PER_BLOCK"), 1.7),
    stateFile: pick("NIGHTSHIFT_DEMO_STATE_FILE") ?? `${home}/.nightshift/demo-charge-state.json`,
    trustProxy: bool(pick("NIGHTSHIFT_DEMO_TRUST_PROXY"), false),
    origins,
  };
}

/** A one-line boot summary with nothing secret in it. */
export function describeConfig(config) {
  return [
    `signer=${config.signer}`,
    `vault=${config.vault.slice(0, 10)}…`,
    `commitments=${config.whitelist.length}`,
    `cooldown=${config.cooldownS}s`,
    `probe=${config.probeCooldownS}s`,
    `max_per_day=${config.maxPerDay}`,
    `trust_proxy=${config.trustProxy}`,
  ].join(" ");
}
