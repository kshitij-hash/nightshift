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

/** felt252 as it shows up in a URL: 0x-prefixed hex, unpadded. */
const FELT_HEX = /^0x[0-9a-fA-F]+$/;

export type BoardSearch = { demo?: boolean };
export type CreatorSearch = {
  creator?: string;
  /** Set when ?creator= was present but failed FELT_HEX, so the page can
   *  say what was wrong instead of silently acting as if nothing was pasted. */
  invalidCreator?: string;
};

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
    return FELT_HEX.test(raw) ? { creator: raw } : { invalidCreator: raw };
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
