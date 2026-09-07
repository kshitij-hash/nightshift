// One wallet session for the whole app.
//
// The chip in every header, the connect sheet, and every flow that signs read
// the same state from here. Connecting is still a click and nothing else: no
// probe on load, no wallet call before a person asks. The one exception is a
// resume, and only when a previous click set the flag that asks for it.
//
// The wallet stack (starknet.js, the discovery store, the key module) is
// loaded on the first connect, never with the page: the landing and the
// receipts page cost nothing for a signing stack they do not use.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { STRK } from "../../config";
import type { Connection, WalletErrorKind } from "./bridge";
import type { PublicIdentity } from "./keys";

const RECONNECT_KEY = "nightshift.wallet.reconnect";

export type ConnectStatus = "idle" | "connecting" | "connected" | "error" | "unsupported";

export type ConnectFailure = { kind: WalletErrorKind; message: string; detail: string | null };

export type SessionState = {
  status: ConnectStatus;
  connection: Connection | null;
  identity: PublicIdentity | null;
  failure: ConnectFailure | null;
  /** True when this connect created the keys rather than finding them. */
  keysCreated: boolean;
};

const IDLE: SessionState = {
  status: "idle",
  connection: null,
  identity: null,
  failure: null,
  keysCreated: false,
};

/** Connected and able to sign: the pair every flow needs. */
export type Ready = { connection: Connection; identity: PublicIdentity };

type Session = {
  state: SessionState;
  ready: Ready | null;
  start: () => Promise<void>;
  disconnect: () => void;
  sheetOpen: boolean;
  openSheet: () => void;
  closeSheet: () => void;
};

const SessionContext = createContext<Session | null>(null);

export function WalletProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState>(IDLE);
  const [sheetOpen, setSheetOpen] = useState(false);

  const start = useCallback(async () => {
    setState({ ...IDLE, status: "connecting" });
    try {
      const [{ connect, WalletError }, { identityFor, storedKeyState }] = await Promise.all([
        import("./bridge"),
        import("./keys"),
      ]);
      try {
        const connection = await connect();
        if (!connection.capability.poolActions) {
          setState({
            ...IDLE,
            status: "unsupported",
            connection,
            failure: {
              kind: "capability-missing",
              message: "This wallet cannot pay privately yet.",
              detail: connection.capability.detail,
            },
          });
          return;
        }
        const before = storedKeyState();
        const identity = identityFor(connection.address, STRK);
        try {
          localStorage.setItem(RECONNECT_KEY, "1");
        } catch {
          // storage refused; the session still works, it just will not resume
        }
        setState({
          status: "connected",
          connection,
          identity,
          failure: null,
          keysCreated: !before.secret || !before.payout,
        });
      } catch (e) {
        const err = e instanceof WalletError ? e : new WalletError("failed", String(e));
        setState({
          ...IDLE,
          status:
            err.kind === "no-wallet" || err.kind === "capability-missing" ? "unsupported" : "error",
          failure: { kind: err.kind, message: err.message, detail: err.detail },
        });
      }
    } catch (e) {
      setState({
        ...IDLE,
        status: "error",
        failure: { kind: "failed", message: "The wallet code could not load.", detail: String(e) },
      });
    }
  }, []);

  const disconnect = useCallback(() => {
    try {
      localStorage.removeItem(RECONNECT_KEY);
    } catch {
      // nothing to clear
    }
    setState(IDLE);
  }, []);

  // Resume a session a previous click granted. Deferred a tick and guarded so
  // a strict-mode double mount resumes exactly once.
  const resumed = useRef(false);
  useEffect(() => {
    const id = window.setTimeout(() => {
      if (resumed.current) return;
      resumed.current = true;
      let wants = false;
      try {
        wants = localStorage.getItem(RECONNECT_KEY) === "1";
      } catch {
        wants = false;
      }
      if (wants) void start();
    }, 0);
    return () => window.clearTimeout(id);
  }, [start]);

  const openSheet = useCallback(() => setSheetOpen(true), []);
  const closeSheet = useCallback(() => setSheetOpen(false), []);

  const value = useMemo<Session>(
    () => ({
      state,
      ready:
        state.status === "connected" && state.connection && state.identity
          ? { connection: state.connection, identity: state.identity }
          : null,
      start,
      disconnect,
      sheetOpen,
      openSheet,
      closeSheet,
    }),
    [state, start, disconnect, sheetOpen, openSheet, closeSheet],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useWallet(): Session {
  const ctx = useContext(SessionContext);
  if (ctx === null) throw new Error("useWallet needs a WalletProvider above it");
  return ctx;
}
