// Code-based TanStack Router setup. File-based routing needs a Vite plugin
// to generate the route tree; code-based routing needs nothing extra and
// this app only has three routes, so code-based is the simpler choice here.
//
// Typed search-param schemas are the reason TanStack Router was chosen over
// a plainer alternative: ?creator= and ?demo= are validated here, once, and
// every consumer downstream gets a typed, already-checked value instead of
// re-parsing location.search.
import { Link, Outlet, createRootRoute, createRoute, createRouter } from "@tanstack/react-router";

import { ThemeToggle } from "./components/theme-toggle";
import { BoardRoute } from "./routes/board";
import { CreatorRoute } from "./routes/creator";
import { VerifyRoute } from "./routes/verify";

function RootLayout() {
  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-border-hairline px-4 h-12 flex items-center justify-between shrink-0">
        <nav className="flex items-center gap-5 text-[13px] font-medium">
          <span className="tracking-[0.06em] text-text-strong">NIGHTSHIFT</span>
          <Link
            to="/"
            activeOptions={{ exact: true }}
            activeProps={{ className: "text-text-strong" }}
            className="text-text-label hover:text-text-default transition-colors"
          >
            BOARD
          </Link>
          <Link
            to="/creator"
            activeProps={{ className: "text-text-strong" }}
            className="text-text-label hover:text-text-default transition-colors"
          >
            CREATOR
          </Link>
          <Link
            to="/verify"
            activeProps={{ className: "text-text-strong" }}
            className="text-text-label hover:text-text-default transition-colors"
          >
            VERIFY
          </Link>
        </nav>
        <ThemeToggle />
      </header>
      <main className="flex-1">
        <Outlet />
      </main>
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
    return { demo: raw === true || raw === "true" || raw === "1" };
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
