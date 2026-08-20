// NIGHTSHIFT ops console. Everything runs through the connected wallet's
// STRK20 API — no viewing key, no proof handling, nothing secret in this page.

import { RpcProvider, WalletAccountV6, hash } from "starknet";

const POOL = "0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a";
const VAULT = "0x01f653f21e557e70384c8631f9c8f97e0342aa1d5e975bdcaca76bbf8715f338";
const STRK = "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";
const ECHO = "0x078ae662e0cc6d1ab2cfeaf2a51ba8783d88e31886f88a794d142f95a6f8735b";
const E18 = 10n ** 18n;
// Wallet API addresses are PADDED_FELT: 0x + exactly 64 hex. Wallet-standard
// returns account.address unpadded, which fails the schema.
const pad = (a) => "0x" + BigInt(a).toString(16).padStart(64, "0");
// Calldata FELTs forbid leading zeros (unlike padded ADDRESS fields). Pass
// wallet placeholders (${...}) through untouched.
const cd = (x) => (typeof x === "string" && x.startsWith("${")) ? x : "0x" + BigInt(x).toString(16);

const $ = (id) => document.getElementById(id);
const logEl = $("log");
const logErr = (label, e) => {
  console.error(label, e);
  const parts = [e?.message];
  if (e?.code !== undefined) parts.push(`code=${e.code}`);
  if (e?.data) parts.push(`data=${typeof e.data === "string" ? e.data : JSON.stringify(e.data)}`);
  if (e?.cause) parts.push(`cause=${e.cause?.message ?? JSON.stringify(e.cause)}`);
  try { parts.push(`full=${JSON.stringify(e, Object.getOwnPropertyNames(e || {}))}`); } catch {}
  log(`${label}: ${parts.filter(Boolean).join(" | ")}`, "err");
};
const log = (msg, cls = "") => {
  const line = document.createElement("div");
  if (cls) line.className = cls;
  line.textContent = msg;
  logEl.appendChild(line);
  line.scrollIntoView();
};

let account; // WalletAccountV6

// The subscriber secret lives in localStorage on this machine only. The
// commitment poseidon(secret, creator_id) is what goes on-chain.
const secretKey = "nightshift.subscriber.secret";
const getSecret = () => {
  let s = localStorage.getItem(secretKey);
  if (!s) {
    const bytes = crypto.getRandomValues(new Uint8Array(31));
    s = "0x" + [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
    localStorage.setItem(secretKey, s);
    log(`new subscriber secret generated (kept in localStorage)`, "dim");
  }
  return s;
};

const creatorIdOf = (creatorAddr) =>
  hash.computePoseidonHashOnElements([creatorAddr, STRK]);
const commitmentOf = (creatorAddr) =>
  hash.computePoseidonHashOnElements([getSecret(), creatorIdOf(creatorAddr)]);

// Wallet discovery: the Wallet Standard store first (how current Ready
// announces itself), then the legacy window.starknet_* injection as fallback.
import { createStore } from "@starknet-io/get-starknet-core";

async function findReady() {
  const store = createStore();
  store._refreshInjectedWallets?.();
  // Standard wallets register via events; give them a beat.
  await new Promise((r) => setTimeout(r, 300));
  const wallets = store.getWallets();
  log(`discovered wallets: ${wallets.map((w) => w.name).join(", ") || "(none via standard)"}`, "dim");
  // Return the raw wallet-standard wallet: starknet.js WalletAccountV6 reads
  // its .features map (standard:connect, starknet:walletApi) directly.
  const pick =
    wallets.find((w) => /ready|argent/i.test(w.name)) ?? wallets[0] ?? null;
  if (pick) return pick;
  const cands = Object.keys(window).filter((k) => k.startsWith("starknet"));
  for (const k of cands) {
    const w = window[k];
    if (w && /ready|argent/i.test(`${w.id ?? ""}${w.name ?? ""}`)) return w;
  }
  return cands.length ? window[cands[0]] : null;
}

async function run(actions, dry, label) {
  log(`${label}: ${JSON.stringify(actions)}`, "dim");
  if (dry) {
    const prepared = await account.strk20PrepareInvoke(actions);
    log(`${label} DRY RUN ok — proof prepared, nothing submitted`, "ok");
    console.log(label, prepared);
    return null;
  }
  const { transaction_hash } = await account.strk20InvokeTransaction(actions);
  log(`${label} submitted: ${transaction_hash}`, "ok");
  log(`voyager: https://voyager.online/tx/${transaction_hash}`, "dim");
  return transaction_hash;
}

$("connect").onclick = async () => {
  try {
    const swo = await findReady();
    if (!swo) throw new Error("no injected Starknet wallet found");
    const provider = new RpcProvider({ nodeUrl: "https://rpc.starknet.lava.build" });
    account = await WalletAccountV6.connect(provider, swo);
    $("who").textContent = `${account.address.slice(0, 10)}… connected`;
    const api = await account.walletProvider.features?.["starknet:walletApi"]?.request?.({ type: "wallet_supportedWalletApi" }).catch(() => null);
    if (api) log(`wallet api versions: ${JSON.stringify(api)}`, "dim");
    for (const b of ["balances", "echo", "register", "subscribe", "release"]) $(b).disabled = false;
    log("connected", "ok");
  } catch (e) { logErr("connect failed", e); }
};

$("balances").onclick = async () => {
  try {
    const b = await account.strk20Balances([STRK]);
    log(`shielded STRK: ${b.map((x) => `${BigInt(x.balance) / E18}`).join(", ")}`, "ok");
  } catch (e) { logErr("balances failed", e); }
};

// G3 rehearsal: withdraw 5 STRK to the deployed echo helper, open a note for
// ourselves, invoke the helper; it echoes the deposit instruction back and the
// pool credits the note. Six pool events in one receipt if all is well.
$("echo").onclick = async () => {
  try {
    const amt = "0x" + (5n * E18).toString(16);
    await run([
      { type: "withdraw", token: STRK, amount: amt, recipient: ECHO },
      { type: "transfer", token: STRK, amount: "OPEN", recipient: pad(account.address) },
      { type: "invoke", contract: ECHO, calldata: [cd(STRK), "${poolAddress}", "${openNoteIds[0]}"] },
    ], $("dry1").checked, "echo round-trip");
  } catch (e) { logErr("echo failed", e); }
};

// Plain public call — the creator (this wallet) registers a 1-tier ladder.
$("register").onclick = async () => {
  try {
    const per = BigInt($("tier0").value) * E18;
    const { transaction_hash } = await account.execute({
      contractAddress: VAULT,
      entrypoint: "register_creator",
      calldata: [STRK, "1", per.toString()],
    });
    log(`register_creator submitted: ${transaction_hash}`, "ok");
    log(`creator_id: ${creatorIdOf(account.address)}`, "dim");
  } catch (e) { logErr("register failed", e); }
};

// Subscribe: escrow tier*periods into the vault + the Subscribe op.
// VaultOp serde: [variant 0, commitment, creator_id, tier u8, period_blocks u64,
// n_periods u32, owner_key].
$("subscribe").onclick = async () => {
  try {
    const per = BigInt($("tier0").value) * E18;
    const n = BigInt($("nper").value);
    const pblocks = BigInt($("pblocks").value);
    const creatorId = creatorIdOf(account.address);
    const commitment = commitmentOf(account.address);
    await run([
      { type: "withdraw", token: STRK, amount: "0x" + (per * n).toString(16), recipient: VAULT },
      { type: "invoke", contract: VAULT, calldata: [
        cd("0x0"), cd(commitment), cd(creatorId), cd("0x0"),
        cd("0x" + pblocks.toString(16)), cd("0x" + n.toString(16)), cd(account.address),
      ]},
    ], $("dry3").checked, "subscribe");
  } catch (e) { logErr("subscribe failed", e); }
};

// Release: open a note for the creator, invoke the vault's Release op.
// VaultOp serde: [variant 1, commitment, note_id placeholder].
$("release").onclick = async () => {
  try {
    const commitment = commitmentOf(account.address);
    // The batch must spend shielded value so the wallet can source the pool's
    // 6 STRK protocol fee (prepareInvoke proves without it; the relayer needs
    // it). A small withdraw to self mirrors the working subscribe/echo shape:
    // it makes this a spending batch, the wallet spends notes covering the fee,
    // and the withdrawn amount returns to the subscriber's public balance.
    // In the daemon path the keeper's own withdraw covers the fee instead.
    const feeBump = "0x" + (E18 / 10n).toString(16); // 0.1 STRK to self; wallet sources the 6 STRK fee separately
    await run([
      { type: "withdraw", token: STRK, amount: feeBump, recipient: pad(account.address) },
      { type: "transfer", token: STRK, amount: "OPEN", recipient: pad(account.address) },
      { type: "invoke", contract: VAULT, calldata: [cd("0x1"), cd(commitment), "${openNoteIds[0]}"] },
    ], $("dry4").checked, "release");
  } catch (e) { logErr("release failed", e); }
};

log("ready — connect the wallet to begin", "dim");
