// Creator-signed claim (both legs: private into a pool note, public to an
// address), subscriber-signed cancel/reclaim, and the security property that a
// keeper can never redirect funds. Uses real STARK-curve signatures.

use nightshift::common::{PERIOD_HOUR, Schedule, VaultOp, cancel_message, claim_message, claim_public_message, reclaim_message};
use nightshift::mocks::{IMockERC20Dispatcher, IMockERC20DispatcherTrait, IMockPrivacyPoolDispatcher, IMockPrivacyPoolDispatcherTrait};
use nightshift::vault::{INightshiftVaultDispatcher, INightshiftVaultDispatcherTrait};
use snforge_std::signature::stark_curve::{StarkCurveKeyPairImpl, StarkCurveSignerImpl};
use snforge_std::signature::KeyPairTrait;
use snforge_std::{ContractClassTrait, DeclareResultTrait, declare, start_cheat_block_number, start_cheat_caller_address, stop_cheat_caller_address};
use starknet::ContractAddress;

const TIER_0: u128 = 100_000000000000000000;

fn deploy() -> (IMockPrivacyPoolDispatcher, IMockERC20Dispatcher, INightshiftVaultDispatcher) {
    let (pool_addr, _) = declare("MockPrivacyPool").unwrap().contract_class().deploy(@array![]).unwrap();
    let (token_addr, _) = declare("MockERC20").unwrap().contract_class().deploy(@array![]).unwrap();
    let pool = IMockPrivacyPoolDispatcher { contract_address: pool_addr };
    let token = IMockERC20Dispatcher { contract_address: token_addr };
    let (vault_addr, _) = declare("NightshiftVault").unwrap().contract_class()
        .deploy(@array![pool_addr.into()]).unwrap();
    let vault = INightshiftVaultDispatcher { contract_address: vault_addr };
    token.mint(pool.contract_address, 1_000_000_000000000000000000);
    (pool, token, vault)
}

fn sub_calldata(commitment: felt252, creator_id: felt252, owner_pub: felt252, n: u32) -> Array<felt252> {
    let op = VaultOp::Subscribe(Schedule {
        commitment, creator_id, tier: 0, period_blocks: PERIOD_HOUR, n_periods: n, owner_key: owner_pub,
    });
    let mut cd = array![];
    op.serialize(ref cd);
    cd
}

// Register a creator, subscribe, and charge `periods` periods so claimable
// accumulates. Returns (vault, pool, token, creator_id, creator_keypair).
fn charged_up(periods: u32) -> (
    INightshiftVaultDispatcher, IMockPrivacyPoolDispatcher, IMockERC20Dispatcher, felt252,
    snforge_std::signature::KeyPair<felt252, felt252>,
) {
    let (pool, token, vault) = deploy();
    let ck = KeyPairTrait::<felt252, felt252>::generate();
    let ok = KeyPairTrait::<felt252, felt252>::generate();

    let creator: ContractAddress = 'creator'.try_into().unwrap();
    start_cheat_caller_address(vault.contract_address, creator);
    let creator_id = vault.register_creator(token.contract_address, ck.public_key, array![TIER_0].span());
    stop_cheat_caller_address(vault.contract_address);

    start_cheat_block_number(vault.contract_address, 100);
    pool.transfer_to(token.contract_address, vault.contract_address, (TIER_0 * 3).into());
    pool.invoke_external(vault.contract_address, sub_calldata('c-1', creator_id, ok.public_key, 3).span(), 0);

    let mut i: u32 = 0;
    while i != periods {
        start_cheat_block_number(vault.contract_address, 100 + PERIOD_HOUR * i.into());
        vault.charge('c-1');
        i += 1;
    }
    (vault, pool, token, creator_id, ck)
}

#[test]
fn creator_claims_with_valid_signature() {
    let (vault, pool, token, creator_id, ck) = charged_up(2);
    assert(vault.claimable_of(creator_id) == TIER_0 * 2, 'claimable wrong');

    pool.create_open_note('note-1', token.contract_address);
    let (r, s) = ck.sign(claim_message(creator_id, 'note-1', TIER_0 * 2)).unwrap();

    let op = VaultOp::Claim(nightshift::common::ClaimArgs {
        creator_id, note_id: 'note-1', amount: TIER_0 * 2, sig_r: r, sig_s: s,
    });
    let mut cd = array![];
    op.serialize(ref cd);
    pool.invoke_external(vault.contract_address, cd.span(), 1);

    assert(pool.note_amount('note-1') == TIER_0 * 2, 'note not filled');
    assert(vault.claimable_of(creator_id) == 0, 'claimable not cleared');
}

#[test]
#[should_panic(expected: 'NS_BAD_SIGNATURE')]
fn claim_rejects_wrong_signer() {
    let (vault, pool, token, creator_id, _) = charged_up(1);
    pool.create_open_note('note-1', token.contract_address);
    // Sign with an unrelated key — a hostile keeper trying to settle to itself.
    let attacker = KeyPairTrait::<felt252, felt252>::generate();
    let (r, s) = attacker.sign(claim_message(creator_id, 'note-1', TIER_0)).unwrap();
    let op = VaultOp::Claim(nightshift::common::ClaimArgs {
        creator_id, note_id: 'note-1', amount: TIER_0, sig_r: r, sig_s: s,
    });
    let mut cd = array![];
    op.serialize(ref cd);
    pool.invoke_external(vault.contract_address, cd.span(), 1);
}

#[test]
#[should_panic(expected: 'NS_BAD_SIGNATURE')]
fn claim_signature_is_bound_to_note_and_amount() {
    let (vault, pool, token, creator_id, ck) = charged_up(1);
    pool.create_open_note('note-1', token.contract_address);
    // Creator signs for note-1, but the keeper swaps in a different note id:
    // the signature no longer matches, so the redirect fails.
    let (r, s) = ck.sign(claim_message(creator_id, 'note-1', TIER_0)).unwrap();
    let op = VaultOp::Claim(nightshift::common::ClaimArgs {
        creator_id, note_id: 'other-note', amount: TIER_0, sig_r: r, sig_s: s,
    });
    let mut cd = array![];
    op.serialize(ref cd);
    pool.invoke_external(vault.contract_address, cd.span(), 1);
}

#[test]
#[should_panic(expected: 'NS_CLAIM_EXCEEDS_BALANCE')]
fn claim_cannot_exceed_claimable() {
    let (vault, pool, token, creator_id, ck) = charged_up(1);
    pool.create_open_note('note-1', token.contract_address);
    let (r, s) = ck.sign(claim_message(creator_id, 'note-1', TIER_0 * 5)).unwrap();
    let op = VaultOp::Claim(nightshift::common::ClaimArgs {
        creator_id, note_id: 'note-1', amount: TIER_0 * 5, sig_r: r, sig_s: s,
    });
    let mut cd = array![];
    op.serialize(ref cd);
    pool.invoke_external(vault.contract_address, cd.span(), 1);
}

// --- the public claim leg ---
// The exit that survives the pool refusing this vault as a depositor. Same
// creator key as the private claim, a different tagged message, and a direct
// transfer to a public address instead of a pool note.

#[test]
fn claim_public_pays_out_and_drains_claimable() {
    let (vault, _, token, creator_id, ck) = charged_up(2);
    assert(vault.claimable_of(creator_id) == TIER_0 * 2, 'claimable wrong');
    let before = vault.accounted(token.contract_address);

    let to: ContractAddress = 'payout-addr'.try_into().unwrap();
    let (r, s) = ck.sign(claim_public_message(creator_id, to, TIER_0 * 2, 0)).unwrap();
    vault.claim_public(creator_id, to, TIER_0 * 2, 0, r, s);

    // The money actually arrived — a direct transfer, not an allowance.
    assert(token.balance_of(to) == (TIER_0 * 2).into(), 'payout not received');
    assert(vault.claimable_of(creator_id) == 0, 'claimable not drained');
    // Custody shrinks by exactly what left the vault.
    assert(before - vault.accounted(token.contract_address) == (TIER_0 * 2).into(), 'accounted wrong');
}

#[test]
fn claim_public_takes_part_of_the_balance() {
    // A partial exit leaves the rest claimable, by either leg.
    let (vault, _, token, creator_id, ck) = charged_up(2);
    let to: ContractAddress = 'payout-addr'.try_into().unwrap();
    let (r, s) = ck.sign(claim_public_message(creator_id, to, TIER_0, 0)).unwrap();
    vault.claim_public(creator_id, to, TIER_0, 0, r, s);
    assert(token.balance_of(to) == TIER_0.into(), 'partial payout wrong');
    assert(vault.claimable_of(creator_id) == TIER_0, 'remainder wrong');
}

#[test]
#[should_panic(expected: 'NS_BAD_NONCE')]
fn claim_public_replay_dies() {
    // The state the replay needs: a partial claim leaves TIER_0 claimable, so
    // a byte-identical resubmission passes every balance check. The consumed
    // nonce is what kills it; without the nonce this signature would be a
    // permanent standing order anyone could re-fire as claimable refills.
    let (vault, _, _, creator_id, ck) = charged_up(2);
    let to: ContractAddress = 'payout-addr'.try_into().unwrap();
    let (r, s) = ck.sign(claim_public_message(creator_id, to, TIER_0, 0)).unwrap();
    vault.claim_public(creator_id, to, TIER_0, 0, r, s);
    assert(vault.claim_pub_nonce_of(creator_id) == 1, 'nonce not consumed');
    vault.claim_public(creator_id, to, TIER_0, 0, r, s);
}

#[test]
fn claim_public_sequences_by_nonce() {
    // Two successive public claims sign nonces 0 and 1, read from the view.
    let (vault, _, token, creator_id, ck) = charged_up(2);
    let to: ContractAddress = 'payout-addr'.try_into().unwrap();
    let n0 = vault.claim_pub_nonce_of(creator_id);
    let (r0, s0) = ck.sign(claim_public_message(creator_id, to, TIER_0, n0)).unwrap();
    vault.claim_public(creator_id, to, TIER_0, n0, r0, s0);
    let n1 = vault.claim_pub_nonce_of(creator_id);
    let (r1, s1) = ck.sign(claim_public_message(creator_id, to, TIER_0, n1)).unwrap();
    vault.claim_public(creator_id, to, TIER_0, n1, r1, s1);
    assert(token.balance_of(to) == (TIER_0 * 2).into(), 'both payouts wrong');
    assert(vault.claim_pub_nonce_of(creator_id) == 2, 'nonce sequence wrong');
}

#[test]
#[should_panic(expected: 'NS_BAD_SIGNATURE')]
fn claim_public_rejects_wrong_signer() {
    // Anyone may carry this call, so the signature is the whole authorization.
    let (vault, _, _, creator_id, _) = charged_up(1);
    let attacker = KeyPairTrait::<felt252, felt252>::generate();
    let to: ContractAddress = 'attacker-addr'.try_into().unwrap();
    let (r, s) = attacker.sign(claim_public_message(creator_id, to, TIER_0, 0)).unwrap();
    vault.claim_public(creator_id, to, TIER_0, 0, r, s);
}

#[test]
#[should_panic(expected: 'NS_BAD_SIGNATURE')]
fn claim_public_signature_is_bound_to_destination() {
    // The creator signs a payout to their own address; a relayer swaps the
    // destination on the way — the signature no longer matches.
    let (vault, _, _, creator_id, ck) = charged_up(1);
    let intended: ContractAddress = 'creator-addr'.try_into().unwrap();
    let attacker: ContractAddress = 'attacker-addr'.try_into().unwrap();
    let (r, s) = ck.sign(claim_public_message(creator_id, intended, TIER_0, 0)).unwrap();
    vault.claim_public(creator_id, attacker, TIER_0, 0, r, s);
}

#[test]
#[should_panic(expected: 'NS_CLAIM_EXCEEDS_BALANCE')]
fn claim_public_cannot_exceed_claimable() {
    // One period was charged; the creator signs for five. The balance check is
    // what keeps a creator from reaching into other subscriptions' escrow.
    let (vault, _, _, creator_id, ck) = charged_up(1);
    let to: ContractAddress = 'payout-addr'.try_into().unwrap();
    let (r, s) = ck.sign(claim_public_message(creator_id, to, TIER_0 * 5, 0)).unwrap();
    vault.claim_public(creator_id, to, TIER_0 * 5, 0, r, s);
}

#[test]
#[should_panic(expected: 'NS_ZERO_ADDRESS')]
fn claim_public_rejects_zero_destination() {
    let (vault, _, _, creator_id, ck) = charged_up(1);
    let zero: ContractAddress = 0.try_into().unwrap();
    let (r, s) = ck.sign(claim_public_message(creator_id, zero, TIER_0, 0)).unwrap();
    vault.claim_public(creator_id, zero, TIER_0, 0, r, s);
}

// --- cancel + reclaim ---

fn subscribe_with_owner() -> (INightshiftVaultDispatcher, IMockPrivacyPoolDispatcher, IMockERC20Dispatcher, felt252, snforge_std::signature::KeyPair<felt252, felt252>) {
    let (pool, token, vault) = deploy();
    let ck = KeyPairTrait::<felt252, felt252>::generate();
    let ok = KeyPairTrait::<felt252, felt252>::generate();
    let creator: ContractAddress = 'creator'.try_into().unwrap();
    start_cheat_caller_address(vault.contract_address, creator);
    let creator_id = vault.register_creator(token.contract_address, ck.public_key, array![TIER_0].span());
    stop_cheat_caller_address(vault.contract_address);
    start_cheat_block_number(vault.contract_address, 100);
    pool.transfer_to(token.contract_address, vault.contract_address, (TIER_0 * 3).into());
    pool.invoke_external(vault.contract_address, sub_calldata('c-1', creator_id, ok.public_key, 3).span(), 0);
    (vault, pool, token, creator_id, ok)
}

#[test]
fn cancel_then_reclaim_returns_unspent_escrow() {
    let (vault, _, token, _, ok) = subscribe_with_owner();
    vault.charge('c-1'); // one period spent, 2 remain in escrow

    let (cr, cs) = ok.sign(cancel_message('c-1')).unwrap();
    vault.cancel('c-1', cr, cs);
    assert(!vault.is_active('c-1'), 'still active');

    let to: ContractAddress = 'refund-addr'.try_into().unwrap();
    let (rr, rs) = ok.sign(reclaim_message('c-1', to)).unwrap();
    let before = vault.accounted(token.contract_address);
    vault.reclaim('c-1', to, rr, rs);
    // 2 periods of escrow left the accounted balance...
    assert(before - vault.accounted(token.contract_address) == (TIER_0 * 2).into(), 'wrong reclaim');
    // ...and actually arrived: a direct transfer, not an allowance the
    // recipient would have to know how to pull.
    assert(token.balance_of(to) == (TIER_0 * 2).into(), 'refund not received');
    let (_, _, _, _, _, escrow, _, cancelled) = vault.schedule_of('c-1');
    assert(escrow == 0 && cancelled, 'not reclaimed/cancelled');
}

#[test]
#[should_panic(expected: 'NOTE_ALREADY_DEPOSITED')]
fn claim_replay_dies_at_the_pool() {
    // The vault's replay defense is the pool's one-deposit-per-note rule:
    // prove it. Claim HALF the claimable so the vault-side balance check
    // would pass again — the replay must die at the pool, not by luck.
    let (vault, pool, token, creator_id, ck) = charged_up(2);
    pool.create_open_note('note-1', token.contract_address);
    let (r, s) = ck.sign(claim_message(creator_id, 'note-1', TIER_0)).unwrap();
    let op = VaultOp::Claim(nightshift::common::ClaimArgs {
        creator_id, note_id: 'note-1', amount: TIER_0, sig_r: r, sig_s: s,
    });
    let mut cd = array![];
    op.serialize(ref cd);
    pool.invoke_external(vault.contract_address, cd.span(), 1);
    assert(vault.claimable_of(creator_id) == TIER_0, 'first claim wrong');
    // Byte-identical replay.
    let mut cd2 = array![];
    let op2 = VaultOp::Claim(nightshift::common::ClaimArgs {
        creator_id, note_id: 'note-1', amount: TIER_0, sig_r: r, sig_s: s,
    });
    op2.serialize(ref cd2);
    pool.invoke_external(vault.contract_address, cd2.span(), 1);
}

#[test]
#[should_panic(expected: 'NS_BAD_SIGNATURE')]
fn reclaim_signature_is_bound_to_destination() {
    let (vault, _, _, _, ok) = subscribe_with_owner();
    let (cr, cs) = ok.sign(cancel_message('c-1')).unwrap();
    vault.cancel('c-1', cr, cs);
    // Subscriber signs a refund to their own address; an interceptor swaps
    // in a different destination — the signature no longer matches.
    let intended: ContractAddress = 'my-addr'.try_into().unwrap();
    let attacker: ContractAddress = 'attacker'.try_into().unwrap();
    let (r, s) = ok.sign(reclaim_message('c-1', intended)).unwrap();
    vault.reclaim('c-1', attacker, r, s);
}

#[test]
#[should_panic(expected: 'NS_ZERO_ADDRESS')]
fn reclaim_rejects_zero_destination() {
    let (vault, _, _, _, ok) = subscribe_with_owner();
    let (cr, cs) = ok.sign(cancel_message('c-1')).unwrap();
    vault.cancel('c-1', cr, cs);
    let zero: ContractAddress = 0.try_into().unwrap();
    let (r, s) = ok.sign(reclaim_message('c-1', zero)).unwrap();
    vault.reclaim('c-1', zero, r, s);
}

#[test]
#[should_panic(expected: 'NS_BAD_SIGNATURE')]
fn cancel_rejects_wrong_signer() {
    let (vault, _, _, _, _) = subscribe_with_owner();
    let attacker = KeyPairTrait::<felt252, felt252>::generate();
    let (r, s) = attacker.sign(cancel_message('c-1')).unwrap();
    vault.cancel('c-1', r, s);
}

#[test]
#[should_panic(expected: 'NS_CANCELLED')]
fn charge_stops_after_cancel() {
    let (vault, _, _, _, ok) = subscribe_with_owner();
    let (r, s) = ok.sign(cancel_message('c-1')).unwrap();
    vault.cancel('c-1', r, s);
    vault.charge('c-1');
}

#[test]
#[should_panic(expected: 'NS_CANCELLED')]
fn reclaim_requires_cancel_first() {
    let (vault, _, _, _, ok) = subscribe_with_owner();
    let to: ContractAddress = 'refund'.try_into().unwrap();
    let (r, s) = ok.sign(reclaim_message('c-1', to)).unwrap();
    vault.reclaim('c-1', to, r, s);
}
