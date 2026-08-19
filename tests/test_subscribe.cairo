// Subscribe leg, driven through the MockPrivacyPool replaying the real pool's
// TransferTo -> privacy_invoke sequence, plus the adversarial set: hostile
// caller, off-ladder period, wrong amount, donation griefing, duplicate
// commitment.

use nightshift::common::{PERIOD_WEEK, Schedule, VaultOp};
use nightshift::mocks::{IMockERC20Dispatcher, IMockERC20DispatcherTrait, IMockPrivacyPoolDispatcher, IMockPrivacyPoolDispatcherTrait};
use nightshift::vault::{INightshiftVaultDispatcher, INightshiftVaultDispatcherTrait};
use snforge_std::{ContractClassTrait, DeclareResultTrait, declare, start_cheat_caller_address, stop_cheat_caller_address};
use starknet::ContractAddress;

const TIER_0: u128 = 100_000000000000000000; // 100 tokens
const TIER_1: u128 = 500_000000000000000000;

fn setup() -> (IMockPrivacyPoolDispatcher, IMockERC20Dispatcher, INightshiftVaultDispatcher, felt252) {
    let pool_class = declare("MockPrivacyPool").unwrap().contract_class();
    let (pool_addr, _) = pool_class.deploy(@array![]).unwrap();

    let erc20_class = declare("MockERC20").unwrap().contract_class();
    let (token_addr, _) = erc20_class.deploy(@array![]).unwrap();

    let vault_class = declare("NightshiftVault").unwrap().contract_class();
    let (vault_addr, _) = vault_class.deploy(@array![pool_addr.into()]).unwrap();

    let pool = IMockPrivacyPoolDispatcher { contract_address: pool_addr };
    let token = IMockERC20Dispatcher { contract_address: token_addr };
    let vault = INightshiftVaultDispatcher { contract_address: vault_addr };

    // The pool holds shielded liquidity.
    token.mint(pool_addr, 1_000_000_000000000000000000);

    // A creator registers a two-tier ladder.
    let creator: ContractAddress = 'creator'.try_into().unwrap();
    start_cheat_caller_address(vault_addr, creator);
    let creator_id = vault.register_creator(token_addr, array![TIER_0, TIER_1].span());
    stop_cheat_caller_address(vault_addr);

    (pool, token, vault, creator_id)
}

fn subscribe_calldata(commitment: felt252, creator_id: felt252, tier: u8, n_periods: u32) -> Array<felt252> {
    let op = VaultOp::Subscribe(
        Schedule {
            commitment, creator_id, tier, period_blocks: PERIOD_WEEK, n_periods, owner_key: 'owner-key',
        },
    );
    let mut calldata = array![];
    op.serialize(ref calldata);
    calldata
}

#[test]
fn subscribe_happy_path_returns_empty_span_and_accounts_escrow() {
    let (pool, token, vault, creator_id) = setup();
    let escrow: u256 = (TIER_0 * 4).into();

    // The pool's TransferTo leg funds the vault, then invokes with the op.
    pool.transfer_to(token.contract_address, vault.contract_address, escrow);
    pool.invoke_external(vault.contract_address, subscribe_calldata('c-1', creator_id, 0, 4).span(), 0);

    assert(vault.accounted(token.contract_address) == escrow, 'escrow not accounted');
    assert(vault.is_active('c-1'), 'subscription not active');
}

#[test]
#[should_panic(expected: 'NS_NOT_POOL')]
fn subscribe_rejects_non_pool_caller() {
    let (_, _, vault, creator_id) = setup();
    let mut calldata = subscribe_calldata('c-1', creator_id, 0, 4);
    let mut span = calldata.span();
    let op: VaultOp = Serde::deserialize(ref span).unwrap();
    // Direct call, not via the pool.
    vault.privacy_invoke(op);
}

#[test]
#[should_panic(expected: 'NS_WRONG_AMOUNT')]
fn subscribe_rejects_wrong_amount() {
    let (pool, token, vault, creator_id) = setup();
    // Transfer prices tier 0 but the op claims tier 1.
    pool.transfer_to(token.contract_address, vault.contract_address, (TIER_0 * 4).into());
    pool.invoke_external(vault.contract_address, subscribe_calldata('c-1', creator_id, 1, 4).span(), 0);
}

#[test]
#[should_panic(expected: 'NS_WRONG_AMOUNT')]
fn hostile_donation_cannot_mint_subscription() {
    let (pool, token, vault, creator_id) = setup();
    // An attacker donates on top of the priced transfer: received != expected.
    token.mint(vault.contract_address, 1);
    pool.transfer_to(token.contract_address, vault.contract_address, (TIER_0 * 4).into());
    pool.invoke_external(vault.contract_address, subscribe_calldata('c-1', creator_id, 0, 4).span(), 0);
}

#[test]
#[should_panic(expected: 'NS_PERIOD_OFF_LADDER')]
fn subscribe_rejects_off_ladder_period() {
    let (pool, token, vault, creator_id) = setup();
    pool.transfer_to(token.contract_address, vault.contract_address, (TIER_0 * 4).into());
    let op = VaultOp::Subscribe(
        Schedule {
            commitment: 'c-1', creator_id, tier: 0, period_blocks: 12345, n_periods: 4, owner_key: 'k',
        },
    );
    let mut calldata = array![];
    op.serialize(ref calldata);
    pool.invoke_external(vault.contract_address, calldata.span(), 0);
}

#[test]
#[should_panic(expected: 'NS_DUPLICATE_COMMITMENT')]
fn subscribe_rejects_reused_commitment() {
    let (pool, token, vault, creator_id) = setup();
    let escrow: u256 = (TIER_0 * 4).into();
    pool.transfer_to(token.contract_address, vault.contract_address, escrow);
    pool.invoke_external(vault.contract_address, subscribe_calldata('c-1', creator_id, 0, 4).span(), 0);
    pool.transfer_to(token.contract_address, vault.contract_address, escrow);
    pool.invoke_external(vault.contract_address, subscribe_calldata('c-1', creator_id, 0, 4).span(), 0);
}

#[test]
#[should_panic(expected: 'UNDEPOSITED_OPEN_NOTES')]
fn pool_rejects_unexpected_deposit_count() {
    let (pool, token, vault, creator_id) = setup();
    pool.transfer_to(token.contract_address, vault.contract_address, (TIER_0 * 4).into());
    // The batch claims one open note awaits a deposit; Subscribe returns none.
    pool.invoke_external(vault.contract_address, subscribe_calldata('c-1', creator_id, 0, 4).span(), 1);
}
