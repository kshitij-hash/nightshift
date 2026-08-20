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
// is a wallet: the subscriber authorizes with the key registered at enroll,
// which is only conjecturally the vault's key (see the enrollment note below),
// never with an account address.
//
// Replay. A presentation is (commitment, verifier_id, expiry_block, nonce) plus
// a signature over them. The gate burns a write-once nullifier keyed on that
// tuple, so the same signed presentation is accepted once and then reverts
// NG_PRESENTED at that verifier. The nullifier is keyed on the message, not the
// signature: ECDSA (r, s) and (r, -s) verify the same message and both map to
// the one nullifier, so a malleated copy does not buy a second admission. To
// present again to one verifier the subscriber signs a fresh nonce, a new tuple
// with its own nullifier. The signed height is bounded too: expiry_block may
// not sit more than MAX_PRESENT_WINDOW blocks ahead of the current block
// (NG_EXPIRY_TOO_FAR), so a captured presentation cannot be held live for long.
//
// Paid-current. Liveness (vault.is_active) is next_period < n_periods with no
// time term, so a subscription whose keeper stopped charging would still read
// active. `present` therefore also requires vault.periods_due == 0
// (NG_ARREARS): every period whose block has arrived must already be charged.
// One consequence, stated rather than hidden: a just-subscribed sub cannot
// present until its period 0 is charged. That is the intended reading of
// entitlement here, paid through the current block.
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
// commitment, NG_ALREADY_ENROLLED on every later attempt.
//
// The front-run window, narrowed. Commitments are public: they travel in the
// pool's invoke calldata and are named in the vault's Subscribed event, so a
// watcher can try to register a key of their own against a commitment before
// the real subscriber does. `enroll` reads the vault to shrink that race. It
// rejects any commitment the vault does not call active (NG_NOT_ACTIVE), which
// rules out a commitment that does not exist yet and the enumerable backlog of
// older subscriptions, and it rejects a commitment whose start_block is more
// than ENROLL_WINDOW blocks behind the current block (NG_ENROLL_LATE). A
// subscriber must enroll within ENROLL_WINDOW of subscribing, in the
// transaction that follows subscribe. A subscription already past its window
// can no longer enroll: the owner must cancel, reclaim, and re-subscribe to
// open a fresh window. This does not erase the race inside the window. A
// verifier that wants more than that should read the block height of the
// Enrolled event and compare it against start_block from the vault.
//
// owner_key is public, and the gate does not pretend otherwise. An ECDSA check
// needs the public key, and owner_key rides in the enroll calldata regardless,
// so the Enrolled event carries it and the enrolled_key view reads it back.
// Both are intentionally public. One key reused across commitments links those
// commitments to each other; a client that wants them unlinked must derive a
// per-commitment owner key. That derivation lives in the console, not in this
// contract.
//
// Pinning the gate. A receipt is only as good as the address that emitted it. A
// verifier must pin the one canonical gate address; a class hash or an event
// selector is not identity, since anyone may deploy the same class or emit an
// event of the same name. The vault() view returns the vault this gate reads,
// so an integrator can confirm a gate targets the canonical vault before
// trusting its receipts.
//
// v4 removes the assumption instead of narrowing it: the vault grows an
// owner_key view, the gate reads the key from the vault rather than from its
// own map, and enroll disappears from this ABI.

use starknet::ContractAddress;

#[starknet::interface]
pub trait INightshiftGate<T> {
    /// One-time key registration for `commitment`, authorized by a signature
    /// over enroll_message(commitment, owner_key) under `owner_key` itself.
    /// Reads the vault: the commitment must be active (NG_NOT_ACTIVE) and its
    /// start_block within ENROLL_WINDOW of the current block (NG_ENROLL_LATE),
    /// so a commitment that does not exist yet, an inactive one, or the old
    /// backlog cannot be registered. Write-once: a second call for the same
    /// commitment reverts NG_ALREADY_ENROLLED, whoever makes it and whatever key
    /// it carries.
    fn enroll(ref self: T, commitment: felt252, owner_key: felt252, sig_r: felt252, sig_s: felt252);

    /// Present control of an active, paid-current subscription to one verifier,
    /// up to one block height, once per nonce. Reverts unless the vault calls
    /// the subscription active (NG_NOT_ACTIVE), the current block is at or below
    /// `expiry_block` (NG_EXPIRED), `expiry_block` is no more than
    /// MAX_PRESENT_WINDOW blocks ahead (NG_EXPIRY_TOO_FAR), the signature over
    /// present_nonce_message(commitment, verifier_id, expiry_block, nonce)
    /// matches the key enrolled for `commitment` (NG_BAD_SIGNATURE), the vault
    /// reports no period due-but-uncharged (NG_ARREARS), and this exact tuple
    /// has not been presented before (NG_PRESENTED). Consumes the tuple's
    /// nullifier and returns the (creator_id, tier) the verifier gates on.
    fn present(
        ref self: T,
        commitment: felt252,
        verifier_id: felt252,
        expiry_block: u64,
        nonce: felt252,
        sig_r: felt252,
        sig_s: felt252,
    ) -> (felt252, u8);

    // --- views ---
    /// The vault this gate reads, as set at deploy. A verifier pins this to
    /// confirm a gate targets the canonical vault; class hash and event selector
    /// are not identity.
    fn vault(self: @T) -> ContractAddress;
    /// Passthrough to the vault. False for a commitment the vault never saw.
    fn is_active(self: @T, commitment: felt252) -> bool;
    /// Raw (creator_id, tier) from the vault's schedule. (0, 0) for an unknown
    /// commitment. This is schedule data only and says nothing about liveness: a
    /// caller that gates on it must read is_active alongside, since a cancelled
    /// or exhausted subscription still has a tier here.
    fn tier_of(self: @T, commitment: felt252) -> (felt252, u8);
    /// The registered key, or 0 if this commitment was never enrolled.
    /// Intentionally public: owner_key is already in the enroll calldata and the
    /// Enrolled event, so reading it back exposes nothing further.
    fn enrolled_key(self: @T, commitment: felt252) -> felt252;
}

pub mod errors {
    pub const NOT_ACTIVE: felt252 = 'NG_NOT_ACTIVE';
    pub const EXPIRED: felt252 = 'NG_EXPIRED';
    pub const EXPIRY_TOO_FAR: felt252 = 'NG_EXPIRY_TOO_FAR';
    pub const ARREARS: felt252 = 'NG_ARREARS';
    pub const PRESENTED: felt252 = 'NG_PRESENTED';
    pub const BAD_SIG: felt252 = 'NG_BAD_SIGNATURE';
    pub const NOT_ENROLLED: felt252 = 'NG_NOT_ENROLLED';
    pub const ALREADY_ENROLLED: felt252 = 'NG_ALREADY_ENROLLED';
    pub const ENROLL_LATE: felt252 = 'NG_ENROLL_LATE';
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
    use crate::common::{PERIOD_HOUR, enroll_message, present_nonce_message, present_nullifier};
    use crate::vault::{INightshiftVaultDispatcher, INightshiftVaultDispatcherTrait};
    use super::errors;

    /// A subscriber must register within this many blocks of subscribing. Equal
    /// to one PERIOD_HOUR: long enough for the enroll transaction to land after
    /// subscribe, short enough that the backlog and any pre-subscribe attempt
    /// are out of reach. A subscription past this window must cancel, reclaim,
    /// and re-subscribe to open a fresh window.
    const ENROLL_WINDOW: u64 = PERIOD_HOUR;

    /// The furthest ahead a presentation's expiry may be signed, so a captured
    /// presentation is not a long-lived bearer credential.
    const MAX_PRESENT_WINDOW: u64 = PERIOD_HOUR;

    #[storage]
    struct Storage {
        /// Set once at deploy. The gate holds no privileges over the vault and
        /// only ever reads from it.
        vault: ContractAddress,
        /// commitment -> registered STARK pubkey. Write-once.
        key_of: Map<felt252, felt252>,
        /// present_nullifier(commitment, verifier_id, expiry_block, nonce) ->
        /// consumed. Write-once, so one signed presentation admits once.
        presented: Map<felt252, bool>,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        Enrolled: Enrolled,
        Presented: Presented,
    }

    /// The block this lands in is the only evidence of enrollment order, which
    /// is what first-enrollment-wins rests on. `commitment` is indexed so a
    /// verifier can pull the enrollment for one subscription directly.
    #[derive(Drop, starknet::Event)]
    pub struct Enrolled {
        #[key]
        pub commitment: felt252,
        pub owner_key: felt252,
    }

    /// Emitted after every check passes. Public by construction: a verifier
    /// wanting an on-chain receipt reads this, and so can everyone else.
    /// `commitment` and `verifier_id` are indexed so a getEvents filter can
    /// narrow to one subscription or one door. `creator_id` rides along because
    /// a tier index is meaningless without the creator it indexes into.
    #[derive(Drop, starknet::Event)]
    pub struct Presented {
        #[key]
        pub commitment: felt252,
        #[key]
        pub verifier_id: felt252,
        pub expiry_block: u64,
        pub creator_id: felt252,
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
            // Write-once is absolute: the key-to-subscription binding does not
            // depend on vault state, so a taken slot reverts before any read.
            assert(self.key_of.entry(commitment).read() == 0, errors::ALREADY_ENROLLED);

            // Read the vault to shrink the front-run race. A commitment that is
            // unknown, not yet subscribed, cancelled, or exhausted is not
            // active; the enumerable backlog is past its window.
            let vault = INightshiftVaultDispatcher { contract_address: self.vault.read() };
            assert(vault.is_active(commitment), errors::NOT_ACTIVE);
            let (_, _, _, start_block, _, _, _, _) = vault.schedule_of(commitment);
            assert(get_block_number() <= start_block + ENROLL_WINDOW, errors::ENROLL_LATE);

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
            nonce: felt252,
            sig_r: felt252,
            sig_s: felt252,
        ) -> (felt252, u8) {
            // Liveness first: an unknown, cancelled or exhausted subscription
            // fails here, before any signature work.
            let vault = INightshiftVaultDispatcher { contract_address: self.vault.read() };
            assert(vault.is_active(commitment), errors::NOT_ACTIVE);

            // The signed height must be reachable and near. Both bound a captured
            // presentation: it dies at expiry_block, and expiry_block cannot have
            // been set more than MAX_PRESENT_WINDOW ahead of now.
            let now = get_block_number();
            assert(now <= expiry_block, errors::EXPIRED);
            assert(expiry_block <= now + MAX_PRESENT_WINDOW, errors::EXPIRY_TOO_FAR);

            let key = self.key_of.entry(commitment).read();
            assert(key != 0, errors::NOT_ENROLLED);
            let msg = present_nonce_message(commitment, verifier_id, expiry_block, nonce);
            assert(check_ecdsa_signature(msg, key, sig_r, sig_s), errors::BAD_SIG);

            // Paid through now: is_active carries no time term, so a lapsed
            // subscription whose keeper stopped charging is caught here.
            assert(vault.periods_due(commitment) == 0, errors::ARREARS);

            // Burn the presentation's nullifier, keyed on the message tuple. A
            // replay of this exact (commitment, verifier_id, expiry_block,
            // nonce), a malleated signature included, reverts here.
            let n = present_nullifier(commitment, verifier_id, expiry_block, nonce);
            assert(!self.presented.entry(n).read(), errors::PRESENTED);
            self.presented.entry(n).write(true);

            let (creator_id, tier, _, _, _, _, _, _) = vault.schedule_of(commitment);
            self.emit(Presented { commitment, verifier_id, expiry_block, creator_id, tier });
            (creator_id, tier)
        }

        fn vault(self: @ContractState) -> ContractAddress {
            self.vault.read()
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
