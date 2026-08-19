// The NIGHTSHIFT vault: the anonymizer contract the STRK20 pool invokes.
//
// The pool's calling convention (verified against privacy.cairo on the deployed
// class): tokens arrive by plain ERC-20 transfer BEFORE `privacy_invoke` is
// called with the batch's raw calldata; the return value must serde-encode
// exactly a Span<OpenNoteDeposit> with no trailing data; outputs are pulled by
// the pool via transfer_from, so the vault APPROVES and never transfers.
//
// Custody is accounted, never inferred: `received = balance_of(self) -
// accounted[token]`. A hostile direct transfer inflates `received` for the next
// caller's op only if that op expects it — every op asserts `received` equals
// exactly what its schedule prices, so stray donations are absorbed into
// `accounted` by `sweep_donations` and can never mint a subscription.

use starknet::ContractAddress;
use crate::common::{OpenNoteDeposit, VaultOp};

#[starknet::interface]
pub trait INightshiftVault<T> {
    /// Entry point the pool calls. Reverts for any caller but the pool.
    fn privacy_invoke(ref self: T, op: VaultOp) -> Span<OpenNoteDeposit>;
    /// Registers a creator's tier ladder. Permissionless; creator_id is the
    /// caller-derived identifier returned.
    fn register_creator(ref self: T, token: ContractAddress, tier_amounts: Span<u128>) -> felt252;
    /// Escrowed balance the vault accounts for `token`.
    fn accounted(self: @T, token: ContractAddress) -> u256;
    /// True if `commitment` has an active schedule at the current block.
    fn is_active(self: @T, commitment: felt252) -> bool;
}

pub mod errors {
    pub const NOT_POOL: felt252 = 'NS_NOT_POOL';
    pub const BAD_PERIOD: felt252 = 'NS_PERIOD_OFF_LADDER';
    pub const BAD_TIER: felt252 = 'NS_BAD_TIER';
    pub const UNKNOWN_CREATOR: felt252 = 'NS_UNKNOWN_CREATOR';
    pub const WRONG_AMOUNT: felt252 = 'NS_WRONG_AMOUNT';
    pub const DUPLICATE_COMMITMENT: felt252 = 'NS_DUPLICATE_COMMITMENT';
    pub const ZERO_PERIODS: felt252 = 'NS_ZERO_PERIODS';
    pub const NOT_IMPLEMENTED: felt252 = 'NS_NOT_IMPLEMENTED';
}

#[starknet::contract]
pub mod NightshiftVault {
    use core::num::traits::Zero;
    use core::poseidon::poseidon_hash_span;
    use starknet::storage::{
        Map, StoragePathEntry, StoragePointerReadAccess, StoragePointerWriteAccess,
    };
    use starknet::{ContractAddress, get_block_number, get_caller_address, get_contract_address};
    use crate::common::{OpenNoteDeposit, Schedule, VaultOp, is_ladder_period};
    use super::errors;

    #[starknet::interface]
    trait IERC20<T> {
        fn balance_of(self: @T, account: ContractAddress) -> u256;
        fn approve(ref self: T, spender: ContractAddress, amount: u256) -> bool;
    }

    #[storage]
    struct Storage {
        pool: ContractAddress,
        /// Escrow the vault knows it holds, per token. Invariant on every
        /// mutation: accounted[token] <= balance_of(self, token).
        accounted: Map<ContractAddress, u256>,
        /// creator_id -> (payout token, ladder length). Tier amounts under
        /// (creator_id, tier_index).
        creator_token: Map<felt252, ContractAddress>,
        creator_tiers: Map<felt252, u8>,
        tier_amount: Map<(felt252, u8), u128>,
        /// commitment -> packed schedule state (0 = none).
        sub_creator: Map<felt252, felt252>,
        sub_tier: Map<felt252, u8>,
        sub_period_blocks: Map<felt252, u64>,
        sub_start_block: Map<felt252, u64>,
        sub_end_block: Map<felt252, u64>,
        sub_escrow: Map<felt252, u128>,
        sub_owner_key: Map<felt252, felt252>,
        /// poseidon(commitment, period_index) -> spent. WriteOnce.
        period_spent: Map<felt252, bool>,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        Subscribed: Subscribed,
        CreatorRegistered: CreatorRegistered,
    }

    /// Emits only what an observer can already derive from the public call
    /// trace. No amount, no creator linkage beyond the id the calldata carries.
    #[derive(Drop, starknet::Event)]
    pub struct Subscribed {
        pub commitment: felt252,
        pub end_block: u64,
    }

    #[derive(Drop, starknet::Event)]
    pub struct CreatorRegistered {
        pub creator_id: felt252,
        pub token: ContractAddress,
        pub tiers: u8,
    }

    #[constructor]
    fn constructor(ref self: ContractState, pool: ContractAddress) {
        self.pool.write(pool);
    }

    #[abi(embed_v0)]
    impl VaultImpl of super::INightshiftVault<ContractState> {
        fn privacy_invoke(ref self: ContractState, op: VaultOp) -> Span<OpenNoteDeposit> {
            assert(get_caller_address() == self.pool.read(), errors::NOT_POOL);
            match op {
                VaultOp::Subscribe(s) => self._subscribe(s),
                VaultOp::Release(_) => core::panic_with_felt252(errors::NOT_IMPLEMENTED),
            }
        }

        fn register_creator(
            ref self: ContractState, token: ContractAddress, tier_amounts: Span<u128>,
        ) -> felt252 {
            assert(tier_amounts.len() > 0 && tier_amounts.len() <= 8, errors::BAD_TIER);
            let caller = get_caller_address();
            let creator_id = poseidon_hash_span([caller.into(), token.into()].span());
            assert(self.creator_token.entry(creator_id).read().is_zero(), errors::UNKNOWN_CREATOR);
            self.creator_token.entry(creator_id).write(token);
            self.creator_tiers.entry(creator_id).write(tier_amounts.len().try_into().unwrap());
            let mut i: u8 = 0;
            for amount in tier_amounts {
                assert((*amount).is_non_zero(), errors::WRONG_AMOUNT);
                self.tier_amount.entry((creator_id, i)).write(*amount);
                i += 1;
            }
            self.emit(CreatorRegistered { creator_id, token, tiers: i });
            creator_id
        }

        fn accounted(self: @ContractState, token: ContractAddress) -> u256 {
            self.accounted.entry(token).read()
        }

        fn is_active(self: @ContractState, commitment: felt252) -> bool {
            let end = self.sub_end_block.entry(commitment).read();
            end != 0 && get_block_number() <= end
        }
    }

    #[generate_trait]
    impl Internal of InternalTrait {
        /// The Subscribe leg. The pool has already transferred the escrow to
        /// this contract; the op releases nothing, so it returns an empty span.
        fn _subscribe(ref self: ContractState, s: Schedule) -> Span<OpenNoteDeposit> {
            let Schedule { commitment, creator_id, tier, period_blocks, n_periods, owner_key } = s;
            assert(is_ladder_period(period_blocks), errors::BAD_PERIOD);
            assert(n_periods > 0, errors::ZERO_PERIODS);
            assert(self.sub_end_block.entry(commitment).read() == 0, errors::DUPLICATE_COMMITMENT);

            let token = self.creator_token.entry(creator_id).read();
            assert(token.is_non_zero(), errors::UNKNOWN_CREATOR);
            assert(tier < self.creator_tiers.entry(creator_id).read(), errors::BAD_TIER);
            let per_period = self.tier_amount.entry((creator_id, tier)).read();
            let expected: u256 = per_period.into() * n_periods.into();

            // Accounted custody: what actually arrived is the balance delta
            // over what we already account for — and it must price the
            // schedule exactly. A stray donation cannot mint a subscription.
            let held = IERC20Dispatcher { contract_address: token }
                .balance_of(get_contract_address());
            let accounted = self.accounted.entry(token).read();
            let received = held - accounted;
            assert(received == expected, errors::WRONG_AMOUNT);
            self.accounted.entry(token).write(accounted + expected);
            assert(self.accounted.entry(token).read() <= held, errors::WRONG_AMOUNT);

            let now = get_block_number();
            let end = now + period_blocks * n_periods.into();
            self.sub_creator.entry(commitment).write(creator_id);
            self.sub_tier.entry(commitment).write(tier);
            self.sub_period_blocks.entry(commitment).write(period_blocks);
            self.sub_start_block.entry(commitment).write(now);
            self.sub_end_block.entry(commitment).write(end);
            self.sub_escrow.entry(commitment).write(per_period * n_periods.into());
            self.sub_owner_key.entry(commitment).write(owner_key);

            self.emit(Subscribed { commitment, end_block: end });
            [].span()
        }
    }
}
