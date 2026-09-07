// The 404, in the product's own voice. The Vercel rewrite hands every unknown
// path to the app, so this is the only 404 a visitor ever sees.

import { Link } from "@tanstack/react-router";

import { Column, Display, Kicker, Page } from "../components/shell/page";
import { usePageTitle } from "../lib/use-title";

export function NotFoundRoute() {
  usePageTitle("Not found");
  return (
    <Page>
      <main className="flex flex-1 flex-col justify-center py-20">
        <Column className="ad-enter flex flex-col gap-5">
          <Kicker>404</Kicker>
          <Display size="lg" className="max-w-[14ch]">
            Nothing here after dark.
          </Display>
          <p className="max-w-[44ch] text-[16px] leading-[1.6] text-dim">
            The link is wrong or the room closed. If a creator sent it, ask them for a fresh one.
          </p>
          <div className="flex flex-wrap gap-3 pt-2">
            <Link to="/" className="ad-pill ad-pill-ghost">
              Back to the door
            </Link>
            <Link to="/join" className="ad-pill ad-pill-quiet">
              I have a link
            </Link>
          </div>
        </Column>
      </main>
    </Page>
  );
}
