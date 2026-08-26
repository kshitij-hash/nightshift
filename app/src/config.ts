// On-chain constants. Everything the page shows is derived from these plus
// live RPC reads - no backend, no keys.

export const POOL =
  "0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a";
/** v4: paid-window gate semantics, owner_key_of, nonce-consumed public claim.
 *  The live vault. */
export const VAULT =
  "0x171e8e0bb905c899b9d1ad5c02aefe96a5d0b6d5f093f0ee80707b592417f8e";
/** v3: superseded; its four receipts stay in strk20.json and on the board. */
export const VAULT_V3 =
  "0x277519c8bc1031188313de4528d1f0159319f8f86651422e89b6fbd920b3759";
/** v2: superseded, but its receipts are the banked strk20.json txs - the
 *  board keeps decoding its history. */
export const VAULT_V2 =
  "0x01f653f21e557e70384c8631f9c8f97e0342aa1d5e975bdcaca76bbf8715f338";
/** The tier gate that reads the v4 vault. Emits Presented; exposes the
 *  `presentable` entitlement read. */
export const GATE =
  "0x4361699018454536ba97aacc85a6ec4ffb974e869335781490021ab5f872f5e";
export const STRK =
  "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";

/** A dedicated endpoint for this deployment, when one is configured:
 *  VITE_RPC_URL in Vercel's env (or .env.local in dev) carries a keyed
 *  provider URL whose key is origin-allowlisted to this site. Read with
 *  optional chaining so the node test bundles, where import.meta.env does
 *  not exist, fall through to the public endpoints. */
const CONFIGURED_RPC = (
  (import.meta as { env?: Record<string, string | undefined> }).env?.VITE_RPC_URL ?? ""
).trim();

/** RPC endpoints, tried in order: the configured one first when present,
 *  then the public keyless pair as failover. */
export const RPC_URLS = [
  ...(CONFIGURED_RPC !== "" ? [CONFIGURED_RPC] : []),
  "https://rpc.starknet.lava.build",
  "https://starknet-mainnet.public.blastapi.io/rpc/v0_8",
];

/** Blocks the vaults were deployed at - event scans start here. */
export const VAULT_DEPLOY_BLOCK = 13_613_300; // v4, deployed at 13,613,373
export const VAULT_V3_DEPLOY_BLOCK = 13_606_900;
export const VAULT_V2_DEPLOY_BLOCK = 13_554_000;

/** ~seconds per Starknet mainnet block (~1.7s at current cadence), for the
 *  NEXT CHARGE countdown estimate only. The charge itself is block-gated. */
export const SECONDS_PER_BLOCK = 1.7;

/** The demo creator registered on the live vault: one tier at 1 STRK per
 *  period. The subscribe wizard offers it as a one-click start so a visitor
 *  without a creator id can walk the whole flow against real mainnet state. */
export const DEMO_CREATOR_ID =
  "0x396c007ff97561b1eadf59540c71944f6ad2ccfbfc7116254f1a34d869205df";

/** The v4 lifecycle receipts, one per verb - the same six the README lists.
 *  Every landing claim links one of these. */
export const RECEIPTS: Array<{ verb: string; hash: string }> = [
  { verb: "subscribe", hash: "0x79ab57d364b8d8118256103c017232a031f493312f8fca4176b4e9d5090ac86" },
  { verb: "charge", hash: "0x24a723437c0f91cc9bc7d917c458908d3f1c90039ac0a5f9f1b3c7e4a06778b" },
  { verb: "present", hash: "0x30191636301463f89c9686a7426fa2489429024a562bd4c0da7693837d502de" },
  { verb: "claim", hash: "0x51099d3247f6681f049038ab1044e5c644956b333696e263a740a04880943b1" },
  { verb: "cancel", hash: "0x5474c1ec9d302a884fe9341c071861b579728767973bee147b358416580df5f" },
  { verb: "reclaim", hash: "0x401b3a4fb23f53ce988247af54072d1bbed4c140be4c09a05a3f0fce7f832b1" },
];

export const VOYAGER_TX = (hash: string) => `https://voyager.online/tx/${hash}`;
export const VOYAGER_CONTRACT = (addr: string) =>
  `https://voyager.online/contract/${addr}`;

export const truncate = (hex: string, lead = 6, tail = 6) => {
  const h = hex.startsWith("0x") ? hex.slice(2) : hex;
  const padded = h.padStart(64, "0");
  return `0x${padded.slice(0, lead)}…${padded.slice(-tail)}`;
};

export const fmtBlock = (n: number | bigint) =>
  Number(n).toLocaleString("en-US");

export const fmtStrk = (wei: bigint, decimals = 2) => {
  const whole = wei / 10n ** 18n;
  const frac = (wei % 10n ** 18n) / 10n ** BigInt(18 - decimals);
  return `${whole}.${frac.toString().padStart(decimals, "0")}`;
};

export const utc = (tsSeconds: number) => {
  const d = new Date(tsSeconds * 1000);
  const p = (x: number) => String(x).padStart(2, "0");
  return {
    date: `${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`,
    time: `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`,
  };
};
