// The detail pages (board, verifier, ledger) were built on this masthead.
// It now renders the product header, so they wear the same chrome as every
// other screen without each of them being rewritten. The chip and badge
// slots are kept: a detail page still says which block it read.

import { AppHeader, Wordmark as ShellWordmark } from "./shell/header";

export type NavKey = "board" | "subscribe" | "manage" | "verify" | "creator" | "dashboard";

export const Wordmark = ShellWordmark;

export function Masthead({
  chip,
  badge,
}: {
  active?: NavKey;
  chip?: React.ReactNode;
  badge?: React.ReactNode;
  heading?: boolean;
}) {
  return (
    <AppHeader
      cta={
        chip || badge ? (
          <span className="hidden items-center gap-2 md:flex">
            {badge}
            {chip}
          </span>
        ) : undefined
      }
    />
  );
}
