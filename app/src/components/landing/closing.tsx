// The close.
//
// The three calls to action that used to stand here were the persona tabs'
// three calls to action a second time, 1500px further down, and a reader who
// had not chosen a path by then was not going to be helped by being offered
// the same three again. The persona tabs are the router. This is one line and
// the quiet link for the reader who was sent here by somebody else and is not
// choosing a path at all.

import { Link } from "@tanstack/react-router";

export function ClosingLine({ compact }: { compact: boolean }) {
  return (
    <div className={compact ? "flex flex-col gap-3" : "flex flex-wrap items-baseline gap-5"}>
      <p className="max-w-[76ch] text-[13.5px] leading-[1.7] text-text-prose">
        The three paths above are the way in, and everything under them is a mainnet read you can
        repeat without this page.
      </p>
      <Link
        to="/verify"
        className="inline-flex min-h-11 items-center text-[12.5px] text-text-label transition-colors ns-hover hover:text-ns-accent md:min-h-6"
      >
        or verify a subscription you were shown
      </Link>
    </div>
  );
}
