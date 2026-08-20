// NIGHTSHIFT ops console, v3. Everything on-chain runs through the connected
// wallet's STRK20 API or plain public calls — no viewing key, no proof
// handling in this page.
//
// Key handling is DEMO-GRADE by declared scope: the creator payout keypair and
// the subscriber owner keypair are STARK keypairs generated here and kept in
// localStorage, because the demo wallet plays both roles (PRIVACY.md
// limitation 5). A production build would hold them in the respective
// parties' wallets.
//
// The claim flow is two-phase because of a real constraint: the open-note id
// is computed by the WALLET (h(NOTE_ID_TAG, channel_key, token, index, 0)) and
// cannot be derived by a dapp, while the creator's signature must bind that
// exact id. So: PREPARE resolves the id without submitting; we sign it here;
// SUBMIT sends the same batch with the literal id and signature. This assumes
// the note index does not advance between the two calls (no other pool
// activity from this wallet in between) — proving that assumption on mainnet
// is the point of the first claim.

import { RpcProvider, WalletAccountV6, ec, hash, shortString } from "starknet";
import { createStore } from "@starknet-io/get-starknet-core";

const POOL = "0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a";
const VAULT = "0x277519c8bc1031188313de4528d1f0159319f8f86651422e89b6fbd920b3759"; // v3
const STRK = "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";
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
const provider = new RpcProvider({ nodeUrl: "https://rpc.starknet.lava.build" });

// --- local key material (localStorage; see the demo-grade note up top) ---

const stored = (key, label) => {
  let v = localStorage.getItem(key);
  if (!v) {
    v = "0x" + [...ec.starkCurve.utils.randomPrivateKey()]
      .map((b) => b.toString(16).padStart(2, "0")).join("");
    localStorage.setItem(key, v);
    log(`new ${label} generated (localStorage — demo-grade, this machine only)`, "dim");
  }
  return v;
};
const subscriberSecret = () => stored("nightshift.subscriber.secret", "subscriber secret");
const payoutPriv = () => stored("nightshift.payout.priv", "creator payout key");
const ownerPriv = () => stored("nightshift.owner.priv", "subscriber owner key");
const payoutPub = () => ec.starkCurve.getStarkKey(payoutPriv());
const ownerPub = () => ec.starkCurve.getStarkKey(ownerPriv());

// v3 identity: creator_id = poseidon(caller, token, payout_key), computed
// on-chain by register_creator with the connected wallet as caller.
const creatorId = () =>
  hash.computePoseidonHashOnElements([account.address, STRK, payoutPub()]);
const commitment = () =>
  hash.computePoseidonHashOnElements([subscriberSecret(), creatorId()]);

// Domain-separated messages, mirroring src/common.cairo exactly.
const tag = (s) => shortString.encodeShortString(s);
const claimMsg = (noteId, amountWei) =>
  hash.computePoseidonHashOnElements([tag("NIGHTSHIFT_CLAIM"), creatorId(), noteId, "0x" + amountWei.toString(16)]);
const cancelMsg = () =>
  hash.computePoseidonHashOnElements([tag("NIGHTSHIFT_CANCEL"), commitment()]);
const reclaimMsg = (to) =>
  hash.computePoseidonHashOnElements([tag("NIGHTSHIFT_RECLAIM"), commitment(), to]);
const sign = (msg, priv) => {
  const s = ec.starkCurve.sign(msg, priv);
  return { r: "0x" + s.r.toString(16), s: "0x" + s.s.toString(16) };
};

// --- wallet plumbing (unchanged from v2 console) ---

async function findReady() {
  const store = createStore();
  store._refreshInjectedWallets?.();
  await new Promise((r) => setTimeout(r, 300));
  const wallets = store.getWallets();
  log(`discovered wallets: ${wallets.map((w) => w.name).join(", ") || "(none via standard)"}`, "dim");
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

const view = async (entrypoint, calldata) => {
  const r = await provider.callContract({ contractAddress: VAULT, entrypoint, calldata });
  return r.map(BigInt);
};

$("connect").onclick = async () => {
  try {
    const swo = await findReady();
    if (!swo) throw new Error("no injected Starknet wallet found");
    account = await WalletAccountV6.connect(provider, swo);
    $("who").textContent = `${account.address.slice(0, 10)}… connected`;
    for (const b of ["balances", "state", "register", "subscribe", "charge", "claimprep", "claimsend", "cancel", "reclaim"]) $(b).disabled = false;
    log("connected", "ok");
    log(`payout pubkey: ${payoutPub()}`, "dim");
    log(`owner pubkey:  ${ownerPub()}`, "dim");
  } catch (e) { logErr("connect failed", e); }
};

$("balances").onclick = async () => {
  try {
    const b = await account.strk20Balances([STRK]);
    log(`shielded STRK: ${b.map((x) => `${BigInt(x.balance) / E18}`).join(", ")}`, "ok");
  } catch (e) { logErr("balances failed", e); }
};

// One glance at everything the session cares about.
$("state").onclick = async () => {
  try {
    const c = commitment();
    const [sched, due, claimable] = await Promise.all([
      view("schedule_of", [c]),
      view("periods_due", [c]),
      view("claimable_of", [creatorId()]),
    ]);
    const [, tier, pblocks, start, n, escrow, next, cancelled] = sched;
    log(`schedule: tier=${tier} period_blocks=${pblocks} start=${start} n=${n} next=${next} cancelled=${cancelled === 1n}`, "ok");
    log(`escrow: ${escrow / E18} STRK · periods due now: ${due[0]} · creator claimable: ${claimable[0] / E18} STRK`, "ok");
  } catch (e) { logErr("state read failed", e); }
};

// Plain public call — the creator registers a 1-tier ladder with the payout
// pubkey that will later sign claims. calldata: token, payout_key, Span<u128>.
$("register").onclick = async () => {
  try {
    const per = BigInt($("tier0").value) * E18;
    const { transaction_hash } = await account.execute({
      contractAddress: VAULT,
      entrypoint: "register_creator",
      calldata: [STRK, payoutPub(), "0x1", cd("0x" + per.toString(16))],
    });
    log(`register_creator submitted: ${transaction_hash}`, "ok");
    log(`creator_id: ${creatorId()}`, "dim");
  } catch (e) { logErr("register failed", e); }
};

// Subscribe: escrow tier×periods into the vault + the Subscribe op.
// VaultOp serde: [variant 0, commitment, creator_id, tier u8, period_blocks
// u64, n_periods u32, owner_key]. owner_key is the STARK pubkey — an address
// here would make revocation name a wallet.
$("subscribe").onclick = async () => {
  try {
    const per = BigInt($("tier0").value) * E18;
    const n = BigInt($("nper").value);
    const pblocks = BigInt($("pblocks").value);
    await run([
      { type: "withdraw", token: STRK, amount: "0x" + (per * n).toString(16), recipient: VAULT },
      { type: "invoke", contract: VAULT, calldata: [
        cd("0x0"), cd(commitment()), cd(creatorId()), cd("0x0"),
        cd("0x" + pblocks.toString(16)), cd("0x" + n.toString(16)), cd(ownerPub()),
      ]},
    ], $("dry3").checked, "subscribe");
  } catch (e) { logErr("subscribe failed", e); }
};

// Manual charge — same permissionless call the cron keeper fires. Useful in
// the session to consume period 0 without waiting for the daemon.
$("charge").onclick = async () => {
  try {
    const { transaction_hash } = await account.execute({
      contractAddress: VAULT, entrypoint: "charge", calldata: [commitment()],
    });
    log(`charge submitted: ${transaction_hash}`, "ok");
    log(`voyager: https://voyager.online/tx/${transaction_hash}`, "dim");
  } catch (e) { logErr("charge failed", e); }
};

// --- claim, phase 1: PREPARE to discover the open-note id ---
// The batch: a small self-withdraw (makes it a spending batch so the wallet
// sources the pool's 6 STRK protocol fee), an OPEN transfer to self (the note
// the payout lands in), and the vault invoke with a ZERO signature — the
// vault would reject it, but prepare only builds and proves, never executes.
const claimActions = (noteId, sig) => {
  const amountWei = BigInt(Number($("clamount").value) * 100) * (E18 / 100n);
  return [
    { type: "withdraw", token: STRK, amount: "0x" + (E18 / 10n).toString(16), recipient: pad(account.address) },
    { type: "transfer", token: STRK, amount: "OPEN", recipient: pad(account.address) },
    { type: "invoke", contract: VAULT, calldata: [
      cd("0x1"), cd(creatorId()), noteId, cd("0x" + amountWei.toString(16)),
      cd(sig?.r ?? "0x1"), cd(sig?.s ?? "0x1"),
    ]},
  ];
};

$("claimprep").onclick = async () => {
  try {
    const prepared = await account.strk20PrepareInvoke(claimActions("${openNoteIds[0]}", null));
    console.log("prepared claim", prepared);
    // The wallet resolves the placeholder inside the pool's apply_actions
    // calldata. Our invoke tail is unmistakable in it:
    //   [variant=1, creator_id, NOTE_ID, amount, sig_r=1, sig_s=1]
    // so the felt sitting between creator_id and amount IS the note id.
    const cdArr = (prepared?.call?.calldata ?? []).map((x) => BigInt(x));
    const amountWei = BigInt(Number($("clamount").value) * 100) * (E18 / 100n);
    const cid = BigInt(creatorId());
    let noteId = null;
    for (let j = 0; j + 4 < cdArr.length; j++) {
      if (cdArr[j] === cid && cdArr[j + 2] === amountWei && cdArr[j + 3] === 1n && cdArr[j + 4] === 1n) {
        noteId = "0x" + cdArr[j + 1].toString(16);
        break;
      }
    }
    if (noteId) {
      $("noteid").value = noteId;
      log(`prepared — resolved note id: ${noteId}`, "ok");
      log(`auto-filled. Do nothing else with the wallet, then SIGN + SUBMIT`, "ok");
    } else {
      log("prepared, but the [creator_id, ?, amount, 1, 1] pattern was not found in apply_actions calldata:", "err");
      log(cdArr.map((x) => "0x" + x.toString(16)).join(" "), "dim");
      log("fill the note id by hand from the dump above", "err");
    }
  } catch (e) { logErr("claim prepare failed", e); }
};

// --- claim, phase 2: sign the RESOLVED note id, submit with the PLACEHOLDER ---
// The wallet's schema rejects a batch whose open note is not referenced by an
// ${openNoteIds[N]} placeholder (INVALID_REQUEST_PAYLOAD, observed on
// mainnet), so the literal id cannot go in the calldata. It does not need to:
// the wallet resolves the placeholder to the same id the signature binds. If
// the note index ever drifted between prepare and submit, the resolved id
// would differ from the signed one and the vault rejects with
// NS_BAD_SIGNATURE — fail-safe, never a payout to the wrong note.
$("claimsend").onclick = async () => {
  try {
    const noteId = $("noteid").value.trim();
    if (!/^0x[0-9a-fA-F]+$/.test(noteId)) throw new Error("fill the note id from PREPARE first");
    const amountWei = BigInt(Number($("clamount").value) * 100) * (E18 / 100n);
    const sig = sign(claimMsg(noteId, amountWei), payoutPriv());
    await run(claimActions("${openNoteIds[0]}", sig), false, "claim");
  } catch (e) { logErr("claim submit failed", e); }
};

// Cancel: plain public call, authorized only by the owner-key signature.
$("cancel").onclick = async () => {
  try {
    const sig = sign(cancelMsg(), ownerPriv());
    const { transaction_hash } = await account.execute({
      contractAddress: VAULT, entrypoint: "cancel",
      calldata: [commitment(), sig.r, sig.s],
    });
    log(`cancel submitted: ${transaction_hash}`, "ok");
  } catch (e) { logErr("cancel failed", e); }
};

// Reclaim: unspent escrow back out to a public address (a public exit edge).
$("reclaim").onclick = async () => {
  try {
    const to = $("reclaimto").value.trim() || account.address;
    const sig = sign(reclaimMsg(to), ownerPriv());
    const { transaction_hash } = await account.execute({
      contractAddress: VAULT, entrypoint: "reclaim",
      calldata: [commitment(), to, sig.r, sig.s],
    });
    log(`reclaim submitted: ${transaction_hash} → ${to.slice(0, 10)}…`, "ok");
  } catch (e) { logErr("reclaim failed", e); }
};

log("ready — connect the wallet to begin (v3 vault " + VAULT.slice(0, 10) + "…)", "dim");
