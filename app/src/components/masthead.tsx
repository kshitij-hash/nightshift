// The masthead every surface shares: the wordmark, one plain sentence about
// what this is, the bracketed nav, and the theme toggle. The chip on the right
// belongs to whichever page can say something true about the chain right now.

import { Link } from "@tanstack/react-router";

import { ThemeToggle } from "./theme-toggle";

const GITHUB = "https://github.com/kshitij-hash/nightshift";

type NavKey = "dashboard" | "verify" | "github";

function Bracketed({
  active,
  children,
  to,
  href,
}: {
  active: boolean;
  children: string;
  to?: "/creator" | "/verify";
  href?: string;
}) {
  const color = active ? "text-ns-accent" : "text-text-label hover:text-ns-accent";
  const inner = `${color} transition-colors duration-[var(--dur-fast)] ease-[var(--ease-out)]`;
  return (
    <span className="inline-flex items-center text-[12px] leading-none">
      <span className="text-text-caption">[</span>
      {to ? (
        <Link to={to} className={`${inner} inline-flex min-h-11 items-center px-1 md:min-h-6 md:px-0.5`}>
          {children}
        </Link>
      ) : (
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          className={`${inner} inline-flex min-h-11 items-center px-1 md:min-h-6 md:px-0.5`}
        >
          {children}
        </a>
      )}
      <span className="text-text-caption">]</span>
    </span>
  );
}

export function Masthead({
  active,
  sentence,
  right,
  chip,
  badge,
}: {
  active?: NavKey;
  sentence: string;
  /** The caption on the right of the sentence rule. */
  right?: string;
  chip?: React.ReactNode;
  badge?: React.ReactNode;
}) {
  return (
    <header className="flex flex-col">
      <div className="flex flex-wrap items-center justify-between gap-4 px-5 pt-5 pb-4 lg:px-14">
        <div className="flex flex-wrap items-center gap-4">
          <h1
            className="text-[20px] leading-[1.2] font-semibold text-text-strong"
            style={{ letterSpacing: "0.06em" }}
          >
            NIGHTSHIFT
          </h1>
          {badge}
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <nav className="flex items-center gap-3" aria-label="sections">
            <Bracketed active={active === "dashboard"} to="/creator">
              dashboard
            </Bracketed>
            <Bracketed active={active === "verify"} to="/verify">
              verify
            </Bracketed>
            <Bracketed active={active === "github"} href={GITHUB}>
              github
            </Bracketed>
          </nav>
          {chip}
          <ThemeToggle />
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border-hairline px-5 py-3 lg:px-14">
        <p className="text-[13px] leading-[1.7] text-text-default">{sentence}</p>
        {right ? <span className="text-[10px] leading-[1.45] text-text-caption">{right}</span> : null}
      </div>
    </header>
  );
}
