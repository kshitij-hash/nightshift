// The close, and the footer under it.
//
// One filled primary on the whole page, and it is here. The creator path is
// equal in reach and quieter in fill, because two filled buttons would make the
// choice for a reader who has not made it yet. The verifier link is quieter
// again: a verifier arriving at this page was sent here by someone else and is
// not choosing a path at all.

import { Link } from "@tanstack/react-router";

import { truncate, VAULT, VOYAGER_CONTRACT } from "../../config";
import { HashCopy } from "../board/primitives";
import { Button } from "../ui/button";

export function ClosingCTAs({ compact }: { compact: boolean }) {
  return (
    <div className="flex flex-col gap-4">
      <div
        className={
          compact ? "flex flex-col gap-3" : "flex flex-wrap items-center gap-4"
        }
      >
        <Button variant="default" size="lg" asChild className={compact ? "w-full" : undefined}>
          <Link to="/manage">
            start a private subscription <span aria-hidden="true">→</span>
          </Link>
        </Button>
        <Button variant="outline" size="lg" asChild className={compact ? "w-full" : undefined}>
          <Link to="/creator">
            set up as a creator <span aria-hidden="true">→</span>
          </Link>
        </Button>
        <Link
          to="/verify"
          className={`inline-flex min-h-11 items-center text-[12.5px] text-text-label hover:text-ns-accent md:min-h-6 ${
            compact ? "" : "ml-2"
          }`}
        >
          or verify a subscription you were shown
        </Link>
      </div>
      <p className="max-w-[100ch] text-[11px] leading-[1.5] text-text-caption">
        One filled primary on the page, and this is it. The creator path is equal in reach and
        quieter in fill, because two filled buttons would make the choice for a reader who has not
        made it yet.
      </p>
    </div>
  );
}

export function LandingFooter({ snapshot }: { snapshot: boolean }) {
  return (
    <footer className="mt-8 flex flex-wrap items-center justify-between gap-5 border-t border-border-hairline bg-surface-sunken px-5 py-5 lg:px-14">
      <p className="text-[12px] leading-[1.5] text-text-caption">
        vault <HashCopy value={VAULT} display={truncate(VAULT)} className="text-[12px]" /> ·{" "}
        <a href={`${VOYAGER_CONTRACT(VAULT)}#events`} target="_blank" rel="noreferrer">
          every charge verifiable on voyager ↗
        </a>{" "}
        ·{" "}
        {snapshot
          ? "this render used committed data, not a key"
          : "no key was used to render this page"}
      </p>
      <div className="flex flex-wrap items-center gap-5 text-[12px]">
        <a
          href="https://github.com/kshitij-hash/nightshift"
          target="_blank"
          rel="noreferrer"
          className="inline-flex min-h-11 items-center text-text-label hover:text-ns-accent md:min-h-6"
        >
          github ↗
        </a>
        <a
          href="https://www.npmjs.com/package/nightshift-verify"
          target="_blank"
          rel="noreferrer"
          className="inline-flex min-h-11 items-center text-text-label hover:text-ns-accent md:min-h-6"
        >
          npm nightshift-verify ↗
        </a>
        <a
          href="https://www.npmjs.com/package/strk20-preflight"
          target="_blank"
          rel="noreferrer"
          className="inline-flex min-h-11 items-center text-text-label hover:text-ns-accent md:min-h-6"
        >
          npm strk20-preflight ↗
        </a>
        <Link to="/board" className="inline-flex min-h-11 items-center md:min-h-6">
          the board
        </Link>
      </div>
    </footer>
  );
}
