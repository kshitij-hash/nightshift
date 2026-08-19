// Test doubles. MockPrivacyPool replays the deployed pool's external-invoke
// sequence byte-for-byte (verified against privacy.cairo on the live class):
//
//   TransferTo (plain ERC-20 transfer to the helper)
//   -> call_contract_syscall(target, selector!("privacy_invoke"), raw calldata)
//   -> strict Serde::deserialize::<Span<OpenNoteDeposit>>
//   -> assert(return_data.is_empty())            'INVALID_INVOKE_RETURN_DATA'
//   -> per deposit: note exists / open / undeposited / token match, then
//      checked_transfer_from(helper -> pool)      (helper must have APPROVED)
//   -> OpenNoteDeposited
//
// Every revert string matches the real pool's errors.cairo so a test that
// expects 'NOTE_NOT_OPEN' here would see the same felt on mainnet. No public
// harness for this exists anywhere; without it each assertion below costs a
// mainnet round trip.

use starknet::ContractAddress;

#[starknet::interface]
pub trait IMockPrivacyPool<T> {
    /// Registers an empty open note, as CreateOpenNote would.
    fn create_open_note(ref self: T, note_id: felt252, token: ContractAddress);
    /// The pool's TransferTo leg: moves `amount` of `token` held by the pool
    /// to `recipient` (the helper) ahead of the invoke.
    fn transfer_to(ref self: T, token: ContractAddress, recipient: ContractAddress, amount: u256);
    /// The pool's Invoke leg, with the real sequence and revert set.
    /// `expected_deposits` mirrors the batch's undeposited-open-note count.
    fn invoke_external(
        ref self: T, target: ContractAddress, calldata: Span<felt252>, expected_deposits: u32,
    );
    fn note_amount(self: @T, note_id: felt252) -> u128;
}

#[starknet::contract]
pub mod MockPrivacyPool {
    use core::num::traits::Zero;
    use starknet::storage::{Map, StoragePathEntry, StoragePointerReadAccess, StoragePointerWriteAccess};
    use starknet::syscalls::call_contract_syscall;
    use starknet::{ContractAddress, SyscallResultTrait, get_contract_address};
    use crate::common::OpenNoteDeposit;

    #[starknet::interface]
    trait IERC20<T> {
        fn transfer(ref self: T, recipient: ContractAddress, amount: u256) -> bool;
        fn transfer_from(
            ref self: T, sender: ContractAddress, recipient: ContractAddress, amount: u256,
        ) -> bool;
    }

    #[storage]
    struct Storage {
        note_token: Map<felt252, ContractAddress>,
        note_deposited: Map<felt252, u128>,
        note_exists: Map<felt252, bool>,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        ExternalContractInvoked: ExternalContractInvoked,
        OpenNoteDeposited: OpenNoteDeposited,
    }

    #[derive(Drop, starknet::Event)]
    pub struct ExternalContractInvoked {
        pub contract_address: ContractAddress,
        pub selector: felt252,
    }

    #[derive(Drop, starknet::Event)]
    pub struct OpenNoteDeposited {
        pub depositor: ContractAddress,
        pub token: ContractAddress,
        pub note_id: felt252,
        pub amount: u128,
    }

    #[abi(embed_v0)]
    impl MockPoolImpl of super::IMockPrivacyPool<ContractState> {
        fn create_open_note(ref self: ContractState, note_id: felt252, token: ContractAddress) {
            self.note_token.entry(note_id).write(token);
            self.note_exists.entry(note_id).write(true);
        }

        fn transfer_to(
            ref self: ContractState,
            token: ContractAddress,
            recipient: ContractAddress,
            amount: u256,
        ) {
            IERC20Dispatcher { contract_address: token }.transfer(recipient, amount);
        }

        fn invoke_external(
            ref self: ContractState,
            target: ContractAddress,
            calldata: Span<felt252>,
            expected_deposits: u32,
        ) {
            let mut return_data = call_contract_syscall(
                address: target, entry_point_selector: selector!("privacy_invoke"), :calldata,
            )
                .unwrap_syscall();
            self
                .emit(
                    ExternalContractInvoked {
                        contract_address: target, selector: selector!("privacy_invoke"),
                    },
                );

            let deposits: Span<OpenNoteDeposit> = Serde::deserialize(ref return_data)
                .expect('INVALID_INVOKE_RETURN_DATA');
            assert(return_data.is_empty(), 'INVALID_INVOKE_RETURN_DATA');
            assert(deposits.len() == expected_deposits, 'UNDEPOSITED_OPEN_NOTES');

            for deposit in deposits {
                let OpenNoteDeposit { note_id, token, amount } = *deposit;
                assert(token.is_non_zero(), 'ZERO_TOKEN');
                assert(amount.is_non_zero(), 'ZERO_AMOUNT');
                assert(self.note_exists.entry(note_id).read(), 'NOTE_NOT_FOUND');
                assert(self.note_deposited.entry(note_id).read().is_zero(), 'NOTE_ALREADY_DEPOSITED');
                assert(self.note_token.entry(note_id).read() == token, 'TOKEN_MISMATCH');
                self.note_deposited.entry(note_id).write(amount);
                // The pool PULLS the output: the helper must have approved.
                let ok = IERC20Dispatcher { contract_address: token }
                    .transfer_from(target, get_contract_address(), amount.into());
                assert(ok, 'TRANSFER_FROM_FAILED');
                self.emit(OpenNoteDeposited { depositor: target, token, note_id, amount });
            }
        }

        fn note_amount(self: @ContractState, note_id: felt252) -> u128 {
            self.note_deposited.entry(note_id).read()
        }
    }
}

#[starknet::interface]
pub trait IMockERC20<T> {
    fn mint(ref self: T, recipient: ContractAddress, amount: u256);
    fn balance_of(self: @T, account: ContractAddress) -> u256;
    fn transfer(ref self: T, recipient: ContractAddress, amount: u256) -> bool;
    fn transfer_from(
        ref self: T, sender: ContractAddress, recipient: ContractAddress, amount: u256,
    ) -> bool;
    fn approve(ref self: T, spender: ContractAddress, amount: u256) -> bool;
}

#[starknet::contract]
pub mod MockERC20 {
    use starknet::storage::{Map, StoragePathEntry, StoragePointerReadAccess, StoragePointerWriteAccess};
    use starknet::{ContractAddress, get_caller_address};

    #[storage]
    struct Storage {
        balances: Map<ContractAddress, u256>,
        allowances: Map<(ContractAddress, ContractAddress), u256>,
    }

    #[abi(embed_v0)]
    impl MockERC20Impl of super::IMockERC20<ContractState> {
        fn mint(ref self: ContractState, recipient: ContractAddress, amount: u256) {
            let b = self.balances.entry(recipient).read();
            self.balances.entry(recipient).write(b + amount);
        }

        fn balance_of(self: @ContractState, account: ContractAddress) -> u256 {
            self.balances.entry(account).read()
        }

        fn transfer(ref self: ContractState, recipient: ContractAddress, amount: u256) -> bool {
            let caller = get_caller_address();
            let b = self.balances.entry(caller).read();
            assert(b >= amount, 'INSUFFICIENT_BALANCE');
            self.balances.entry(caller).write(b - amount);
            let r = self.balances.entry(recipient).read();
            self.balances.entry(recipient).write(r + amount);
            true
        }

        fn transfer_from(
            ref self: ContractState,
            sender: ContractAddress,
            recipient: ContractAddress,
            amount: u256,
        ) -> bool {
            let caller = get_caller_address();
            let allowed = self.allowances.entry((sender, caller)).read();
            assert(allowed >= amount, 'INSUFFICIENT_ALLOWANCE');
            self.allowances.entry((sender, caller)).write(allowed - amount);
            let b = self.balances.entry(sender).read();
            assert(b >= amount, 'INSUFFICIENT_BALANCE');
            self.balances.entry(sender).write(b - amount);
            let r = self.balances.entry(recipient).read();
            self.balances.entry(recipient).write(r + amount);
            true
        }

        fn approve(ref self: ContractState, spender: ContractAddress, amount: u256) -> bool {
            self.allowances.entry((get_caller_address(), spender)).write(amount);
            true
        }
    }
}
