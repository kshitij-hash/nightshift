// Shared types for the vault, the gate, and the test harness.
//
// `OpenNoteDeposit` is re-exported from the privacy SDK rather than mirrored, so
// the vault's return data cannot drift out of serde-agreement with what the pool
// deserializes: a field added or reordered upstream becomes a compile error here
// instead of a batch that reverts on mainnet.

use core::poseidon::poseidon_hash_span;
pub use privacy::objects::OpenNoteDeposit;
use starknet::ContractAddress;

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
    /// STARK pubkey authorizing cancel/reclaim and gate presentations.
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
/// Tagged like every other hash here: an untagged poseidon(commitment, index)
/// shares its input shape with the other two-field hashes this codebase builds,
/// and a tag costs one felt to rule that collision out for good.
pub fn period_nullifier(commitment: felt252, period_index: u64) -> felt252 {
    poseidon_hash_span(['NIGHTSHIFT_PERIOD_NUL', commitment, period_index.into()].span())
}

/// Domain-separated message hashes for the signatures the vault checks.
pub fn claim_message(creator_id: felt252, note_id: felt252, amount: u128) -> felt252 {
    poseidon_hash_span(['NIGHTSHIFT_CLAIM', creator_id, note_id, amount.into()].span())
}

/// The public claim leg. A separate tag from claim_message on purpose: a
/// signature the creator produced to settle into a pool note must not also
/// authorize a transfer to a public address, and vice versa. The destination is
/// inside the message, so a relayer cannot redirect the payout. The nonce is
/// the creator's claim_pub_nonce at signing time (read via claim_pub_nonce_of)
/// and is consumed on execution: without it a captured signature would be a
/// standing order anyone could re-fire each time claimable refills.
pub fn claim_public_message(
    creator_id: felt252, to: ContractAddress, amount: u128, nonce: felt252,
) -> felt252 {
    poseidon_hash_span(
        ['NIGHTSHIFT_CLAIM_PUB', creator_id, to.into(), amount.into(), nonce].span(),
    )
}

pub fn cancel_message(commitment: felt252) -> felt252 {
    poseidon_hash_span(['NIGHTSHIFT_CANCEL', commitment].span())
}

pub fn reclaim_message(commitment: felt252, to: ContractAddress) -> felt252 {
    poseidon_hash_span(['NIGHTSHIFT_RECLAIM', commitment, to.into()].span())
}

/// Nonce-bound presentation message. The nonce lets one subscriber present to
/// the same verifier more than once: each fresh nonce is a distinct signed
/// message, so a captured (sig_r, sig_s) reproduces only the one
/// (commitment, verifier_id, expiry_block, nonce) tuple it was signed over.
/// This is the message the gate's `present` checks. The verifier id and the
/// expiry height are inside the signed message, so a presentation captured by
/// verifier A does not verify at verifier B, and none verify past the height
/// the signer picked.
pub fn present_nonce_message(
    commitment: felt252, verifier_id: felt252, expiry_block: u64, nonce: felt252,
) -> felt252 {
    poseidon_hash_span(
        ['NIGHTSHIFT_PRESENT', commitment, verifier_id, expiry_block.into(), nonce].span(),
    )
}

/// Write-once nullifier a presentation burns at the gate, one per
/// (commitment, verifier_id, expiry_block, nonce). Keyed on the message, not
/// the signature: ECDSA (r, s) and (r, -s) verify the same message, so keying
/// on the tuple stops a malleated copy from minting a second nullifier for a
/// presentation the gate already recorded.
pub fn present_nullifier(
    commitment: felt252, verifier_id: felt252, expiry_block: u64, nonce: felt252,
) -> felt252 {
    poseidon_hash_span(
        ['NIGHTSHIFT_PRESENT_NUL', commitment, verifier_id, expiry_block.into(), nonce].span(),
    )
}

pub fn is_ladder_period(period_blocks: u64) -> bool {
    period_blocks == PERIOD_HOUR || period_blocks == PERIOD_DAY || period_blocks == PERIOD_WEEK
}
