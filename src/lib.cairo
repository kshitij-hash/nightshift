// NIGHTSHIFT — recurring private authorization on the STRK20 pool.
//
// Layout (built up over the sprint):
//   common: tags, Schedule/Tier types, pack/unpack, message-hash builders
//   vault:  the anonymizer contract the pool invokes (subscribe / claim), plus the
//           charge / cancel / reclaim entrypoints called directly
//   gate:   standalone tier gate over a deployed vault: present, plus the
//           vault / is_active / tier_of read surface. It reads the owner key
//           from the vault's owner_key_of and registers nothing of its own

pub mod common;
pub mod gate;
pub mod mocks;
pub mod vault;
