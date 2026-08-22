// Headless proof that the read path works: bundles src/lib/board.ts with
// esbuild (self-contained, no npm deps needed - the lib only has relative
// imports plus one JSON import) and calls readBoard() directly under Node,
// no browser, no Vite dev server. Run via `npm run smoke:rpc`, which builds
// the bundle first.
import assert from "node:assert/strict";

const { readBoard } = await import("../.smoke/board-bundle.mjs");

const board = await readBoard();

assert.ok(
  board.provenance.source === "rpc" || board.provenance.source === "snapshot",
  "provenance.source must be rpc or snapshot",
);
assert.equal(typeof board.headBlock, "number");
assert.ok(board.headBlock > 0, "headBlock must be positive");
assert.equal(typeof board.escrowWei, "bigint");
assert.ok(Array.isArray(board.charges));

console.log(
  `rpc-smoke: source=${board.provenance.source} headBlock=${board.headBlock} ` +
    `escrowWei=${board.escrowWei} charges=${board.charges.length} ` +
    `activeSubscriptions=${board.activeSubscriptions}`,
);
if (board.provenance.partial.length > 0) {
  console.log(`rpc-smoke: partial reads: ${board.provenance.partial.join("; ")}`);
}
