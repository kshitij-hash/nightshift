// The Release leg through the mock pool's real sequence: create the open note,
// invoke with expected_deposits=1, watch the pool pull the charge. Adversarial
// set: charge before due, double-charge the same period, keeper race in one
// block, charge past escrow, unknown commitment.

use nightshift::common::{PERIOD_WEEK, ReleaseArgs, Schedule, VaultOp};
use nightshift::mocks::{IMockERC20Dispatcher, IMockERC20DispatcherTrait, IMockPrivacyPoolDispatcher, IMockPrivacyPoolDispatcherTrait};
use nightshift::vault::{INightshiftVaultDispatcher, INightshiftVaultDispatcherTrait};
use snforge_std::{ContractClassTrait, DeclareResultTrait, declare, start_cheat_block_number, start_cheat_caller_address, stop_cheat_caller_address};
use starknet::ContractAddress;

const TIER_0: u128 = 100_000000000000000000;
const N_PERIODS: u32 = 3;

fn setup_subscribed() -> (IMockPrivacyPoolDispatcher, IMockERC20Dispatcher, INightshiftVaultDispatcher, felt252) {
    let pool_class = declare("MockPrivacyPool").unwrap().contract_class();
    let (pool_addr, _) = pool_class.deploy(@array![]).unwrap();
    let erc20_class = declare("MockERC20").unwrap().contract_class();
    let (token_addr, _) = erc20_class.deploy(@array![]).unwrap();
    let vault_class = declare("NightshiftVault").unwrap().contract_class();
    let (vault_addr, _) = vault_class.deploy(@array![pool_addr.into()]).unwrap();

    let pool = IMockPrivacyPoolDispatcher { contract_address: pool_addr };
    let token = IMockERC20Dispatcher { contract_address: token_addr };
    let vault = INightshiftVaultDispatcher { contract_address: vault_addr };
    token.mint(pool_addr, 1_000_000_000000000000000000);

    let creator: ContractAddress = 'creator'.try_into().unwrap();
    start_cheat_caller_address(vault_addr, creator);
    let creator_id = vault.register_creator(token_addr, array![TIER_0].span());
    stop_cheat_caller_address(vault_addr);

    // Subscribe at block 100 for 3 weekly periods.
    start_cheat_block_number(vault_addr, 100);
    pool.transfer_to(token_addr, vault_addr, (TIER_0 * N_PERIODS.into()).into());
    let op = VaultOp::Subscribe(Schedule {
        commitment: 'c-1', creator_id, tier: 0, period_blocks: PERIOD_WEEK,
        n_periods: N_PERIODS, owner_key: 'k',
    });
    let mut calldata = array![];
    op.serialize(ref calldata);
    pool.invoke_external(vault_addr, calldata.span(), 0);

    (pool, token, vault, creator_id)
}

fn release_calldata(commitment: felt252, note_id: felt252) -> Array<felt252> {
    let op = VaultOp::Release(ReleaseArgs { commitment, note_id });
    let mut calldata = array![];
    op.serialize(ref calldata);
    calldata
}

#[test]
fn release_fills_open_note_with_one_period() {
    let (pool, token, vault, _) = setup_subscribed();
    pool.create_open_note('note-1', token.contract_address);

    // Period 0 is due at the subscribe block itself.
    pool.invoke_external(vault.contract_address, release_calldata('c-1', 'note-1').span(), 1);

    assert(pool.note_amount('note-1') == TIER_0, 'note not filled');
    // Escrow shrinks by exactly one period.
    let expected: u256 = (TIER_0 * (N_PERIODS - 1).into()).into();
    assert(vault.accounted(token.contract_address) == expected, 'escrow not debited');
}

#[test]
#[should_panic(expected: 'NS_NOT_DUE')]
fn release_cannot_charge_early() {
    let (pool, token, vault, _) = setup_subscribed();
    pool.create_open_note('note-1', token.contract_address);
    pool.create_open_note('note-2', token.contract_address);
    pool.invoke_external(vault.contract_address, release_calldata('c-1', 'note-1').span(), 1);
    // Still at block 100: period 1 opens at 100 + PERIOD_WEEK.
    pool.invoke_external(vault.contract_address, release_calldata('c-1', 'note-2').span(), 1);
}

#[test]
fn release_charges_next_period_once_due() {
    let (pool, token, vault, _) = setup_subscribed();
    pool.create_open_note('note-1', token.contract_address);
    pool.create_open_note('note-2', token.contract_address);
    pool.invoke_external(vault.contract_address, release_calldata('c-1', 'note-1').span(), 1);

    start_cheat_block_number(vault.contract_address, 100 + PERIOD_WEEK);
    pool.invoke_external(vault.contract_address, release_calldata('c-1', 'note-2').span(), 1);
    assert(pool.note_amount('note-2') == TIER_0, 'period 1 not charged');
}

#[test]
#[should_panic(expected: 'NS_ESCROW_EMPTY')]
fn release_stops_when_escrow_exhausted() {
    let (pool, token, vault, _) = setup_subscribed();
    pool.create_open_note('n0', token.contract_address);
    pool.create_open_note('n1', token.contract_address);
    pool.create_open_note('n2', token.contract_address);
    pool.create_open_note('n3', token.contract_address);
    // Jump far past the schedule end; all three periods due.
    start_cheat_block_number(vault.contract_address, 100 + PERIOD_WEEK * 10);
    pool.invoke_external(vault.contract_address, release_calldata('c-1', 'n0').span(), 1);
    pool.invoke_external(vault.contract_address, release_calldata('c-1', 'n1').span(), 1);
    pool.invoke_external(vault.contract_address, release_calldata('c-1', 'n2').span(), 1);
    // Fourth charge: escrow is gone.
    pool.invoke_external(vault.contract_address, release_calldata('c-1', 'n3').span(), 1);
}

#[test]
#[should_panic(expected: 'NS_UNKNOWN_SUB')]
fn release_rejects_unknown_commitment() {
    let (pool, token, vault, _) = setup_subscribed();
    pool.create_open_note('note-1', token.contract_address);
    pool.invoke_external(vault.contract_address, release_calldata('nobody', 'note-1').span(), 1);
}
