// Code-based TanStack Router setup. File-based routing needs a Vite plugin
// to generate the route tree; code-based routing needs nothing extra and
// this app only has three routes, so code-based is the simpler choice here.
//
// Typed search-param schemas are the reason TanStack Router was chosen over
// a plainer alternative: ?creator= and ?demo= are validated here, once, and
// every consumer downstream gets a typed, already-checked value instead of
// re-parsing location.search.
import { Outlet, createRootRoute, createRoute, createRouter } from "@tanstack/react-router";

import { BoardRoute } from "./routes/board";
import { CreatorRoute } from "./routes/creator";
import { VerifyRoute } from "./routes/verify";

// Each route owns its own masthead, because the masthead carries page state
// the frame cannot know: the chain chip, the snapshot badge, the sentence that
// describes that surface. The root layout is the page frame and nothing else,
// which also keeps exactly one h1 on every page.
function RootLayout() {
  return (
    <div className="flex min-h-screen flex-col">
      <Outlet />
    </div>
  );
}

const rootRoute = createRootRoute({ component: RootLayout });

/** felt252 as it shows up in a URL: 0x-prefixed hex, unpadded, at most 64
 *  digits. The upper bound is load-bearing: it is what makes BigInt() safe to
 *  call on any value that got through. */
const FELT_HEX = /^0x[0-9a-fA-F]{1,64}$/;

export type BoardSearch = { demo?: boolean };
export type CreatorSearch = {
  /** One id, or several separated by commas. A creator running more than one
   *  registration reads their own local sum by listing them here; the ids are
   *  linked in this URL and nowhere on chain. */
  creator?: string;
  /** Whatever was present and failed FELT_HEX, so the page can say what was
   *  wrong instead of acting as if nothing was pasted. Both fields can be set
   *  at once, when a list mixes usable ids with unusable ones. */
  invalidCreator?: string;
};

/** Split ?creator= into its entries. Empty entries drop out, so a trailing
 *  comma is not an id. */
export const splitCreatorIds = (raw: string | undefined): string[] =>
  raw === undefined
    ? []
    : raw
        .split(",")
        .map((part) => part.trim())
        .filter((part) => part.length > 0);

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  validateSearch: (search: Record<string, unknown>): BoardSearch => {
    const raw = search.demo;
    if (raw === undefined) return {};
    // The router parses search values, so ?demo=1 arrives as the number 1 and
    // ?demo=true as the boolean. Accept every spelling a person would type.
    return { demo: raw === true || raw === 1 || raw === "true" || raw === "1" };
  },
  component: BoardRoute,
});

const creatorRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/creator",
  validateSearch: (search: Record<string, unknown>): CreatorSearch => {
    const raw = search.creator;
    if (typeof raw !== "string" || raw.length === 0) return {};
    const good: string[] = [];
    const bad: string[] = [];
    // Deduplicated by value, not by string: 0x396c and 0x0396c are one id, and
    // reading it twice would double every sum this page prints.
    const seen = new Set<string>();
    for (const part of splitCreatorIds(raw)) {
      if (!FELT_HEX.test(part)) {
        bad.push(part);
        continue;
      }
      const key = BigInt(part).toString();
      if (seen.has(key)) continue;
      seen.add(key);
      good.push(part);
    }
    const out: CreatorSearch = {};
    if (good.length > 0) out.creator = good.join(",");
    if (bad.length > 0) out.invalidCreator = bad.join(",");
    return out;
  },
  component: CreatorRoute,
});

const verifyRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/verify",
  component: VerifyRoute,
});

const routeTree = rootRoute.addChildren([indexRoute, creatorRoute, verifyRoute]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
