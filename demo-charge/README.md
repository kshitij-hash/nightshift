# demo-charge

One HTTP route that fires one real mainnet `charge` on one whitelisted
NIGHTSHIFT subscription, so a judge with no wallet and no Starknet account can
press a button and watch a transaction land on Voyager.

It is a long-lived Node process meant to run on the keeper box, beside the cron
keeper, reading the same account files `scripts/keeper.mjs` reads.

```
POST /charge   {"commitment": "0x..."}
GET  /health
```

## Why it can exist at all

`charge(commitment)` in `src/vault.cairo` is a plain public entrypoint. Anyone
may call it. It reverts `NS_NOT_DUE` before the period arrives, `NS_PERIOD_SPENT`
on a replay, `NS_ESCROW_EXHAUSTED` when the escrow is gone, and `NS_CANCELLED`
after the subscriber cancels. It moves value the subscriber already escrowed at
subscribe time from that subscription's escrow into the creator's claimable
balance, and nothing else. Money only leaves the vault later, under a signature
from the creator's own payout key.

So an anonymous visitor firing `charge` is not spending anyone's money. They are
spending the SUBMITTING account's gas, and only when the schedule says a period
is due.

## Threat model, in plain terms

What the key in this process can do:

- Call `charge` on a commitment in `DEMO_COMMITMENTS`. That is the only call the
  code can build. There is no path from an HTTP request to `cancel`, `reclaim`,
  `claim_public`, `register_creator`, or a transfer.
- Spend its own gas. It cannot move a subscriber's escrow anywhere except into
  the creator's claimable balance, on the schedule the subscriber committed to.

What an abuser can do:

- Waste gas. A flood of requests gets three answers: refused for a commitment
  that is not the demo one, `not_due` from a read that costs no gas, or one real
  transaction. The daily cap bounds the last case at `NIGHTSHIFT_DEMO_MAX_PER_DAY`
  transactions per UTC day, whoever is asking and however many identities they
  present, because the counter is per process and is persisted across restarts.
- Waste a little memory. Cooldown keys are caller-chosen, so a flood of fresh
  keys would grow the map one entry per request. Two things bound it: the
  minute-by-minute age sweep, and a hard ceiling of 10,000 entries per bucket
  past which the least recently seen entry is dropped.
- Waste some sockets. `maxConnections` is 256, headers get 5 s and a whole
  request gets 10 s, so a slowloris costs 256 idle sockets for ten seconds.
- Not much else. A charge on a period that is not due never leaves the process,
  because the schedule is read first. A duplicate charge on a period already
  submitted never leaves the process either, because of the per-period lock and
  the settle-window memo.

Two limits on that "not much else":

- The per-period memo is in memory. A restart inside the settle window forgets
  that a transaction is already in flight for the current period, so the next
  press can submit a duplicate that reverts `NS_PERIOD_SPENT` and wastes one
  fee. The memo is a gas optimisation, not a correctness mechanism: the vault's
  own period nullifier is what actually makes a double charge impossible.
- The per-IP cooldowns are only as good as the identity behind them. With
  `NIGHTSHIFT_DEMO_TRUST_PROXY=1` the identity is the RIGHTMOST
  `x-forwarded-for` entry, the one the proxy in front appended; entries to the
  left of it are caller-supplied and ignored. Turn the flag on only when there
  really is a proxy writing that header, or a caller can name any identity it
  likes. With the flag off the identity is the socket peer, which behind a
  proxy is one shared address for every visitor.

The size of the worst case: a v4 charge on mainnet cost 0.100 STRK in fees
(tx `0x24a7234…`, block 13,613,601). At the default cap of 24 charges per UTC
day, the endpoint's ceiling is about 2.4 STRK of gas a day, and it can only
reach that ceiling if the subscription actually has 24 periods come due, which
on the hourly ladder takes 24 hours. The realistic burn is one charge an hour.

What it does NOT defend against: someone who can read the keeper box's
filesystem. The key is the keeper's key. This endpoint adds no new custody, but
it does put a network listener on the same machine, so bind it to localhost and
put the tunnel in front (see Deploy).

## Configuration

Everything is an environment variable. The repo `.env` is parsed as a fallback,
the same line-regex way `scripts/keeper.mjs` parses it; real environment
variables win.

The account is NOT configured by value. Following the keeper convention, the
address and the private key are read from files outside the repo, and the
variables below only name the path:

| Variable | Default | What |
|---|---|---|
| `STARKNET_RPC` | required | RPC node URL |
| `NIGHTSHIFT_VAULT` | required | vault address (v4: `0x171e8e0b…`) |
| `NIGHTSHIFT_DEMO_COMMITMENTS` | required | comma-separated felts, the ONLY commitments this endpoint will charge. Alias: `DEMO_COMMITMENTS` |
| `NIGHTSHIFT_ACCOUNT_ADDRESS_FILE` | `~/.nightshift/acct2.address` | path to the submitting account's address |
| `NIGHTSHIFT_ACCOUNT_KEYPAIR_FILE` | `~/.nightshift/acct2.keypair` | path to the keypair file the key is parsed out of |
| `NIGHTSHIFT_DEMO_SIGNER` | `starknet` | `starknet` for the real signer, `mock` for a local run with no key and no network |
| `NIGHTSHIFT_DEMO_HOST` | `127.0.0.1` | bind address; leave it on loopback |
| `NIGHTSHIFT_DEMO_PORT` | `8788` | bind port |
| `NIGHTSHIFT_DEMO_COOLDOWN_S` | `900` | per-IP seconds between two real charges |
| `NIGHTSHIFT_DEMO_PROBE_COOLDOWN_S` | `5` | per-IP seconds between any two requests |
| `NIGHTSHIFT_DEMO_MAX_PER_DAY` | `24` | hard cap on real transactions per UTC day |
| `NIGHTSHIFT_DEMO_SETTLE_WINDOW_S` | `300` | how long a submitted tx keeps answering for its period |
| `NIGHTSHIFT_DEMO_SECONDS_PER_BLOCK` | `1.7` | for the `eta_minutes` estimate only; measured 1.71 s/block over the 2100 blocks to 13,650,015 |
| `NIGHTSHIFT_DEMO_STATE_FILE` | `~/.nightshift/demo-charge-state.json` | where the daily counter is persisted, so a restart is not a way to buy 24 more charges |
| `NIGHTSHIFT_DEMO_ORIGINS` | `https://nightshift-six-lilac.vercel.app` | comma-separated CORS allowlist |
| `NIGHTSHIFT_DEMO_TRUST_PROXY` | `false` | set to `1` only when a tunnel or reverse proxy sets `x-forwarded-for`. With it on, the caller's identity is the RIGHTMOST entry, the one the proxy appended. With it off, every visitor behind a proxy shares one IP and the per-IP cooldown means nothing |

No variable, log line, response body, or state file in this directory ever holds
a private key.

## Responses

| Shape | HTTP |
|---|---|
| `{"status":"submitted","tx_hash":"0x…","voyager_url":"https://voyager.online/tx/0x…"}` | 200 |
| `{"status":"not_due","next_due_block":13652100,"eta_minutes":60}` | 200 |
| `{"status":"rate_limited","retry_after_s":870}` | 429 |
| `{"status":"budget_exhausted"}` | 503 |
| `{"status":"error","reason":"one short sentence"}` | 400 |

The same `{"status":"error","reason":…}` shape also carries the transport-level
refusals: 404 for an unknown route, 405 for a non-POST on `/charge`, 415 when
the request's content-type is not `application/json`, 400 for a malformed
request target or a body over 1024 bytes, and 500 if anything in the request
path throws.

`POST /charge` requires `content-type: application/json`. `text/plain`,
`multipart/form-data` and `application/x-www-form-urlencoded` are CORS simple
request types, so a page on any origin could fire one from a visitor's browser
with no preflight; demanding JSON forces the preflight that
`NIGHTSHIFT_DEMO_ORIGINS` is there to refuse.

A body larger than 1024 bytes is refused with a 400, not with a reset
connection. An oversized `content-length` is caught before a byte is read; a
body that overruns mid-stream has its 400 written first and the socket closed
afterwards, so the caller reads the reason either way.

`reason` is drawn from a fixed list. A node error, a stack, an RPC URL, the
submitting account's address and the key file's path can never reach a caller:
`safeReason` in `src/decide.mjs` recognises the vault's named asserts and
collapses everything else to one generic line. That is the only path to a
response body: the top-level catch around the request handler and the
process-level `unhandledRejection`/`uncaughtException` handlers all go through
it, and the process stays up rather than exiting on a bad request.

## Rail order

1. **Whitelist.** A commitment that is not in `DEMO_COMMITMENTS` is refused
   before the signer is touched and before any RPC call.
2. **Per-IP probe cooldown.** Bounds how fast one caller can make the process
   talk to the RPC node.
3. **Per-IP charge cooldown.** Bounds how often one caller can make it spend gas.
   Only consumed on a real submit, so a `not_due` answer costs the visitor
   nothing.
4. **Daily budget.** A UTC-day counter, persisted across restarts.
5. **Chain preflight.** `schedule_of` and `tier_of` against the head block,
   mirroring the vault's own `charge` conditions. A not-due request returns the
   next due block and an eta without submitting anything.
6. **Per-period lock.** Two visitors pressing in the same second produce one
   transaction; the second gets the first's hash. A visitor arriving in the
   minute after, while `next_period` has not advanced on chain yet, gets the same
   hash from the settle-window memo.
7. **Estimate.** `estimateInvokeFee` before the invoke, per CLAUDE.md.
8. **Submit.**

## Layout

```
demo-charge/
  server.mjs          node:http plumbing, CORS, body limit, timeouts, persistence
  src/decide.mjs      every decision, as pure functions. No network, no clock.
  src/handler.mjs     one request start to finish, transport-free
  src/config.mjs      env parsing
  src/chain.mjs       the injected signer/reader: starknetChain and mockChain
  test/               node --test, no network, no key
```

`test/server.test.mjs` boots server.mjs as a child process on loopback with the
mock signer, so the header and request-target cases have somewhere to live.
Running the tests needs Node 21 or newer, which is what `engines` pins: the
repo-root `test:demo-charge` script passes a glob to `node --test`, and glob
patterns arrived in the test runner in 21.

`src/chain.mjs` is the only file that imports `starknet`, and the handler takes
it as a parameter. That is why the tests can cover the whole rail without a
socket.

## Run it locally

With no key and no network:

```sh
cd demo-charge
NIGHTSHIFT_DEMO_SIGNER=mock \
NIGHTSHIFT_DEMO_COMMITMENTS=0x3e4a525134a558e7fbabcd62895b879752274308ff618efdb2f20249c053c4a \
STARKNET_RPC=unused \
NIGHTSHIFT_VAULT=0x171e8e0bb905c899b9d1ad5c02aefe96a5d0b6d5f093f0ee80707b592417f8e \
NIGHTSHIFT_DEMO_STATE_FILE=/tmp/demo-charge-state.json \
node server.mjs
```

```sh
curl -s localhost:8788/health
curl -s -X POST localhost:8788/charge -H 'content-type: application/json' \
  -d '{"commitment":"0x3e4a525134a558e7fbabcd62895b879752274308ff618efdb2f20249c053c4a"}'
```

The mock chain starts one period due, advances its own head block at mainnet
cadence, and mirrors the vault's bookkeeping on a submit, so the second press
behaves the way mainnet would.

Tests:

```sh
cd demo-charge && node --test
```

## Deploy: TODO, needs human sign-off

Everything below writes to mainnet or exposes a port, so per CLAUDE.md it is not
done by an agent. Left deliberately undone:

- [ ] **A chargeable demo subscription.** The only v4 commitment
      (`0x3e4a525…`) is cancelled with zero escrow, so this endpoint has nothing
      to charge. A new `subscribe` on the hourly ladder (`period_blocks = 2100`)
      has to go through the pool first. Its commitment becomes
      `NIGHTSHIFT_DEMO_COMMITMENTS`.
- [ ] **Point the config at it** and confirm `GET /health` and one
      `POST /charge` from the keeper box before anything is exposed.
- [ ] **Expose it.** Bind stays on `127.0.0.1`; a tunnel gives it a stable
      hostname. Set `NIGHTSHIFT_DEMO_TRUST_PROXY=1` at the same time, or the
      per-IP cooldown collapses into a single global one.
- [ ] **Supervise it.** A systemd unit or equivalent, with the environment in
      the unit file, not in the repo.
- [ ] **Confirm the gas runway.** The submitting account held 499.4 STRK at
      block 13,650,294; a charge costs about 0.1 STRK.
- [ ] **Then, and only then, the button.** No file under `site/` is touched by
      this change.
