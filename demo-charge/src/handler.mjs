// One request, start to finish. Transport-free: this takes { commitment, ip }
// and returns one of the five response objects. server.mjs turns HTTP into that
// pair and the response back into JSON; the tests call it directly with the
// mock chain, so the whole rail order is covered without a socket.
//
// Rail order, and why:
//   1. whitelist        refuse an unlisted commitment before anything else, so
//                       a stranger's felt never reaches the signer
//   2. probe cooldown   bound how fast one IP can make us call the RPC node
//   3. charge cooldown  bound how often one IP can make us spend gas
//   4. daily budget     bound what every IP together can cost in a day
//   5. chain preflight  "not due" answers from a read; no gas on a revert we
//                       could see coming
//   6. per-period lock  two visitors, one period, one transaction
//   7. estimate         the dry run CLAUDE.md requires before a mainnet write
//   8. submit

import {
  DailyBudget,
  PendingRegistry,
  failure,
  gateChain,
  gateRequest,
  parseSchedule,
  safeReason,
  submitted,
} from "./decide.mjs";

export function createHandler({
  config,
  chain,
  cooldowns,
  budget = new DailyBudget(config.maxPerDay),
  pending = new PendingRegistry(),
  now = () => Date.now(),
  persist = () => {},
  log = () => {},
}) {
  return async function handleCharge({ commitment, ip }) {
    const nowMs = now();

    const gate = gateRequest({ commitment, ip, nowMs, config, cooldowns, budget });
    if (!gate.allow) return gate.response;
    const target = gate.commitment;
    cooldowns.mark("probe", ip, nowMs);

    let head;
    let schedule;
    let tierAmount;
    try {
      head = await chain.head();
      schedule = parseSchedule(await chain.schedule(target));
      if (!schedule) return failure("the vault state could not be read");
      tierAmount = await chain.tierAmount(schedule.creatorId, schedule.tier);
    } catch (err) {
      log(`read failed: ${safeReason(err)}`);
      return failure("the vault state could not be read");
    }

    const key = PendingRegistry.key(target, schedule.nextPeriod);

    // A transaction submitted a moment ago still reads as "due", because
    // next_period only advances on acceptance. Hand back the same hash.
    const remembered = pending.recall(key, nowMs, config.settleWindowS);
    if (remembered) return submitted(remembered);

    const chainGate = gateChain({
      schedule,
      tierAmount,
      head,
      secondsPerBlock: config.secondsPerBlock,
    });
    if (!chainGate.allow) return chainGate.response;

    if (!budget.take(nowMs)) return { status: "budget_exhausted" };

    let outcome;
    try {
      outcome = await pending.join(key, () => chain.submitCharge(target));
    } catch (err) {
      budget.refund(nowMs);
      log(`submit failed period=${schedule.nextPeriod}: ${safeReason(err)}`);
      return failure(safeReason(err));
    }

    const txHash = outcome.value?.txHash;
    if (typeof txHash !== "string" || txHash === "") {
      budget.refund(nowMs);
      return failure("the charge could not be submitted right now");
    }

    if (outcome.joined) {
      // Someone else's transaction, not ours: give the reserved slot back.
      budget.refund(nowMs);
      return submitted(txHash);
    }

    cooldowns.mark("charge", ip, nowMs);
    pending.remember(key, txHash, nowMs);
    persist();
    log(`charge submitted period=${schedule.nextPeriod} tx=${txHash} used=${budget.used(nowMs)}/${budget.max}`);
    return submitted(txHash);
  };
}
