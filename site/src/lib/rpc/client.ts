// A small JSON-RPC caller with endpoint failover. No SDK, no keys, no state
// beyond which endpoint answered last.
//
// What it does that a bare fetch does not:
//   - fails over across RPC_URLS instead of dying on the first bad endpoint
//   - bounds every attempt with a 10s AbortController timeout, so one hung
//     endpoint cannot wedge a whole page load
//   - retries each endpoint once with jitter, since public nodes rate-limit in
//     bursts and a straight retry from every reader lands in the same burst
//   - refuses any method outside a read-only allow list
//
// The allow list is not a security boundary against a hostile caller in the
// same bundle; it is a guard against a future edit accidentally sending a write
// method (starknet_addInvokeTransaction and friends) from a page that holds no
// keys and must never ask a wallet for one.

import { RPC_URLS } from "../../config";

/** Read-only Starknet RPC methods this layer is allowed to send. */
const READ_METHODS = new Set([
  "starknet_blockNumber",
  "starknet_blockHashAndNumber",
  "starknet_call",
  "starknet_chainId",
  "starknet_getBlockWithTxHashes",
  "starknet_getBlockWithTxs",
  "starknet_getEvents",
  "starknet_getNonce",
  "starknet_getStorageAt",
  "starknet_getTransactionByHash",
  "starknet_getTransactionReceipt",
  "starknet_specVersion",
  "starknet_syncing",
]);

export const DEFAULT_TIMEOUT_MS = 10_000;

export type RpcClientOptions = {
  /** Endpoints tried in order. Defaults to RPC_URLS from config. */
  urls?: readonly string[];
  /** Per-attempt timeout. Defaults to 10s. */
  timeoutMs?: number;
  /** Extra attempts per endpoint after the first. Defaults to 1. */
  retries?: number;
  /** Injectable for tests. Defaults to globalThis.fetch. */
  fetchImpl?: typeof fetch;
};

/** Carries every endpoint failure, so a caller can report which node said what
 *  instead of a bare "request failed". */
export class RpcFailure extends Error {
  readonly attempts: ReadonlyArray<{ url: string; error: string }>;
  constructor(method: string, attempts: ReadonlyArray<{ url: string; error: string }>) {
    super(
      `${method}: every endpoint failed (${attempts
        .map((a) => `${a.url}: ${a.error}`)
        .join("; ")})`,
    );
    this.name = "RpcFailure";
    this.attempts = attempts;
  }
}

export type RpcClient = {
  /** Send one read-only JSON-RPC call, failing over across endpoints. */
  call<T>(method: string, params: unknown): Promise<T>;
  /** The endpoint that answered the last successful call, or null. */
  lastGoodUrl(): string | null;
  /** The endpoints this client will try, in order. */
  readonly urls: readonly string[];
};

const jitteredDelay = () => 150 + Math.floor(Math.random() * 350);
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function once(
  fetchImpl: typeof fetch,
  url: string,
  method: string,
  params: unknown,
  timeoutMs: number,
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`http ${res.status}`);
    const json = (await res.json()) as { result?: unknown; error?: unknown };
    if (json.error) throw new Error(JSON.stringify(json.error));
    return json.result;
  } finally {
    clearTimeout(timer);
  }
}

export function createRpcClient(options: RpcClientOptions = {}): RpcClient {
  const urls = options.urls ?? RPC_URLS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const retries = options.retries ?? 1;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (urls.length === 0) throw new Error("createRpcClient: no endpoints");

  let lastGood: string | null = null;

  async function call<T>(method: string, params: unknown): Promise<T> {
    if (!READ_METHODS.has(method)) {
      throw new Error(`${method}: not a read-only method this client will send`);
    }
    const attempts: { url: string; error: string }[] = [];
    // Start with whatever answered last: a healthy endpoint stays first in line
    // for the rest of the page's life.
    const ordered = lastGood
      ? [lastGood, ...urls.filter((u) => u !== lastGood)]
      : [...urls];

    for (const url of ordered) {
      for (let attempt = 0; attempt <= retries; attempt += 1) {
        try {
          const result = await once(fetchImpl, url, method, params, timeoutMs);
          lastGood = url;
          return result as T;
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          attempts.push({ url, error: attempt === 0 ? msg : `retry: ${msg}` });
          if (attempt < retries) await sleep(jitteredDelay());
        }
      }
    }
    throw new RpcFailure(method, attempts);
  }

  return { call, lastGoodUrl: () => lastGood, urls: [...urls] };
}
