// The NIGHTSHIFT gate: tier-gated access on top of a subscription the vault
// already holds. A standalone contract, pointed at one vault address at deploy
// and only ever reading from it. It requires a vault that exposes
// owner_key_of; the v3 vault on mainnet
// (0x277519c8bc1031188313de4528d1f0159319f8f86651422e89b6fbd920b3759) stores
// sub_owner_key but has no view for it, so this gate ships alongside the vault
// revision that adds one.
//
// What a presentation is. `present` is a signature presentation. The commitment
// travels in the calldata and in the Presented event, so a verifier, and anyone
// else reading the chain, can link two presentations of the same subscription
// to each other, at one gate or across several. What the verifier gets is
// (creator_id, tier) and the commitment. What it does not get is a wallet: the
// subscriber authorizes with the owner key of the subscription, never with an
// account address.
//
// Which key signs. The gate asks the vault, on every presentation:
// owner_key_of(commitment) is the key the vault recorded at subscribe time,
// the same key that rode in the pool's subscribe calldata and the same one
// cancel and reclaim check. So the signature is bound to the exact key that
// subscription was created under. There is no registration step at this gate,
// no key map of its own, and no window to race: a key the vault did not record
// does not verify, and a commitment the vault holds no key for reads 0 and is
// refused.
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
// owner_key is public, and the gate does not pretend otherwise. An ECDSA check
// needs the public key, and owner_key is in the pool's subscribe calldata
// regardless, so the vault reading it back adds nothing to what the chain
// already shows. One key reused across commitments links those commitments to
// each other; a client that wants them unlinked must derive a per-commitment
// owner key. That derivation lives in the console, not in this contract.
//
// Pinning the gate. A receipt is only as good as the address that emitted it. A
// verifier must pin the one canonical gate address; a class hash or an event
// selector is not identity, since anyone may deploy the same class or emit an
// event of the same name. The vault() view returns the vault this gate reads,
// so an integrator can confirm a gate targets the canonical vault before
// trusting its receipts.

use starknet::ContractAddress;

#[starknet::interface]
pub trait INightshiftGate<T> {
    /// Present control of an active, paid-current subscription to one verifier,
    /// up to one block height, once per nonce. Reverts unless the vault calls
    /// the subscription active (NG_NOT_ACTIVE), the current block is at or below
    /// `expiry_block` (NG_EXPIRED), `expiry_block` is no more than
    /// MAX_PRESENT_WINDOW blocks ahead (NG_EXPIRY_TOO_FAR), the signature over
    /// present_nonce_message(commitment, verifier_id, expiry_block, nonce)
    /// matches the owner key the vault recorded for `commitment` at subscribe
    /// (NG_BAD_SIGNATURE), the vault reports no period due-but-uncharged
    /// (NG_ARREARS), and this exact tuple has not been presented before
    /// (NG_PRESENTED). Consumes the tuple's nullifier and returns the
    /// (creator_id, tier) the verifier gates on.
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
}

pub mod errors {
    pub const NOT_ACTIVE: felt252 = 'NG_NOT_ACTIVE';
    pub const EXPIRED: felt252 = 'NG_EXPIRED';
    pub const EXPIRY_TOO_FAR: felt252 = 'NG_EXPIRY_TOO_FAR';
    pub const ARREARS: felt252 = 'NG_ARREARS';
    pub const PRESENTED: felt252 = 'NG_PRESENTED';
    pub const BAD_SIG: felt252 = 'NG_BAD_SIGNATURE';
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
    use crate::common::{PERIOD_HOUR, present_nonce_message, present_nullifier};
    use crate::vault::{INightshiftVaultDispatcher, INightshiftVaultDispatcherTrait};
    use super::errors;

    /// The furthest ahead a presentation's expiry may be signed, so a captured
    /// presentation is not a long-lived bearer credential.
    const MAX_PRESENT_WINDOW: u64 = PERIOD_HOUR;

    #[storage]
    struct Storage {
        /// Set once at deploy. The gate holds no privileges over the vault and
        /// only ever reads from it.
        vault: ContractAddress,
        /// present_nullifier(commitment, verifier_id, expiry_block, nonce) ->
        /// consumed. Write-once, so one signed presentation admits once.
        presented: Map<felt252, bool>,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        Presented: Presented,
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

            // The key comes from the vault, so the signature is checked against
            // the exact key recorded at subscribe. A zero key means the vault
            // has no such subscription; is_active already caught that above, so
            // this is belt-and-braces.
            let key = vault.owner_key_of(commitment);
            assert(key != 0, errors::NOT_ACTIVE);
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
    }
}
