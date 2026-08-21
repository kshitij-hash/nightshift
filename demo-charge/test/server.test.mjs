// Tests for the HTTP layer itself: the parts that cannot be reached through
// createHandler, because they are about request targets, headers and sockets.
//
// These boot the real server as a child process with the mock signer, so no
// key is read and nothing touches the network beyond loopback. Every case here
// was a live finding first: a malformed request target that killed the process,
// a text/plain POST that skipped the CORS preflight, and an x-forwarded-for
// left entry that minted a fresh identity per request.

import { strict as assert } from "node:assert";
import { after, before, describe, test } from "node:test";
import { spawn } from "node:child_process";
import { connect } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const SERVER = fileURLToPath(new URL("../server.mjs", import.meta.url));
const DEMO = "0x3e4a525134a558e7fbabcd62895b879752274308ff618efdb2f20249c053c4a";
const VAULT = "0x171e8e0bb905c899b9d1ad5c02aefe96a5d0b6d5f093f0ee80707b592417f8e";
const ORIGIN = "https://demo.example";

/** Boot server.mjs on an ephemeral port and wait for its listening line. */
async function startServer(over = {}) {
  const dir = mkdtempSync(join(tmpdir(), "demo-charge-test-"));
  const child = spawn(
    process.execPath,
    [SERVER],
    {
      env: {
        PATH: process.env.PATH ?? "",
        NIGHTSHIFT_DEMO_SIGNER: "mock",
        NIGHTSHIFT_DEMO_COMMITMENTS: DEMO,
        STARKNET_RPC: "unused",
        NIGHTSHIFT_VAULT: VAULT,
        NIGHTSHIFT_DEMO_HOST: "127.0.0.1",
        NIGHTSHIFT_DEMO_PORT: "0",
        NIGHTSHIFT_DEMO_STATE_FILE: join(dir, "state.json"),
        NIGHTSHIFT_DEMO_ORIGINS: ORIGIN,
        NIGHTSHIFT_DEMO_TRUST_PROXY: "0",
        ...over,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  let out = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (d) => (out += d));
  child.stderr.on("data", (d) => (out += d));

  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`server never listened:\n${out}`)), 10_000);
    const poll = setInterval(() => {
      const m = out.match(/listening on 127\.0\.0\.1:(\d+)/);
      if (m) {
        clearInterval(poll);
        clearTimeout(timer);
        resolve(Number(m[1]));
      }
    }, 20);
    child.on("exit", (code) => {
      clearInterval(poll);
      clearTimeout(timer);
      reject(new Error(`server exited with ${code}:\n${out}`));
    });
  });

  return {
    port,
    child,
    log: () => out,
    alive: () => child.exitCode === null && child.signalCode === null,
    async stop() {
      if (child.exitCode === null) {
        child.kill("SIGKILL");
        await new Promise((r) => child.on("exit", r));
      }
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/**
 * Write bytes straight onto the socket. fetch() and curl both normalize a
 * request target before sending it; these findings live in the targets that
 * only survive being written by hand.
 */
function rawRequest(port, text) {
  return new Promise((resolve, reject) => {
    const sock = connect(port, "127.0.0.1");
    let out = "";
    sock.setEncoding("utf8");
    sock.setTimeout(5_000, () => {
      sock.destroy();
      resolve(out);
    });
    sock.on("connect", () => sock.write(text));
    sock.on("data", (d) => (out += d));
    sock.on("close", () => resolve(out));
    sock.on("error", (err) => (out ? resolve(out) : reject(err)));
  });
}

const statusLine = (raw) => Number(raw.split("\r\n")[0].split(" ")[1]);

const post = (port, { body = "{}", headers = {} } = {}) =>
  fetch(`http://127.0.0.1:${port}/charge`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body,
  });

describe("the HTTP surface", () => {
  let server;
  before(async () => (server = await startServer()));
  after(async () => server?.stop());

  // --- F1: malformed request targets ---------------------------------------

  test("a request target node accepts and WHATWG URL refuses is a 400, not a crash", async () => {
    // Each of these throws inside `new URL(req.url, base)`. Before the fix that
    // throw was an unhandled rejection and the process exited.
    const targets = ["//%zz", "http://[::1", "//%%", "/%", "http://a b/"];
    for (const target of targets) {
      const raw = await rawRequest(
        server.port,
        `GET ${target} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n`,
      );
      const code = statusLine(raw);
      assert.ok(code === 400 || code === 404, `${target} answered ${code}:\n${raw}`);
      assert.ok(!/Error|at Object|\.mjs:/.test(raw), `${target} leaked internals:\n${raw}`);
    }
  });

  test("the process is still serving after every one of those", async () => {
    assert.ok(server.alive(), `server died:\n${server.log()}`);
    const res = await fetch(`http://127.0.0.1:${server.port}/health`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.status, "ok");
    assert.equal(body.signer, "mock");
  });

  // --- F3: content-type ------------------------------------------------------

  test("a CORS-simple content-type is refused with 415, so a preflight is forced", async () => {
    for (const type of ["text/plain", "text/plain;charset=UTF-8", "application/x-www-form-urlencoded", "multipart/form-data"]) {
      const res = await post(server.port, {
        headers: { "content-type": type },
        body: JSON.stringify({ commitment: DEMO }),
      });
      assert.equal(res.status, 415, `${type} was accepted`);
      const body = await res.json();
      assert.deepEqual(body, { status: "error", reason: "content-type must be application/json" });
    }
  });

  test("a POST with no content-type at all is refused the same way", async () => {
    const raw = await rawRequest(
      server.port,
      `POST /charge HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}`,
    );
    assert.equal(statusLine(raw), 415);
  });

  test("application/json with a charset parameter is still application/json", async () => {
    const res = await post(server.port, {
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({ commitment: "0x1" }),
    });
    assert.notEqual(res.status, 415);
    const body = await res.json();
    assert.equal(body.status, "error"); // not whitelisted, which is the rail working
  });

  // --- F5a: body size --------------------------------------------------------

  test("an oversized content-length is refused before the body is read", async () => {
    const res = await post(server.port, { body: "x".repeat(4096) });
    assert.equal(res.status, 400);
    assert.match((await res.json()).reason, /at most 1024 bytes/);
  });

  test("a chunked body that overruns mid-stream still gets its 400 written", async () => {
    const blob = "x".repeat(3000);
    const raw = await rawRequest(
      server.port,
      `POST /charge HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\n` +
        `Transfer-Encoding: chunked\r\nConnection: close\r\n\r\n` +
        `${blob.length.toString(16)}\r\n${blob}\r\n`,
    );
    assert.equal(statusLine(raw), 400, `no response was written:\n${raw}`);
    assert.match(raw, /at most 1024 bytes/);
  });

  // --- F5f: CORS headers -----------------------------------------------------

  test("vary: origin is set whether or not the origin was allowed", async () => {
    const allowed = await fetch(`http://127.0.0.1:${server.port}/health`, { headers: { origin: ORIGIN } });
    assert.equal(allowed.headers.get("vary"), "origin");
    assert.equal(allowed.headers.get("access-control-allow-origin"), ORIGIN);

    const refused = await fetch(`http://127.0.0.1:${server.port}/health`, { headers: { origin: "https://evil.example" } });
    assert.equal(refused.headers.get("vary"), "origin");
    assert.equal(refused.headers.get("access-control-allow-origin"), null);

    const none = await fetch(`http://127.0.0.1:${server.port}/health`);
    assert.equal(none.headers.get("vary"), "origin");
  });

  test("the preflight answers 204 and is never cached as a body", async () => {
    const res = await fetch(`http://127.0.0.1:${server.port}/charge`, {
      method: "OPTIONS",
      headers: { origin: ORIGIN, "access-control-request-method": "POST" },
    });
    assert.equal(res.status, 204);
    assert.equal(res.headers.get("cache-control"), "no-store");
    assert.equal(res.headers.get("vary"), "origin");
  });

  // --- routing ---------------------------------------------------------------

  test("an unknown route is a 404 and a wrong method is a 405", async () => {
    const notFound = await fetch(`http://127.0.0.1:${server.port}/nope`);
    assert.equal(notFound.status, 404);
    const wrongMethod = await fetch(`http://127.0.0.1:${server.port}/charge`);
    assert.equal(wrongMethod.status, 405);
  });
});

// --- F2: x-forwarded-for ------------------------------------------------------

describe("with a trusted proxy in front", () => {
  let server;
  before(async () => (server = await startServer({ NIGHTSHIFT_DEMO_TRUST_PROXY: "1" })));
  after(async () => server?.stop());

  const press = (xff) =>
    post(server.port, {
      headers: { "x-forwarded-for": xff },
      body: JSON.stringify({ commitment: DEMO }),
    });

  test("spoofed left entries do not mint a new identity", async () => {
    // A real proxy appends the peer it saw, so 203.0.113.7 is the only entry
    // it wrote. Everything left of it is whatever the caller typed.
    const first = await press("203.0.113.7");
    assert.equal(first.status, 200);

    for (let i = 0; i < 5; i += 1) {
      const res = await press(`10.0.0.${i}, 192.168.1.${i}, 203.0.113.7`);
      assert.equal(res.status, 429, `spoof ${i} got through with ${res.status}`);
      const body = await res.json();
      assert.equal(body.status, "rate_limited");
    }
  });

  test("a genuinely different rightmost entry is a genuinely different caller", async () => {
    const res = await press("203.0.113.8");
    assert.notEqual(res.status, 429);
  });

  test("no x-forwarded-for at all falls back to the socket peer", async () => {
    const res = await post(server.port, { body: JSON.stringify({ commitment: DEMO }) });
    assert.ok([200, 429].includes(res.status), `unexpected ${res.status}`);
  });
});
