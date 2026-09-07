// Code-based TanStack Router setup.
//
// The product has six screens: the door (/), join (/join), your nights
// (/nights), unlock (/unlock), start earning (/start) and your room (/room),
// plus Receipts (/receipts) for the curious. The three detail pages under it
// (/board, /verify, /creator) are reachable from Receipts and nowhere in the
// nav. The old addresses forward, so links already handed out still work.

import {
  Outlet,
  createRootRoute,
  createRoute,
  createRouter,
  redirect,
} from "@tanstack/react-router";

import { BoardRoute } from "./routes/board";
import { CreatorRoute } from "./routes/creator";
import { HomeRoute } from "./routes/home";
import { JoinRoute } from "./routes/join";
import { NightsRoute } from "./routes/nights";
import { NotFoundRoute } from "./routes/not-found";
import { ReceiptsRoute } from "./routes/receipts";
import { RoomRoute } from "./routes/room";
import { StartRoute } from "./routes/start";
import { UnlockRoute } from "./routes/unlock";
import { VerifyRoute } from "./routes/verify";

function RootLayout() {
  return <Outlet />;
}

const rootRoute = createRootRoute({ component: RootLayout });

/** felt252 as it shows up in a URL: 0x-prefixed hex, unpadded, at most 64
 *  digits. The upper bound is what makes BigInt() safe on anything that got
 *  through. */
const FELT_HEX = /^0x[0-9a-fA-F]{1,64}$/;

export type BoardSearch = { demo?: boolean };

const readDemo = (raw: unknown): boolean =>
  raw === true || raw === 1 || raw === "true" || raw === "1";

export type CreatorSearch = {
  creator?: string;
  invalidCreator?: string;
};

export const splitCreatorIds = (raw: string | undefined): string[] =>
  raw === undefined
    ? []
    : raw
        .split(",")
        .map((part) => part.trim())
        .filter((part) => part.length > 0);

/** ?creator= carries the id a share link was built around. Anything that is
 *  not a felt is dropped: a mangled link degrades to the blank form. */
export type JoinSearch = { creator?: string };

const readCreator = (search: Record<string, unknown>): JoinSearch => {
  const raw = search.creator;
  if (typeof raw === "string" && FELT_HEX.test(raw.trim())) return { creator: raw.trim() };
  return {};
};

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  validateSearch: (search: Record<string, unknown>): BoardSearch => {
    if (search.demo !== undefined && readDemo(search.demo)) return { demo: true };
    return {};
  },
  beforeLoad: ({ search }) => {
    if (search.demo === true) throw redirect({ to: "/board", search: { demo: true } });
  },
  component: HomeRoute,
});

const joinRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/join",
  validateSearch: readCreator,
  component: JoinRoute,
});

const nightsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/nights",
  component: NightsRoute,
});

/** ?c= carries a challenge a door handed over, URL-encoded JSON. Anything
 *  else is ignored; the page has a paste box. */
export type UnlockSearch = { c?: string };

const unlockRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/unlock",
  validateSearch: (search: Record<string, unknown>): UnlockSearch => {
    // The door puts the challenge JSON in ?c=. TanStack's default search
    // parser JSON-parses any value that looks like JSON, so a challenge object
    // arrives here already parsed; a value it could not parse arrives as a
    // string. Recover the challenge text from either shape, so the unlock
    // page opens with the door's message filled in rather than "[object
    // Object]".
    const raw = search.c;
    if (typeof raw === "string" && raw.length > 0 && raw.length < 4000) return { c: raw };
    if (raw !== null && typeof raw === "object") {
      try {
        const text = JSON.stringify(raw);
        if (text.length > 2 && text.length < 4000) return { c: text };
      } catch {
        // an object that will not stringify is not a challenge
      }
    }
    return {};
  },
  component: UnlockRoute,
});

const startRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/start",
  component: StartRoute,
});

const roomRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/room",
  component: RoomRoute,
});

const receiptsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/receipts",
  component: ReceiptsRoute,
});

// --- the detail pages, kept, unlisted ---------------------------------------

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

// --- the old addresses forward ------------------------------------------------

const subscribeRedirect = createRoute({
  getParentRoute: () => rootRoute,
  path: "/subscribe",
  validateSearch: readCreator,
  beforeLoad: ({ search }) => {
    throw redirect({ to: "/join", search: search.creator ? { creator: search.creator } : {} });
  },
});

const manageRedirect = createRoute({
  getParentRoute: () => rootRoute,
  path: "/manage",
  beforeLoad: () => {
    throw redirect({ to: "/nights" });
  },
});

const registerRedirect = createRoute({
  getParentRoute: () => rootRoute,
  path: "/creator/register",
  beforeLoad: () => {
    throw redirect({ to: "/start" });
  },
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  joinRoute,
  nightsRoute,
  unlockRoute,
  startRoute,
  roomRoute,
  receiptsRoute,
  boardRoute,
  creatorRoute,
  verifyRoute,
  subscribeRedirect,
  manageRedirect,
  registerRedirect,
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
