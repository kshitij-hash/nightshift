// The footer repeats the one line that matters most on a page like this: what
// rendered it. Real links only.

import { Link } from "@tanstack/react-router";

import { truncate, VAULT, VOYAGER_CONTRACT } from "../../config";
import { HashCopy } from "./primitives";

export function BoardFooter({ snapshot }: { snapshot: boolean }) {
  return (
    <footer className="mt-8 flex flex-wrap items-center justify-between gap-5 border-t border-border-hairline bg-surface-sunken px-5 py-5 lg:px-14">
      <p className="text-[12px] leading-[1.5] text-text-caption">
        vault <HashCopy value={VAULT} display={truncate(VAULT)} className="text-[12px]" /> ·{" "}
        <a href={`${VOYAGER_CONTRACT(VAULT)}#events`} target="_blank" rel="noreferrer">
          every row verifiable on voyager ↗
        </a>{" "}
        · {snapshot ? "this render used committed data, not a key" : "no key was used to render this page"}
      </p>
      <div className="flex flex-wrap items-center gap-5 text-[12px]">
        <a
          href="https://www.npmjs.com/package/nightshift-verify"
          target="_blank"
          rel="noreferrer"
          className="inline-flex min-h-6 items-center text-text-label hover:text-ns-accent"
        >
          npm nightshift-verify ↗
        </a>
        <a
          href="https://www.npmjs.com/package/strk20-preflight"
          target="_blank"
          rel="noreferrer"
          className="inline-flex min-h-6 items-center text-text-label hover:text-ns-accent"
        >
          npm strk20-preflight ↗
        </a>
        <a
          href="https://github.com/kshitij-hash/nightshift"
          target="_blank"
          rel="noreferrer"
          className="inline-flex min-h-6 items-center text-text-label hover:text-ns-accent"
        >
          source on github ↗
        </a>
        <Link to="/verify" className="inline-flex min-h-6 items-center">
          verify a tier presentation
        </Link>
      </div>
    </footer>
  );
}
