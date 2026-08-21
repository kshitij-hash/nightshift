// On-chain constants. Everything the page shows is derived from these plus
// live RPC reads — no backend, no keys.

export const POOL =
  "0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a";
/** v4: paid-window gate semantics, owner_key_of, nonce-consumed public claim.
 *  The live vault. */
export const VAULT =
  "0x171e8e0bb905c899b9d1ad5c02aefe96a5d0b6d5f093f0ee80707b592417f8e";
/** v3: superseded; its four receipts stay in strk20.json and on the board. */
export const VAULT_V3 =
  "0x277519c8bc1031188313de4528d1f0159319f8f86651422e89b6fbd920b3759";
/** v2: superseded, but its receipts are the banked strk20.json txs — the
 *  board keeps decoding its history. */
export const VAULT_V2 =
  "0x01f653f21e557e70384c8631f9c8f97e0342aa1d5e975bdcaca76bbf8715f338";
export const STRK =
  "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";

/** Public RPC endpoints, tried in order. */
export const RPC_URLS = [
  "https://rpc.starknet.lava.build",
  "https://starknet-mainnet.public.blastapi.io/rpc/v0_8",
];

/** Blocks the vaults were deployed at — event scans start here. */
export const VAULT_DEPLOY_BLOCK = 13_613_300; // v4, deployed at 13,613,373
export const VAULT_V3_DEPLOY_BLOCK = 13_606_900;
export const VAULT_V2_DEPLOY_BLOCK = 13_554_000;

/** ~seconds per Starknet mainnet block (~1.7s at current cadence), for the
 *  NEXT CHARGE countdown estimate only. The charge itself is block-gated. */
export const SECONDS_PER_BLOCK = 1.7;

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
