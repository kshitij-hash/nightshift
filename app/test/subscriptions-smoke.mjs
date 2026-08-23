// Headless proof that /manage's read path works against mainnet.
//
// Same shape as rpc-smoke.mjs: src/lib/subscriptions.ts is bundled with esbuild
// (relative imports plus starknet, which the bundle pulls in) and called
// directly under Node, no browser and no dev server. Run via
// `npm run smoke:subscriptions`, which builds the bundle first.
//
// What it proves, in order:
//   1. the CreatorRegistered scan returns the vault's real creator list
//   2. a commitment that IS on chain comes back with a schedule and a tier
//      price, so the card the page draws has real numbers behind it
//   3. a commitment that is NOT on chain comes back as no subscription at all,
//      which is the case that keeps a card from being drawn for a browser that
//      never subscribed
import assert from "node:assert/strict";

const { readVaultCreators, readSubscriptions, subscriptionState, coveredCharges, nextChargeBlock } =
  await import("../.smoke/subscriptions-bundle.mjs");
const { getRpcClient } = await import("../.smoke/subscriptions-bundle.mjs");
const { readBoard } = await import("../.smoke/board-bundle.mjs");

const client = getRpcClient();

const creators = await readVaultCreators(client);
assert.ok(Array.isArray(creators.creatorIds), "creatorIds must be an array");
console.log(
  `subscriptions-smoke: ${creators.creatorIds.length} creator ids registered at the vault` +
    (creators.partial.length > 0 ? ` · partial: ${creators.partial.join("; ")}` : ""),
);

// A commitment that is definitely on chain: the one the newest v4 charge names.
const board = await readBoard();
const v4 = board.charges.find((c) => c.vault === "v4");
assert.ok(v4, "the board decoded no v4 charge, so there is nothing to look up");

const found = await readSubscriptions(client, [
  { creatorId: "0x0", commitment: v4.commitment },
  // A commitment nothing on chain can match: poseidon output space is 2^251,
  // so this is a stand-in for a browser that never subscribed.
  { creatorId: "0x0", commitment: "0x" + "1".repeat(62) },
]);

assert.equal(found.subscriptions.length, 1, "exactly the on-chain commitment should come back");
const s = found.subscriptions[0];
assert.equal(BigInt(s.commitment), BigInt(v4.commitment));
assert.ok(s.schedule, "the subscription must carry a schedule");
assert.equal(typeof s.schedule.nPeriods, "number");
assert.equal(typeof s.schedule.escrowWei, "bigint");
assert.ok(["active", "exhausted", "cancelled"].includes(subscriptionState(s)));

console.log(
  `subscriptions-smoke: commitment ${s.commitment.slice(0, 12)}… · tier ${s.schedule.tier} · ` +
    `${s.schedule.periodBlocks} blocks · ${s.schedule.nextPeriod}/${s.schedule.nPeriods} charged · ` +
    `escrow ${s.schedule.escrowWei} wei · tier price ${s.tierPriceWei} wei · ` +
    `state ${subscriptionState(s)} · covers ${coveredCharges(s)} more · ` +
    `next window block ${nextChargeBlock(s)}`,
);
if (found.partial.length > 0) {
  console.log(`subscriptions-smoke: partial reads: ${found.partial.join("; ")}`);
}
