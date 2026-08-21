#!/usr/bin/env node
// The NIGHTSHIFT demo charge endpoint: one HTTP route that fires one real
// `charge` on one whitelisted commitment.
//
// It runs on the keeper box, beside the cron keeper, and reads the same account
// files the keeper reads. That is the whole reason it exists as a long-lived
// process instead of a serverless function: the key stays where it already is,
// and the rate limit, the daily budget and the per-period lock are ordinary
// variables in one process instead of state a stateless function cannot keep.
//
// Routes:
//   POST /charge   {"commitment": "0x..."}  ->  the five statuses in decide.mjs
//   GET  /health                            ->  liveness plus today's budget
//
// Run it:
//   node demo-charge/server.mjs                    # real signer, keeper files
//   NIGHTSHIFT_DEMO_SIGNER=mock node demo-charge/server.mjs   # no key, no chain
//
// Config: see demo-charge/README.md. Nothing here prints a key, an account
// address, or an RPC URL.

import { createServer } from "node:http";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { Cooldowns, DailyBudget, PendingRegistry, httpStatusFor, safeReason } from "./src/decide.mjs";
import { ConfigError, describeConfig, loadConfig } from "./src/config.mjs";
import { mockChain, starknetChain } from "./src/chain.mjs";
import { createHandler } from "./src/handler.mjs";

const ts = () => new Date().toISOString();
const log = (msg) => console.log(`${ts()} demo-charge ${msg}`);
const die = (msg) => {
  console.error(`${ts()} demo-charge FATAL ${msg}`);
  process.exit(1);
};

const MAX_BODY_BYTES = 1024;

// Slowloris bound: a connection gets 5 s to finish its headers and 10 s to
// finish the whole request, and at most 256 sockets exist at once, so the
// cheapest denial of service against this process is bounded by those three
// numbers rather than by the client's patience.
const HEADERS_TIMEOUT_MS = 5_000;
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_CONNECTIONS = 256;

/** Thrown by readBody when the caller sends more than MAX_BODY_BYTES. */
class BodyTooLarge extends Error {}

// A visitor never learns why a request blew up, only that it did. Every
// unexpected throw in the request path collapses to this one line, and the
// process stays up: one anonymous request must not be able to end the demo.
const INTERNAL_ERROR = "the charge could not be submitted right now";

let config;
try {
  config = loadConfig();
} catch (err) {
  die(err instanceof ConfigError ? err.message : `config load failed: ${err.message}`);
}
if (config.whitelistRejected.length) {
  log(`WARN ${config.whitelistRejected.length} whitelist entr(ies) were not felts and were dropped`);
}

// --- persistent budget ------------------------------------------------------
// The daily cap has to survive a restart, or restarting the process would be a
// way to buy 24 more charges.

const budget = new DailyBudget(config.maxPerDay);
try {
  budget.restore(JSON.parse(readFileSync(config.stateFile, "utf8")).budget);
} catch {
  // No state file yet, or an unreadable one: start the day at zero.
}

const persist = () => {
  try {
    mkdirSync(dirname(config.stateFile), { recursive: true });
    const tmp = `${config.stateFile}.tmp`;
    writeFileSync(tmp, `${JSON.stringify({ budget: budget.snapshot() }, null, 2)}\n`, { mode: 0o600 });
    renameSync(tmp, config.stateFile);
  } catch (err) {
    log(`WARN could not persist budget state: ${err.code ?? "error"}`);
  }
};

// --- wiring -----------------------------------------------------------------

const chain =
  config.signer === "mock" ? mockChain() : await starknetChain(config).catch((e) => die(`signer setup failed: ${e.message}`));

const cooldowns = new Cooldowns();
const pending = new PendingRegistry();
const handleCharge = createHandler({ config, chain, cooldowns, budget, pending, persist, log });

const sweeper = setInterval(() => {
  const nowMs = Date.now();
  cooldowns.sweep(nowMs, Math.max(config.cooldownS, config.probeCooldownS) * 2);
  pending.sweep(nowMs, config.settleWindowS);
}, 60_000);
sweeper.unref();

// --- HTTP -------------------------------------------------------------------

/**
 * Caller identity for the cooldown buckets.
 *
 * A conforming proxy APPENDS the peer it saw to x-forwarded-for, so the
 * RIGHTMOST entry is the only one our own proxy wrote. Everything left of it
 * was supplied by the client and is worth nothing: reading the leftmost entry
 * lets a caller mint a fresh identity per request and walk straight past both
 * cooldowns. Node joins duplicate headers into one comma-separated string, so
 * there is no array case to handle.
 */
const clientIp = (req) => {
  if (config.trustProxy) {
    const parts = String(req.headers["x-forwarded-for"] ?? "").split(",");
    const last = parts[parts.length - 1].trim();
    if (last) return last;
  }
  return req.socket.remoteAddress ?? "unknown";
};

const cors = (req, res) => {
  const origin = req.headers.origin;
  // Set unconditionally: the answer depends on Origin whether or not this one
  // was allowed, and a cache that missed that would serve one visitor's
  // allowed response to another visitor's forbidden origin.
  res.setHeader("vary", "origin");
  if (origin && config.origins.includes(origin)) {
    res.setHeader("access-control-allow-origin", origin);
  }
  res.setHeader("access-control-allow-methods", "POST, GET, OPTIONS");
  res.setHeader("access-control-allow-headers", "content-type");
  res.setHeader("access-control-max-age", "600");
};

/** The bare media type, lowercased, with any ;charset= parameter dropped. */
const mediaType = (req) => String(req.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();

const send = (res, status, body) => {
  const text = `${JSON.stringify(body)}\n`;
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(text),
    "cache-control": "no-store",
  });
  res.end(text);
};

// The cap does NOT destroy the socket here. A caller who overruns it should
// read a 400 explaining that, not a reset connection, so the stream is only
// paused; the route hangs up once the 400 has been written.
const readBody = (req) =>
  new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) {
        req.pause();
        reject(new BodyTooLarge("body too large"));
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });

const handleRequest = async (req, res) => {
  cors(req, res);

  // node:http accepts request targets the WHATWG parser refuses (`//%zz`,
  // `http://[::1`). Left to throw inside this async function that is an
  // unhandled rejection, and an unhandled rejection ends the process: one
  // anonymous request would take the demo down.
  let url;
  try {
    url = new URL(req.url, "http://localhost");
  } catch {
    send(res, 400, { status: "error", reason: "malformed request target" });
    return;
  }

  if (req.method === "OPTIONS") {
    res.writeHead(204, { "cache-control": "no-store" });
    res.end();
    return;
  }

  if (req.method === "GET" && url.pathname === "/health") {
    const nowMs = Date.now();
    send(res, 200, {
      status: "ok",
      signer: chain.kind,
      vault: config.vault,
      charges_remaining_today: budget.remaining(nowMs),
      max_per_day: budget.max,
    });
    return;
  }

  if (url.pathname !== "/charge") {
    send(res, 404, { status: "error", reason: "no such route" });
    return;
  }
  if (req.method !== "POST") {
    send(res, 405, { status: "error", reason: "POST a JSON body to this route" });
    return;
  }
  // text/plain, multipart/form-data and form-urlencoded are CORS *simple*
  // request types: a hostile page could fire one from a visitor's browser with
  // no preflight at all. Demanding application/json forces the preflight that
  // the origin allowlist above is there to refuse.
  if (mediaType(req) !== "application/json") {
    send(res, 415, { status: "error", reason: "content-type must be application/json" });
    return;
  }

  const declared = Number(req.headers["content-length"]);
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    send(res, 400, { status: "error", reason: `body must be at most ${MAX_BODY_BYTES} bytes` });
    return;
  }

  let commitment;
  try {
    const raw = await readBody(req);
    const parsed = raw.trim() === "" ? {} : JSON.parse(raw);
    commitment = parsed?.commitment;
  } catch (err) {
    const tooLarge = err instanceof BodyTooLarge;
    send(res, 400, {
      status: "error",
      reason: tooLarge
        ? `body must be at most ${MAX_BODY_BYTES} bytes`
        : "body must be JSON of the form {\"commitment\": \"0x...\"}",
    });
    // Hang up only once the 400 is on the wire, so the caller reads the reason.
    if (tooLarge) res.on("finish", () => req.destroy());
    return;
  }

  let response;
  try {
    response = await handleCharge({ commitment, ip: clientIp(req) });
  } catch (err) {
    // A bug in the handler must still not leak a stack to a visitor.
    log(`ERROR unhandled: ${safeReason(err)}`);
    response = { status: "error", reason: INTERNAL_ERROR };
  }
  send(res, httpStatusFor(response), response);
};

const server = createServer((req, res) => {
  // Last line of defence. Anything handleRequest throws or rejects with is
  // answered here, so no request path can reach process-level unhandling.
  handleRequest(req, res).catch((err) => {
    log(`ERROR request failed: ${safeReason(err)}`);
    if (res.headersSent || res.writableEnded) {
      res.destroy();
      return;
    }
    try {
      send(res, 500, { status: "error", reason: INTERNAL_ERROR });
    } catch {
      res.destroy();
    }
  });
});

// Slowloris and socket-exhaustion bounds, set explicitly rather than inherited.
server.headersTimeout = HEADERS_TIMEOUT_MS;
server.requestTimeout = REQUEST_TIMEOUT_MS;
server.maxConnections = MAX_CONNECTIONS;

server.listen(config.port, config.host, () => {
  const bound = server.address();
  log(`listening on ${config.host}:${bound?.port ?? config.port} · ${describeConfig(config)}`);
});

// Nothing an anonymous caller does may end this process. Both handlers log one
// fixed line through the same safeReason discipline the responses use, and the
// process keeps serving.
process.on("unhandledRejection", (reason) => {
  log(`ERROR unhandled rejection: ${safeReason(reason)}`);
});
process.on("uncaughtException", (err) => {
  log(`ERROR uncaught exception: ${safeReason(err)}`);
});

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    persist();
    server.close(() => process.exit(0));
  });
}
