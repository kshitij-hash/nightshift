// The 404, designed in the site's own voice. The Vercel rewrite hands every
// unknown path to the app, so this component is the only 404 a visitor ever
// sees; leaving it to the router's unstyled default would put the one page
// reached by mistake outside the design system.

import { Link } from "@tanstack/react-router";

import { Masthead } from "../components/masthead";
import { SiteFooter } from "../components/site-footer";
import { usePageTitle } from "../lib/use-title";

export function NotFoundRoute() {
  usePageTitle("Not found");
  return (
    <div className="flex min-h-screen flex-col">
      <Masthead heading={false} />
      <main className="flex flex-1 flex-col justify-center px-5 py-16 lg:px-10">
        <div className="mb-4 text-[11px] tracking-[0.16em] uppercase text-ns-accent">
          ▸ 404 · No page at this address
        </div>
        <h1 className="max-w-[16ch] text-[42px] leading-[0.98] tracking-[-0.035em] lg:text-[74px] lg:leading-[0.95]">
          Nothing is charged here.
        </h1>
        <p className="mt-6 mb-8 max-w-[52ch] text-[15px] leading-[1.6] text-text-prose">
          This address does not exist. Nothing was read, nothing was signed,
          and the pages that do exist are one click away.
        </p>
        <div className="flex flex-wrap gap-3">
          <Link to="/" className="m-btn m-btn-primary text-[15px]" style={{ padding: "13px 22px" }}>
            Back to the start →
          </Link>
          <Link to="/board" className="m-btn m-btn-secondary text-[15px]" style={{ padding: "13px 22px" }}>
            Watch the live board
          </Link>
        </div>
      </main>
      <SiteFooter
        className="mt-0"
        links={[{ label: "source on github", href: "https://github.com/kshitij-hash/nightshift" }]}
      />
    </div>
  );
}
