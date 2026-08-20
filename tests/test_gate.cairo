// The tier gate against a real vault: a schedule subscribed through the
// MockPrivacyPool, then a gate deployed pointing at that vault. The gate is
// only ever a reader of the vault, so every revert below is one of its own.
//
// The key the gate checks comes from the vault (owner_key_of), so the harness
// signs with the keypair whose public half went into the Schedule at subscribe.
// There is no registration step to set up and none to attack.
//
// The caller is the verifier: `present` requires get_caller_address() ==
// verifier_id, so every test here cheats the gate's caller to the door's own
// address and signs that address as the verifier id.
//
// One clock. On mainnet get_block_number() returns the same height inside the
// gate and inside the vault it calls; snforge cheats block number per contract
// address, so `set_block` moves both together. A test that moved only one would
// be testing a chain that cannot exist, which is exactly how the old
// arrears-at-the-gate check looked correct while it was not.
//
// Anti-replay set: a presentation signed for one verifier at another verifier,
// one signed for one expiry stretched to another, one signed for one nonce
// reused with another, and the same signed tuple replayed a second time
// (NG_PRESENTED). A fresh nonce lets the same subscriber return to the same
// door. Griefing: a copied presentation submitted by anyone but its addressee
// (NG_WRONG_VERIFIER). Liveness set: a presentation for a subscription that is
// cancelled or unknown. Paid-through-now set: before period 0 is charged
// (NG_ARREARS), inside the window a charge just paid for, during the FINAL
// period after the final charge, and past the end of the paid window. The
// n_periods = 1 subscription gets that sequence end to end. Bounds: an expiry
// signed too far ahead (NG_EXPIRY_TOO_FAR). Key binding: a stranger's key and a
// well-formed key the vault simply did not record both die NG_BAD_SIGNATURE.
// Plus the vault() pin view and the raw keys of the Presented event.

use nightshift::common::{PERIOD_HOUR, Schedule, VaultOp, cancel_message, present_nonce_message};
use nightshift::gate::{INightshiftGateDispatcher, INightshiftGateDispatcherTrait, NightshiftGate};
use nightshift::mocks::{
    IMockERC20Dispatcher, IMockERC20DispatcherTrait, IMockPrivacyPoolDispatcher,
    IMockPrivacyPoolDispatcherTrait,
};
use nightshift::vault::{INightshiftVaultDispatcher, INightshiftVaultDispatcherTrait};
use snforge_std::signature::KeyPairTrait;
use snforge_std::signature::stark_curve::{StarkCurveKeyPairImpl, StarkCurveSignerImpl};
use snforge_std::{
    ContractClassTrait, DeclareResultTrait, EventSpyAssertionsTrait, EventSpyTrait,
    EventsFilterTrait, declare, spy_events, start_cheat_block_number, start_cheat_caller_address,
    stop_cheat_caller_address,
};
use starknet::ContractAddress;

const TIER_0: u128 = 100_000000000000000000;
const TIER_1: u128 = 500_000000000000000000;
/// Block the subscription starts at, and the block both contracts sit at unless
/// a test moves them.
const START: u64 = 100;
/// The verifier id IS the verifier's address. This felt is both: the tests cheat
/// the gate's caller to it and sign it into the presentation message.
const VERIFIER: felt252 = 'club-door';
const EXPIRY: u64 = 500;
/// A nonce the subscriber picks per presentation. Any felt works; a second
/// presentation to the same door just needs a different one.
const NONCE: felt252 = 'n-1';

type Keys = snforge_std::signature::KeyPair<felt252, felt252>;

fn verifier_address() -> ContractAddress {
    VERIFIER.try_into().unwrap()
}

/// Move the chain. Both contracts, always: one chain has one height, and the
/// gate's paid-window arithmetic reads the vault's schedule against the gate's
/// own get_block_number().
fn set_block(vault: INightshiftVaultDispatcher, gate: INightshiftGateDispatcher, n: u64) {
    start_cheat_block_number(vault.contract_address, n);
    start_cheat_block_number(gate.contract_address, n);
}

/// Subscribe `n` periods at tier 1 through the pool, then deploy a gate over
/// that vault. Returns the pieces every test needs plus the subscriber's key:
/// `ok.public_key` is the Schedule's owner_key, so it is exactly what the vault
/// stores and what the gate will read back. Leaves the gate's caller cheated to
/// the verifier's address, since `present` refuses any other caller.
fn setup(n: u32) -> (INightshiftVaultDispatcher, INightshiftGateDispatcher, felt252, Keys) {
    let (pool_addr, _) = declare("MockPrivacyPool").unwrap().contract_class().deploy(@array![]).unwrap();
    let (token_addr, _) = declare("MockERC20").unwrap().contract_class().deploy(@array![]).unwrap();
    let pool = IMockPrivacyPoolDispatcher { contract_address: pool_addr };
    let token = IMockERC20Dispatcher { contract_address: token_addr };
    let (vault_addr, _) = declare("NightshiftVault").unwrap().contract_class()
        .deploy(@array![pool_addr.into()]).unwrap();
    let vault = INightshiftVaultDispatcher { contract_address: vault_addr };
    token.mint(pool_addr, 1_000_000_000000000000000000);

    let ck = KeyPairTrait::<felt252, felt252>::generate();
    let ok = KeyPairTrait::<felt252, felt252>::generate();
    let creator: ContractAddress = 'creator'.try_into().unwrap();
    start_cheat_caller_address(vault_addr, creator);
    let creator_id = vault.register_creator(token_addr, ck.public_key, array![TIER_0, TIER_1].span());
    stop_cheat_caller_address(vault_addr);

    start_cheat_block_number(vault_addr, START);
    pool.transfer_to(token_addr, vault_addr, (TIER_1 * n.into()).into());
    let op = VaultOp::Subscribe(Schedule {
        commitment: 'c-1', creator_id, tier: 1, period_blocks: PERIOD_HOUR, n_periods: n,
        owner_key: ok.public_key,
    });
    let mut cd = array![];
    op.serialize(ref cd);
    pool.invoke_external(vault_addr, cd.span(), 0);

    let (gate_addr, _) = declare("NightshiftGate").unwrap().contract_class()
        .deploy(@array![vault_addr.into()]).unwrap();
    start_cheat_block_number(gate_addr, START);
    start_cheat_caller_address(gate_addr, verifier_address());
    (vault, INightshiftGateDispatcher { contract_address: gate_addr }, creator_id, ok)
}

/// setup, plus period 0 charged. `present` admits only a subscription paid
/// through the current block, so the happy-path tests charge first.
fn caught_up(n: u32) -> (INightshiftVaultDispatcher, INightshiftGateDispatcher, felt252, Keys) {
    let (vault, gate, creator_id, ok) = setup(n);
    vault.charge('c-1');
    (vault, gate, creator_id, ok)
}

#[test]
fn present_returns_tier_and_emits() {
    // The happy path is "paid through now": caught_up charges period 0, so the
    // subscription is paid up to START + PERIOD_HOUR and START is inside that.
    // No registration happened anywhere; the signing key is the one the vault
    // recorded at subscribe. Presented carries creator_id.
    let (vault, gate, creator_id, ok) = caught_up(3);
    assert(vault.owner_key_of('c-1') == ok.public_key, 'vault key not the signer');

    let mut spy = spy_events();
    let (r, s) = ok.sign(present_nonce_message('c-1', VERIFIER, EXPIRY, NONCE)).unwrap();
    let (got_creator, got_tier) = gate.present('c-1', VERIFIER, EXPIRY, NONCE, r, s);
    assert(got_creator == creator_id, 'wrong creator');
    assert(got_tier == 1, 'wrong tier');

    spy
        .assert_emitted(
            @array![
                (
                    gate.contract_address,
                    NightshiftGate::Event::Presented(
                        NightshiftGate::Presented {
                            commitment: 'c-1',
                            verifier_id: VERIFIER,
                            expiry_block: EXPIRY,
                            creator_id,
                            tier: 1,
                        },
                    ),
                ),
            ],
        );
}

#[test]
fn presented_indexes_commitment_and_verifier() {
    // getEvents filters on keys, not data. Both `commitment` and `verifier_id`
    // sit in the keys, so a verifier pulls its own door's admissions, and an
    // indexer pulls one subscription's, straight from the node. Read the raw
    // event: a decoded-struct assertion passes either way, so it would not catch
    // a field slipping back into the data.
    let (_, gate, creator_id, ok) = caught_up(3);
    let mut spy = spy_events();
    let (r, s) = ok.sign(present_nonce_message('c-1', VERIFIER, EXPIRY, NONCE)).unwrap();
    gate.present('c-1', VERIFIER, EXPIRY, NONCE, r, s);

    let gate_events = spy.get_events().emitted_by(gate.contract_address);
    assert(gate_events.events.len() == 1, 'expected one gate event');
    let (_, event) = gate_events.events.at(0);
    // keys[0] is the event selector; the two indexed fields follow it.
    assert(event.keys.len() == 3, 'commitment/verifier not keys');
    assert(*event.keys.at(1) == 'c-1', 'wrong indexed commitment');
    assert(*event.keys.at(2) == VERIFIER, 'wrong indexed verifier');
    // expiry_block, creator_id and tier stay in the data.
    assert(event.data.len() == 3, 'unexpected data layout');
    assert(*event.data.at(0) == EXPIRY.into(), 'expiry not in data');
    assert(*event.data.at(1) == creator_id, 'creator_id not in data');
}

#[test]
fn views_pass_through_the_vault() {
    let (_, gate, creator_id, _) = setup(3);
    assert(gate.is_active('c-1'), 'not active');
    let (c, t) = gate.tier_of('c-1');
    assert(c == creator_id && t == 1, 'wrong schedule');
    // A commitment the vault never saw reads as the vault's empty storage does.
    assert(!gate.is_active('nobody'), 'unknown is active');
    let (c2, t2) = gate.tier_of('nobody');
    assert(c2 == 0 && t2 == 0, 'unknown not zero');
}

#[test]
fn vault_view_returns_the_target() {
    // A verifier pins the canonical gate by confirming the vault it reads.
    let (vault, gate, _, _) = setup(3);
    assert(gate.vault() == vault.contract_address, 'wrong vault target');
}

#[test]
#[should_panic(expected: 'NG_WRONG_VERIFIER')]
fn present_submitted_by_a_bystander_dies() {
    // The griefing case. A presentation signed for 'club-door' is visible in the
    // mempool; anyone can copy the calldata and submit it first. Landing it
    // would burn the nullifier and leave the subscriber's own call reverting
    // NG_PRESENTED. It cannot land: the signed verifier_id is not the
    // bystander's address.
    let (_, gate, _, ok) = caught_up(3);
    let (r, s) = ok.sign(present_nonce_message('c-1', VERIFIER, EXPIRY, NONCE)).unwrap();
    let bystander: ContractAddress = 'bystander'.try_into().unwrap();
    start_cheat_caller_address(gate.contract_address, bystander);
    gate.present('c-1', VERIFIER, EXPIRY, NONCE, r, s);
}

#[test]
#[should_panic(expected: 'NG_BAD_SIGNATURE')]
fn presentation_is_bound_to_one_verifier() {
    // The door the subscriber signed for is inside the message. Verifier B, who
    // recorded a presentation made to verifier A, cannot walk it over to its own
    // door: presenting as itself changes the message, so the signature stops
    // matching. (Presenting it as A instead dies earlier, NG_WRONG_VERIFIER.)
    let (_, gate, _, ok) = caught_up(3);
    let (r, s) = ok.sign(present_nonce_message('c-1', VERIFIER, EXPIRY, NONCE)).unwrap();
    let other_door: ContractAddress = 'other-door'.try_into().unwrap();
    start_cheat_caller_address(gate.contract_address, other_door);
    gate.present('c-1', 'other-door', EXPIRY, NONCE, r, s);
}

#[test]
#[should_panic(expected: 'NG_BAD_SIGNATURE')]
fn presentation_is_bound_to_its_expiry() {
    // Stretching the expiry to keep a captured presentation alive changes the
    // message, so the signature stops matching.
    let (_, gate, _, ok) = caught_up(3);
    let (r, s) = ok.sign(present_nonce_message('c-1', VERIFIER, EXPIRY, NONCE)).unwrap();
    gate.present('c-1', VERIFIER, EXPIRY + 1, NONCE, r, s);
}

#[test]
#[should_panic(expected: 'NG_BAD_SIGNATURE')]
fn presentation_is_bound_to_its_nonce() {
    // The nonce is inside the signed message too, so a captured (r, s) cannot be
    // replayed under a fresh nonce to dodge the nullifier.
    let (_, gate, _, ok) = caught_up(3);
    let (r, s) = ok.sign(present_nonce_message('c-1', VERIFIER, EXPIRY, NONCE)).unwrap();
    gate.present('c-1', VERIFIER, EXPIRY, 'n-2', r, s);
}

#[test]
#[should_panic(expected: 'NG_PRESENTED')]
fn present_replayed_same_tuple_dies() {
    // A captured (commitment, verifier_id, expiry, nonce, r, s) is a bearer
    // credential exactly once, and only in the verifier's own hands: the
    // nullifier burns on first use, so the second identical call reverts.
    let (_, gate, _, ok) = caught_up(3);
    let (r, s) = ok.sign(present_nonce_message('c-1', VERIFIER, EXPIRY, NONCE)).unwrap();
    gate.present('c-1', VERIFIER, EXPIRY, NONCE, r, s);
    gate.present('c-1', VERIFIER, EXPIRY, NONCE, r, s);
}

#[test]
fn present_again_with_fresh_nonce_succeeds() {
    // The subscriber legitimately returns to the same door by signing a new
    // nonce: a new tuple with its own unburned nullifier.
    let (_, gate, _, ok) = caught_up(3);
    let (r1, s1) = ok.sign(present_nonce_message('c-1', VERIFIER, EXPIRY, NONCE)).unwrap();
    let (c1, t1) = gate.present('c-1', VERIFIER, EXPIRY, NONCE, r1, s1);
    assert(c1 != 0 && t1 == 1, 'first present');
    let (r2, s2) = ok.sign(present_nonce_message('c-1', VERIFIER, EXPIRY, 'n-2')).unwrap();
    let (_c2, t2) = gate.present('c-1', VERIFIER, EXPIRY, 'n-2', r2, s2);
    assert(t2 == 1, 'second present');
}

#[test]
#[should_panic(expected: 'NG_ARREARS')]
fn present_before_period_zero_is_charged_dies() {
    // Nothing has been paid for yet. next == 0 buys no window at all, so a
    // just-subscribed subscription cannot present until a keeper charges it.
    let (_, gate, _, ok) = setup(3);
    let (r, s) = ok.sign(present_nonce_message('c-1', VERIFIER, EXPIRY, NONCE)).unwrap();
    gate.present('c-1', VERIFIER, EXPIRY, NONCE, r, s);
}

#[test]
fn present_succeeds_once_the_due_period_is_charged() {
    // The same subscription as present_before_period_zero_is_charged_dies, now
    // caught up: charging period 0 pays through START + PERIOD_HOUR and the
    // presentation goes through.
    let (vault, gate, creator_id, ok) = setup(3);
    vault.charge('c-1');
    let (r, s) = ok.sign(present_nonce_message('c-1', VERIFIER, EXPIRY, NONCE)).unwrap();
    let (c, t) = gate.present('c-1', VERIFIER, EXPIRY, NONCE, r, s);
    assert(c == creator_id && t == 1, 'caught-up present');
}

#[test]
#[should_panic(expected: 'NG_ARREARS')]
fn present_after_the_paid_window_lapses_dies() {
    // A keeper that stopped charging. Period 0 was paid at START, so the window
    // ends at START + PERIOD_HOUR; one block into the next, unpaid period the
    // presentation is refused, even though the schedule has periods left and the
    // vault still calls the subscription active.
    let (vault, gate, _, ok) = setup(3);
    vault.charge('c-1');
    let now = START + PERIOD_HOUR;
    set_block(vault, gate, now);
    assert(vault.is_active('c-1'), 'vault should still be active');
    let exp = now + 100;
    let (r, s) = ok.sign(present_nonce_message('c-1', VERIFIER, exp, NONCE)).unwrap();
    gate.present('c-1', VERIFIER, exp, NONCE, r, s);
}

#[test]
fn present_during_the_final_period_succeeds() {
    // The blocker, in its plainest form. n = 2: charging period 1 is the last
    // charge, and it drops vault.is_active to false the instant the subscriber
    // is fully paid. The subscriber has just paid for the period they are
    // standing in, so the gate must still admit them.
    let (vault, gate, creator_id, ok) = setup(2);
    vault.charge('c-1'); // period 0, due at START
    let now = START + PERIOD_HOUR;
    set_block(vault, gate, now);
    vault.charge('c-1'); // period 1, the final one, due now
    assert(!vault.is_active('c-1'), 'is_active should be false');

    let exp = now + 100;
    let (r, s) = ok.sign(present_nonce_message('c-1', VERIFIER, exp, NONCE)).unwrap();
    let (c, t) = gate.present('c-1', VERIFIER, exp, NONCE, r, s);
    assert(c == creator_id && t == 1, 'final period present');
}

#[test]
#[should_panic(expected: 'NG_ARREARS')]
fn present_after_the_last_period_runs_out_dies() {
    // The other side of present_during_the_final_period_succeeds. Both periods
    // are charged, so the subscription is paid through START + PERIOD_HOUR * 2
    // and not one block further. At that height the schedule is genuinely spent
    // and access ends.
    let (vault, gate, _, ok) = setup(2);
    set_block(vault, gate, START + PERIOD_HOUR);
    vault.charge('c-1');
    vault.charge('c-1');
    let now = START + PERIOD_HOUR * 2;
    set_block(vault, gate, now);
    let exp = now + 100;
    let (r, s) = ok.sign(present_nonce_message('c-1', VERIFIER, exp, NONCE)).unwrap();
    gate.present('c-1', VERIFIER, exp, NONCE, r, s);
}

// --- n_periods = 1, end to end ---
// The single-period subscription is the case the old is_active check could
// never serve: its one charge both pays for the whole schedule and exhausts it.
// Three tests walk the whole life of one: before the charge, inside the window
// it buys, and after that window closes.

#[test]
#[should_panic(expected: 'NG_ARREARS')]
fn single_period_present_before_the_charge_dies() {
    let (_, gate, _, ok) = setup(1);
    let (r, s) = ok.sign(present_nonce_message('c-1', VERIFIER, EXPIRY, NONCE)).unwrap();
    gate.present('c-1', VERIFIER, EXPIRY, NONCE, r, s);
}

#[test]
fn single_period_present_inside_the_window_succeeds() {
    // Under the old check this reverted forever: charging the only period sets
    // next == n == 1, so is_active went false in the same call that paid for the
    // period, and an n_periods = 1 subscription was never presentable at all.
    let (vault, gate, creator_id, ok) = setup(1);
    vault.charge('c-1');
    assert(!vault.is_active('c-1'), 'is_active should be false');

    let (r, s) = ok.sign(present_nonce_message('c-1', VERIFIER, EXPIRY, NONCE)).unwrap();
    let (c, t) = gate.present('c-1', VERIFIER, EXPIRY, NONCE, r, s);
    assert(c == creator_id && t == 1, 'single-period present');
}

#[test]
#[should_panic(expected: 'NG_ARREARS')]
fn single_period_present_after_the_window_dies() {
    // The period bought exactly PERIOD_HOUR blocks. START + PERIOD_HOUR is the
    // first block it does not cover.
    let (vault, gate, _, ok) = setup(1);
    vault.charge('c-1');
    let now = START + PERIOD_HOUR;
    set_block(vault, gate, now);
    let exp = now + 100;
    let (r, s) = ok.sign(present_nonce_message('c-1', VERIFIER, exp, NONCE)).unwrap();
    gate.present('c-1', VERIFIER, exp, NONCE, r, s);
}

#[test]
#[should_panic(expected: 'NG_EXPIRY_TOO_FAR')]
fn present_with_a_far_expiry_dies() {
    // A captured presentation cannot be signed far out: expiry is capped at
    // MAX_PRESENT_WINDOW (one PERIOD_HOUR) ahead of now.
    let (_, gate, _, ok) = caught_up(3);
    let far = START + PERIOD_HOUR + 1;
    let (r, s) = ok.sign(present_nonce_message('c-1', VERIFIER, far, NONCE)).unwrap();
    gate.present('c-1', VERIFIER, far, NONCE, r, s);
}

#[test]
#[should_panic(expected: 'NG_EXPIRED')]
fn present_past_expiry_dies() {
    // Still paid through (period 0 covers up to START + PERIOD_HOUR), so the
    // only thing wrong here is the height the subscriber signed.
    let (vault, gate, _, ok) = caught_up(3);
    let (r, s) = ok.sign(present_nonce_message('c-1', VERIFIER, EXPIRY, NONCE)).unwrap();
    set_block(vault, gate, EXPIRY + 1);
    gate.present('c-1', VERIFIER, EXPIRY, NONCE, r, s);
}

#[test]
#[should_panic(expected: 'NG_BAD_SIGNATURE')]
fn present_rejects_a_stranger_key() {
    // A key with no relationship to the subscription at all.
    let (_, gate, _, _) = caught_up(3);
    let attacker = KeyPairTrait::<felt252, felt252>::generate();
    let (r, s) = attacker.sign(present_nonce_message('c-1', VERIFIER, EXPIRY, NONCE)).unwrap();
    gate.present('c-1', VERIFIER, EXPIRY, NONCE, r, s);
}

#[test]
#[should_panic(expected: 'NG_BAD_SIGNATURE')]
fn present_binds_to_the_exact_key_the_vault_recorded() {
    // The property the gate reads from the vault to get. `other` is a perfectly
    // well-formed keypair whose holder controls it and can sign anything asked
    // of them, including a self-attested registration for this commitment. It
    // still fails, because the only key that admits is the one sitting in the
    // vault against 'c-1'.
    let (vault, gate, _, ok) = caught_up(3);
    let other = KeyPairTrait::<felt252, felt252>::generate();
    assert(vault.owner_key_of('c-1') == ok.public_key, 'vault key moved');
    assert(other.public_key != ok.public_key, 'keys collided');
    let (r, s) = other.sign(present_nonce_message('c-1', VERIFIER, EXPIRY, NONCE)).unwrap();
    gate.present('c-1', VERIFIER, EXPIRY, NONCE, r, s);
}

#[test]
#[should_panic(expected: 'NG_NOT_ACTIVE')]
fn present_after_cancel_dies() {
    // Cancelling at the vault revokes access at the gate in the same block, with
    // no gate-side bookkeeping to keep in step — and it revokes the paid window
    // too, since the escrow behind it becomes reclaimable.
    let (vault, gate, _, ok) = caught_up(3);
    let (cr, cs) = ok.sign(cancel_message('c-1')).unwrap();
    vault.cancel('c-1', cr, cs);
    let (r, s) = ok.sign(present_nonce_message('c-1', VERIFIER, EXPIRY, NONCE)).unwrap();
    gate.present('c-1', VERIFIER, EXPIRY, NONCE, r, s);
}

#[test]
#[should_panic(expected: 'NG_NOT_ACTIVE')]
fn present_for_unknown_commitment_dies() {
    // The schedule read comes back empty, so the commitment fails as not active
    // before the key is read. The zero-key check behind it says the same thing
    // twice.
    let (_, gate, _, ok) = setup(3);
    let (r, s) = ok.sign(present_nonce_message('ghost', VERIFIER, EXPIRY, NONCE)).unwrap();
    gate.present('ghost', VERIFIER, EXPIRY, NONCE, r, s);
}
