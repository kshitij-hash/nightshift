// The connect sheet: one sheet, three moments. Slides up over any screen,
// never a separate page. Choose a wallet, confirm in it, you're in.

import * as DialogPrimitive from "@radix-ui/react-dialog";

import { useWallet } from "../../lib/wallet/session";
import { shortId } from "../../lib/format";
import { MaskedAvatar } from "./avatar";

const READY_INSTALL = "https://www.ready.co";

function Spinner() {
  return (
    <svg width="64" height="64" viewBox="0 0 72 72" fill="none" aria-hidden="true">
      <circle cx="36" cy="36" r="32" stroke="var(--ad-line)" strokeWidth="4" />
      <path
        d="M36 4a32 32 0 0 1 32 32"
        stroke="var(--ad-rose)"
        strokeWidth="4"
        strokeLinecap="round"
        style={{ transformOrigin: "36px 36px", animation: "ns-spin 1000ms linear infinite" }}
      />
    </svg>
  );
}

export function ConnectSheet() {
  const { state, ready, start, disconnect, sheetOpen, closeSheet } = useWallet();

  const body = (() => {
    if (state.status === "connecting") {
      return (
        <div className="flex flex-col items-center gap-5 text-center">
          <Spinner />
          <div className="flex flex-col gap-1.5">
            <DialogPrimitive.Title className="ad-display text-[24px]">Confirm in your wallet</DialogPrimitive.Title>
            <DialogPrimitive.Description className="max-w-[30ch] text-[14px] leading-[1.55] text-dim">
              Approve once. Nothing is charged by connecting.
            </DialogPrimitive.Description>
          </div>
          <p className="text-[12px] text-faint">Usually under a minute.</p>
        </div>
      );
    }
    if (ready) {
      return (
        <div className="flex flex-col items-center gap-5 text-center">
          <div className="ad-pop">
            <MaskedAvatar size={88} tone="filled" />
          </div>
          <div className="flex flex-col gap-1.5">
            <DialogPrimitive.Title className="ad-display text-[28px]">You're in.</DialogPrimitive.Title>
            <DialogPrimitive.Description className="max-w-[30ch] text-[14px] leading-[1.55] text-dim">
              {state.keysCreated
                ? "This browser now holds the key that can cancel your nights. It never leaves."
                : "Your wallet pays. It never introduces you."}
            </DialogPrimitive.Description>
          </div>
          <div className="flex items-center gap-2">
            <span className="ad-chip ad-chip-rose" style={{ cursor: "default" }}>
              Ready · <span className="normal-case">{shortId(ready.connection.address)}</span>
            </span>
          </div>
          <button type="button" className="ad-pill ad-pill-primary ad-pill-block" onClick={closeSheet}>
            Continue
          </button>
          <button
            type="button"
            className="ad-pill ad-pill-quiet"
            onClick={() => {
              disconnect();
              closeSheet();
            }}
          >
            Disconnect
          </button>
        </div>
      );
    }
    if (state.status === "unsupported") {
      const noWallet = state.failure?.kind === "no-wallet";
      return (
        <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-1.5">
            <DialogPrimitive.Title className="ad-display text-[24px]">
              {noWallet ? "Bring a wallet" : "This wallet can't pay privately yet"}
            </DialogPrimitive.Title>
            <DialogPrimitive.Description className="text-[14px] leading-[1.55] text-dim">
              {noWallet
                ? "No Starknet wallet is installed in this browser. Ready sets up in about a minute and is the one that pays without introducing you."
                : "Only Ready can pay privately today. Install it, move your STRK across, and come back."}
            </DialogPrimitive.Description>
          </div>
          <a href={READY_INSTALL} target="_blank" rel="noreferrer" className="ad-pill ad-pill-primary ad-pill-block">
            Get Ready ↗
          </a>
          <button type="button" className="ad-pill ad-pill-ghost ad-pill-block" onClick={() => void start()}>
            Try again
          </button>
        </div>
      );
    }
    if (state.status === "error") {
      const rejected = state.failure?.kind === "rejected";
      const network = state.failure?.kind === "network-mismatch";
      return (
        <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-1.5">
            <span className="ad-kicker ad-kicker-dim">Didn't go through</span>
            <DialogPrimitive.Title className="ad-display text-[24px]">
              {rejected ? "No problem." : network ? "Wrong network." : "That didn't connect."}
            </DialogPrimitive.Title>
            <DialogPrimitive.Description className="text-[14px] leading-[1.55] text-dim">
              {rejected
                ? "You said no in the wallet, so nothing happened. Try again whenever."
                : network
                  ? "Switch the wallet to Starknet mainnet and try again."
                  : (state.failure?.message ?? "Nothing was signed and nothing was sent.")}
            </DialogPrimitive.Description>
          </div>
          <button type="button" className="ad-pill ad-pill-primary ad-pill-block" onClick={() => void start()}>
            Try again
          </button>
        </div>
      );
    }
    return (
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-1.5">
          <DialogPrimitive.Title className="ad-display text-[24px]">Bring a wallet</DialogPrimitive.Title>
          <DialogPrimitive.Description className="text-[14px] leading-[1.55] text-dim">
            It pays. It never introduces you.
          </DialogPrimitive.Description>
        </div>
        <button type="button" className="ad-option" onClick={() => void start()}>
          <span className="flex items-center gap-3">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-[#ff875b] text-[13px] font-[800] text-[#0e0c11]" style={{ fontFamily: "var(--font-heading)" }}>
              R
            </span>
            <span className="text-[16px] font-[700]" style={{ fontFamily: "var(--font-heading)" }}>
              Ready
            </span>
          </span>
          <span className="ad-mono text-[10px] tracking-[0.12em] text-rose">CONNECT</span>
        </button>
        <p className="text-center text-[12px] leading-[1.6] text-faint">
          New to this? Ready sets up in about a minute.
          <br />
          You hold the keys. We never do.
        </p>
      </div>
    );
  })();

  return (
    <DialogPrimitive.Root open={sheetOpen} onOpenChange={(o) => (o ? undefined : closeSheet())}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="ad-sheet-backdrop" />
        <DialogPrimitive.Content className="ad-sheet" aria-describedby={undefined}>
          <div className="ad-sheet-handle" />
          <div key={`${state.status}:${ready === null ? "no" : "yes"}`} className="ad-swap block">
            {body}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
