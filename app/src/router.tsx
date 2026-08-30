// Code-based TanStack Router setup. File-based routing needs a Vite plugin
// to generate the route tree; code-based routing needs nothing extra and
// this app only has five routes, so code-based is the simpler choice here.
//
// Typed search-param schemas are the reason TanStack Router was chosen over
// a plainer alternative: ?creator=, ?demo=, ?for= and ?tab= are validated here,
// once, and every consumer downstream gets a typed, already-checked value
// instead of re-parsing location.search.
import {
  Outlet,
  createRootRoute,
  createRoute,
  createRouter,
  redirect,
} from "@tanstack/react-router";

import { BoardRoute } from "./routes/board";
import { CreatorRoute } from "./routes/creator";
import { LandingRoute } from "./routes/landing";
import { ManageRoute } from "./routes/manage";
import { NotFoundRoute } from "./routes/not-found";
import { RegisterRoute } from "./routes/register";
import { SubscribeRoute } from "./routes/subscribe";
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

/** Which persona the landing's router opens on. In the URL so a link handed to
 *  a creator does not land them on the subscriber's story. */
export type PersonaId = "subscribe" | "creator" | "verify";
export type LandingSearch = { for?: PersonaId };

/** ?demo= arrives parsed: the router turns ?demo=1 into the number 1 and
 *  ?demo=true into the boolean. Accept every spelling a person would type. */
const readDemo = (raw: unknown): boolean =>
  raw === true || raw === 1 || raw === "true" || raw === "1";

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

// The landing. It also answers for the board's old address: the board lived at
// / until the restructure, and ?demo=1 is in the recorded demo plan and in
// links already handed out, so /?demo=1 forwards to /board?demo=1 instead of
// opening a landing page with a search param it has no use for.
const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  validateSearch: (search: Record<string, unknown>): LandingSearch & BoardSearch => {
    const raw = search.for;
    const out: LandingSearch & BoardSearch = {};
    if (raw === "creator" || raw === "verify" || raw === "subscribe") out.for = raw;
    if (search.demo !== undefined && readDemo(search.demo)) out.demo = true;
    return out;
  },
  beforeLoad: ({ search }) => {
    if (search.demo === true) throw redirect({ to: "/board", search: { demo: true } });
  },
  component: LandingRoute,
});

const boardRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/board",
  validateSearch: (search: Record<string, unknown>): BoardSearch => {
    if (search.demo === undefined) return {};
    return { demo: readDemo(search.demo) };
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

/** ?creator= carries the id a creator's share link was built around, so a
 *  subscriber who followed that link lands with the field already filled.
 *  Anything that is not a felt is dropped rather than surfaced: a mangled
 *  share link should degrade to the blank form, not to an error page. */
export type SubscribeSearch = { creator?: string };

const subscribeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/subscribe",
  validateSearch: (search: Record<string, unknown>): SubscribeSearch => {
    const raw = search.creator;
    if (typeof raw === "string" && FELT_HEX.test(raw.trim())) return { creator: raw.trim() };
    return {};
  },
  component: SubscribeRoute,
});

// The creator's entry into the product: register a tier ladder, get an id and
// a share link. Its own route (not a mode of /creator) because it carries the
// wallet stack the ledger deliberately never loads, and because "become a
// creator" is a destination worth linking to directly.
const registerRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/creator/register",
  component: RegisterRoute,
});

/** Which of the three signing flows is open, when one is. Optional, because
 *  /manage's subject is the reader's own subscriptions and the flows are the
 *  action layer under them: a bare /manage opens the list, not a form. Present
 *  in the URL so a flow can be linked to and so a reload lands back on it. */
export type ManageTab = "subscribe" | "cancel" | "claim";
export type ManageSearch = { tab?: ManageTab };

const manageRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/manage",
  validateSearch: (search: Record<string, unknown>): ManageSearch => {
    const raw = search.tab;
    if (raw === "cancel" || raw === "claim" || raw === "subscribe") return { tab: raw };
    return {};
  },
  component: ManageRoute,
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  boardRoute,
  creatorRoute,
  registerRoute,
  manageRoute,
  subscribeRoute,
  verifyRoute,
]);

export const router = createRouter({
  routeTree,
  // The Vercel rewrite serves the app for every path, so this component is
  // the site's whole 404 story.
  defaultNotFoundComponent: NotFoundRoute,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
