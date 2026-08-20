// NIGHTSHIFT ops console, v3. Everything on-chain runs through the connected
// wallet's STRK20 API or plain public calls — no viewing key, no proof
// handling in this page.
//
// Key handling is DEMO-GRADE by declared scope: the creator payout keypair is
// a STARK keypair generated here and kept in localStorage, because the demo
// wallet plays both roles (PRIVACY.md limitation 5). A production build would
// hold it in the creator's wallet.
//
// The subscriber's owner key is NOT stored. It is derived per commitment from
// one stored master secret (see ownerPrivFor). The owner key is public: it
// rides in the subscribe calldata and the tier gate reads it to check a
// presentation, so one key reused across creators would link a subscriber's
// commitments to each other for anyone reading the chain.
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
// Fill in after `node scripts/deploy-gate.mjs <vault>` lands. Empty means the
// gate section refuses to build a call rather than sending one to address 0.
const GATE = "";
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
const payoutPub = () => ec.starkCurve.getStarkKey(payoutPriv());

// --- per-commitment owner key ---------------------------------------------
// One key per subscription, derived, never stored. The old console kept a
// single "nightshift.owner.priv" and reused it for every creator; once the gate
// publishes owner keys, that one key is a join column across every creator the
// same subscriber pays.
//
// Derivation, client-side only (no Cairo mirror needed, since the chain only
// ever sees the public key):
//
//   k = poseidon(subscriberSecret, creatorId, 'NIGHTSHIFT_OWNER') mod n
//   while k == 0: k += 1
//
// n is the STARK curve order. Poseidon's output range is [0, P) with P the
// STARK prime; P - n is about 2^96, so reducing mod n biases the result by
// ~2^-155 and needs no rejection sampling. k == 0 is not a valid scalar, so it
// is incremented rather than accepted. Deterministic: the same master secret
// and creator id always rebuild the same key, so nothing has to be backed up
// beyond the master secret.
//
// commitment = poseidon(subscriberSecret, creatorId) is 1:1 with creatorId in
// this console, so keying the derivation on creatorId is keying it on the
// commitment.
const CURVE_N = ec.starkCurve.CURVE.n;
const ownerPrivFor = (creatorIdFelt) => {
  const h = BigInt(
    hash.computePoseidonHashOnElements([subscriberSecret(), creatorIdFelt, tag("NIGHTSHIFT_OWNER")]),
  );
  let k = h % CURVE_N;
  if (k === 0n) k = 1n;
  if (!ec.starkCurve.utils.isValidPrivateKey(k)) throw new Error("derived owner key out of range");
  return "0x" + k.toString(16).padStart(64, "0");
};
const ownerPriv = () => ownerPrivFor(creatorId());
const ownerPub = () => ec.starkCurve.getStarkKey(ownerPriv());

// LEGACY PATH. Do not delete while the v3 subscription is still cancellable.
// The subscription already live on the v3 vault recorded the OLD single stored
// owner key, so only that key can authorize its cancel or reclaim. It is read,
// never created: this returns null on a machine that never ran the old console.
const legacyOwnerPriv = () => localStorage.getItem("nightshift.owner.priv");
const legacyOwnerPub = () => {
  const p = legacyOwnerPriv();
  return p ? ec.starkCurve.getStarkKey(p) : null;
};
// Which key the self-submit cancel/reclaim buttons sign with. The sign-only
// buttons ignore this and print a relay line per available key instead.
const signingOwnerPriv = () =>
  ($("legacykey")?.checked && legacyOwnerPriv()) ? legacyOwnerPriv() : ownerPriv();

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
// Gate presentation. Mirrors present_nonce_message in src/common.cairo:
// poseidon(['NIGHTSHIFT_PRESENT', commitment, verifier_id, expiry_block, nonce]).
const presentMsg = (verifierId, expiryBlock, nonce) =>
  hash.computePoseidonHashOnElements([
    tag("NIGHTSHIFT_PRESENT"), commitment(), verifierId,
    "0x" + BigInt(expiryBlock).toString(16), nonce,
  ]);
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
    for (const b of ["balances", "state", "register", "subscribe", "charge", "claimprep", "claimsend",
                     "cancelsign", "cancelself", "reclaimsign", "reclaimself", "present"]) $(b).disabled = false;
    log("connected", "ok");
    log(`payout pubkey: ${payoutPub()}`, "dim");
    // Per-commitment, so this line changes with the creator id above it.
    log(`owner pubkey (creator ${creatorId().slice(0, 10)}…): ${ownerPub()}`, "dim");
    const legacy = legacyOwnerPub();
    if (legacy) {
      $("legacykey").disabled = false;
      log(`legacy owner pubkey (pre-derivation, v3 subscription only): ${legacy}`, "dim");
    }
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

// --- cancel / reclaim: sign here, let anyone submit -------------------------
// The vault authorizes both entrypoints on the owner-key signature alone and
// never looks at the sender. So the subscriber's wallet does not have to be
// the one that submits, and when it is, it writes itself into the transaction
// as sender for no benefit. The primary buttons therefore sign and stop,
// printing the exact scripts/relay.mjs line to hand to a relay. The self-
// submit buttons stay for the case where no relay is at hand, labelled so the
// cost of pressing them is visible.

const RELAY_NOTE =
  "any party can submit this line: the vault checks the signature, not the " +
  "sender. That is why cancelling needs no gas and no wallet from the subscriber.";

// The owner keys worth signing with, best first: the derived per-commitment
// key, then the legacy stored key if this machine has one. Two lines, not one,
// because the vault stores exactly one owner key per commitment and the console
// cannot read which (schedule_of stops short of owner_key), so the caller picks
// by era: derived for anything subscribed after this change, legacy for the v3
// subscription that predates it.
const ownerKeyCandidates = () => {
  const out = [{ label: "derived per-commitment key", priv: ownerPriv() }];
  const legacy = legacyOwnerPriv();
  if (legacy) out.push({ label: "legacy stored key, for the existing v3 subscription", priv: legacy });
  return out;
};

$("cancelsign").onclick = () => {
  try {
    for (const k of ownerKeyCandidates()) {
      const sig = sign(cancelMsg(), k.priv);
      log(`cancel signed with the ${k.label}, nothing submitted`, "ok");
      log(`node scripts/relay.mjs cancel ${commitment()} ${sig.r} ${sig.s}`, "ok");
    }
    log(RELAY_NOTE, "dim");
  } catch (e) { logErr("cancel sign failed", e); }
};

$("cancelself").onclick = async () => {
  try {
    log("self-submitting: this wallet is recorded as the sender of the cancel", "dim");
    const sig = sign(cancelMsg(), signingOwnerPriv());
    const { transaction_hash } = await account.execute({
      contractAddress: VAULT, entrypoint: "cancel",
      calldata: [commitment(), sig.r, sig.s],
    });
    log(`cancel submitted: ${transaction_hash}`, "ok");
  } catch (e) { logErr("cancel failed", e); }
};

// Reclaim: unspent escrow back out to a public address (a public exit edge).
// The destination is inside the signed message, so a relay cannot redirect it.
$("reclaimsign").onclick = () => {
  try {
    const to = $("reclaimto").value.trim() || account.address;
    for (const k of ownerKeyCandidates()) {
      const sig = sign(reclaimMsg(to), k.priv);
      log(`reclaim signed for ${to.slice(0, 10)}… with the ${k.label}, nothing submitted`, "ok");
      log(`node scripts/relay.mjs reclaim ${commitment()} ${to} ${sig.r} ${sig.s}`, "ok");
    }
    log(RELAY_NOTE, "dim");
    log("the destination sits inside the signed message: a relay that edits it fails the check", "dim");
  } catch (e) { logErr("reclaim sign failed", e); }
};

$("reclaimself").onclick = async () => {
  try {
    const to = $("reclaimto").value.trim() || account.address;
    log("self-submitting: this wallet is recorded as the sender of the reclaim", "dim");
    const sig = sign(reclaimMsg(to), signingOwnerPriv());
    const { transaction_hash } = await account.execute({
      contractAddress: VAULT, entrypoint: "reclaim",
      calldata: [commitment(), to, sig.r, sig.s],
    });
    log(`reclaim submitted: ${transaction_hash} → ${to.slice(0, 10)}…`, "ok");
  } catch (e) { logErr("reclaim failed", e); }
};

// --- gate: present a tier to a verifier -------------------------------------
// `present` is a signature presentation, not a proof. The commitment sits in
// the calldata and in the gate's Presented event, so a verifier, and anyone
// else reading the chain, can link two presentations of the same subscription
// to each other, at one gate or across several. What the verifier gets back is
// (creator_id, tier). What it never gets is a wallet: the signature is by the
// subscription's owner key, and this console derives one such key per
// commitment so presentations to different creators' gates share no key.

// A verifier id is a felt: pass 0x-hex through, otherwise treat it as a short
// string ('DOOR_1'), which is how a human-readable door id becomes a felt.
const asFelt = (s) =>
  /^0x[0-9a-fA-F]+$/.test(s) ? s : shortString.encodeShortString(s);

// 31 random bytes stays under the STARK prime without a reduction step.
const randomNonce = () =>
  "0x" + [...crypto.getRandomValues(new Uint8Array(31))]
    .map((b) => b.toString(16).padStart(2, "0")).join("");

// The gate's MAX_PRESENT_WINDOW is one PERIOD_HOUR (2100 blocks), so a 1000
// block expiry is inside it with room for the transaction to land.
const PRESENT_WINDOW_BLOCKS = 1000;

$("present").onclick = async () => {
  try {
    if (!GATE) throw new Error("GATE is empty: set it in web/app.mjs after the gate deploy");
    const raw = $("verifier").value.trim();
    if (!raw) throw new Error("enter a verifier id");
    const verifierId = asFelt(raw);
    const now = await provider.getBlockNumber();
    const expiry = now + PRESENT_WINDOW_BLOCKS;
    const nonce = randomNonce();
    const sig = sign(presentMsg(verifierId, expiry, nonce), ownerPriv());
    log(`present: verifier_id=${verifierId} expiry_block=${expiry} (block ${now} + ${PRESENT_WINDOW_BLOCKS}) nonce=${nonce}`, "dim");
    const { transaction_hash } = await account.execute({
      contractAddress: GATE, entrypoint: "present",
      calldata: [commitment(), verifierId, cd("0x" + BigInt(expiry).toString(16)), nonce, sig.r, sig.s],
    });
    log(`present submitted: ${transaction_hash}`, "ok");
    log(`voyager: https://voyager.online/tx/${transaction_hash}`, "dim");
    await provider.waitForTransaction(transaction_hash);
    // The entrypoint's return value is not in the receipt, so read the same
    // pair straight back off the gate.
    const r = await provider.callContract({
      contractAddress: GATE, entrypoint: "tier_of", calldata: [commitment()],
    });
    log(`gate returned creator_id=${r[0]} tier=${BigInt(r[1])}`, "ok");
    log("the commitment travelled in that calldata and in the Presented event: presentations of one subscription are linkable to each other across gates", "dim");
  } catch (e) { logErr("present failed", e); }
};

log("ready — connect the wallet to begin (v3 vault " + VAULT.slice(0, 10) + "…)", "dim");
if (!GATE) log("gate address not set: the present button refuses until GATE is filled in", "dim");
