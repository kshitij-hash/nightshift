// One vocabulary of refusals for every wallet interaction on this surface.
//
// The states are the same four everywhere, so they read the same everywhere:
// the person said no, the wallet cannot do this, the wallet is on the wrong
// chain, or something else failed and the wallet's own message is printed
// rather than paraphrased. A refusal always says what is still true.

import { WalletError, classify } from "../../lib/wallet/bridge";

export type Failure = {
  kind: WalletError["kind"];
  message: string;
  detail: string | null;
};

export const toFailure = (e: unknown): Failure => {
  const err = classify(e);
  return { kind: err.kind, message: err.message, detail: err.detail };
};

const HEADLINE: Record<WalletError["kind"], string> = {
  "no-wallet": "NO WALLET",
  rejected: "REJECTED IN WALLET",
  "capability-missing": "WALLET CANNOT DO THIS",
  "network-mismatch": "WRONG NETWORK",
  failed: "FAILED",
};

const GUIDANCE: Record<WalletError["kind"], string> = {
  "no-wallet": "Connect a Ready wallet and try again. Nothing was signed and nothing was sent.",
  rejected: "Nothing was signed and nothing was sent. Press the same button again to re-open the wallet prompt.",
  "capability-missing":
    "This action needs the pool calls a Ready wallet answers. Reading the chain still works without any wallet.",
  "network-mismatch":
    "Switch the wallet to Starknet mainnet. The vault and the gate are deployed there and nowhere else.",
  failed: "Nothing was submitted unless a transaction hash is shown above.",
};

export function FailureNote({ failure }: { failure: Failure }) {
  return (
    <div
      role="alert"
      className="flex flex-col gap-1.5 border-l-2 border-destructive bg-transparent py-1 pl-3"
    >
      <span className="text-[11px] font-medium tracking-[0.16em] text-destructive">
        {HEADLINE[failure.kind]}
      </span>
      <p className="text-[12px] leading-[1.55] break-words text-destructive">{failure.message}</p>
      {failure.detail ? (
        <p className="text-[11px] leading-[1.5] break-all text-text-caption">{failure.detail}</p>
      ) : null}
      <p className="text-[11px] leading-[1.5] text-text-caption">{GUIDANCE[failure.kind]}</p>
    </div>
  );
}
