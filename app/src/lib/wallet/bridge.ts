// The wallet bridge: discovery, connect, capability detection, and the four
// ways this app asks a wallet to do something.
//
// Ported from the ops console (web/app.mjs), with two additions the console
// does not need because an operator is watching its log pane:
//
//   - capability detection up front, via wallet_supportedWalletApi. A wallet
//     that cannot build a pool action is told so by name, before a button
//     offers to build one.
//   - a chain check, so a wallet pointed at a testnet is caught here rather
//     than by a revert.
//
// Nothing in this module reads or writes key material. It moves already-built
// actions and already-made signatures across the wallet boundary.

import { RpcProvider, WalletAccountV6, constants, walletV6 } from "starknet";
import { createStore } from "@starknet-io/get-starknet-core";

import { RPC_URLS } from "../../config";
import { supportsPoolActions, type PoolAction, type PublicCall } from "./core";

/**
 * The wallet object the discovery store hands back.
 *
 * Deliberately opaque. Two copies of @starknet-io/get-starknet-wallet-standard
 * land in the tree, one under get-starknet-core and one under starknet, and
 * their WalletWithStarknetFeatures types are structurally incompatible even
 * though the runtime value is a single object. Rather than pin a duplicate
 * transitive dependency to make two type identities agree, this module treats
 * the wallet as a name plus a handle and casts once at each call boundary.
 * Those casts live in this file and nowhere else in the app.
 */
export type InjectedWallet = { name: string };

/** Every way a wallet interaction can end badly, as a closed set. The UI has a
 *  designed state for each one; an unclassified failure is "failed" and prints
 *  the wallet's own message rather than a guess. */
export type WalletErrorKind =
  | "no-wallet"
  | "rejected"
  | "capability-missing"
  | "network-mismatch"
  | "failed";

export class WalletError extends Error {
  readonly kind: WalletErrorKind;
  /** One extra line of specifics, already safe to render. */
  readonly detail: string | null;
  constructor(kind: WalletErrorKind, message: string, detail: string | null = null) {
    super(message);
    this.name = "WalletError";
    this.kind = kind;
    this.detail = detail;
  }
}

/** Classify whatever the wallet threw. Wallet API error 113 is USER_REFUSED_OP,
 *  which is a person saying no and not a failure to report as one. */
export const classify = (e: unknown): WalletError => {
  if (e instanceof WalletError) return e;
  const err = e as { code?: unknown; message?: unknown; data?: unknown };
  const message = typeof err?.message === "string" ? err.message : String(e);
  const code = typeof err?.code === "number" ? err.code : null;
  const detail =
    typeof err?.data === "string"
      ? err.data
      : err?.data !== undefined
        ? safeJson(err.data)
        : null;

  if (code === 113 || /USER_REFUSED|user (rejected|refused|denied)|reject/i.test(message)) {
    return new WalletError("rejected", "the wallet rejected this request", null);
  }
  if (code === 162 || /API_VERSION_NOT_SUPPORTED|not supported|unknown method/i.test(message)) {
    return new WalletError(
      "capability-missing",
      "this wallet does not answer the call this action needs",
      detail ?? message,
    );
  }
  if (code === 117 || code === 112 || /chain|network/i.test(message)) {
    return new WalletError("network-mismatch", "the wallet is not on Starknet mainnet", detail ?? message);
  }
  return new WalletError("failed", message, detail);
};

const safeJson = (v: unknown): string | null => {
  try {
    return JSON.stringify(v);
  } catch {
    return null;
  }
};

// --- discovery -------------------------------------------------------------

/** How long to give the wallet-standard store to answer its discovery event.
 *  The console waits the same 300ms. */
const DISCOVERY_MS = 300;

export type Discovered = { wallet: InjectedWallet; names: string[] };

/** The window keys an extension injects itself under, when it announces
 *  itself that way rather than through the wallet-standard event. */
const injectedOnWindow = (): InjectedWallet[] => {
  const out: InjectedWallet[] = [];
  for (const key of Object.keys(window)) {
    if (!key.startsWith("starknet")) continue;
    const candidate = (window as unknown as Record<string, unknown>)[key];
    if (candidate && typeof candidate === "object" && "name" in candidate) {
      out.push(candidate as InjectedWallet);
    }
  }
  return out;
};

/**
 * Find an injected wallet. Wallet-standard discovery first, then the window
 * keys an older extension announces itself under, which is the same order the
 * ops console uses and the same reason: one of the two paths answers, and
 * which one is not a thing to guess from the outside. A wallet whose name
 * mentions Ready wins, since it is the one that answers the pool calls.
 *
 * A headless browser and a browser with no extension both land in the same
 * place: no wallet, which the UI renders as its own designed state rather than
 * as an error.
 */
export const discover = async (): Promise<Discovered> => {
  const store = createStore();
  store._refreshInjectedWallets?.();
  await new Promise((r) => setTimeout(r, DISCOVERY_MS));
  const wallets = [
    ...(store.getWallets() as unknown as InjectedWallet[]),
    ...injectedOnWindow(),
  ];
  const names = wallets.map((w) => w.name);
  const pick = wallets.find((w) => /ready|argent/i.test(w.name)) ?? wallets[0];
  if (!pick) {
    throw new WalletError(
      "no-wallet",
      "no Starknet wallet is injected in this browser",
      names.length > 0 ? `discovered: ${names.join(", ")}` : null,
    );
  }
  return { wallet: pick, names };
};

// --- capability detection --------------------------------------------------

export type Capability = {
  /** Every wallet API version the wallet answers with. */
  versions: string[];
  /** Whether one of them is new enough for wallet_strk20PrepareInvoke. */
  poolActions: boolean;
  /** What to print when it is not. Already a sentence. */
  detail: string;
};

/**
 * Ask the wallet which API versions it speaks and decide from the answer, not
 * from its name. A wallet that refuses the question at all is treated as too
 * old, which is the honest reading: the method was added in the same era.
 */
export const capabilityOf = async (wallet: InjectedWallet): Promise<Capability> => {
  try {
    const versions = (await walletV6.supportedWalletApi(wallet as never)) as unknown as string[];
    const ok = supportsPoolActions(versions);
    return {
      versions,
      poolActions: ok,
      detail: ok
        ? `wallet API ${versions.join(", ")}`
        : `this wallet answers wallet API ${versions.join(", ")}; building a pool action needs 0.10.3 or newer`,
    };
  } catch {
    return {
      versions: [],
      poolActions: false,
      detail:
        "this wallet did not answer wallet_supportedWalletApi, so it predates the pool action calls",
    };
  }
};

// --- connect ---------------------------------------------------------------

export type Connection = {
  address: string;
  walletName: string;
  chainId: string;
  capability: Capability;
  /** Bound methods. Held here rather than exposing the account object, so no
   *  component can reach past this module into the wallet. */
  prepareInvoke: (actions: PoolAction[], simulate?: boolean) => Promise<PreparedBatch>;
  invokeTransaction: (actions: PoolAction[]) => Promise<string>;
  execute: (call: PublicCall) => Promise<string>;
  shieldedBalance: (token: string) => Promise<bigint>;
};

/** What strk20PrepareInvoke gives back: the pool call the wallet built, with
 *  its proof. Only the calldata is read here, to recover an open-note id. */
export type PreparedBatch = { calldata: string[] };

/**
 * Connect. This runs from a click and from nothing else: a page that connects
 * on load has decided for the reader that a wallet should be involved, and on
 * this product reading needs no wallet at all.
 */
export const connect = async (): Promise<Connection> => {
  const { wallet } = await discover();
  const provider = new RpcProvider({ nodeUrl: RPC_URLS[0] });

  let account: WalletAccountV6;
  try {
    // connect() is declared on WalletAccountV5 and inherited, so its declared
    // return type is the parent class; the runtime value is a V6 instance,
    // which is what carries the strk20 methods.
    account = (await WalletAccountV6.connect(provider, wallet as never)) as WalletAccountV6;
  } catch (e) {
    throw classify(e);
  }

  const capability = await capabilityOf(wallet);

  let chainId = "";
  try {
    chainId = await walletV6.requestChainId(wallet as never);
  } catch {
    chainId = "";
  }
  if (chainId !== "" && chainId !== constants.StarknetChainId.SN_MAIN) {
    throw new WalletError(
      "network-mismatch",
      "this wallet is not on Starknet mainnet",
      `the wallet reports chain ${chainId}; NIGHTSHIFT's vault is deployed on mainnet only`,
    );
  }

  return {
    address: account.address,
    walletName: wallet.name,
    chainId,
    capability,
    prepareInvoke: async (actions, simulate) => {
      if (!capability.poolActions) {
        throw new WalletError("capability-missing", "this wallet cannot build a pool action", capability.detail);
      }
      try {
        const prepared = await account.strk20PrepareInvoke(actions as never, simulate);
        const calldata = (prepared?.call?.calldata ?? []) as string[];
        return { calldata: calldata.map((x) => `0x${BigInt(x).toString(16)}`) };
      } catch (e) {
        throw classify(e);
      }
    },
    invokeTransaction: async (actions) => {
      if (!capability.poolActions) {
        throw new WalletError("capability-missing", "this wallet cannot submit a pool action", capability.detail);
      }
      try {
        const { transaction_hash } = await account.strk20InvokeTransaction(actions as never);
        return transaction_hash;
      } catch (e) {
        throw classify(e);
      }
    },
    execute: async (call) => {
      try {
        const { transaction_hash } = await account.execute(call);
        return transaction_hash;
      } catch (e) {
        throw classify(e);
      }
    },
    shieldedBalance: async (token) => {
      try {
        const entries = await account.strk20Balances([token as never]);
        const first = entries[0] as { balance?: string; amount?: string } | undefined;
        const raw = first?.balance ?? first?.amount ?? "0x0";
        return BigInt(raw);
      } catch (e) {
        throw classify(e);
      }
    },
  };
};
