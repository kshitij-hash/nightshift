// The footer every surface shares.
//
// One anatomy, three pages. On the left, what rendered this page: the vault,
// a link that opens its event log on Voyager, and the line saying no key was
// involved. On the right, the real links out. The three pages differ in three
// small ways and in nothing else, so those three are props and the rest is
// here once: the dashboard prefixes the creator ids it was keyed by, the
// board and the landing swap the key line for a snapshot line when the render
// came from committed data, and each page carries its own set of links.
//
// This was the same forty lines maintained in three files, which is how the
// board ended up with 24px tap targets on a phone while the other two had 44.

import { Link } from "@tanstack/react-router";

import { truncate, VAULT, VOYAGER_CONTRACT } from "../config";
import { cn } from "../lib/utils";
import { HashCopy } from "./board/primitives";

/** A route this footer is allowed to link to. Typed against the router rather
 *  than left as a string, so a renamed route breaks the build here. */
type FooterRoute = "/board" | "/verify";

export type FooterLink =
  | { label: string; href: string }
  | { label: string; to: FooterRoute };

/** 44px on a phone, 24px once there is a pointer. The same rule the masthead's
 *  bracketed nav uses. */
const LINK = "inline-flex min-h-11 items-center md:min-h-6";
const EXTERNAL = cn(LINK, "text-text-label transition-colors ns-hover hover:text-ns-accent");

export function SiteFooter({
  links,
  ids,
  snapshot = false,
  voyagerLabel = "verify on voyager",
  className,
}: {
  /** The right-hand row, in the order this page wants them. */
  links: FooterLink[];
  /** The creator ids this page was keyed by, spelled out so the URL can be
   *  rebuilt by hand. The dashboard is the only surface with any. */
  ids?: string[];
  /** The read fell back to committed data, so this render did not touch the
   *  chain and should not claim it read one. */
  snapshot?: boolean;
  /** The landing calls the same link something longer, because on that page it
   *  is the first invitation to check anything. */
  voyagerLabel?: string;
  className?: string;
}) {
  return (
    <footer
      className={cn(
        "mt-8 flex flex-wrap items-center justify-between gap-5 border-t border-border-hairline bg-surface-sunken px-5 py-5 lg:px-14",
        className,
      )}
    >
      <p className="flex flex-wrap items-center gap-x-1.5 text-[12px] leading-[1.5] text-text-caption">
        {ids && ids.length > 0 ? (
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
          {voyagerLabel} ↗
        </a>
        <span>
          ·{" "}
          {snapshot
            ? "this render used committed data, not a key"
            : "no key was used to render this page"}
        </span>
      </p>
      <div className="flex flex-wrap items-center gap-5 text-[12px]">
        {links.map((l) =>
          "href" in l ? (
            <a key={l.label} href={l.href} target="_blank" rel="noreferrer" className={EXTERNAL}>
              {l.label} ↗
            </a>
          ) : (
            <Link key={l.label} to={l.to} className={LINK}>
              {l.label}
            </Link>
          ),
        )}
      </div>
    </footer>
  );
}
