// Subscribe leg + the permissionless charge path, driven through the
// MockPrivacyPool. Adversarial set: hostile caller, off-ladder period, wrong
// amount, donation griefing, duplicate commitment, unexpected deposit count.

use nightshift::common::{PERIOD_HOUR, Schedule, VaultOp};
use nightshift::mocks::{IMockERC20Dispatcher, IMockERC20DispatcherTrait, IMockPrivacyPoolDispatcher, IMockPrivacyPoolDispatcherTrait};
use nightshift::vault::{INightshiftVaultDispatcher, INightshiftVaultDispatcherTrait};
use snforge_std::{ContractClassTrait, DeclareResultTrait, EventSpyTrait, EventsFilterTrait, declare, spy_events, start_cheat_block_number, start_cheat_caller_address, stop_cheat_caller_address};
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
fn owner_key_of_reads_back_the_subscribed_key() {
    // The gate binds a presentation to this exact key, so the vault has to hand
    // back what the Schedule carried, and 0 for a commitment it never saw.
    let (pool, token, vault, creator_id) = setup();
    start_cheat_block_number(vault.contract_address, 1000);
    pool.transfer_to(token.contract_address, vault.contract_address, (TIER_0 * 4).into());
    pool.invoke_external(vault.contract_address, subscribe_calldata('c-1', creator_id, 0, 4).span(), 0);

    assert(vault.owner_key_of('c-1') == OWNER_PUB, 'owner key not stored');
    assert(vault.owner_key_of('nobody') == 0, 'unknown key not zero');
}

#[test]
fn subscribed_indexes_the_commitment() {
    // getEvents filters on keys, not data. `commitment` sits in the keys, so an
    // indexer pulls one subscription's history straight from the node. Read the
    // raw event: a decoded-struct assertion passes either way, so it would not
    // catch the field slipping back into the data.
    let (pool, token, vault, creator_id) = setup();
    start_cheat_block_number(vault.contract_address, 1000);
    pool.transfer_to(token.contract_address, vault.contract_address, (TIER_0 * 4).into());

    let mut spy = spy_events();
    pool.invoke_external(vault.contract_address, subscribe_calldata('c-1', creator_id, 0, 4).span(), 0);

    let vault_events = spy.get_events().emitted_by(vault.contract_address);
    assert(vault_events.events.len() == 1, 'expected one vault event');
    let (_, event) = vault_events.events.at(0);
    // keys[0] is the event selector; the indexed commitment follows it.
    assert(event.keys.len() == 2, 'commitment is not a key');
    assert(*event.keys.at(1) == 'c-1', 'wrong indexed commitment');
    // creator_id and n_periods stay in the data.
    assert(event.data.len() == 2, 'unexpected data layout');
    assert(*event.data.at(0) == creator_id, 'creator_id not in data');
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
fn lone_donation_without_pool_delivery_cannot_subscribe() {
    // A donation is not the pool's withdraw leg. Here the vault holds only a
    // stray 1-wei donation and the pool delivers no escrow for this subscribe,
    // so held (accounted + 1) is below accounted + expected and the custody
    // check rejects it. This is the retained half of the old hostile_donation
    // test: the permanent-DoS behavior is gone (see
    // donation_does_not_block_subsequent_subscribe), but a subscribe with no
    // real delivery behind it still cannot go through.
    let (pool, token, vault, creator_id) = setup();
    token.mint(vault.contract_address, 1);
    // No pool.transfer_to: the pool delivers nothing for this subscribe.
    pool.invoke_external(vault.contract_address, subscribe_calldata('c-1', creator_id, 0, 4).span(), 0);
}

#[test]
fn donation_does_not_block_subsequent_subscribe() {
    // Regression for the custody-check DoS. A stray 1-wei donation to the vault
    // must NOT permanently brick subscribe. On the old
    // `held - accounted == expected` check the second subscribe below reverts
    // NS_WRONG_AMOUNT forever (held - accounted = TIER_0*4 + 1 != TIER_0*4);
    // with `held >= accounted + expected` the wei is absorbed as surplus and the
    // second subscribe succeeds.
    let (pool, token, vault, creator_id) = setup();
    start_cheat_block_number(vault.contract_address, 1000);

    // First legitimate subscribe.
    pool.transfer_to(token.contract_address, vault.contract_address, (TIER_0 * 4).into());
    pool.invoke_external(vault.contract_address, subscribe_calldata('c-1', creator_id, 0, 4).span(), 0);
    assert(vault.accounted(token.contract_address) == (TIER_0 * 4).into(), 'first escrow wrong');

    // Hostile 1-wei donation straight to the vault.
    token.mint(vault.contract_address, 1);

    // Second legitimate subscribe, different commitment, must still succeed and
    // store the correct escrow.
    pool.transfer_to(token.contract_address, vault.contract_address, (TIER_0 * 4).into());
    pool.invoke_external(vault.contract_address, subscribe_calldata('c-2', creator_id, 0, 4).span(), 0);

    assert(vault.is_active('c-2'), 'second subscribe blocked');
    let (_, _, _, _, n, escrow, next, cancelled) = vault.schedule_of('c-2');
    assert(n == 4 && escrow == TIER_0 * 4 && next == 0 && !cancelled, 'second schedule wrong');
}

#[test]
fn donation_surplus_is_unaccounted() {
    // After a 1-wei donation plus two subscribes, `accounted` tracks exactly the
    // sum of the two schedules' prices; the donated wei is surplus the vault
    // never credits, so the actual balance sits one wei above accounted.
    let (pool, token, vault, creator_id) = setup();
    start_cheat_block_number(vault.contract_address, 1000);

    pool.transfer_to(token.contract_address, vault.contract_address, (TIER_0 * 4).into());
    pool.invoke_external(vault.contract_address, subscribe_calldata('c-1', creator_id, 0, 4).span(), 0);

    token.mint(vault.contract_address, 1);

    pool.transfer_to(token.contract_address, vault.contract_address, (TIER_1 * 2).into());
    pool.invoke_external(vault.contract_address, subscribe_calldata('c-2', creator_id, 1, 2).span(), 0);

    // accounted == price('c-1') + price('c-2'); the stray wei is excluded.
    let expected_accounted: u256 = (TIER_0 * 4 + TIER_1 * 2).into();
    assert(vault.accounted(token.contract_address) == expected_accounted, 'donation was accounted');
    // The vault actually holds exactly accounted + the 1 stray wei.
    assert(
        token.balance_of(vault.contract_address) == expected_accounted + 1, 'balance != accounted+1',
    );
}

#[test]
fn donation_equal_to_price_funds_the_next_subscribe() {
    // The other half of the `>=` custody check, documented rather than hidden.
    // A surplus smaller than any schedule price just sits there
    // (donation_surplus_is_unaccounted). A surplus at least one schedule price
    // large is absorbed by the next subscribe for that schedule, first taker:
    // here the vault holds exactly TIER_0 * 4 in donated tokens, the pool
    // delivers nothing, and the subscribe passes on the donation alone with a
    // fully funded escrow. Either way the money is lost to whoever sent it. It
    // is not a hole — the vault credits one schedule's escrow for one schedule's
    // price, so nobody gets escrow that was not paid for.
    let (pool, token, vault, creator_id) = setup();
    start_cheat_block_number(vault.contract_address, 1000);

    token.mint(vault.contract_address, (TIER_0 * 4).into());
    // No pool.transfer_to: the donation is the only money the vault holds.
    pool.invoke_external(vault.contract_address, subscribe_calldata('c-1', creator_id, 0, 4).span(), 0);

    assert(vault.is_active('c-1'), 'donation-funded sub blocked');
    let (_, _, _, _, n, escrow, next, cancelled) = vault.schedule_of('c-1');
    assert(n == 4 && escrow == TIER_0 * 4 && next == 0 && !cancelled, 'bad schedule');
    // Fully accounted: the donation is now escrow the vault owes the schedule,
    // and accounted <= balance still holds exactly.
    assert(vault.accounted(token.contract_address) == (TIER_0 * 4).into(), 'donation not accounted');
    assert(
        token.balance_of(vault.contract_address) == (TIER_0 * 4).into(), 'balance != accounted',
    );
}

#[test]
#[should_panic(expected: 'NS_ZERO_ADDRESS')]
fn register_creator_rejects_zero_token() {
    // The duplicate guard reads creator_token back and treats zero as "not
    // registered", so a zero-token registration would write a creator whose own
    // guard reads unset and could be re-registered over itself.
    let (_, _, vault, _) = setup();
    let zero: ContractAddress = 0.try_into().unwrap();
    let creator: ContractAddress = 'creator-z'.try_into().unwrap();
    start_cheat_caller_address(vault.contract_address, creator);
    vault.register_creator(zero, 'payout-key-z', array![TIER_0].span());
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
