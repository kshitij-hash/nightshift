// The tier gate against a real vault: a schedule subscribed through the
// MockPrivacyPool, then a gate deployed pointing at that vault. The gate is
// only ever a reader of the vault, so every revert below is one of its own.
//
// The key the gate checks comes from the vault (owner_key_of), so the harness
// signs with the keypair whose public half went into the Schedule at subscribe.
// There is no registration step to set up and none to attack.
//
// Anti-replay set: a presentation signed for one verifier at another verifier,
// one signed for one expiry stretched to another, one signed for one nonce
// reused with another, and the same signed tuple replayed a second time
// (NG_PRESENTED). A fresh nonce lets the same subscriber return to the same
// door. Liveness set: a presentation for a subscription the vault no longer
// calls active (cancelled, or out of periods, or unknown). Paid-current set:
// a presentation while a period is due-but-uncharged (NG_ARREARS), and the
// same subscription clearing once a keeper charges it. Bounds: an expiry
// signed too far ahead (NG_EXPIRY_TOO_FAR). Key binding: a stranger's key and a
// well-formed key the vault simply did not record both die NG_BAD_SIGNATURE.
// Plus the vault() pin view.

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
    ContractClassTrait, DeclareResultTrait, EventSpyAssertionsTrait, declare, spy_events,
    start_cheat_block_number, start_cheat_caller_address, stop_cheat_caller_address,
};
use starknet::ContractAddress;

const TIER_0: u128 = 100_000000000000000000;
const TIER_1: u128 = 500_000000000000000000;
/// Block the subscription starts at, and the block the gate sits at unless a
/// test moves it.
const START: u64 = 100;
const VERIFIER: felt252 = 'club-door';
const EXPIRY: u64 = 500;
/// A nonce the subscriber picks per presentation. Any felt works; a second
/// presentation to the same door just needs a different one.
const NONCE: felt252 = 'n-1';

type Keys = snforge_std::signature::KeyPair<felt252, felt252>;

/// Subscribe `n` periods at tier 1 through the pool, then deploy a gate over
/// that vault. Returns the pieces every test needs plus the subscriber's key:
/// `ok.public_key` is the Schedule's owner_key, so it is exactly what the vault
/// stores and what the gate will read back.
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
    (vault, INightshiftGateDispatcher { contract_address: gate_addr }, creator_id, ok)
}

/// setup, plus period 0 charged so periods_due == 0. `present` only clears the
/// arrears check on a subscription that is genuinely paid through now, so the
/// happy-path tests charge first.
fn caught_up(n: u32) -> (INightshiftVaultDispatcher, INightshiftGateDispatcher, felt252, Keys) {
    let (vault, gate, creator_id, ok) = setup(n);
    vault.charge('c-1');
    (vault, gate, creator_id, ok)
}

#[test]
fn present_returns_tier_and_emits() {
    // The happy path is "active and paid current": caught_up charges period 0 so
    // periods_due == 0. No registration happened anywhere; the signing key is
    // the one the vault recorded at subscribe. Presented carries creator_id.
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
#[should_panic(expected: 'NG_BAD_SIGNATURE')]
fn presentation_is_bound_to_one_verifier() {
    // The door the subscriber signed for is inside the message. A verifier that
    // records a presentation cannot walk it over to another verifier.
    let (_, gate, _, ok) = setup(3);
    let (r, s) = ok.sign(present_nonce_message('c-1', VERIFIER, EXPIRY, NONCE)).unwrap();
    gate.present('c-1', 'other-door', EXPIRY, NONCE, r, s);
}

#[test]
#[should_panic(expected: 'NG_BAD_SIGNATURE')]
fn presentation_is_bound_to_its_expiry() {
    // Stretching the expiry to keep a captured presentation alive changes the
    // message, so the signature stops matching.
    let (_, gate, _, ok) = setup(3);
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
    // credential exactly once: the nullifier burns on first use, so the second
    // identical call reverts.
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
fn present_with_a_due_period_dies() {
    // is_active is not "paid up": a period whose block arrived but was never
    // charged blocks the presentation until a keeper catches it up. setup(3)
    // does not charge, so period 0 is due-but-uncharged at START.
    let (_, gate, _, ok) = setup(3);
    let (r, s) = ok.sign(present_nonce_message('c-1', VERIFIER, EXPIRY, NONCE)).unwrap();
    gate.present('c-1', VERIFIER, EXPIRY, NONCE, r, s);
}

#[test]
fn present_succeeds_once_the_due_period_is_charged() {
    // The same subscription as present_with_a_due_period_dies, now caught up:
    // charging period 0 clears periods_due and the presentation goes through.
    let (vault, gate, creator_id, ok) = setup(3);
    vault.charge('c-1');
    let (r, s) = ok.sign(present_nonce_message('c-1', VERIFIER, EXPIRY, NONCE)).unwrap();
    let (c, t) = gate.present('c-1', VERIFIER, EXPIRY, NONCE, r, s);
    assert(c == creator_id && t == 1, 'caught-up present');
}

#[test]
#[should_panic(expected: 'NG_EXPIRY_TOO_FAR')]
fn present_with_a_far_expiry_dies() {
    // A captured presentation cannot be signed far out: expiry is capped at
    // MAX_PRESENT_WINDOW (one PERIOD_HOUR) ahead of now.
    let (_, gate, _, ok) = setup(3);
    let far = START + PERIOD_HOUR + 1;
    let (r, s) = ok.sign(present_nonce_message('c-1', VERIFIER, far, NONCE)).unwrap();
    gate.present('c-1', VERIFIER, far, NONCE, r, s);
}

#[test]
#[should_panic(expected: 'NG_EXPIRED')]
fn present_past_expiry_dies() {
    let (_, gate, _, ok) = setup(3);
    let (r, s) = ok.sign(present_nonce_message('c-1', VERIFIER, EXPIRY, NONCE)).unwrap();
    start_cheat_block_number(gate.contract_address, EXPIRY + 1);
    gate.present('c-1', VERIFIER, EXPIRY, NONCE, r, s);
}

#[test]
#[should_panic(expected: 'NG_BAD_SIGNATURE')]
fn present_rejects_a_stranger_key() {
    // A key with no relationship to the subscription at all.
    let (_, gate, _, _) = setup(3);
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
    // Cancelling at the vault revokes access at the gate in the same block,
    // with no gate-side bookkeeping to keep in step.
    let (vault, gate, _, ok) = setup(3);
    let (cr, cs) = ok.sign(cancel_message('c-1')).unwrap();
    vault.cancel('c-1', cr, cs);
    let (r, s) = ok.sign(present_nonce_message('c-1', VERIFIER, EXPIRY, NONCE)).unwrap();
    gate.present('c-1', VERIFIER, EXPIRY, NONCE, r, s);
}

#[test]
#[should_panic(expected: 'NG_NOT_ACTIVE')]
fn present_after_escrow_exhausted_dies() {
    // A subscription that ran out of periods is not cancelled, just spent. The
    // gate reads liveness from the vault, so it closes anyway.
    let (vault, gate, _, ok) = setup(2);
    start_cheat_block_number(vault.contract_address, START + PERIOD_HOUR * 4);
    vault.charge('c-1');
    vault.charge('c-1');
    let (r, s) = ok.sign(present_nonce_message('c-1', VERIFIER, EXPIRY, NONCE)).unwrap();
    gate.present('c-1', VERIFIER, EXPIRY, NONCE, r, s);
}

#[test]
#[should_panic(expected: 'NG_NOT_ACTIVE')]
fn present_for_unknown_commitment_dies() {
    // Liveness is checked before the key is read, so an unknown commitment fails
    // as not active. The zero-key check behind it says the same thing twice.
    let (_, gate, _, ok) = setup(3);
    let (r, s) = ok.sign(present_nonce_message('ghost', VERIFIER, EXPIRY, NONCE)).unwrap();
    gate.present('ghost', VERIFIER, EXPIRY, NONCE, r, s);
}
