// The NIGHTSHIFT vault v3: the anonymizer contract the STRK20 pool invokes,
// plus a permissionless charge path and signature-gated lifecycle.
//
// v3 separates *charging* from *settlement*:
//   - charge(commitment): a PLAIN PUBLIC call. Anyone (a keeper on cron, a
//     relayer, the subscriber) may fire a due charge. It consumes the period
//     nullifier and moves the period's amount from the subscription's escrow
//     into the creator's claimable balance. No pool batch, no proof, no wallet
//     API — so the unattended keeper needs none of those either.
//   - claim (via privacy_invoke): the CREATOR settles accumulated claimable
//     into the pool privately, signing over the exact open note and amount.
//     A keeper can never redirect funds: money only leaves under a
//     creator-signed claim.
//
// Subscribe still arrives through privacy_invoke (escrow enters with the
// commitment). Cancel/reclaim are signature-gated by the subscriber's
// owner_key, so revocation never names a wallet.

use starknet::ContractAddress;
use crate::common::{OpenNoteDeposit, VaultOp};

#[starknet::interface]
pub trait INightshiftVault<T> {
    /// Pool entry point. Reverts for any caller but the pool. Handles Subscribe
    /// and Claim ops.
    fn privacy_invoke(ref self: T, op: VaultOp) -> Span<OpenNoteDeposit>;

    /// Permissionless: fire the next due charge for `commitment`. Reverts if
    /// not due, already charged, or escrow exhausted. Callable by anyone.
    fn charge(ref self: T, commitment: felt252) -> u32;

    /// Registers a creator's tier ladder and payout key. Returns creator_id.
    fn register_creator(
        ref self: T, token: ContractAddress, payout_key: felt252, tier_amounts: Span<u128>,
    ) -> felt252;

    /// Subscriber cancels: no further charges; remaining escrow becomes
    /// reclaimable. Authorized by a signature over cancel_message(commitment).
    fn cancel(ref self: T, commitment: felt252, sig_r: felt252, sig_s: felt252);

    /// Subscriber reclaims cancelled/unspent escrow to a public address.
    /// Authorized by a signature over reclaim_message(commitment, to).
    fn reclaim(ref self: T, commitment: felt252, to: ContractAddress, sig_r: felt252, sig_s: felt252);

    // --- views ---
    fn accounted(self: @T, token: ContractAddress) -> u256;
    fn is_active(self: @T, commitment: felt252) -> bool;
    /// The STARK pubkey recorded for `commitment` at subscribe, 0 if unknown.
    /// The key is already public in the pool invoke calldata; this view lets the
    /// gate bind presentations to the exact key the vault recorded at subscribe,
    /// with no registration step.
    fn owner_key_of(self: @T, commitment: felt252) -> felt252;
    fn claimable_of(self: @T, creator_id: felt252) -> u128;
    fn schedule_of(self: @T, commitment: felt252) -> (felt252, u8, u64, u64, u32, u128, u32, bool);
    fn tier_of(self: @T, creator_id: felt252, tier: u8) -> (ContractAddress, u128);
    fn periods_due(self: @T, commitment: felt252) -> u32;
    /// Whether the write-once nullifier for (commitment, period) is consumed.
    fn period_charged(self: @T, commitment: felt252, period_index: u64) -> bool;
}

pub mod errors {
    pub const NOT_POOL: felt252 = 'NS_NOT_POOL';
    pub const BAD_PERIOD: felt252 = 'NS_PERIOD_OFF_LADDER';
    pub const BAD_TIER: felt252 = 'NS_BAD_TIER';
    pub const UNKNOWN_CREATOR: felt252 = 'NS_UNKNOWN_CREATOR';
    pub const DUP_CREATOR: felt252 = 'NS_CREATOR_EXISTS';
    pub const WRONG_AMOUNT: felt252 = 'NS_WRONG_AMOUNT';
    pub const DUPLICATE_COMMITMENT: felt252 = 'NS_DUPLICATE_COMMITMENT';
    pub const ZERO_PERIODS: felt252 = 'NS_ZERO_PERIODS';
    pub const UNKNOWN_SUB: felt252 = 'NS_UNKNOWN_SUB';
    pub const NOT_DUE: felt252 = 'NS_NOT_DUE';
    pub const EXHAUSTED: felt252 = 'NS_ESCROW_EXHAUSTED';
    pub const CANCELLED: felt252 = 'NS_CANCELLED';
    pub const BAD_SIG: felt252 = 'NS_BAD_SIGNATURE';
    pub const CLAIM_TOO_MUCH: felt252 = 'NS_CLAIM_EXCEEDS_BALANCE';
    pub const ZERO_KEY: felt252 = 'NS_ZERO_PAYOUT_KEY';
    pub const PERIOD_SPENT: felt252 = 'NS_PERIOD_SPENT';
    pub const ZERO_ADDRESS: felt252 = 'NS_ZERO_ADDRESS';
}

#[starknet::contract]
pub mod NightshiftVault {
    use core::ecdsa::check_ecdsa_signature;
    use core::num::traits::Zero;
    use core::poseidon::poseidon_hash_span;
    use starknet::storage::{
        Map, StoragePathEntry, StoragePointerReadAccess, StoragePointerWriteAccess,
    };
    use starknet::{ContractAddress, get_block_number, get_caller_address, get_contract_address};
    use crate::common::{
        ClaimArgs, OpenNoteDeposit, Schedule, VaultOp, cancel_message, claim_message,
        is_ladder_period, period_nullifier, reclaim_message,
    };
    use super::errors;

    #[starknet::interface]
    trait IERC20<T> {
        fn balance_of(self: @T, account: ContractAddress) -> u256;
        fn approve(ref self: T, spender: ContractAddress, amount: u256) -> bool;
        fn transfer(ref self: T, recipient: ContractAddress, amount: u256) -> bool;
    }

    #[storage]
    struct Storage {
        pool: ContractAddress,
        /// Escrow the vault knows it holds, per token. Invariant on every
        /// mutation: accounted[token] <= balance_of(self, token).
        accounted: Map<ContractAddress, u256>,
        // creators
        creator_token: Map<felt252, ContractAddress>,
        creator_key: Map<felt252, felt252>,
        creator_tiers: Map<felt252, u8>,
        tier_amount: Map<(felt252, u8), u128>,
        /// Charged-but-unsettled balance owed to each creator.
        claimable: Map<felt252, u128>,
        // subscriptions (0 end_period = none)
        sub_creator: Map<felt252, felt252>,
        sub_tier: Map<felt252, u8>,
        sub_period_blocks: Map<felt252, u64>,
        sub_start_block: Map<felt252, u64>,
        sub_n_periods: Map<felt252, u32>,
        sub_escrow: Map<felt252, u128>,
        sub_next_period: Map<felt252, u32>,
        sub_owner_key: Map<felt252, felt252>,
        sub_cancelled: Map<felt252, bool>,
        /// poseidon(commitment, period_index) -> spent. WriteOnce.
        period_spent: Map<felt252, bool>,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        Subscribed: Subscribed,
        CreatorRegistered: CreatorRegistered,
        Charged: Charged,
        Claimed: Claimed,
        Cancelled: Cancelled,
        Reclaimed: Reclaimed,
    }

    /// The natural filter field of each event below is `#[key]`: getEvents
    /// filters on keys only, so an indexer that wants one subscription's history
    /// (or one creator's) asks the node for it instead of scanning every event
    /// the vault ever emitted.
    #[derive(Drop, starknet::Event)]
    pub struct Subscribed {
        #[key]
        pub commitment: felt252,
        pub creator_id: felt252,
        pub n_periods: u32,
    }

    #[derive(Drop, starknet::Event)]
    pub struct CreatorRegistered {
        #[key]
        pub creator_id: felt252,
        pub token: ContractAddress,
        pub tiers: u8,
    }

    /// A charge fired. `by` is whoever triggered it — for the demo's
    /// "nobody at a keyboard", this is the keeper account, provably not the
    /// subscriber.
    #[derive(Drop, starknet::Event)]
    pub struct Charged {
        #[key]
        pub commitment: felt252,
        pub period_index: u32,
        pub amount: u128,
        pub by: ContractAddress,
    }

    #[derive(Drop, starknet::Event)]
    pub struct Claimed {
        #[key]
        pub creator_id: felt252,
        pub amount: u128,
    }

    #[derive(Drop, starknet::Event)]
    pub struct Cancelled {
        #[key]
        pub commitment: felt252,
    }

    #[derive(Drop, starknet::Event)]
    pub struct Reclaimed {
        #[key]
        pub commitment: felt252,
        pub amount: u128,
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
                VaultOp::Claim(c) => self._claim(c),
            }
        }

        fn charge(ref self: ContractState, commitment: felt252) -> u32 {
            let creator_id = self.sub_creator.entry(commitment).read();
            assert(creator_id != 0, errors::UNKNOWN_SUB);
            assert(!self.sub_cancelled.entry(commitment).read(), errors::CANCELLED);

            let idx = self.sub_next_period.entry(commitment).read();
            assert(idx < self.sub_n_periods.entry(commitment).read(), errors::EXHAUSTED);

            let per_period = self
                .tier_amount
                .entry((creator_id, self.sub_tier.entry(commitment).read()))
                .read();
            let escrow = self.sub_escrow.entry(commitment).read();
            assert(escrow >= per_period, errors::EXHAUSTED);

            let start = self.sub_start_block.entry(commitment).read();
            let period_blocks = self.sub_period_blocks.entry(commitment).read();
            let due_at = start + period_blocks * idx.into();
            assert(get_block_number() >= due_at, errors::NOT_DUE);

            // Write-once nullifier: the real double-charge defense, independent
            // of the ordering pointer.
            let nullifier = period_nullifier(commitment, idx.into());
            assert(!self.period_spent.entry(nullifier).read(), errors::PERIOD_SPENT);
            self.period_spent.entry(nullifier).write(true);

            self.sub_next_period.entry(commitment).write(idx + 1);
            self.sub_escrow.entry(commitment).write(escrow - per_period);
            // Move value from this subscription's escrow into what the creator
            // may claim. Tokens do not leave the vault; only the accounting
            // shifts. `accounted` is unchanged — the vault still custodies it.
            let owed = self.claimable.entry(creator_id).read();
            self.claimable.entry(creator_id).write(owed + per_period);

            self.emit(Charged { commitment, period_index: idx, amount: per_period, by: get_caller_address() });
            idx + 1
        }

        fn register_creator(
            ref self: ContractState,
            token: ContractAddress,
            payout_key: felt252,
            tier_amounts: Span<u128>,
        ) -> felt252 {
            assert(tier_amounts.len() > 0 && tier_amounts.len() <= 8, errors::BAD_TIER);
            assert(payout_key != 0, errors::ZERO_KEY);
            let caller = get_caller_address();
            let creator_id = poseidon_hash_span([caller.into(), token.into(), payout_key].span());
            assert(self.creator_token.entry(creator_id).read().is_zero(), errors::DUP_CREATOR);
            self.creator_token.entry(creator_id).write(token);
            self.creator_key.entry(creator_id).write(payout_key);
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

        fn cancel(ref self: ContractState, commitment: felt252, sig_r: felt252, sig_s: felt252) {
            assert(self.sub_creator.entry(commitment).read() != 0, errors::UNKNOWN_SUB);
            let key = self.sub_owner_key.entry(commitment).read();
            let msg = cancel_message(commitment);
            assert(check_ecdsa_signature(msg, key, sig_r, sig_s), errors::BAD_SIG);
            // Cancel settles nothing: a period already due but not yet charged is
            // not charged on the way out, it is forfeited to the subscriber (see
            // reclaim). Time-based entitlement is the gate's job, not the vault's.
            self.sub_cancelled.entry(commitment).write(true);
            self.emit(Cancelled { commitment });
        }

        fn reclaim(
            ref self: ContractState,
            commitment: felt252,
            to: ContractAddress,
            sig_r: felt252,
            sig_s: felt252,
        ) {
            let creator_id = self.sub_creator.entry(commitment).read();
            assert(creator_id != 0, errors::UNKNOWN_SUB);
            assert(self.sub_cancelled.entry(commitment).read(), errors::CANCELLED);
            assert(to.is_non_zero(), errors::ZERO_ADDRESS);
            let key = self.sub_owner_key.entry(commitment).read();
            let msg = reclaim_message(commitment, to);
            assert(check_ecdsa_signature(msg, key, sig_r, sig_s), errors::BAD_SIG);

            // Refunds the full remaining escrow, including any period already due
            // but never charged: that period is forfeited to the subscriber by
            // design. Escrow that never became a charge was never owed to the
            // creator, so this breaks no vault invariant (accounted drops by the
            // same amount just below). Whether a due period should have been
            // consumed before cancel is time-based entitlement, owned by the gate.
            let amount = self.sub_escrow.entry(commitment).read();
            assert(amount > 0, errors::EXHAUSTED);
            self.sub_escrow.entry(commitment).write(0);

            let token = self.creator_token.entry(creator_id).read();
            let accounted = self.accounted.entry(token).read();
            self.accounted.entry(token).write(accounted - amount.into());
            // Reclaim is a public exit edge, like all pool edges. A direct
            // transfer, not an approval: a second reclaim to the same address
            // must never clobber a standing allowance, and the recipient is a
            // plain wallet with no way to execute a transfer_from pull.
            let ok = IERC20Dispatcher { contract_address: token }.transfer(to, amount.into());
            assert(ok, errors::EXHAUSTED);
            self.emit(Reclaimed { commitment, amount });
        }

        fn accounted(self: @ContractState, token: ContractAddress) -> u256 {
            self.accounted.entry(token).read()
        }

        fn is_active(self: @ContractState, commitment: felt252) -> bool {
            let creator = self.sub_creator.entry(commitment).read();
            if creator == 0 || self.sub_cancelled.entry(commitment).read() {
                return false;
            }
            self.sub_next_period.entry(commitment).read()
                < self.sub_n_periods.entry(commitment).read()
        }

        fn owner_key_of(self: @ContractState, commitment: felt252) -> felt252 {
            self.sub_owner_key.entry(commitment).read()
        }

        fn claimable_of(self: @ContractState, creator_id: felt252) -> u128 {
            self.claimable.entry(creator_id).read()
        }

        fn schedule_of(
            self: @ContractState, commitment: felt252,
        ) -> (felt252, u8, u64, u64, u32, u128, u32, bool) {
            (
                self.sub_creator.entry(commitment).read(),
                self.sub_tier.entry(commitment).read(),
                self.sub_period_blocks.entry(commitment).read(),
                self.sub_start_block.entry(commitment).read(),
                self.sub_n_periods.entry(commitment).read(),
                self.sub_escrow.entry(commitment).read(),
                self.sub_next_period.entry(commitment).read(),
                self.sub_cancelled.entry(commitment).read(),
            )
        }

        fn tier_of(
            self: @ContractState, creator_id: felt252, tier: u8,
        ) -> (ContractAddress, u128) {
            (
                self.creator_token.entry(creator_id).read(),
                self.tier_amount.entry((creator_id, tier)).read(),
            )
        }

        fn periods_due(self: @ContractState, commitment: felt252) -> u32 {
            let creator = self.sub_creator.entry(commitment).read();
            if creator == 0 || self.sub_cancelled.entry(commitment).read() {
                return 0;
            }
            let idx = self.sub_next_period.entry(commitment).read();
            let n = self.sub_n_periods.entry(commitment).read();
            if idx >= n {
                return 0;
            }
            let start = self.sub_start_block.entry(commitment).read();
            let pb = self.sub_period_blocks.entry(commitment).read();
            let now = get_block_number();
            let mut due: u32 = 0;
            let mut i = idx;
            while i < n {
                if now >= start + pb * i.into() {
                    due += 1;
                    i += 1;
                } else {
                    break;
                }
            }
            due
        }

        fn period_charged(
            self: @ContractState, commitment: felt252, period_index: u64,
        ) -> bool {
            self.period_spent.entry(period_nullifier(commitment, period_index)).read()
        }
    }

    #[generate_trait]
    impl Internal of InternalTrait {
        fn _subscribe(ref self: ContractState, s: Schedule) -> Span<OpenNoteDeposit> {
            let Schedule { commitment, creator_id, tier, period_blocks, n_periods, owner_key } = s;
            assert(is_ladder_period(period_blocks), errors::BAD_PERIOD);
            assert(n_periods > 0, errors::ZERO_PERIODS);
            assert(owner_key != 0, errors::ZERO_KEY);
            assert(self.sub_creator.entry(commitment).read() == 0, errors::DUPLICATE_COMMITMENT);

            let token = self.creator_token.entry(creator_id).read();
            assert(token.is_non_zero(), errors::UNKNOWN_CREATOR);
            assert(tier < self.creator_tiers.entry(creator_id).read(), errors::BAD_TIER);
            let per_period = self.tier_amount.entry((creator_id, tier)).read();
            // u128 multiply FIRST: an over-long schedule panics here, before
            // any state or balance is touched, instead of storing a truncated
            // escrow later.
            let escrow_total: u128 = per_period * n_periods.into();
            let expected: u256 = escrow_total.into();

            // Accounted custody: the pool's withdraw leg must have delivered AT
            // LEAST the schedule price. `>=`, not `==`: exact-equality on the
            // surplus (held - accounted) was a permanent DoS, since a stray 1-wei
            // donation to the vault makes held - accounted != expected for every
            // future subscribe, with no recovery path. A lone donation still
            // cannot subscribe (no withdraw leg, so held == accounted and the
            // check fails). Credited escrow is exactly per_period * n_periods from
            // the schedule, never read off `held`; any surplus stays unaccounted
            // and stuck (the donor's loss), and accounted <= balance still holds.
            let held = IERC20Dispatcher { contract_address: token }
                .balance_of(get_contract_address());
            let accounted = self.accounted.entry(token).read();
            assert(held >= accounted + expected, errors::WRONG_AMOUNT);
            self.accounted.entry(token).write(accounted + expected);

            self.sub_creator.entry(commitment).write(creator_id);
            self.sub_tier.entry(commitment).write(tier);
            self.sub_period_blocks.entry(commitment).write(period_blocks);
            self.sub_start_block.entry(commitment).write(get_block_number());
            self.sub_n_periods.entry(commitment).write(n_periods);
            self.sub_escrow.entry(commitment).write(escrow_total);
            self.sub_owner_key.entry(commitment).write(owner_key);

            self.emit(Subscribed { commitment, creator_id, n_periods });
            [].span()
        }

        /// Creator settles claimable into an open note, signing over the exact
        /// note and amount. Returns one OpenNoteDeposit; approves the pool for
        /// the pull.
        fn _claim(ref self: ContractState, c: ClaimArgs) -> Span<OpenNoteDeposit> {
            let ClaimArgs { creator_id, note_id, amount, sig_r, sig_s } = c;
            let key = self.creator_key.entry(creator_id).read();
            assert(key != 0, errors::UNKNOWN_CREATOR);
            let msg = claim_message(creator_id, note_id, amount);
            assert(check_ecdsa_signature(msg, key, sig_r, sig_s), errors::BAD_SIG);

            let owed = self.claimable.entry(creator_id).read();
            assert(amount > 0 && amount <= owed, errors::CLAIM_TOO_MUCH);
            self.claimable.entry(creator_id).write(owed - amount);

            let token = self.creator_token.entry(creator_id).read();
            let accounted = self.accounted.entry(token).read();
            self.accounted.entry(token).write(accounted - amount.into());
            IERC20Dispatcher { contract_address: token }.approve(self.pool.read(), amount.into());

            self.emit(Claimed { creator_id, amount });
            [OpenNoteDeposit { note_id, token, amount }].span()
        }
    }
}
