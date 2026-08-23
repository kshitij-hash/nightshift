// The connect state machine.
//
// Five states, and every one of them keeps the read surfaces open, because
// none of them has anything to do with the read surfaces: the board, the
// creator dashboard and verify never ask this hook anything. Connecting is a
// user action here and nowhere else. There is no silent reconnect on mount,
// no eager permission probe, and no wallet call before a click.

import { useCallback, useMemo, useState } from "react";

import { STRK } from "../../config";
import { WalletError, connect, type Connection } from "../../lib/wallet/bridge";
import { identityFor, storedKeyState, type PublicIdentity } from "../../lib/wallet/keys";

export type ConnectStatus = "idle" | "connecting" | "connected" | "error" | "unsupported";

export type ConnectFailure = {
  kind: WalletError["kind"];
  message: string;
  detail: string | null;
};

export type ConnectionState = {
  status: ConnectStatus;
  connection: Connection | null;
  identity: PublicIdentity | null;
  failure: ConnectFailure | null;
  /** True when this connect created the master secret rather than reading one
   *  that was already on this machine. The page says which happened. */
  keysCreated: boolean;
};

const IDLE: ConnectionState = {
  status: "idle",
  connection: null,
  identity: null,
  failure: null,
  keysCreated: false,
};

export function useConnection() {
  const [state, setState] = useState<ConnectionState>(IDLE);

  const start = useCallback(async () => {
    setState({ ...IDLE, status: "connecting" });
    try {
      const connection = await connect();
      if (!connection.capability.poolActions) {
        setState({
          ...IDLE,
          status: "unsupported",
          connection,
          failure: {
            kind: "capability-missing",
            message: "this requires a Ready wallet",
            detail: connection.capability.detail,
          },
        });
        return;
      }
      // Key material is read or created here, after a deliberate connect, and
      // never on page load.
      const before = storedKeyState();
      const identity = identityFor(connection.address, STRK);
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
        status: err.kind === "no-wallet" || err.kind === "capability-missing" ? "unsupported" : "error",
        failure: { kind: err.kind, message: err.message, detail: err.detail },
      });
    }
  }, []);

  const disconnect = useCallback(() => setState(IDLE), []);

  return useMemo(() => ({ state, start, disconnect }), [state, start, disconnect]);
}
