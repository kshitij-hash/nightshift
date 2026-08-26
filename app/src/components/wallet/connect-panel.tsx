// Connect, as a state machine rather than a button.
//
// Five states, one on screen at a time: IDLE, CONNECTING, CONNECTED, REJECTED,
// and the two that mean this browser cannot sign at all (no wallet injected,
// or a wallet without the pool calls). Each one says what is still possible,
// because in this product almost everything is: reading needs no wallet.

import { truncate } from "../../lib/wallet/core";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { CharacterReveal, DashSpinner, StatusDot } from "./primitives";
import type { ConnectionState } from "./use-connection";

/** Said once, in the one state where a reader has no way to press on: no
 *  wallet is injected, so the rest of the site is what is left. Every other
 *  state has a button, and a button does not need an apology under it. */
const READ_PATHS =
  "The board, the creator dashboard and the verify page read mainnet with no wallet at all. A wallet is needed only to change something: subscribe, cancel, reclaim, claim.";

function Frame({
  tag,
  tagTone,
  dot,
  children,
}: {
  tag: string;
  tagTone: "plain" | "accent" | "fail";
  dot: React.ReactNode;
  children: React.ReactNode;
}) {
  const tagClass =
    tagTone === "accent"
      ? "text-ns-accent"
      : tagTone === "fail"
        ? "text-destructive"
        : "text-text-label";
  return (
    <div className="flex flex-col gap-3 border border-border-panel px-5 py-5">
      <div className="flex items-center gap-2">
        {dot}
        <span className={`text-[11px] font-medium tracking-[0.16em] ${tagClass}`}>{tag}</span>
      </div>
      {children}
    </div>
  );
}

export function ConnectPanel({
  state,
  onConnect,
  onDisconnect,
}: {
  state: ConnectionState;
  onConnect: () => void;
  onDisconnect: () => void;
}) {
  if (state.status === "connecting") {
    return (
      <Frame tag="REQUESTING CAPABILITY" tagTone="accent" dot={<DashSpinner />}>
        <p className="text-[13px] leading-[1.6] text-text-prose">
          Asking the wallet for permission to build private transactions. The
          prompt is in the wallet, not on this page.
        </p>
        <Button variant="ghost" size="md" disabled className="w-full">
          connecting
        </Button>
      </Frame>
    );
  }

  if (state.status === "connected" && state.connection) {
    const { connection, identity } = state;
    return (
      <Frame tag="CONNECTED" tagTone="accent" dot={<StatusDot state="live" beat />}>
        <p className="font-mono text-[14px] text-text-strong">
          {/* keyed by the address so a different account replays the reveal
              rather than showing a stale one */}
          <CharacterReveal key={connection.address} text={truncate(connection.address)} />
        </p>
        <p className="text-[11px] text-text-caption">
          {connection.walletName} · {connection.capability.detail}
        </p>
        {identity ? (
          <p className="text-[11px] text-text-caption">
            {state.keysCreated
              ? "your subscription keys were just created and stored in this browser. This is their only copy, and they are what cancels a subscription later."
              : "using the subscription keys already stored in this browser."}
          </p>
        ) : null}
        <Button variant="ghost" size="md" onClick={onDisconnect} className="w-full">
          disconnect
        </Button>
      </Frame>
    );
  }

  if (state.status === "unsupported") {
    const noWallet = state.failure?.kind === "no-wallet";
    return (
      <Frame
        tag={noWallet ? "NO WALLET INJECTED" : "NO PRIVACY API"}
        tagTone="plain"
        dot={<StatusDot state="pending" />}
      >
        <p className="text-[13px] leading-[1.6] text-text-prose">
          {noWallet
            ? "No Starknet wallet was found in this browser. NIGHTSHIFT needs a Ready wallet to build private transactions."
            : "The connected wallet cannot build private transactions. NIGHTSHIFT needs a Ready wallet."}
        </p>
        {state.failure?.detail ? (
          <p className="border-l-2 border-border-field pl-3 text-[11px] leading-[1.55] text-text-caption">
            {state.failure.detail}
          </p>
        ) : null}
        <a href="https://ready.co" target="_blank" rel="noreferrer" className="text-[12px]">
          ready.co
        </a>
        {noWallet ? (
          <p className="text-[11px] leading-[1.5] text-text-caption">{READ_PATHS}</p>
        ) : null}
        <Button variant="ghost" size="md" onClick={onConnect} className="w-full">
          try again
        </Button>
      </Frame>
    );
  }

  if (state.status === "error") {
    const kind = state.failure?.kind;
    return (
      <Frame
        tag={kind === "rejected" ? "REJECTED" : kind === "network-mismatch" ? "WRONG NETWORK" : "FAILED"}
        tagTone="fail"
        dot={<StatusDot state="fail" />}
      >
        <p className="text-[13px] leading-[1.6] text-destructive">
          {state.failure?.message ?? "the connection did not complete"}
        </p>
        {state.failure?.detail ? (
          <p className="border-l-2 border-destructive pl-3 text-[11px] leading-[1.55] text-text-caption">
            {state.failure.detail}
          </p>
        ) : null}
        <p className="text-[13px] leading-[1.6] text-text-prose">
          Nothing was signed and nothing was sent.
        </p>
        <Button variant="ghost" size="md" onClick={onConnect} className="w-full">
          connect a wallet
        </Button>
      </Frame>
    );
  }

  return (
    <Frame tag="NOT CONNECTED" tagTone="plain" dot={<StatusDot state="pending" />}>
      <p className="text-[13px] leading-[1.6] text-text-prose">
        Nothing is requested until this button is pressed.
      </p>
      <Button variant="default" size="md" onClick={onConnect} className="w-full">
        connect a wallet
      </Button>
      <p className="text-[11px] text-text-caption">
        requires a Ready wallet
      </p>
    </Frame>
  );
}

/** The public halves of the derived identity, shown once connected. Secrets
 *  are not passed to this component and there is no code path that could
 *  render one. */
export function IdentityPanel({ state }: { state: ConnectionState }) {
  const id = state.identity;
  if (!id) return null;
  return (
    <div className="flex flex-col gap-3 border border-border-panel px-5 py-5">
      <div className="flex flex-wrap items-center gap-3">
        <Badge variant="outline">DERIVED IDENTITY</Badge>
        <span className="text-[11px] text-text-caption">public halves only</span>
      </div>
      <dl className="grid grid-cols-[minmax(0,8.5rem)_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-[12px]">
        <dt className="text-text-label">creator id</dt>
        <dd className="min-w-0 break-all text-text-default">{truncate(id.creatorId)}</dd>
        <dt className="text-text-label">commitment</dt>
        <dd className="min-w-0 break-all text-text-strong">{truncate(id.commitment)}</dd>
        <dt className="text-text-label">owner pubkey</dt>
        <dd className="min-w-0 break-all text-text-default">{truncate(id.ownerPub)}</dd>
        <dt className="text-text-label">payout pubkey</dt>
        <dd className="min-w-0 break-all text-text-default">{truncate(id.payoutPub)}</dd>
      </dl>
      <p className="text-[11px] leading-[1.55] text-text-caption">
        Everything above is public and ends up on chain. The secrets behind it stay in this
        browser, and each creator gets its own derived key so no two subscriptions share one.
      </p>
      {id.legacyOwnerPub ? (
        <p className="text-[11px] leading-[1.55] text-text-caption">
          This machine also holds one older stored owner key, from before keys were derived per
          commitment. A subscription made in that era can only be cancelled with it.
        </p>
      ) : null}
    </div>
  );
}
