// Shared types for the vault, the gate, and the test harness.
//
// `OpenNoteDeposit` mirrors `privacy::objects::OpenNoteDeposit` field-for-field
// (note_id, token, amount) so the vault's return data serde-matches what the
// pool deserializes, without pulling the privacy package into every consumer.

use core::poseidon::poseidon_hash_span;
use starknet::ContractAddress;

#[derive(Copy, Drop, Serde, PartialEq, Debug)]
pub struct OpenNoteDeposit {
    pub note_id: felt252,
    pub token: ContractAddress,
    pub amount: u128,
}

/// Billing period ladder, in blocks (~30s Starknet blocks). Quantized so a
/// schedule cannot fingerprint a subscriber: every subscription is one of a
/// small set of shapes.
pub const PERIOD_DAY: u64 = 2880;
pub const PERIOD_WEEK: u64 = 20160;
pub const PERIOD_MONTH: u64 = 86400;

/// Tier amounts, in the token's smallest unit, quantized for the same reason.
/// Tier index is what the gate exposes; the amount ladder is per-creator.
#[derive(Copy, Drop, Serde, PartialEq, Debug)]
pub struct Schedule {
    /// Subscriber's commitment: poseidon(secret, creator_id) — computed
    /// client-side; the vault never learns the secret.
    pub commitment: felt252,
    /// The creator being subscribed to (registered in the vault).
    pub creator_id: felt252,
    /// Index into the creator's tier ladder.
    pub tier: u8,
    /// Blocks per billing period — must be one of the PERIOD_* ladder.
    pub period_blocks: u64,
    /// Number of periods pre-escrowed.
    pub n_periods: u32,
    /// Key authorized to cancel/present on behalf of the subscriber.
    pub owner_key: felt252,
}

/// The operation the pool's InvokeExternal calldata deserializes into.
#[derive(Copy, Drop, Serde)]
pub enum VaultOp {
    Subscribe: Schedule,
    Release: ReleaseArgs,
}

#[derive(Copy, Drop, Serde)]
pub struct ReleaseArgs {
    pub commitment: felt252,
    /// Open note (already created earlier in the same pool batch) that the
    /// released funds fill — returned to the pool as the single deposit.
    pub note_id: felt252,
}

/// One nullifier per (commitment, period): spent exactly once, so a charge for
/// a period can never fire twice, and periods are meaningless to an observer.
pub fn period_nullifier(commitment: felt252, period_index: u64) -> felt252 {
    poseidon_hash_span([commitment, period_index.into()].span())
}

pub fn is_ladder_period(period_blocks: u64) -> bool {
    period_blocks == PERIOD_DAY || period_blocks == PERIOD_WEEK || period_blocks == PERIOD_MONTH
}
