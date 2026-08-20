// The tier gate against a real vault: a schedule subscribed through the
// MockPrivacyPool, then a gate deployed pointing at that vault. The gate is
// only ever a reader of the vault, so every revert below is one of its own.
//
// Anti-replay set: a presentation signed for one verifier at another verifier,
// a presentation past its expiry height, and a presentation for a subscription
// the vault no longer calls active (cancelled, or out of periods). Plus the
// enrollment race the module doc-comment admits to: wrong signer rejected,
// second enrollment rejected.

use nightshift::common::{PERIOD_HOUR, Schedule, VaultOp, cancel_message, enroll_message, present_message};
use nightshift::gate::{INightshiftGateDispatcher, INightshiftGateDispatcherTrait, NightshiftGate};
use nightshift::mocks::{IMockERC20Dispatcher, IMockERC20DispatcherTrait, IMockPrivacyPoolDispatcher, IMockPrivacyPoolDispatcherTrait};
use nightshift::vault::{INightshiftVaultDispatcher, INightshiftVaultDispatcherTrait};
use snforge_std::signature::KeyPairTrait;
use snforge_std::signature::stark_curve::{StarkCurveKeyPairImpl, StarkCurveSignerImpl};
use snforge_std::{ContractClassTrait, DeclareResultTrait, EventSpyAssertionsTrait, declare, spy_events, start_cheat_block_number, start_cheat_caller_address, stop_cheat_caller_address};
use starknet::ContractAddress;

const TIER_0: u128 = 100_000000000000000000;
const TIER_1: u128 = 500_000000000000000000;
/// Block the subscription starts at, and the block the gate sits at unless a
/// test moves it.
const START: u64 = 100;
const VERIFIER: felt252 = 'club-door';
const EXPIRY: u64 = 500;

type Keys = snforge_std::signature::KeyPair<felt252, felt252>;

/// Subscribe `n` periods at tier 1 through the pool, then deploy a gate over
/// that vault. Returns the pieces every test needs plus the subscriber's key.
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

fn enrolled(n: u32) -> (INightshiftVaultDispatcher, INightshiftGateDispatcher, felt252, Keys) {
    let (vault, gate, creator_id, ok) = setup(n);
    let (r, s) = ok.sign(enroll_message('c-1', ok.public_key)).unwrap();
    gate.enroll('c-1', ok.public_key, r, s);
    (vault, gate, creator_id, ok)
}

#[test]
fn enroll_then_present_returns_tier_and_emits() {
    let (_, gate, creator_id, ok) = enrolled(3);
    assert(gate.enrolled_key('c-1') == ok.public_key, 'key not registered');

    let mut spy = spy_events();
    let (r, s) = ok.sign(present_message('c-1', VERIFIER, EXPIRY)).unwrap();
    let (got_creator, got_tier) = gate.present('c-1', VERIFIER, EXPIRY, r, s);
    assert(got_creator == creator_id, 'wrong creator');
    assert(got_tier == 1, 'wrong tier');

    spy
        .assert_emitted(
            @array![
                (
                    gate.contract_address,
                    NightshiftGate::Event::Presented(
                        NightshiftGate::Presented {
                            commitment: 'c-1', verifier_id: VERIFIER, expiry_block: EXPIRY, tier: 1,
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
#[should_panic(expected: 'NG_BAD_SIGNATURE')]
fn enroll_rejects_wrong_signer() {
    let (_, gate, _, ok) = setup(3);
    // The registration signature is checked against the key being registered,
    // so a third party cannot register somebody else's key for them.
    let attacker = KeyPairTrait::<felt252, felt252>::generate();
    let (r, s) = attacker.sign(enroll_message('c-1', ok.public_key)).unwrap();
    gate.enroll('c-1', ok.public_key, r, s);
}

#[test]
#[should_panic(expected: 'NG_ALREADY_ENROLLED')]
fn enroll_is_write_once() {
    // First-enrollment-wins is the whole of the key-to-subscription binding:
    // prove the second write is refused even with a signature that verifies.
    let (_, gate, _, _) = enrolled(3);
    let other = KeyPairTrait::<felt252, felt252>::generate();
    let (r, s) = other.sign(enroll_message('c-1', other.public_key)).unwrap();
    gate.enroll('c-1', other.public_key, r, s);
}

#[test]
#[should_panic(expected: 'NG_NOT_ENROLLED')]
fn present_before_enrollment_dies() {
    let (_, gate, _, ok) = setup(3);
    let (r, s) = ok.sign(present_message('c-1', VERIFIER, EXPIRY)).unwrap();
    gate.present('c-1', VERIFIER, EXPIRY, r, s);
}

#[test]
#[should_panic(expected: 'NG_BAD_SIGNATURE')]
fn presentation_is_bound_to_one_verifier() {
    // The door the subscriber signed for is inside the message. A verifier that
    // records a presentation cannot walk it over to another verifier.
    let (_, gate, _, ok) = enrolled(3);
    let (r, s) = ok.sign(present_message('c-1', VERIFIER, EXPIRY)).unwrap();
    gate.present('c-1', 'other-door', EXPIRY, r, s);
}

#[test]
#[should_panic(expected: 'NG_BAD_SIGNATURE')]
fn presentation_is_bound_to_its_expiry() {
    // Stretching the expiry to keep a captured presentation alive changes the
    // message, so the signature stops matching.
    let (_, gate, _, ok) = enrolled(3);
    let (r, s) = ok.sign(present_message('c-1', VERIFIER, EXPIRY)).unwrap();
    gate.present('c-1', VERIFIER, EXPIRY + 1, r, s);
}

#[test]
#[should_panic(expected: 'NG_EXPIRED')]
fn present_past_expiry_dies() {
    let (_, gate, _, ok) = enrolled(3);
    let (r, s) = ok.sign(present_message('c-1', VERIFIER, EXPIRY)).unwrap();
    start_cheat_block_number(gate.contract_address, EXPIRY + 1);
    gate.present('c-1', VERIFIER, EXPIRY, r, s);
}

#[test]
#[should_panic(expected: 'NG_BAD_SIGNATURE')]
fn present_rejects_a_key_that_is_not_the_enrolled_one() {
    let (_, gate, _, _) = enrolled(3);
    let attacker = KeyPairTrait::<felt252, felt252>::generate();
    let (r, s) = attacker.sign(present_message('c-1', VERIFIER, EXPIRY)).unwrap();
    gate.present('c-1', VERIFIER, EXPIRY, r, s);
}

#[test]
#[should_panic(expected: 'NG_NOT_ACTIVE')]
fn present_after_cancel_dies() {
    // Cancelling at the vault revokes access at the gate in the same block,
    // with no gate-side bookkeeping to keep in step.
    let (vault, gate, _, ok) = enrolled(3);
    let (cr, cs) = ok.sign(cancel_message('c-1')).unwrap();
    vault.cancel('c-1', cr, cs);
    let (r, s) = ok.sign(present_message('c-1', VERIFIER, EXPIRY)).unwrap();
    gate.present('c-1', VERIFIER, EXPIRY, r, s);
}

#[test]
#[should_panic(expected: 'NG_NOT_ACTIVE')]
fn present_after_escrow_exhausted_dies() {
    // A subscription that ran out of periods is not cancelled, just spent. The
    // gate reads liveness from the vault, so it closes anyway.
    let (vault, gate, _, ok) = enrolled(2);
    start_cheat_block_number(vault.contract_address, START + PERIOD_HOUR * 4);
    vault.charge('c-1');
    vault.charge('c-1');
    let (r, s) = ok.sign(present_message('c-1', VERIFIER, EXPIRY)).unwrap();
    gate.present('c-1', VERIFIER, EXPIRY, r, s);
}

#[test]
#[should_panic(expected: 'NG_NOT_ACTIVE')]
fn present_for_unknown_commitment_dies() {
    // Liveness is checked before the key is even read, so an unknown
    // commitment fails as not active rather than as not enrolled.
    let (_, gate, _, ok) = enrolled(3);
    let (r, s) = ok.sign(present_message('ghost', VERIFIER, EXPIRY)).unwrap();
    gate.present('ghost', VERIFIER, EXPIRY, r, s);
}
