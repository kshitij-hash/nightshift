// The footer repeats the one claim this page rests on: every figure above is
// re-derivable from the event log by anyone, without this page. Real links
// only, and the ids the reader asked for, spelled out so the URL can be
// rebuilt by hand.

import { Link } from "@tanstack/react-router";

import { truncate, VAULT, VOYAGER_CONTRACT } from "../../config";
import { HashCopy } from "../board/primitives";

export function DashboardFooter({ ids }: { ids: string[] }) {
  return (
    <footer className="mt-12 flex flex-wrap items-center justify-between gap-5 border-t border-border-hairline bg-surface-sunken px-5 py-5 lg:px-14">
      <p className="flex flex-wrap items-center gap-x-1.5 text-[12px] leading-[1.5] text-text-caption">
        {ids.length > 0 ? (
          <>
            <span>{ids.length === 1 ? "creator" : `creators (${ids.length})`}</span>
            {ids.map((id) => (
              <HashCopy key={id} value={id} display={truncate(id)} className="text-[12px]" />
            ))}
            <span>·</span>
          </>
        ) : null}
        <span>vault</span>
        <HashCopy value={VAULT} display={truncate(VAULT)} className="text-[12px]" />
        <span>·</span>
        <a href={`${VOYAGER_CONTRACT(VAULT)}#events`} target="_blank" rel="noreferrer">
          every figure re-derivable from the event log ↗
        </a>
        <span>· no key was used to render this page</span>
      </p>
      <div className="flex flex-wrap items-center gap-5 text-[12px]">
        <a
          href="https://www.npmjs.com/package/nightshift-verify"
          target="_blank"
          rel="noreferrer"
          className="inline-flex min-h-11 items-center text-text-label hover:text-ns-accent md:min-h-6"
        >
          npm nightshift-verify ↗
        </a>
        <Link to="/" className="inline-flex min-h-11 items-center md:min-h-6">
          the evidence board
        </Link>
      </div>
    </footer>
  );
}
