// How money, time and ids read on the fan and creator surfaces.
//
// One rule: a person reads "3 STRK a week", never "3.00 STRK per period of
// 352800 blocks". The block arithmetic stays in lib/; these are the words.

import { SECONDS_PER_BLOCK, fmtStrk } from "../config";

/** "3", "3.5", "0.25": STRK without trailing zeros. */
export const strk = (wei: bigint): string => {
  const s = fmtStrk(wei, 2);
  return s.includes(".") ? s.replace(/\.?0+$/, "") : s;
};

export type CadenceWords = { one: string; many: string; per: string; blocks: number };

/** The vault's three period lengths, as people say them. */
export const CADENCE_WORDS: readonly CadenceWords[] = [
  { blocks: 352_800, one: "week", many: "weeks", per: "wk" },
  { blocks: 50_400, one: "day", many: "days", per: "day" },
  { blocks: 2100, one: "hour", many: "hours", per: "hr" },
];

export const cadenceOf = (blocks: number): CadenceWords | null =>
  CADENCE_WORDS.find((c) => c.blocks === blocks) ?? null;

/** "week", "weeks", from a block count. */
export const cadenceWord = (blocks: number, n = 1): string => {
  const c = cadenceOf(blocks);
  if (c === null) return n === 1 ? "period" : "periods";
  return n === 1 ? c.one : c.many;
};

/** "3 STRK / wk" */
export const priceLabel = (wei: bigint, blocks: number): string => {
  const c = cadenceOf(blocks);
  return `${strk(wei)} STRK / ${c ? c.per : "period"}`;
};

/** "12 weeks" */
export const spanLabel = (n: number, blocks: number): string =>
  `${n} ${cadenceWord(blocks, n)}`;

/** Tiers have no names on chain. These are the names the product gives the
 *  first three rungs, on the creator's side and the fan's alike. */
const TIER_NAMES = ["Night pass", "Inner room", "Back room"] as const;
export const tierName = (index: number): string => TIER_NAMES[index] ?? `Tier ${index + 1}`;

/** How many periods a fan can fund at once, per cadence. A short fixed menu,
 *  so a run length can never fingerprint the person who chose it. */
export const SPAN_OPTIONS: Record<number, readonly number[]> = {
  352_800: [4, 12, 24],
  50_400: [7, 14, 30],
  2100: [6, 12, 24],
};

/** A pasted share link, or a bare id: either way, the id. */
export const creatorFromInput = (raw: string): string => {
  const t = raw.trim();
  try {
    const url = new URL(t);
    const c = url.searchParams.get("creator");
    if (c) return c.trim();
  } catch {
    // not a URL; treat it as an id
  }
  return t;
};

/** 0x2e54…f43b: enough of a hash to recognise, never enough to read. */
export const shortId = (hex: string): string => {
  const body = (hex.startsWith("0x") ? hex.slice(2) : hex).padStart(64, "0");
  return `0x${body.slice(0, 4)}…${body.slice(-4)}`;
};

/** A creator has no name on chain, so the page gives each one a short handle
 *  from the end of its id. Stable, recognisable, and never a person. */
export const creatorHandle = (creatorId: string): string => {
  const body = (creatorId.startsWith("0x") ? creatorId.slice(2) : creatorId).padStart(64, "0");
  return `Creator ${body.slice(-4).toUpperCase()}`;
};

/** Seconds until a block, from the head the page last read. Estimated:
 *  the charge is block-gated, the countdown is a translation. */
export const secondsUntilBlock = (
  block: number,
  headBlock: number,
  headTimestamp: number,
  now: number,
): number => (block - headBlock) * SECONDS_PER_BLOCK - (now - headTimestamp);

/** "in 2 days", "in 9 hours", "in 41 min", "any moment". */
export const relativeSoon = (seconds: number): string => {
  if (seconds <= 60) return "any moment";
  const m = Math.round(seconds / 60);
  if (m < 60) return `in ${m} min`;
  const h = Math.round(seconds / 3600);
  if (h < 36) return `in ${h} hour${h === 1 ? "" : "s"}`;
  const d = Math.round(seconds / 86_400);
  return `in ${d} day${d === 1 ? "" : "s"}`;
};

/** "2D", "09H", "41M", "NOW": the chip form of the same estimate. */
export const relativeChip = (seconds: number): string => {
  if (seconds <= 60) return "NOW";
  const m = Math.round(seconds / 60);
  if (m < 60) return `${m}M`;
  const h = Math.round(seconds / 3600);
  if (h < 36) return `${String(h).padStart(2, "0")}H`;
  return `${Math.round(seconds / 86_400)}D`;
};

/** "Sep 05 · 18:03" in UTC, the receipts column. */
export const stamp = (tsSeconds: number): string => {
  const d = new Date(tsSeconds * 1000);
  const month = d.toLocaleString("en-US", { month: "short", timeZone: "UTC" });
  const p = (x: number) => String(x).padStart(2, "0");
  return `${month} ${p(d.getUTCDate())} · ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
};

/** Weekday name for a block estimate, "Fri". */
export const weekdayOf = (tsSeconds: number): string =>
  new Date(tsSeconds * 1000).toLocaleString("en-US", { weekday: "short", timeZone: "UTC" });
