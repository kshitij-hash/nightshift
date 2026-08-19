// NIGHTSHIFT ops console. Everything runs through the connected wallet's
// STRK20 API — no viewing key, no proof handling, nothing secret in this page.

import { RpcProvider, WalletAccountV6, hash } from "starknet";

const POOL = "0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a";
const VAULT = "0x01f653f21e557e70384c8631f9c8f97e0342aa1d5e975bdcaca76bbf8715f338";
const STRK = "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";
const ECHO = "0x078ae662e0cc6d1ab2cfeaf2a51ba8783d88e31886f88a794d142f95a6f8735b";
const E18 = 10n ** 18n;

const $ = (id) => document.getElementById(id);
const logEl = $("log");
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

function findReady() {
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
    const prepared = await account.strk20PrepareInvoke(actions, true);
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
    const swo = findReady();
    if (!swo) throw new Error("no injected Starknet wallet found");
    const provider = new RpcProvider({ nodeUrl: "https://rpc.starknet.lava.build" });
    account = await WalletAccountV6.connect(provider, swo);
    $("who").textContent = `${account.address.slice(0, 10)}… connected`;
    const api = await account.walletProvider.request?.({ type: "wallet_supportedWalletApi" }).catch(() => null);
    if (api) log(`wallet api versions: ${JSON.stringify(api)}`, "dim");
    for (const b of ["balances", "echo", "register", "subscribe", "release"]) $(b).disabled = false;
    log("connected", "ok");
  } catch (e) { log(`connect failed: ${e.message}`, "err"); }
};

$("balances").onclick = async () => {
  try {
    const b = await account.strk20Balances([STRK]);
    log(`shielded STRK: ${b.map((x) => `${BigInt(x.balance) / E18}`).join(", ")}`, "ok");
  } catch (e) { log(`balances failed: ${e.message}`, "err"); }
};

// G3 rehearsal: withdraw 5 STRK to the deployed echo helper, open a note for
// ourselves, invoke the helper; it echoes the deposit instruction back and the
// pool credits the note. Six pool events in one receipt if all is well.
$("echo").onclick = async () => {
  try {
    const amt = (5n * E18).toString();
    await run([
      { type: "withdraw", token: STRK, amount: amt, recipient: ECHO },
      { type: "transfer", token: STRK, amount: "OPEN", recipient: account.address },
      { type: "invoke", contract: ECHO, calldata: [STRK, "${poolAddress}", "${openNoteIds[0]}"] },
    ], $("dry1").checked, "echo round-trip");
  } catch (e) { log(`echo failed: ${e.message}`, "err"); }
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
  } catch (e) { log(`register failed: ${e.message}`, "err"); }
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
      { type: "withdraw", token: STRK, amount: (per * n).toString(), recipient: VAULT },
      { type: "invoke", contract: VAULT, calldata: [
        "0x0", commitment, creatorId, "0x0", "0x" + pblocks.toString(16), "0x" + n.toString(16), account.address,
      ]},
    ], $("dry3").checked, "subscribe");
  } catch (e) { log(`subscribe failed: ${e.message}`, "err"); }
};

// Release: open a note for the creator, invoke the vault's Release op.
// VaultOp serde: [variant 1, commitment, note_id placeholder].
$("release").onclick = async () => {
  try {
    const commitment = commitmentOf(account.address);
    await run([
      { type: "transfer", token: STRK, amount: "OPEN", recipient: account.address },
      { type: "invoke", contract: VAULT, calldata: ["0x1", commitment, "${openNoteIds[0]}"] },
    ], $("dry4").checked, "release");
  } catch (e) { log(`release failed: ${e.message}`, "err"); }
};

log("ready — connect the wallet to begin", "dim");
