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

/// Billing period ladder, in blocks. Mainnet runs ~1.7s blocks, so a day is
/// ~50,400 blocks. Quantized so a schedule cannot fingerprint a subscriber.
pub const PERIOD_HOUR: u64 = 2100;
pub const PERIOD_DAY: u64 = 50400;
pub const PERIOD_WEEK: u64 = 352800;

/// A subscription schedule as committed at subscribe time.
/// `owner_key` is a STARK-curve public key derived from the subscriber's
/// secret — never an account address. Cancel and reclaim are authorized by
/// signatures against it, so revocation does not name a wallet.
#[derive(Copy, Drop, Serde, PartialEq, Debug)]
pub struct Schedule {
    /// poseidon(secret, creator_id), computed client-side.
    pub commitment: felt252,
    pub creator_id: felt252,
    /// Index into the creator's tier ladder.
    pub tier: u8,
    /// Blocks per billing period — one of the PERIOD_* ladder.
    pub period_blocks: u64,
    /// Number of periods pre-escrowed.
    pub n_periods: u32,
    /// STARK pubkey authorizing cancel/reclaim.
    pub owner_key: felt252,
}

/// Operations the pool's InvokeExternal calldata deserializes into.
/// Charging is NOT here: `charge` is a plain permissionless entrypoint —
/// a keeper needs no pool batch, no proof, no wallet API.
#[derive(Copy, Drop, Serde)]
pub enum VaultOp {
    Subscribe: Schedule,
    Claim: ClaimArgs,
}

/// A creator settles accumulated charges into the pool privately. The
/// signature (by the creator's registered payout key) binds the payout to
/// this exact open note and amount, so a keeper or any third party can never
/// redirect funds: money only moves under a creator-signed claim.
/// Replay-safe without a nonce: an open note can be deposited to once.
#[derive(Copy, Drop, Serde)]
pub struct ClaimArgs {
    pub creator_id: felt252,
    /// Open note (created earlier in the same pool batch) receiving payout.
    pub note_id: felt252,
    pub amount: u128,
    pub sig_r: felt252,
    pub sig_s: felt252,
}

/// One nullifier per (commitment, period): write-once, so a charge for a
/// period can never fire twice, whoever triggers it.
pub fn period_nullifier(commitment: felt252, period_index: u64) -> felt252 {
    poseidon_hash_span([commitment, period_index.into()].span())
}

/// Domain-separated message hashes for the three signatures the vault checks.
pub fn claim_message(creator_id: felt252, note_id: felt252, amount: u128) -> felt252 {
    poseidon_hash_span(['NIGHTSHIFT_CLAIM', creator_id, note_id, amount.into()].span())
}

pub fn cancel_message(commitment: felt252) -> felt252 {
    poseidon_hash_span(['NIGHTSHIFT_CANCEL', commitment].span())
}

pub fn reclaim_message(commitment: felt252, to: ContractAddress) -> felt252 {
    poseidon_hash_span(['NIGHTSHIFT_RECLAIM', commitment, to.into()].span())
}

pub fn is_ladder_period(period_blocks: u64) -> bool {
    period_blocks == PERIOD_HOUR || period_blocks == PERIOD_DAY || period_blocks == PERIOD_WEEK
}
