// Subscribe leg + the permissionless charge path, driven through the
// MockPrivacyPool. Adversarial set: hostile caller, off-ladder period, wrong
// amount, donation griefing, duplicate commitment, unexpected deposit count.

use nightshift::common::{PERIOD_HOUR, Schedule, VaultOp};
use nightshift::mocks::{IMockERC20Dispatcher, IMockERC20DispatcherTrait, IMockPrivacyPoolDispatcher, IMockPrivacyPoolDispatcherTrait};
use nightshift::vault::{INightshiftVaultDispatcher, INightshiftVaultDispatcherTrait};
use snforge_std::{ContractClassTrait, DeclareResultTrait, declare, start_cheat_block_number, start_cheat_caller_address, stop_cheat_caller_address};
use starknet::ContractAddress;

const TIER_0: u128 = 100_000000000000000000;
const TIER_1: u128 = 500_000000000000000000;
const OWNER_PUB: felt252 = 0x1ef15c18599971b7beced415a40f0c7deacfd9b0d1819e03d723d8bc943cfca; // pub of secret 1234

fn setup() -> (IMockPrivacyPoolDispatcher, IMockERC20Dispatcher, INightshiftVaultDispatcher, felt252) {
    let (pool_addr, _) = declare("MockPrivacyPool").unwrap().contract_class().deploy(@array![]).unwrap();
    let (token_addr, _) = declare("MockERC20").unwrap().contract_class().deploy(@array![]).unwrap();
    let pool = IMockPrivacyPoolDispatcher { contract_address: pool_addr };
    let token = IMockERC20Dispatcher { contract_address: token_addr };
    let (vault_addr, _) = declare("NightshiftVault").unwrap().contract_class()
        .deploy(@array![pool_addr.into()]).unwrap();
    let vault = INightshiftVaultDispatcher { contract_address: vault_addr };
    token.mint(pool.contract_address, 1_000_000_000000000000000000);

    let creator: ContractAddress = 'creator'.try_into().unwrap();
    start_cheat_caller_address(vault.contract_address, creator);
    let creator_id = vault.register_creator(token.contract_address, 'payout-key', array![TIER_0, TIER_1].span());
    stop_cheat_caller_address(vault.contract_address);
    (pool, token, vault, creator_id)
}

fn subscribe_calldata(commitment: felt252, creator_id: felt252, tier: u8, n: u32) -> Array<felt252> {
    let op = VaultOp::Subscribe(Schedule {
        commitment, creator_id, tier, period_blocks: PERIOD_HOUR, n_periods: n, owner_key: OWNER_PUB,
    });
    let mut cd = array![];
    op.serialize(ref cd);
    cd
}

#[test]
fn subscribe_stores_schedule_and_accounts_escrow() {
    let (pool, token, vault, creator_id) = setup();
    start_cheat_block_number(vault.contract_address, 1000);
    pool.transfer_to(token.contract_address, vault.contract_address, (TIER_0 * 4).into());
    pool.invoke_external(vault.contract_address, subscribe_calldata('c-1', creator_id, 0, 4).span(), 0);

    assert(vault.accounted(token.contract_address) == (TIER_0 * 4).into(), 'escrow not accounted');
    assert(vault.is_active('c-1'), 'not active');
    let (_, _, _, _, n, escrow, next, cancelled) = vault.schedule_of('c-1');
    assert(n == 4 && escrow == TIER_0 * 4 && next == 0 && !cancelled, 'bad schedule');
}

#[test]
#[should_panic(expected: 'NS_NOT_POOL')]
fn subscribe_rejects_non_pool_caller() {
    let (_, _, vault, creator_id) = setup();
    let mut span = subscribe_calldata('c-1', creator_id, 0, 4).span();
    let op: VaultOp = Serde::deserialize(ref span).unwrap();
    vault.privacy_invoke(op);
}

#[test]
#[should_panic(expected: 'NS_WRONG_AMOUNT')]
fn subscribe_rejects_wrong_amount() {
    let (pool, token, vault, creator_id) = setup();
    pool.transfer_to(token.contract_address, vault.contract_address, (TIER_0 * 4).into());
    pool.invoke_external(vault.contract_address, subscribe_calldata('c-1', creator_id, 1, 4).span(), 0);
}

#[test]
#[should_panic(expected: 'NS_WRONG_AMOUNT')]
fn hostile_donation_cannot_mint_subscription() {
    let (pool, token, vault, creator_id) = setup();
    token.mint(vault.contract_address, 1);
    pool.transfer_to(token.contract_address, vault.contract_address, (TIER_0 * 4).into());
    pool.invoke_external(vault.contract_address, subscribe_calldata('c-1', creator_id, 0, 4).span(), 0);
}

#[test]
#[should_panic(expected: 'NS_PERIOD_OFF_LADDER')]
fn subscribe_rejects_off_ladder_period() {
    let (pool, token, vault, creator_id) = setup();
    pool.transfer_to(token.contract_address, vault.contract_address, (TIER_0 * 4).into());
    let op = VaultOp::Subscribe(Schedule {
        commitment: 'c-1', creator_id, tier: 0, period_blocks: 999, n_periods: 4, owner_key: OWNER_PUB,
    });
    let mut cd = array![];
    op.serialize(ref cd);
    pool.invoke_external(vault.contract_address, cd.span(), 0);
}

#[test]
#[should_panic(expected: 'NS_DUPLICATE_COMMITMENT')]
fn subscribe_rejects_reused_commitment() {
    let (pool, token, vault, creator_id) = setup();
    pool.transfer_to(token.contract_address, vault.contract_address, (TIER_0 * 4).into());
    pool.invoke_external(vault.contract_address, subscribe_calldata('c-1', creator_id, 0, 4).span(), 0);
    pool.transfer_to(token.contract_address, vault.contract_address, (TIER_0 * 4).into());
    pool.invoke_external(vault.contract_address, subscribe_calldata('c-1', creator_id, 0, 4).span(), 0);
}

// --- the permissionless charge path ---

fn subscribed(n: u32) -> (IMockPrivacyPoolDispatcher, IMockERC20Dispatcher, INightshiftVaultDispatcher, felt252) {
    let (pool, token, vault, creator_id) = setup();
    start_cheat_block_number(vault.contract_address, 100);
    pool.transfer_to(token.contract_address, vault.contract_address, (TIER_0 * n.into()).into());
    pool.invoke_external(vault.contract_address, subscribe_calldata('c-1', creator_id, 0, n).span(), 0);
    (pool, token, vault, creator_id)
}

#[test]
fn charge_is_permissionless_and_moves_to_claimable() {
    let (_, _, vault, creator_id) = subscribed(3);
    // A keeper account, not the subscriber, fires the charge.
    let keeper: ContractAddress = 'keeper'.try_into().unwrap();
    start_cheat_caller_address(vault.contract_address, keeper);
    let next = vault.charge('c-1'); // period 0 due at block 100
    stop_cheat_caller_address(vault.contract_address);
    assert(next == 1, 'wrong next');
    assert(vault.claimable_of(creator_id) == TIER_0, 'not claimable');
    let (_, _, _, _, _, escrow, np, _) = vault.schedule_of('c-1');
    assert(escrow == TIER_0 * 2 && np == 1, 'escrow/next wrong');
}

#[test]
#[should_panic(expected: 'NS_NOT_DUE')]
fn charge_cannot_fire_early() {
    let (_, _, vault, _) = subscribed(3);
    vault.charge('c-1'); // period 0 ok
    vault.charge('c-1'); // period 1 due at 100+PERIOD_HOUR, still at 100
}

#[test]
fn charge_advances_when_due() {
    let (_, _, vault, creator_id) = subscribed(3);
    vault.charge('c-1');
    start_cheat_block_number(vault.contract_address, 100 + PERIOD_HOUR);
    vault.charge('c-1');
    assert(vault.claimable_of(creator_id) == TIER_0 * 2, 'two periods not claimable');
}

#[test]
#[should_panic(expected: 'NS_ESCROW_EXHAUSTED')]
fn charge_stops_at_n_periods() {
    let (_, _, vault, _) = subscribed(2);
    start_cheat_block_number(vault.contract_address, 100 + PERIOD_HOUR * 10);
    vault.charge('c-1');
    vault.charge('c-1');
    vault.charge('c-1'); // only 2 periods exist
}

#[test]
#[should_panic(expected: 'NS_UNKNOWN_SUB')]
fn charge_rejects_unknown_commitment() {
    let (_, _, vault, _) = subscribed(3);
    vault.charge('nobody');
}

#[test]
#[should_panic(expected: 'NS_NOT_DUE')]
fn keeper_race_second_charge_loses() {
    // Two keepers race the same due period in one block: the pointer has
    // advanced for the winner, so the loser sees period 1 (not yet due) —
    // never a double charge.
    let (_, _, vault, _) = subscribed(3);
    let keeper_a: ContractAddress = 'keeper-a'.try_into().unwrap();
    let keeper_b: ContractAddress = 'keeper-b'.try_into().unwrap();
    start_cheat_caller_address(vault.contract_address, keeper_a);
    vault.charge('c-1');
    stop_cheat_caller_address(vault.contract_address);
    start_cheat_caller_address(vault.contract_address, keeper_b);
    vault.charge('c-1');
}

#[test]
fn charge_consumes_the_period_nullifier() {
    // Direct read of the write-once map through the view: the nullifier is
    // the double-charge defense independent of the ordering pointer.
    let (_, _, vault, _) = subscribed(3);
    assert(!vault.period_charged('c-1', 0), 'spent before charge');
    vault.charge('c-1');
    assert(vault.period_charged('c-1', 0), 'nullifier not consumed');
    assert(!vault.period_charged('c-1', 1), 'future period spent');
}

#[test]
#[should_panic(expected: 'u128_mul Overflow')]
fn overlong_schedule_panics_before_any_state() {
    // per_period * n_periods overflowing u128 must panic in the escrow
    // computation — before the balance check, before any storage write.
    let (pool, token, vault, _) = setup();
    let huge: u128 = 0x80000000000000000000000000000000; // 2^127
    let creator: ContractAddress = 'creator-2'.try_into().unwrap();
    start_cheat_caller_address(vault.contract_address, creator);
    let creator_id = vault.register_creator(token.contract_address, 'payout-key-2', array![huge].span());
    stop_cheat_caller_address(vault.contract_address);
    pool.invoke_external(vault.contract_address, subscribe_calldata('c-big', creator_id, 0, 4).span(), 0);
}

#[test]
fn periods_due_counts_backlog() {
    let (_, _, vault, _) = subscribed(3);
    start_cheat_block_number(vault.contract_address, 100 + PERIOD_HOUR * 5);
    assert(vault.periods_due('c-1') == 3, 'should be 3 due'); // all 3, capped at n
}
