// The NIGHTSHIFT gate: tier-gated access on top of a subscription the vault
// already holds. A standalone contract that reads the deployed vault through
// its interface (0x277519c8bc1031188313de4528d1f0159319f8f86651422e89b6fbd920b3759
// on mainnet) and needs no change to it.
//
// What a presentation is. `present` is a signature presentation, not a proof.
// The commitment travels in the calldata and in the Presented event, so a
// verifier, and anyone else reading the chain, can link two presentations of
// the same subscription to each other, at one gate or across several. What the
// verifier gets is (creator_id, tier) and the commitment. What it does not get
// is a wallet: the subscriber authorizes with the same STARK key the vault
// holds for cancel and reclaim, never with an account address.
//
// Why enrollment exists, and what it does not prove. The vault stores
// sub_owner_key but exposes no view for it: schedule_of stops at (creator_id,
// tier, period_blocks, start_block, n_periods, escrow, next_period, cancelled).
// The gate cannot ask the vault which key owns a commitment, so it keeps its
// own write-once registration. `enroll` is self-attesting: the signature over
// enroll_message(commitment, owner_key) proves control of owner_key and nothing
// beyond that. It does not prove owner_key is the key the vault recorded at
// subscribe time. The binding between a registered key and the subscription
// behind it is therefore only as strong as first-enrollment-wins: one write per
// commitment, 'NG_ALREADY_ENROLLED' on every later attempt.
//
// The cost of that, stated plainly rather than glossed. Commitments are public:
// they travel in the pool's invoke calldata and are named in the vault's
// Subscribed event. Someone watching the chain can register a key of their own
// against a commitment before the real subscriber gets there. That front-runner
// locks the subscriber out of this gate permanently, and, until the sub lapses,
// presents against a subscription they did not pay for. Nothing in this
// contract detects it. Subscribers should enroll in the transaction that
// follows their subscribe, and a verifier that needs more assurance than a race
// should read the block height of the Enrolled event and compare it against
// start_block from the vault.
//
// v4 removes the assumption instead of narrowing it: the vault grows an
// owner_key view, the gate reads the key from the vault rather than from its
// own map, and enroll disappears from this ABI.

#[starknet::interface]
pub trait INightshiftGate<T> {
    /// One-time key registration for `commitment`, authorized by a signature
    /// over enroll_message(commitment, owner_key) under `owner_key` itself.
    /// Write-once: a second call for the same commitment reverts, whoever makes
    /// it and whatever key it carries.
    fn enroll(ref self: T, commitment: felt252, owner_key: felt252, sig_r: felt252, sig_s: felt252);

    /// Prove control of an active subscription to one verifier, up to one block
    /// height. Reverts unless the vault still calls the subscription active,
    /// the current block is at or below `expiry_block`, and the signature over
    /// present_message(commitment, verifier_id, expiry_block) matches the key
    /// enrolled for `commitment`. Returns the (creator_id, tier) the verifier
    /// gates on.
    fn present(
        ref self: T,
        commitment: felt252,
        verifier_id: felt252,
        expiry_block: u64,
        sig_r: felt252,
        sig_s: felt252,
    ) -> (felt252, u8);

    // --- views ---
    /// Passthrough to the vault. False for a commitment the vault never saw.
    fn is_active(self: @T, commitment: felt252) -> bool;
    /// (creator_id, tier) from the vault's schedule. (0, 0) for an unknown
    /// commitment, which is the same answer the vault's empty storage gives.
    fn tier_of(self: @T, commitment: felt252) -> (felt252, u8);
    /// The registered key, or 0 if this commitment was never enrolled.
    fn enrolled_key(self: @T, commitment: felt252) -> felt252;
}

pub mod errors {
    pub const NOT_ACTIVE: felt252 = 'NG_NOT_ACTIVE';
    pub const EXPIRED: felt252 = 'NG_EXPIRED';
    pub const BAD_SIG: felt252 = 'NG_BAD_SIGNATURE';
    pub const NOT_ENROLLED: felt252 = 'NG_NOT_ENROLLED';
    pub const ALREADY_ENROLLED: felt252 = 'NG_ALREADY_ENROLLED';
    pub const ZERO_KEY: felt252 = 'NG_ZERO_KEY';
    pub const ZERO_VAULT: felt252 = 'NG_ZERO_VAULT';
}

#[starknet::contract]
pub mod NightshiftGate {
    use core::ecdsa::check_ecdsa_signature;
    use core::num::traits::Zero;
    use starknet::storage::{
        Map, StoragePathEntry, StoragePointerReadAccess, StoragePointerWriteAccess,
    };
    use starknet::{ContractAddress, get_block_number};
    use crate::common::{enroll_message, present_message};
    use crate::vault::{INightshiftVaultDispatcher, INightshiftVaultDispatcherTrait};
    use super::errors;

    #[storage]
    struct Storage {
        /// Set once at deploy. The gate holds no privileges over the vault and
        /// only ever reads from it.
        vault: ContractAddress,
        /// commitment -> registered STARK pubkey. Write-once.
        key_of: Map<felt252, felt252>,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        Enrolled: Enrolled,
        Presented: Presented,
    }

    /// The block this lands in is the only evidence of enrollment order, which
    /// is what first-enrollment-wins rests on.
    #[derive(Drop, starknet::Event)]
    pub struct Enrolled {
        pub commitment: felt252,
        pub owner_key: felt252,
    }

    /// Emitted after every check passes. Public by construction: a verifier
    /// wanting an on-chain receipt reads this, and so can everyone else.
    #[derive(Drop, starknet::Event)]
    pub struct Presented {
        pub commitment: felt252,
        pub verifier_id: felt252,
        pub expiry_block: u64,
        pub tier: u8,
    }

    #[constructor]
    fn constructor(ref self: ContractState, vault: ContractAddress) {
        assert(vault.is_non_zero(), errors::ZERO_VAULT);
        self.vault.write(vault);
    }

    #[abi(embed_v0)]
    impl GateImpl of super::INightshiftGate<ContractState> {
        fn enroll(
            ref self: ContractState,
            commitment: felt252,
            owner_key: felt252,
            sig_r: felt252,
            sig_s: felt252,
        ) {
            assert(owner_key != 0, errors::ZERO_KEY);
            assert(self.key_of.entry(commitment).read() == 0, errors::ALREADY_ENROLLED);
            let msg = enroll_message(commitment, owner_key);
            assert(check_ecdsa_signature(msg, owner_key, sig_r, sig_s), errors::BAD_SIG);
            self.key_of.entry(commitment).write(owner_key);
            self.emit(Enrolled { commitment, owner_key });
        }

        fn present(
            ref self: ContractState,
            commitment: felt252,
            verifier_id: felt252,
            expiry_block: u64,
            sig_r: felt252,
            sig_s: felt252,
        ) -> (felt252, u8) {
            // Liveness first: an unknown, cancelled or exhausted subscription
            // fails here, before any signature work, and a valid signature buys
            // nothing past that point.
            let vault = INightshiftVaultDispatcher { contract_address: self.vault.read() };
            assert(vault.is_active(commitment), errors::NOT_ACTIVE);
            assert(get_block_number() <= expiry_block, errors::EXPIRED);

            let key = self.key_of.entry(commitment).read();
            assert(key != 0, errors::NOT_ENROLLED);
            let msg = present_message(commitment, verifier_id, expiry_block);
            assert(check_ecdsa_signature(msg, key, sig_r, sig_s), errors::BAD_SIG);

            let (creator_id, tier, _, _, _, _, _, _) = vault.schedule_of(commitment);
            self.emit(Presented { commitment, verifier_id, expiry_block, tier });
            (creator_id, tier)
        }

        fn is_active(self: @ContractState, commitment: felt252) -> bool {
            INightshiftVaultDispatcher { contract_address: self.vault.read() }.is_active(commitment)
        }

        fn tier_of(self: @ContractState, commitment: felt252) -> (felt252, u8) {
            let (creator_id, tier, _, _, _, _, _, _) = INightshiftVaultDispatcher {
                contract_address: self.vault.read(),
            }
                .schedule_of(commitment);
            (creator_id, tier)
        }

        fn enrolled_key(self: @ContractState, commitment: felt252) -> felt252 {
            self.key_of.entry(commitment).read()
        }
    }
}
